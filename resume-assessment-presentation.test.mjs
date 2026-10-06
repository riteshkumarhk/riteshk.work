import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessmentPresentation } from './src/js/resume-assessment-presentation.mjs';
import { createSampleAssessmentPilot } from './src/js/resume-assessment-sample.mjs';
import { createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { inventoryCandidateAssessment, approveAssessmentInventory, approveAssessmentEvidence, evaluateCandidateAssessment } from './src/js/resume-assessment-evaluator.mjs';
import { createResume, resumeFields } from './src/js/resume-workspace.mjs';
import { mapResumePdfEvidence } from './src/js/resume-pdf.mjs';

async function sample(id) {
  const { pilot, snapshot } = await createSampleAssessmentPilot(id);
  await pilot.inventory({ confirmed: true }); await pilot.approveInventory({ confirmed: true });
  await pilot.approveEvidence({ confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }, { id: 'artifact-1', reason: 'contact' }] });
  const result = await pilot.evaluate({ confirmed: true });
  return { result, snapshot, view: await createAssessmentPresentation(result, snapshot) };
}
async function fixture({ general = false, inventoryIssue = false, pdf = false, bounds = false, duplicateField = false, state = 'mentioned', communication = 3 } = {}) {
  const target = { company: 'Example', role: 'Designer', level: 'staff', jd: general ? '' : 'Python' };
  const document = createResume({ id: 'fixture-resume', target, model: { name: 'Avery', title: 'Product Designer', summary: '', contact: { email: 'avery@example.test', links: [] },
    sections: [{ id: 'experience', kind: 'experience', heading: 'Experience', items: [{ id: 'north', role: 'Lead Designer', org: 'Northstar', dates: '2021 - Present', location: '',
      bullets: [{ id: 'python-work', text: 'Built Python services.' }] }] }] } });
  if (duplicateField) document.model.sections[0].items[0].bullets.push({ id: 'repeated-work', text: 'Built Python services.' });
  const fields = resumeFields(document.model).filter(field => field.value);
  const pages = [{ width: 600, height: 800, items: fields.map((field, index) => ({ str: field.value, x: bounds && index === fields.length - 1 ? -20 : 40,
    y: 760 - index * 20, w: 200, h: 12, hasEOL: true })) }];
  const text = pdf ? mapResumePdfEvidence(pages, document).text : fields.map(field => field.value).join('\n');
  const snapshot = await createAssessmentSnapshot({ target, ...(pdf ? { document, documentVersion: 1 } : {}),
    artifact: { text, bytes: new TextEncoder().encode('fictional-byte-binding:' + text), mediaType: pdf ? 'application/pdf' : 'text/plain', extractorVersion: 'presentation-fixture-v1',
      ...(pdf ? { pages, rendererVersion: 1, inspectStructure: 'authored-pdf-order-v1', bindPdfEvidence: 'pdf-evidence-map-v1' } : {}) } });
  const evidence = [snapshot.evidence.find(item => item.text === 'Built Python services.').id];
  const outputs = {
    requirements: { revision: 1, segments: snapshot.jobSegments.map(item => ({ id: item.id, disposition: 'criteria', reason: 'Fictional job requirement.' })),
      requirements: general ? [] : [{ id: 'python', label: 'Python', importance: 'required', condition: { kind: 'atom', id: 'python', segmentId: 'jd-0', quote: 'Python' } }] },
    assessment: { ratings: general ? [] : [{ id: 'python', state, reason: 'The source describes service building; confirm the scope required by the criterion.', evidence }],
      communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: communication, reason: 'The contribution and outcome need clarification in this fictional judgment.', evidence })) },
  };
  const challenge = items => items.map(item => ({ id: item.id, verdict: 'agree', reason: 'Fictional agreement, not factual verification.', evidence: item.evidence }));
  outputs.challenge = { ratings: challenge(outputs.assessment.ratings), communication: challenge(outputs.assessment.communication),
    inventoryIssues: inventoryIssue ? [{ segmentId: 'jd-0', reason: 'A material clause needs confirmation.' }] : [] };
  let calls = 0;
  const options = { consent: true, provider: 'anthropic', model: 'scripted-presentation', pricing: { input: 1, output: 2, checkedAt: Date.now() },
    getCurrent: () => snapshot, reserve: async plan => ({ id: plan.id, amount: plan.amount }),
    invoke: async request => ({ text: JSON.stringify(outputs[request.stage]), provider: request.provider, model: request.model, requestId: 'scripted-' + ++calls, usage: null }) };
  const inventory = await inventoryCandidateAssessment(snapshot, options), approval = await approveAssessmentInventory(snapshot, inventory, { confirmed: true });
  const selection = approveAssessmentEvidence(snapshot, { confirmed: true, excluded: snapshot.evidence.filter(item => ['Avery', 'avery@example.test'].includes(item.text))
    .map(item => ({ id: item.id, reason: item.text === 'Avery' ? 'name' : 'contact' })) });
  const result = await evaluateCandidateAssessment(snapshot, { ...options, approval, selection });
  const view = await createAssessmentPresentation(result, snapshot);
  return { result, snapshot, view, calls };
}

test('Shared presentation preserves the validated envelope and does not turn an unused OR alternative into a gap', async () => {
  const { result, view } = await sample('dev-alternatives');
  assert.deepEqual(view.assessment, result); assert.deepEqual(result.report.findings, []);
  assert.equal(view.summary.headline.value, null);
  assert.deepEqual(view.summary.role, { applicable: true, total: 2, supported: 1, unresolved: 1, requiredGaps: ['leadership'] });
  const keep = view.findings.find(item => item.id === 'role-tools');
  assert.equal(keep.action.kind, 'no-change-needed'); assert.deepEqual(keep.references.atoms, ['python', 'java']);
  assert.equal(view.findings.some(item => item.id === 'role-java'), false);
  assert.equal(view.findings.find(item => item.id === 'role-leadership').action.kind, 'ask');
  assert.equal(view.summary.nextFindingId, 'role-leadership');
  assert.ok(view.findings.every(item => item.fieldMapping === 'not-established' && item.affectedFieldIds.length === 0));
});
test('Source attribution produces one shared cause for affected role and communication findings, retaining exact evidence', async () => {
  const { view } = await sample('dev-attribution');
  const source = view.findings.find(item => item.id === 'source-group-north');
  assert.equal(source.priority, 1); assert.ok(source.evidenceIds.includes('artifact-5'));
  assert.deepEqual(source.references.requirements, ['criterion']);
  assert.deepEqual(source.references.communication, ['scope', 'outcomes', 'clarity']);
  assert.equal(view.findings.some(item => item.id === 'role-criterion' || item.category === 'communication'), false);
  assert.equal(new Set(view.findings.map(item => item.id)).size, view.findings.length);
  assert.ok(view.findings.every(item => item.evidenceIds.every(id => view.assessment.selection.includedIds.includes(id))));
});
test('A complete JD challenge is shown once rather than duplicated for every withheld role judgment', async () => {
  const { view, calls } = await fixture({ inventoryIssue: true });
  const target = view.findings.find(item => item.id === 'target-inventory');
  assert.deepEqual(target.references.segments, ['jd-0']); assert.deepEqual(target.references.requirements, ['python']);
  assert.equal(view.findings.filter(item => item.category === 'role').length, 0);
  assert.equal(view.summary.nextFindingId, target.id); assert.equal(calls, 3);
});
test('General mode has no invented job match, while communication uncertainty remains actionable without extra calls', async () => {
  const { view, calls } = await fixture({ general: true, communication: null });
  assert.equal(view.summary.role.applicable, false); assert.equal(view.summary.role.total, 0);
  assert.equal(view.summary.communication.unresolved, 3); assert.equal(view.findings.length, 1);
  assert.deepEqual(view.findings[0].references.communication, ['scope', 'outcomes', 'clarity']);
  assert.ok(view.findings.every(item => item.action.kind === 'ask')); assert.equal(calls, 2);
  const clear = await fixture({ general: true, communication: 4 });
  assert.deepEqual(clear.view.findings, []); assert.equal(clear.view.summary.nextFindingId, null);
  assert.equal(clear.view.summary.headline.value, null);
});
test('Measured physical-bound failures precede required gaps and only verified PDF locations map authored fields', async () => {
  const { view } = await fixture({ pdf: true, bounds: true });
  assert.equal(view.summary.status, 'blocked'); assert.equal(view.summary.nextFindingId, 'artifact-physical-bounds');
  const finding = view.findings.find(item => item.id === 'role-python');
  assert.deepEqual(finding.affectedFieldIds, ['python-work']);
  assert.equal(finding.fieldMapping, 'checked-pdf-location-overlap');
  assert.equal(finding.action.kind, 'ask');
  assert.ok(view.findings.every((item, index) => !index || view.findings[index - 1].priority <= item.priority));
  const ambiguous = await fixture({ pdf: true, duplicateField: true });
  assert.deepEqual(ambiguous.view.findings.find(item => item.id === 'role-python').affectedFieldIds, []);
});
test('Contradictions remain gaps rather than positive support, and known low communication judgments retain their reasons', async () => {
  const { view } = await fixture({ state: 'contradicted', communication: 1 });
  const finding = view.findings.find(item => item.id === 'role-python');
  assert.match(finding.gaps.join(' '), /contradicted/); assert.equal(finding.priority, 2);
  assert.equal(view.summary.role.supported, 0); assert.equal(view.summary.role.unresolved, 0);
  assert.equal(view.findings.filter(item => item.category === 'communication').length, 1);
  assert.deepEqual(view.findings.find(item => item.category === 'communication').references.communication, ['scope', 'outcomes', 'clarity']);
  assert.ok(view.findings.every(item => item.expectedBenefit && item.priorityReason && item.action.label));
});
test('History regenerates identical immutable identities; modified results, standalone foundations and wrong snapshots fail', async () => {
  const { result, snapshot, view } = await sample('dev-negation');
  assert.deepEqual(await createAssessmentPresentation(JSON.parse(JSON.stringify(result)), snapshot), view);
  assert.throws(() => { view.findings[0].priority = 4; }, TypeError);
  const changed = structuredClone(result); changed.report.dimensions.roleEvidence.ratings[0].state = 'supported';
  await assert.rejects(createAssessmentPresentation(changed, snapshot), /does not match its bound inputs/);
  await assert.rejects(createAssessmentPresentation(result.report, snapshot), /invalid response fields/);
  const other = await fixture();
  await assert.rejects(createAssessmentPresentation(result, other.snapshot), /snapshot|fields/);
});
