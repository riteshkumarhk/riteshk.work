import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { assertAssessmentCurrent, createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { assessmentProviderReceipt, createAssessmentPilot } from './src/js/resume-assessment-pilot.mjs';
import { resumeCompletionReservation } from './src/js/resume-review.mjs';
import { AI_TEXT_REQUEST_ATTEMPTS } from './src/js/ai-request-limits.mjs';
import { assessmentRequestPolicy } from './src/js/resume-assessment-request-policy.mjs';
import { createAiOrchestrator } from './src/js/ai-orchestrator.mjs';
import { normalizeAiModel } from './src/js/ai-model-router.mjs';

const source = readFileSync(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
const chatSource = source.slice(source.indexOf('  const aiNoTemperature = new Set();'), source.indexOf('  // Streaming variant of aiChatOnce'));
const bridgeSource = source.slice(source.indexOf('  async function resumeAiConfiguration()'), source.lastIndexOf('})();'));
test('Candidate recommendations use the existing task router within the selected API and approved model policy, not a fixed model name', async () => {
  for (const provider of ['anthropic', 'openai']) {
    const now = Date.now(), scope = JSON.stringify([provider, 'https://fixture.invalid']);
    const cfg = { provider, base: 'https://fixture.invalid', key: 'scripted-metadata-only' };
    const models = ['established-model', 'newly-available-model', 'unapproved-model'].map((id, index) => normalizeAiModel(provider, {
      id, created_at: new Date(now - 100000 + index * 1000).toISOString(), max_input_tokens: 128000, max_tokens: 12000,
      output_modalities: ['text'], context_window: 140000, pricing: { input: 1, output: 2 },
      capabilities: { thinking: { supported: true }, structured_outputs: { supported: true } },
    }));
    const state = { policy: { maxCost: null, useReference: false }, observations: [],
      incumbents: { [JSON.stringify([scope, 'analysis'])]: models[0].id } };
    const catalog = { version: 1, scope: 'server', id: 'candidate-review', provider, checkedAt: now, ceiling: 10, reserved: 0,
      models: models.slice(0, 2).map(model => ({ id: model.id, pricing: model.pricing, reasoning: true, structuredOutput: true,
        maxInputTokens: 128000, maxOutputTokens: 12000, contextWindow: 140000 })) };
    const router = createAiOrchestrator({ catalog: { discover: async () => ({ scope, models }) },
      store: { read: async () => state, update: () => { throw new Error('Recommendation must not mutate routing or invoke an evaluation.'); } }, now: () => now });
    const window = { __RKStudio: {} };
    runInNewContext(bridgeSource, { window, location: { hostname: '127.0.0.1' }, root: { classList: { contains: () => true } },
      aiCfg: () => cfg, aiOrchestrator: router, assessmentRequestPolicy, resumeCompletionReservation, adminSession: () => 'scripted-owner',
      ADMIN_WORKER: 'https://fixture.invalid', AbortSignal,
      fetch: async url => { assert.equal(url, 'https://fixture.invalid/admin/resume/assessment/budget'); return Response.json(catalog); } });
    const first = await window.__RKStudio.resumeAI.assessmentModels({ evidencePolicy: 'decision-context-v1' });
    assert.equal(first.recommendation.modelId, models[0].id);
    assert.equal(first.recommendation.confidence, 'provisional');
    assert.ok(!first.models.some(model => model.id === 'unapproved-model'));
    state.observations.push(...Array.from({ length: 3 }, () => ({
      provider, modelId: 'unapproved-model', scope, task: 'analysis', at: now, quality: 1, samples: 3, source: 'evaluation',
    })));
    assert.equal((await window.__RKStudio.resumeAI.assessmentModels()).recommendation.modelId, 'established-model',
      'An ineligible high-quality challenger cannot displace the eligible incumbent indirectly.');
    state.observations.push(...models.slice(0, 2).flatMap((model, index) => Array.from({ length: 3 }, () => ({
      provider, modelId: model.id, scope, task: 'analysis', at: now, quality: index ? 1 : 0.1, samples: 3, source: 'evaluation',
    }))));
    const second = await window.__RKStudio.resumeAI.assessmentModels({ evidencePolicy: 'decision-context-v1' });
    assert.equal(second.recommendation.modelId, 'newly-available-model');
    catalog.models[1].pricing = { input: 99, output: 99 };
    assert.equal((await window.__RKStudio.resumeAI.assessmentModels()).recommendation.modelId, 'established-model');
    catalog.approved = true; catalog.remaining = 0.01;
    await assert.rejects(window.__RKStudio.resumeAI.assessmentModels(), /remaining server budget/);
    const maximum = [['requirements', 8000], ['assessment', 12000], ['challenge', 12000]].reduce((sum, [stage, maxTokens]) =>
      sum + Math.round(resumeCompletionReservation({ stage, maxTokens, system: '', user: '' }, { ...catalog.models[0].pricing, checkedAt: now }).maximumAmount * 1e6), 0);
    catalog.remaining = maximum / 1e6;
    assert.equal((await window.__RKStudio.resumeAI.assessmentModels()).recommendation.modelId, 'established-model');
    catalog.remaining -= 0.000001;
    await assert.rejects(window.__RKStudio.resumeAI.assessmentModels(), /remaining server budget/);
    assert.equal((await window.__RKStudio.resumeAI.assessmentModels({ inventory: false })).recommendation.modelId, 'established-model');
    catalog.remaining = 10;
    catalog.models[0].structuredOutput = false;
    await assert.rejects(window.__RKStudio.resumeAI.assessmentModels({ evidencePolicy: 'decision-context-v1' }), /No currently available model/);
    cfg.provider = provider === 'anthropic' ? 'openai' : 'anthropic';
    await assert.rejects(window.__RKStudio.resumeAI.assessmentModels(), /different provider/);
    assert.equal(state.observations.length, 9);
  }
});
const outputs = {
  requirements: { revision: 1, segments: [{ id: 'jd-0', disposition: 'criteria', reason: 'Explicit criterion.' }],
    requirements: [{ id: 'req-python', label: 'Python', importance: 'required', condition: { kind: 'atom', id: 'python', segmentId: 'jd-0', quote: 'Python' } }] },
  assessment: { ratings: [{ id: 'python', state: 'supported', reason: 'Documented contribution.', evidence: ['artifact-1'] }],
    communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 3, reason: 'Synthetic judgment only.', evidence: ['artifact-1'] })) },
  challenge: { ratings: [{ id: 'python', verdict: 'agree', reason: 'Synthetic challenge only.', evidence: ['artifact-1'] }],
    communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, verdict: 'agree', reason: 'Synthetic challenge only.', evidence: ['artifact-1'] })), inventoryIssues: [] }
};
async function snapshot(text = 'Fictional Person\nUsed Python to build reports.') {
  return createAssessmentSnapshot({ artifact: { bytes: new TextEncoder().encode(text), text, mediaType: 'text/plain', extractorVersion: 'offline-pilot-test-v1' },
    target: { company: 'Example', role: 'Engineer', level: 'senior', jd: 'Python' } });
}
function durable() {
  const values = new Map(), queues = new Map();
  return {
    values,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    locks: { request(key, action) { const result = (queues.get(key) || Promise.resolve()).then(action); queues.set(key, result.catch(() => {})); return result; } }
  };
}
function rawResponse(provider, model, answer, id = 'response-1') {
  return provider === 'anthropic'
    ? { id, model, type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: answer }], usage: { input_tokens: 100, output_tokens: 200 } }
    : { id, model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer } }], usage: { prompt_tokens: 100, completion_tokens: 200 } };
}
async function harness({ provider = 'anthropic', reasoning = false, shared = durable(), maximum = 2 } = {}) {
  const original = await snapshot(), calls = [], usage = [];
  const model = { id: 'synthetic-fixed-model', output: ['text'], maxOutputTokens: 12000, maxInputTokens: 128000, contextWindow: 140000, reasoning, pricing: { input: 1, output: 2 } };
  const pricing = { ...model.pricing, checkedAt: Date.now() };
  const config = { provider, key: 'synthetic-not-a-credential', base: 'https://example.test' };
  const control = { current: original, open: true, hostname: '127.0.0.1', reply: null };
  const chat = runInNewContext(chatSource + '\naiChatOnce', {
    AI_TEXT_REQUEST_ATTEMPTS,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body), system = body.system || body.messages[0].content;
      const stage = system.includes('Inventory the job BEFORE') ? 'requirements' : system.includes('Independently challenge') ? 'challenge' : 'assessment';
      calls.push({ url, options, body, stage });
      const payload = rawResponse(provider, model.id, JSON.stringify(outputs[stage]), 'response-' + calls.length);
      if (control.reply) return control.reply(payload, stage);
      return new Response(JSON.stringify(payload), { headers: { 'x-request-id': 'request-' + calls.length } });
    },
    aiPromptContent: (_, value) => value, assessmentProviderReceipt,
    aiUsageRecord: (...value) => usage.push(value), aiUsageFromJson: () => ({ in: 100, out: 200 }),
    aiStream: () => { throw new Error('Streaming was not approved.'); }
  });
  const window = { __RKStudio: {} };
  runInNewContext(bridgeSource, { window, location: { get hostname() { return control.hostname; } },
    root: { classList: { contains: () => control.open } }, aiCfg: () => ({ ...config }),
    aiCatalog: { discover: async () => ({ models: [model], updatedAt: pricing.checkedAt }) },
    localStorage: shared.storage, navigator: { locks: shared.locks }, createAssessmentPilot, assertAssessmentCurrent, resumeCompletionReservation, structuredClone, aiChatOnce: chat });
  const input = { snapshot: original, getCurrent: () => control.current, provider, model: model.id, pricing,
    budget: { approved: true, scope: 'browser-origin', id: 'offline-pilot', maxCost: maximum } };
  return { connect: overrides => window.__RKStudio.resumeAI.connectAssessment({ ...input, ...overrides }), input, original, calls, usage, shared, control, config, chat, model };
}
async function ready(pilot) {
  await pilot.inventory({ confirmed: true });
  await pilot.approveInventory({ confirmed: true });
  await pilot.approveEvidence({ confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }] });
}

test('Sonnet 5.5 cannot use the incompatible browser-development transport or silently fall back to it', async () => {
  const original = await snapshot(), shared = durable();
  let calls = 0;
  await assert.rejects(createAssessmentPilot({ snapshot: original, getCurrent: () => original, provider: 'anthropic', model: 'claude-sonnet-5-5',
    pricing: { input: 2, output: 10, checkedAt: Date.now() }, budget: { approved: true, scope: 'browser-origin', id: 'offline-pilot', maxCost: 4 },
    ...shared, invoke: async () => { calls++; } }), /server request policy/);
  assert.equal(calls, 0); assert.equal(shared.values.size, 0);
});
test('Local Studio pilot runs the actual Anthropic request path, pauses for consent and restores full receipts', async () => {
  const setup = await harness(), pilot = await setup.connect();
  assert.equal(setup.calls.length, 0);
  await assert.rejects(pilot.inventory(), /approve sending/);
  await assert.rejects(pilot.evaluate({ confirmed: true }), /approve.*inventory/);
  await pilot.inventory({ confirmed: true });
  assert.equal(setup.calls.length, 1); assert.equal(pilot.state().phase, 'inventory-review');
  assert.doesNotMatch(setup.calls[0].body.messages[0].content, /Fictional Person|Used Python/);
  await assert.rejects(pilot.approveInventory(), /explicit approval/);
  await pilot.approveInventory({ confirmed: true });
  await assert.rejects(pilot.approveEvidence(), /review included evidence/);
  await pilot.approveEvidence({ confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }] });
  await assert.rejects(pilot.evaluate(), /approve sending/);
  const result = await pilot.evaluate({ confirmed: true });
  assert.equal(setup.calls.length, 3);
  assert.equal(setup.calls[0].body.max_tokens, 8000);
  for (const call of setup.calls.slice(1)) {
    assert.equal(call.body.max_tokens, 12000); assert.equal(call.body.model, setup.model.id);
    assert.doesNotMatch(call.body.messages[0].content, /Fictional Person/);
    assert.match(call.body.messages[0].content, /Used Python/);
  }
  assert.equal(result.report.headline.value, null); assert.equal(result.execution[0].requestId, 'request-2');
  assert.deepEqual(result.execution[0].usage, { inputTokens: 100, outputTokens: 200 });
  assert.equal(setup.usage.length, 3);
  const saved = JSON.parse([...setup.shared.values.values()][0]);
  assert.equal(saved.reservations.length, 2); assert.equal(saved.reservations[1].stages.length, 2);
  assert.equal(saved.inventories[0].execution[0].requestId, 'request-1');
  assert.deepEqual(saved.results[0], result);
  const resumed = await setup.connect();
  assert.deepEqual(await resumed.restore(result.report.id), result); assert.equal(resumed.state().phase, 'historical');
  assert.equal(setup.calls.length, 3); assert.equal(resumed.history().length, 1);
  assert.equal(resumed.budget().reserved, pilot.budget().reserved);
});

test('Local Studio pilot uses the real OpenAI reasoning cap and keeps actual model identity', async () => {
  const setup = await harness({ provider: 'openai', reasoning: true }), pilot = await setup.connect();
  await ready(pilot); await pilot.evaluate({ confirmed: true });
  for (const call of setup.calls) {
    assert.ok(call.url.endsWith('/chat/completions'));
    assert.equal(call.body.max_tokens, undefined); assert.equal(call.body.temperature, undefined);
    assert.equal(call.body.max_completion_tokens, call.stage === 'requirements' ? 8000 : 12000);
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
  }
  setup.control.reply = payload => new Response(JSON.stringify({ ...payload, model: 'unexpected-alias-resolution' }));
  await assert.rejects(pilot.inventory({ confirmed: true }), /actual provider\/model differs/);
  assert.equal(setup.calls.length, 4);
});

test('Pilot shares exact whole-phase reservations across concurrent connections and reloads', async () => {
  const setup = await harness({ maximum: 0.2 }), first = await setup.connect(), second = await setup.connect();
  const results = await Promise.allSettled([first.inventory({ confirmed: true }), second.inventory({ confirmed: true })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(setup.calls.length, 1);
  const winner = results[0].status === 'fulfilled' ? first : second;
  await winner.approveInventory({ confirmed: true }); await winner.approveEvidence({ confirmed: true });
  await assert.rejects(winner.evaluate({ confirmed: true }), /budget is exhausted/);
  assert.equal(setup.calls.length, 1);
  const reloaded = await setup.connect();
  assert.equal(reloaded.budget().reserved, first.budget().reserved);
  await assert.rejects(setup.connect({ budget: { ...setup.input.budget, maxCost: 5 } }), /saved budget needs review/);
});

test('Pilot rejects unapproved, remote, closed or changed Studio connections before sending', async () => {
  const setup = await harness();
  await assert.rejects(setup.connect({ budget: { ...setup.input.budget, approved: false } }), /approval/);
  setup.control.hostname = 'riteshk.work';
  await assert.rejects(setup.connect(), /only.*local Studio/);
  setup.control.hostname = 'localhost';
  await assert.rejects(setup.connect({ pricing: { ...setup.input.pricing, checkedAt: Date.now() + 1 } }), /current catalog pricing/);
  await assert.rejects(setup.connect({ provider: 'openai' }), /locked provider/);
  const pilot = await setup.connect();
  setup.control.open = false;
  await assert.rejects(pilot.inventory({ confirmed: true }), /open local Studio/);
  setup.control.open = true; setup.config.key = 'changed-synthetic-session';
  await assert.rejects(pilot.inventory({ confirmed: true }), /connection changed/);
  assert.equal(setup.calls.length, 0);
});

test('Pilot retains failed reservations and never retries a real-helper temperature rejection', async () => {
  const setup = await harness(), pilot = await setup.connect();
  setup.control.reply = () => new Response(JSON.stringify({ error: { message: 'temperature is unsupported' } }), { status: 400 });
  await assert.rejects(pilot.inventory({ confirmed: true }), /temperature is unsupported/);
  assert.equal(setup.calls.length, 1);
  const saved = JSON.parse([...setup.shared.values.values()][0]);
  assert.equal(saved.reservations.length, 1); assert.equal(saved.failures.length, 1);
  assert.equal(saved.failures[0].attempt.execution[0].status, 'failed'); assert.equal(pilot.state().phase, 'failed');
});

test('Pilot blocks storage failures and altered budgets before invoking a provider', async () => {
  const setup = await harness(), pilot = await setup.connect();
  const original = setup.shared.storage.setItem;
  setup.shared.storage.setItem = () => { throw new Error('Synthetic storage quota'); };
  await assert.rejects(pilot.inventory({ confirmed: true }), /could not be saved/);
  assert.equal(setup.calls.length, 0);
  setup.shared.storage.setItem = original;
  await pilot.inventory({ confirmed: true });
  const [key, value] = [...setup.shared.values][0], saved = JSON.parse(value);
  saved.reservations[0].amount = 0.000001; setup.shared.values.set(key, JSON.stringify(saved));
  await assert.rejects(pilot.inventory({ confirmed: true }), /could not be saved/);
  assert.equal(setup.calls.length, 1);
  setup.shared.values.delete(key);
  await assert.rejects(pilot.inventory({ confirmed: true }), /could not be saved/);
  assert.equal(setup.calls.length, 1);
});

test('Pilot rejects tampered saved reports and stale original inputs without changing documents', async () => {
  const setup = await harness(), pilot = await setup.connect();
  await ready(pilot); const result = await pilot.evaluate({ confirmed: true });
  const [key, value] = [...setup.shared.values][0], saved = JSON.parse(value);
  saved.results[0].report.headline.value = 99; setup.shared.values.set(key, JSON.stringify(saved));
  await assert.rejects(pilot.restore(result.report.id), /does not match/);
  setup.shared.values.set(key, value);
  setup.control.current = await snapshot('Changed evidence.');
  await assert.rejects(pilot.restore(result.report.id), /changed/);
  await assert.rejects(pilot.inventory({ confirmed: true }), /changed/);
  assert.equal(setup.calls.length, 3);
  assert.equal(setup.original.evidence[0].text, 'Fictional Person');
});

test('Pilot cancellation settles a hung provider and preserves the unknown spent attempt', async () => {
  const setup = await harness(), pilot = await setup.connect();
  let started; const sent = new Promise(resolve => { started = resolve; });
  setup.control.reply = () => { started(); return new Promise(() => {}); };
  const pending = pilot.inventory({ confirmed: true });
  await sent; pilot.cancel();
  await assert.rejects(pending, /cancelled/);
  assert.equal(pilot.state().phase, 'cancelled'); assert.equal(setup.calls.length, 1);
  const saved = JSON.parse([...setup.shared.values.values()][0]);
  assert.equal(saved.failures[0].attempt.execution[0].status, 'cancelled-outcome-unknown');
  assert.ok(pilot.budget().reserved > 0);
});

test('Pilot serializes actions and cancels even a hung current-input getter', async () => {
  const setup = await harness(), pilot = await setup.connect();
  setup.control.current = new Promise(() => {});
  const pending = pilot.inventory({ confirmed: true });
  await assert.rejects(pilot.inventory({ confirmed: true }), /still running/);
  pilot.cancel(); await assert.rejects(pending, /cancelled/);
  assert.equal(setup.calls.length, 0);
});

test('Provider receipts reject incomplete, refused, missing-identity and malformed usage responses', () => {
  const response = new Response('{}');
  for (const provider of ['openai', 'anthropic']) {
    const valid = rawResponse(provider, 'actual-model', '{}');
    assert.equal(assessmentProviderReceipt(provider, valid, response).requestId, valid.id);
    const unknown = structuredClone(valid); delete unknown.usage;
    assert.equal(assessmentProviderReceipt(provider, unknown, response).usage, null);
    for (const mutate of [
      value => { delete value.model; }, value => { delete value.id; }, value => { value.usage = {}; },
      value => { if (provider === 'openai') value.choices[0].finish_reason = 'length'; else value.stop_reason = 'max_tokens'; },
      value => { if (provider === 'openai') value.choices[0].message.refusal = 'No'; else value.stop_reason = 'refusal'; },
      value => { if (provider === 'openai') value.choices[0].message.content = ''; else value.content[0].text = ''; }
    ]) { const invalid = structuredClone(valid); mutate(invalid); assert.throws(() => assessmentProviderReceipt(provider, invalid, response)); }
  }
  const cached = rawResponse('anthropic', 'actual-model', '{}');
  cached.usage.cache_read_input_tokens = 20; cached.usage.cache_creation_input_tokens = 30;
  assert.deepEqual(assessmentProviderReceipt('anthropic', cached, response).usage, { inputTokens: 150, outputTokens: 200 });
  cached.usage.cache_read_input_tokens = '20';
  assert.throws(() => assessmentProviderReceipt('anthropic', cached, response), /invalid provider token/);
});

test('Candidate receipt mode cannot stream or retry while existing text-only helpers remain unchanged', async () => {
  const setup = await harness({ provider: 'openai' });
  const options = { maxTokens: 12000, singleAttempt: true, assessmentReceipt: true };
  await assert.rejects(setup.chat(setup.config, setup.model.id, 'system', '{}', { ...options, singleAttempt: false }), /one bounded/);
  await assert.rejects(setup.chat(setup.config, setup.model.id, 'system', '{}', { ...options, onOutput() {} }), /one bounded/);
  assert.equal(setup.calls.length, 0);
  const result = await setup.chat(setup.config, setup.model.id, 'system', '{}', { maxTokens: 4000 });
  assert.equal(result.ok, true); assert.equal(typeof result.text, 'string'); assert.equal(result.receipt, undefined);
});

test('Pilot retains received request metadata when saving the completed provider receipt fails', async () => {
  const setup = await harness(), pilot = await setup.connect();
  setup.control.reply = payload => {
    setup.shared.storage.setItem = () => { throw new Error('Synthetic quota after provider success'); };
    return new Response(JSON.stringify(payload), { headers: { 'request-id': 'received-but-unsaved' } });
  };
  await assert.rejects(pilot.inventory({ confirmed: true }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0].assessmentAttempt.execution[0].requestId, 'received-but-unsaved');
    assert.match(error.errors[0].cause.message, /quota after provider success/);
    return true;
  });
  assert.equal(setup.calls.length, 1); assert.equal(pilot.state().phase, 'failed');
  assert.ok(pilot.budget().reserved > 0);
});

test('Pilot rejects unknown or insufficient model capacity and freezes catalog metadata at connection', async () => {
  const setup = await harness();
  delete setup.model.maxInputTokens; delete setup.model.contextWindow;
  await assert.rejects(setup.connect(), /known input\/context capacity/);
  setup.model.contextWindow = 12001;
  const tooSmall = await setup.connect();
  setup.model.contextWindow = 140000;
  await assert.rejects(tooSmall.inventory({ confirmed: true }), /advertised capacity/);
  assert.equal(setup.calls.length, 0);
  const connected = await setup.connect();
  setup.model.contextWindow = 12001; setup.model.reasoning = true;
  await connected.inventory({ confirmed: true });
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].body.temperature, 0);
});

test('Pilot requires writable locked storage, fresh pricing and valid explicit budget parameters', async () => {
  const original = await snapshot(), shared = durable();
  const base = { snapshot: original, getCurrent: () => original, invoke: () => { throw new Error('No provider allowed'); },
    provider: 'openai', model: 'fixed-test-model', pricing: { input: 1, output: 2, checkedAt: Date.now() },
    ...shared, budget: { id: 'guard-test', maxCost: 1, scope: 'browser-origin', approved: true } };
  for (const override of [
    { locks: null }, { storage: null }, { provider: 'gemini' }, { model: 'automatic' },
    { timeoutMs: 0 }, { budget: { ...base.budget, maxCost: NaN } }, { budget: { ...base.budget, maxCost: 0.0000001 } },
    { pricing: { ...base.pricing, checkedAt: Date.now() - 86400001 } }
  ]) await assert.rejects(createAssessmentPilot({ ...base, ...override }));
  const dropping = { getItem: () => null, setItem() {} };
  await assert.rejects(createAssessmentPilot({ ...base, storage: dropping }), /durably acknowledged/);
  assert.equal(shared.values.size, 0);
});
