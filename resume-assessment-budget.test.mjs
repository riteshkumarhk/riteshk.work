import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createAssessmentBudgetStore, assessmentBudgetRoute } from './worker/resume-assessment-budget.mjs';
import { RESUME_COMPLETION_LIMITS, resumeCompletionReservation } from './src/js/resume-review.mjs';
import { createAssessmentBudgetClient } from './src/js/resume-assessment-budget-client.mjs';
import { createAssessmentPilot } from './src/js/resume-assessment-pilot.mjs';
import { createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { AdminSessions } from './worker/admin-sessions.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const policy = (provider = 'anthropic') => ({ version: 1, provider, checkedAt: Date.now(), maxCost: 10,
  models: [{ id: 'scripted-central-model', pricing: { input: 1, output: 2 }, maxInputTokens: 128000, maxOutputTokens: 12000, contextWindow: 140000, reasoning: provider === 'openai' }] });
function bucket() {
  const records = new Map(); let revision = 0;
  return { records, rejectStatus: null, loseAcknowledgement: false,
    async get(key) { const value = records.get(key); return value ? { etag: value.etag, json: async () => JSON.parse(value.text) } : null; },
    async put(key, text, options) {
      const previous = records.get(key), value = JSON.parse(text);
      if (options.onlyIf.etagMatches ? options.onlyIf.etagMatches !== previous?.etag : !!previous) return null;
      const reject = this.rejectStatus && value.reservations.some(item => item.attempts.some(attempt => attempt.status === this.rejectStatus));
      if (reject && !this.loseAcknowledgement) throw new Error('Synthetic storage failure');
      const record = { etag: String(++revision), text }; records.set(key, record);
      if (reject) throw new Error('Synthetic lost acknowledgement');
      return { etag: record.etag };
    }
  };
}
function plan(config, stages = ['requirements']) {
  const pricing = { ...config.models[0].pricing, checkedAt: config.checkedAt };
  const entries = stages.map(stage => ({ stage, maximumAmount: resumeCompletionReservation({ stage, system: '', user: '', maxTokens: RESUME_COMPLETION_LIMITS[stage] }, pricing).maximumAmount }));
  return { id: crypto.randomUUID(), provider: config.provider, model: config.models[0].id, pricing, stages: entries,
    amount: Math.ceil(entries.reduce((sum, item) => sum + item.maximumAmount, 0) * 1e6) / 1e6, at: Date.now() };
}
const input = (reservation, stage = reservation.stages[0].stage) => ({ reservationId: reservation.id, provider: reservation.provider, model: reservation.model,
  stage, system: 'Scripted test only. Return JSON.', user: 'Private fictional source.', maxTokens: RESUME_COMPLETION_LIMITS[stage] });
const receipt = request => ({ provider: request.provider, model: request.model, text: '{}', requestId: 'scripted-response', usage: null });
async function setup(config = policy(), storage = bucket(), maximum = 10) {
  const store = createAssessmentBudgetStore(storage, config);
  await store.approve({ confirmed: true, maxCost: maximum });
  return { store, storage, config };
}

test('Central R2 budget shares a fixed ceiling across concurrent devices and reconstructed services', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-central-budget-'));
  const options = { modules: true, script: 'export default {fetch(){return new Response("offline")}}', r2Buckets: ['BUDGET'], r2Persist: join(directory, 'r2') };
  let runtime = new Miniflare(options);
  try {
    const storage = await runtime.getR2Bucket('BUDGET'), config = policy();
    const first = await setup(config, storage, 1), second = createAssessmentBudgetStore(storage, config);
    const reservations = Array.from({ length: 14 }, () => plan(config));
    const results = await Promise.allSettled(reservations.map((value, index) => (index % 2 ? first.store : second).reserve(value)));
    const accepted = results.filter(item => item.status === 'fulfilled');
    assert.equal(accepted.length, Math.floor(1 / reservations[0].amount));
    const status = await createAssessmentBudgetStore(storage, config).status();
    assert.equal(status.reserved, Math.round(accepted.length * reservations[0].amount * 1e6) / 1e6);
    assert.ok(status.reserved <= 1);
    await assert.rejects(second.approve({ confirmed: true, maxCost: 2 }), /cannot be reset/);
    await assert.rejects(second.approve({ confirmed: true, maxCost: 0.5 }), /cannot be reset/);
    assert.equal((await second.approve({ confirmed: true, maxCost: 1 })).reserved, status.reserved);
    await runtime.dispose(); runtime = new Miniflare(options);
    const restored = createAssessmentBudgetStore(await runtime.getR2Bucket('BUDGET'), config);
    assert.equal((await restored.status()).reserved, status.reserved);
    await assert.rejects(restored.approve({ confirmed: true, maxCost: 2 }), /cannot be reset/);
  } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
test('Whole phases reserve before execution, acknowledge identical reservation retries and permit each stage only once in order', async () => {
  const { store, storage, config } = await setup(), reservation = plan(config, ['assessment', 'challenge']);
  await store.reserve(reservation); await store.reserve(structuredClone(reservation));
  assert.equal((await store.status()).reserved, reservation.amount);
  await assert.rejects(store.reserve({ ...reservation, model: 'changed-model' }), /server model/);
  await assert.rejects(store.reserve({ ...plan(config, ['revision', 'challenge']), id: reservation.id }), /identity was reused/);
  let calls = 0;
  const invoke = async request => { calls++; return receipt(request); };
  await assert.rejects(store.execute(input(reservation, 'challenge'), invoke), /out of order/);
  const attempts = await Promise.allSettled([store.execute(input(reservation), invoke), createAssessmentBudgetStore(storage, config).execute(input(reservation), invoke)]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1); assert.equal(calls, 1);
  await store.execute(input(reservation, 'challenge'), invoke); assert.equal(calls, 2);
  await assert.rejects(store.execute(input(reservation, 'challenge'), invoke), /already attempted/);
  assert.equal(calls, 2); assert.equal((await store.status()).reserved, reservation.amount);
  assert.ok(![...storage.records.values()][0].text.includes('Private fictional source.'));
});
test('Raw response retention is opt-in, bounded and precedes parsing without exposing headers or permitting retries', async () => {
  for (const mode of ['default', 'boundary', 'malformed', 'oversized', 'retention-failure', 'cancel-retention']) {
    const { storage, config } = await setup(), captured = [];
    const controller = new AbortController();
    const store = createAssessmentBudgetStore(storage, config, mode === 'default' ? {} : {
      retainResponse: async value => {
        captured.push(structuredClone(value));
        if (mode === 'retention-failure') throw new Error('Synthetic private retention write failure');
        if (mode === 'cancel-retention') controller.abort(new Error('Synthetic cancellation during retention'));
      },
    });
    const reservation = plan(config); await store.reserve(reservation);
    const raw = mode === 'malformed' ? ' { invalid JSON ' : mode === 'oversized' ? 'x'.repeat(60001)
      : mode === 'boundary' ? '{"x":"' + 'x'.repeat(59992) + '"}' : '{"private":"fictional-response-only"}';
    let calls = 0;
    const execute = () => store.execute(input(reservation), async request => {
      calls++; return { ...receipt(request), text: raw };
    }, controller.signal);
    if (['default', 'boundary'].includes(mode)) await execute();
    else await assert.rejects(execute(), ['retention-failure', 'cancel-retention'].includes(mode) ? /Response retention was not acknowledged/ : /Provider attempt failed/);
    assert.equal(captured.length, ['default', 'oversized'].includes(mode) ? 0 : 1);
    if (captured.length) {
      assert.equal(captured[0].receipt.text, raw);
      assert.deepEqual(Object.keys(captured[0]).sort(), ['receipt', 'requestSha256', 'reservationId', 'sha256', 'stage']);
      assert.deepEqual(Object.keys(captured[0].receipt).sort(), ['model', 'provider', 'requestId', 'text', 'usage']);
      assert.match(captured[0].sha256, /^[a-f0-9]{64}$/);
    }
    const persisted = [...storage.records.values()][0].text;
    assert.ok(!persisted.includes(raw)); // Central storage holds hashes, not the optional private body.
    const saved = JSON.parse(persisted).reservations[0].attempts[0];
    assert.equal(Object.hasOwn(saved, 'rawResponseSha256'), captured.length === 1);
    assert.equal((await store.status()).reserved, reservation.amount);
    await assert.rejects(store.execute(input(reservation), () => { calls++; throw new Error('No retry expected'); }), /already attempted/); assert.equal(calls, 1);
  }
});
test('Claim persistence failures and lost acknowledgements never allow unreserved or duplicated provider calls', async () => {
  for (const lost of [false, true]) {
    const { store, storage, config } = await setup(), reservation = plan(config);
    await store.reserve(reservation); storage.rejectStatus = 'started'; storage.loseAcknowledgement = lost;
    let calls = 0;
    await assert.rejects(store.execute(input(reservation), async request => { calls++; return receipt(request); }), /storage failure|lost acknowledgement/);
    assert.equal(calls, 0); storage.rejectStatus = null;
    if (lost) await assert.rejects(store.execute(input(reservation), receipt), /already attempted/);
    assert.equal((await store.status()).reserved, reservation.amount);
  }
  const { store, storage, config } = await setup(), reservation = plan(config);
  await store.reserve(reservation); storage.rejectStatus = 'received'; let calls = 0;
  await assert.rejects(store.execute(input(reservation), async request => { calls++; return receipt(request); }), /storage failure/);
  storage.rejectStatus = null;
  await assert.rejects(createAssessmentBudgetStore(storage, config).execute(input(reservation), receipt), /already attempted/);
  assert.equal(calls, 1); assert.equal((await store.status()).reserved, reservation.amount);
});
test('Provider failures, cancellation, unknown usage and invalid receipts retain their full reservations without retry or refund', async () => {
  for (const mode of ['throw-null', 'wrong-model', 'over-output', 'cancel', 'unknown-usage']) {
    const { store, config } = await setup(), reservation = plan(config), controller = new AbortController();
    await store.reserve(reservation); let calls = 0;
    const action = store.execute(input(reservation), async request => {
      calls++;
      if (mode === 'throw-null') throw null;
      if (mode === 'cancel') { controller.abort(); return new Promise(() => {}); }
      return { ...receipt(request), ...(mode === 'wrong-model' ? { model: 'unpriced-model' } : {}),
        ...(mode === 'over-output' ? { usage: { inputTokens: 1, outputTokens: 99999 } } : {}) };
    }, controller.signal);
    if (mode === 'unknown-usage') assert.equal((await action).receipt.usage, null);
    else await assert.rejects(action, /outcome is unknown/);
    await assert.rejects(store.execute(input(reservation), receipt), /already attempted/);
    assert.equal(calls, 1); assert.equal((await store.status()).reserved, reservation.amount);
  }
});
test('Server policy rejects forged prices, missing approval, new budget IDs, stale quotes, arbitrary caps, routes and oversized inputs', async () => {
  const config = policy(), storage = bucket(), store = createAssessmentBudgetStore(storage, config), reservation = plan(config);
  await assert.rejects(store.reserve(reservation), /Approve the central/);
  await assert.rejects(store.approve({ confirmed: false, maxCost: 1 }), /Explicit approval/);
  await assert.rejects(store.approve({ confirmed: true, maxCost: 1, id: 'new-budget' }), /Unexpected/);
  await store.approve({ confirmed: true, maxCost: 1 });
  const forged = structuredClone(reservation); forged.pricing.input = 0.1;
  await assert.rejects(store.reserve(forged));
  await store.reserve(reservation);
  let calls = 0;
  for (const change of [{ maxTokens: 1 }, { provider: 'openai' }, { stage: 'unknown' }, { stream: true }, { tools: [] }, { base: 'https://example.test' }, { user: 'x'.repeat(110000) }]) {
    await assert.rejects(store.execute({ ...input(reservation), ...change }, async request => { calls++; return receipt(request); }));
  }
  assert.equal(calls, 0);
  assert.throws(() => createAssessmentBudgetStore(storage, { ...config, checkedAt: Date.now() - 86400001 }), /pricing/);
  assert.throws(() => createAssessmentBudgetStore(storage, null), /not enabled/);
  const reduced = structuredClone(config); reduced.models[0].contextWindow = 13000;
  const tight = createAssessmentBudgetStore(storage, reduced);
  await assert.rejects(tight.execute({ ...input(reservation), user: 'x'.repeat(10000) }, receipt), /capacity/);
});
test('Central HTTP execution constructs bounded one-attempt provider requests and never accepts client provider URLs or stream settings', async () => {
  for (const provider of ['anthropic', 'openai']) {
    const config = policy(provider), { store, storage } = await setup(config), reservation = plan(config);
    await store.reserve(reservation); const calls = [];
    const call = async body => assessmentBudgetRoute(new Request('https://example.test/admin/resume/assessment/execute', { method: 'POST', body: JSON.stringify(body) }),
      { VAULT: storage, RESUME_ASSESSMENT_POLICY: JSON.stringify(config) }, { 'Cache-Control': 'no-store' }, async () => 'synthetic-not-a-secret',
      async (url, options) => {
        calls.push({ url, options }); const request = JSON.parse(options.body);
        assert.equal(request.stream, false); assert.equal(request.model, config.models[0].id); assert.equal(options.redirect, 'error');
        assert.equal(request[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'], 8000);
        return Response.json(provider === 'anthropic'
          ? { id: 'fake-response', model: request.model, type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] }
          : { id: 'fake-response', model: request.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] });
      });
    assert.equal((await call({ ...input(reservation), stream: true })).status, 400); assert.equal(calls.length, 0);
    const response = await call(input(reservation)); assert.equal(response.status, 200); assert.equal((await response.json()).receipt.provider, provider);
    assert.equal((await call(input(reservation))).status, 409); assert.equal(calls.length, 1);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
test('Real worker routing requires an allowed origin and owner session before any budget access, and fails closed without policy', async () => {
  const bundled = await build({ entryPoints: ['worker/rk-ai-proxy.js'], bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external' });
  const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const sessions = new Map();
  const service = new AdminSessions({ storage: { get: async key => structuredClone(sessions.get(key)), put: async (key, value) => sessions.set(key, structuredClone(value)),
    setAlarm: async () => {} }, blockConcurrencyWhile: action => action() });
  const owner = await (await service.fetch(new Request('https://internal/issue', { method: 'POST', body: JSON.stringify({ verified: true }) }))).json();
  const env = { ALLOW_ORIGIN: 'https://example.test', VAULT: bucket(),
    ADMIN_SESSIONS: { idFromName: name => name, get: () => ({ fetch: (url, options) => service.fetch(new Request(url, options)) }) } };
  const request = (origin, token) => new Request('https://example.test/admin/resume/assessment/budget', { headers: { Origin: origin, Authorization: 'Bearer ' + token } });
  assert.equal((await worker.fetch(request('https://untrusted.test', owner.token), env)).status, 403);
  assert.equal((await worker.fetch(request('https://example.test', 'not-a-session'), env)).status, 401);
  assert.equal((await worker.fetch(request('https://example.test', owner.token), env)).status, 503);
  env.RESUME_ASSESSMENT_POLICY = JSON.stringify(policy());
  const allowed = await worker.fetch(request('https://example.test', owner.token), env);
  assert.equal(allowed.status, 200); assert.equal((await allowed.json()).approved, false);
  const history = (origin, token) => new Request('https://example.test/admin/resume/history/records', { headers: { Origin: origin, Authorization: 'Bearer ' + token } });
  assert.equal((await worker.fetch(history('https://untrusted.test', owner.token), env)).status, 403);
  assert.equal((await worker.fetch(history('https://example.test', 'not-a-session'), env)).status, 401);
  assert.equal((await worker.fetch(history('https://example.test', owner.token), env)).status, 503);
  assert.equal(env.VAULT.records.size, 0);
});
test('Sonnet 5.5 uses a frozen adaptive-medium request policy with no unsupported sampling parameter or retry', async () => {
  const config = policy(); config.models[0].id = 'claude-sonnet-5-5'; config.models[0].pricing = { input: 2, output: 10 };
  const { store, storage } = await setup(config, bucket(), 4), reservation = plan(config, ['assessment', 'challenge']);
  await store.reserve(reservation);
  let calls = 0;
  const execute = () => assessmentBudgetRoute(new Request('https://example.test/admin/resume/assessment/execute', {
    method: 'POST', body: JSON.stringify(input(reservation)) }), { VAULT: storage, RESUME_ASSESSMENT_POLICY: JSON.stringify(config) }, {},
  async () => 'synthetic-not-a-secret', async (url, options) => {
    calls++; assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const request = JSON.parse(options.body);
    assert.equal(Object.hasOwn(request, 'temperature'), false);
    assert.equal(Object.hasOwn(request, 'top_p'), false);
    assert.deepEqual(request.thinking, { type: 'adaptive' });
    assert.deepEqual(request.output_config, { effort: 'medium' });
    assert.equal(request.max_tokens, 12000); assert.equal(request.stream, false);
    return Response.json({ id: 'sonnet-test', model: 'claude-sonnet-5-5', type: 'message', role: 'assistant', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: 'Synthetic hidden reasoning.' }, { type: 'text', text: '{}' }] });
  });
  const response = await execute();
  assert.equal(response.status, 200); assert.equal((await response.json()).receipt.requestPolicy, 'anthropic-sonnet-5-5-medium-v1');
  assert.equal((await execute()).status, 409); assert.equal(calls, 1);
  const ledger = JSON.parse(storage.records.get('system/resume-assessment-budget-v1.json').text);
  assert.equal(ledger.reservations[0].requestPolicy, 'anthropic-sonnet-5-5-medium-v1');
});
test('Changed or absent reserved request policies block invocation while old receipts remain readable', async () => {
  const config = policy('openai'), { store, storage } = await setup(config), reservation = plan(config, ['assessment', 'challenge']);
  await store.reserve(reservation); await store.execute(input(reservation), receipt);
  config.models[0].reasoning = false;
  let calls = 0;
  const changed = createAssessmentBudgetStore(storage, config);
  await assert.rejects(changed.execute(input(reservation, 'challenge'), request => { calls++; return receipt(request); }), /request policy.*changed/);
  const object = storage.records.get('system/resume-assessment-budget-v1.json'), ledger = JSON.parse(object.text);
  delete ledger.reservations[0].requestPolicy; object.text = JSON.stringify(ledger);
  assert.equal((await changed.status()).reserved, reservation.amount);
  await assert.rejects(changed.execute(input(reservation, 'challenge'), receipt), /request policy.*missing/);
  assert.equal(calls, 0);
});
test('The approved four-dollar fictional plan reserves 3.564007 and cannot reset or exceed its ceiling', async () => {
  const config = policy(); config.maxCost = 4; config.models[0].id = 'claude-sonnet-5-5'; config.models[0].pricing = { input: 2, output: 10 };
  const { store, storage } = await setup(config, bucket(), 4);
  const phases = [['requirements'], ['assessment', 'challenge'], ['requirements'], ['assessment', 'challenge'], ['revision', 'challenge'], ['assessment', 'challenge']];
  const reservations = phases.map(stages => plan(config, stages));
  assert.equal(reservations.reduce((sum, item) => sum + Math.round(item.amount * 1e6), 0), 3564007);
  assert.equal(reservations.reduce((sum, item) => sum + item.stages.length, 0), 10);
  for (const reservation of reservations) await store.reserve(reservation);
  assert.equal((await store.status()).reserved, 3.564007);
  await assert.rejects(store.reserve(plan(config, ['assessment', 'challenge'])), /exhausted/);
  await assert.rejects(createAssessmentBudgetStore(storage, config).approve({ confirmed: true, maxCost: 8 }), /within the server ceiling/);
  assert.equal((await store.status()).maxCost, 4);
});
test('Central response bindings reject invalid JSON without refunding or retrying and validate their state transitions', async () => {
  const { store, storage, config } = await setup(), reservation = plan(config);
  await store.reserve(reservation);
  let calls = 0;
  await assert.rejects(store.execute(input(reservation), request => { calls++; return { ...receipt(request), text: 'not JSON' }; }), /reservation retained/);
  await assert.rejects(store.execute(input(reservation), receipt), /already attempted/);
  assert.equal(calls, 1); assert.equal((await store.status()).reserved, reservation.amount);
  const object = storage.records.get('system/resume-assessment-budget-v1.json'), ledger = JSON.parse(object.text);
  const attempt = ledger.reservations[0].attempts[0];
  assert.equal(attempt.status, 'failed'); assert.match(attempt.binding.request, /^[a-f0-9]{64}$/); assert.equal(attempt.binding.response, null);
  attempt.binding.response = '0'.repeat(64); object.text = JSON.stringify(ledger);
  await assert.rejects(store.status(), /Inconsistent stored request\/output binding/);
  delete attempt.binding; object.text = JSON.stringify(ledger);
  assert.equal((await store.status()).reserved, reservation.amount);
});
test('Pilot central adapter survives cleared local history without resetting server spending and has no direct-provider fallback', async () => {
  const { store, config } = await setup(), original = plan(config);
  await store.reserve(original);
  const request = async (action, body) => action === 'budget' ? store.status() : action === 'approve' ? store.approve(body) : action === 'reserve' ? store.reserve(body)
    : store.execute(body, async call => ({ ...receipt(call), text: JSON.stringify({ revision: 1, segments: [{ id: 'jd-0', disposition: 'context', reason: 'Scripted context.' }], requirements: [] }) }));
  const budget = { scope: 'server', id: 'candidate-review', maxCost: 10, approved: true };
  const snapshot = await createAssessmentSnapshot({ artifact: { bytes: new TextEncoder().encode('Fictional resume'), text: 'Fictional resume', mediaType: 'text/plain', extractorVersion: 'test' },
    target: { company: 'Example', role: 'Designer', level: 'staff', jd: 'Python' } });
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const connect = async () => createAssessmentPilot({ snapshot, getCurrent: () => snapshot, provider: config.provider, model: config.models[0].id,
    pricing: { ...config.models[0].pricing, checkedAt: config.checkedAt }, authority: await createAssessmentBudgetClient({ request, budget }),
    budget, storage, locks: { request: async (_, action) => action() }, invoke: () => { throw new Error('Direct provider must never be used'); } });
  const first = await connect(); assert.equal(first.budget().reserved, original.amount);
  await first.inventory({ confirmed: true }); const reserved = first.budget().reserved;
  values.clear();
  const second = await connect(); assert.equal(second.budget().reserved, reserved);
  const otherDevice = plan(config); await store.reserve(otherDevice);
  assert.equal((await second.refreshBudget()).reserved, (await store.status()).reserved);
  assert.equal(second.state().phase, 'ready');
  assert.ok([...values.keys()].every(key => key.startsWith('rk:resume:assessment-server-history:')));
  await assert.rejects(createAssessmentBudgetClient({ budget, request: async () => { throw new Error('Central service offline'); } }), /offline/);
});
