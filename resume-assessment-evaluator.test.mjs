import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessmentSnapshot } from './src/js/resume-assessment.mjs';
import { inventoryCandidateAssessment, approveAssessmentInventory, approveAssessmentEvidence, evaluateCandidateAssessment, validateEvaluatedAssessment } from './src/js/resume-assessment-evaluator.mjs';
import { mapResumePdfEvidence } from './src/js/resume-pdf.mjs';

async function fixture(jd = 'Python or Java\nLeadership', resume = 'Fictional Person\nperson@example.test\nBuilt Python services.\nDelivered qualitative customer value.\nSupported cross-team delivery.') {
  return createAssessmentSnapshot({ artifact: { bytes: new TextEncoder().encode(resume), mediaType: 'text/plain', text: resume, extractorVersion: 'synthetic-evaluator-v1' },
    target: { company: 'Example', role: 'Product Designer', level: 'staff', jd } });
}
function manifest(snapshot) {
  const atom = (quote, id) => {
    const start = snapshot.target.jd.indexOf(quote);
    return { kind: 'atom', id, segmentId: snapshot.jobSegments.find(segment => start >= segment.start && start < segment.end).id, start, end: start + quote.length, quote };
  };
  return { revision: 1, segments: snapshot.jobSegments.map(segment => ({ id: segment.id, disposition: 'criteria', reason: 'Explicit synthetic criterion.' })),
    requirements: snapshot.jobSegments.length ? [
      { id: 'req-tools', label: 'Python or Java', importance: 'required', condition: { kind: 'anyOf', children: [atom('Python', 'python'), atom('Java', 'java')] } },
      { id: 'req-leadership', label: 'Leadership', importance: 'required', condition: atom('Leadership', 'leadership') }
    ] : [] };
}
function draft(snapshot) {
  return { ratings: snapshot.jobSegments.length ? [
    { id: 'python', state: 'supported', reason: 'Built services.', evidence: ['artifact-2'] },
    { id: 'java', state: 'not-evidenced', reason: 'Not documented in the included text.', evidence: [] },
    { id: 'leadership', state: 'mentioned', reason: 'Participation is stated, leadership is not demonstrated.', evidence: ['artifact-4'] }
  ] : [], communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 3, reason: 'Synthetic anchored judgment, not a provider evaluation.', evidence: [id === 'outcomes' ? 'artifact-3' : 'artifact-2'] })) };
}
function challenge(value) {
  return { ratings: value.ratings.map(entry => ({ id: entry.id, verdict: 'agree', reason: 'Synthetic challenge cites the supplied passage.', evidence: entry.evidence })),
    communication: value.communication.map(entry => ({ id: entry.id, verdict: 'agree', reason: 'Synthetic challenge, not independently verified truth.', evidence: entry.evidence })), inventoryIssues: [] };
}
function harness(snapshot) {
  const events = [], requests = [], plans = [];
  let current = snapshot;
  const inventory = manifest(snapshot);
  const quoteOnly = node => node.kind === 'atom'
    ? { kind: node.kind, id: node.id, segmentId: node.segmentId, quote: node.quote }
    : { ...node, children: node.children.map(quoteOnly) };
  inventory.requirements = inventory.requirements.map(requirement => ({ ...requirement, condition: quoteOnly(requirement.condition) }));
  const outputs = { requirements: inventory, assessment: draft(snapshot), challenge: challenge(draft(snapshot)) };
  const options = { consent: true, provider: 'anthropic', model: 'synthetic-fixed-model', pricing: { input: 1, output: 2, checkedAt: Date.now() },
    getCurrent: () => current,
    reserve: async plan => { events.push('reserve:' + plan.stages.map(stage => stage.stage).join(',')); plans.push(plan); return { id: plan.id, amount: plan.amount }; },
    invoke: async request => {
      events.push(request.stage); requests.push(request);
      return { text: JSON.stringify(outputs[request.stage]), provider: request.provider, model: request.model, requestId: 'synthetic-' + requests.length, usage: { inputTokens: 100, outputTokens: 200 } };
    } };
  return { options, outputs, events, requests, plans, setCurrent: value => { current = value; } };
}
async function ready(snapshot, setup) {
  const inventory = await inventoryCandidateAssessment(snapshot, setup.options);
  return { approval: await approveAssessmentInventory(snapshot, inventory, { confirmed: true }),
    selection: approveAssessmentEvidence(snapshot, { confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }, { id: 'artifact-1', reason: 'contact' }] }) };
}

test('Evaluator inventories the job without candidate data and pauses for explicit inventory/evidence approval', async () => {
  const snapshot = await fixture(), setup = harness(snapshot);
  const inventory = await inventoryCandidateAssessment(snapshot, setup.options);
  assert.deepEqual(setup.events, ['reserve:requirements', 'requirements']);
  assert.equal(inventory.approvalRequired, true);
  assert.deepEqual(inventory.manifest, manifest(snapshot));
  const payload = JSON.parse(setup.requests[0].user);
  assert.deepEqual(Object.keys(payload).sort(), ['segments', 'target']);
  assert.ok(!setup.requests[0].user.includes('Fictional Person'));
  assert.ok(!setup.requests[0].user.includes('Built Python'));
  assert.ok(!setup.requests[0].user.includes(snapshot.binding.artifactSha256));
  await assert.rejects(approveAssessmentInventory(snapshot, inventory, { confirmed: false }), /explicit approval/);
  assert.throws(() => approveAssessmentEvidence(snapshot, { confirmed: false }), /review included evidence/);
  await assert.rejects(evaluateCandidateAssessment(snapshot, { ...setup.options, approval: inventory, selection: {} }), /approve.*inventory/);
  assert.equal(setup.requests.length, 1);
  const unicode = await fixture('\ud83d\ude80 Python or Java\nLeadership'), unicodeSetup = harness(unicode);
  assert.deepEqual((await inventoryCandidateAssessment(unicode, unicodeSetup.options)).manifest, manifest(unicode));
  const ambiguous = await fixture('Python or Java; Python\nLeadership'), ambiguousSetup = harness(ambiguous);
  await assert.rejects(inventoryCandidateAssessment(ambiguous, ambiguousSetup.options), /uniquely identify/);
  assert.equal(ambiguousSetup.requests.length, 1);
});

test('Evaluator runs assessment then challenge with a whole-phase reservation and auditable actual receipts', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  assert.deepEqual(setup.events, ['reserve:requirements', 'requirements', 'reserve:assessment,challenge', 'assessment', 'challenge']);
  assert.equal(setup.plans[1].stages.length, 2);
  assert.equal(result.execution.length, 2);
  assert.ok(result.execution.every(receipt => receipt.model === 'synthetic-fixed-model' && receipt.status === 'parsed' && /^[a-f0-9]{64}$/.test(receipt.requestSha256)));
  assert.equal(result.reservations[0].pricing.input, 1);
  assert.equal(result.report.headline.value, null);
  assert.equal(result.report.status, 'partial');
  assert.equal(result.report.dimensions.roleEvidence.requirements[0].state, 'supported');
  assert.deepEqual(result.report.dimensions.roleEvidence.requiredGaps, ['req-leadership']);
  assert.ok(Object.isFrozen(result.challenge.ratings[0]));
  for (const request of setup.requests) {
    assert.ok(!request.user.includes('Fictional Person'));
    assert.ok(!request.user.includes('person@example.test'));
    assert.ok(!request.user.includes(snapshot.binding.documentSignature ?? 'nonexistent-secret'));
    assert.equal(request.singleAttempt, true);
  }
  assert.match(setup.requests[1].system, /Qualitative outcomes may earn4/);
  assert.match(setup.requests[2].system, /Do not rubber-stamp/);
  assert.deepEqual(await validateEvaluatedAssessment(JSON.parse(JSON.stringify(result)), snapshot), result);
});

test('Both PDF judgment passes receive order uncertainty without leaking excluded positional text', async () => {
  const base = await fixture();
  const pages = [{ width: 600, height: 800, items: base.evidence.map((item, index) => ({ str: item.text, x: index === 1 ? 400 : 40,
    y: index < 2 ? 40 : 40 + index * 25, w: 150, h: 12, rotation: 0, direction: 'ltr', hasEOL: true })) }];
  const snapshot = await createAssessmentSnapshot({ target: base.target, artifact: { ...base.artifact,
    bytes: new TextEncoder().encode('scripted PDF'), mediaType: 'application/pdf', inspectReadingOrder: 'pdf-order-probes-v1',
    bindPdfEvidence: 'pdf-evidence-map-v1', text: mapResumePdfEvidence(pages).text, pages } });
  const setup = harness(snapshot), approvals = await ready(snapshot, setup);
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  assert.equal(JSON.parse(setup.requests[0].user).pdfOrder, undefined);
  for (const request of setup.requests.slice(1)) {
    const data = JSON.parse(request.user);
    assert.equal(data.pdfOrder.version, 'pdf-order-probes-v1'); assert.equal(data.pdfOrder.status, 'ambiguous');
    assert.match(data.pdfOrder.caution, /attribution unknown/);
    assert.equal(data.pdfOrder.pages[0].page, 1);
    assert.doesNotMatch(request.user, /Fictional Person|person@example\.test|"rotation":|"gutter":|"items":|"pdfSpans":/);
  }
  assert.ok(result.report.evidence.every(excerpt => excerpt.pdfSpans.length > 0));
  assert.deepEqual(await validateEvaluatedAssessment(JSON.parse(JSON.stringify(result)), snapshot), result);
  const altered = structuredClone(result); altered.report.dimensions.artifact.readingOrder.status = 'agreement';
  await assert.rejects(validateEvaluatedAssessment(altered, snapshot), /record does not match its bound inputs or derived facts/);
});

test('Evaluator preserves disagreement as unknown rather than taking either model as truth', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  setup.outputs.challenge.ratings[0] = { id: 'python', verdict: 'disagree', reason: 'The cited passage does not establish the claimed proficiency.', evidence: ['artifact-2'] };
  setup.outputs.challenge.communication[1].verdict = 'uncertain';
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  assert.equal(result.draft.ratings[0].state, 'supported');
  assert.equal(result.report.dimensions.roleEvidence.ratings[0].state, 'unknown');
  assert.equal(result.report.dimensions.communication.ratings[1].rating, null);
  assert.deepEqual(result.report.dimensions.roleEvidence.requiredGaps, ['req-tools', 'req-leadership']);
  assert.match(result.report.dimensions.roleEvidence.ratings[0].reason, /Unresolved challenge/);
  assert.equal(setup.requests.length, 3);
});

test('Evaluator surfaces inventory defects without silently regenerating easier criteria or retrying', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  setup.outputs.challenge.inventoryIssues = [{ segmentId: 'jd-1', reason: 'The approved condition missed a material qualification.' }];
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  assert.ok(result.report.dimensions.roleEvidence.ratings.every(rating => rating.state === 'unknown'));
  assert.deepEqual(result.approval.manifest, approvals.approval.manifest);
  assert.equal(result.challenge.inventoryIssues.length, 1);
  assert.equal(setup.requests.length, 3);
});

test('Evaluator reuses a frozen approved target across resume edits but requires fresh evidence approval', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  const changed = await fixture(snapshot.target.jd, snapshot.artifact.text + '\nAdditional authored evidence.');
  const next = harness(changed);
  await assert.rejects(evaluateCandidateAssessment(changed, { ...next.options, ...approvals }), /approve included evidence/);
  const selection = approveAssessmentEvidence(changed, { confirmed: true, excluded: approvals.selection.excluded });
  const result = await evaluateCandidateAssessment(changed, { ...next.options, approval: approvals.approval, selection });
  assert.deepEqual(next.events, ['reserve:assessment,challenge', 'assessment', 'challenge']);
  assert.equal(result.approval.manifestSha256, approvals.approval.manifestSha256);
  const newTarget = await createAssessmentSnapshot({ artifact: { bytes: new TextEncoder().encode(snapshot.artifact.text), ...snapshot.artifact },
    target: { ...snapshot.target, company: 'Different target' } });
  await assert.rejects(evaluateCandidateAssessment(newTarget, { ...next.options, ...approvals }), /approve.*inventory/);
});

test('Evaluator rejects missing, excluded or unchallenged evidence and never repairs malformed outputs', async () => {
  for (const fault of ['excluded', 'missing-challenge', 'no-challenge-citation', 'null-ratings', 'malformed']) {
    const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
    if (fault === 'excluded') setup.outputs.assessment.ratings[0].evidence = ['artifact-0'];
    if (fault === 'null-ratings') setup.outputs.assessment.ratings = null;
    if (fault === 'missing-challenge') setup.outputs.challenge.ratings.pop();
    if (fault === 'no-challenge-citation') setup.outputs.challenge.ratings[0].evidence = [];
    const original = setup.options.invoke;
    if (fault === 'malformed') setup.options.invoke = async request => ({ ...await original(request), text: '{"ratings":[' });
    await assert.rejects(evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals }), error => {
      assert.ok(error.assessmentAttempt);
      assert.equal(error.assessmentAttempt.reservations[0].status, 'reserved');
      return /excluded|challenge|list|malformed/.test(error.message);
    });
    assert.equal(setup.requests.length, ['missing-challenge', 'no-challenge-citation'].includes(fault) ? 3 : 2);
  }
});

test('Evaluator reserves both assessment and challenge before calling and refuses unacknowledged reservations', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  let requested;
  await assert.rejects(evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals,
    reserve: async plan => { requested = plan; throw new Error('Approved budget exhausted.'); } }), /budget exhausted/);
  assert.deepEqual(requested.stages.map(stage => stage.stage), ['assessment', 'challenge']);
  assert.ok(requested.amount > requested.stages[0].maximumAmount);
  assert.equal(setup.requests.length, 1);
  await assert.rejects(evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals, reserve: async plan => ({ id: plan.id, amount: 0 }) }), /acknowledged exactly/);
  assert.equal(setup.requests.length, 1);
});

test('Evaluator requires current pricing, consent and an actual locked model before reserving', async () => {
  const snapshot = await fixture();
  for (const overrides of [{ consent: false }, { model: 'Studio automatic selection' }, { provider: 'unpriced-provider' },
    { pricing: { input: 1, output: 2, checkedAt: 0 } }, { timeoutMs: 0 }]) {
    const setup = harness(snapshot);
    await assert.rejects(inventoryCandidateAssessment(snapshot, { ...setup.options, ...overrides }), /consent|model|provider|pricing|timeout/);
    assert.equal(setup.requests.length, 0); assert.equal(setup.plans.length, 0);
  }
});

test('Evaluator refuses complete input exceeding the request budget instead of slicing it', async () => {
  const jd = Array.from({ length: 30 }, (_, index) => 'Requirement ' + index).join('\n');
  const snapshot = await fixture(jd, 'Fictional Person\nperson@example.test\n' + 'Authored evidence. '.repeat(2500));
  const requirements = snapshot.jobSegments.map((segment, index) => ({ id: 'req-' + index, label: segment.text, importance: 'required',
    condition: { kind: 'atom', id: 'atom-' + index, segmentId: segment.id, start: segment.start, end: segment.end, quote: segment.text } }));
  const supplied = { version: 1, targetSha256: snapshot.binding.targetSha256, manifest: { revision: 1,
    segments: snapshot.jobSegments.map(segment => ({ id: segment.id, disposition: 'criteria', reason: 'x'.repeat(3000) })), requirements } };
  const approval = await approveAssessmentInventory(snapshot, supplied, { confirmed: true });
  const selection = approveAssessmentEvidence(snapshot, { confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }, { id: 'artifact-1', reason: 'contact' }] });
  let calls = 0, reservations = 0;
  await assert.rejects(evaluateCandidateAssessment(snapshot, { approval, selection, consent: true, provider: 'anthropic', model: 'synthetic-fixed-model',
    pricing: { input: 1, output: 2, checkedAt: Date.now() }, getCurrent: () => snapshot,
    reserve: async plan => { reservations++; return { id: plan.id, amount: plan.amount }; }, invoke: async () => { calls++; throw new Error('Should not invoke'); } }), /input exceeds/);
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
  assert.equal(approval.manifest.requirements.length, 30);
});

test('Evaluator preserves explicit unknown usage without claiming a settled bill', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup), invoke = setup.options.invoke;
  setup.options.invoke = async request => ({ ...await invoke(request), usage: null });
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  assert.ok(result.execution.every(entry => entry.usage === null));
  assert.equal(result.reservations[0].status, 'reserved');
});

test('Evaluator rejects provider identity and usage mismatches while retaining spent reservation evidence', async () => {
  for (const fault of ['model', 'usage', 'requestId']) {
    const snapshot = await fixture(), setup = harness(snapshot), original = setup.options.invoke;
    setup.options.invoke = async request => {
      const response = await original(request);
      if (fault === 'model') response.model = 'unexpected-fallback-model';
      if (fault === 'usage') response.usage.outputTokens = 99999;
      if (fault === 'requestId') response.requestId = '';
      return response;
    };
    await assert.rejects(inventoryCandidateAssessment(snapshot, setup.options), error => {
      assert.equal(error.assessmentAttempt.reservations[0].status, 'reserved');
      assert.equal(error.assessmentAttempt.execution.length, 1);
      return /model|usage|text/.test(error.message);
    });
    assert.equal(setup.requests.length, 1);
  }
});

test('Evaluator cancels a hung transport promptly without retry or a success-shaped result', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup), controller = new AbortController();
  let calls = 0;
  await assert.rejects(evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals, signal: controller.signal,
    invoke: () => { calls++; controller.abort(new Error('Cancelled by user.')); return new Promise(() => {}); } }), error => {
    assert.match(error.message, /Cancelled/);
    assert.equal(error.assessmentAttempt.execution[0].status, 'cancelled-outcome-unknown');
    assert.equal(error.assessmentAttempt.status, 'cancelled');
    return true;
  });
  assert.equal(calls, 1);
});

test('Evaluator deadline settles an unresponsive transport without relying on provider cooperation', { timeout: 2000 }, async () => {
  const snapshot = await fixture(), setup = harness(snapshot);
  const keepAlive = setTimeout(() => {}, 1500), started = performance.now();
  try {
    await assert.rejects(inventoryCandidateAssessment(snapshot, { ...setup.options, timeoutMs: 30, invoke: () => new Promise(() => {}) }), error => {
      assert.equal(error.name, 'TimeoutError');
      assert.equal(error.assessmentAttempt.status, 'cancelled');
      return true;
    });
    assert.ok(performance.now() - started < 1000, 'deadline must not wait for the hung transport');
  } finally { clearTimeout(keepAlive); }
});

test('Evaluator discards changes during reservation and late provider replies before any following stage', async () => {
  const snapshot = await fixture(), changed = await fixture(snapshot.target.jd, snapshot.artifact.text + '\nChanged.');
  for (const boundary of ['reserve', 'invoke']) {
    const setup = harness(snapshot), approvals = await ready(snapshot, setup), original = setup.options[boundary];
    setup.options[boundary] = async request => { const response = await original(request); setup.setCurrent(changed); return response; };
    await assert.rejects(evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals }), /changed/);
    assert.equal(setup.requests.length, boundary === 'reserve' ? 1 : 2);
  }
});

test('Evaluator general mode skips inventory calls and evaluates communication without inventing job requirements', async () => {
  const snapshot = await fixture(''), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  assert.deepEqual(setup.events, []);
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  assert.equal(result.report.dimensions.roleEvidence.status, 'not-applicable');
  assert.deepEqual(result.report.requirements.requirements, []);
  assert.equal(setup.requests.length, 2);
});

test('Evaluator stored records reject tampered judgments, requests, approvals, usage and derived reports', async () => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  const mutable = structuredClone(result), validating = validateEvaluatedAssessment(mutable, snapshot);
  mutable.approval.manifest.requirements[0].label = 'Changed during asynchronous validation';
  assert.deepEqual(await validating, result);
  const reordered = JSON.parse(JSON.stringify(result, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
  assert.deepEqual(await validateEvaluatedAssessment(reordered, snapshot), result);
  for (const mutate of [
    value => { value.report.headline.value = 100; },
    value => { value.draft.ratings[0].reason = 'Changed after the request'; },
    value => { value.challenge.ratings[0].verdict = 'invented'; },
    value => { value.approval.manifestSha256 = 'a'.repeat(64); },
    value => { value.selection.includedIds.push('artifact-0'); },
    value => { value.execution[0].requestSha256 = 'b'.repeat(64); },
    value => { value.execution[1].requestId = value.execution[0].requestId; },
    value => { value.reservations[0].amount = 0; },
    value => { value.reservations[0].pricing.input = 0.001; },
    value => { value.execution[0].usage.inputTokens = NaN; },
    value => { value.limitations.extra = undefined; }
  ]) {
    const bad = structuredClone(result); mutate(bad);
    await assert.rejects(validateEvaluatedAssessment(bad, snapshot), /Candidate/);
  }
  assert.equal(result.report.headline.value, null);
});

test('Evaluator historical receipts retain their original pricing time instead of expiring after a day', async context => {
  const snapshot = await fixture(), setup = harness(snapshot), approvals = await ready(snapshot, setup);
  const result = await evaluateCandidateAssessment(snapshot, { ...setup.options, ...approvals });
  const later = Date.now() + 2 * 86400000;
  context.mock.method(Date, 'now', () => later);
  assert.deepEqual(await validateEvaluatedAssessment(result, snapshot), result);
  await assert.rejects(inventoryCandidateAssessment(snapshot, setup.options), /current.*pricing/);
});
