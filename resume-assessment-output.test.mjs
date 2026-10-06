import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSESSMENT_EVIDENCE_POLICY, ASSESSMENT_EVIDENCE_CONTRACT, assessmentResponseSchema, assessmentRequestIdentity, decodeAssessmentResponse } from './src/js/resume-assessment-output.mjs';
import { captureAssessmentInput } from './src/js/resume-assessment-input.mjs';
import { inventoryCandidateAssessment, approveAssessmentInventory, approveAssessmentEvidence, evaluateCandidateAssessment, validateEvaluatedAssessment } from './src/js/resume-assessment-evaluator.mjs';
import { assessmentBudgetRoute } from './worker/resume-assessment-budget.mjs';
import { createAssessmentBudgetClient } from './src/js/resume-assessment-budget-client.mjs';
import { createAssessmentHistory, validateAssessmentHistory, historyHash } from './src/js/resume-assessment-history.mjs';
import { createAssessmentHistoryStore } from './worker/resume-assessment-history.mjs';
import { compareCandidateAssessments } from './src/js/resume-assessment-comparison.mjs';
import { resumeCompletionReservation } from './src/js/resume-review.mjs';
import { validateStudioProbeBody } from './tools/resume-assessment-studio-bridge.mjs';

function schemaAccepts(schema, value, root = schema) {
  if (schema.$ref) return schemaAccepts(root.$defs[schema.$ref.split('/').at(-1)], value, root);
  if (schema.anyOf) return schema.anyOf.some(item => schemaAccepts(item, value, root));
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => schemaAccepts(schema.items, item, root));
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && schemaAccepts(schema.properties[key], value[key], root));
  return true;
}
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
function bucket() {
  const records = new Map(); let revision = 0;
  return {
    async get(key) {
      const entry = records.get(key);
      return entry && { ...entry, size: entry.bytes.length, json: async () => JSON.parse(new TextDecoder().decode(entry.bytes)),
        arrayBuffer: async () => entry.bytes.slice().buffer };
    },
    async put(key, value, options = {}) {
      const old = records.get(key);
      if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches || options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
      const entry = { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : value.slice(), etag: String(++revision), httpMetadata: options.httpMetadata };
      records.set(key, entry); return { etag: entry.etag };
    },
  };
}
async function fixture({ legacy = false, general = false, mutate, alterRequest, alterReceipt, stopReason = 'end_turn', evidencePolicy = null, contextScenario = null, domainChange,
  provider = 'anthropic', model = 'claude-sonnet-5-5' } = {}) {
  const text = 'Avery\nNo experience with Python.' + (contextScenario ? '\nUsed customer interviews on a fictional handoff process.' : '');
  const input = { kind: 'upload', mediaType: 'text/plain', bytes: new TextEncoder().encode(text),
    target: { company: 'Example', role: 'Designer', level: 'staff', jd: general ? '' : 'Python' },
    extraction: { text, extractorVersion: 'utf8-text-v1' } };
  const snapshot = await captureAssessmentInput(input), storage = bucket(), bodies = [], requests = [], retained = [];
  const config = { version: 1, provider, maxCost: 6, checkedAt: Date.now(), models: [
    { id: model, pricing: { input: 2, output: 10 }, maxInputTokens: 128000, maxOutputTokens: 12000, contextWindow: 140000,
      reasoning: model !== 'claude-sonnet-5-5', structuredOutput: !legacy },
  ] };
  const reviews = values => values.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted source review.',
    ...(item.evidence ? { evidence: item.evidence, ...(evidencePolicy ? { contextEvidence: [] } : {}) } : {}) }));
  const authority = await createAssessmentBudgetClient({ budget: { scope: 'server', id: 'candidate-review', maxCost: 6, approved: true },
    request: async (action, body) => {
      if (action === 'execute' && alterRequest) alterRequest(body);
      const request = action === 'execute' ? structuredClone(body) : null;
      if (request) requests.push(request);
      const response = await assessmentBudgetRoute(new Request('https://isolated.invalid/admin/resume/assessment/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }), { VAULT: storage, RESUME_ASSESSMENT_POLICY: JSON.stringify(config) }, {}, async () => 'fictional-key',
      async (url, init) => {
        assert.equal(url, provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions');
        const body = JSON.parse(init.body); bodies.push(body);
        if (provider === 'anthropic' && model === 'claude-sonnet-5-5') validateStudioProbeBody(body);
        else {
          assert.equal(Object.hasOwn(body, 'temperature'), false);
          assert.equal(body.model, model); assert.equal(body.stream, false);
        }
        const data = JSON.parse(body.messages.at(-1).content);
        const value = request.stage === 'requirements' ? { revision: 1, segments: [{ id: 'jd-0', disposition: 'criteria', reason: 'Scripted requirement.' }],
          requirements: [{ id: 'python', label: 'Python', importance: 'required', condition: { kind: 'atom', id: 'python', segmentId: 'jd-0', quote: 'Python' } }] }
          : request.stage === 'assessment' ? {
            ratings: general ? [] : [{ id: 'python', state: 'contradicted', reason: 'The source explicitly says no experience.', evidence: ['artifact-1'] }],
            communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: null, reason: 'Not enough evidence.', evidence: [] })),
            semantic: { version: 'source-attribution-v1', excerpts: data.evidence.map(item => ({ id: item.id, kind: 'general', reason: 'Standalone skill statement.' })), groups: [] },
          } : { ratings: reviews(data.draft.ratings), communication: reviews(data.draft.communication), inventoryIssues: [],
            semantic: { version: 'source-attribution-v1', excerpts: reviews(data.evidence), groups: [], segments: reviews(data.segments) } };
        if (contextScenario && request.stage === 'assessment') value.semantic.excerpts.find(item => item.id === 'artifact-2').kind = 'uncertain';
        if (contextScenario && request.stage === 'challenge') {
          if (contextScenario === 'context') value.ratings[0].contextEvidence = [{ id: 'artifact-2', reason: 'The handoff statement provides background but cannot establish or negate Python experience.' }];
          else value.ratings[0].evidence = [...value.ratings[0].evidence, 'artifact-2'];
        }
        if (domainChange) domainChange(request, value);
        const schema = provider === 'anthropic' ? body.output_config?.format?.schema : body.response_format?.json_schema?.schema;
        assert.equal(Boolean(schema), !legacy);
        const wire = schema ? wireValue(schema, value) : value;
        if (schema) assert.ok(schemaAccepts(schema, wire), 'scripted response matches the actual outgoing schema');
        if (mutate) mutate(request, wire);
        return Response.json(provider === 'anthropic' ? { type: 'message', role: 'assistant', id: 'scripted-' + bodies.length, model: request.model,
          stop_reason: request.stage === 'requirements' ? 'end_turn' : stopReason,
          content: [{ type: 'text', text: JSON.stringify(wire) }], usage: { input_tokens: 100, output_tokens: 100 } }
          : { id: 'scripted-' + bodies.length, model: request.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(wire) } }],
            usage: { prompt_tokens: 100, completion_tokens: 100 } });
      }, { retainResponse: async entry => retained.push(structuredClone(entry)) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (action === 'execute' && alterReceipt) alterReceipt(result.receipt);
      return result;
    } });
  let plan;
  const options = { consent: true, provider, model, structuredOutput: !legacy,
    evidencePolicy,
    pricing: { ...config.models[0].pricing, checkedAt: config.checkedAt }, getCurrent: () => snapshot,
    reserve: async value => { plan = value; return authority.reserve(value); },
    invoke: request => authority.invoke(plan.id, request) };
  const inventory = await inventoryCandidateAssessment(snapshot, options);
  const approval = await approveAssessmentInventory(snapshot, inventory, { confirmed: true });
  const selection = approveAssessmentEvidence(snapshot, { confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }] });
  return { input, snapshot, storage, bodies, requests, retained, inventory, options, authority, approval, selection, config,
    run: () => evaluateCandidateAssessment(snapshot, { ...options, approval, selection }) };
}

for (const provider of ['anthropic', 'openai']) test('Explicit structured capabilities support a newly configured ' + provider + ' model without a hardcoded model ID', async () => {
  const item = await fixture({ provider, model: 'fictional-future-model', evidencePolicy: ASSESSMENT_EVIDENCE_POLICY });
  const result = await item.run();
  assert.equal(item.bodies.length, 3);
  assert.ok(result.execution.every(entry => entry.model === 'fictional-future-model' && entry.provider === provider && entry.responseContract === ASSESSMENT_EVIDENCE_CONTRACT));
  assert.deepEqual(await validateEvaluatedAssessment(result, item.snapshot), result);
  const record = await createAssessmentHistory({ input: item.input, result, inventory: item.inventory, label: 'Scripted generic model contract' });
  const store = createAssessmentHistoryStore(item.storage);
  await store.putArtifact(record.artifactSha256, item.input.bytes, item.input.mediaType);
  await store.save(record, '*');
  assert.deepEqual((await store.get(record.id)).record, record);
});

test('Removing verified structured support blocks a new model before inference instead of silently falling back', async () => {
  const item = await fixture({ model: 'fictional-future-model', evidencePolicy: ASSESSMENT_EVIDENCE_POLICY });
  item.config.models[0].structuredOutput = false;
  await assert.rejects(item.run(), /not enabled structured output/);
  assert.equal(item.bodies.length, 1);
});

test('Structured provider requests enforce exact empty targets and preserve decoded history and raw receipts', async () => {
  const item = await fixture(), result = await item.run();
  assert.equal(item.bodies.length, 3);
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'contradicted');
  assert.deepEqual(result.challenge.semantic.groups, []);
  const schema = item.bodies[2].output_config.format.schema;
  assert.deepEqual(schema.properties.semantic.properties.groups, { type: 'object', properties: {}, required: [], additionalProperties: false });
  for (const body of item.bodies) assert.deepEqual(body.thinking, { type: 'adaptive' });
  for (const entry of result.execution) assert.equal(entry.responseContract, 'assessment-semantic-json-v1');
  assert.deepEqual(await validateEvaluatedAssessment(result, item.snapshot), result);
  const record = await createAssessmentHistory({ input: item.input, result, inventory: item.inventory, label: 'Scripted structured result' });
  const history = createAssessmentHistoryStore(item.storage);
  await history.putArtifact(record.artifactSha256, item.input.bytes, item.input.mediaType);
  const saved = await history.save(record, '*');
  assert.equal(saved.receiptStatus, 'server-receipted-not-independent-truth');
  assert.deepEqual((await history.get(record.id)).record, record);
  for (const [index, request] of item.requests.entries()) {
    const retained = item.retained[index];
    assert.equal(retained.requestSha256, await historyHash(assessmentRequestIdentity(request)));
    assert.equal(retained.sha256, await historyHash(retained.receipt));
  }
  assert.deepEqual(JSON.parse(item.retained[2].receipt.text).semantic.groups, {});
  assert.equal(item.bodies.length, 3, 'reopening does not invoke the provider');
});
test('Decision/context policy preserves explicit contradiction without hiding uncertain background or changing legacy results', async () => {
  const current = await fixture({ evidencePolicy: ASSESSMENT_EVIDENCE_POLICY, contextScenario: 'context' });
  const result = await current.run();
  assert.equal(result.evidencePolicy, ASSESSMENT_EVIDENCE_POLICY);
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'contradicted');
  assert.equal(result.interpretation.excerpts.find(item => item.id === 'artifact-2').state, 'unknown');
  assert.equal(result.challenge.ratings[0].contextEvidence[0].id, 'artifact-2');
  assert.ok(result.execution.every(item => item.responseContract === ASSESSMENT_EVIDENCE_CONTRACT));
  assert.match(current.requests[1].system, /do not hide|Do not hide/);
  const record = await createAssessmentHistory({ input: current.input, result, inventory: current.inventory, label: 'Scripted context-policy result' });
  const store = createAssessmentHistoryStore(current.storage);
  await store.putArtifact(record.artifactSha256, current.input.bytes, current.input.mediaType);
  await store.save(record, '*');
  assert.deepEqual((await store.get(record.id)).record, record);
  assert.deepEqual(await validateEvaluatedAssessment(result, current.snapshot), result);
  const old = await fixture({ contextScenario: 'material' }), previous = await old.run(), bytes = JSON.stringify(previous);
  assert.equal(previous.evidencePolicy, undefined);
  assert.equal(previous.report.dimensions.roleEvidence.ratings[0].state, 'unknown');
  assert.equal(JSON.stringify(await validateEvaluatedAssessment(previous, old.snapshot)), bytes);
  const comparison = await compareCandidateAssessments(previous, old.snapshot, result, current.snapshot);
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.reasons.some(reason => reason.includes('decision/context evidence policy')));
});
test('Decision/context policy keeps material uncertainty, disagreement, absence uncertainty and inventory disputes unresolved', async () => {
  for (const scenario of ['material', 'draft-uncertain', 'disagree', 'absence', 'inventory']) {
    const item = await fixture({ evidencePolicy: ASSESSMENT_EVIDENCE_POLICY, contextScenario: scenario === 'material' ? 'material' : 'context',
      domainChange(request, value) {
        if (request.stage === 'assessment' && scenario === 'draft-uncertain') value.semantic.excerpts.find(entry => entry.id === 'artifact-1').kind = 'uncertain';
        if (request.stage === 'assessment' && scenario === 'absence') {
          value.ratings[0].state = 'not-evidenced'; value.ratings[0].evidence = [];
        }
        if (request.stage === 'challenge' && scenario === 'disagree') value.ratings[0].verdict = 'disagree';
        if (request.stage === 'challenge' && scenario === 'inventory') value.inventoryIssues = [{ segmentId: 'jd-0', reason: 'A material qualification was omitted.' }];
      } });
    assert.equal((await item.run()).report.dimensions.roleEvidence.ratings[0].state, 'unknown', scenario);
  }
});
test('Decision/context policy cannot move draft evidence into context, lose support, duplicate sources or hide context fields', async () => {
  for (const change of [
    entry => { entry.contextEvidence[0].id = 'artifact-1'; },
    entry => { entry.evidence = []; },
    entry => { entry.contextEvidence.push({ ...entry.contextEvidence[0] }); },
    entry => { entry.contextEvidence[0].id = 'artifact-0'; },
    entry => { entry.contextEvidence[0].reason = ''; },
    entry => { delete entry.contextEvidence; },
  ]) {
    const item = await fixture({ evidencePolicy: ASSESSMENT_EVIDENCE_POLICY, contextScenario: 'context',
      mutate(request, value) { if (request.stage === 'challenge') change(value.ratings.python); } });
    await assert.rejects(item.run());
    assert.equal(item.bodies.length, 3, 'no repair call or retry');
  }
});
test('Decision/context record policy cannot be removed, forged, mixed or downgraded', async () => {
  const item = await fixture({ evidencePolicy: ASSESSMENT_EVIDENCE_POLICY, contextScenario: 'context' }), result = await item.run();
  for (const change of [
    value => { delete value.evidencePolicy; },
    value => { value.evidencePolicy = 'unrecognized'; },
    value => { delete value.execution[0].responseContract; },
    value => { value.execution[1].responseContract = 'assessment-semantic-json-v1'; },
  ]) {
    const altered = structuredClone(result); change(altered);
    await assert.rejects(validateEvaluatedAssessment(altered, item.snapshot));
  }
  const alteredContext = structuredClone(result); alteredContext.challenge.ratings[0].contextEvidence = [];
  const changedRecord = await createAssessmentHistory({ input: item.input, result: alteredContext, inventory: item.inventory, label: 'Altered context fixture' });
  const store = createAssessmentHistoryStore(item.storage);
  await store.putArtifact(changedRecord.artifactSha256, item.input.bytes, item.input.mediaType);
  await assert.rejects(store.save(changedRecord, '*'));
  const old = await fixture(), legacy = structuredClone(await old.run());
  legacy.evidencePolicy = ASSESSMENT_EVIDENCE_POLICY;
  await assert.rejects(validateEvaluatedAssessment(legacy, old.snapshot));
  const unsupported = await fixture();
  unsupported.options.evidencePolicy = 'unrecognized';
  await assert.rejects(unsupported.run(), /experimental evidence policy/);
  assert.equal(unsupported.bodies.length, 1, 'invalid policy stops before an assessment request');
});
test('Decision/context agreement cannot retain one draft source while silently dropping another', async () => {
  const item = await fixture({ evidencePolicy: ASSESSMENT_EVIDENCE_POLICY, contextScenario: 'context',
    domainChange(request, value) {
      if (request.stage === 'assessment') value.ratings[0].evidence.push('artifact-2');
    },
    mutate(request, value) {
      if (request.stage === 'challenge') {
        value.ratings.python.evidence = ['artifact-1'];
        value.ratings.python.contextEvidence = [];
      }
    } });
  await assert.rejects(item.run(), /retain every draft decision-bearing source/);
  assert.equal(item.bodies.length, 3);
});
test('Decision/context general review keeps empty role targets and does not invent a job inventory call', async () => {
  const item = await fixture({ evidencePolicy: ASSESSMENT_EVIDENCE_POLICY, general: true }), result = await item.run();
  assert.equal(result.report.dimensions.roleEvidence.status, 'not-applicable');
  assert.equal(item.bodies.length, 2);
  assert.ok(result.challenge.communication.every(entry => Array.isArray(entry.contextEvidence)));
  assert.deepEqual(await validateEvaluatedAssessment(result, item.snapshot), result);
});

test('Missing versions, invented groups and altered IDs are rejected without response repair or retry', async () => {
  for (const change of [
    value => { delete value.semantic.version; },
    value => { value.semantic.groups['job-0'] = { id: 'job-0', verdict: 'uncertain', reason: 'The draft has none.' }; },
    value => { value.semantic.excerpts['artifact-1'].id = 'invented'; },
    value => { value.semantic.excerpts = {}; },
    value => { value.inventoryIssues = []; },
    value => { value.inventoryIssues['jd-0'].reason = 'A concrete issue must not be silently discarded.'; },
  ]) {
    const item = await fixture({ mutate: (request, value) => { if (request.stage === 'challenge') change(value); } });
    await assert.rejects(item.run(), error => {
      assert.equal(error.assessmentAttempt.reservations[0].status, 'reserved');
      assert.equal(error.assessmentAttempt.execution.length, 2);
      return true;
    });
    assert.equal(item.bodies.length, 3);
    assert.equal(item.retained.length, 3);
    assert.ok(item.authority.budget().reserved > 0);
  }
});

test('General review, disagreement and uncertainty do not manufacture groups or force agreement', async () => {
  const item = await fixture({ general: true, mutate: (request, value) => {
    if (request.stage === 'challenge') value.semantic.excerpts['artifact-1'] = { id: 'artifact-1', verdict: 'disagree', reason: 'Grouping may be missing; no job can be confidently attributed.' };
  } });
  const result = await item.run();
  assert.equal(item.bodies.length, 2);
  assert.deepEqual(result.challenge.inventoryIssues, []);
  assert.deepEqual(result.challenge.ratings, []);
  assert.equal(result.interpretation.excerpts[0].state, 'unknown');
  assert.match(result.interpretation.excerpts[0].challengeReason, /Grouping may be missing/);
});

test('Old contracts still reconstruct, while removed, mixed or forged new contract markers fail', async () => {
  const item = await fixture(), result = await item.run();
  const old = await fixture({ legacy: true }), legacy = await old.run();
  assert.deepEqual(await validateEvaluatedAssessment(legacy, old.snapshot), legacy);
  const comparison = await compareCandidateAssessments(legacy, old.snapshot, result, item.snapshot);
  assert.ok(comparison.reasons.some(reason => /structured response contract changed/.test(reason)));
  for (const mode of ['removed', 'mixed', 'unknown', 'wrong-context']) {
    const changed = structuredClone(result);
    if (mode === 'removed') changed.execution.forEach(entry => { delete entry.responseContract; });
    if (mode === 'mixed') delete changed.execution[1].responseContract;
    if (mode === 'unknown') changed.execution[0].responseContract = 'unsupported';
    if (mode === 'wrong-context') changed.execution.forEach(entry => { entry.responseContract = 'assessment-json-v1'; });
    await assert.rejects(validateEvaluatedAssessment(changed, item.snapshot), /contract|receipt/);
  }
});

test('Schema bytes count against input bounds and Studio rejects stripped or modified formats', async () => {
  const item = await fixture(); await item.run();
  const request = item.requests[1], body = item.bodies[1], plain = { ...request };
  delete plain.responseContract;
  const pricing = item.options.pricing;
  const extra = new TextEncoder().encode(JSON.stringify(assessmentResponseSchema(request))).length;
  assert.equal(resumeCompletionReservation(request, pricing).inputBound - resumeCompletionReservation(plain, pricing).inputBound, extra);
  const system = 'x'.repeat(110000 - new TextEncoder().encode(plain.user).length - 2048);
  assert.equal(resumeCompletionReservation({ ...plain, system }, pricing).inputBound, 110000);
  assert.throws(() => resumeCompletionReservation({ ...request, system }, pricing), /input exceeds/);
  for (const change of [
    value => { delete value.output_config.format; },
    value => { value.output_config.format.schema.additionalProperties = true; },
    value => { value.output_config.format.schema.properties.ratings.required = []; },
    value => { value.output_config.effort = 'low'; },
  ]) {
    const changed = structuredClone(body); change(changed);
    assert.throws(() => validateStudioProbeBody(changed), /schema|contract|profile/);
  }
});

test('Structured refusals and truncation retain the reservation and do not retry', async () => {
  for (const stopReason of ['refusal', 'max_tokens']) {
    const item = await fixture({ stopReason });
    await assert.rejects(item.run(), /Provider attempt failed/);
    assert.equal(item.bodies.length, 2);
    const ledger = await (await item.storage.get('system/resume-assessment-budget-v1.json')).json();
    assert.equal(ledger.reservations[1].attempts[0].status, 'failed');
    assert.equal(ledger.reservations[1].attempts[1].status, 'reserved');
  }
});

test('Structured failure diagnostics can be retained with an accepted prior result', async () => {
  const item = await fixture(), result = await item.run();
  const broken = await fixture({ mutate: (request, value) => { if (request.stage === 'assessment') delete value.semantic.version; } });
  let failure;
  try { await broken.run(); } catch (error) { failure = error; }
  assert.ok(failure?.assessmentAttempt);
  const record = await createAssessmentHistory({ input: item.input, result, inventory: item.inventory, label: 'Scripted failure preservation',
    failures: [{ at: Date.now(), snapshotFingerprint: item.snapshot.fingerprint, message: failure.message, attempt: failure.assessmentAttempt }] });
  assert.deepEqual((await validateAssessmentHistory(record, item.input.bytes)).record, record);
});

test('Contract changes within a reserved phase fail before dispatch and missing transport acknowledgement fails closed', async () => {
  const mixed = await fixture({ alterRequest: request => { if (request.stage === 'challenge') delete request.responseContract; } });
  await assert.rejects(mixed.run(), /phase output contract changed/);
  assert.equal(mixed.bodies.length, 2);
  await assert.rejects(fixture({ alterReceipt: receipt => { delete receipt.responseContract; } }), /transport did not acknowledge/);
});

test('Larger target sets use no optional fields or per-segment unions and empty maps reject invented targets', async () => {
  const item = await fixture(); await item.run();
  const request = structuredClone(item.requests[2]), data = JSON.parse(request.user);
  data.segments = Array.from({ length: 60 }, (_, index) => ({ id: 'jd-' + index, text: 'Scripted segment.' }));
  request.user = JSON.stringify(data);
  const schema = assessmentResponseSchema(request);
  let unions = 0, optional = 0;
  const visit = node => {
    assert.ok(Object.keys(node).every(key => ['$defs', '$ref', 'type', 'properties', 'required', 'additionalProperties', 'items', 'const', 'enum', 'anyOf'].includes(key)));
    if (node.anyOf) { unions++; node.anyOf.forEach(visit); }
    if (node.properties) {
      assert.equal(node.additionalProperties, false);
      optional += Object.keys(node.properties).filter(key => !node.required.includes(key)).length;
      Object.values(node.properties).forEach(visit);
    }
    if (node.items) visit(node.items);
    if (node.$defs) Object.values(node.$defs).forEach(visit);
    if (node.enum) assert.ok(node.enum.length && node.enum.every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  };
  visit(schema);
  assert.equal(optional, 0); assert.equal(unions, 0);
  assert.equal(Object.keys(schema.properties.inventoryIssues.properties).length, 60);
  const raw = JSON.parse(item.retained[2].receipt.text);
  assert.ok(schemaAccepts(item.bodies[2].output_config.format.schema, raw));
  raw.semantic.groups['job-0'] = { id: 'job-0', verdict: 'uncertain', reason: 'Invented target.' };
  assert.equal(schemaAccepts(item.bodies[2].output_config.format.schema, raw), false);
  assert.throws(() => decodeAssessmentResponse(item.requests[2], raw), /exact keyed targets/);
});
