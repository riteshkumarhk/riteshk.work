import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { inventoryCandidateAssessment, approveAssessmentInventory, approveAssessmentEvidence, evaluateCandidateAssessment, validateEvaluatedAssessment } from './src/js/resume-assessment-evaluator.mjs';
import { SEMANTIC_REVIEW, SEMANTIC_PROMPTS } from './src/js/resume-assessment-semantics.mjs';
import { compareCandidateAssessments, validateAssessmentComparison } from './src/js/resume-assessment-comparison.mjs';

// Captured from this scripted fixture before prompt revision 2 was introduced.
const legacyRequestHashes = [
  '324aadcc6d1d2eb07ffc15bb7f9c5947d3ccd5f6f461fcb58d8a07ddf2e6e744',
  '0d48b85f240ea610061cd15d191803dd3979add08a61a56ff180b99d7d7104b3',
];

async function setup({ negative = false, unreadable = false, general = false } = {}) {
  const text = ['Avery', 'avery@example.test', 'Northstar', 'Lead Designer', '2021 - Present',
    negative ? 'No experience with Python.' : 'Built Python services.', 'Atlas', 'Designer', '2018 - 2021', 'Built Java services.'].join('\n');
  const snapshot = await createAssessmentSnapshot({ target: { company: 'Example', role: 'Designer', level: 'staff', jd: general ? '' : 'Python or Java\nLeadership\nHealth insurance provided' },
    artifact: { bytes: new TextEncoder().encode(text), text, mediaType: unreadable ? 'application/pdf' : 'text/plain', extractorVersion: 'scripted-semantic-fixture',
      semanticReview: SEMANTIC_REVIEW, ...(unreadable ? { pages: [
        ...(unreadable === 'budget' ? [{ width: 600, height: 800, items: Array.from({ length: 2001 }, () => ({ str: 'x', x: 40, y: 40, w: 10, h: 12 })) }] : []),
        { width: 600, height: 800, items: [] }], inspectReadingOrder: 'pdf-order-probes-v1' } : {}) } });
  const included = snapshot.evidence.slice(2), ref = index => ({ id: 'artifact-' + index, quote: snapshot.evidence[index].text });
  const excerptReviews = included.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted source classification check.' }));
  const group = (id, start) => ({ id, employer: ref(start), role: ref(start + 1), dates: ref(start + 2), achievements: [ref(start + 3)], certainty: 'explicit', reason: 'Scripted explicit entry.' });
  const draft = { ratings: general ? [] : [
    { id: 'python', state: negative ? 'contradicted' : 'supported', reason: 'Scripted exact-source judgment.', evidence: ['artifact-5'] },
    { id: 'java', state: 'supported', reason: 'Scripted exact-source judgment.', evidence: ['artifact-9'] },
    { id: 'leadership', state: 'not-evidenced', reason: 'Scripted absence claim.', evidence: [] },
  ], communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 3, reason: 'Scripted anchored judgment.', evidence: ['artifact-5'] })),
  semantic: { version: SEMANTIC_REVIEW, excerpts: included.map(item => ({ id: item.id, kind: 'experience', reason: 'Scripted work-history excerpt.' })), groups: [group('north', 2), group('atlas', 6)] } };
  const checks = values => values.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted challenge, not independent truth.', evidence: item.evidence }));
  const challenge = { ratings: checks(draft.ratings), communication: checks(draft.communication), inventoryIssues: [],
    semantic: { version: SEMANTIC_REVIEW, excerpts: excerptReviews, groups: ['north', 'atlas'].map(id => ({ id, verdict: 'agree', reason: 'Scripted relationship challenge.' })),
      segments: snapshot.jobSegments.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted clause and disposition check.' })) } };
  const atom = (id, segmentId, quote) => ({ kind: 'atom', id, segmentId, quote });
  const manifest = { revision: 1, segments: snapshot.jobSegments.map((item, index) => ({ id: item.id, disposition: index === 2 ? 'benefits' : 'criteria', reason: 'Scripted JD disposition.' })),
    requirements: general ? [] : [{ id: 'tools', label: 'Python or Java', importance: 'required', condition: { kind: 'anyOf', children: [atom('python', 'jd-0', 'Python'), atom('java', 'jd-0', 'Java')] } },
      { id: 'leadership', label: 'Leadership', importance: 'required', condition: atom('leadership', 'jd-1', 'Leadership') }] };
  const calls = [], plans = [];
  const options = { consent: true, provider: 'anthropic', model: 'synthetic-semantic-model', pricing: { input: 1, output: 2, checkedAt: Date.now() },
    getCurrent: () => snapshot, reserve: async plan => { plans.push(plan); return { id: plan.id, amount: plan.amount }; },
    invoke: async request => {
      calls.push(request);
      return { text: JSON.stringify({ requirements: manifest, assessment: draft, challenge }[request.stage]), provider: request.provider,
        model: request.model, requestId: 'synthetic-' + calls.length, usage: { inputTokens: 100, outputTokens: 200 } };
    } };
  const inventory = await inventoryCandidateAssessment(snapshot, options);
  const approval = await approveAssessmentInventory(snapshot, inventory, { confirmed: true });
  const selection = approveAssessmentEvidence(snapshot, { confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }, { id: 'artifact-1', reason: 'contact' }] });
  return { snapshot, draft, challenge, calls, plans, run: () => evaluateCandidateAssessment(snapshot, { ...options, approval, selection }) };
}
test('Complete semantic review binds original groups and all JD segments without new calls or hidden source data', async () => {
  const item = await setup(), result = await item.run();
  assert.equal(result.interpretation.groups.length, 2);
  assert.ok(result.interpretation.groups.every(group => group.state === 'model-agreed'));
  assert.equal(result.interpretation.groups[0].employer.start, item.snapshot.evidence[2].start);
  assert.equal(result.interpretation.segments.length, 3);
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'supported');
  assert.equal(item.calls.length, 3); assert.equal(item.plans[1].stages.length, 2);
  for (const call of item.calls) assert.doesNotMatch(call.user, /avery@example\.test|"quote":"Avery"/);
  assert.doesNotMatch(item.calls[0].user, /Northstar|semantic/);
  assert.match(item.calls[1].system, /SOURCE ATTRIBUTION CONTRACT/);
  assert.match(item.calls[2].system, /EVERY original JD segment/);
  assert.equal(result.report.headline.value, null);
  assert.deepEqual(await validateEvaluatedAssessment(JSON.parse(JSON.stringify(result)), item.snapshot), result);
});
test('Semantic prompt revision preserves exact legacy request bindings', async () => {
  const item = await setup(), result = await item.run();
  assert.equal(result.promptRevision, 2);
  const legacy = structuredClone(result); delete legacy.promptRevision;
  legacy.execution.forEach((entry, index) => { entry.requestSha256 = legacyRequestHashes[index]; });
  const before = JSON.stringify(legacy);
  assert.deepEqual(await validateEvaluatedAssessment(legacy, item.snapshot), legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.deepEqual(await validateEvaluatedAssessment(result, item.snapshot), result);
  assert.equal(item.calls.length, 3);
});
test('Complete response prompts contain one full shape and a mandatory nested version for both stages', async () => {
  const item = await setup(); await item.run();
  for (const call of item.calls.slice(1)) {
    const matches = [...call.system.matchAll(/Return (\{[^\n]+\})\./g)];
    assert.equal(matches.length, 1);
    const example = JSON.parse(matches[0][1]), actual = item[call.stage === 'assessment' ? 'draft' : 'challenge'];
    assert.deepEqual(Object.keys(example).sort(), Object.keys(actual).sort());
    assert.deepEqual(Object.keys(example.semantic).sort(), Object.keys(actual.semantic).sort());
    assert.equal(example.semantic.version, SEMANTIC_REVIEW);
    assert.equal([...call.system.matchAll(/"version":"source-attribution-v1"/g)].length, 1);
    assert.match(call.system, /nested semantic\.version field is mandatory/);
    assert.doesNotMatch(call.system, /Add "semantic":/);
  }
  assert.doesNotMatch(item.calls[0].system, /REQUIRED COMPLETE RESPONSE CONTRACT|source-attribution-v1/);
});
test('Prompt revision cannot be stripped, downgraded, forged or mixed across execution receipts', async () => {
  const item = await setup(), result = await item.run();
  const missing = structuredClone(result); delete missing.promptRevision;
  await assert.rejects(validateEvaluatedAssessment(missing, item.snapshot), /execution receipt does not match/);
  for (const revision of [null, 1, 3, '2']) {
    const changed = structuredClone(result); changed.promptRevision = revision;
    await assert.rejects(validateEvaluatedAssessment(changed, item.snapshot), /unsupported semantic prompt revision/);
  }
  for (const indexes of [[0], [1], [0, 1]]) {
    const mixed = structuredClone(result);
    for (const index of indexes) mixed.execution[index].requestSha256 = legacyRequestHashes[index];
    await assert.rejects(validateEvaluatedAssessment(mixed, item.snapshot), /execution receipt does not match/);
  }
});
test('Missing, null, wrong and misplaced semantic versions still fail without repair or another call', async () => {
  for (const general of [false, true]) for (const stage of ['draft', 'challenge']) {
    for (const mutation of [
      value => { delete value.semantic.version; },
      value => { value.semantic.version = null; },
      value => { value.semantic.version = 'source-attribution-v2'; },
      value => { value.version = value.semantic.version; delete value.semantic.version; },
    ]) {
      const item = await setup({ general });
      mutation(item[stage]); const original = JSON.stringify(item[stage]);
      await assert.rejects(item.run(), error => {
        assert.match(error.message, /invalid record fields|unsupported .*version|invalid response fields/);
        assert.equal(error.assessmentAttempt.reservations[0].status, 'reserved');
        assert.equal(error.assessmentAttempt.execution.length, stage === 'draft' ? 1 : 2);
        return true;
      });
      assert.equal(JSON.stringify(item[stage]), original);
      assert.equal(item.calls.length, (general ? 0 : 1) + (stage === 'draft' ? 1 : 2));
      assert.equal(item.plans.length, general ? 1 : 2);
    }
  }
});
test('A challenge cannot invent the example job group when the draft proposes no groups', async () => {
  const item = await setup();
  item.draft.semantic.groups = [];
  item.challenge.semantic.groups = [{ id: 'job-0', verdict: 'uncertain', reason: 'The draft proposes no groups.' }];
  const before = JSON.stringify(item.challenge);
  await assert.rejects(item.run(), error => {
    assert.match(error.message, /Semantic review: list exceeds the semantic review contract/);
    assert.equal(error.assessmentAttempt.execution.length, 2);
    assert.equal(error.assessmentAttempt.reservations[0].status, 'reserved');
    return true;
  });
  assert.equal(item.calls.length, 3);
  assert.equal(JSON.stringify(item.challenge), before);
  assert.equal(item.draft.semantic.groups.length, 0);
});
test('A legacy-to-current prompt change is an explicit comparison blocker, not an improvement', async () => {
  const item = await setup(), result = await item.run();
  const after = structuredClone(result); after.report.id = crypto.randomUUID(); after.report.createdAt++;
  const sameRevision = await compareCandidateAssessments(result, item.snapshot, after, item.snapshot);
  const legacy = structuredClone(result); delete legacy.promptRevision;
  legacy.execution.forEach((entry, index) => { entry.requestSha256 = legacyRequestHashes[index]; });
  const mixed = await compareCandidateAssessments(legacy, item.snapshot, after, item.snapshot);
  assert.equal(mixed.comparable, false);
  assert.deepEqual(mixed.reasons.filter(reason => !sameRevision.reasons.includes(reason)),
    ['The semantic prompt revision changed. No comparable improvement is asserted.']);
  assert.ok(mixed.rows.every(row => row.direction === 'not-comparable'));
  assert.equal(mixed.counts.improved, 0);
  assert.deepEqual(await validateAssessmentComparison(mixed, legacy, item.snapshot, after, item.snapshot), mixed);
});
test('Disputed employer assignment withholds affected support and communication even when both rating passes agree', async () => {
  const item = await setup();
  item.draft.semantic.groups[0].employer = item.draft.semantic.groups[1].employer;
  item.challenge.semantic.groups[0].verdict = 'disagree';
  const result = await item.run();
  assert.equal(result.interpretation.groups[0].state, 'unknown');
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'unknown');
  assert.equal(result.report.dimensions.roleEvidence.ratings[1].state, 'supported');
  assert.equal(result.report.dimensions.roleEvidence.ratings[2].state, 'unknown');
  assert.ok(result.report.dimensions.communication.ratings.every(rating => rating.rating === null));
  assert.equal(result.draft.ratings[0].state, 'supported');
});
test('An unreviewed clause in a benefits-labelled JD segment invalidates role conclusions rather than silently disappearing', async () => {
  const item = await setup();
  item.challenge.semantic.segments[2].verdict = 'uncertain';
  const result = await item.run();
  assert.ok(result.report.dimensions.roleEvidence.ratings.every(rating => rating.state === 'unknown'));
  assert.ok(result.report.dimensions.communication.ratings.every(rating => rating.rating === 3));
});
test('Unmapped experience words and uncertain classifications cannot borrow an accepted group', async () => {
  const item = await setup();
  item.draft.semantic.groups[0].achievements[0].quote = 'Python';
  let result = await item.run();
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'unknown');
  assert.match(result.interpretation.excerpts.find(excerpt => excerpt.id === 'artifact-5').unmappedText, /Built/);
  const uncertain = await setup();
  uncertain.draft.semantic.excerpts.find(excerpt => excerpt.id === 'artifact-5').kind = 'uncertain';
  result = await uncertain.run();
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'unknown');
});
test('Missing source or JD reviews, excluded quotes, false metadata and duplicate achievement assignments fail without repair', async () => {
  for (const mutate of [
    item => item.draft.semantic.excerpts.pop(),
    item => item.challenge.semantic.segments.pop(),
    item => item.challenge.semantic.groups.pop(),
    item => { item.draft.semantic.groups[0].employer = { id: 'artifact-0', quote: 'Avery' }; },
    item => { item.draft.semantic.groups[0].role = false; },
    item => { item.draft.semantic.groups[0].id = 123; },
    item => { item.draft.semantic.groups[1].achievements = item.draft.semantic.groups[0].achievements; },
    item => { item.draft.semantic.groups[1].achievements = [{ id: 'artifact-5', quote: 'Python' }]; },
    item => { delete item.draft.semantic; },
  ]) {
    const item = await setup(); mutate(item);
    await assert.rejects(item.run(), /Semantic review:|invalid response fields/);
    assert.ok(item.calls.length <= 3); assert.equal(item.plans[1].stages.length, 2);
  }
});
test('General review retains source interpretation without inventing a JD or an inventory call', async () => {
  const item = await setup({ general: true }), result = await item.run();
  assert.equal(item.calls.length, 2); assert.equal(item.plans.length, 1);
  assert.equal(result.report.dimensions.roleEvidence.status, 'not-applicable');
  assert.deepEqual(result.interpretation.segments, []);
  assert.equal(result.interpretation.groups.length, 2);
  assert.deepEqual(await validateEvaluatedAssessment(JSON.parse(JSON.stringify(result)), item.snapshot), result);
});
test('Semantic record failures identify exact paths and bounded expected/received fields without response values', async () => {
  for (const [mutate, path, received] of [
    [item => { item.challenge.semantic.excerpts[0].evidence = ['DO-NOT-LOG-THIS-VALUE']; }, 'challenge.semantic.excerpts[0]', 'evidence'],
    [item => { delete item.challenge.semantic.segments[0].reason; }, 'challenge.semantic.segments[0]', 'keys'],
    [item => { delete item.challenge.semantic.excerpts[0].id; }, 'challenge.semantic.excerpts[0]', 'keys'],
    [item => { item.draft.semantic.groups[0].role = false; }, 'draft.semantic.groups[0].role', 'boolean'],
    [item => { item.draft.semantic.groups[0].achievements[0].extra = 'DO-NOT-LOG-THIS-VALUE'; }, 'draft.semantic.groups[0].achievements[0]', 'extra'],
    [item => { item.challenge.semantic = []; }, 'challenge.semantic', 'array'],
  ]) {
    const item = await setup(); mutate(item);
    await assert.rejects(item.run(), error => {
      assert.ok(error.message.includes('invalid record fields at ' + path));
      assert.match(error.message, /expected keys/); assert.ok(error.message.includes(received));
      assert.doesNotMatch(error.message, /DO-NOT-LOG-THIS-VALUE/);
      assert.equal(error.assessmentAttempt.reservations[0].status, 'reserved');
      assert.ok(!JSON.stringify(error.assessmentAttempt).includes('DO-NOT-LOG-THIS-VALUE'));
      return true;
    });
  }
});
test('Existing semantic prompt examples match strict record fields without rewriting historical prompts', async () => {
  const item = await setup();
  for (const [stage, actual] of [['assessment', item.draft.semantic], ['challenge', item.challenge.semantic]]) {
    const example = JSON.parse(SEMANTIC_PROMPTS[stage].match(/Add "semantic":(\{[^\n]+\})\./)[1]);
    const keys = value => Object.keys(value).sort();
    assert.deepEqual(keys(example), keys(actual));
    for (const field of ['excerpts', 'groups', ...(stage === 'challenge' ? ['segments'] : [])]) {
      assert.deepEqual(keys(example[field][0]), keys(actual[field][0]));
    }
    if (stage === 'assessment') for (const field of ['role', 'employer']) assert.deepEqual(keys(example.groups[0][field]), keys(actual.groups[0][field]));
  }
});
test('Semantic deterioration, unknown PDF pages and saved-result tampering do not preserve a success-shaped judgment', async () => {
  const negative = await setup({ negative: true }), declined = await negative.run();
  assert.equal(declined.report.dimensions.roleEvidence.ratings[0].state, 'contradicted');
  const unreadable = await setup({ unreadable: true }), partial = await unreadable.run();
  assert.equal(partial.report.dimensions.roleEvidence.ratings[2].state, 'unknown');
  const bounded = await setup({ unreadable: 'budget' }), boundedResult = await bounded.run();
  assert.deepEqual(bounded.snapshot.artifact.readingOrder.pages, []);
  assert.equal(boundedResult.report.dimensions.roleEvidence.ratings[2].state, 'unknown');
  const changed = structuredClone(declined); changed.interpretation.groups[0].employer.quote = 'Invented employer';
  await assert.rejects(validateEvaluatedAssessment(changed, negative.snapshot), /altered/);
  const stripped = structuredClone(declined); delete stripped.interpretation;
  await assert.rejects(validateEvaluatedAssessment(stripped, negative.snapshot), /invalid response fields/);
});
