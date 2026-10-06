import test from 'node:test';
import assert from 'node:assert/strict';
import { createResume, resumeFields } from './src/js/resume-workspace.mjs';
import { mapResumePdfEvidence } from './src/js/resume-pdf.mjs';
import { createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { createAssessmentPilot } from './src/js/resume-assessment-pilot.mjs';
import { compareCandidateAssessments, validateAssessmentComparison } from './src/js/resume-assessment-comparison.mjs';

function store() {
  const values = new Map(); let queue = Promise.resolve();
  const shared = { values, calls: [], rejectComparison: false,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
      if (shared.rejectComparison && JSON.parse(value).comparisons?.length) throw new Error('Comparison storage unavailable');
      values.set(key, value);
    } },
    locks: { request(key, action) { const next = queue.then(action); queue = next.catch(() => {}); return next; } },
  };
  return shared;
}
async function fixture(config = {}, shared = store()) {
  const { text = 'Built Python services.', state = 'mentioned', rating = 2, model = 'scripted-recheck-model', version = 1,
    documentId = 'recheck-fixture', role = 'Designer', extractor = 'comparison-fixture-v1', renderer = 1, importance = 'required', extraExclusion = false } = config;
  const document = createResume({ id: documentId, target: { company: 'Example', role, level: 'staff', jd: 'Python' },
    model: { name: 'Avery', title: 'Product Designer', summary: '', contact: { email: 'private@example.test', links: [] },
      sections: [{ id: 'experience', heading: 'Experience', kind: 'experience', items: [{ id: 'north', role: 'Lead Designer', org: 'Northstar', dates: '2021 - Present', location: '',
        bullets: [{ id: 'work', text }] }] }] } });
  const fields = resumeFields(document.model).filter(item => item.value);
  const pages = [{ width: 600, height: 800, items: fields.map((field, index) => ({ str: field.value, x: 40, y: 40 + index * 18, w: 400, h: 12, hasEOL: true })) }];
  const extraction = mapResumePdfEvidence(pages, document);
  const snapshot = await createAssessmentSnapshot({ document, documentVersion: version, target: document.target,
    artifact: { bytes: new TextEncoder().encode(extraction.text), mediaType: 'application/pdf', text: extraction.text, pages, extractorVersion: extractor,
      ...(renderer === null ? {} : { rendererVersion: renderer, inspectStructure: 'authored-pdf-order-v1' }), bindPdfEvidence: 'pdf-evidence-map-v1' } });
  const work = snapshot.evidence.find(item => item.text === text).id;
  const draft = { ratings: [{ id: 'python', state, reason: 'Scripted evidence judgment, not a quality label.', evidence: state === 'not-evidenced' ? [] : [work] }],
    communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating, reason: 'Scripted anchored judgment.', evidence: [work] })) };
  const reviews = items => items.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted challenge, not independent truth.', evidence: item.evidence }));
  const outputs = { requirements: { revision: 1, segments: [{ id: 'jd-0', disposition: 'criteria', reason: 'Scripted requirement.' }],
    requirements: [{ id: 'python', label: 'Python', importance, condition: { kind: 'atom', id: 'python', segmentId: 'jd-0', quote: 'Python' } }] },
    assessment: draft, challenge: { ratings: reviews(draft.ratings), communication: reviews(draft.communication), inventoryIssues: [] } };
  const options = { snapshot, getCurrent: () => snapshot, provider: 'anthropic', model, pricing: { input: 1, output: 2, checkedAt: Date.now() },
    storage: shared.storage, locks: shared.locks, budget: { id: 'comparison-fixture', scope: 'browser-origin', approved: true, maxCost: 10 },
    ...(config.baseline ? { baseline: config.baseline } : {}),
    invoke: async request => {
      shared.calls.push(request);
      return { text: JSON.stringify(outputs[request.stage]), provider: request.provider, model: request.model, requestId: 'scripted-' + shared.calls.length, usage: null,
        ...(config.requestPolicy ? { requestPolicy: config.requestPolicy } : {}) };
    } };
  const excluded = snapshot.evidence.filter(item => ['Avery', 'private@example.test', ...(extraExclusion ? ['Product Designer'] : [])].includes(item.text))
    .map(item => ({ id: item.id, reason: item.text === 'private@example.test' ? 'contact' : 'name' }));
  const connect = () => createAssessmentPilot(options);
  async function run() {
    const pilot = await connect();
    if (config.baseline) await pilot.reuseInventory({ confirmed: true });
    else { await pilot.inventory({ confirmed: true }); await pilot.approveInventory({ confirmed: true }); }
    await pilot.approveEvidence({ confirmed: true, excluded });
    const result = await pilot.evaluate({ confirmed: true });
    return { pilot, result, snapshot, options, shared };
  }
  return { run, connect, options, snapshot, shared };
}
const baseline = item => ({ snapshot: item.snapshot, id: item.result.report.id });

test('Recorded request policies remain comparable only when both sides retain the same known settings', async () => {
  for (const requestPolicy of [undefined, 'anthropic-temperature-zero-v1']) {
    const first = await (await fixture({ requestPolicy })).run();
    const second = await (await fixture({ baseline: baseline(first), version: 2, requestPolicy: 'anthropic-temperature-zero-v1' }, first.shared)).run();
    const comparison = second.pilot.state().comparison;
    assert.equal(comparison.comparable, !!requestPolicy);
    if (!requestPolicy) assert.match(comparison.reasons.join(' '), /request policy changed or is unavailable/);
    const tampered = structuredClone(second.result);
    tampered.execution[0].requestPolicy = 'unrecognized-policy';
    await assert.rejects(compareCandidateAssessments(first.result, first.snapshot, tampered, second.snapshot), /request policy/);
  }
});
test('Explicit recheck reuses the exact approved inventory, reserves only two calls and records a validated comparison atomically', async () => {
  const first = await (await fixture()).run();
  const second = await (await fixture({ baseline: baseline(first), text: 'Built Python services and documented delivery.', state: 'supported', rating: 3, version: 2 }, first.shared)).run();
  assert.equal(first.shared.calls.length, 5);
  assert.deepEqual(first.shared.calls.map(item => item.stage), ['requirements', 'assessment', 'challenge', 'assessment', 'challenge']);
  assert.equal(second.result.approval.manifestSha256, first.result.approval.manifestSha256);
  const comparison = second.pilot.state().comparison;
  assert.equal(comparison.comparable, true); assert.equal(comparison.textChanged, true);
  assert.equal(comparison.documentChanged, true); assert.equal(comparison.versionChanged, true);
  assert.equal(comparison.rows.find(item => item.id === 'role-python').direction, 'improved');
  assert.equal(comparison.rows.find(item => item.id === 'communication-clarity').direction, 'improved');
  assert.equal(comparison.rows.find(item => item.id === 'artifact-field-association').direction, 'unresolved');
  const saved = JSON.parse([...first.shared.values.values()][0]);
  assert.equal(saved.results.length, 2); assert.equal(saved.comparisons.length, 1);
  assert.deepEqual(saved.comparisons[0], comparison);
  assert.deepEqual(await second.pilot.restore(second.result.report.id), second.result);
  assert.deepEqual(second.pilot.state().comparison, comparison); assert.equal(first.shared.calls.length, 5);
});
test('Known deterioration and neutrality remain possible; unavailable judgments never become numeric gains', async () => {
  for (const [from, to, expected] of [['supported', 'mentioned', 'worsened'], ['supported', 'supported', 'unchanged'],
    ['unknown', 'supported', 'unresolved'], ['supported', 'unknown', 'unresolved'], ['not-evidenced', 'contradicted', 'changed'],
    ['supported', 'contradicted', 'worsened'], ['contradicted', 'supported', 'improved']]) {
    const first = await (await fixture({ state: from, rating: null })).run();
    const second = await (await fixture({ baseline: baseline(first), state: to, rating: 4 }, first.shared)).run();
    const comparison = second.pilot.state().comparison;
    assert.equal(comparison.rows.find(item => item.id === 'role-python').direction, expected);
    assert.equal(comparison.rows.find(item => item.id === 'communication-scope').direction, 'unresolved');
    assert.equal(comparison.textChanged, false);
    assert.equal(second.result.report.headline.value, null);
  }
});
test('Changed target, inventory, model, document, extraction method, artifact origin or exclusions suppress comparable improvements', async () => {
  const first = await (await fixture()).run();
  for (const config of [{ role: 'Engineer' }, { importance: 'preferred' }, { model: 'another-scripted-model' }, { documentId: 'another-document' },
    { extractor: 'different-extractor' }, { renderer: 2 }, { renderer: null }, { extraExclusion: true }]) {
    const second = await (await fixture({ ...config, state: 'supported', rating: 4 })).run();
    const comparison = await compareCandidateAssessments(first.result, first.snapshot, second.result, second.snapshot);
    assert.equal(comparison.comparable, false); assert.ok(comparison.reasons.length);
    assert.equal(comparison.counts.improved, 0); assert.ok(comparison.rows.every(row => row.direction === 'not-comparable'));
  }
});
test('Recheck setup refuses changed targets/models, missing or copied baselines, fresh budget resets and unapproved inventory reuse', async () => {
  const first = await (await fixture()).run(), initial = first.shared.calls.length;
  for (const config of [{ role: 'Engineer' }, { model: 'different-model' }, { documentId: 'different-document' }, { renderer: null }]) {
    const item = await fixture({ ...config, baseline: baseline(first) }, first.shared);
    await assert.rejects(item.connect());
  }
  const missing = await fixture({ baseline: baseline(first) }); await assert.rejects(missing.connect(), /budget is missing/);
  assert.equal(missing.shared.values.size, 0);
  const copied = await fixture({ baseline: { ...baseline(first), snapshot: structuredClone(first.snapshot) } }, first.shared);
  await assert.rejects(copied.connect(), /snapshot changed|not captured/);
  const item = await fixture({ baseline: baseline(first) }, first.shared), pilot = await item.connect();
  const budgetBeforeReuse = pilot.budget();
  await assert.rejects(pilot.reuseInventory(), /explicitly confirm/);
  await assert.rejects(pilot.inventory({ confirmed: true }), /reuse/);
  await pilot.reuseInventory({ confirmed: true });
  assert.deepEqual(pilot.budget(), budgetBeforeReuse);
  await assert.rejects(pilot.evaluate({ confirmed: true }), /evidence/);
  const changed = structuredClone(first.result.approval.manifest); changed.requirements[0].importance = 'preferred';
  await assert.rejects(pilot.approveInventory({ confirmed: true, manifest: changed }), /frozen inventory/);
  assert.equal(first.shared.calls.length, initial);
});
test('Saved comparison changes, mismatched snapshots and foundation-only records fail validation without another call', async () => {
  const first = await (await fixture()).run(), second = await (await fixture({ baseline: baseline(first), state: 'supported' }, first.shared)).run();
  const comparison = second.pilot.state().comparison;
  assert.deepEqual(await validateAssessmentComparison(structuredClone(comparison), first.result, first.snapshot, second.result, second.snapshot), comparison);
  const changed = structuredClone(comparison); changed.counts.improved = 999;
  await assert.rejects(validateAssessmentComparison(changed, first.result, first.snapshot, second.result, second.snapshot), /altered/);
  await assert.rejects(compareCandidateAssessments(first.result.report, first.snapshot, second.result, second.snapshot));
  const other = await fixture({ text: 'Different captured artifact.' });
  await assert.rejects(compareCandidateAssessments(first.result, other.snapshot, second.result, second.snapshot));
  const key = [...first.shared.values.keys()][0], saved = JSON.parse(first.shared.values.get(key));
  saved.comparisons[0].counts.improved = 999; first.shared.values.set(key, JSON.stringify(saved));
  await assert.rejects(second.pilot.restore(second.result.report.id), /altered/);
  assert.equal(first.shared.calls.length, 5);
});
test('Failed comparison persistence preserves the baseline, retains the spent reservation and cannot publish a partial successful recheck', async () => {
  const first = await (await fixture()).run(), spent = first.pilot.budget().reserved;
  first.shared.rejectComparison = true;
  const item = await fixture({ baseline: baseline(first), state: 'supported' }, first.shared);
  await assert.rejects(item.run(), /receipt could not be saved/);
  const saved = JSON.parse([...first.shared.values.values()][0]);
  assert.equal(saved.results.length, 1); assert.equal(saved.comparisons, undefined);
  assert.ok(first.pilot.budget().reserved > spent); assert.equal(saved.failures.length, 1);
  assert.equal(first.shared.calls.length, 5);
});
test('A single assessment is not a fresh recheck, and changed exclusion scope is visibly non-comparable even in a baseline-connected pilot', async () => {
  const first = await (await fixture()).run();
  const identical = await compareCandidateAssessments(first.result, first.snapshot, first.result, first.snapshot);
  assert.equal(identical.comparable, false); assert.match(identical.reasons.join(' '), /same assessment/);
  const second = await (await fixture({ baseline: baseline(first), extraExclusion: true, state: 'supported' }, first.shared)).run();
  assert.equal(second.pilot.state().comparison.comparable, false);
  assert.match(second.pilot.state().comparison.reasons.join(' '), /excluded/);
  const future = structuredClone(first.result); future.report.createdAt = second.result.report.createdAt + 1000;
  const chronology = await compareCandidateAssessments(future, first.snapshot, second.result, second.snapshot);
  assert.equal(chronology.comparable, false); assert.match(chronology.reasons.join(' '), /predates/);
});
test('An exhausted existing budget cannot be restarted or bypassed by no-call inventory reuse', async () => {
  const first = await (await fixture()).run();
  const key = [...first.shared.values.keys()][0], saved = JSON.parse(first.shared.values.get(key));
  saved.maxCost = first.pilot.budget().reserved;
  first.shared.values.set(key, JSON.stringify(saved));
  const item = await fixture({ baseline: baseline(first) }, first.shared);
  item.options.budget.maxCost = saved.maxCost;
  await assert.rejects(item.run(), /exhausted/);
  assert.equal(first.shared.calls.length, 3);
  assert.equal(JSON.parse(first.shared.values.get(key)).results.length, 1);
});
