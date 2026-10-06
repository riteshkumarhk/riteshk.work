import test from 'node:test';
import assert from 'node:assert/strict';
import { createResume, resumeFields, resumeSignature, editResumeField } from './src/js/resume-workspace.mjs';
import { mapResumePdfEvidence } from './src/js/resume-pdf.mjs';
import { createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { createAssessmentPilot } from './src/js/resume-assessment-pilot.mjs';
import { proposeAssessmentRevision, validateAssessmentRevision, commitAssessmentRevision } from './src/js/resume-assessment-revisions.mjs';
import { assessmentResponseSchema } from './src/js/resume-assessment-output.mjs';

async function fixture({ excludedTail = false, maxCost = 10 } = {}) {
  const before = excludedTail ? 'Built Python services.\nPrivate contact detail.' : 'Built Python services with the team; reduced review time by 12%.';
  const document = createResume({ id: 'fictional-revision-doc', name: 'Fictional', target: { company: 'Example', role: 'Designer', level: 'staff', jd: 'Python' },
    model: { name: 'Avery', title: 'Product Designer', summary: '', contact: { email: 'private@example.test', links: [] },
      sections: [{ id: 'experience', kind: 'experience', heading: 'Experience', items: [{ id: 'north', role: 'Lead Designer', org: 'Northstar', dates: '2021 - Present', location: '',
        bullets: [{ id: 'work', text: before }] }] }] } });
  const lines = resumeFields(document.model).filter(field => field.value).flatMap(field => field.value.split('\n'));
  const pages = [{ width: 600, height: 800, items: lines.map((str, index) => ({ str, x: 40, y: 40 + index * 18, w: 450, h: 12, hasEOL: true })) }];
  const extracted = mapResumePdfEvidence(pages, document);
  const snapshot = await createAssessmentSnapshot({ document, documentVersion: 1, target: document.target,
    artifact: { bytes: new TextEncoder().encode(extracted.text), mediaType: 'application/pdf', text: extracted.text, pages,
      extractorVersion: 'scripted-revision-fixture', rendererVersion: 1, inspectStructure: 'authored-pdf-order-v1', bindPdfEvidence: 'pdf-evidence-map-v1', semanticReview: 'source-attribution-v1' } });
  const ref = quote => ({ id: snapshot.evidence.find(item => item.text === quote).id, quote });
  const work = ref(before.split('\n')[0]);
  const excluded = snapshot.evidence.filter(item => ['Avery', 'private@example.test', 'Private contact detail.'].includes(item.text))
    .map(item => ({ id: item.id, reason: item.text === 'Avery' ? 'name' : 'contact' }));
  const included = snapshot.evidence.filter(item => !excluded.some(value => value.id === item.id));
  const metadata = ['Lead Designer', 'Northstar', '2021 - Present', before.split('\n')[0]];
  const assessmentDraft = { ratings: [{ id: 'python', state: 'mentioned', reason: 'Clarify the contribution without strengthening ownership.', evidence: [work.id] }],
    communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 2, reason: 'Clarify the same contribution.', evidence: [work.id] })),
    semantic: { version: 'source-attribution-v1', excerpts: included.map(item => ({ id: item.id, kind: metadata.includes(item.text) ? 'experience' : 'general', reason: 'Scripted classification.' })),
      groups: [{ id: 'north', role: ref('Lead Designer'), employer: ref('Northstar'), dates: ref('2021 - Present'), achievements: [work], certainty: 'explicit', reason: 'Scripted entry.' }] } };
  const reviews = entries => entries.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted review.', ...(item.evidence ? { evidence: item.evidence } : {}) }));
  const outputs = {
    requirements: { revision: 1, segments: [{ id: 'jd-0', disposition: 'criteria', reason: 'Scripted criterion.' }],
      requirements: [{ id: 'python', label: 'Python', importance: 'required', condition: { kind: 'atom', id: 'python', segmentId: 'jd-0', quote: 'Python' } }] },
    assessment: assessmentDraft,
    assessmentChallenge: { ratings: reviews(assessmentDraft.ratings), communication: reviews(assessmentDraft.communication), inventoryIssues: [],
      semantic: { version: 'source-attribution-v1', excerpts: reviews(included), groups: reviews([{ id: 'north' }]), segments: reviews(snapshot.jobSegments) } },
    revision: { kind: 'revision', after: 'With the team, built Python services and reduced review time by 12%.', reason: 'Clarify phrasing without changing the contribution.',
      claims: [{ id: 'claim-1', quote: 'With the team, built Python services and reduced review time by 12%.', evidence: [work] }] },
    revisionChallenge: { verdict: 'agree', reason: 'Scripted whole-text preservation check.', claims: [{ id: 'claim-1', verdict: 'agree', reason: 'Scripted support, not independent truth.' }] },
  };
  const calls = [], plans = [], values = new Map(); let current = snapshot, queue = Promise.resolve();
  const options = { consent: true, provider: 'anthropic', model: 'scripted-revision-model', pricing: { input: 1, output: 2, checkedAt: Date.now() },
    getCurrent: () => current, reserve: async plan => { plans.push(plan); return { id: plan.id, amount: plan.amount }; },
    invoke: async request => {
      calls.push(request);
      const data = JSON.parse(request.user), key = request.stage === 'challenge' ? (data.field ? 'revisionChallenge' : 'assessmentChallenge') : request.stage;
      return { text: JSON.stringify(outputs[key]), provider: request.provider, model: request.model, requestId: 'scripted-' + calls.length, usage: null };
    } };
  const pilot = await createAssessmentPilot({ ...options, snapshot, budget: { id: 'revision-fixture', scope: 'browser-origin', approved: true, maxCost },
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    locks: { request(key, action) { const next = queue.then(action); queue = next.catch(() => {}); return next; } } });
  await pilot.inventory({ confirmed: true }); await pilot.approveInventory({ confirmed: true }); await pilot.approveEvidence({ confirmed: true, excluded });
  const assessment = await pilot.evaluate({ confirmed: true });
  const input = { document, version: 1, findingId: 'role-python', fieldId: 'work' };
  return { snapshot, assessment, input, options, outputs, calls, plans, pilot, values, setCurrent: value => { current = value; },
    run: () => proposeAssessmentRevision(snapshot, assessment, input, options) };
}
test('Structured revisions preserve all three decisions, exact claim targets and historical verification', async () => {
  for (const kind of ['revision', 'question', 'supported']) {
    const item = await fixture();
    if (kind === 'question') item.outputs.revision = { kind, question: 'Which part did you own?', reason: 'Only team participation is established.' };
    if (kind === 'supported') item.outputs.revision = { kind, reason: 'The current contribution is already documented.',
      evidence: item.outputs.revision.claims[0].evidence };
    if (kind !== 'revision') item.outputs.revisionChallenge.claims = [];
    const options = { ...item.options, model: 'claude-sonnet-5-5', invoke: async request => {
      const receipt = await item.options.invoke(request), raw = JSON.parse(receipt.text);
      const schema = assessmentResponseSchema(request);
      if (request.stage === 'challenge') {
        assert.deepEqual(Object.keys(schema.properties.claims.properties), kind === 'revision' ? ['claim-1'] : []);
        raw.claims = Object.fromEntries(raw.claims.map(claim => [claim.id, claim]));
      } else assert.equal(schema.anyOf.length, 3);
      return { ...receipt, text: JSON.stringify(raw), responseContract: request.responseContract };
    } };
    const revision = await proposeAssessmentRevision(item.snapshot, item.assessment, item.input, options);
    assert.equal(revision.interpretation.status, kind === 'revision' ? 'review-required' : kind);
    assert.ok(revision.execution.every(entry => entry.responseContract === 'revision-json-v1'));
    assert.deepEqual(await validateAssessmentRevision(revision, item.snapshot, item.assessment, item.input), revision);
    const altered = structuredClone(revision); delete altered.execution[1].responseContract;
    await assert.rejects(validateAssessmentRevision(altered, item.snapshot, item.assessment, item.input), /contract|receipt/);
    assert.equal(item.calls.length, 5);
  }
});
test('Revision reserves both calls, covers every claim, retains exact evidence and never sends document identity or excluded text', async () => {
  const item = await fixture(), revision = await item.run();
  assert.equal(revision.interpretation.status, 'review-required');
  assert.equal(revision.interpretation.verification, 'model-challenged-not-independent');
  assert.deepEqual(item.plans[0].stages.map(item => item.stage), ['revision', 'challenge']);
  assert.equal(item.calls.length, 5);
  for (const request of item.calls.slice(3)) {
    assert.doesNotMatch(request.user, /private@example\.test|fictional-revision-doc|"documentSignature"|"pdfSpans"/);
    assert.equal(request.singleAttempt, true);
  }
  assert.equal(revision.interpretation.claims[0].evidence[0].source, 'submitted-artifact');
  assert.deepEqual(await validateAssessmentRevision(JSON.parse(JSON.stringify(revision)), item.snapshot, item.assessment, item.input), revision);
});
test('Uncovered wording, overlapping claims, missing claim reviews, invented/excluded citations and malformed records fail without repair', async () => {
  for (const change of [
    item => { item.outputs.revision.claims[0].quote = 'Python'; },
    item => { item.outputs.revision.claims.push({ ...item.outputs.revision.claims[0], id: 'claim-2' }); },
    item => { item.outputs.revisionChallenge.claims = []; },
    item => { item.outputs.revision.claims[0].evidence[0] = { id: 'artifact-0', quote: 'Avery' }; },
    item => { item.outputs.revision.claims[0].evidence[0].quote = 'Invented source'; },
    item => { item.outputs.revision.fieldId = 'different-field'; },
  ]) {
    const item = await fixture(); change(item);
    await assert.rejects(item.run(), /Assessment revision:/);
    assert.ok(item.calls.length <= 5); assert.equal(item.plans.length, 1);
  }
});
test('A whole-text or claim disagreement blocks Apply even with matching numbers and otherwise agreeing checks', async () => {
  for (const field of ['whole', 'claim']) {
    const item = await fixture();
    if (field === 'whole') item.outputs.revisionChallenge.verdict = 'disagree';
    else item.outputs.revisionChallenge.claims[0].verdict = 'uncertain';
    const value = await item.run();
    assert.equal(value.interpretation.status, 'blocked'); assert.ok(value.interpretation.blockers.length);
  }
  const item = await fixture();
  item.outputs.revision.after = item.outputs.revision.claims[0].quote = 'Led the team and increased revenue by 12%.';
  item.outputs.revisionChallenge.claims[0] = { id: 'claim-1', verdict: 'disagree', reason: 'Participation became leadership and review-time reduction became revenue; matching 12% does not support these claims.' };
  assert.equal((await item.run()).interpretation.status, 'blocked');
});
test('Unsupported numbers block even an agreeing model; author evidence stays explicitly author-provided', async () => {
  const item = await fixture();
  item.outputs.revision.after = item.outputs.revision.claims[0].quote = 'Reduced review time by 99%.';
  let value = await item.run();
  assert.equal(value.interpretation.status, 'blocked'); assert.match(value.interpretation.blockers.join(' '), /number/);
  item.input.authorEvidence = { text: 'Reduced review time by 99%.', confirmed: true };
  item.outputs.revision.claims[0].evidence = [{ id: 'author-0', quote: item.input.authorEvidence.text }];
  value = await item.run();
  assert.equal(value.interpretation.status, 'review-required');
  assert.equal(value.interpretation.claims[0].evidence[0].source, 'author-provided');
  assert.equal(value.interpretation.claims[0].evidence[0].interpretation, 'author-confirmed-not-independent');
  item.input.authorEvidence.confirmed = false;
  await assert.rejects(item.run(), /author-provided/);
  const count = item.calls.length;
  item.input.authorEvidence = { text: 'x'.repeat(8001), confirmed: true };
  await assert.rejects(item.run(), /bounded text/); assert.equal(item.calls.length, count);
});
test('Questions and no-change decisions are challenged without forced rewrites or treating new author facts as existing resume evidence', async () => {
  const item = await fixture();
  item.outputs.revision = { kind: 'question', question: 'What part did you own?', reason: 'The submitted passage only establishes team participation.' };
  item.outputs.revisionChallenge.claims = [];
  assert.equal((await item.run()).interpretation.status, 'question');
  const evidence = [{ id: item.assessment.draft.ratings[0].evidence[0], quote: item.input.document.model.sections[0].items[0].bullets[0].text }];
  item.outputs.revision = { kind: 'supported', reason: 'The existing wording is sufficient under this scripted decision.', evidence };
  assert.equal((await item.run()).interpretation.status, 'supported');
  item.input.authorEvidence = { text: 'Owned the whole project.', confirmed: true };
  item.outputs.revision.evidence = [{ id: 'author-0', quote: 'Owned the whole project.' }];
  await assert.rejects(item.run(), /correct origin/);
});
test('Stale versions, unmapped fields and excluded field fragments fail before a revision request', async () => {
  for (const change of [
    item => { item.input.version = 2; },
    item => { item.input.fieldId = 'contact.email'; },
    item => { item.input.document.model.summary = 'Changed'; },
    item => { item.input.findingId = 'artifact-positions'; },
  ]) {
    const item = await fixture(); change(item);
    await assert.rejects(item.run(), /Assessment revision:/); assert.equal(item.calls.length, 3);
  }
  const partial = await fixture({ excludedTail: true });
  assert.equal(partial.snapshot.artifact.structure.rows.fields.find(item => item.id === 'work').state, 'located');
  await assert.rejects(partial.run(), /excluded text/); assert.equal(partial.calls.length, 3);
});
test('Saved revision tampering cannot change after text, claim verdicts, provenance or execution receipts', async () => {
  const item = await fixture(), value = await item.run();
  for (const mutate of [
    changed => { changed.draft.after += ' Invented'; },
    changed => { changed.interpretation.status = 'supported'; },
    changed => { changed.context.authorEvidence = { text: 'Fake', confirmed: true }; },
    changed => { changed.execution[1].requestSha256 = '0'.repeat(64); },
    changed => { changed.reservations[0].amount = 0.000001; },
  ]) {
    const changed = structuredClone(value); mutate(changed);
    await assert.rejects(validateAssessmentRevision(changed, item.snapshot, item.assessment, item.input));
  }
});
test('Pilot revisions share the existing budget, require fresh consent and restore validated receipts without extra calls', async () => {
  const item = await fixture(), reserved = item.pilot.budget().reserved;
  await assert.rejects(item.pilot.proposeRevision(item.input), /approve/);
  const value = await item.pilot.proposeRevision({ ...item.input, confirmed: true });
  assert.ok(item.pilot.budget().reserved > reserved);
  assert.equal(item.pilot.revisionHistory()[0].id, value.id);
  assert.deepEqual(await item.pilot.restoreRevision(value.id, item.input), value);
  assert.equal(item.calls.length, 5);
  const ledger = JSON.parse([...item.values.values()][0]); ledger.revisions[0].draft.after += ' Fake';
  item.values.set([...item.values.keys()][0], JSON.stringify(ledger));
  await assert.rejects(item.pilot.restoreRevision(value.id, item.input));
  const limited = await fixture({ maxCost: 0.5 }), budget = limited.pilot.budget();
  await assert.rejects(limited.pilot.proposeRevision({ ...limited.input, confirmed: true }), /budget is exhausted/);
  assert.equal(limited.calls.length, 3); assert.deepEqual(limited.pilot.budget(), budget);
});
function persistence(item) {
  let record = structuredClone({ document: item.input.document, version: 1 });
  const events = [], records = [];
  return { events, records, getRecord: () => structuredClone(record), setRecord: value => { record = value; },
    checkpoint: async label => { events.push(label); record.version++; records.push(structuredClone(record)); return structuredClone(record); },
    save: async (document, options) => {
      assert.equal(options.expectedVersion, record.version); assert.equal(options.expectedSignature, resumeSignature(record.document));
      events.push(options.label); record = { document, version: record.version + 1 }; records.push(structuredClone(record)); return structuredClone(record);
    } };
}
test('Checked Apply saves the exact named before checkpoint, changes only the selected field, retains provenance and refuses replay', async () => {
  const item = await fixture(), revision = await item.run(), store = persistence(item);
  const options = { revision, snapshot: item.snapshot, assessment: item.assessment, ...store, confirmed: true };
  const result = await commitAssessmentRevision(options);
  assert.equal(store.events.length, 2); assert.equal(store.events[0], 'Before candidate revision: ' + revision.id);
  assert.equal(store.records[0].document.model.sections[0].items[0].bullets[0].text, revision.context.before);
  assert.equal(result.document.model.sections[0].items[0].bullets[0].text, revision.draft.after);
  assert.deepEqual(result.document.candidateEdits[0].revision, revision);
  const expected = editResumeField(item.input.document, 'work', revision.draft.after);
  assert.equal(resumeSignature(result.document), resumeSignature(expected));
  assert.equal(item.calls.length, 5);
  await assert.rejects(commitAssessmentRevision(options), /current saved/);
});
test('Apply stops on missing consent, failed checkpoints, concurrent edits, cancellation or unacknowledged saves', async () => {
  for (const mode of ['consent', 'checkpoint', 'race', 'abort', 'save']) {
    const item = await fixture(), revision = await item.run(), store = persistence(item), controller = new AbortController();
    const options = { revision, snapshot: item.snapshot, assessment: item.assessment, ...store, confirmed: mode !== 'consent', signal: controller.signal };
    if (mode === 'checkpoint') options.checkpoint = async () => { throw new Error('Checkpoint unavailable'); };
    if (mode === 'race') options.checkpoint = async label => {
      const saved = await store.checkpoint(label), changed = structuredClone(saved);
      changed.document.model.summary = 'Concurrent edit'; store.setRecord(changed); return saved;
    };
    if (mode === 'abort') options.checkpoint = async label => { const saved = await store.checkpoint(label); controller.abort(); return saved; };
    if (mode === 'save') options.save = async () => ({ document: item.input.document, version: 2 });
    await assert.rejects(commitAssessmentRevision(options));
    assert.equal(store.getRecord().document.model.sections[0].items[0].bullets[0].text, revision.context.before);
  }
});
