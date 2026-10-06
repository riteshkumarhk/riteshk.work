import test from 'node:test';
import assert from 'node:assert/strict';
import { createResume, structureResumeText, resumeSignature, resumeHistoryCheckpoints } from './src/js/resume-workspace.mjs';
import { atsEditorReview } from './src/js/resume-ats.mjs';
import { rebuildResumeWithAI, resumeRebuildPacket, resumeAtsChecks, captureResumeAtsCheck } from './src/js/resume-rebuild.mjs';
import { resumeCompletionReservation } from './src/js/resume-review.mjs';

function fixture() {
  const document = createResume({ name: 'Application', target: { company: 'Example', jd: 'Accessible product design' }, model: structureResumeText(
    'Alex Example\nProduct Designer\nalex@example.test\n+44 1234567890\n\nSUMMARY\nDesigned accessible services through research.\n\nEXPERIENCE\nDesigner\nExample Studio\n2020 - Present\n- Improved task completion by 20% with usability research.\n\nSKILLS\nResearch, Figma\n\nEDUCATION\nBachelor in Design\nExample University\n2014 - 2018'
  ).model });
  document.aiReview = atsEditorReview(document, { at: 100, res: { score: 63, keywords: { missing: ['Accessibility', 'UnsupportedCRM'] }, fixes: [
    { point: 'Improve the summary', how: 'Make the research approach explicit', anchor: { quote: document.model.summary } },
    { point: 'Add revenue impact', how: 'Only if supported' },
  ] } });
  return document;
}

function response(packet) {
  return {
    fields: packet.fields.map(field => ({ id: field.id, text: field.id === 'summary' ? 'Research-led design of accessible services.' : field.text,
      evidence: [packet.evidence.find(item => item.fieldId === field.id).id] })),
    sectionOrder: packet.sections.map(section => section.id),
    entryOrder: packet.sections.filter(section => section.items).map(section => ({ sectionId: section.id, itemIds: section.items.map(item => item.id) })),
    fixes: [{ id: 'fix-0', status: 'applied', reason: 'Rephrased the supported research approach.', fieldIds: ['summary'] },
      { id: 'fix-1', status: 'needs-fact', reason: 'Revenue impact is not supplied.', fieldIds: [] }],
    summary: 'Clarified the summary; revenue impact still needs a source.',
  };
}

function options(document, transform = value => value) {
  return { provider: 'fixture', model: 'scripted', getCurrent: () => document,
    complete: async request => JSON.stringify(transform(response(JSON.parse(request.user)))) };
}

test('Feedback rebuild uses all findings and job context, revises content and retains identity and source facts', async () => {
  const document = fixture(), before = structuredClone(document);
  let calls = 0;
  const next = await rebuildResumeWithAI(document, { ...options(document), complete: async request => {
    calls++;
    assert.equal(request.stage, 'rebuild'); assert.equal(request.maxTokens, 12000);
    const packet = JSON.parse(request.user);
    assert.deepEqual(packet.review, document.aiReview.result);
    assert.equal(packet.fixes.length, 2);
    assert.equal(packet.target.jd, document.target.jd);
    assert.equal(packet.profile.contact.phone, document.model.contact.phone);
    assert.match(request.system, /Never insert unsupported tools or skills, even into Skills/);
    return JSON.stringify(response(packet));
  } });
  assert.equal(calls, 1);
  assert.notEqual(next.id, document.id);
  assert.notEqual(next.model.summary, document.model.summary);
  assert.deepEqual(next.model.contact, document.model.contact);
  assert.equal(next.model.name, document.model.name);
  assert.deepEqual(next.model.sections, document.model.sections);
  assert.deepEqual(next.target, document.target);
  assert.equal(next.aiReview, undefined);
  assert.equal(next.assessment, null);
  assert.equal(next.aiRebuild.fixes[1].status, 'needs-fact');
  assert.deepEqual(next.atsChecks[0].review, document.aiReview);
  assert.deepEqual(next.atsChecks[0].input.model, document.model);
  assert.deepEqual(document, before);
});

test('Rebuild rejects partial fields, omitted roles, dropped metrics, unsupported skills and invented success', async () => {
  for (const change of [
    result => { result.fields.pop(); return result; },
    result => { result.entryOrder[0].itemIds.pop(); return result; },
    result => { result.fixes.pop(); return result; },
    result => { result.fields.find(field => field.text.includes('20%')).text = 'Improved task completion.'; return result; },
    result => { result.fields.find(field => field.text.includes('20%')).text = 'Improved task completion by 90%.'; return result; },
    result => { result.fields.find(field => field.id.endsWith('.items')).text += ', UnsupportedCRM'; return result; },
    result => { result.fixes[1] = { id: 'fix-1', status: 'applied', reason: 'Added revenue', fieldIds: [] }; return result; },
    result => { result.fields[0].evidence = ['made-up']; return result; },
    result => { result.model = { name: 'Someone Else' }; return result; },
    result => { result.fields = {}; return result; },
    result => { result.fields[0] = null; return result; },
    result => { result.fields[1] = result.fields[0]; return result; },
  ]) {
    const document = fixture(), before = structuredClone(document);
    await assert.rejects(rebuildResumeWithAI(document, options(document, change)), /Resume rebuild:|not supported/);
    assert.deepEqual(document, before);
  }
});

test('Rebuild cancellation, changed feedback and malformed output never create a success-shaped fallback', async () => {
  const document = fixture();
  await assert.rejects(rebuildResumeWithAI(document, { ...options(document), complete: async () => 'unreadable' }), /invalid JSON/);
  const controller = new AbortController();
  await assert.rejects(rebuildResumeWithAI(document, { ...options(document), signal: controller.signal, complete: async request => {
    controller.abort(); return JSON.stringify(response(JSON.parse(request.user)));
  } }), /abort/i);
  await assert.rejects(rebuildResumeWithAI(document, { ...options(document), complete: async request => {
    document.aiReview.result.fixes.push({ point: 'New feedback' });
    return JSON.stringify(response(JSON.parse(request.user)));
  } }), /feedback changed/);
  const flat = createResume({ model: structureResumeText('One unstructured block.').model });
  flat.aiReview = document.aiReview;
  assert.throws(() => resumeRebuildPacket(flat), /reconstruct the original/);
});

test('Entry reordering is an explicit patch: omitted unchanged groups retain all original content', async () => {
  const document = fixture(), packet = resumeRebuildPacket(document);
  assert.deepEqual(packet.entryGroups, packet.sections.filter(section => section.items).map(section => ({ sectionId: section.id, itemIds: section.items.map(item => item.id) })));
  for (const retain of [[], [response(packet).entryOrder[0]]]) {
    const next = await rebuildResumeWithAI(document, options(document, result => ({ ...result, entryOrder: retain })));
    assert.deepEqual(next.model.sections, document.model.sections);
  }
  for (const change of [
    result => ({ ...result, entryOrder: [result.entryOrder[0], result.entryOrder[0]] }),
    result => ({ ...result, entryOrder: [{ sectionId: packet.sections.find(section => section.kind === 'skills').id, itemIds: [] }] }),
    result => ({ ...result, entryOrder: [{ sectionId: result.entryOrder[0].sectionId, itemIds: ['unknown'] }] }),
    result => ({ ...result, entryOrder: [{ ...result.entryOrder[0], unexpected: true }] }),
  ]) await assert.rejects(rebuildResumeWithAI(document, options(document, change)), /Resume rebuild:/);
});

test('Rebuild accepts honest order-only changes and unresolved outcomes without inventing a content edit', async () => {
  const document = fixture();
  const next = await rebuildResumeWithAI(document, options(document, result => {
    result.fields.find(field => field.id === 'summary').text = document.model.summary;
    result.sectionOrder.reverse();
    result.fixes[0].fieldIds = [];
    result.fixes[0].reason = 'Reordered the existing sections.';
    return result;
  }));
  assert.deepEqual(next.aiRebuild.changedFields, []);
  assert.equal(next.model.summary, document.model.summary);
  assert.deepEqual(next.model.sections.map(section => section.id), document.model.sections.map(section => section.id).reverse());
  const unchanged = await rebuildResumeWithAI(document, options(document, result => {
    result.fields.find(field => field.id === 'summary').text = document.model.summary;
    result.fixes[0] = { id: 'fix-0', status: 'already-satisfied', fieldIds: [], reason: 'The summary already expresses the approach.' };
    result.summary = 'No supported wording changes were needed.';
    return result;
  }));
  assert.deepEqual(unchanged.model, document.model);
  assert.equal(unchanged.aiRebuild.fixes.some(fix => fix.status === 'applied'), false);
});

test('ATS history retains submitted PDF text after edits and never substitutes unrelated legacy input', () => {
  const document = fixture();
  document.aiReview.signals.checkedInput = { text: 'Actual submitted PDF text', kind: 'submitted-text', target: document.target, pdfSha256: 'fixture-digest' };
  const snapshot = captureResumeAtsCheck(document);
  assert.equal(snapshot.input.text, 'Actual submitted PDF text');
  document.model.summary = 'Later edit';
  assert.equal(captureResumeAtsCheck(document).input.text, 'Actual submitted PDF text');
  delete document.aiReview.signals.checkedInput;
  document.ats = { legacy: { entry: { kind: 'review', payload: { text: 'An unrelated older review' } } } };
  assert.equal(captureResumeAtsCheck(document).input, null);
});

test('Local rebuild transport uses the existing priced reservation and bounded output ceiling', () => {
  const pricing = { input: 1, output: 2, checkedAt: Date.now() };
  const request = { stage: 'rebuild', system: 'Writing instructions', user: 'Source and feedback', maxTokens: 12000 };
  assert.ok(resumeCompletionReservation(request, pricing).amount > 0);
  assert.throws(() => resumeCompletionReservation({ ...request, maxTokens: 12001 }, pricing), /bounded/);
});

test('ATS history binds exact checked inputs, survives rebuild and does not create edit checkpoints', async () => {
  const document = fixture(), checked = captureResumeAtsCheck(document);
  const next = await rebuildResumeWithAI(document, options(document));
  next.aiReview = atsEditorReview(next, { at: 200, res: { score: 74, fixes: [] } });
  next.atsChecks = resumeAtsChecks({ document: next });
  assert.equal(next.atsChecks.length, 2);
  assert.equal(next.atsChecks[0].review.score, 74);
  assert.equal(next.atsChecks[1].review.score, 63);
  assert.equal(next.atsChecks[1].input.model.summary, document.model.summary);
  assert.equal(next.atsChecks[0].input.model.summary, next.model.summary);
  next.model.summary = 'A later unsaved edit.';
  assert.deepEqual(resumeAtsChecks({ document: next }).find(item => item.id === checked.id), checked);
  const record = { document: next, versions: [{ number: 1, label: 'Created resume', document }, { number: 2, label: 'ATS checked current PDF', document: next, checkpoint: null }], exports: [] };
  assert.deepEqual(resumeHistoryCheckpoints(record), []);
  assert.notEqual(next.aiReview.signature, resumeSignature(next));
});
