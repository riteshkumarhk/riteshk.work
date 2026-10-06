import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { Miniflare } from 'miniflare';
import { chromium } from 'playwright-core';
import { createBaselineAccounting, bindBaselineAccounting, baselineCodeFingerprint, BASELINE_BUDGET_KEY } from './tools/resume-baseline-accounting.mjs';
import { connectBaselineStudio } from './tools/resume-baseline-studio.mjs';
import { AI_TEXT_REQUEST_ATTEMPTS, aiEmbeddingInput } from './src/js/ai-request-limits.mjs';
import { historyHash } from './src/js/resume-assessment-history.mjs';
import { RESUME_COMPLETION_LIMITS, resumeCompletionReservation } from './src/js/resume-review.mjs';
import { createAiOrchestrator } from './src/js/ai-orchestrator.mjs';
import { createAiTaskAgent, agentRequestOptions, prepareRequestOptions } from './src/js/ai-task-agent.mjs';
import { normalizeAiModel } from './src/js/ai-model-router.mjs';
import { aiProviderScope } from './src/js/ai-model-catalog.mjs';
import { assessAtsResume } from './src/js/resume-ats.mjs';
import { atsFactsBlock } from './src/js/ats-core.js';

const PARENT = 'system/resume-assessment-budget-v1.json';
const inputSnapshot = { version: 1, artifactSha256: null, text: 'Private fixture text.', target: { level: 'staff', company: '', jd: 'Python' } };
const digest = await historyHash(inputSnapshot);
const routingPolicy = { maxCost: null, evaluationDailyBudget: 0, autoEvaluate: false, useReference: true, providers: 'selected' };
const configuration = { routingPolicy, providerScope: '["anthropic","https://example.invalid"]', manualModel: null, embedding: null };
function bucket() {
  const records = new Map(); let serial = 0;
  return { records, reject: null, loseAck: false,
    async get(key) { const entry = records.get(key); return entry ? { etag: entry.etag, json: async () => JSON.parse(entry.text) } : null; },
    async put(key, text, options = {}) {
      const previous = records.get(key);
      if (options.onlyIf?.etagMatches ? previous?.etag !== options.onlyIf.etagMatches : options.onlyIf?.etagDoesNotMatch && previous) return null;
      const reject = this.reject?.(key, JSON.parse(text));
      if (reject && !this.loseAck) throw new Error('Synthetic storage failure');
      const entry = { text, etag: String(++serial) }; records.set(key, entry);
      if (reject) throw new Error('Synthetic lost acknowledgement');
      return { etag: entry.etag };
    },
  };
}
async function setup(context, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rk-baseline-budget-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storage = options.storage || bucket(), checkedAt = Date.now();
  const pricing = { input: 1, output: 2, checkedAt };
  const amount = resumeCompletionReservation({ stage: 'requirements', system: '', user: '', maxTokens: RESUME_COMPLETION_LIMITS.requirements }, pricing).maximumAmount;
  const prior = { version: 1, id: 'candidate-review', maxCost: 6, approvedAt: checkedAt, reservations: [{
    plan: { id: 'old-reservation', provider: 'anthropic', model: 'old-model', pricing, stages: [{ stage: 'requirements', maximumAmount: amount }], amount, at: checkedAt },
    attempts: [{ stage: 'requirements', status: 'reserved', requestSha256: null, at: null, requestId: null, usage: null, error: null }],
  }] };
  await storage.put(PARENT, JSON.stringify(prior), { onlyIf: { etagDoesNotMatch: '*' } });
  const policy = { version: 1, maxCost: 8, checkedAt, codeSha256: await baselineCodeFingerprint(), configurationSha256: await historyHash({ ...configuration, embedding: options.embedding ? { provider: options.embedding, id: 'fixture-embedding' } : null }), automaticEvaluation: false,
    embedding: options.embedding ? { provider: options.embedding, id: 'fixture-embedding' } : null,
    models: [{ provider: 'anthropic', id: 'fixture-model', kind: 'completion', pricing: { input: 1, output: 2 }, maxInputTokens: 50000, maxOutputTokens: 1000 },
      ...(options.embedding ? [{ provider: options.embedding, id: 'fixture-embedding', kind: 'embedding', pricing: { input: 0.1, output: 0 }, maxInputTokens: 100000, maxOutputTokens: 0 }] : [])] };
  let clock = checkedAt;
  const args = { bucket: storage, identityPath: join(directory, 'identity.json'), policy, now: () => clock };
  const store = createBaselineAccounting(args), review = await store.review();
  if (options.approve !== false) await store.approve({ approvalSha256: review.approvalSha256 });
  return { args, store, storage, policy, prior, review, directory, setClock: value => { clock = value; } };
}
const wire = (id = 'call-0') => ({ id, kind: 'completion', provider: 'anthropic', model: 'fixture-model',
  body: JSON.stringify({ model: 'fixture-model', max_tokens: 1000, system: 'Untrusted fictional source only.', messages: [{ role: 'user', content: 'Private fixture text.' }] }) });
const reserve = async (store, input = inputSnapshot) => {
  const inputSha256 = await historyHash(input);
  await store.reserve({ id: 'run', inputSha256 });
  await store.verifyInput('run', inputSha256, input);
  return inputSha256;
};
const dispatch = (store, request = wire(), send = async () => new Response('{"ok":true}'), signal) => store.dispatch('run', digest, request, send, signal);

test('Baseline quote protects the whole historical authority and prices all 24 raw completion attempts', async context => {
  const item = await setup(context);
  assert.equal(item.review.completionRequests, 24);
  assert.equal(AI_TEXT_REQUEST_ATTEMPTS, 2);
  assert.equal(item.review.additionalPerRun, 1.248);
  assert.equal(item.review.protectedHistoricalCeiling, 6);
  assert.equal(item.review.historicalReserved, item.prior.reservations[0].plan.amount);
  await reserve(item.store);
  assert.equal((await item.store.status()).reserved, 7.248);
  await assert.rejects(item.store.reserve({ id: 'second', inputSha256: digest }), /cumulative ceiling/);
  assert.deepEqual(await (await item.storage.get(PARENT)).json(), item.prior);
  assert.equal(item.storage.records.get(PARENT).text, JSON.stringify(item.prior));
});
test('Every raw request is claimed before send, byte-bound, retained and never replayed', async context => {
  const { store, storage, prior } = await setup(context); await reserve(store);
  let calls = 0;
  const response = await dispatch(store, wire(), async () => {
    calls++;
    assert.equal((await store.status()).runs[0].attempts[0].status, 'started');
    return new Response('data: first\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  assert.equal(await response.text(), 'data: first\n\ndata: [DONE]\n\n');
  const status = await store.status(), attempt = status.runs[0].attempts[0];
  assert.equal(attempt.requestSha256, await historyHash(wire()));
  assert.equal(attempt.responseSha256, await historyHash(new TextEncoder().encode('data: first\n\ndata: [DONE]\n\n')));
  assert.equal(status.baselineReserved, 1.248);
  await assert.rejects(dispatch(store, wire(), async () => { calls++; }), /already attempted/);
  assert.equal(calls, 1);
  assert.ok(!storage.records.get(BASELINE_BUDGET_KEY).text.includes('Private fixture text'));
  assert.deepEqual(await (await storage.get(PARENT)).json(), prior);
});
test('Concurrent runs and duplicate raw operations cannot overspend or send twice', async context => {
  const item = await setup(context), other = createBaselineAccounting(item.args);
  const results = await Promise.allSettled([reserve(item.store), other.reserve({ id: 'other', inputSha256: digest })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const runId = (await item.store.status()).runs[0].id;
  await item.store.verifyInput(runId, digest, inputSnapshot);
  let calls = 0;
  const send = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return new Response('ok'); };
  const attempts = await Promise.allSettled([item.store, other].map(store => store.dispatch(runId, digest, wire(), send)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(calls, 1);
});
test('Unknown transport outcomes, cancelled streams and incomplete reads retain the whole reservation', async context => {
  for (const mode of ['transport', 'stream', 'cancel']) {
    const item = await setup(context); await reserve(item.store);
    const controller = new AbortController(); let calls = 0;
    const send = async () => {
      calls++;
      if (mode === 'transport') throw new Error('Synthetic network failure');
      if (mode === 'cancel') { controller.abort(new Error('Synthetic cancellation')); return new Promise(() => {}); }
      return new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1])); stream.error(new Error('Synthetic broken stream')); } }));
    };
    await assert.rejects(dispatch(item.store, wire(), send, controller.signal));
    const status = await item.store.status();
    assert.equal(status.baselineReserved, item.review.additionalPerRun);
    assert.equal(status.runs[0].status, 'stopped'); assert.equal(status.runs[0].attempts[0].status, 'unknown');
    await assert.rejects(dispatch(item.store, wire('next'), send), /closed/);
    assert.equal(calls, 1);
  }
});
test('Storage failures and lost claim acknowledgements never trigger a provider request', async context => {
  for (const loseAck of [false, true]) {
    const item = await setup(context); await reserve(item.store);
    item.storage.loseAck = loseAck;
    item.storage.reject = (key, value) => key === BASELINE_BUDGET_KEY && value.runs.some(run => run.attempts.some(attempt => attempt.status === 'started'));
    let calls = 0;
    await assert.rejects(dispatch(item.store, wire(), async () => { calls++; return new Response('ok'); }), /Synthetic/);
    assert.equal(calls, 0);
    item.storage.reject = null;
    if (loseAck) await assert.rejects(dispatch(createBaselineAccounting(item.args), wire(), async () => { calls++; }), /pending/);
    assert.equal(calls, 0);
  }
});
test('Enrollment cannot reset after deletion, partial writes, changed consent or policy', async context => {
  const item = await setup(context, { approve: false });
  await assert.rejects(item.store.approve({ approvalSha256: digest }), /exact approval/);
  item.storage.reject = key => key === BASELINE_BUDGET_KEY;
  await assert.rejects(item.store.approve({ approvalSha256: item.review.approvalSha256 }), /Synthetic/);
  item.storage.reject = null;
  await assert.rejects(item.store.approve({ approvalSha256: item.review.approvalSha256 }), /EEXIST/);
  await assert.rejects(item.store.status(), /pending/);
  const enrolled = await setup(context); await reserve(enrolled.store);
  enrolled.storage.records.delete(BASELINE_BUDGET_KEY);
  await assert.rejects(createBaselineAccounting(enrolled.args).status(), /ledger is missing/);
  await assert.rejects(enrolled.store.approve({ approvalSha256: enrolled.review.approvalSha256 }), /EEXIST/);
  const changed = await setup(context);
  await assert.rejects(createBaselineAccounting({ ...changed.args, policy: { ...changed.policy, maxCost: 9 } }).status(), /policy.*changed/);
  await writeFile(changed.args.identityPath, '{}');
  await assert.rejects(changed.store.status(), /record fields/);
});
test('Changed parent, expired prices, wrong input and changed routing stop before dispatch', async context => {
  const item = await setup(context); await reserve(item.store);
  await item.store.verifyConfiguration(configuration);
  await assert.rejects(item.store.verifyConfiguration({ ...configuration, manualModel: { modelId: 'other' } }), /configuration changed/);
  await assert.rejects(item.store.dispatch('run', 'b'.repeat(64), wire(), async () => { throw new Error('Must not send'); }), /changed/);
  item.setClock(item.policy.checkedAt + 86400001);
  await assert.rejects(dispatch(item.store), /current prices/);
  item.setClock(item.policy.checkedAt);
  const entry = item.storage.records.get(PARENT), value = JSON.parse(entry.text); value.approvedAt++;
  entry.text = JSON.stringify(value);
  await assert.rejects(dispatch(item.store), /historical budget changed/);
});
test('Unpriced models, oversized bodies, hidden tool/cache/image features and missing output limits reject', async context => {
  const item = await setup(context); await reserve(item.store);
  for (const change of [
    request => { request.model = 'not-approved'; },
    request => { const body = JSON.parse(request.body); delete body.max_tokens; request.body = JSON.stringify(body); },
    request => { const body = JSON.parse(request.body); body.max_tokens = 1001; request.body = JSON.stringify(body); },
    request => { const body = JSON.parse(request.body); body.system = 'x'.repeat(50000); request.body = JSON.stringify(body); },
    request => { const body = JSON.parse(request.body); body.tools = []; request.body = JSON.stringify(body); },
    request => { const body = JSON.parse(request.body); body.system = [{ type: 'text', text: 'source', cache_control: { type: 'ephemeral' } }]; request.body = JSON.stringify(body); },
    request => { const body = JSON.parse(request.body); body.messages[0].content = [{ type: 'image', source: {} }]; request.body = JSON.stringify(body); },
    request => { request.body = '{}'; },
  ]) {
    const request = wire(); change(request);
    await assert.rejects(dispatch(item.store, request, async () => { assert.fail('Must not send'); }));
  }
  assert.equal((await item.store.status()).runs[0].attempts.length, 0);
});
test('Raw call limits and completion survive reconstruction without refunds', async context => {
  const item = await setup(context); await reserve(item.store);
  for (let index = 0; index < 24; index++) await dispatch(createBaselineAccounting(item.args), wire('call-' + index));
  await assert.rejects(dispatch(item.store, wire('call-24')), /raw request limit/);
  await item.store.finish('run', true);
  assert.equal((await item.store.status()).runs[0].status, 'complete');
  assert.equal((await item.store.status()).baselineReserved, 1.248);
  await assert.rejects(dispatch(item.store, wire('call-25')), /closed/);
  await assert.rejects(reserve(item.store), /already been reserved/);
});
test('Frozen no-embedding and actual OpenAI/Gemini payloads preserve normalization without fallback', async context => {
  const none = await setup(context); await reserve(none.store);
  const noneAdapter = bindBaselineAccounting(none.store, { runId: 'run', inputSha256: digest });
  assert.equal((await noneAdapter.semantic(inputSnapshot.text, inputSnapshot.target.jd)).unavailable, true);
  assert.equal((await none.store.status()).runs[0].attempts.length, 0);
  for (const provider of ['openai', 'gemini']) {
    const item = await setup(context, { embedding: provider });
    const input = { ...inputSnapshot, text: ' Resume \n text ', target: { ...inputSnapshot.target, jd: 'J'.repeat(9000) } };
    const inputSha256 = await reserve(item.store, input);
    let calls = 0;
    const adapter = bindBaselineAccounting(item.store, { runId: 'run', inputSha256, embeddingTransport: async request => {
      calls++;
      assert.equal(request.kind, 'embedding'); assert.equal(request.provider, provider);
      const body = JSON.parse(request.body);
      const input = provider === 'openai' ? body.input : body.requests.map(entry => entry.content.parts[0].text);
      assert.deepEqual(input, ['Resume text', 'J'.repeat(8000)]);
      return Response.json(provider === 'openai' ? { data: [{ embedding: [1, 0] }, { embedding: [1, 0] }] } : { embeddings: [{ values: [1, 0] }, { values: [1, 0] }] });
    } });
    assert.equal((await adapter.semantic(' Resume \n text ', 'J'.repeat(9000))).ok, true);
    await assert.rejects(adapter.semantic('Resume', 'Job'), /semantic input differs/);
    await assert.rejects(adapter.semantic(input.text, input.target.jd), /already attempted/);
    assert.equal(calls, 1);
  }
  assert.deepEqual(aiEmbeddingInput({ input: ['  x \n y ', null, '', 'z'] }), ['x y', 'z']);
});
test('Persistent R2 ledger and separate filesystem identity survive a real runtime restart', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'rk-baseline-r2-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const options = { modules: true, script: 'export default {fetch(){return new Response("offline")}}', r2Buckets: ['BUDGET'], r2Persist: join(directory, 'r2') };
  let runtime = new Miniflare(options);
  try {
    const item = await setup(context, { storage: await runtime.getR2Bucket('BUDGET') });
    await reserve(item.store); await dispatch(item.store);
    await runtime.dispose(); runtime = new Miniflare(options);
    const restored = createBaselineAccounting({ ...item.args, bucket: await runtime.getR2Bucket('BUDGET') });
    assert.equal((await restored.status()).baselineReserved, 1.248);
    await assert.rejects(dispatch(restored), /already attempted/);
    await dispatch(restored, wire('second'));
  } finally { await runtime.dispose(); }
});

const studio = await readFile(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
function sourceFunction(name, next) {
  const start = studio.indexOf('  async function ' + name + '(');
  const end = studio.indexOf('  ' + next, start);
  assert.ok(start >= 0 && end > start, name);
  return studio.slice(start, end);
}
test('The actual Studio transport preserves temperature retry and claims both exact raw attempts', async context => {
  const item = await setup(context); await reserve(item.store);
  const adapter = bindBaselineAccounting(item.store, { runId: 'run', inputSha256: digest });
  const bodies = [], cfg = { provider: 'anthropic', base: 'https://example.invalid', routingMaxTokens: 1000 };
  const source = sourceFunction('verifyBaselineAccounting', 'async function aiTextRequest') + sourceFunction('aiTextRequest', 'function aiProviderFailure');
  const request = runInNewContext(source + '\naiTextRequest', { AI_TEXT_REQUEST_ATTEMPTS, aiNoTemperature: new Set(), aiManualModel: null,
    aiMode: () => 'cf', aiCfKeys: { openai: { set: false }, gemini: { set: false } },
    aiCfg: () => cfg, aiProviderScope: () => configuration.providerScope, aiOrchestrator: { state: async () => ({ policy: routingPolicy }) },
    fetch: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      assert.equal((await item.store.status()).runs[0].attempts.at(-1).status, 'started');
      return bodies.length === 1 ? Response.json({ error: { message: 'temperature is not supported' } }, { status: 400 }) : new Response('ok');
    } });
  const body = JSON.parse(wire().body); body.temperature = 0;
  assert.equal(await (await request(cfg, 'fixture-model', 'https://example.invalid/messages', {}, body, undefined,
    { baselineAccounting: adapter, usageContext: { callId: 'logical-call' } })).text(), 'ok');
  assert.equal(bodies.length, 2); assert.equal(bodies[0].temperature, 0); assert.equal(Object.hasOwn(bodies[1], 'temperature'), false);
  const attempts = (await item.store.status()).runs[0].attempts;
  assert.deepEqual(attempts.map(value => value.id), ['logical-call-0', 'logical-call-1']);
  assert.deepEqual(attempts.map(value => value.httpStatus), [400, 200]);
  assert.notEqual(attempts[0].requestSha256, attempts[1].requestSha256);
});

function sourcePart(start, end) {
  const first = studio.indexOf('  ' + start), last = studio.indexOf('  ' + end, first);
  assert.ok(first >= 0 && last > first, start);
  return studio.slice(first, last);
}
function legacyPipeline({ store, bounded, changePolicy = false }) {
  const cfg = { provider: 'anthropic', base: 'https://example.invalid', key: 'synthetic-not-a-credential' };
  const state = { version: 1, policy: structuredClone(routingPolicy), observations: [], decisions: [], incumbents: {} };
  const model = normalizeAiModel('anthropic', { id: 'fixture-model', pricing: { input: 1, output: 2 }, max_input_tokens: 50000, context_window: 51000, max_tokens: 1000,
    capabilities: { structured_outputs: { supported: true } } });
  const router = createAiOrchestrator({ catalog: { discover: async () => ({ models: [model], scope: aiProviderScope(cfg) }) },
    store: { read: async () => structuredClone(state), update: async change => change(state) } });
  const texts = [], raw = [], roles = []; let coordinator = 0, evaluations = 0;
  const code = sourcePart('function atsSystem(', 'function atsRenderHtml(') +
    sourcePart('async function baselineAssessmentInput(', 'async function atsFetchToPanel(') +
    sourcePart('function aiTaskOptions(', 'async function aiQueueEvaluation(') +
    sourcePart('function aiPromptContent(', 'const aiNoTemperature') +
    sourcePart('const aiNoTemperature', '// Pick the first working model') +
    sourcePart('async function aiText(', '// Inline "connect an AI service"') +
    sourcePart('function csgenParse(', 'function csgenRepair(');
  const context = { AbortSignal, TextDecoder, TextEncoder, Uint8Array, AI_TEXT_REQUEST_ATTEMPTS, agentRequestOptions, prepareRequestOptions, aiProviderScope, historyHash,
    aiMode: () => 'cf', aiCfKeys: { openai: { set: false }, gemini: { set: false } },
    assessAtsResume, atsFactsBlock, aiOrchestrator: router, aiTaskAgent: createAiTaskAgent({ router }), aiManualModel: null, aiLastRoute: null,
    aiSession: { begin: () => ({ id: 'job', sessionId: 'session', signal: new AbortController().signal }), route() {}, activity() {}, finish() {}, recordUsage() {}, output: (...args) => texts.push(args) },
    aiRoutingConfigs: async () => [cfg], aiCfg: () => cfg, aiQueueEvaluation: () => { evaluations++; },
    window: { dispatchEvent() {} }, CustomEvent: class { constructor(type) { this.type = type; } },
    atsLevelName: () => 'Principal / Staff', atsPdfPages: async () => null, atsSemNeural: async () => ({ unavailable: true }), resumeFrame: null, atsNeuralFallbackOk: false,
    csgenRepair: () => { assert.fail('The complete fixture should not need repair'); },
    aiUsageFromJson: () => null, aiUsageRecord() {},
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); raw.push(body);
      if (bounded) assert.equal((await store.status()).runs[0].attempts.at(-1).status, 'started');
      if (raw.length === 1) return Response.json({ error: { message: 'temperature is not supported' } }, { status: 400 });
      let text;
      if (body.system.startsWith("You are Studio's outcome coordinator.")) {
        roles.push('coordinator');
        const input = JSON.parse(body.messages[0].content);
        if (++coordinator === 1) text = JSON.stringify({ action: 'delegate', modelRef: input.catalogue[0].ref, task: 'analysis', purpose: 'evidence', instruction: 'Inspect the provided text.', inputs: [] });
        else if (coordinator === 2) text = JSON.stringify({ action: 'draft', modelRef: input.draftModels[0], task: 'analysis', instruction: '', inputs: input.work.filter(work => work.valid).map(work => work.id) });
        else {
          text = JSON.stringify({ action: 'finish' });
          if (changePolicy) state.policy.autoEvaluate = true;
        }
      } else if (body.system.includes('delegated task')) {
        roles.push('delegate'); text = 'Only the provided fictional evidence was inspected.';
      } else {
        roles.push('draft');
        text = 'Legacy wrapper\n' + JSON.stringify({ score: 75, band: 'Good', summary: 'Scripted legacy result.', checks: [], fixes: [], keywords: { present: [], missing: [] } }) + '\nEnd';
      }
      if (body.stream) {
        const events = [{ type: 'content_block_delta', delta: { type: 'text_delta', text } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }, { type: 'message_stop' }];
        return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
      }
      return Response.json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 40 } });
    } };
  return { evaluate: runInNewContext(code + '\natsEvaluate', context), raw, roles, texts, evaluations: () => evaluations };
}
test('Actual legacy evaluator, task agent and streaming transport account every role without changing the result', async context => {
  const item = await setup(context);
  const file = new File(['Synthetic artifact-binding fixture'], 'source-binding-fixture.pdf', { type: 'application/pdf' });
  const input = ['Fictional Person\nBuilt Python prototypes with the product design team.', file, 'staff', 'Fictional Example', 'Python'];
  const inputSha256 = await historyHash({ version: 1, artifactSha256: await historyHash(new Uint8Array(await file.arrayBuffer())), text: input[0], target: { level: input[2], company: input[3], jd: input[4] } });
  await item.store.reserve({ id: 'run', inputSha256 });
  const adapter = bindBaselineAccounting(item.store, { runId: 'run', inputSha256 });
  const baseline = legacyPipeline({ bounded: false });
  const expected = await baseline.evaluate(...input);
  const guarded = legacyPipeline({ store: item.store, bounded: true });
  const actual = await guarded.evaluate(...input, undefined, adapter);
  assert.deepEqual(JSON.parse(JSON.stringify(actual.res)), JSON.parse(JSON.stringify(expected.res)));
  assert.deepEqual(guarded.roles, ['coordinator', 'delegate', 'coordinator', 'draft', 'coordinator']);
  assert.equal(guarded.raw.length, 6); assert.equal(baseline.raw.length, 6);
  assert.deepEqual(guarded.raw, baseline.raw, 'No altered prompts, output caps, temperature retry, schema or streaming flags');
  assert.equal(guarded.evaluations(), 0); assert.equal(baseline.evaluations(), 1);
  assert.equal((await item.store.status()).runs[0].attempts.length, 6);
  assert.ok(guarded.texts.length > 0);
  await item.store.finish('run', true);
});
test('Automatic evaluation becoming enabled during the baseline stops before any extra job is scheduled', async context => {
  const item = await setup(context);
  const text = 'Fictional Person\nBuilt Python tools for the product design team.';
  const inputSha256 = await historyHash({ version: 1, artifactSha256: null, text, target: { level: 'staff', company: '', jd: 'Python' } });
  await item.store.reserve({ id: 'run', inputSha256 });
  const guarded = legacyPipeline({ store: item.store, bounded: true, changePolicy: true });
  await assert.rejects(guarded.evaluate(text, null, 'staff', '', 'Python', undefined,
    bindBaselineAccounting(item.store, { runId: 'run', inputSha256 })), /automatic-evaluation-OFF/);
  assert.equal(guarded.evaluations(), 0);
  assert.equal((await item.store.status()).runs[0].attempts.length, 6);
});
test('Oversized responses, missing completion and an in-flight stop cannot release a usable result', async context => {
  const item = await setup(context); await reserve(item.store);
  await assert.rejects(item.store.finish('run', true), /unresolved/);
  await assert.rejects(dispatch(item.store, wire(), async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1))), /receipt size/);
  assert.equal((await item.store.status()).runs[0].status, 'stopped');
  const other = await setup(context); await reserve(other.store);
  let release;
  const pending = dispatch(other.store, wire(), async () => {
    await other.store.finish('run', false);
    return new Promise(resolve => { release = () => resolve(new Response('late')); });
  });
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  release();
  await assert.rejects(pending, /closed while/);
  assert.equal((await other.store.status()).runs[0].status, 'stopped');
});
test('Independent identity detects removal or rollback of valid-looking runs and attempts', async context => {
  for (const remove of ['run', 'attempt']) {
    const item = await setup(context); await reserve(item.store); await dispatch(item.store);
    const entry = item.storage.records.get(BASELINE_BUDGET_KEY), value = JSON.parse(entry.text);
    if (remove === 'run') value.runs = []; else value.runs[0].attempts = [];
    entry.text = JSON.stringify(value);
    await assert.rejects(createBaselineAccounting(item.args).status(), /rolled back/);
    await assert.rejects(dispatch(item.store, wire('next'), async () => assert.fail('Must not send')), /rolled back/);
  }
});
test('Lost response acknowledgements and orphaned filesystem locks require audit, not automatic replay', async context => {
  const item = await setup(context); await reserve(item.store);
  item.storage.loseAck = true;
  item.storage.reject = (key, value) => key === BASELINE_BUDGET_KEY && value.runs.some(run => run.attempts.some(attempt => attempt.status === 'received'));
  let calls = 0;
  await assert.rejects(dispatch(item.store, wire(), async () => { calls++; return new Response('received'); }), /lost acknowledgement/);
  item.storage.reject = null;
  await assert.rejects(dispatch(createBaselineAccounting(item.args), wire('different-id'), async () => { calls++; }), /pending/);
  assert.equal(calls, 1);
  const locked = await setup(context);
  await writeFile(locked.args.identityPath + '.lock', 'unresolved owner process');
  await assert.rejects(locked.store.status(), /orphaned lock/);
  assert.equal(await readFile(locked.args.identityPath + '.lock', 'utf8'), 'unresolved owner process');
});
test('Forged code bindings and absent bounded-entry capability cannot start a baseline', async context => {
  const item = await setup(context);
  await assert.rejects(createBaselineAccounting({ ...item.args, policy: { ...item.policy, codeSha256: digest } }).review(), /runtime source changed/);
  let allowed = false, verified = 0, assessed = 0;
  const assess = runInNewContext(sourceFunction('resumeStudioAssessBounded', 'function closeResumeStudio') + '\nresumeStudioAssessBounded', {
    resumeCandidateEnabled: () => allowed, aiCfg: () => ({}),
    verifyBaselineAccounting: async () => { verified++; },
    resumeStudioAssess: async (...args) => { assessed++; return args[4]; },
  });
  await assert.rejects(assess({}, 'pdf', {}, {}, undefined), /local candidate/);
  allowed = true;
  await assert.rejects(assess({}, 'pdf', {}, undefined), /explicit bounded/);
  const adapter = bindBaselineAccounting(item.store, { runId: 'run', inputSha256: digest });
  assert.equal(await assess({}, 'pdf', {}, adapter), adapter);
  assert.equal(verified, 1); assert.equal(assessed, 1);
  assert.match(studio, /resume\.baseline = Object\.freeze\(\{ version: 1, sourceSha256: typeof BASELINE_SOURCE_SHA256/);
});
test('Unknown or changed embedding configuration is rejected rather than silently running a lexical baseline', async context => {
  const item = await setup(context);
  await assert.rejects(item.store.verifyConfiguration({ ...configuration, embedding: { provider: 'openai', id: 'text-embedding-3-small' } }), /embedding configuration differs/);
  const cfg = { provider: 'anthropic', base: 'https://example.invalid' }, keys = { openai: { set: false }, gemini: { set: false } };
  const verify = runInNewContext(sourceFunction('verifyBaselineAccounting', 'async function aiTextRequest') + '\nverifyBaselineAccounting', {
    aiCfg: () => cfg, aiProviderScope, aiManualModel: null, aiMode: () => 'cf', aiCfKeys: keys,
    aiOrchestrator: { state: async () => ({ policy: routingPolicy }) },
  });
  const adapter = bindBaselineAccounting(item.store, { runId: 'run', inputSha256: digest });
  await verify(adapter, cfg);
  keys.openai.set = true;
  await assert.rejects(verify(adapter, cfg), /embedding configuration differs/);
  delete keys.openai.set;
  await assert.rejects(verify(adapter, cfg), /metadata is required/);
});
test('Unverified or changed artifact/text/target cannot use a reserved run', async context => {
  const item = await setup(context);
  await item.store.reserve({ id: 'run', inputSha256: digest });
  await assert.rejects(dispatch(item.store), /unverified/);
  for (const change of [
    value => { value.artifactSha256 = 'b'.repeat(64); },
    value => { value.text += ' changed'; },
    value => { value.target.jd = 'Different job'; },
  ]) {
    const value = structuredClone(inputSnapshot); change(value);
    await assert.rejects(item.store.verifyInput('run', digest, value), /differs from the reserved input/);
  }
  assert.equal((await item.store.status()).runs[0].attempts.length, 0);
  await item.store.verifyInput('run', digest, inputSnapshot);
  await dispatch(item.store);
});
test('Bounded preparation reads the same verified export and returns its exact unpaid input binding', async () => {
  const document = { id: 'document', signature: 'current', target: { level: 'staff', company: 'Example', jd: 'Python' } };
  const bytes = new TextEncoder().encode('Synthetic source-binding bytes'), paths = [];
  let allowed = true, current = true;
  const source = sourceFunction('baselineAssessmentInput', 'async function atsEvaluate') +
    sourceFunction('resumeStudioAssessmentSource', 'async function resumeStudioAssess(') +
    sourceFunction('resumeStudioPrepareBaseline', 'function closeResumeStudio');
  const prepare = runInNewContext(source + '\nresumeStudioPrepareBaseline', {
    File, Uint8Array, historyHash, resumeCandidateEnabled: () => allowed, resumeStudioConfiguration: () => ({ available: true }),
    resumeSignature: value => value.signature,
    resumeStudioRequest: async path => {
      paths.push(path);
      return path.endsWith('/exports/pdf') ? new Response(bytes) : Response.json({
        document, exports: [{ id: 'pdf', signature: current ? 'current' : 'stale', name: 'source.pdf' }],
      });
    },
    fbExtractFile: async () => ' Fictional\n  Person Python ',
  });
  const prepared = await prepare(document, 'pdf', {});
  assert.equal(prepared.input.artifactSha256, await historyHash(bytes));
  assert.equal(prepared.input.text, 'Fictional Person Python');
  assert.equal(prepared.inputSha256, await historyHash(prepared.input));
  assert.deepEqual(paths, ['resumes/document', 'resumes/document/exports/pdf']);
  current = false;
  await assert.rejects(prepare(document, 'pdf', {}), /PDF changed/);
  allowed = false;
  await assert.rejects(prepare(document, 'pdf', {}), /local candidate/);
});

async function studioFixture(context, options = {}) {
  const item = await setup(context, options);
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  context.after(() => browser.close());
  const page = await browser.newPage(), calls = [];
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:5538/')) return route.fulfill({
      contentType: 'text/html', body: '<title>Scripted baseline adapter</title><iframe class="adm__resume-host"></iframe>',
    });
    assert.ok(url.startsWith('https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/ai/'), 'No uncontrolled network request');
    const cors = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:5538', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const status = await item.store.status();
    assert.equal(status.runs[0].attempts.at(-1).status, 'started');
    assert.equal(route.request().headers().authorization, 'Bearer fictional-browser-only');
    calls.push({ url, body: route.request().postData() });
    if (options.onCall) return options.onCall({ route, calls, cors, page });
    const value = url.endsWith('/embeddings') ? { data: [{ embedding: [1, 0] }, { embedding: [1, 0] }] } :
      url.endsWith(':batchEmbedContents') ? { embeddings: [{ values: [1, 0] }, { values: [1, 0] }] } : { fixture: 'complete' };
    return route.fulfill({ json: value, headers: cors });
  });
  await page.goto('http://127.0.0.1:5538/studio/?candidate=1');
  await page.evaluate(({ input, inputSha256, configuration, request, retry, codeSha256 }) => {
    window.__rkAdminAuth = { locked: false, session: { token: 'fictional-browser-only', exp: Date.now() + 600000 }, lastActivity: Date.now() };
    window.__RKStudio = { resume: { baseline: {
      version: 1,
      sourceSha256: codeSha256,
      prepare: async () => ({ input, inputSha256 }),
      assess: async (document, exportId, caller, accounting, signal) => {
        if (caller !== window.document.querySelector('iframe').contentWindow) throw new Error('Wrong caller');
        await accounting.verifyConfiguration(configuration);
        await accounting.verifyInput(input);
        const semantic = await accounting.semantic(input.text, input.target.jd, signal);
        const perform = wire => accounting.request(wire, lifetime => fetch(
          'https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/ai/anthropic/messages',
          { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window.__rkAdminAuth.session.token },
            body: wire.body, signal: lifetime }), signal);
        let response = await perform(request);
        if (retry && response.status === 400) {
          const failure = await response.json();
          if (failure.error?.message !== 'temperature unsupported') throw new Error('Error body changed');
          const next = JSON.parse(request.body); delete next.temperature;
          response = await perform({ ...request, id: 'call-1', body: JSON.stringify(next) });
        }
        if (!response.ok) throw new Error('Scripted provider rejected request');
        return { text: await response.text(), semantic, exportId };
      },
    } } };
  }, { input: inputSnapshot, inputSha256: digest, configuration: { ...configuration, embedding: item.policy.embedding },
    request: options.request || wire(), retry: !!options.retry, codeSha256: item.policy.codeSha256 });
  const connect = () => connectBaselineStudio(page, { document: { id: 'fictional-saved' }, exportId: 'fictional-pdf', signal: options.signal });
  return { ...item, page, calls, connect };
}

test('Saved-Studio adapter prepares without enrollment and accounts real browser transport without exporting credentials', async context => {
  const item = await studioFixture(context), connection = await item.connect();
  try {
    assert.deepEqual(await connection.prepare(), { input: inputSnapshot, inputSha256: digest });
    assert.equal((await item.store.status()).runs.length, 0);
    assert.equal(item.calls.length, 0);
    await item.store.reserve({ id: 'run', inputSha256: digest });
    const result = await connection.assess(item.store, { runId: 'run', inputSha256: digest });
    assert.equal(result.text, '{"fixture":"complete"}');
    assert.equal(result.semantic.unavailable, true);
    assert.equal(item.calls[0].body, wire().body);
    const status = await item.store.status();
    assert.equal(status.runs[0].status, 'complete');
    assert.equal(status.runs[0].attempts.length, 1);
    assert.equal(JSON.stringify(status).includes('fictional-browser-only'), false);
    await assert.rejects(connection.assess(item.store, { runId: 'run', inputSha256: digest }), /no replay/);
  } finally { await connection.close(); }
  assert.deepEqual(await item.page.evaluate(() => Object.keys(window).filter(key => key.startsWith('__rkBaseline_'))), []);
});

test('Saved-Studio adapter refuses old bundles, locked sessions, wrong origins and unreserved execution before inference', async context => {
  const item = await studioFixture(context);
  const connection = await item.connect();
  await assert.rejects(connection.assess(item.store, { runId: 'absent', inputSha256: digest }), /reserved run/);
  await connection.close();
  await item.page.evaluate(() => { window.__rkAdminAuth.locked = true; });
  await assert.rejects(item.connect(), /unlocked/);
  await item.page.evaluate(() => { window.__rkAdminAuth.locked = false; window.__RKStudio.resume.baseline.sourceSha256 = 'b'.repeat(64); });
  await assert.rejects(item.connect(), /loaded bundle differs/);
  await item.page.evaluate(() => { delete window.__RKStudio.resume.baseline; });
  await assert.rejects(item.connect(), /old bundles/);
  await assert.rejects(connectBaselineStudio({ url: () => 'https://riteshk.work/studio' }, { document: {}, exportId: 'pdf' }), /local candidate/);
  assert.equal(item.calls.length, 0);
});

test('Saved-Studio adapter preserves raw temperature-retry errors and byte-exact streaming replies', async context => {
  const request = wire(); request.body = JSON.stringify({ ...JSON.parse(request.body), temperature: 0 });
  const streamed = 'data: {"text":"fixture"}\n\ndata: [DONE]\n\n';
  const item = await studioFixture(context, { request, retry: true,
    onCall: ({ route, calls, cors }) => calls.length === 1
      ? route.fulfill({ status: 400, json: { error: { message: 'temperature unsupported' } }, headers: cors })
      : route.fulfill({ body: streamed, headers: { ...cors, 'Content-Type': 'text/event-stream' } }),
  });
  const connection = await item.connect();
  try {
    await item.store.reserve({ id: 'run', inputSha256: digest });
    assert.equal((await connection.assess(item.store, { runId: 'run', inputSha256: digest })).text, streamed);
    assert.equal(item.calls.length, 2);
    assert.equal(item.calls[0].body, request.body);
    assert.equal(Object.hasOwn(JSON.parse(item.calls[1].body), 'temperature'), false);
    assert.deepEqual((await item.store.status()).runs[0].attempts.map(item => item.httpStatus), [400, 200]);
  } finally { await connection.close(); }
});

test('Saved-Studio adapter sends pinned OpenAI and Gemini embeddings through exact saved-provider routes', async context => {
  for (const provider of ['openai', 'gemini']) {
    const item = await studioFixture(context, { embedding: provider }), connection = await item.connect();
    try {
      await item.store.reserve({ id: 'run', inputSha256: digest });
      const result = await connection.assess(item.store, { runId: 'run', inputSha256: digest });
      assert.equal(result.semantic.ok, true);
      assert.equal(item.calls.length, 2);
      assert.equal(item.calls[0].url.endsWith(provider === 'openai' ? '/openai/embeddings' : '/gemini/models/fixture-embedding:batchEmbedContents'), true);
      assert.deepEqual((await item.store.status()).runs[0].attempts.map(item => item.kind), ['embedding', 'completion']);
    } finally { await connection.close(); }
  }
});

test('Saved-Studio adapter refuses changed owner sessions and changed source before a request', async context => {
  for (const change of ['session', 'source']) {
    const item = await studioFixture(context), connection = await item.connect();
    try {
      await item.store.reserve({ id: 'run', inputSha256: change === 'source' ? 'b'.repeat(64) : digest });
      if (change === 'session') await item.page.evaluate(() => { window.__rkAdminAuth.session.token = 'different-owner'; });
      await assert.rejects(connection.assess(item.store, { runId: 'run', inputSha256: change === 'source' ? 'b'.repeat(64) : digest }),
        /session changed|differs from the reserved input/);
      assert.equal(item.calls.length, 0);
      assert.equal((await item.store.status()).runs[0].status, 'stopped');
    } finally { await connection.close(); }
  }
});

test('Saved-Studio cancellation retains the reservation and unknown request outcome without replay', async context => {
  const controller = new AbortController();
  const item = await studioFixture(context, { signal: controller.signal,
    onCall: async ({ route }) => { controller.abort(new Error('Fixture cancellation')); await route.abort(); },
  });
  const connection = await item.connect();
  try {
    await item.store.reserve({ id: 'run', inputSha256: digest });
    await assert.rejects(connection.assess(item.store, { runId: 'run', inputSha256: digest }), /Fixture cancellation/);
    assert.equal(item.calls.length, 1);
    const status = await item.store.status();
    assert.equal(status.runs[0].status, 'stopped');
    assert.equal(status.baselineReserved, item.review.additionalPerRun);
    assert.ok(['started', 'unknown'].includes(status.runs[0].attempts[0].status));
    await assert.rejects(connection.assess(item.store, { runId: 'run', inputSha256: digest }), /Fixture cancellation/);
  } finally { await connection.close(); }
});

test('Saved-Studio adapter rejects foreign frames and closes oversized provider receipts without releasing a result', async context => {
  const item = await studioFixture(context, { onCall: ({ route, cors }) => route.fulfill({
    body: 'x'.repeat(8 * 1024 * 1024 + 1), headers: cors,
  }) }), connection = await item.connect();
  try {
    await item.store.reserve({ id: 'run', inputSha256: digest });
    const binding = await item.page.evaluate(() => Object.keys(window).find(key => key.startsWith('__rkBaseline_')));
    const frame = item.page.frames().find(frame => frame !== item.page.mainFrame());
    await assert.rejects(frame.evaluate(name => window[name]('invented'), binding), /unexpected or unenrolled caller/);
    await assert.rejects(connection.assess(item.store, { runId: 'run', inputSha256: digest }), /outcome unavailable or unknown/);
    const status = await item.store.status();
    assert.equal(status.runs[0].status, 'stopped');
    assert.equal(status.runs[0].attempts[0].status, 'unknown');
    assert.equal(item.calls.length, 1);
  } finally { await connection.close(); }
});

test('Saved-Studio adapter refuses replaced frames and navigation instead of attaching to another session', async context => {
  for (const change of ['frame', 'navigation']) {
    const item = await studioFixture(context), connection = await item.connect();
    try {
      if (change === 'frame') await item.page.evaluate(() => window.document.querySelector('iframe').remove());
      else await item.page.goto('http://127.0.0.1:5538/changed');
      await assert.rejects(connection.prepare(), /frame or owner session changed|navigated/);
      assert.equal(item.calls.length, 0);
    } finally { await connection.close(); }
  }
});
