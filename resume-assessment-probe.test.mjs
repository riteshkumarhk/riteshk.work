import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { createAssessmentProbe, PROBE_KEY, PROBE_PHASES, probePolicy, CONTINUATION_KEY, CONTINUATION_CLAIM_KEY, CONTINUATION_PHASES, SMOKE_KEY, SMOKE_CLAIM_KEY, SMOKE_PHASES, STRUCTURED_SMOKE_KEY, STRUCTURED_SMOKE_CLAIM_KEY } from './tools/resume-assessment-probe.mjs';
import { renderProbeExport, runProbeCommand } from './tools/resume-assessment-probe-cli.mjs';
import { resumeSignature } from './src/js/resume-workspace.mjs';
import { assessmentBudgetRoute } from './worker/resume-assessment-budget.mjs';
import { createAssessmentHistoryStore } from './worker/resume-assessment-history.mjs';
import { startPreview } from './tools/resume-preview.mjs';
import { studioProbeClient, validateStudioProbeBody, STUDIO_ORIGIN } from './tools/resume-assessment-studio-bridge.mjs';

const renders = new Map();
async function render(document, version) {
  const key = resumeSignature(document) + ':' + version;
  if (!renders.has(key)) renders.set(key, renderProbeExport(document, version));
  return { ...structuredClone(await renders.get(key)), document: structuredClone(document) };
}
const after = 'Built Python prototypes with the team to clarify customer handoffs.';
function wireValue(schema, value, root = schema) {
  if (schema.properties?.issue) return { segmentId: schema.properties.segmentId.const, issue: value !== null, reason: value?.reason ?? '' };
  if (schema.$ref) return wireValue(root.$defs[schema.$ref.split('/').at(-1)], value, root);
  if (schema.anyOf) {
    const branch = schema.anyOf.find(item => value === null ? item.type === 'null'
      : item.properties?.kind ? item.properties.kind.const === value.kind || item.properties.kind.enum?.includes(value.kind) : item.type === 'object');
    assert.ok(branch, 'fixture union branch');
    return wireValue(branch, value, root);
  }
  if (schema.type === 'array') return value.map(item => wireValue(schema.items, item, root));
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [
    key, wireValue(child, Array.isArray(value) ? value.find(item => (item.id ?? item.segmentId) === key) ?? null : value[key], root),
  ]));
  return value;
}
function providerAnswer(stage, data) {
  const reviews = values => values.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted offline challenge.', ...(item.evidence ? { evidence: item.evidence } : {}) }));
  if (stage === 'requirements') {
    const atom = name => ({ kind: 'atom', id: name.toLowerCase(), segmentId: 'jd-0', quote: name });
    return { revision: 1, segments: data.segments.map(item => ({ id: item.id, disposition: 'criteria', reason: 'Scripted criterion.' })),
      requirements: [{ id: data.segments[0].text === 'Python' ? 'python' : 'tools', label: data.segments[0].text, importance: 'required',
        condition: data.segments[0].text === 'Python' ? atom('Python') : { kind: 'anyOf', children: [atom('Python'), atom('Java')] } }] };
  }
  if (stage === 'revision') return { kind: 'revision', after, reason: 'Scripted clarification, not a real quality judgment.',
    claims: [{ id: 'claim-1', quote: after, evidence: [{ id: data.evidence.find(item => item.text.includes('With the team, built Python')).id, quote: data.field.before }] }] };
  if (data.field) return { verdict: 'agree', reason: 'Scripted complete preservation check.',
    claims: (data.draft.claims ?? []).map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted claim check.' })) };
  if (stage === 'challenge') return { ratings: reviews(data.draft.ratings), communication: reviews(data.draft.communication), inventoryIssues: [],
    semantic: { version: 'source-attribution-v1', excerpts: reviews(data.evidence), groups: reviews(data.draft.semantic.groups), segments: reviews(data.segments) } };
  const negation = data.evidence.some(item => item.text.includes('No experience')), revised = data.evidence.some(item => item.text.includes(after));
  const ref = quote => ({ id: data.evidence.find(item => item.text.includes(quote)).id, quote });
  const groups = negation ? [] : [
    { id: 'north', role: ref('Lead Designer'), employer: ref('Northstar Example'), dates: ref('2021 - Present'),
      achievements: [ref(revised ? after : 'With the team, built Python prototypes to clarify customer handoffs.')], certainty: 'explicit', reason: 'Scripted source group.' },
    { id: 'atlas', role: ref('Designer'), employer: ref('Atlas Example'), dates: ref('2018 - 2021'),
      achievements: [ref('Supported customer interviews and documented usability findings.')], certainty: 'explicit', reason: 'Scripted source group.' },
  ];
  // The second role needs its exact excerpt, not the title or first employer's role.
  if (!negation) groups[1].role = { id: data.evidence.find(item => item.text.trim() === 'Designer').id, quote: 'Designer' };
  const assigned = groups.flatMap(group => [group.role, group.employer, group.dates, ...group.achievements].map(item => item.id));
  const evidence = negation ? [ref('No experience with Python.').id] : [groups[0].achievements[0].id];
  return { ratings: [
    { id: 'python', state: negation ? 'contradicted' : revised ? 'supported' : 'mentioned', reason: 'Scripted fixture judgment.', evidence },
    ...(!negation ? [{ id: 'java', state: 'not-evidenced', reason: 'Scripted absence.', evidence: [] }] : []),
  ], communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: revised ? 3 : 2, reason: 'Scripted fixture judgment.', evidence })),
  semantic: { version: 'source-attribution-v1', excerpts: data.evidence.map(item => ({ id: item.id, kind: assigned.includes(item.id) ? 'experience' : 'general', reason: 'Scripted classification.' })), groups } };
}
async function fixture(persistence = {}) {
  const options = { modules: true, script: 'export default {fetch(){return new Response("offline")}}', r2Buckets: ['PROBE'], ...persistence };
  const runtime = new Miniflare(options), bucket = await runtime.getR2Bucket('PROBE'), calls = [];
  const control = { reject: false };
  const request = async (action, body, checkedAt, signal, retainResponse) => {
    const pending = assessmentBudgetRoute(new Request('https://offline.invalid/admin/resume/assessment/' + action, {
      method: 'POST', body: JSON.stringify(body), signal,
    }), { VAULT: bucket, RESUME_ASSESSMENT_POLICY: JSON.stringify(probePolicy(checkedAt, !!(await bucket.get(SMOKE_CLAIM_KEY)))) }, {}, async () => 'scripted-not-a-key',
    async (url, options) => {
      const payload = JSON.parse(options.body), data = JSON.parse(payload.messages[0].content);
      validateStudioProbeBody(payload);
      calls.push({ stage: body.stage, data, payload });
      assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(payload.temperature, undefined);
      if (control.hang) { control.onCall(); return new Promise(() => {}); }
      if (control.reject) return Response.json({ error: 'Scripted provider failure' }, { status: 400 });
      const domain = body.stage === 'revision' && control.question
        ? { kind: 'question', question: 'What was your exact contribution?', reason: 'Scripted stop without an edit.' }
        : body.stage === 'revision' && control.noChange ? { kind: 'supported', reason: 'Scripted no-change.',
          evidence: [{ id: data.evidence.find(item => item.text.includes(data.field.before)).id, quote: data.field.before }] }
        : providerAnswer(body.stage, data);
      const schema = payload.output_config.format?.schema, answer = schema ? wireValue(schema, domain) : domain;
      return Response.json({ id: 'offline-' + calls.length, model: 'claude-sonnet-5-5', type: 'message', role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: control.responseText ? control.responseText(body.stage, answer) : JSON.stringify(answer) }], usage: { input_tokens: 100, output_tokens: 200 } });
    }, { retainResponse });
    control.pending = pending;
    const response = await pending;
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    if (action === 'execute' && control.removeContract) delete value.receipt.responseContract;
    return value;
  };
  const make = (storage, continuation = false, smoke = false, structured = false) => createAssessmentProbe({ bucket: storage, renderExport: render, request, continuation, smoke, structured, codeSha256: '1'.repeat(64) });
  return { runtime, options, bucket, calls, control, request, make, probe: make(bucket), pricesCheckedAt: Date.now() };
}
async function runNext(value, extra = {}) {
  const options = { pricesCheckedAt: value.pricesCheckedAt, ...extra };
  const review = await value.probe.review(options);
  return value.probe.run({ ...options, approvalSha256: review.approvalSha256, allowProvider: true, preflight: async () => {} });
}
async function stoppedParent(value) {
  await value.probe.prepare(); await runNext(value);
  value.control.responseText = (stage, answer) => {
    if (stage === 'challenge') answer.semantic.excerpts[0].extra = 'Synthetic invalid field';
    return JSON.stringify(answer);
  };
  await assert.rejects(runNext(value), /Semantic review: invalid record fields/);
  delete value.control.responseText;
  return (await value.bucket.get(PROBE_KEY)).text();
}
async function stoppedWorkflows(value) {
  await stoppedParent(value);
  await registerContinuation(value);
  value.probe = value.make(value.bucket, true);
  value.control.responseText = (stage, answer) => {
    if (stage === 'challenge') delete answer.semantic.version;
    return JSON.stringify(answer);
  };
  await assert.rejects(runNext(value, { transport: 'studio' }), /challenge.semantic/);
  delete value.control.responseText;
  return { parent: await (await value.bucket.get(PROBE_KEY)).text(), child: await (await value.bucket.get(CONTINUATION_KEY)).text(),
    budget: await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json() };
}
async function registeredSmoke(value) {
  const originals = await stoppedWorkflows(value);
  const review = await value.probe.reviewSmoke({ pricesCheckedAt: value.pricesCheckedAt });
  await value.probe.registerSmoke({ ...review, confirmed: true, pricesCheckedAt: value.pricesCheckedAt });
  value.probe = value.make(value.bucket, false, true);
  return { originals, review, run: signal => value.probe.runSmoke({ approvalSha256: review.approvalSha256, allowProvider: true,
    pricesCheckedAt: value.pricesCheckedAt, preflight: async () => {}, signal }) };
}
async function stoppedSmokes(value) {
  const legacy = await registeredSmoke(value);
  value.control.responseText = (stage, answer) => {
    if (stage === 'challenge') answer.semantic.groups.push({ id: 'job-0', verdict: 'agree', reason: 'Scripted invented group.' });
    return JSON.stringify(answer);
  };
  await assert.rejects(legacy.run(), /list exceeds the semantic review contract/);
  delete value.control.responseText;
  return { ...legacy.originals, smoke: await (await value.bucket.get(SMOKE_KEY)).text(),
    budget: await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json() };
}
async function registeredStructured(value) {
  const originals = await stoppedSmokes(value);
  const review = await value.probe.reviewStructured({ pricesCheckedAt: value.pricesCheckedAt });
  await value.probe.registerStructured({ ...review, confirmed: true, pricesCheckedAt: value.pricesCheckedAt });
  value.probe = value.make(value.bucket, false, false, true);
  return { originals, review, run: signal => value.probe.runSmoke({ approvalSha256: review.approvalSha256, allowProvider: true,
    pricesCheckedAt: value.pricesCheckedAt, preflight: async () => {}, signal }) };
}
test('Structured smoke completes exactly sixteen cumulative calls and preserves three stopped workflows and the unchanged six-dollar ledger prefix', async () => {
  const value = await fixture();
  try {
    const smoke = await registeredStructured(value);
    assert.equal(value.calls.length, 7);
    assert.deepEqual(await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json(), smoke.originals.budget);
    const result = await smoke.run();
    assert.deepEqual(result.operations.map(item => item.phase), SMOKE_PHASES);
    assert.deepEqual(result.spending, { maxCost: 6, reserved: 5.808013, attempts: 16, initialized: true });
    assert.equal(value.calls.length, 16); assert.equal(result.documentVersion, 3);
    assert.equal(result.operations.at(-1).output.comparison.comparable, true);
    assert.ok(value.calls.slice(0, 7).every(item => !item.payload.output_config.format));
    assert.ok(value.calls.slice(7).every(item => item.payload.output_config.format.type === 'json_schema'));
    for (const [key, original] of [[PROBE_KEY, 'parent'], [CONTINUATION_KEY, 'child'], [SMOKE_KEY, 'smoke']]) {
      assert.equal(await (await value.bucket.get(key)).text(), smoke.originals[original]);
    }
    const ledger = await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json();
    assert.deepEqual({ ...ledger, reservations: ledger.reservations.slice(0, 4) }, smoke.originals.budget);
    assert.ok(ledger.reservations.slice(4).every(item => item.attempts.every(attempt => smoke.review.packet.responseContracts.includes(attempt.responseContract))));
    for (const selected of [value.make(value.bucket), value.make(value.bucket, true), value.make(value.bucket, false, true)]) assert.equal((await selected.status()).stopped, true);
    assert.equal((await value.make(value.bucket, false, false, true).status()).next, null);
    assert.equal((await smoke.run()).next, null); assert.equal(value.calls.length, 16);
    await assert.rejects(value.probe.reviewStructured({ pricesCheckedAt: value.pricesCheckedAt }), /already registered/);
  } finally { await value.runtime.dispose(); }
});
test('Structured smoke rejects changed approval, code, contract, source and prior ledger before dispatch and forbids arbitrary phase execution', async () => {
  const value = await fixture();
  try {
    const originals = await stoppedSmokes(value), review = await value.probe.reviewStructured({ pricesCheckedAt: value.pricesCheckedAt });
    assert.equal(review.packet.additionalCalls, 9); assert.equal(review.packet.additionalReserved, 3.234007);
    await assert.rejects(value.probe.registerStructured({ ...review, pricesCheckedAt: value.pricesCheckedAt }), /explicit approval/);
    await assert.rejects(value.probe.registerStructured({ confirmed: true, approvalSha256: 'f'.repeat(64), pricesCheckedAt: value.pricesCheckedAt }), /approval changed/);
    await value.probe.registerStructured({ ...review, confirmed: true, pricesCheckedAt: value.pricesCheckedAt });
    value.probe = value.make(value.bucket, false, false, true);
    await assert.rejects(runNext(value, { transport: 'studio' }), /fixed workflow guards/);
    const changedCode = createAssessmentProbe({ bucket: value.bucket, renderExport: render, request: value.request, structured: true, codeSha256: '2'.repeat(64) });
    await assert.rejects(changedCode.runSmoke({ ...review, allowProvider: true, pricesCheckedAt: value.pricesCheckedAt, preflight: async () => assert.fail('Changed code reached preflight') }), /code changed/);
    for (const [key, change] of [
      [STRUCTURED_SMOKE_CLAIM_KEY, entry => { entry.packet.responseContracts[0] = 'assessment-json-v1'; }],
      [STRUCTURED_SMOKE_KEY, entry => { entry.inputs.negation.fingerprint = 'f'.repeat(64); }],
      ['system/resume-assessment-budget-v1.json', entry => { entry.reservations[3].attempts[0].requestId = 'changed'; }],
    ]) {
      const original = await (await value.bucket.get(key)).text(), altered = JSON.parse(original); change(altered);
      await value.bucket.put(key, JSON.stringify(altered));
      await assert.rejects(value.probe.status());
      await value.bucket.put(key, original);
    }
    assert.deepEqual(await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json(), originals.budget);
    assert.equal(value.calls.length, 7);
  } finally { await value.runtime.dispose(); }
});
for (const outcome of ['question', 'no-change', 'uncertain', 'missing-contract', 'invented-group', 'provider-error', 'unknown-outcome']) test('Structured smoke stops without retry or forced edits on ' + outcome, async () => {
  const value = await fixture();
  try {
    const smoke = await registeredStructured(value);
    if (outcome === 'question') value.control.question = true;
    if (outcome === 'no-change') value.control.noChange = true;
    if (outcome === 'missing-contract') value.control.removeContract = true;
    if (outcome === 'provider-error') value.control.reject = true;
    const controller = new AbortController();
    if (outcome === 'unknown-outcome') {
      value.control.hang = true;
      value.control.onCall = () => controller.abort(new Error('Scripted unknown provider outcome'));
    }
    if (outcome === 'uncertain' || outcome === 'invented-group') value.control.responseText = (stage, answer) => {
      if (stage === 'challenge' && outcome === 'uncertain' && answer.verdict) answer.verdict = 'uncertain';
      if (stage === 'challenge' && outcome === 'invented-group') answer.semantic.groups['job-0'] = { id: 'job-0', verdict: 'agree', reason: 'Invented.' };
      return JSON.stringify(answer);
    };
    if (['missing-contract', 'invented-group', 'provider-error', 'unknown-outcome'].includes(outcome)) {
      await assert.rejects(smoke.run(controller.signal), outcome === 'missing-contract' ? /acknowledge.*contract/ : undefined);
    }
    else assert.equal((await smoke.run()).stopped, true);
    const result = await value.probe.status(), calls = value.calls.length;
    assert.equal(calls, ['question', 'no-change', 'uncertain'].includes(outcome) ? 14 : outcome === 'invented-group' ? 9 : 8);
    assert.equal(result.stopped, true); assert.equal(result.next, null);
    assert.equal(result.documentVersion, 1); assert.equal(result.versions.length, 0); assert.equal(result.inputs.edited, undefined);
    await assert.rejects(smoke.run(), /stopped/); assert.equal(value.calls.length, calls);
  } finally { await value.runtime.dispose(); }
});
test('Structured smoke retains an incomplete registration without altering its seven-call budget or allowing recreation', async () => {
  const value = await fixture();
  try {
    const originals = await stoppedSmokes(value), review = await value.probe.reviewStructured({ pricesCheckedAt: value.pricesCheckedAt });
    const partial = value.make({ get: (...args) => value.bucket.get(...args),
      put: (...args) => args[0] === STRUCTURED_SMOKE_KEY ? null : value.bucket.put(...args) });
    await assert.rejects(partial.registerStructured({ ...review, confirmed: true, pricesCheckedAt: value.pricesCheckedAt }), /registration was not acknowledged/);
    await assert.rejects(value.probe.status(), /registration is incomplete/);
    await assert.rejects(value.probe.reviewStructured({ pricesCheckedAt: value.pricesCheckedAt }), /registration is incomplete/);
    assert.deepEqual(await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json(), originals.budget);
    assert.equal(value.calls.length, 7);
  } finally { await value.runtime.dispose(); }
});
test('Structured smoke preserves a valid contradicted draft but stops when challenge context adds an uncertain citation', async () => {
  const value = await fixture();
  try {
    const smoke = await registeredStructured(value);
    value.control.responseText = (stage, answer) => {
      if (stage === 'assessment') answer.semantic.excerpts['artifact-3'].kind = 'uncertain';
      if (stage === 'challenge') answer.ratings.python.evidence.push('artifact-3');
      return JSON.stringify(answer);
    };
    const result = await smoke.run(), output = result.operations[0].output;
    assert.equal(result.stopped, true); assert.match(result.stopReason, /explicit contradiction/);
    assert.equal(output.draft.ratings[0].state, 'contradicted');
    assert.equal(output.challenge.ratings[0].verdict, 'agree');
    assert.equal(output.report.dimensions.roleEvidence.ratings[0].state, 'unknown');
    assert.deepEqual(output.report.dimensions.roleEvidence.ratings[0].evidence, ['artifact-2', 'artifact-3']);
    assert.equal(output.execution.length, 2);
    assert.ok(output.execution.every(item => item.status === 'parsed' && item.responseContract === 'assessment-semantic-json-v1'));
    assert.equal(value.calls.length, 9); assert.equal(result.spending.reserved, 3.322008);
    assert.equal(result.operations.length, 1); assert.equal(result.documentVersion, 1);
    await assert.rejects(smoke.run(), /stopped/); assert.equal(value.calls.length, 9);
  } finally { await value.runtime.dispose(); }
});
test('Fixed smoke runs fourteen cumulative calls under six dollars while preserving both stopped records and every prior reservation', async () => {
  const value = await fixture();
  try {
    const smoke = await registeredSmoke(value);
    assert.equal(value.calls.length, 5);
    assert.equal((await value.probe.status()).spending.maxCost, 6);
    const result = await smoke.run();
    assert.deepEqual(result.operations.map(item => item.phase), SMOKE_PHASES);
    assert.equal(value.calls.length, 14); assert.equal(result.spending.reserved, 5.060011);
    assert.equal(result.documentVersion, 3); assert.equal(result.operations.at(-1).output.comparison.comparable, true);
    assert.equal(await (await value.bucket.get(PROBE_KEY)).text(), smoke.originals.parent);
    assert.equal(await (await value.bucket.get(CONTINUATION_KEY)).text(), smoke.originals.child);
    const ledger = await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json();
    assert.deepEqual({ ...ledger, maxCost: 4, reservations: ledger.reservations.slice(0, 3) }, smoke.originals.budget);
    assert.equal((await value.make(value.bucket).status()).stopped, true);
    assert.equal((await value.make(value.bucket, true).status()).stopped, true);
    assert.equal((await smoke.run()).next, null); assert.equal(value.calls.length, 14);
    await assert.rejects(value.probe.reviewSmoke({ pricesCheckedAt: value.pricesCheckedAt }), /already registered/);
  } finally { await value.runtime.dispose(); }
});
test('Fixed smoke requires exact approval, unchanged code and its guarded runner; missing version stops without another phase', async () => {
  const value = await fixture();
  try {
    await stoppedWorkflows(value);
    const review = await value.probe.reviewSmoke({ pricesCheckedAt: value.pricesCheckedAt });
    await assert.rejects(value.probe.registerSmoke({ ...review, pricesCheckedAt: value.pricesCheckedAt }), /explicit approval/);
    await assert.rejects(value.probe.registerSmoke({ confirmed: true, approvalSha256: 'f'.repeat(64), pricesCheckedAt: value.pricesCheckedAt }), /approval changed/);
    assert.equal(await value.bucket.get(SMOKE_CLAIM_KEY), null);
    await value.probe.registerSmoke({ ...review, confirmed: true, pricesCheckedAt: value.pricesCheckedAt });
    value.probe = value.make(value.bucket, false, true);
    await assert.rejects(runNext(value, { transport: 'studio' }), /fixed workflow guards/);
    const changedCode = createAssessmentProbe({ bucket: value.bucket, renderExport: render, request: value.request, smoke: true, codeSha256: '2'.repeat(64) });
    await assert.rejects(changedCode.review({ pricesCheckedAt: value.pricesCheckedAt, transport: 'studio' }), /code changed/);
    value.control.responseText = (stage, answer) => {
      if (stage === 'challenge') delete answer.semantic.version;
      return JSON.stringify(answer);
    };
    const run = () => value.probe.runSmoke({ approvalSha256: review.approvalSha256, allowProvider: true, pricesCheckedAt: value.pricesCheckedAt, preflight: async () => {} });
    await assert.rejects(run(), /challenge.semantic/);
    const failed = await value.probe.status();
    assert.equal(failed.stopped, true); assert.equal(failed.next, null); assert.equal(value.calls.length, 7);
    assert.equal(failed.spending.reserved, 2.574006); assert.equal(failed.operations[0].output, null);
    assert.equal(JSON.parse(failed.operations[0].responses[1].receipt.text).semantic.version, undefined);
    await assert.rejects(run(), /stopped/); assert.equal(value.calls.length, 7);
  } finally { await value.runtime.dispose(); }
});
test('Fixed smoke stops on a question revision without forcing Apply or recheck', async () => {
  const value = await fixture();
  try {
    const smoke = await registeredSmoke(value); value.control.question = true;
    const result = await smoke.run();
    assert.equal(result.stopped, true); assert.match(result.stopReason, /question or no-change/);
    assert.equal(value.calls.length, 12); assert.equal(result.spending.reserved, 4.312009);
    assert.equal(result.documentVersion, 1); assert.equal(result.versions.length, 0); assert.equal(result.inputs.edited, undefined);
  } finally { await value.runtime.dispose(); }
});
test('Fixed smoke rejects partial registration and changed prior budget instead of resetting the ceiling', async () => {
  const value = await fixture();
  try {
    await stoppedWorkflows(value);
    const review = await value.probe.reviewSmoke({ pricesCheckedAt: value.pricesCheckedAt });
    const partial = value.make({ get: (...args) => value.bucket.get(...args),
      put: (...args) => args[0] === SMOKE_KEY ? null : value.bucket.put(...args) });
    await assert.rejects(partial.registerSmoke({ ...review, confirmed: true, pricesCheckedAt: value.pricesCheckedAt }), /registration was not acknowledged/);
    await assert.rejects(value.probe.status(), /registration is incomplete/);
    await assert.rejects(value.probe.reviewSmoke({ pricesCheckedAt: value.pricesCheckedAt }), /registration is incomplete/);
    assert.equal((await (await value.bucket.get('system/resume-assessment-budget-v1.json')).json()).maxCost, 6);
    assert.equal(value.calls.length, 5);
  } finally { await value.runtime.dispose(); }
});
test('Fixed smoke CLI preserves its identity marker if both registration records disappear', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-smoke-cli-')), value = await fixture({ r2Persist: join(directory, 'r2') });
  let active = true;
  try {
    await stoppedWorkflows(value);
    const continuation = await (await value.bucket.get(CONTINUATION_CLAIM_KEY)).json();
    writeFileSync(join(directory, 'identity.json'), JSON.stringify({ version: 1, identity: 'four-dollar-fictional-probe',
      state: 'ready', continuationApprovalSha256: continuation.approvalSha256 }));
    await value.runtime.dispose(); active = false;
    const command = args => runProbeCommand({ directory, args, renderExport: render,
      getKey: () => assert.fail('Unpaid smoke command read a key'), fetcher: () => assert.fail('Unpaid smoke command contacted a provider') });
    const timestamp = new Date(value.pricesCheckedAt).toISOString();
    const reviewed = await command(['review-smoke', '--prices-checked-at', timestamp]);
    await command(['register-smoke', '--confirm', '--approval', reviewed.approvalSha256, '--prices-checked-at', timestamp]);
    assert.equal((await command(['status', '--smoke'])).spending.reserved, 1.826004);
    assert.equal(JSON.parse(readFileSync(join(directory, 'identity.json'))).smokeApprovalSha256, reviewed.approvalSha256);
    const runtime = new Miniflare(value.options);
    try {
      const bucket = await runtime.getR2Bucket('PROBE');
      await bucket.delete(SMOKE_KEY); await bucket.delete(SMOKE_CLAIM_KEY);
    } finally { await runtime.dispose(); }
    await assert.rejects(command(['status', '--smoke']), /smoke anchor or state disappeared/);
    await assert.rejects(command(['review-smoke', '--prices-checked-at', timestamp]), /smoke anchor or state disappeared/);
    assert.equal(existsSync(join(directory, 'operation.lock')), false);
  } finally { if (active) await value.runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
async function registerContinuation(value) {
  const review = await value.probe.reviewContinuation({ pricesCheckedAt: value.pricesCheckedAt });
  return value.probe.registerContinuation({ confirmed: true, approvalSha256: review.approvalSha256, pricesCheckedAt: value.pricesCheckedAt });
}

test('Fixed fictional probe runs actual PDF revision/history/recheck with ten scripted calls under four dollars', async () => {
  const value = await fixture();
  try {
    const prepared = await value.probe.prepare();
    assert.equal(prepared.next, 'negation.inventory'); assert.equal(prepared.spending.reserved, 0); assert.equal(value.calls.length, 0);
    for (const phase of PROBE_PHASES) {
      assert.equal((await value.probe.status()).next, phase);
      await runNext(value, phase === 'pdf.revision' ? { findingId: 'role-tools', fieldId: 'north-work' } : {});
    }
    const result = await value.probe.status();
    assert.equal(result.next, null); assert.equal(value.calls.length, 10);
    assert.equal(result.spending.reserved, 3.564007); assert.equal(result.spending.maxCost, 4);
    assert.equal(result.documentVersion, 3); assert.equal(result.versions.length, 2);
    assert.equal(result.document.model.sections[0].items[0].bullets[0].text, after);
    assert.equal(result.operations.at(-1).output.comparison.comparable, true);
    assert.ok(result.inputs.edited.sha256 !== result.inputs.pdf.sha256);
    const history = createAssessmentHistoryStore(value.bucket), records = await history.list();
    assert.equal(records.items.length, 3);
    for (const item of records.items) assert.equal((await history.get(item.id)).receiptStatus, 'server-receipted-not-independent-truth');
    await assert.rejects(runNext(value), /complete.*Additional calls/);
    await value.probe.prepare(); assert.equal(value.calls.length, 10);
    const original = await (await value.bucket.get(PROBE_KEY)).json();
    for (const change of [
      state => { state.documentVersion = 2; },
      state => { state.versions[0].label = 'Forged checkpoint'; },
      state => { state.document.candidateEdits[0].checkpointVersion = 1; },
      state => { state.document.model.sections[0].items[0].bullets[0].text = 'Forged edit'; },
      state => { state.operations[0].output.manifest.requirements[0].label = 'Forged output'; },
    ]) {
      const state = structuredClone(original); change(state);
      await value.bucket.put(PROBE_KEY, JSON.stringify(state));
      await assert.rejects(value.probe.status(), /changed/);
      await value.bucket.put(PROBE_KEY, JSON.stringify(original));
    }
    assert.equal(value.calls.length, 10);
  } finally { await value.runtime.dispose(); }
});
test('Cancelled unresponsive provider retains the full reservation and cannot replay', async () => {
  const value = await fixture(), controller = new AbortController();
  try {
    await value.probe.prepare(); value.control.hang = true;
    value.control.onCall = () => setTimeout(() => controller.abort(new Error('Scripted cancellation')), 0);
    await assert.rejects(runNext(value, { signal: controller.signal }), /Scripted cancellation/);
    await value.control.pending;
    const status = await value.probe.status();
    assert.equal(status.spending.reserved, 0.33); assert.equal(status.spending.attempts, 1);
    assert.equal(status.operations[0].attempt.status, 'cancelled'); assert.equal(status.stopped, true);
    await assert.rejects(runNext(value), /stopped/); assert.equal(value.calls.length, 1);
  } finally { await value.runtime.dispose(); }
});
test('A question revision ends safely without a forced Apply, recheck, reset or extra calls', async () => {
  const value = await fixture();
  try {
    await value.probe.prepare();
    for (let index = 0; index < 4; index++) await runNext(value);
    value.control.question = true;
    await runNext(value, { findingId: 'role-tools', fieldId: 'north-work' });
    await assert.rejects(value.probe.review(), /question or no-change/);
    const status = await value.probe.finish({ confirmed: true, reason: 'The model requested evidence; no edit is approved.' });
    assert.equal(status.documentVersion, 1); assert.equal(status.versions.length, 0); assert.equal(value.calls.length, 8);
    assert.equal(status.spending.reserved, 2.816005); assert.equal(status.inputs.edited, undefined);
    await assert.rejects(runNext(value), /stopped/);
  } finally { await value.runtime.dispose(); }
});
test('CLI ready identity never recreates disappeared storage, missing identity or invalid identity', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rk-probe-identity-')), directory = join(parent, 'probe');
  const command = args => runProbeCommand({ directory, args, renderExport: render,
    getKey: () => assert.fail('Offline command accessed a key'), fetcher: () => assert.fail('Offline command contacted a provider') });
  try {
    await command(['prepare']);
    rmSync(join(directory, 'r2'), { recursive: true, force: true });
    await assert.rejects(command(['status']), /storage disappeared/);
    await assert.rejects(command(['prepare']), /storage disappeared/);
    assert.equal(existsSync(join(directory, 'r2')), false);
    unlinkSync(join(directory, 'identity.json'));
    await assert.rejects(command(['prepare']), /identity is missing/);
    writeFileSync(join(directory, 'identity.json'), JSON.stringify({ version: 2 }));
    await assert.rejects(command(['prepare']), /identity changed/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
test('Preview ephemeral and explicit ports retain same-origin guards', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-probe-origin-'));
  let preview;
  try {
    preview = await startPreview({ directory, port: 0 });
    const get = (headers = {}) => fetch(preview.origin + '/__resume/api/library', { headers: { Connection: 'close', ...headers } });
    const port = Number(new URL(preview.origin).port);
    assert.ok(port > 0);
    assert.equal((await get()).status, 200);
    assert.equal((await get({ Origin: 'https://not-local.invalid' })).status, 403);
    assert.equal((await get({ Origin: 'http://localhost:' + port })).status, 200);
    await preview.close(); preview = null;
    preview = await startPreview({ directory, port });
    assert.equal(preview.origin, 'http://127.0.0.1:' + port);
    assert.equal((await get()).status, 200);
  } finally { await preview?.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('CLI paid transport uses only its injected fictional key and persists phase receipts across commands', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rk-probe-cli-transport-')), directory = join(parent, 'probe');
  let calls = 0, keys = 0;
  const command = args => runProbeCommand({ directory, args, renderExport: render,
    getKey: () => { keys++; return 'scripted-not-a-real-key'; },
    fetcher: async (url, options) => {
      calls++; assert.equal(url, 'https://api.anthropic.com/v1/messages');
      const payload = JSON.parse(options.body), data = JSON.parse(payload.messages[0].content);
      const stage = payload.max_tokens === 8000 ? 'requirements' : data.draft ? 'challenge' : 'assessment';
      return Response.json({ id: 'cli-script-' + calls, model: 'claude-sonnet-5-5', type: 'message', role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(providerAnswer(stage, data)) }], usage: { input_tokens: 100, output_tokens: 200 } });
    } });
  try {
    await command(['prepare']); assert.equal(keys, 0);
    for (let index = 0; index < 2; index++) {
      const timestamp = new Date().toISOString(), review = await command(['review', '--prices-checked-at', timestamp]);
      await command(['run', '--prices-checked-at', timestamp, '--approval', review.approvalSha256, '--allow-provider']);
    }
    const status = await command(['status']);
    assert.equal(status.spending.reserved, 1.078002); assert.equal(status.spending.attempts, 3);
    assert.equal(status.next, 'pdf.inventory'); assert.equal(calls, 3); assert.equal(keys, 5);
    await command(['finish', '--confirm', '--reason', 'Scripted CLI fixture complete']);
    assert.equal(keys, 5); assert.equal(calls, 3);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
function studioCliFixture(directory) {
  let calls = 0, connections = 0, client;
  const control = { failChallenge: false, clientError: null };
  const command = args => runProbeCommand({ directory, args, renderExport: render,
    getKey: () => assert.fail('Studio mode must not read an environment key'),
    fetcher: () => assert.fail('Studio mode must not use direct provider transport'),
    onStudioBridge: descriptor => {
      connections++;
      client = studioProbeClient(descriptor, { origin: STUDIO_ORIGIN, getSession: () => 'scripted-page-session',
        fetcher: async (url, init) => {
          if (url.startsWith(descriptor.url + '/')) {
            assert.equal(JSON.stringify(init).includes('scripted-page-session'), false);
            return fetch(url, { ...init, headers: { ...init.headers, Origin: STUDIO_ORIGIN } });
          }
          assert.equal(init.headers.Authorization, 'Bearer scripted-page-session');
          if (url.endsWith('/keys')) return Response.json({ providers: { anthropic: { set: true } } });
          assert.equal(url, 'https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/ai/anthropic/messages');
          calls++;
          const payload = JSON.parse(init.body), data = JSON.parse(payload.messages[0].content);
          const stage = payload.max_tokens === 8000 ? 'requirements' : payload.max_tokens === 4000 ? 'revision' : data.draft ? 'challenge' : 'assessment';
          const domain = providerAnswer(stage, data), schema = payload.output_config.format?.schema;
          if (control.failChallenge && stage === 'challenge') domain.semantic.excerpts[0].extra = 'Synthetic rejected semantic field';
          const answer = schema ? wireValue(schema, domain) : domain;
          validateStudioProbeBody(payload);
          return Response.json({ id: 'studio-script-' + calls, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 100, output_tokens: 200 } });
        } });
      client.catch(error => { control.clientError = error; });
    } });
  return { command, control, get calls() { return calls; }, get connections() { return connections; },
    get client() { return client; }, set client(value) { client = value; } };
}
test('Structured smoke CLI binds durable registration, survives restarts and finishes nine schema-bearing calls over one Studio connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-structured-cli-')), value = await fixture({ r2Persist: join(directory, 'r2') });
  let active = true;
  const withStore = async action => {
    const runtime = new Miniflare(value.options);
    try { return await action(await runtime.getR2Bucket('PROBE')); } finally { await runtime.dispose(); }
  };
  try {
    const originals = await stoppedSmokes(value);
    const continuation = await (await value.bucket.get(CONTINUATION_CLAIM_KEY)).json(), smoke = await (await value.bucket.get(SMOKE_CLAIM_KEY)).json();
    writeFileSync(join(directory, 'identity.json'), JSON.stringify({ version: 1, identity: 'four-dollar-fictional-probe', state: 'ready',
      continuationApprovalSha256: continuation.approvalSha256, smokeApprovalSha256: smoke.approvalSha256 }));
    await value.runtime.dispose(); active = false;
    const session = studioCliFixture(directory), { command } = session, timestamp = new Date(value.pricesCheckedAt).toISOString();
    const review = await command(['review-structured', '--prices-checked-at', timestamp]);
    await command(['register-structured', '--confirm', '--approval', review.approvalSha256, '--prices-checked-at', timestamp]);
    assert.equal(session.calls, 0); assert.equal(session.connections, 0);
    assert.equal(JSON.parse(readFileSync(join(directory, 'identity.json'))).structuredApprovalSha256, review.approvalSha256);
    assert.equal((await command(['status', '--structured'])).spending.reserved, 2.574006);
    const saved = await withStore(async store => {
      const claim = await (await store.get(STRUCTURED_SMOKE_CLAIM_KEY)).text(), state = await (await store.get(STRUCTURED_SMOKE_KEY)).text();
      await store.delete(STRUCTURED_SMOKE_CLAIM_KEY); await store.delete(STRUCTURED_SMOKE_KEY); return { claim, state };
    });
    await assert.rejects(command(['status', '--structured']), /structured smoke anchor or state disappeared/);
    await assert.rejects(command(['review-structured', '--prices-checked-at', timestamp]), /structured smoke anchor or state disappeared/);
    await withStore(async store => { await store.put(STRUCTURED_SMOKE_CLAIM_KEY, saved.claim); await store.put(STRUCTURED_SMOKE_KEY, saved.state); });
    const identityPath = join(directory, 'identity.json'), identityBytes = readFileSync(identityPath), identity = JSON.parse(identityBytes);
    delete identity.structuredApprovalSha256; writeFileSync(identityPath, JSON.stringify(identity));
    await assert.rejects(command(['status', '--structured']), /structured smoke anchor or state disappeared/);
    writeFileSync(identityPath, identityBytes);
    const flags = ['--structured', '--studio', '--approval', review.approvalSha256, '--prices-checked-at', timestamp, '--allow-provider'];
    const result = await command(['run-structured', ...flags]);
    await session.client;
    assert.equal(session.calls, 9); assert.equal(session.connections, 1); assert.equal(session.control.clientError, null);
    assert.equal(result.spending.reserved, 5.808013); assert.equal(result.spending.attempts, 16);
    assert.equal(result.next, null); assert.equal(JSON.parse(readFileSync(result.inspectionFile)).documentVersion, 3);
    const restored = await command(['status', '--structured']);
    assert.equal(JSON.parse(readFileSync(restored.inspectionFile)).operations.at(-1).output.comparison.comparable, true);
    assert.equal((await command(['run-structured', ...flags])).next, null);
    assert.equal(session.calls, 9); assert.equal(session.connections, 1);
    assert.equal(existsSync(join(directory, 'operation.lock')), false);
    assert.equal(existsSync(join(directory, 'studio-connection.json')), false);
    await withStore(async store => {
      for (const [key, name] of [[PROBE_KEY, 'parent'], [CONTINUATION_KEY, 'child'], [SMOKE_KEY, 'smoke']]) assert.equal(await (await store.get(key)).text(), originals[name]);
      const ledger = await (await store.get('system/resume-assessment-budget-v1.json')).json();
      assert.deepEqual({ ...ledger, reservations: ledger.reservations.slice(0, 4) }, originals.budget);
    });
  } finally { if (active) await value.runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
test('Studio CLI completes seven approved phases across restarts under the same four-dollar ledger without a local key', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rk-probe-studio-cli-')), directory = join(parent, 'probe');
  const session = studioCliFixture(directory), { command } = session;
  try {
    await command(['prepare']);
    const checked = await command(['check-studio']);
    assert.equal((await session.client).transportClosed, true);
    assert.equal(checked.spending.initialized, false); assert.equal(session.calls, 0); assert.equal(session.connections, 1);
    for (const phase of PROBE_PHASES) {
      const flags = ['--studio', '--prices-checked-at', new Date().toISOString(),
        ...(phase === 'pdf.revision' ? ['--finding', 'role-tools', '--field', 'north-work'] : [])];
      const review = await command(['review', ...flags]);
      if (phase === 'negation.inventory') {
        assert.equal(session.connections, 1);
        await assert.rejects(command(['run', ...flags.filter(value => value !== '--studio'), '--approval', review.approvalSha256, '--allow-provider']), /exact reviewed/);
      }
      session.client = null;
      await command(['run', ...flags, '--approval', review.approvalSha256, ...(phase === 'pdf.apply' ? [] : ['--allow-provider'])]);
      if (session.client) assert.equal((await session.client).transportClosed, true);
      assert.equal(existsSync(join(directory, 'studio-connection.json')), false);
      assert.equal(existsSync(join(directory, 'operation.lock')), false);
    }
    const status = await command(['status']), report = JSON.parse(readFileSync(status.inspectionFile, 'utf8'));
    assert.equal(status.next, null); assert.equal(status.spending.reserved, 3.564007);
    assert.equal(status.spending.attempts, 10); assert.equal(session.calls, 10); assert.equal(session.connections, 7);
    assert.equal(report.documentVersion, 3);
    assert.equal(report.operations.every(item => item.transport === 'studio'), true);
    assert.equal(report.operations.at(-1).output.comparison.comparable, true);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
test('Continuation preserves the stopped parent and original ledger prefix through eight calls and runtime restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-continuation-')), value = await fixture({ r2Persist: join(directory, 'r2') });
  let runtime = value.runtime;
  try {
    const original = await stoppedParent(value), ledgerKey = 'system/resume-assessment-budget-v1.json';
    const oldLedger = await (await value.bucket.get(ledgerKey)).json();
    const registered = await registerContinuation(value);
    assert.equal(registered.stopped, true); assert.equal(registered.next, null); assert.equal(value.calls.length, 3);
    const parent = value.probe; value.probe = value.make(value.bucket, true);
    await assert.rejects(runNext(value), /requires Studio/);
    for (const phase of CONTINUATION_PHASES) {
      const options = { transport: 'studio', pricesCheckedAt: value.pricesCheckedAt };
      const review = await value.probe.review(options);
      assert.equal(review.packet.phase, phase); assert.equal(review.packet.maxCalls, 8);
      assert.equal(review.packet.continuation.packet.maximumReserved, 2.904006);
      if (phase === 'pdf.inventory') {
        assert.equal(review.packet.previousAssessment.report.dimensions.roleEvidence.ratings[0].state, 'contradicted');
        await assert.rejects(value.probe.run({ ...options, approvalSha256: review.approvalSha256, allowProvider: true, preflight: async () => {} }), /prior negation result/);
      }
      const results = await Promise.allSettled([
        value.probe.run({ ...options, approvalSha256: review.approvalSha256, allowProvider: true, previousAssessmentApproved: true, preflight: async () => {} }),
        value.make(value.bucket, true).run({ ...options, approvalSha256: review.approvalSha256, allowProvider: true, previousAssessmentApproved: true, preflight: async () => {} }),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    }
    assert.equal(value.calls.length, 8);
    const status = await value.probe.status();
    assert.deepEqual(status.spending, { maxCost: 4, reserved: 2.904006, attempts: 8, initialized: true });
    assert.equal(status.next, null); assert.equal(status.documentVersion, 1); assert.equal(status.operations.length, 3);
    assert.equal(await (await value.bucket.get(PROBE_KEY)).text(), original);
    assert.deepEqual((await (await value.bucket.get(ledgerKey)).json()).reservations.slice(0, 2), oldLedger.reservations);
    assert.equal((await parent.status()).spending.reserved, 2.904006);
    await assert.rejects(runNext(value, { transport: 'studio' }), /Additional calls/);
    await runtime.dispose(); runtime = new Miniflare(value.options);
    const restored = createAssessmentProbe({ bucket: await runtime.getR2Bucket('PROBE'), renderExport: render, continuation: true,
      request: () => assert.fail('Restart audit must not contact any provider') });
    assert.deepEqual(await restored.status(), status);
  } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
test('Continuation registration requires exact consent, acknowledged parent outcomes and an unchanged budget', async () => {
  const value = await fixture(), ledgerKey = 'system/resume-assessment-budget-v1.json';
  try {
    await value.probe.prepare();
    await assert.rejects(value.probe.reviewContinuation({ pricesCheckedAt: value.pricesCheckedAt }), /budget is missing|only the stopped/);
    await stoppedParent(value);
    const review = await value.probe.reviewContinuation({ pricesCheckedAt: value.pricesCheckedAt });
    await assert.rejects(value.probe.registerContinuation({ pricesCheckedAt: value.pricesCheckedAt, approvalSha256: review.approvalSha256 }), /explicitly approve/);
    await assert.rejects(value.probe.registerContinuation({ confirmed: true, pricesCheckedAt: value.pricesCheckedAt, approvalSha256: '0'.repeat(64) }), /exact continuation/);
    await assert.rejects(value.probe.reviewContinuation({ pricesCheckedAt: Date.now() - 86400001 }), /verify current/);
    assert.equal(await value.bucket.get(CONTINUATION_CLAIM_KEY), null);
    const parent = await (await value.bucket.get(PROBE_KEY)).json(), ledger = await (await value.bucket.get(ledgerKey)).json();
    const changed = structuredClone(ledger);
    Object.assign(changed.reservations[1].attempts[1], { status: 'failed', error: 'Synthetic unknown outcome' });
    changed.reservations[1].attempts[1].binding.response = null;
    await value.bucket.put(ledgerKey, JSON.stringify(changed));
    await assert.rejects(value.probe.reviewContinuation({ pricesCheckedAt: value.pricesCheckedAt }), /not fully acknowledged|response lost its budget binding|raw response binding/);
    await value.bucket.put(ledgerKey, JSON.stringify(ledger));
    await registerContinuation(value);
    await assert.rejects(registerContinuation(value), /already registered/);
    await value.bucket.put(PROBE_KEY, JSON.stringify({ ...parent, stopReason: 'Changed parent history' }));
    await assert.rejects(value.probe.status(), /immutable parent/);
    await value.bucket.put(PROBE_KEY, JSON.stringify(parent));
    const changedPrefix = structuredClone(ledger); changedPrefix.approvedAt++;
    await value.bucket.put(ledgerKey, JSON.stringify(changedPrefix));
    await assert.rejects(value.probe.status(), /original budget prefix/);
    await value.bucket.put(ledgerKey, JSON.stringify(ledger));
    await value.bucket.delete(ledgerKey);
    await assert.rejects(value.probe.status(), /lost its original budget/);
    assert.equal(value.calls.length, 3);
  } finally { await value.runtime.dispose(); }
});
test('Continuation registration has one CAS winner and never recreates a partial registration', async () => {
  for (const loseChild of [false, true]) {
    const value = await fixture();
    try {
      await stoppedParent(value);
      const review = await value.probe.reviewContinuation({ pricesCheckedAt: value.pricesCheckedAt });
      const options = { confirmed: true, pricesCheckedAt: value.pricesCheckedAt, approvalSha256: review.approvalSha256 };
      if (loseChild) {
        const broken = value.make({ get: key => value.bucket.get(key), put: async (key, data, settings) => {
          if (key === CONTINUATION_KEY) throw new Error('Synthetic registration persistence failure');
          return value.bucket.put(key, data, settings);
        } });
        await assert.rejects(broken.registerContinuation(options), /persistence failure/);
        await assert.rejects(registerContinuation(value), /incomplete|disappeared/);
      } else {
        const results = await Promise.allSettled([value.probe.registerContinuation(options), value.make(value.bucket).registerContinuation(options)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        await value.bucket.delete(CONTINUATION_KEY);
        await assert.rejects(value.probe.status(), /incomplete|disappeared/);
        await assert.rejects(registerContinuation(value), /incomplete|disappeared/);
      }
      assert.equal(value.calls.length, 3);
    } finally { await value.runtime.dispose(); }
  }
});
test('Continuation failures and cancellation retain all reservations and cannot spawn another follow-up', async () => {
  for (const kind of ['provider', 'semantic', 'retention', 'cancel']) {
    const value = await fixture();
    try {
      const original = await stoppedParent(value); await registerContinuation(value);
      const parent = value.probe; value.probe = value.make(value.bucket, true);
      const controller = new AbortController();
      if (kind === 'provider') value.control.reject = true;
      else if (kind === 'semantic') value.control.responseText = (stage, answer) => {
        if (stage === 'challenge') answer.semantic.excerpts[0].extra = 'Synthetic repeated schema failure';
        return JSON.stringify(answer);
      };
      else if (kind === 'cancel') {
        value.control.hang = true;
        value.control.onCall = () => controller.abort(new Error('Synthetic continuation cancellation'));
      } else {
        let failed = false;
        value.probe = value.make({ get: key => value.bucket.get(key), put: async (key, data, options) => {
          if (!failed && key === CONTINUATION_KEY && JSON.parse(data).operations[0]?.responses.length) {
            failed = true; throw new Error('Synthetic continuation response write failure');
          }
          return value.bucket.put(key, data, options);
        } }, true);
      }
      await assert.rejects(runNext(value, { transport: 'studio', signal: controller.signal }), /Provider attempt failed|Semantic review|retention was not acknowledged|continuation cancellation/);
      if (kind === 'cancel') await value.control.pending;
      const status = await value.probe.status();
      assert.equal(status.stopped, true); assert.equal(status.next, null); assert.equal(status.spending.reserved, 1.826004);
      assert.equal(status.operations[0].output, null); assert.equal(value.calls.length, kind === 'semantic' ? 5 : 4);
      if (kind === 'semantic') assert.equal(status.operations[0].responses.length, 2);
      await assert.rejects(runNext(value, { transport: 'studio' }), /stopped/);
      await assert.rejects(parent.reviewContinuation({ pricesCheckedAt: value.pricesCheckedAt }), /already registered/);
      assert.equal(await (await value.bucket.get(PROBE_KEY)).text(), original);
    } finally { await value.runtime.dispose(); }
  }
});
test('Continuation rejects tampered inherited state and orphaned reservations without changing the parent', async () => {
  const value = await fixture(), ledgerKey = 'system/resume-assessment-budget-v1.json';
  try {
    const original = await stoppedParent(value); await registerContinuation(value);
    const child = await (await value.bucket.get(CONTINUATION_KEY)).json(), ledger = await (await value.bucket.get(ledgerKey)).json();
    const continuation = value.make(value.bucket, true);
    for (const mutate of [
      state => { state.inputs.negation.sha256 = 'a'.repeat(64); },
      state => { state.inheritedInventory.manifest.requirements[0].label = 'Invented criterion'; },
      state => { state.registrationSha256 = 'a'.repeat(64); },
      state => { state.document.name = 'Changed document'; },
      state => { state.maxCalls = 10; },
    ]) {
      const changed = structuredClone(child); mutate(changed);
      await value.bucket.put(CONTINUATION_KEY, JSON.stringify(changed));
      await assert.rejects(continuation.status(), /changed|invalid/);
    }
    await value.bucket.put(CONTINUATION_KEY, JSON.stringify(child));
    const orphan = structuredClone(ledger);
    const reservation = structuredClone(ledger.reservations[0]); reservation.plan.id = crypto.randomUUID();
    orphan.reservations.push(reservation);
    await value.bucket.put(ledgerKey, JSON.stringify(orphan));
    await assert.rejects(continuation.status(), /unrecognized paid reservation/);
    await value.bucket.put(ledgerKey, JSON.stringify(ledger));
    const review = await continuation.review({ pricesCheckedAt: value.pricesCheckedAt, transport: 'studio' });
    await assert.rejects(continuation.run({ pricesCheckedAt: value.pricesCheckedAt, transport: 'studio',
      approvalSha256: 'a'.repeat(64), allowProvider: true, preflight: () => assert.fail('Wrong approval cannot preflight') }), /exact reviewed/);
    assert.equal(review.packet.spending.reserved, 1.078002);
    assert.equal(value.calls.length, 3); assert.equal(await (await value.bucket.get(PROBE_KEY)).text(), original);
  } finally { await value.runtime.dispose(); }
});
test('Studio CLI continuation uses one identity anchor and eight cumulative calls without changing the stopped parent', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rk-studio-continuation-')), directory = join(parent, 'probe');
  const session = studioCliFixture(directory), { command } = session, timestamp = new Date().toISOString();
  const withStore = async action => {
    const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("offline")}}', r2Buckets: ['PROBE'], r2Persist: join(directory, 'r2') });
    try { return await action(await runtime.getR2Bucket('PROBE')); } finally { await runtime.dispose(); }
  };
  try {
    await command(['prepare']);
    for (const failed of [false, true]) {
      session.control.failChallenge = failed;
      const review = await command(['review', '--studio', '--prices-checked-at', timestamp]);
      const run = command(['run', '--studio', '--prices-checked-at', timestamp, '--approval', review.approvalSha256, '--allow-provider']);
      if (failed) await assert.rejects(run, /Semantic review/); else await run;
      await session.client;
    }
    session.control.failChallenge = false;
    const original = await withStore(async store => (await store.get(PROBE_KEY)).text());
    const review = await command(['review-continuation', '--prices-checked-at', timestamp]);
    await assert.rejects(command(['register-continuation', '--prices-checked-at', timestamp, '--approval', review.approvalSha256]), /explicitly approve/);
    assert.equal(JSON.parse(readFileSync(join(directory, 'identity.json'))).continuationApprovalSha256, undefined);
    await command(['register-continuation', '--confirm', '--prices-checked-at', timestamp, '--approval', review.approvalSha256]);
    assert.equal(session.calls, 3); assert.equal(session.connections, 2);
    const saved = await withStore(async store => {
      const claim = await (await store.get(CONTINUATION_CLAIM_KEY)).text(), child = await (await store.get(CONTINUATION_KEY)).text();
      await store.delete(CONTINUATION_CLAIM_KEY); await store.delete(CONTINUATION_KEY); return { claim, child };
    });
    await assert.rejects(command(['status']), /anchor|disappeared/);
    await assert.rejects(command(['register-continuation', '--confirm', '--prices-checked-at', timestamp, '--approval', review.approvalSha256]), /anchor|disappeared/);
    await withStore(async store => {
      await store.put(CONTINUATION_CLAIM_KEY, saved.claim); await store.put(CONTINUATION_KEY, saved.child);
    });
    for (const phase of CONTINUATION_PHASES) {
      const flags = ['--continuation', '--studio', '--prices-checked-at', timestamp];
      const packet = await command(['review', ...flags]);
      await command(['run', ...flags, '--approval', packet.approvalSha256, '--allow-provider', ...(phase === 'pdf.inventory' ? ['--confirm'] : [])]);
      await session.client;
      assert.equal(existsSync(join(directory, 'studio-connection.json')), false);
      assert.equal(existsSync(join(directory, 'operation.lock')), false);
    }
    const status = await command(['status', '--continuation']), parentStatus = await command(['status']);
    assert.equal(status.next, null); assert.equal(status.spending.reserved, 2.904006); assert.equal(status.spending.attempts, 8);
    assert.equal(parentStatus.stopped, true); assert.equal(parentStatus.next, null); assert.equal(parentStatus.spending.reserved, 2.904006);
    assert.equal(session.calls, 8); assert.equal(session.connections, 5); assert.equal(session.control.clientError, null);
    assert.equal(await withStore(async store => (await store.get(PROBE_KEY)).text()), original);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
test('Missing explicit approval, changed packets, stale prices or failed key preflight never claim a paid phase', async () => {
  const value = await fixture();
  try {
    await value.probe.prepare();
    const review = await value.probe.review({ pricesCheckedAt: value.pricesCheckedAt });
    await assert.rejects(value.probe.run({ pricesCheckedAt: value.pricesCheckedAt, approvalSha256: '0'.repeat(64), allowProvider: true, preflight: async () => {} }), /exact reviewed/);
    await assert.rejects(value.probe.run({ pricesCheckedAt: value.pricesCheckedAt, approvalSha256: review.approvalSha256 }), /provider permission/);
    await assert.rejects(value.probe.run({ pricesCheckedAt: value.pricesCheckedAt, approvalSha256: review.approvalSha256, allowProvider: true, preflight: async () => { throw new Error('Key absent'); } }), /Key absent/);
    await assert.rejects(value.probe.review({ pricesCheckedAt: Date.now() - 86400001 }), /verify current/);
    assert.equal(value.calls.length, 0); assert.equal((await value.probe.status()).operations.length, 0);
    assert.equal(await value.bucket.get('system/resume-assessment-budget-v1.json'), null);
  } finally { await value.runtime.dispose(); }
});
test('A concurrent or lost-acknowledgement claim cannot repeat a provider operation', async () => {
  const value = await fixture();
  try {
    await value.probe.prepare();
    const review = await value.probe.review({ pricesCheckedAt: value.pricesCheckedAt });
    const options = { pricesCheckedAt: value.pricesCheckedAt, approvalSha256: review.approvalSha256, allowProvider: true, preflight: async () => {} };
    const results = await Promise.allSettled([value.probe.run(options), value.make(value.bucket).run(options)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1); assert.equal(value.calls.length, 1);
    const failed = value.make({
      get: key => value.bucket.get(key),
      put: async (key, data, options) => {
        const response = await value.bucket.put(key, data, options);
        if (key === PROBE_KEY && JSON.parse(data).operations.at(-1).phase === 'negation.assessment') throw new Error('Synthetic lost state acknowledgement');
        return response;
      },
    });
    const next = await failed.review({ pricesCheckedAt: value.pricesCheckedAt });
    await assert.rejects(failed.run({ ...options, approvalSha256: next.approvalSha256 }), /lost state acknowledgement/);
    await assert.rejects(runNext(value), /unfinished/);
    assert.equal(value.calls.length, 1);
  } finally { await value.runtime.dispose(); }
});
test('Provider and post-provider persistence failures retain reservations and halt rather than retry', async () => {
  for (const failure of ['provider', 'state']) {
    const value = await fixture();
    try {
      await value.probe.prepare();
      if (failure === 'provider') value.control.reject = true;
      else {
        let rejected = false;
        value.probe = value.make({ get: key => value.bucket.get(key), put: async (key, data, options) => {
          if (!rejected && key === PROBE_KEY && JSON.parse(data).operations.at(-1)?.status === 'complete') {
            rejected = true; throw new Error('Synthetic completed-output persistence failure');
          }
          return value.bucket.put(key, data, options);
        } });
      }
      await assert.rejects(runNext(value), /failed|persistence failure/);
      const status = await value.probe.status();
      assert.equal(status.stopped, true); assert.equal(status.spending.reserved, 0.33); assert.equal(value.calls.length, 1);
      await assert.rejects(runNext(value), /stopped/); assert.equal(value.calls.length, 1);
    } finally { await value.runtime.dispose(); }
  }
});
test('Rejected semantic and malformed JSON responses survive restart as private diagnostics, never accepted results', async () => {
  for (const fault of ['extra', 'missing', 'json']) {
    const directory = mkdtempSync(join(tmpdir(), 'rk-probe-rejected-')), value = await fixture({ r2Persist: join(directory, 'r2') });
    let runtime = value.runtime;
    try {
      await value.probe.prepare(); await runNext(value);
      let raw;
      value.control.responseText = (stage, answer) => {
        if (fault === 'json' && stage === 'assessment') return raw = '{ invalid fictional JSON';
        if (stage === 'challenge') {
          if (fault === 'extra') answer.semantic.excerpts[0].evidence = ['artifact-2'];
          else delete answer.semantic.segments[0].reason;
          return raw = ' \n' + JSON.stringify(answer, null, 2) + '\n ';
        }
        return JSON.stringify(answer);
      };
      await assert.rejects(runNext(value), fault === 'json' ? /Provider attempt failed/ : /invalid record fields at challenge.semantic/);
      const before = await value.probe.status();
      await runtime.dispose(); runtime = new Miniflare(value.options);
      const bucket = await runtime.getR2Bucket('PROBE');
      const restored = createAssessmentProbe({ bucket, renderExport: render, request: () => { throw new Error('No provider access during restart validation'); } });
      const status = await restored.status(), failed = status.operations[1];
      assert.deepEqual(status, before); assert.equal(status.stopped, true); assert.equal(status.next, null);
      assert.equal(status.spending.reserved, 1.078002); assert.equal(status.spending.attempts, fault === 'json' ? 2 : 3);
      assert.equal(status.documentVersion, 1); assert.equal(failed.output, null); assert.equal(failed.outputSha256, null);
      assert.equal(failed.responses.at(-1).receipt.text, raw);
      assert.equal(failed.responses[0].stage, 'assessment');
      if (fault !== 'json') assert.equal(JSON.parse(failed.responses[0].receipt.text).ratings[0].state, 'contradicted');
      const retained = structuredClone(failed.responses);
      await assert.rejects(restored.review({ pricesCheckedAt: value.pricesCheckedAt }), /stopped/);
      const state = await (await bucket.get(PROBE_KEY)).json();
      state.operations[1].responses[0].receipt.text = '{}';
      await bucket.put(PROBE_KEY, JSON.stringify(state));
      await assert.rejects(restored.status(), /diagnostic response changed/);
      state.operations[1].responses = retained;
      state.operations[1].responses[0].requestSha256 = 'a'.repeat(64);
      await bucket.put(PROBE_KEY, JSON.stringify(state));
      await assert.rejects(restored.status(), /budget binding/);
      assert.equal(value.calls.length, fault === 'json' ? 2 : 3);
    } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
  }
});
test('Private response persistence failure stops before the next stage and preserves the reservation', async () => {
  for (const lostAcknowledgement of [false, true]) {
    const value = await fixture();
    try {
      await value.probe.prepare(); await runNext(value);
      let failed = false;
      value.probe = value.make({ get: key => value.bucket.get(key), put: async (key, data, options) => {
        if (!failed && key === PROBE_KEY && JSON.parse(data).operations.at(-1)?.responses?.[0]?.stage === 'assessment') {
          failed = true;
          if (lostAcknowledgement) await value.bucket.put(key, data, options);
          throw new Error('Synthetic diagnostic persistence failure');
        }
        return value.bucket.put(key, data, options);
      } });
      await assert.rejects(runNext(value), lostAcknowledgement ? /outcome was not acknowledged/ : /Response retention was not acknowledged/);
      const status = await value.probe.status();
      assert.equal(status.next, null); assert.equal(status.spending.reserved, 1.078002); assert.equal(value.calls.length, 2);
      assert.equal(status.operations[1].status, lostAcknowledgement ? 'started' : 'failed');
      assert.equal(status.operations[1].responses.length, 1); assert.equal(status.operations[1].output, null);
      await assert.rejects(runNext(value), /stopped|unfinished/); assert.equal(value.calls.length, 2);
    } finally { await value.runtime.dispose(); }
  }
});
test('Persistent probe and originals survive runtime restart; stale approvals and missing paid state cannot reset it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-probe-restart-')), value = await fixture({ r2Persist: join(directory, 'r2') });
  let runtime = value.runtime;
  try {
    await value.probe.prepare();
    const previous = await value.probe.review({ pricesCheckedAt: value.pricesCheckedAt });
    await runNext(value); await runtime.dispose(); runtime = new Miniflare(value.options);
    const bucket = await runtime.getR2Bucket('PROBE');
    const restored = createAssessmentProbe({ bucket, renderExport: render, request: () => { throw new Error('No paid call authorized on this restored fixture'); } });
    assert.equal((await restored.status()).spending.reserved, 0.33);
    assert.match((await restored.original('negation')).extraction.text, /No experience with Python/);
    await assert.rejects(restored.run({ pricesCheckedAt: value.pricesCheckedAt, approvalSha256: previous.approvalSha256, allowProvider: true, preflight: async () => {} }), /exact reviewed/);
    const key = 'system/resume-assessment-budget-v1.json', budget = await (await bucket.get(key)).json();
    await bucket.delete(key);
    await assert.rejects(restored.status(), /no spending ledger/);
    await bucket.put(key, JSON.stringify(budget));
    const corrupted = structuredClone(budget); corrupted.reservations[0].attempts[0].status = 'untracked';
    await bucket.put(key, JSON.stringify(corrupted));
    await assert.rejects(restored.status(), /stored request\/output binding|central execution state/);
    await bucket.put(key, JSON.stringify(budget));
    await bucket.delete(PROBE_KEY);
    await assert.rejects(restored.prepare(), /spending ledger exists/);
  } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
test('CLI preparation, status and review never read keys or invoke provider; locks and missing storage fail closed', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'rk-probe-cli-')), directory = join(parent, 'probe');
  let keys = 0, network = 0;
  const command = args => runProbeCommand({ directory, args, renderExport: render, getKey: () => { keys++; return undefined; }, fetcher: async () => { network++; throw new Error('No provider expected'); } });
  try {
    const prepared = await command(['prepare']);
    assert.equal(prepared.spending.reserved, 0); assert.ok(existsSync(prepared.originalFiles.pdf));
    await command(['status']);
    const time = new Date().toISOString(), review = await command(['review', '--prices-checked-at', time]);
    assert.equal(keys, 0); assert.equal(network, 0);
    assert.match(readFileSync(review.inspectionFile, 'utf8'), /approvalSha256/);
    await assert.rejects(command(['run', '--prices-checked-at', time, '--approval', review.approvalSha256, '--allow-provider']), /API_KEY is absent/);
    assert.equal(keys, 1); assert.equal(network, 0);
    assert.equal((await command(['status'])).spending.reserved, 0);
    await command(['finish', '--confirm', '--reason', 'Offline fixture ends without paid permission']);
    assert.equal(keys, 1); assert.equal(network, 0);
    await assert.rejects(command(['finish', '--confirm', '--reason', 'Changed reason']), /immutable/);
    writeFileSync(prepared.originalFiles.pdf, 'Corrupted inspection copy');
    await assert.rejects(command(['status']), /inspection export failed.*inspection copy changed/);
    assert.equal(readFileSync(prepared.originalFiles.pdf, 'utf8'), 'Corrupted inspection copy');
    writeFileSync(join(directory, 'operation.lock'), 'Synthetic interrupted command');
    await assert.rejects(command(['status']), /owns the lock/);
    assert.equal(readFileSync(join(directory, 'operation.lock'), 'utf8'), 'Synthetic interrupted command');
    await assert.rejects(command(['status', '--directory', 'another']), /Unknown option/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
