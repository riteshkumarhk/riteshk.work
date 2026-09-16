import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createResume, resumeFields, resumeSignature, editResumeField, resumeText, createResumeTask, createResumeHistory, applyResumeProposal, projectResumeProposal, assessResume, validatePdfText } from './src/js/resume-workspace.mjs';
import { resumeBody, renderResumeHtml, resumeHref, RESUME_RENDER_VERSION } from './src/js/resume-render.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { reviewPacket, validateRequirements, validateReview, reviewResumeWithAI, inventoryResumeWithAI, reviseResumeWithAI, boundedResumeCompletion, decideResumeFinding, resumeFindingDecision, resumeReviewFindings } from './src/js/resume-review.mjs';
import { verifyResumePdf } from './src/js/resume-pdf.mjs';
import { createHostedResumeClient } from './src/js/resume-hosted.mjs';
import { extractResumePdfText, structureResumeText } from './src/js/resume-workspace.mjs';
import { migrateAtsResume, atsMigrationIdentity, assessAtsResume, atsEditorReview } from './src/js/resume-ats.mjs';

test('Unified ATS assessment uses current PDF inputs and preserves citation-checked selective revisions', async () => {
  const document = fixture(), calls = [], controller = new AbortController();
  const field = resumeFields(document.model).find(field => field.label === 'Achievement');
  field.owner[field.key] = field.value = 'Designed a unique accessible approval workflow for this fixture.';
  const text = resumeText(document), jd = 'Accessible interaction design';
  const adapters = { readPages: async () => { calls.push('pages'); return null; }, semantic: async () => ({ off: true }), complete: async input => { calls.push(input); return { score: 75, fixes: [{ point: 'Clarify impact', how: 'Retain the existing evidence', anchor: { quote: field.value }, priority: 'high' }], checks: [] }; } };
  const first = await assessAtsResume({ text, jd, signal: controller.signal }, adapters);
  const second = await assessAtsResume({ text, jd, signal: controller.signal }, adapters);
  assert.deepEqual(first.res, second.res);
  assert.equal(calls[1].text, text); assert.equal(calls[1].jd, jd);
  const review = atsEditorReview(document, first);
  assert.deepEqual(review.findings[0].fieldIds, [field.id]);
  const result = await reviseResumeWithAI(document, { review, findingIndex: 0, getCurrent: () => document, provider: 'mock', model: 'mock', complete: async () => JSON.stringify({ kind: 'question', question: 'What outcome was measured?', reason: 'No new metric is supported.' }) });
  assert.equal(result.kind, 'question');
  assert.equal(atsEditorReview(document, first, { historical: true }).signature, '');
  const ambiguous = structuredClone(first); ambiguous.res.fixes[0].anchor.quote = 'missing passage';
  assert.deepEqual(atsEditorReview(document, ambiguous).findings[0].fieldIds, []);
  controller.abort();
  await assert.rejects(assessAtsResume({ text, jd, signal: controller.signal }, adapters), /abort/i);
  assert.equal(calls.length, 4);
});

test('ATS migration preserves edited structure and original snapshots with repeat-safe identities', async () => {
  const original = { id: 'review-1', tool: 'ats', kind: 'review', at: 10, payload: { text: 'Original wording', state: { jd: 'Original job', url: 'https://example.test/job' }, res: { score: 72 }, resumeDocument: { sha256: 'a'.repeat(64) } } };
  const workspace = { id: 'workspace-1', tool: 'ats', kind: 'workspace', at: 20, payload: { reviewId: original.id, rb: { ...fixture().model, notes: 'Retained rebuild notes' }, jd: 'Workspace job', company: 'Example', design: { font: 'serif', layout: 'sidebar', size: 'letter', accent: '#123456', keepWhole: false }, res: { score: 81 } } };
  const before = structuredClone(workspace), sourceIds = ['a'.repeat(64)];
  const document = await migrateAtsResume(workspace, original, sourceIds);
  assert.deepEqual(await migrateAtsResume(workspace, original, sourceIds), document);
  assert.deepEqual(workspace, before);
  assert.deepEqual(document.ats.legacy.entry, workspace);
  assert.deepEqual(document.ats.legacy.review, original);
  assert.equal(document.target.jd, 'Workspace job');
  assert.equal(document.target.url, 'https://example.test/job');
  assert.equal(document.design.font, 'gelasio');
  assert.equal(document.design.keepWhole, false);
  assert.equal(document.model.notes, 'Retained rebuild notes');
  assert.deepEqual(resumeFields(document.model).map(field => field.value), resumeFields(workspace.payload.rb).map(field => field.value));
  assert.deepEqual(document.sourceIds, sourceIds);
  assert.equal(document.assessment, null);
  assert.equal(document.ats.historicalReview.result.score, 81);
  workspace.payload.rb.summary = 'Newer unsynced wording';
  const changed = await atsMigrationIdentity(workspace);
  assert.equal(changed.id, document.id);
  assert.notEqual(changed.fingerprint, document.ats.fingerprint);
  await assert.rejects(migrateAtsResume(workspace, { ...original, id: 'wrong-review' }), /does not belong/);
  await assert.rejects(migrateAtsResume({ ...workspace, payload: {} }), /missing/);
  const imported = await migrateAtsResume(original);
  assert.ok(resumeText(imported).includes('Original wording'));
  assert.ok(imported.ats.warnings.some(warning => warning.includes('original file')));
  assert.deepEqual(imported.ats.legacy.entry.payload.resumeDocument, original.payload.resumeDocument);
});

test('Structured import preserves clear roles, dates, bullets and uncertain source text without inference', () => {
  const text = 'Alex Example\nalex@example.test\n\nExperience\nProduct Designer\nExample Studio\n2020 - Present\n- Designed accessible\nworkflows.\n- Led research.\n\nUX Designer\nPrevious Studio\n2018 - 2020\n- Built prototypes.\n\nSkills\nDesign: Figma, Research\n\nEducation\nExample University\nB.Des\n2014 - 2018\n\nUnrecognized personal note.';
  const result = structureResumeText(text), document = createResume({ model: result.model });
  const experience = document.model.sections.find(section => section.kind === 'experience');
  assert.equal(experience.items.length, 2);
  assert.equal(experience.items[0].role, 'Product Designer');
  assert.equal(experience.items[0].org, 'Example Studio');
  assert.equal(experience.items[0].dates, '2020 - Present');
  assert.equal(experience.items[0].bullets[0].text, 'Designed accessible workflows.');
  assert.deepEqual(document.model.sections.find(section => section.kind === 'skills').groups[0].items, ['Figma', 'Research']);
  for (const phrase of ['Alex Example', 'alex@example.test', 'Previous Studio', '2018 - 2020', 'Unrecognized personal note.', 'Example University', 'B.Des', '2014 - 2018']) assert.ok(resumeText(document).includes(phrase), phrase);
  assert.ok(result.warnings.length);
  const uncertain = structureResumeText('Experience\nDesigner, 2010\nNo clear achievement boundary.');
  assert.equal(uncertain.model.sections[0].kind, 'text');
  assert.equal(uncertain.model.sections[0].text, 'Designer, 2010\nNo clear achievement boundary.');
  assert.equal(structureResumeText('Entire unfamiliar source.').model.sections[0].text, 'Entire unfamiliar source.');
  assert.throws(() => structureResumeText(''), /readable/);
});

function reviewFixture() {
  const document = fixture(); document.target.jd = 'Required: accessible interaction design.\nPreferred: SQL.';
  const packet = reviewPacket(document);
  const inventory = { segments: packet.segments.map(segment => ({ id: segment.id, disposition: 'criteria', reason: 'Explicit criterion.' })), requirements: packet.segments.map((segment, index) => ({ id: 'req-' + index, label: index ? 'SQL' : 'Accessible interaction design', importance: index ? 'preferred' : 'required', segmentId: segment.id, quote: segment.text })) };
  const manifest = validateRequirements(inventory, packet), evidence = [packet.excerpts[0].id];
  const response = { ratings: [...manifest.requirements.map(requirement => ({ id: requirement.id, status: 'strong', rating: 4, reason: 'Synthetic rating, not an actual quality assessment.', evidence })), ...['scope', 'outcomes', 'clarity'].map(id => ({ id, status: 'evaluated', rating: 4, reason: 'Synthetic criterion rating.', evidence }))], findings: [] };
  return { document, packet, inventory, manifest, response };
}

test('AI rubric earns the full range without a ceiling or trusting a model headline', () => {
  const { packet, manifest, response } = reviewFixture();
  assert.equal(validateReview(response, packet, manifest).score, 100);
  response.ratings[0].status = 'demonstrated'; response.ratings[0].rating = 3;
  assert.equal(validateReview(response, packet, manifest).score, 89);
  response.ratings[0] = { ...response.ratings[0], status: 'absent', rating: 0, evidence: [] };
  const absent = validateReview(response, packet, manifest);
  assert.equal(absent.score, 55); assert.deepEqual(absent.requiredGaps, ['req-0']);
  assert.throws(() => validateReview({ ...response, score: 99 }, packet, manifest), /unexpected/);
  for (const rating of response.ratings) { rating.rating = 0; if (rating.id.startsWith('req-')) { rating.status = 'absent'; rating.evidence = []; } }
  assert.equal(validateReview(response, packet, manifest).score, 0);
});

test('AI rubric does not hide unknowns or invent a role score without a JD', () => {
  const { document, packet, manifest, response } = reviewFixture();
  response.ratings[0] = { ...response.ratings[0], status: 'unknown', rating: null, evidence: [] };
  const result = validateReview(response, packet, manifest);
  assert.equal(result.score, null); assert.equal(result.coverage, 55); assert.deepEqual(result.range, { low: 55, high: 100 });
  document.target.jd = ''; const generic = reviewPacket(document), inventory = validateRequirements({ segments: [], requirements: [] }, generic);
  const noJd = validateReview({ ratings: response.ratings.slice(2), findings: [] }, generic, inventory);
  assert.equal(noJd.score, null); assert.equal(noJd.coverage, 40);
});

test('AI rubric rejects invalid evidence, fabricated JD criteria, duplicates and contradictory anchors', () => {
  const { packet, manifest, inventory, response } = reviewFixture();
  const check = mutate => { const value = structuredClone(response); mutate(value); assert.throws(() => validateReview(value, packet, manifest), /Invalid AI review/); };
  check(value => { value.ratings[0].evidence = ['invented']; });
  check(value => { value.ratings[0].evidence = []; });
  check(value => { value.ratings[0].rating = '4'; });
  check(value => { value.ratings[0].rating = 5; });
  check(value => { value.ratings[0].status = 'absent'; });
  check(value => { value.ratings[0] = value.ratings[1]; });
  check(value => { value.ratings.pop(); });
  check(value => { value.findings = [{ criterionId: 'invented', priority: 'high', action: 'Invent experience' }]; });
  const forged = structuredClone(inventory); forged.requirements[0].quote = 'PhD mandatory';
  assert.throws(() => validateRequirements(forged, packet), /JD citation/);
  forged.requirements = inventory.requirements; forged.segments.pop();
  assert.throws(() => validateRequirements(forged, packet), /every JD segment/);
  assert.throws(() => validateReview('```json\n{}\n```', packet, manifest), /unexpected or missing fields/);
});

test('AI rubric inventories JD before seeing candidate data and preserves criteria across rechecks', async () => {
  const { document, inventory, manifest, response } = reviewFixture(), calls = [];
  const complete = async request => { calls.push(request); return JSON.stringify(request.stage === 'requirements' ? inventory : response); };
  const options = { complete, getCurrent: () => document, provider: 'mock-only', model: 'fixture' };
  const result = await reviewResumeWithAI(document, options);
  assert.equal(calls.length, 2); assert.equal(JSON.parse(calls[0].user).excerpts, undefined);
  assert.ok(calls.every(call => call.system.includes('UNTRUSTED DATA') && call.temperature === 0));
  assert.match(calls[1].system, /Qualitative and quantitative evidence can both earn 4/);
  assert.match(calls[1].system, /exact JD quote controls/);
  assert.match(calls[1].system, /CRM or enterprise software does not require CRM-specific work/);
  assert.equal(result.promptVersion, 2);
  assert.equal(result.provider, 'mock-only'); assert.equal(result.signature, resumeSignature(document));
  assert.equal(result.breakdown[0].evidence[0].text, reviewPacket(document).excerpts[0].text);
  calls.length = 0; await reviewResumeWithAI(document, { ...options, manifest }); assert.equal(calls.length, 1);
});

test('Review excerpts retain their actual role context without changing citations or inferring employer facts', () => {
  const document = fixture(), original = structuredClone(document);
  const packet = reviewPacket(document);
  const bullet = packet.excerpts.find(excerpt => excerpt.fieldId === 'bullet-0');
  assert.deepEqual(bullet.context, { section: 'Experience', entry: 'Designer', organization: 'Example', dates: '2019 to 2024' });
  assert.equal(bullet.text, 'Authored achievement 1');
  assert.equal(packet.excerpts.find(excerpt => excerpt.fieldId === 'summary').context, undefined);
  assert.ok(packet.excerpts.every(excerpt => excerpt.fieldId !== 'name' && !excerpt.fieldId.startsWith('contact.')));
  assert.deepEqual(document, original);
});

test('Author review decisions retain cited passages and history without changing AI ratings or resume content', () => {
  const { document, packet, manifest, response } = reviewFixture();
  response.findings = [{ criterionId: 'req-0', priority: 'low', action: 'Check existing evidence.' }, { criterionId: 'req-1', priority: 'high', action: 'Ask a specific missing question.' }];
  document.aiReview = { ...validateReview(response, packet, manifest), documentId: document.id, signature: resumeSignature(document), at: 123 };
  const review = document.aiReview, original = structuredClone(document), history = createResumeHistory(document);
  assert.deepEqual(resumeReviewFindings(document).map(item => item.index), [1, 0]);
  assert.throws(() => decideResumeFinding(document, review, 0, { reason: 'evidenced' }), /existing passage/);
  assert.throws(() => decideResumeFinding(document, { ...review, at: 124 }, 0, { reason: 'later' }), /review changed/);
  const next = decideResumeFinding(document, review, 0, { reason: 'evidenced', fieldId: 'bullet-0', note: 'This passage already supports it.' });
  assert.equal(resumeFindingDecision(next, review, 0).evidence.text, 'Authored achievement 1');
  assert.deepEqual(next.aiReview, original.aiReview); assert.deepEqual(next.model, original.model); assert.equal(resumeSignature(next), resumeSignature(original));
  history.record(next); assert.deepEqual(history.undo(), original); assert.deepEqual(history.redo(), next);
  const edited = editResumeField(next, 'bullet-0', 'Newer author wording');
  assert.equal(resumeFindingDecision(edited, review, 0).evidence.text, 'Authored achievement 1');
  assert.equal(resumeFindingDecision(edited, { ...review, at: 124 }, 0), undefined);
  assert.equal(resumeFindingDecision(decideResumeFinding(next, review, 0, { reason: 'reopen' }), review, 0), undefined);
  assert.deepEqual(document, original);
});

test('AI rubric bounds input, excludes contact fields, and never retries invalid or stale results automatically', async () => {
  const { document, inventory, manifest, response } = reviewFixture(); let calls = 0, current = document;
  const options = { getCurrent: () => current, provider: 'mock', model: 'fixture' };
  assert.ok(!reviewPacket(document).excerpts.some(excerpt => excerpt.fieldId === 'name' || excerpt.fieldId.startsWith('contact.')));
  await assert.rejects(reviewResumeWithAI(document, { ...options, complete: async () => { calls++; current = editResumeField(document, 'summary', 'New'); return inventory; } }), /Stale review/);
  assert.equal(calls, 1); current = document;
  const controller = new AbortController();
  await assert.rejects(reviewResumeWithAI(document, { ...options, manifest, signal: controller.signal, complete: async () => { controller.abort(); return response; } }), /cancelled/);
  calls = 0;
  await assert.rejects(reviewResumeWithAI(document, { ...options, manifest, complete: async () => { calls++; return '{}'; } }), /Invalid AI review/);
  assert.equal(calls, 1);
  document.target.jd = 'a'.repeat(20001);
  await assert.rejects(reviewResumeWithAI(document, { ...options, complete: () => { calls++; } }), /budget/);
  assert.equal(calls, 1);
});

const fixture = () => createResume({ id: 'resume-a', name: 'Product design', model: { name: 'Synthetic Designer', title: 'Designer', summary: 'Product designer.', contact: { email: 'test@example.test', links: [{ id: 'portfolio', label: 'Portfolio', url: 'https://example.test/work' }] }, sections: [{ id: 'experience', heading: 'Experience', kind: 'experience', items: [{ id: 'role', role: 'Designer', org: 'Example', dates: '2019 to 2024', bullets: Array.from({ length: 12 }, (_, index) => ({ id: 'bullet-' + index, text: 'Authored achievement ' + (index + 1) })) }] }] }, sourceIds: ['source'] });

test('Imported bullet continuations reflow without rewriting source text or merging separate bullets', () => {
  const document = fixture();
  document.model.sections = [{ id: 'import', kind: 'text', heading: 'Experience', text: '\u2022 Designed accessible\nworkflows with research partners.\n\u2022 Preserved another outcome.\n\nSeparate paragraph.' }];
  const snapshot = structuredClone(document), html = resumeBody(document);
  assert.match(html, /Designed accessible workflows with research partners\./);
  assert.equal((html.match(/class="resume-import-marker"/g) || []).length, 2);
  assert.match(html, /<p>Separate paragraph\.<\/p>/);
  assert.deepEqual(document, snapshot);
});

test('Hybrid alone enables selected section columns without changing content or stored preferences', () => {
  const document = fixture();
  document.model.sections.push({ id: 'achievements', heading: 'Key achievements', kind: 'custom', columns: 2, items: [{ id: 'achievement', title: 'Shaped direction', meta: 'Original attribution.' }] }, { id: 'awards', heading: 'Awards', kind: 'custom', columns: 3, items: [{ id: 'award', title: 'Recognition', meta: 'Original date.' }] });
  const model = structuredClone(document.model);
  assert.doesNotMatch(resumeBody(document), /resume-entry-row|resume-columns/);
  document.design.layout = 'hybrid';
  const hybrid = resumeBody(document);
  assert.match(hybrid, /--entry-columns:2/); assert.match(hybrid, /--entry-columns:3/);
  assert.doesNotMatch(hybrid, /class="resume-columns"/);
  assert.match(assessResume(document).layoutRisk, /Section columns can mix text/);
  document.design.layout = 'sidebar';
  assert.match(resumeBody(document), /class="resume-columns"/);
  assert.doesNotMatch(resumeBody(document), /resume-entry-row/);
  document.design.layout = 'single';
  assert.doesNotMatch(resumeBody(document), /resume-entry-row|resume-columns/);
  assert.equal(assessResume(document).layoutRisk, null);
  assert.deepEqual(document.model, model);
});

test('Entry dates are independent editable fields and education descriptions flow inline', () => {
  const document = fixture();
  document.model.sections.push({ id: 'awards', kind: 'custom', heading: 'Awards', items: [{ id: 'award', title: 'Recognition', dates: 'Aug 2024', meta: 'Original attribution' }] }, { id: 'education', kind: 'education', heading: 'Education', items: [{ id: 'school', school: 'Design School', dates: '2010 - 2014', credential: 'Bachelor in Design', note: '\u2022 Communication Design' }] });
  const original = structuredClone(document);
  const html = resumeBody(document);
  assert.match(html, /data-field="award.title">Recognition<\/h3><span class="dates" data-field="award.dates">Aug 2024/);
  assert.match(html, /<p class="education-description"><span class="" data-field="school.credential">Bachelor in Design<\/span> <span class="" data-field="school.note">/);
  assert.equal(resumeFields(document.model).find(field => field.id === 'award.dates').value, 'Aug 2024');
  const updated = editResumeField(document, 'award.dates', 'Oct 2024');
  assert.equal(updated.model.sections.at(-2).items[0].dates, 'Oct 2024');
  assert.deepEqual(document, original);
});

test('Review accepts only a complete JSON fence and still rejects incorrect rating anchors', () => {
  const { document, inventory, response } = reviewFixture(), packet = reviewPacket(document), manifest = validateRequirements(inventory, packet);
  assert.deepEqual(validateReview('```json\n' + JSON.stringify(response) + '\n```', packet, manifest), validateReview(response, packet, manifest));
  assert.throws(() => validateReview('Untrusted preamble\n```json\n' + JSON.stringify(response) + '\n```', packet, manifest), /malformed JSON/);
  const invalid = structuredClone(response); invalid.ratings[0].status = 'evaluated';
  assert.throws(() => validateReview('```json\n' + JSON.stringify(invalid) + '\n```', packet, manifest), /anchor/);
});
test('Studio review discovers stored providers without calls and shares its durable budget', async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function resumeAiConfiguration()');
  const storage = new Map(), window = { __RKStudio: {} };
  let calls = 0, queue = Promise.resolve();
  const model = { id: 'fixture-model', output: ['text'], maxOutputTokens: 12000, pricing: { input: 3, output: 15 } };
  runInNewContext(source.slice(start, source.lastIndexOf('})();')), { window, root: { classList: { contains: () => true } }, aiCfg: () => ({ provider: 'openai', key: '' }), aiCfRefresh: callback => callback({ openai: { set: true } }), aiSess: () => 'fixture-session-not-real', ADMIN_WORKER: 'https://example.test', aiCatalog: { discover: async config => { assert.equal(config.roaming, true); return { models: [model] }; } }, navigator: { locks: { request: (key, update) => { const result = queue.then(update); queue = result.catch(() => {}); return result; } } }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, boundedResumeCompletion, AbortSignal, aiChatOnce: async (config, id, system, user, options) => { calls++; assert.equal(options.singleAttempt, true); return { ok: true, text: '{}' }; } });
  assert.equal((await window.__RKStudio.resumeAI.models()).provider, 'openai'); assert.equal(calls, 0);
  const configuration = { model: model.id, pricing: { ...model.pricing, checkedAt: Date.now() }, budgetId: 'test-evaluation', maxCost: 0.1 };
  const first = await window.__RKStudio.resumeAI.connect(configuration), second = await window.__RKStudio.resumeAI.connect(configuration);
  const request = { stage: 'revision', system: 'policy', user: '{}', maxTokens: 4000 };
  const results = await Promise.allSettled([first.complete(request), second.complete(request)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(calls, 1);
  assert.equal(first.configuration().remaining, second.configuration().remaining);
  await assert.rejects(second.complete(request), /budget is exhausted/); assert.equal(calls, 1);
});
test('Studio single-attempt review disables temperature retries without changing other requests', async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
  const start = source.indexOf('  const aiNoTemperature = new Set();'), end = source.indexOf('  function aiProviderFailure', start);
  let calls = 0;
  const request = runInNewContext(source.slice(start, end) + '\naiTextRequest', { fetch: async () => { calls++; return { status: 400, clone: () => ({ json: async () => ({ error: { message: 'temperature is unsupported' } }) }) }; } });
  await request({ provider: 'openai', base: 'https://example.test' }, 'first', '/mock', {}, { temperature: 0 }, undefined, { singleAttempt: true }); assert.equal(calls, 1);
  await request({ provider: 'openai', base: 'https://example.test' }, 'second', '/mock', {}, { temperature: 0 }); assert.equal(calls, 3);
});
test('Resume AI budget reserves before one attempt, retains failures and rejects unknown pricing', async () => {
    let reserved = 0, calls = 0;
    const options = { provider: 'openai', model: 'test-only', pricing: { input: 3, output: 15, checkedAt: Date.now() }, reserve: async entry => { if (reserved + entry.amount > 0.2) throw new Error('Budget exhausted'); reserved += entry.amount; }, invoke: async request => { calls++; assert.equal(request.singleAttempt, true); throw new Error('Provider failed'); } };
    const complete = boundedResumeCompletion(options), request = { stage: 'revision', system: 'policy', user: '{}', maxTokens: 4000 };
    await assert.rejects(complete(request), /Provider failed/);
    assert.ok(reserved > 0.06); assert.equal(calls, 1);
    await assert.rejects(complete(request), /Provider failed/);
    await assert.rejects(complete(request), /Budget exhausted/); assert.equal(calls, 2);
    await assert.rejects(boundedResumeCompletion({ ...options, pricing: null })(request), /Verified current/);
    await assert.rejects(boundedResumeCompletion({ ...options, pricing: { ...options.pricing, checkedAt: Date.now() - 86400001 } })(request), /Verified current/);
    await assert.rejects(complete({ ...request, maxTokens: 12000 }), /Invalid bounded/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(complete({ ...request, signal: controller.signal })); assert.equal(calls, 2);
  });
test('Connected review pauses at inventory and revisions resolve original evidence or ask a question', async () => {
  const { document, inventory, response } = reviewFixture(), calls = [];
  const sources = [{ id: 'source', name: 'Evidence.txt', text: 'Delivered accessible interaction design across two teams.' }];
  const options = { provider: 'mock', model: 'fixture', getCurrent: () => document, complete: async request => {
    calls.push(request);
    if (request.stage === 'requirements') return inventory;
    if (request.stage === 'assessment') return { ...response, findings: [{ criterionId: 'req-0', priority: 'high', action: 'Clarify the accessible design work.' }] };
    return { kind: 'revision', fieldId: 'bullet-0', after: sources[0].text, reason: 'Make the relevant contribution explicit.', evidence: ['source-0'] };
  } };
  const manifest = await inventoryResumeWithAI(document, options);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].user).excerpts, undefined);
  const review = await reviewResumeWithAI(document, { ...options, manifest });
  const result = await reviseResumeWithAI(document, { ...options, review, findingIndex: 0, sources });
  assert.equal(calls.length, 3);
  assert.equal(result.kind, 'revision');
  assert.deepEqual(JSON.parse(calls[2].user).requirement, manifest.requirements[0]);
  assert.equal(JSON.parse(calls[2].user).evidence.find(excerpt => excerpt.fieldId === 'bullet-0').context.organization, 'Example');
  assert.deepEqual(result.proposal.evidence, [{ sourceId: 'source', quote: sources[0].text }]);
  assert.equal(applyResumeProposal(document, result.proposal, sources).model.sections[0].items[0].bullets[0].text, sources[0].text);
  assert.equal(document.model.sections[0].items[0].bullets[0].text, 'Authored achievement 1');
  const question = await reviseResumeWithAI(document, { ...options, review, findingIndex: 0, sources, complete: async () => ({ kind: 'question', question: 'What did you personally own in the accessibility work?', reason: 'The current wording does not establish ownership.' }) });
  assert.equal(question.kind, 'question'); assert.equal(question.proposal, undefined);
  const original = structuredClone(document), cited = reviewPacket(document).excerpts.find(excerpt => excerpt.fieldId === 'bullet-0');
  const supported = await reviseResumeWithAI(document, { ...options, review, findingIndex: 0, sources, complete: async () => ({ kind: 'supported', reason: 'The current passage supplies the requirement.', evidence: [cited.id] }) });
  assert.equal(supported.kind, 'supported'); assert.equal(supported.proposal, undefined);
  assert.deepEqual(supported.evidence, [{ fieldId: 'bullet-0', quote: 'Authored achievement 1', context: cited.context }]);
  assert.equal(supported.reviewAt, review.at); assert.deepEqual(document, original);
  for (const evidence of [[], ['source-0'], ['missing']]) await assert.rejects(reviseResumeWithAI(document, { ...options, review, findingIndex: 0, sources, complete: async () => ({ kind: 'supported', reason: 'Unsupported.', evidence }) }), /existing resume evidence/);
  const enriched = structuredClone(document); enriched.sourceIds.push('answer');
  const withAnswer = await reviseResumeWithAI(enriched, { ...options, getCurrent: () => enriched, review, findingIndex: 0, sources: [...sources, { id: 'answer', name: 'Author answer.txt', text: 'Figma, FigJam, pen and paper.' }], complete: async () => ({ kind: 'revision', fieldId: 'bullet-0', after: 'Figma, FigJam, pen and paper.', reason: 'Use author-supplied tools.', evidence: ['source-1'] }) });
  assert.equal(withAnswer.proposal.signature, resumeSignature(enriched));
  assert.equal(review.signature, resumeSignature(document));
  const edited = editResumeField(enriched, 'summary', 'Changed summary');
  await assert.rejects(reviseResumeWithAI(edited, { ...options, getCurrent: () => edited, review, findingIndex: 0 }), /Stale review/);
  await assert.rejects(reviseResumeWithAI(document, { ...options, review, findingIndex: 0, sources, complete: async () => ({ kind: 'revision', fieldId: 'bullet-0', after: 'Improved results by 98%.', reason: 'Unsupported number.', evidence: ['source-0'] }) }), /number/);
  await assert.rejects(reviseResumeWithAI(document, { ...options, review, findingIndex: 0, sources, complete: async () => ({ kind: 'revision', fieldId: 'bullet-0', after: 'Invented.', reason: 'Invalid evidence.', evidence: ['missing'] }) }), /evidence/);
});

test('Resume fields preserve separate link labels and targets', () => {
  const before = fixture(), after = editResumeField(before, 'portfolio.label', 'My portfolio');
  assert.equal(after.model.contact.links[0].url, 'https://example.test/work');
  assert.equal(before.model.contact.links[0].label, 'Portfolio');
});

test('Resume signatures include margins, target and document identity', () => {
  const document = fixture(), signature = resumeSignature(document);
  for (const update of [{ design: { ...document.design, margin: 'narrow' } }, { target: { ...document.target, jd: 'New role' } }, { id: 'resume-b' }]) assert.notEqual(resumeSignature({ ...document, ...update }), signature);
});

test('Hosted resume client requires explicit budget consent and preserves one budget across reloads', async () => {
  const values = new Map(), connections = []; let calls = 0;
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const ai = { models: async () => ({ provider: 'anthropic', checkedAt: Date.now(), models: [{ id: 'mock', pricing: { input: 2, output: 10 } }] }), connect: async input => { connections.push(input); return { configuration: () => ({ available: true, provider: 'anthropic', model: 'mock', remaining: 1 }), complete: async () => { calls++; return '{}'; } }; } };
  const request = async path => new Response(JSON.stringify(path === 'library' ? { documents: [], sources: [] } : { error: 'Conflict' }), { status: path === 'library' ? 200 : 409 });
  const client = createHostedResumeClient({ request, ai, storage });
  assert.equal((await client.api('ai/config')).available, false); assert.equal(connections.length, 0);
  await assert.rejects(client.api('ai/connect', { body: JSON.stringify({ model: 'mock' }) }), /Approve/);
  await client.api('ai/connect', { body: JSON.stringify({ model: 'mock', approved: true }) });
  assert.equal(calls, 0); assert.equal(connections.length, 1);
  const restored = createHostedResumeClient({ request, ai, storage });
  assert.equal((await restored.api('ai/config')).available, true); assert.equal(connections[0].budgetId, connections[1].budgetId);
  await assert.rejects(restored.api('ai/complete', { body: JSON.stringify({ provider: 'other', model: 'mock' }) }), /model changed/);
  assert.equal(calls, 0);
  await restored.api('ai/complete', { body: JSON.stringify({ provider: 'anthropic', model: 'mock' }) }); assert.equal(calls, 1);
  assert.deepEqual(await restored.api('library'), { documents: [], sources: [] });
  await assert.rejects(restored.api('resumes/missing'), { status: 409 });
});
test('Hosted PDF verification rejects missing text, overflow and incorrect page sizes', () => {
  const document = fixture();
  const positions = [{ width: 595.28, height: 841.89, items: [{ str: resumeFields(document.model).filter(field => !field.id.endsWith('.url')).map(field => field.value).join(' '), x: 40, y: 60, w: 500, h: 12 }] }];
  assert.equal(verifyResumePdf(document, positions).verification.complete, true);
  assert.throws(() => verifyResumePdf(document, positions, [], 2), /page counts/);
  const broken = structuredClone(positions); broken[0].items[0].str = 'Missing almost everything';
  assert.throws(() => verifyResumePdf(document, broken), /missing text/);
  broken[0].items[0].w = 900; assert.throws(() => verifyResumePdf(document, broken), /bounds/);
  broken[0].width = 10; assert.throws(() => verifyResumePdf(document, broken), /page size/);
});
test('PDF import reconnects late-drawn bullets and retains line breaks and mapped symbols', () => {
  const item = (str, x, y, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], height: 10, width: str.length * 5, hasEOL });
  const result = extractResumePdfText({ items: [item('Experience', 20, 180, true), item('Led 0\u21921 work for 200+ users', 30, 150, true), item('with original supporting context.', 30, 138, true), item('Second point (unchanged).', 30, 126, true), item('\u2022', 20, 150, true), item('\u2022', 20, 126, true)] });
  assert.equal(result.bullets, 2); assert.equal(result.unresolvedMarkers, 0);
  assert.equal(result.text, 'Experience\n\n\u2022 Led 0\u21921 work for 200+ users\nwith original supporting context.\n\u2022 Second point (unchanged).');
  const document = createResume({ model: { contact: {}, sections: [{ id: 'imported', kind: 'text', heading: 'Source', text: result.text }] } });
  const html = resumeBody(document);
  assert.equal((html.match(/<li>/g) || []).length, 2); assert.match(html, /200\+ users/); assert.match(html, /Second point \(unchanged\)/);
  const unresolved = extractResumePdfText({ items: [item('Original \u0000 unknown', 20, 180, true)] });
  assert.equal(unresolved.unmappedGlyphs, 1); assert.match(unresolved.text, /\ufffd/);
});
test('PDF text comparison permits equivalent apostrophe encoding but never omitted words', () => {
  const document = createResume({ model: { summary: 'Microsoft\u2019s product and customer\u2019s outcome', contact: {}, sections: [] } });
  assert.equal(validatePdfText(document, 'Microsoft\u02bcs product and customer\u02bcs outcome').complete, true);
  assert.equal(validatePdfText(document, 'Microsoft\u02bcs and customer\u02bcs outcome').complete, false);
});
test('Late resume results cannot target another document, changed content or a closed task', () => {
  const document = fixture(), task = createResumeTask(document);
  assert.equal(task.accept({ ...document, id: 'resume-b' }, {}), null);
  assert.equal(task.accept(editResumeField(document, 'summary', 'Changed'), {}), null);
  assert.equal(task.accept(document, { score: 1 }).documentId, 'resume-a');
  task.cancel();
  assert.equal(task.accept(document, {}), null);
});

test('Undo and redo restore content and design together', () => {
  const document = fixture(), history = createResumeHistory(document);
  const edited = editResumeField(document, 'summary', 'Edited summary');
  edited.design.margin = 'narrow'; history.record(edited);
  assert.deepEqual(history.undo(), document);
  assert.deepEqual(history.redo(), edited);
  const archived = { ...edited, archived: true, dismissed: ['proposal'] }; history.record(archived);
  assert.deepEqual(history.undo(), edited); assert.deepEqual(history.redo(), archived);
});

test('PDF preflight never considers omitted bullets complete', () => {
  const document = fixture(), text = resumeText(document);
  assert.equal(validatePdfText(document, text).complete, true);
  const result = validatePdfText(document, text.replace('Authored achievement 12', ''));
  assert.equal(result.complete, false);
  assert.equal(result.missing[0].id, 'bullet-11');
  assert.equal(resumeFields(document.model).filter(field => field.label === 'Achievement').length, 12);
});

test('Proposals require exact field identity, revision and verified evidence', () => {
  const document = fixture(), sources = [{ id: 'source', text: 'Research reduced completion time by 25%.' }];
  const proposal = { signature: resumeSignature(document), fieldId: 'bullet-0', before: 'Authored achievement 1', after: 'Reduced completion time by 25%.', evidence: [{ sourceId: 'source', quote: sources[0].text }] };
  assert.equal(applyResumeProposal(document, proposal, sources).model.sections[0].items[0].bullets[0].text, proposal.after);
  assert.throws(() => applyResumeProposal(document, { ...proposal, after: 'Reduced time by 95%.' }, sources), /number/);
  assert.throws(() => applyResumeProposal(editResumeField(document, 'summary', 'New'), proposal, sources), /changed/);
  assert.throws(() => applyResumeProposal(document, { ...proposal, fieldId: 'bullet-1' }, sources), /wording/);
});

test('Assessment distinguishes date mentions from outcome metrics and does not invent parse scores', () => {
  const document = editResumeField(fixture(), 'bullet-0', 'Used Figma in 2024.');
  const result = assessResume(document);
  assert.equal(result.pdf, null);
  assert.equal(result.matchRate, null);
  assert.match(result.checks.find(check => check.id === 'evidence').detail, /^0 of 12/);
  assert.equal(result.checks.find(check => check.id === 'dates').status, 'pass');
});

test('The shared renderer retains all bullets, real links and meaningful page-break settings', () => {
  const document = fixture(), body = resumeBody(document), original = renderResumeHtml(document);
  for (let index = 1; index <= 12; index++) assert.ok(body.includes('Authored achievement ' + index));
  assert.ok(body.includes('href="https://example.test/work"'));
  assert.equal(resumeHref('javascript:alert(1)'), '');
  assert.equal(resumeHref('Portfolio'), '');
  document.design.keepWhole = false;
  assert.notEqual(renderResumeHtml(document), original);
  assert.match(renderResumeHtml(document), /break-inside:auto/);
  document.design.margin = 'narrow';
  assert.match(renderResumeHtml(document), /margin:10mm/);
  document.model.summary = '<script>alert(1)</script>';
  assert.ok(resumeBody(document).includes('&lt;script&gt;'));
});

test('Measured scores reuse ATS weighting without assuming parsing, AI judgment or a job description', () => {
  const document = fixture(); document.target.role = 'Designer';
  const roleOnly = assessResume(document);
  assert.equal(roleOnly.targetBasis, 'Role title only');
  assert.ok(!roleOnly.measured.breakdown.some(part => ['parse', 'content'].includes(part.key)));
  document.target.jd = 'Required accessibility and Figma. SQL preferred.';
  const before = assessResume(document);
  const sources = [{ id: 'source', text: 'Delivered accessibility audits and Figma prototypes.' }];
  const proposal = { signature: resumeSignature(document), fieldId: 'bullet-0', before: 'Authored achievement 1', after: sources[0].text, evidence: [{ sourceId: 'source', quote: sources[0].text }] };
  const impact = projectResumeProposal(document, proposal, sources);
  assert.ok(impact.keywordAfter > impact.keywordBefore); assert.ok(impact.delta > 0);
  assert.equal(before.targetBasis, 'Job description');
  const withPdf = assessResume(document, { pages: 2, complete: true, layout: { flags: [{ label: 'Multi-column layout' }] } });
  assert.equal(withPdf.measured.breakdown.find(part => part.key === 'parse').value, 75);
  assert.equal(before.measuredChecks.find(check => check.label === 'Outcome evidence').status, 'warn');
});

test('Preview storage rejects stale writes and restores a version as a new revision', async () => {
  const { createPreviewStore } = await import('./tools/resume-preview.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'rk-resume-store-test-'));
  try {
    const store = createPreviewStore(directory), original = store.get('avery-meridian');
    const changed = editResumeField(original.document, 'summary', 'A newer document.');
    assert.equal(store.save(changed.id, changed, 1, 'Changed summary').version, 2);
    assert.throws(() => store.save(original.document.id, original.document, 1), /newer version/);
    const restored = store.restore(original.document.id, 1, 2);
    assert.equal(restored.version, 3);
    assert.equal(restored.document.model.summary, original.document.model.summary);
    assert.equal(store.get(original.document.id).versions.length, 3);
    const source = store.list().sources[0];
    assert.equal(store.sourceFile(source.id).bytes.length, source.size);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Editing preserves whitespace between typed words and in multiline text', () => {
  let document = fixture();
  for (const character of 'Two words\nAnother line ') document = editResumeField(document, 'summary', (document.model.summary === 'Product designer.' ? '' : document.model.summary) + character);
  assert.equal(document.model.summary, 'Two words\nAnother line ');
});

test('Pagination waits for body, heading and page-number fonts', async () => {
  const document = fixture(); document.design.font = 'gambetta';
  const html = renderResumeHtml(document, { base: 'http://127.0.0.1:5530/' });
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const loads = [], releases = [];
  let paginated = false;
  const window = {};
  const rendering = runInNewContext(script, {
    window, URL, parent: { postMessage() {} },
    document: { baseURI: 'http://127.0.0.1:5530/', body: { scrollHeight: 1000 }, querySelector: () => ({ content: {}, offsetWidth: 794 }), fonts: {
      load(query) { loads.push(query); return new Promise(resolve => releases.push(() => resolve([{ family: query }]))); },
      ready: Promise.resolve(), check: () => true
    } },
    Paged: { Previewer: class { async preview() { paginated = true; return { total: 1 }; } } }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loads, ['400 12px "Gambetta"', '600 12px "Gambetta"', '400 12px "Inter"']);
  assert.equal(paginated, false);
  releases[0](); releases[2]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(paginated, false);
  releases[1](); await rendering;
  assert.equal(paginated, true);
  assert.equal(window.resumeReady.fontLoaded, true);
});

describe('Resume browser acceptance', () => {
  let preview, browser, directory;
  before(async () => {
    const { buildPreview, startPreview } = await import('./tools/resume-preview.mjs');
    const { chromium } = await import('playwright-core');
    await buildPreview();
    directory = mkdtempSync(join(tmpdir(), 'rk-resume-browser-'));
    preview = await startPreview({ port: Number(process.env.RESUME_TEST_PORT || 5561), directory });
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  });
  after(async () => {
    await browser?.close(); await preview?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  async function exportPdf(document) {
    const record = preview.store.get(document.id);
    const response = await fetch(preview.origin + '/__resume/api/resumes/' + document.id + '/export', { method: 'POST', headers: { 'If-Match': String(record.version) } });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  async function openSample(id, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: width < 760 ? 844 : 1000 }, hasTouch: width < 760, isMobile: width < 760 });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(preview.origin + '/') || /^https:\/\/media\.riteshk\.work\/[a-f0-9]+\.woff2$/.test(url)) return route.continue();
      return route.abort();
    });
    await context.addInitScript(id => { if (!localStorage.getItem('rk:resume-preview:selected')) localStorage.setItem('rk:resume-preview:selected', id); }, id);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto(preview.origin + '/studio/resume-preview/');
    await page.locator('.rws-status.is-saved').waitFor();
    return { page, context, errors };
  }
  async function saved(page) {
    await page.locator('.rws-status.is-saved').waitFor();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('rk:resume-preview:pending:'))), false);
  }
  test('Hosted Resume entry refuses absent and cross-origin bridges without a blank page or API calls', { timeout: 90000 }, async () => {
    const context = await browser.newContext(), page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/__resume/api/') || request.url().includes('/admin/resume/')) requests.push(request.url()); });
    try {
      await page.goto(preview.origin + '/studio/resume/?hosted=1');
      await page.getByText('Open Resume Studio from the signed-in Studio.', { exact: true }).waitFor();
      const parentUrl = preview.origin.replace('127.0.0.1', 'localhost') + '/untrusted-parent';
      await context.grantPermissions(['local-network-access'], { origin: new URL(parentUrl).origin });
      await page.route(parentUrl, route => route.fulfill({ contentType: 'text/html', body: `<iframe title="Untrusted embedding" src="${preview.origin}/studio/resume/?hosted=1"></iframe>` }));
      await page.goto(parentUrl);
      await page.frameLocator('iframe').getByText('Open Resume Studio from the signed-in Studio.', { exact: true }).waitFor();
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Hosted Studio bridge saves private resumes, verifies PDFs and keeps failed-close edits', { timeout: 120000 }, async () => {
    const { Miniflare } = await import('miniflare');
    const { resumeWorkspaceRoute, createHostedResumeStore } = await import('./worker/resume-workspace.mjs');
    const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', r2Buckets: ['RESUMES', 'VAULT'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    let failedSave = false, expireFirstRender = true, rendered = 0, calls = 0;
    let holdSave = false, saveStarted, releaseSave;
    try {
      const bucket = await runtime.getR2Bucket('RESUMES'), legacy = await runtime.getR2Bucket('VAULT'), store = createHostedResumeStore(bucket, legacy);
      const { build } = await import('esbuild');
      const studioBundle = await build({ entryPoints: ['src/js/admin-studio.js'], bundle: true, write: false, format: 'iife' });
      const ownerContent = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
      ownerContent.work = []; ownerContent.specialViews = [];
      const fixtureRoute = async route => {
        const url = route.request().url();
        if (url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/')) return route.continue();
        if (new URL(url).pathname.startsWith('/admin/prep/')) {
          const parsed = new URL(url), action = parsed.pathname.split('/').at(-1);
          if (action === 'list') {
            const objects = await legacy.list({ prefix: 'prep/' + parsed.searchParams.get('tool') + '/' });
            const entries = await Promise.all(objects.objects.map(async object => (await legacy.get(object.key)).json()));
            return route.fulfill({ json: { items: entries.map(({ id, at, kind, title, meta }) => ({ id, at, kind, title, meta })) } });
          }
          if (action === 'get') { const entry = await legacy.get('prep/' + parsed.searchParams.get('tool') + '/' + parsed.searchParams.get('id') + '.json'); return route.fulfill({ status: entry ? 200 : 404, json: entry ? await entry.json() : {} }); }
          if (action === 'put') { const entry = route.request().postDataJSON(); await legacy.put('prep/' + entry.tool + '/' + entry.id + '.json', JSON.stringify(entry)); return route.fulfill({ json: { ok: true } }); }
          return route.fulfill({ status: 400, json: { error: 'Unexpected fixture request' } });
        }
        if (new URL(url).pathname === '/content.json') return route.fulfill({ json: ownerContent });
        if (url.startsWith(preview.origin + '/js/admin-studio.js')) return route.fulfill({ contentType: 'text/javascript', body: studioBundle.outputFiles[0].text });
        if (url.startsWith(preview.origin + '/')) {
          const pathname = new URL(url).pathname;
          if (pathname === '/studio/') return route.fulfill({ contentType: 'text/html', body: readFileSync(new URL('./studio/index.html', import.meta.url)) });
          if (/^\/js\/[a-z0-9-]+\.js$/i.test(pathname)) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL('.' + pathname, import.meta.url)) });
        }
        if (new URL(url).pathname.startsWith('/admin/resume/')) {
          const incoming = route.request();
          assert.equal(incoming.headers().authorization, 'Bearer synthetic-owner');
          if (holdSave && incoming.method() === 'PUT') { holdSave = false; saveStarted(); await new Promise(resolve => { releaseSave = resolve; }); }
          if (failedSave && incoming.method() === 'PUT') return route.fulfill({ status: 503, json: { error: 'Synthetic failed save' } });
          if (new URL(url).pathname.endsWith('/finalize') && expireFirstRender) {
            const input = incoming.postDataJSON(), key = 'pending/' + input.id + '.json';
            const pending = await (await bucket.get(key)).json();
            await bucket.put(key, JSON.stringify({ ...pending, at: Date.now() - 16 * 60000 }));
            expireFirstRender = false;
          }
          const remoteBrowser = { quickAction: async (action, options) => {
            rendered++; assert.equal(action, 'pdf');
            const renderPage = await context.newPage();
            try {
              await renderPage.setContent(options.html.replaceAll('https://riteshk.work/', preview.origin + '/'));
              await renderPage.waitForSelector(options.waitForSelector.selector);
              return new Response(await renderPage.pdf(options.pdfOptions), { headers: { 'Content-Type': 'application/pdf' } });
            } finally { await renderPage.close(); }
          } };
          const result = await resumeWorkspaceRoute(new Request(url.replace('/_worker', ''), { method: incoming.method(), headers: incoming.headers(), body: incoming.postData() }), bucket, {}, remoteBrowser, url => fetch(url.replace('https://riteshk.work', preview.origin)), legacy);
          return route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
        }
        if (url.startsWith(preview.origin + '/') || /^https:\/\/media\.riteshk\.work\/[a-f0-9]+\.woff2$/.test(url)) return route.continue();
        return route.abort();
      };
      await context.route('**/*', fixtureRoute);
      await page.goto(preview.origin + '/studio/?devstub=1');
      await page.waitForFunction(() => typeof window.__rkDevStudio === 'function');
      const ownerDraft = await page.evaluate(async ownerContent => {
        localStorage.setItem('rk:admin:sess', JSON.stringify({ token: 'synthetic-owner', exp: Date.now() + 3600000 }));
        const original = JSON.stringify(ownerContent);
        localStorage.setItem('rk:content:draft', original);
        localStorage.setItem('rk:content:draft:sig', window.RK.publishedSig);
        await window.__rkDevStudio();
        return original;
      }, ownerContent);
      await page.locator('.adm.is-open').waitFor();
      await page.evaluate(() => {
        window.__RKStudio.resumeAI = { models: async () => ({ provider: 'anthropic', checkedAt: Date.now(), models: [{ id: 'synthetic-model', pricing: { input: 2, output: 10 } }] }), connect: async () => { throw new Error('No paid calls in this test'); } };
      });
      assert.equal(await page.locator('.adm__tab[data-tab="resume"]').count(), 0);
      await page.locator('.adm__tab[data-tab="ai"]').click();
      await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
      await page.getByRole('button', { name: 'Saved resumes', exact: true }).click();
      const editor = page.frameLocator('.adm__resume-host');
      await editor.getByText('No active resumes', { exact: true }).waitFor();
      assert.equal((await store.list()).documents.length, 0);
      await editor.getByRole('button', { name: 'Create resume', exact: true }).click();
      await editor.locator('.rws-status.is-saved').waitFor();
      await editor.getByRole('tab', { name: 'Content', exact: true }).click();
      await editor.getByLabel('Summary', { exact: true }).fill('A truthful fictional product-design summary.');
      await editor.locator('.rws-status.is-saved').waitFor();
      const bytes = Buffer.from('Immutable fictional career source.');
      await editor.locator('input[type=file]').setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: bytes });
      await editor.getByRole('button', { name: 'Attach original', exact: true }).click();
      await editor.getByRole('dialog').waitFor({ state: 'hidden' });
      await editor.locator('.rws-status.is-saved').waitFor();
      const row = (await store.list()).documents[0], id = row.document.id;
      assert.deepEqual(Buffer.from((await store.sourceFile(row.document.sourceIds[0])).bytes), bytes);
      await editor.getByRole('button', { name: 'Preview PDF', exact: true }).click();
      await editor.locator('.rws-flash.is-error').waitFor();
      assert.match(await editor.locator('.rws-flash.is-error').textContent(), /PDF verification expired. Export again/);
      assert.equal((await store.get(id)).exports.length, 0);
      assert.equal((await bucket.list({ prefix: 'pending/' })).objects.length, 0);
      assert.deepEqual((await store.get(id)).document, row.document);
      await editor.getByRole('button', { name: 'Preview PDF', exact: true }).click();
      await editor.locator('.rws[data-view="pdf"], .rws-flash.is-error').waitFor();
      assert.equal(await editor.locator('.rws[data-view="pdf"]').count(), 1, await editor.locator('.rws-flash').textContent().catch(() => JSON.stringify(errors)));
      const artifact = (await store.get(id)).exports[0];
      assert.equal(artifact.verification.complete, true); assert.equal(artifact.layoutBoundsVerified, true); assert.equal(rendered, 2);
      assert.match(await editor.getByRole('link', { name: 'Download this PDF', exact: true }).getAttribute('href'), /^blob:/);
      const hostedText = editor.getByRole('region', { name: 'Verified exported PDF', exact: true }).locator('.textLayer').first();
      await hostedText.waitFor();
      assert.ok((await hostedText.textContent()).replace(/\s/g, '').includes('Atruthfulfictionalproduct-designsummary.'));
      assert.equal(await editor.getByRole('button', { name: 'Back to Studio', exact: true }).isVisible(), true);
      await editor.getByRole('button', { name: 'Back to ATS check', exact: true }).click();
      await page.locator('.adm__resume-host').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Saved resumes', exact: true }).click();
      await editor.locator('.rws-status.is-saved').waitFor();
      await editor.getByRole('tab', { name: 'Review', exact: true }).click();
      assert.equal(await editor.getByRole('button', { name: 'Review with AI', exact: true }).count(), 0);
      await editor.getByRole('button', { name: 'Re-check ATS', exact: true }).click();
      assert.equal(await editor.getByRole('button', { name: 'Run ATS check', exact: true }).isEnabled(), false);
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-hosted-' + width + '.png') });
        assert.equal(await editor.locator('.rws').evaluate(element => element.scrollWidth <= innerWidth + 1), true);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await editor.getByRole('tab', { name: 'Content', exact: true }).click();
      failedSave = true;
      await editor.getByLabel('Summary', { exact: true }).fill('Retain this edit when cloud saving fails.');
      await editor.locator('.rws-status.is-error').waitFor();
      await editor.getByRole('button', { name: 'Back to Studio', exact: true }).click();
      assert.equal(await page.locator('.adm__resume-host').count(), 1);
      assert.equal(await page.evaluate(id => !!localStorage.getItem('rk:resume:pending:' + id), id), true);
      failedSave = false;
      await editor.getByRole('button', { name: 'Back to Studio', exact: true }).click();
      await page.locator('.adm__resume-host').waitFor({ state: 'detached' });
      assert.equal((await store.get(id)).document.model.summary, 'Retain this edit when cloud saving fails.');
      await page.getByRole('button', { name: 'Saved resumes', exact: true }).click();
      await editor.locator('.rws-status.is-saved').waitFor();
      assert.equal(await editor.locator('.rws-status').textContent().then(text => text.includes('Saved to Cloudflare')), true);
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:content:draft')), ownerDraft);
      await assert.rejects(page.evaluate(() => window.__RKStudio.resume.request('library', {}, window)), /owner session expired/);
      assert.equal(calls, 0); assert.deepEqual(errors, []);
      await editor.getByRole('button', { name: 'Back to ATS check', exact: true }).click();
      await page.locator('.adm__resume-host').waitFor({ state: 'detached' });
      const review = { id: 'migration-review', tool: 'ats', kind: 'review', at: 10, payload: { text: 'Original immutable resume before edits.', state: { mode: 'job', jd: 'Design accessible enterprise workflows', company: 'SyntheticCo' }, res: { score: 62, summary: 'Original assessment', checks: [], fixes: [{ point: 'Clarify summary', priority: 'high', anchor: { quote: 'Preserved edited summary.' } }] }, resumeDocument: { version: 1, sha256: row.document.sourceIds[0], name: 'original.txt', size: bytes.length, type: 'text/plain', lastModified: 0 } } };
      const workspace = { id: 'migration-workspace', tool: 'ats', kind: 'workspace', at: 20, payload: { reviewId: review.id, company: 'SyntheticCo', level: 'staff', jd: 'Design accessible enterprise workflows', res: review.payload.res, text: review.payload.text, rb: { name: 'Synthetic Designer', title: 'Product Designer', summary: 'Preserved edited summary.', contact: { email: 'synthetic@example.test', links: [{ label: 'Portfolio', url: 'https://example.test' }] }, sections: [{ kind: 'experience', heading: 'Experience', items: [{ role: 'Designer', org: 'Example', dates: '2020 - Present', location: '', bullets: ['Designed accessible enterprise workflows with research evidence.'] }] }] }, design: { font: 'inter', size: 'a4', density: 'normal', margin: 'normal', accent: '#167d83', layout: 'single', keepWhole: true } } };
      await legacy.put('prep/ats/' + review.id + '.json', JSON.stringify(review));
      await legacy.put('prep/ats/' + workspace.id + '.json', JSON.stringify(workspace));
      await page.evaluate(entries => localStorage.setItem('rk:prep:hist', JSON.stringify({ ats: entries })), [review, workspace]);
      await page.locator('.prep-dialog [data-prep-close]').click();
      await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
      await page.locator('[data-act="ats-hist-open"][data-id="migration-review"]').click();
      await page.locator('[data-atsv-continue]').click();
      await editor.locator('[data-ats-migration]').waitFor();
      assert.equal(await page.evaluate(() => {
        const host = document.querySelector('.adm__resume-host'), review = document.querySelector('.atsv');
        return Number(getComputedStyle(host).zIndex) > Number(getComputedStyle(review).zIndex) && document.elementFromPoint(innerWidth / 2, innerHeight / 2) === host;
      }), true, 'The editor must be painted above the retained ATS review');
      const migratedId = (await atsMigrationIdentity(workspace)).id;
      assert.equal((await store.get(migratedId)).document.model.summary, workspace.payload.rb.summary);
      assert.equal(await page.locator('[data-rbz-doc]').count(), 0);
      await editor.getByRole('button', { name: 'Edit affected field', exact: true }).click();
      assert.equal(await editor.getByLabel('Summary', { exact: true }).inputValue(), workspace.payload.rb.summary);
      await editor.getByLabel('Summary', { exact: true }).fill('Current edited summary with accessibility and research outcomes.');
      await editor.locator('.rws-status.is-saved').waitFor();
      const migrated = await store.get(migratedId);
      assert.deepEqual(migrated.document.ats.legacy.entry, workspace);
      assert.deepEqual(new Uint8Array((await store.sourceFile(row.document.sourceIds[0])).bytes), new Uint8Array(bytes));
      const renderBefore = rendered;
      await editor.getByRole('button', { name: 'Preview PDF', exact: true }).click();
      await editor.locator('.rws[data-view="pdf"]').waitFor();
      await editor.getByRole('button', { name: 'Edit resume', exact: true }).click();
      await editor.getByRole('button', { name: 'Preview PDF', exact: true }).click();
      await editor.locator('.rws[data-view="pdf"]').waitFor();
      assert.equal(rendered, renderBefore + 1);
      assert.equal(await editor.getByRole('link', { name: 'Download this PDF', exact: true }).count(), 0);
      await editor.getByRole('button', { name: 'Review migrated layout', exact: true }).click();
      await editor.getByRole('button', { name: 'Keep reviewing', exact: true }).click();
      assert.equal((await store.get(migratedId)).document.ats.layoutAccepted, false);
      await editor.getByRole('button', { name: 'Review migrated layout', exact: true }).click();
      await editor.getByRole('button', { name: 'Accept reviewed layout', exact: true }).click();
      await editor.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal((await store.get(migratedId)).document.ats.layoutAccepted, true);
      assert.match(await editor.getByRole('link', { name: 'Download this PDF', exact: true }).getAttribute('href'), /^blob:/);
      const originalExport = (await store.get(migratedId)).exports.at(-1);
      const originalExportBytes = Buffer.from((await store.exportFile(migratedId, originalExport.id)).bytes);
      await editor.getByRole('button', { name: 'Edit resume', exact: true }).click();
      await editor.getByRole('tab', { name: 'Design', exact: true }).click();
      await editor.getByLabel('Margins', { exact: true }).selectOption('narrow');
      await editor.locator('.rws-status.is-saved').waitFor();
      await editor.getByRole('button', { name: 'Preview PDF', exact: true }).click();
      await editor.locator('.rws[data-view="pdf"]').waitFor();
      assert.equal(rendered, renderBefore + 2);
      assert.notEqual((await store.get(migratedId)).exports.at(-1).signature, originalExport.signature);
      assert.deepEqual(Buffer.from((await store.exportFile(migratedId, originalExport.id)).bytes), originalExportBytes);
      await editor.getByRole('button', { name: 'Edit resume', exact: true }).click();
      for (const provider of ['openai', 'anthropic']) {
        await page.evaluate(provider => {
          localStorage.setItem('rk:ai:same', '0'); localStorage.setItem('rk:ai:mode', 'local'); localStorage.setItem('rk:ai:txt:provider', provider); localStorage.setItem('rk:ai:txt:key', 'synthetic-only');
        }, provider);
        const configuration = await page.evaluate(() => window.__RKStudio.resume.configuration(document.querySelector('.adm__resume-host').contentWindow));
        assert.equal(configuration.model, 'Studio automatic selection'); assert.equal(configuration.available, true);
      }
      await page.evaluate(() => {
        for (const [key, value] of Object.entries({ 'rk:ai:same': '0', 'rk:ai:mode': 'local', 'rk:ai:txt:provider': 'custom', 'rk:ai:txt:key': 'synthetic-only', 'rk:ai:txt:model': 'fixture-model', 'rk:ai:txt:base': location.origin + '/fake-ai' })) localStorage.setItem(key, value);
        window.atsMigrationCalls = [];
        const originalFetch = window.fetch;
        window.fetch = async (resource, options = {}) => {
          if (!String(resource).includes('/fake-ai')) return originalFetch(resource, options);
          const input = JSON.parse(options.body), system = input.messages.find(message => message.role === 'system')?.content || '';
          const user = input.messages.find(message => message.role === 'user')?.content || '';
          if (system.startsWith("You are Studio's outcome coordinator.")) {
            const packet = JSON.parse(user), decision = packet.candidate ? { action: 'finish', summary: 'Validated fixture result' } : { action: 'draft', modelRef: packet.draftModels[0], task: 'analysis', instruction: '', inputs: [], summary: 'Use the current saved resume' };
            return Response.json({ choices: [{ message: { content: JSON.stringify({ decision }) }, finish_reason: 'stop' }] });
          }
          window.atsMigrationCalls.push({ system, user });
          if (window.deferMigrationCheck) await new Promise(resolve => { window.releaseMigrationCheck = resolve; });
          const value = system.includes('ONE exact field replacement') ? { kind: 'question', question: 'Which outcome can you substantiate?', reason: 'No new metric was supplied.' } : { score: 79, band: 'Good', summary: 'Checked the current exported resume', checks: [], fixes: [{ point: 'Clarify research impact', priority: 'high', anchor: { quote: 'Current edited summary with accessibility and research outcomes.' } }], keywords: { present: [], missing: [] } };
          return Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
        };
      });
      await editor.getByRole('tab', { name: 'Review', exact: true }).click();
      await editor.getByRole('button', { name: 'Re-check ATS', exact: true }).click();
      await editor.getByRole('checkbox', { name: 'Allow this resume and target to be sent for an ATS check.' }).check();
      await editor.getByRole('button', { name: 'Run ATS check', exact: true }).click();
      await Promise.race([editor.getByRole('dialog').waitFor({ state: 'hidden' }), editor.getByRole('dialog').getByRole('alert').waitFor()]);
      assert.equal(await editor.getByRole('dialog').count(), 0, (await editor.getByRole('dialog').allTextContents()).join(''));
      const assessed = await store.get(migratedId);
      assert.equal(assessed.document.aiReview.kind, 'ats');
      assert.equal(assessed.document.aiReview.signature, resumeSignature(assessed.document));
      const inputs = await page.evaluate(() => window.atsMigrationCalls);
      assert.ok(inputs.some(input => input.user.includes('Current edited summary') && input.user.includes('Design accessible enterprise workflows')));
      assert.ok(inputs.every(input => !input.user.includes('Original immutable resume before edits')));
      await editor.getByRole('button', { name: 'Prepare revision', exact: true }).click();
      await editor.getByRole('dialog').getByRole('checkbox').check();
      await editor.getByRole('button', { name: 'Approve revision request', exact: true }).click();
      await editor.getByText('Which outcome can you substantiate?', { exact: true }).waitFor();
      assert.equal((await store.get(migratedId)).document.model.summary, assessed.document.model.summary);
      await page.evaluate(() => { window.deferMigrationCheck = true; });
      await editor.getByRole('button', { name: 'Re-check ATS', exact: true }).click();
      await editor.getByRole('dialog').getByRole('checkbox').check();
      await editor.getByRole('button', { name: 'Run ATS check', exact: true }).click();
      await page.waitForFunction(() => typeof window.releaseMigrationCheck === 'function');
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await editor.getByRole('tab', { name: 'Content', exact: true }).click();
      await editor.getByLabel('Summary', { exact: true }).fill('Newer wording after cancelled assessment.');
      await editor.locator('.rws-status.is-saved').waitFor();
      const cancelled = await store.get(migratedId);
      await page.evaluate(() => { window.deferMigrationCheck = false; window.releaseMigrationCheck(); });
      await page.waitForFunction(() => window.__rkAiSession.state().active === 0);
      assert.deepEqual(await store.get(migratedId), cancelled);
      const pending = new Promise(resolve => { saveStarted = resolve; }); holdSave = true;
      await editor.getByLabel('Summary', { exact: true }).fill('Cancel before the pending save finishes.');
      await pending;
      const callsBeforeEarlyCancel = await page.evaluate(() => window.atsMigrationCalls.length), exportsBeforeEarlyCancel = (await store.get(migratedId)).exports.length;
      await editor.getByRole('tab', { name: 'Review', exact: true }).click();
      await editor.getByRole('button', { name: 'Re-check ATS', exact: true }).click();
      await editor.getByRole('dialog').getByRole('checkbox').check();
      await editor.getByRole('button', { name: 'Run ATS check', exact: true }).click();
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      releaseSave(); await editor.locator('.rws-status.is-saved').waitFor();
      assert.equal(await page.evaluate(() => window.atsMigrationCalls.length), callsBeforeEarlyCancel);
      assert.equal((await store.get(migratedId)).exports.length, exportsBeforeEarlyCancel);
      await editor.getByRole('tab', { name: 'Content', exact: true }).click();
      const legacyChanged = structuredClone(workspace); legacyChanged.payload.rb.summary = 'Recovered late legacy edit';
      await legacy.put('prep/ats/' + workspace.id + '.json', JSON.stringify(legacyChanged));
      await editor.getByLabel('Summary', { exact: true }).fill('Keep current unsaved wording through recovery.');
      await editor.locator('.rws-status.is-conflict').waitFor();
      await editor.getByRole('button', { name: 'Compare versions', exact: true }).click();
      await editor.getByRole('button', { name: 'Recover legacy copies', exact: true }).click();
      await editor.locator('.rws-status.is-saved').waitFor();
      assert.equal((await store.get(migratedId)).document.model.summary, 'Keep current unsaved wording through recovery.');
      assert.ok((await store.list()).documents.some(row => row.document.model.summary === 'Recovered late legacy edit'));
      await editor.locator('html').evaluate(() => {
        const write = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key.startsWith('rk:resume:')) throw new DOMException('Storage full', 'QuotaExceededError'); return write.call(this, key, value); };
      });
      failedSave = true;
      await editor.getByLabel('Summary', { exact: true }).fill('Cloud save survives unavailable local recovery storage.');
      await editor.locator('.rws-status.is-error').waitFor();
      assert.equal(await editor.locator('html').evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
      assert.equal((await store.get(migratedId)).document.model.summary, 'Keep current unsaved wording through recovery.');
      failedSave = false;
      await editor.getByRole('button', { name: 'Retry save', exact: true }).click();
      await editor.locator('.rws-status.is-saved').waitFor();
      const cloudDocument = (await store.get(migratedId)).document;
      assert.equal(cloudDocument.model.summary, 'Cloud save survives unavailable local recovery storage.');
      assert.equal(cloudDocument.design.margin, 'narrow'); assert.equal(cloudDocument.design.accent, workspace.payload.design.accent);
      assert.deepEqual(cloudDocument.ats.legacy.entry, workspace);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await editor.locator('.rws').evaluate(element => element.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: join(tmpdir(), 'rk-ats-migration-' + width + '.png') });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await editor.getByRole('tab', { name: 'Review', exact: true }).click();
      await page.evaluate(() => { window.deferMigrationCheck = true; delete window.releaseMigrationCheck; });
      await editor.getByRole('button', { name: 'Re-check ATS', exact: true }).click();
      await editor.getByRole('dialog').getByRole('checkbox').check();
      await editor.getByRole('button', { name: 'Run ATS check', exact: true }).click();
      await page.waitForFunction(() => typeof window.releaseMigrationCheck === 'function');
      const peer = await store.get(migratedId);
      const peerDocument = editResumeField(peer.document, 'summary', 'Newer wording saved from another device.');
      const peerSaved = await store.save(migratedId, peerDocument, peer.version);
      await page.evaluate(() => { window.deferMigrationCheck = false; window.releaseMigrationCheck(); });
      await page.waitForFunction(() => window.__rkAiSession.state().active === 0);
      await editor.locator('.rws-status.is-conflict').waitFor();
      assert.deepEqual(await store.get(migratedId), peerSaved);
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await editor.getByRole('button', { name: 'Compare versions', exact: true }).click();
      await editor.getByRole('button', { name: 'Use server version', exact: true }).click();
      await editor.locator('.rws-status.is-saved').waitFor();
      await page.evaluate(() => { window.deferMigrationCheck = true; delete window.releaseMigrationCheck; });
      await editor.getByRole('button', { name: 'Re-check ATS', exact: true }).click();
      await editor.getByRole('dialog').getByRole('checkbox').check();
      await editor.getByRole('button', { name: 'Run ATS check', exact: true }).click();
      await page.waitForFunction(() => typeof window.releaseMigrationCheck === 'function');
      const beforeClose = await store.get(migratedId);
      await editor.getByRole('dialog').press('Escape');
      await editor.getByRole('button', { name: 'Back to ATS check', exact: true }).click();
      await page.locator('.adm__resume-host').waitFor({ state: 'detached' });
      await page.evaluate(() => { window.deferMigrationCheck = false; window.releaseMigrationCheck(); });
      await page.waitForFunction(() => window.__rkAiSession.state().active === 0);
      assert.deepEqual(await store.get(migratedId), beforeClose);
      assert.equal(await page.locator('.atsv').isVisible(), true);
      assert.equal(await page.locator('.atsv').evaluate(element => element.inert), false);
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:content:draft')), ownerDraft);
      const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      try {
        await otherContext.route('**/*', fixtureRoute);
        const otherPage = await otherContext.newPage();
        await otherPage.goto(preview.origin + '/studio/?devstub=1');
        await otherPage.waitForFunction(() => typeof window.__rkDevStudio === 'function');
        await otherPage.evaluate(async () => { localStorage.setItem('rk:admin:sess', JSON.stringify({ token: 'synthetic-owner', exp: Date.now() + 3600000 })); await window.__rkDevStudio(); });
        await otherPage.locator('.adm__tab[data-tab="ai"]').click();
        await otherPage.locator('[data-act="prep-open"][data-tool="ats"]').click();
        await otherPage.locator('[data-act="resume-hist-open"][data-id="' + migratedId + '"]').click();
        const restored = otherPage.frameLocator('.adm__resume-host');
        await restored.locator('.rws-status.is-saved').waitFor();
        await restored.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Content', exact: true }).click();
        assert.equal(await restored.getByLabel('Summary', { exact: true }).inputValue(), peerDocument.model.summary);
        assert.deepEqual((await store.get(migratedId)).document, peerSaved.document);
        const controls = await restored.locator('.rws-workbar button').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }));
        assert.ok(controls.length > 0); assert.ok(controls.every(box => box.left >= 0 && box.right <= 390));
        for (const [index, first] of controls.entries()) for (const second of controls.slice(index + 1)) assert.ok(first.right <= second.left || second.right <= first.left || first.bottom <= second.top || second.bottom <= first.top);
        await otherPage.screenshot({ path: join(tmpdir(), 'rk-ats-migration-restored-mobile.png') });
      } finally { await otherContext.close(); }
      assert.deepEqual(errors, []);
    } finally { await context.close(); await runtime.dispose(); }
  });
  test('Compact typography fields step, hold and scrub with one reversible change and fit phone widths', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'typography-gestures'; document.design.bodySize = 8.25; document.design.lineHeight = 1.23;
    preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      await page.getByRole('tab', { name: 'Design', exact: true }).click();
      const body = page.getByLabel('Body size (pt)', { exact: true }), line = page.getByLabel('Line height', { exact: true });
      await page.getByRole('button', { name: 'Increase Body size (pt)', exact: true }).click(); await saved(page);
      assert.equal(await body.inputValue(), '8.26');
      await body.press('ArrowDown'); await saved(page); assert.equal(await body.inputValue(), '8.25');
      const heldBefore = structuredClone(preview.store.get(document.id));
      const increase = await page.getByRole('button', { name: 'Increase Body size (pt)', exact: true }).boundingBox();
      await page.mouse.move(increase.x + increase.width / 2, increase.y + increase.height / 2); await page.mouse.down();
      await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Body size (pt)"]').value) >= 8.28);
      assert.deepEqual(preview.store.get(document.id), heldBefore);
      await page.mouse.up(); await saved(page);
      assert.equal(preview.store.get(document.id).version, heldBefore.version + 1);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page); assert.equal(await body.inputValue(), '8.25');
      const dragBefore = preview.store.get(document.id).version;
      const bounds = await body.boundingBox(), start = { x: bounds.x + 25, y: bounds.y + bounds.height / 2 };
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 40, start.y, { steps: 5 });
      assert.equal(await body.inputValue(), '8.75'); assert.equal(preview.store.get(document.id).version, dragBefore);
      await page.mouse.up(); await saved(page); assert.equal(preview.store.get(document.id).version, dragBefore + 1);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page); assert.equal(await body.inputValue(), '8.25');
      await page.getByRole('button', { name: 'Redo', exact: true }).click(); await saved(page); assert.equal(await body.inputValue(), '8.75');
      const cancelBefore = structuredClone(preview.store.get(document.id));
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 40, start.y);
      await page.keyboard.press('Escape'); await page.mouse.up();
      assert.equal(await body.inputValue(), '8.75'); assert.deepEqual(preview.store.get(document.id), cancelBefore);
      await line.fill('1.8'); await saved(page);
      assert.equal(await page.getByRole('button', { name: 'Increase Line height', exact: true }).isDisabled(), true);
      await line.fill('1.15'); await saved(page);
      assert.equal(await page.getByRole('button', { name: 'Decrease Line height', exact: true }).isDisabled(), true);
      await line.fill('1.23'); await saved(page);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        if (!await body.isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Design', exact: true }).click();
        await body.scrollIntoViewIfNeeded();
        const geometry = await page.locator('.rws-typography-row').evaluate(row => {
          const fields = [...row.querySelectorAll('input')].map(element => element.getBoundingClientRect());
          const controls = [...row.querySelectorAll('input,button')].map(element => element.getBoundingClientRect());
          return { aligned: Math.abs(fields[0].top - fields[1].top) < 1, separated: fields[1].left - fields[0].right >= 11, fit: controls.every(rect => rect.width > 10 && rect.height > 10 && rect.left >= 0 && rect.right <= innerWidth) };
        });
        assert.deepEqual(geometry, { aligned: true, separated: true, fit: true });
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-typography-' + width + '.png') });
      }
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      const touchBounds = await line.boundingBox(), touch = { x: touchBounds.x + 25, y: touchBounds.y + touchBounds.height / 2 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, x: touch.x + 40 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await saved(page);
      assert.equal(await line.inputValue(), '1.33');
      const touchBefore = structuredClone(preview.store.get(document.id));
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, x: touch.x + 40 }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      assert.equal(await line.inputValue(), '1.33'); assert.deepEqual(preview.store.get(document.id), touchBefore);
      await session.detach(); await page.reload(); await saved(page);
      assert.equal(preview.store.get(document.id).document.design.bodySize, 8.75);
      assert.equal(preview.store.get(document.id).document.design.lineHeight, 1.33);
      assert.deepEqual(preview.store.get(document.id).document.model, document.model); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Canvas matches Studio background and page shadow without clipping preview gutters', async () => {
    const { page, context } = await openSample('avery-meridian');
    try {
      await page.frameLocator('iframe[title="Editable resume canvas"]').locator('.pagedjs_page [data-field="name"]').waitFor();
      await page.waitForFunction(() => Boolean(document.querySelector('.rws-paper')?.contentWindow.resumeReady));
      const assertSingleScroller = async () => {
        await page.waitForFunction(() => {
          const frame = document.querySelector('.rws-paper'), ready = frame?.contentWindow.resumeReady;
          return ready && frame.clientHeight === ready.height && frame.clientWidth === ready.width;
        });
        const dimensions = await page.locator('.rws-paper').evaluate(frame => {
          const inner = frame.contentDocument, root = inner.documentElement, bounds = inner.querySelector('.pagedjs_pages').getBoundingClientRect();
          return { horizontalOverflow: root.scrollWidth - root.clientWidth, verticalOverflow: root.scrollHeight - root.clientHeight, fitsWidth: bounds.right <= root.clientWidth, fitsHeight: bounds.bottom <= root.clientHeight };
        });
        assert.deepEqual(dimensions, { horizontalOverflow: 0, verticalOverflow: 0, fitsWidth: true, fitsHeight: true });
      };
      await assertSingleScroller();
      const styles = await page.evaluate(() => {
        const reference = document.createElement('div'); reference.className = 'rbz__main'; reference.style.cssText = 'position:fixed;left:-10000px';
        const paper = document.createElement('div'); paper.className = 'rbz__page'; reference.append(paper); document.querySelector('.rws').append(reference);
        const frame = document.querySelector('.rws-paper'), inner = frame.contentDocument, preview = inner.querySelector('.pagedjs_page');
        const result = { background: getComputedStyle(document.querySelector('.rws-canvas')).backgroundImage, expectedBackground: getComputedStyle(reference).backgroundImage, shadow: inner.defaultView.getComputedStyle(preview).boxShadow, expectedShadow: getComputedStyle(paper).boxShadow, body: inner.defaultView.getComputedStyle(inner.body).backgroundColor, left: preview.getBoundingClientRect().left, right: frame.clientWidth - preview.getBoundingClientRect().right, bottom: inner.body.scrollHeight - inner.querySelector('.pagedjs_page:last-child').getBoundingClientRect().bottom };
        reference.remove(); return result;
      });
      assert.equal(styles.background, styles.expectedBackground); assert.equal(styles.shadow, styles.expectedShadow);
      assert.equal(styles.body, 'rgba(0, 0, 0, 0)'); assert.ok(styles.left >= 48); assert.ok(styles.right >= 47); assert.ok(styles.bottom >= 55);
      const schemes = await page.locator('.rws-paper').evaluate(frame => ({ frame: getComputedStyle(frame).colorScheme, document: frame.contentWindow.getComputedStyle(frame.contentDocument.documentElement).colorScheme }));
      assert.equal(schemes.frame, schemes.document);
      const before = preview.store.get('avery-meridian');
      await page.getByRole('button', { name: 'Light canvas', exact: true }).click();
      assert.equal(await page.locator('.rws-canvas').getAttribute('data-canvas'), 'light');
      const light = await page.evaluate(() => {
        const inner = document.querySelector('.rws-paper').contentDocument;
        return { background: getComputedStyle(document.querySelector('.rws-canvas')).backgroundColor, paper: inner.defaultView.getComputedStyle(inner.querySelector('.pagedjs_page')).backgroundColor, shadow: inner.defaultView.getComputedStyle(inner.querySelector('.pagedjs_page')).boxShadow, theme: document.documentElement.dataset.themeMode };
      });
      assert.equal(light.background, 'rgb(238, 240, 243)'); assert.equal(light.paper, 'rgb(255, 255, 255)'); assert.equal(light.theme, 'night');
      assert.match(light.shadow, /17, 24, 39/); assert.deepEqual(preview.store.get('avery-meridian'), before);
      await page.reload(); await page.waitForFunction(() => Boolean(document.querySelector('.rws-paper')?.contentWindow.resumeReady));
      assert.equal(await page.locator('.rws-canvas').getAttribute('data-canvas'), 'light');
      await page.getByRole('button', { name: 'Light canvas', exact: true }).click();
      assert.equal(await page.locator('.rws-canvas').getAttribute('data-canvas'), 'dark');
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await assertSingleScroller();
        const toggle = page.getByRole('button', { name: 'Light canvas', exact: true });
        assert.equal(await toggle.isVisible(), true);
        const bounds = await toggle.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        await toggle.click(); assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
        await toggle.click();
      }
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-canvas-shadow-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-canvas-shadow-mobile.png') });
    } finally { await context.close(); }
  });
  test('Properties panel resizes with pointer and keyboard without changing resume data', async () => {
    const { page, context, errors } = await openSample('avery-meridian');
    try {
      await page.waitForFunction(() => Boolean(document.querySelector('.rws-paper')?.contentWindow.resumeReady));
      const before = preview.store.get('avery-meridian');
      const handle = page.getByRole('separator', { name: 'Resize properties panel', exact: true });
      const inspector = page.getByRole('complementary', { name: 'Resume properties', exact: true });
      const dragBy = async distance => {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + distance, box.y + 100, { steps: 6 }); await page.mouse.up();
      };
      assert.equal(await handle.getAttribute('aria-valuenow'), '316');
      await dragBy(-160);
      assert.equal(await handle.getAttribute('aria-valuenow'), '476');
      assert.ok(Math.abs((await inspector.boundingBox()).width - 476) < 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:resume-preview:inspector-width')), '476');
      await page.reload(); await page.waitForFunction(() => Boolean(document.querySelector('.rws-paper')?.contentWindow.resumeReady));
      assert.equal(await handle.getAttribute('aria-valuenow'), '476');
      await handle.focus(); await page.keyboard.press('ArrowLeft');
      assert.equal(await handle.getAttribute('aria-valuenow'), '492');
      await page.keyboard.press('ArrowRight'); assert.equal(await handle.getAttribute('aria-valuenow'), '476');
      await page.keyboard.press('Home'); assert.equal(await handle.getAttribute('aria-valuenow'), '316');
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
      await page.mouse.move(box.x - 100, box.y + 100);
      await handle.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
      assert.equal(await handle.getAttribute('aria-valuenow'), '316');
      assert.equal(await page.locator('.rws').getAttribute('data-resizing-inspector'), null);
      await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + 100); await page.keyboard.press('Escape'); await page.mouse.up();
      assert.equal(await handle.getAttribute('aria-valuenow'), '316');
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:resume-preview:inspector-width')), '316');
      await dragBy(500); assert.equal(await handle.getAttribute('aria-valuenow'), '290');
      await dragBy(-900); assert.equal(await handle.getAttribute('aria-valuenow'), '600');
      assert.ok((await page.locator('.rws-canvas').boundingBox()).width >= 400);
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-properties-wide.png') });
      await page.setViewportSize({ width: 900, height: 900 });
      await page.waitForFunction(() => document.querySelector('.rws-inspector-resizer').getAttribute('aria-valuenow') === '500');
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:resume-preview:inspector-width')), '600');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await handle.isVisible(), false);
      await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
      const mobile = await inspector.boundingBox(); assert.ok(mobile.width <= 345 && mobile.x >= 0 && mobile.x + mobile.width <= 390);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForFunction(() => document.querySelector('.rws-inspector-resizer').getAttribute('aria-valuenow') === '600');
      await handle.dblclick(); assert.equal(await handle.getAttribute('aria-valuenow'), '316');
      assert.deepEqual(preview.store.get('avery-meridian'), before); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Slide accent picker and shared toast work on desktop and phones', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'shared-controls'; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        if (width < 760) {
          if (!await page.getByRole('button', { name: 'Accent', exact: true }).isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Design', exact: true }).click();
        } else await page.getByRole('tab', { name: 'Design', exact: true }).click();
        const preset = page.locator('.rws-accent').getByRole('button', { name: '#a5d8ff', exact: true });
        await preset.scrollIntoViewIfNeeded();
        const rowBounds = await page.locator('.rws-accent .color-picker-container').boundingBox();
        const swatches = await page.locator('.rws-accent .color-picker__top-picks button:not(.is-transparent)').evaluateAll(buttons => buttons.map(button => { const bounds = button.getBoundingClientRect(); return { x: bounds.x, right: bounds.right, width: bounds.width, height: bounds.height }; }));
        assert.equal(swatches.length, 4);
        assert.ok(swatches.every((swatch, index) => swatch.width === 24 && swatch.height === 24 && (!index || swatch.x - swatches[index - 1].right >= 8)));
        assert.ok(rowBounds.x >= 0 && rowBounds.x + rowBounds.width <= width);
        await preset.hover(); await preset.focus();
        assert.deepEqual(await page.locator('.rws-accent .color-picker-container').boundingBox(), rowBounds);
        await preset.click(); await saved(page);
        assert.equal(preview.store.get(document.id).document.design.accent, '#a5d8ff');
        assert.deepEqual(preview.store.get(document.id).document.model, document.model);
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-accent-spacing-' + width + '.png') });
        await page.getByRole('button', { name: 'Accent', exact: true }).click();
        await page.locator('.lab-rich-color .react-colorful').waitFor();
        assert.equal(await page.locator('input[type="color"]').count(), 0);
        const red = page.getByRole('spinbutton', { name: 'Red', exact: true });
        await red.fill(String(width === 1440 ? 48 : width === 390 ? 64 : 80)); await red.press('Tab'); await saved(page);
        assert.equal(preview.store.get(document.id).document.design.accent.slice(1, 3), width === 1440 ? '30' : width === 390 ? '40' : '50');
        const box = await page.locator('.color-picker-content').boundingBox();
        assert.ok(box.width > 150 && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900, JSON.stringify(box));
        const fits = await page.locator('.lab-rgb input').evaluateAll(inputs => inputs.every(input => {
          const style = getComputedStyle(input), measure = document.createElement('canvas').getContext('2d'); measure.font = style.font;
          return measure.measureText('255').width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        })); assert.equal(fits, true);
        await page.waitForFunction(() => !document.querySelector('.rws-page-count .is-spinning') && document.querySelector('.rws-paper')?.contentWindow.resumeReady);
        await page.screenshot({ path: join(tmpdir(), `rk-resume-shared-picker-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.color-picker-content'));
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Accent');
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: 'Accent', exact: true }).click();
      await page.evaluate(() => { window.EyeDropper = undefined; });
      await page.locator('.excalidraw-eye-dropper-trigger').click();
      await page.locator('.rk-flash.is-on[role="alert"]').waitFor();
      await page.setViewportSize({ width: 320, height: 900 });
      const toast = await page.locator('.rk-flash').boundingBox();
      assert.ok(toast.x >= 0 && toast.x + toast.width <= 320 && toast.y + toast.height < 844);
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-shared-toast-320.png') });
      await page.getByRole('button', { name: 'Dismiss message' }).click();
      assert.equal(await page.locator('.rk-flash').count(), 0); assert.deepEqual(errors, []);
      await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
      await page.getByRole('button', { name: 'AI review rubric', exact: true }).click();
      const rubric = page.getByRole('dialog', { name: 'AI review rubric', exact: true });
      assert.match(await rubric.innerText(), /configured transport/);
      assert.equal(await rubric.getByRole('heading', { name: 'Role evidence / 60%' }).count(), 1);
      const rubricBox = await rubric.locator('.pass__box').boundingBox(); assert.ok(rubricBox.x >= 0 && rubricBox.x + rubricBox.width <= 320);
      await rubric.getByRole('button', { name: 'Close', exact: true }).click();
    } finally { await context.close(); }
  });
  test('PDF embeds selected fonts and retains links and long content across margin changes', { timeout: 180000 }, async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    for (const [font, expectedFamily] of [['inter', 'Inter'], ['gelasio', 'Gelasio'], ['gambetta', 'Gambetta'], ['mono', 'JetBrains-Mono']]) {
      const document = fixture(); document.id = 'pdf-' + font; document.design.font = font; document.design.keepWhole = false;
      document.model.sections[0].items[0].bullets = Array.from({ length: 40 }, (_, index) => ({ id: 'long-' + index, text: 'Achievement ' + (index + 1) + ': Researched complex workflows with product and engineering teams, delivered accessible interfaces, and retained every original detail for review.' }));
      preview.store.create(document);
      const entry = await exportPdf(document);
      assert.equal(entry.renderVersion, RESUME_RENDER_VERSION);
      assert.equal(entry.layoutBoundsVerified, true);
      assert.ok(entry.layout.itemCount > 0); assert.ok(entry.layout.linearized.includes('Achievement 40'));
      assert.ok(entry.pages > 1); assert.equal(entry.verification.complete, true);
      assert.ok(entry.links.includes('https://example.test/work')); assert.ok(entry.links.includes('mailto:test@example.test'));
      const parsed = await getDocument({ data: new Uint8Array(preview.store.exportFile(document.id, entry.id).bytes), fontExtraProperties: true }).promise;
      const fonts = new Set();
      for (let number = 1; number <= parsed.numPages; number++) {
        const page = await parsed.getPage(number); await page.getOperatorList();
        for (const item of (await page.getTextContent()).items) if (item.fontName) fonts.add(page.commonObjs.get(item.fontName).name);
      }
      await parsed.destroy();
      const matchesFamily = name => name.replace(/-/g, '').includes(expectedFamily.replace(/-/g, ''));
      assert.ok([...fonts].some(matchesFamily), font + ': ' + [...fonts].join(', '));
      assert.ok([...fonts].every(name => matchesFamily(name) || name.includes('Inter')), 'Unexpected fallback: ' + [...fonts].join(', '));
      assert.equal((await exportPdf(document)).id, entry.id);
      document.design.margin = 'narrow'; preview.store.save(document.id, document, 1);
      const narrow = await exportPdf(document);
      assert.notEqual(narrow.id, entry.id); assert.ok(narrow.pages <= entry.pages); assert.equal(narrow.verification.complete, true);
    }
  });
  test('Source page limits block oversized PDFs and typography and columns remain editable across reloads', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'page-limit';
    document.design = { ...document.design, density: 'compact', margin: 'narrow', bodySize: 8.25, lineHeight: 1.23, pageLimit: 1, keepWhole: false };
    document.model.sections[0].items[0].bullets = Array.from({ length: 55 }, (_, index) => ({ id: 'limit-' + index, text: 'Contribution ' + index + ': Worked with research and engineering partners to understand complex workflows, validate accessible interfaces and preserve clear attribution for the delivered improvements.' }));
    document.model.sections.push({ id: 'achievements', kind: 'custom', heading: 'Key achievements', columns: 2, items: Array.from({ length: 4 }, (_, index) => ({ id: 'achievement-' + index, title: 'Achievement ' + index, meta: 'Original achievement detail ' + index })) });
    document.model.sections.push({ id: 'awards', kind: 'custom', heading: 'Awards', columns: 3, items: Array.from({ length: 5 }, (_, index) => ({ id: 'award-' + index, title: 'Recognition ' + index, meta: 'Original supporting detail ' + index })) });
    const originalModel = structuredClone(document.model);
    preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      await page.waitForFunction(() => document.querySelector('.rws-paper')?.contentWindow?.resumeReady?.layoutError);
      const ready = await page.locator('.rws-paper').evaluate(element => ({ pages: element.contentWindow.resumeReady.pages, layoutError: element.contentWindow.resumeReady.layoutError }));
      assert.ok(ready.pages > 1); assert.match(ready.layoutError, /1-page limit/);
      const gaps = await page.locator('.rws-paper').evaluate(frame => {
        const pages = [...frame.contentDocument.querySelectorAll('.pagedjs_page')].map(element => element.getBoundingClientRect());
        return pages.slice(1).map((bounds, index) => bounds.top - pages[index].bottom);
      });
      assert.ok(gaps.every(gap => Math.abs(gap - 32) < 1), JSON.stringify(gaps));
      const blocked = await fetch(preview.origin + '/__resume/api/resumes/' + document.id + '/export', { method: 'POST', headers: { Origin: preview.origin, 'If-Match': '1' } });
      assert.equal(blocked.status, 422); assert.match((await blocked.json()).error, /1-page limit/);
      assert.equal(preview.store.get(document.id).exports.length, 0);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width < 760) {
          if (!await page.getByLabel('Body size (pt)', { exact: true }).isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Design', exact: true }).click();
        }
        else await page.getByRole('tab', { name: 'Design', exact: true }).click();
        await page.getByLabel('Body size (pt)', { exact: true }).fill('8.5');
        await page.getByLabel('Line height', { exact: true }).fill('1.25');
        await saved(page);
        for (const label of ['Body size (pt)', 'Line height', 'Page limit']) {
          const control = page.getByLabel(label, { exact: true }); await control.scrollIntoViewIfNeeded();
          const bounds = await control.boundingBox(); assert.ok(bounds.width > 40 && bounds.x >= 0 && bounds.x + bounds.width <= width);
        }
        const hybrid = page.getByRole('button', { name: 'Hybrid', exact: true });
        await hybrid.focus(); await page.keyboard.press('Enter'); await saved(page);
        await page.waitForFunction(() => document.querySelector('.rws-paper')?.contentDocument?.querySelector('.pagedjs_page [data-section="awards"] .resume-entry-row'));
        assert.equal(await page.getByLabel('Key achievements columns', { exact: true }).inputValue(), '2');
        assert.equal(await page.getByLabel('Awards columns', { exact: true }).inputValue(), '3');
        for (const name of ['Single column', 'Two columns', 'Hybrid']) {
          const control = page.getByRole('button', { name, exact: true }); await control.scrollIntoViewIfNeeded();
          const fits = await control.evaluate(button => {
            const bounds = button.getBoundingClientRect(), label = button.querySelector('span').getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(button.querySelector('span'));
            return bounds.width > 40 && bounds.x >= 0 && bounds.right <= innerWidth && label.left >= bounds.left && label.right <= bounds.right && label.bottom <= bounds.bottom && [...range.getClientRects()].every(rect => rect.left >= bounds.left && rect.right <= bounds.right && rect.bottom <= bounds.bottom);
          });
          assert.equal(fits, true, name + ' does not fit at ' + width);
        }
        await page.getByLabel('Awards columns', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-layout-controls-' + width + '.png') });
        await page.getByRole('button', { name: 'Single column', exact: true }).click(); await saved(page);
        await page.waitForFunction(() => { const child = document.querySelector('.rws-paper')?.contentDocument; return child?.querySelector('.pagedjs_page [data-section="awards"]') && !child.querySelector('.pagedjs_page .resume-entry-row'); });
        if (width < 760) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Design', exact: true }).click();
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('tab', { name: 'Design', exact: true }).click();
      await page.getByLabel('Page limit', { exact: true }).fill('10'); await saved(page);
      await page.getByRole('button', { name: 'Hybrid', exact: true }).click(); await saved(page);
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      await page.getByLabel('Resume section', { exact: true }).selectOption('awards');
      await page.getByLabel('Entry columns', { exact: true }).selectOption('2'); await saved(page);
      await page.reload(); await saved(page);
      const current = preview.store.get(document.id).document;
      assert.equal(current.design.bodySize, 8.5); assert.equal(current.design.lineHeight, 1.25); assert.equal(current.design.pageLimit, 10);
      assert.equal(current.model.sections.at(-1).columns, 2);
      const expectedModel = structuredClone(originalModel); expectedModel.sections.at(-1).columns = 2;
      assert.deepEqual(current.model, expectedModel);
      assert.equal(current.design.layout, 'hybrid');
      const entry = await exportPdf(current);
      assert.equal(entry.verification.complete, true); assert.equal(entry.layoutBoundsVerified, true);
      const text = entry.extractedText.replace(/\s+/g, ' ');
      for (let index = 0; index < 4; index++) assert.ok(text.indexOf('Original supporting detail ' + index) < text.indexOf('Recognition ' + (index + 1)), 'Entry reading order changed.');
      await page.getByRole('tab', { name: 'Design', exact: true }).click();
      await page.getByRole('button', { name: 'Single column', exact: true }).click(); await saved(page);
      await page.reload(); await saved(page);
      const single = preview.store.get(document.id).document;
      assert.equal(single.design.layout, 'single'); assert.deepEqual(single.model, expectedModel);
      const singleExport = await exportPdf(single);
      const linearized = singleExport.layout.linearized.replace(/\s/g, '').toLowerCase();
      for (const section of single.model.sections.filter(section => ['achievements', 'awards'].includes(section.id))) {
        let previous = linearized.indexOf(section.heading.replace(/\s/g, '').toLowerCase());
        assert.ok(previous >= 0);
        for (const item of section.items) for (const field of [item.title, item.meta]) {
          const normalized = field.replace(/\s/g, '').toLowerCase(), position = linearized.indexOf(normalized, previous);
          assert.ok(position >= previous, 'Single-column geometry order interleaves entries.'); previous = position + normalized.length;
        }
      }
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      await page.getByLabel('Resume section', { exact: true }).selectOption('awards');
      assert.equal(await page.getByLabel('Entry columns', { exact: true }).isDisabled(), true);
      await page.getByRole('tab', { name: 'Design', exact: true }).click();
      await page.getByRole('button', { name: 'Hybrid', exact: true }).click(); await saved(page);
      await page.waitForFunction(() => document.querySelector('.rws-paper')?.contentDocument?.querySelector('.pagedjs_page [data-section="awards"] .resume-entry-row'));
      assert.equal(await page.getByLabel('Key achievements columns', { exact: true }).inputValue(), '2');
      assert.equal(await page.getByLabel('Awards columns', { exact: true }).inputValue(), '2');
      assert.deepEqual(preview.store.get(document.id).document.model, expectedModel);
      const positions = Array.from({ length: 2 }, () => ({ width: 595.28, height: 841.89, items: [] }));
      assert.throws(() => verifyResumePdf(document, positions), /1-page limit/);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Dates align to entry right edges and education descriptions share a line without losing editable fields', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'entry-dates';
    document.design = { ...document.design, density: 'compact', bodySize: 8.25, lineHeight: 1.23 };
    document.model.sections.push({ id: 'awards', heading: 'Awards', kind: 'custom', columns: 3, items: Array.from({ length: 3 }, (_, index) => ({ id: 'award-' + index, title: 'Recognition ' + index, dates: ['Aug 2024', '2 years 4 months', '09:30 - 11:00 UTC'][index], meta: 'Original attribution ' + index })) }, { id: 'education', heading: 'Education', kind: 'education', items: [{ id: 'school', school: 'Design School', dates: '2010 - 2014', credential: 'Bachelor in Design', note: '\u2022 Communication Design' }] });
    preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      await page.getByLabel('Resume section', { exact: true }).selectOption('awards');
      await page.getByRole('group', { name: 'Recognition 0', exact: true }).getByLabel('Dates / duration / time', { exact: true }).fill('Oct 2024'); await saved(page);
      await page.reload(); await saved(page);
      const current = preview.store.get(document.id).document;
      assert.equal(current.model.sections.find(section => section.id === 'awards').items[0].dates, 'Oct 2024');
      assert.equal(current.model.sections.find(section => section.id === 'awards').items[0].meta, 'Original attribution 0');
      await page.getByRole('tab', { name: 'Design', exact: true }).click();
      for (const [layout, label] of [['single', 'Single column'], ['hybrid', 'Hybrid'], ['sidebar', 'Two columns']]) {
        await page.getByRole('button', { name: label, exact: true }).click(); await saved(page);
        const signature = resumeSignature(preview.store.get(document.id).document);
        await page.waitForFunction(signature => document.querySelector('.rws-paper')?.contentWindow?.resumeReady?.signature === signature, signature);
        const geometry = await page.locator('.rws-paper').evaluate(frame => {
          const child = frame.contentDocument;
          const dates = [...child.querySelectorAll('.pagedjs_page .entry-heading .dates')].filter(date => date.textContent).map(date => {
            const bounds = date.getBoundingClientRect(), entry = date.closest('.resume-entry').getBoundingClientRect(), title = date.previousElementSibling.getBoundingClientRect();
            return { right: Math.abs(bounds.right - entry.right), inside: bounds.left >= entry.left - 1 && bounds.right <= entry.right + 1, noOverlap: bounds.left >= title.right - 1 || bounds.top >= title.bottom - 1 };
          });
          const credential = child.querySelector('.pagedjs_page [data-field="school.credential"]'), note = child.querySelector('.pagedjs_page [data-field="school.note"]');
          return { dates, educationSameLine: Math.abs(credential.getBoundingClientRect().top - note.getBoundingClientRect().top) < 1 };
        });
        assert.ok(geometry.dates.length >= 5);
        assert.ok(geometry.dates.every(date => date.right < 2 && date.inside && date.noOverlap), JSON.stringify({ layout, geometry }));
        if (layout !== 'sidebar') assert.equal(geometry.educationSameLine, true);
        const exported = await exportPdf(preview.store.get(document.id).document);
        assert.equal(exported.verification.complete, true); assert.equal(exported.layoutBoundsVerified, true);
        const text = exported.extractedText.replace(/\s/g, '');
        for (const value of ['Oct2024', '2years4months', '09:30-11:00UTC', 'BachelorinDesign', 'CommunicationDesign']) assert.ok(text.includes(value), value);
      }
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width < 760) {
          if (!await page.getByLabel('Resume section', { exact: true }).isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Content', exact: true }).click();
        }
        else await page.getByRole('tab', { name: 'Content', exact: true }).click();
        await page.getByLabel('Resume section', { exact: true }).selectOption('awards');
        const input = page.getByRole('group', { name: 'Recognition 0', exact: true }).getByLabel('Dates / duration / time', { exact: true });
        await input.scrollIntoViewIfNeeded();
        const bounds = await input.boundingBox(); assert.ok(bounds.width > 40 && bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.equal(await input.inputValue(), 'Oct 2024');
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-date-controls-' + width + '.png') });
        if (width < 760) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Content', exact: true }).click();
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Checked PDF retains long fields spanning page counters and authored fraction text', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'long-paragraph'; document.design.keepWhole = false;
    document.model.sections = [{ id: 'long-evidence', heading: 'Experience', kind: 'text', text: Array.from({ length: 90 }, (_, index) => 'Contribution ' + (index + 1) + ': Authored 1 / 3 of the interaction specification with research and engineering, retaining precise attribution.').join(' ') }];
    preview.store.create(document);
    const entry = await exportPdf(document);
    assert.ok(entry.pages >= 3); assert.equal(entry.verification.complete, true);
    const extracted = entry.extractedText.replace(/\s+/g, ' ');
    assert.match(extracted, /Contribution 90/); assert.match(extracted, /1\s*\/\s*3/);
    assert.equal(validatePdfText(document, extracted.replace(/Contribution 90/g, 'Missing end')).complete, false);
  });
  test('PDF import keeps late-drawn bullets and punctuation through editing, reload and checked export', { timeout: 90000 }, async () => {
    const sourcePage = await browser.newPage();
    let bytes;
    try {
      await sourcePage.setContent('<style>@page{size:A4;margin:0}body{font:16px Arial}p,span{position:absolute;margin:0;left:65px}span{left:48px}</style><p style="top:48px">Imported evidence</p><p style="top:88px">Led 0\u21921 work for 200+ users (unchanged).</p><p style="top:110px">Retained supporting context.</p><p style="top:142px">Second point with original punctuation.</p><span style="top:88px">\u2022</span><span style="top:142px">\u2022</span>');
      bytes = await sourcePage.pdf({ preferCSSPageSize: true });
    } finally { await sourcePage.close(); }
    const document = fixture(); document.id = 'bullet-import'; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      await page.locator('input[type=file]').setInputFiles({ name: 'bullet-source.pdf', mimeType: 'application/pdf', buffer: bytes });
      const extracted = await page.locator('.rws-import-text').innerText();
      assert.equal((extracted.match(/\u2022/g) || []).length, 2);
      assert.match(extracted, /\u2022 Led 0\u21921 work for 200\+ users \(unchanged\)\./);
      assert.match(extracted, /\u2022 Second point/);
      await page.getByRole('button', { name: 'Create resume from text', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' }); await saved(page);
      const id = await page.evaluate(() => localStorage.getItem('rk:resume-preview:selected'));
      const imported = preview.store.get(id).document;
      assert.equal(imported.design.pageLimit, 1);
      assert.equal(imported.importNotes.sourcePages, 1);
      assert.equal(imported.model.sections[0].text, extracted);
      assert.deepEqual(preview.store.sourceFile(imported.sourceIds[0]).bytes, bytes);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
        await page.reload(); await saved(page);
        const canvas = page.frameLocator('iframe[title="Editable resume canvas"]');
        await canvas.locator('.pagedjs_page .resume-import-list li').first().waitFor();
        assert.equal(await canvas.locator('.pagedjs_page .resume-import-list li').count(), 2);
        assert.equal(await canvas.locator('.resume-import-marker').first().evaluate(element => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0), true);
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-bullet-import-' + width + '.png') });
      }
      const entry = await exportPdf(imported);
      assert.equal(entry.verification.complete, true);
      assert.equal((entry.extractedText.match(/\u2022/g) || []).length, 2);
      assert.match(entry.extractedText, /0\s*\u2192\s*1/); assert.match(entry.extractedText, /200\s*\+/);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Structured source import creates editable roles and retains originals through reload and PDF export', async () => {
    const document = fixture(); document.id = 'structured-import'; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    const text = 'Alex Example\nPortfolio: https://example.test/design\n\nExperience\nLead Designer\nExample Studio\n2020 - Present\n- Led 12 interviews.\n- Designed accessible workflows.\n\nDesigner\nEarlier Studio\n2018 - 2020\n- Tested prototypes.\n\nSkills\nTools: Figma, Sketch\n\nEducation\nExample University\nB.Des\n2014 - 2018';
    try {
      await page.locator('input[type=file]').setInputFiles({ name: 'structured.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
      assert.match(await page.getByRole('list', { name: 'Recognized sections' }).innerText(), /Experience: experience \/ 2 entries/);
      await page.getByRole('button', { name: 'Create resume from text', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' }); await saved(page);
      const id = await page.evaluate(() => localStorage.getItem('rk:resume-preview:selected'));
      const imported = preview.store.get(id).document;
      const roles = imported.model.sections.find(section => section.kind === 'experience');
      assert.equal(roles.items.length, 2);
      const fieldId = roles.items[0].bullets[0].id;
      const canvas = page.frameLocator('iframe[title="Editable resume canvas"]');
      await canvas.locator('[data-field="' + fieldId + '"]').click();
      await page.locator('[data-field-input="' + fieldId + '"]').fill('Led 12 interviews with participants.'); await saved(page);
      await page.reload(); await saved(page);
      const current = preview.store.get(id).document;
      assert.equal(resumeFields(current.model).find(field => field.id === fieldId).value, 'Led 12 interviews with participants.');
      assert.deepEqual(preview.store.sourceFile(current.sourceIds[0]).bytes, Buffer.from(text));
      const exported = await exportPdf(current);
      assert.equal(exported.verification.complete, true);
      for (const phrase of ['Lead Designer', 'Earlier Studio', '2018 - 2020', '12 interviews', 'Example University']) assert.ok(exported.extractedText.replace(/\s/g, '').includes(phrase.replace(/\s/g, '')), phrase);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('PDF reader retries original files and navigates immutable multipage bytes with selectable text', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'pdf-reader';
    document.design.keepWhole = false;
    document.model.sections[0].items[0].bullets = Array.from({ length: 60 }, (_, index) => ({ id: 'reader-' + index, text: 'Contribution ' + (index + 1) + ': Authored a detailed, factual description of collaborative product design work and its documented outcome.' }));
    preview.store.create(document);
    const entry = await exportPdf(document), bytes = preview.store.exportFile(document.id, entry.id).bytes;
    assert.ok(entry.pages > 1);
    const source = preview.store.source({ name: 'Unchanged multipage.pdf', type: 'application/pdf', text: entry.extractedText }, bytes);
    const record = preview.store.get(document.id);
    preview.store.save(document.id, { ...record.document, sourceIds: [source.id] }, record.version, 'Attached original');
    const original = structuredClone(preview.store.get(document.id));
    const { page, context, errors } = await openSample(document.id);
    let attempts = 0;
    await page.route('**/__resume/sources/' + source.id, route => { attempts++; return attempts === 1 ? route.fulfill({ status: 503, body: 'Synthetic unavailable source' }) : route.continue(); });
    try {
      await page.getByRole('tab', { name: 'Original', exact: true }).click();
      const reader = page.getByRole('region', { name: 'Original source PDF', exact: true });
      await reader.getByRole('alert').waitFor();
      await reader.getByRole('button', { name: 'Retry PDF', exact: true }).click();
      await reader.locator('.textLayer').first().waitFor();
      assert.equal(await reader.getByRole('spinbutton', { name: 'PDF page', exact: true }).getAttribute('max'), String(entry.pages));
      await reader.getByRole('button', { name: 'Next PDF page', exact: true }).press('Enter');
      await reader.locator('.page[data-page-number="2"] .textLayer').waitFor();
      assert.equal(await reader.getByRole('spinbutton', { name: 'PDF page', exact: true }).inputValue(), '2');
      await reader.getByRole('spinbutton', { name: 'PDF page', exact: true }).fill(String(entry.pages));
      await reader.locator('.page[data-page-number="' + entry.pages + '"] .textLayer').waitFor();
      const lastText = await reader.locator('.page[data-page-number="' + entry.pages + '"] .textLayer').textContent();
      assert.ok(lastText.replace(/\s/g, '').includes('Contribution60:'));
      await reader.getByRole('button', { name: 'Previous PDF page', exact: true }).click();
      assert.equal(await reader.getByRole('spinbutton', { name: 'PDF page', exact: true }).inputValue(), String(entry.pages - 1));
      await reader.getByRole('spinbutton', { name: 'PDF page', exact: true }).fill('1');
      const selection = await reader.locator('.page[data-page-number="1"] .textLayer').evaluate(layer => {
        const range = document.createRange(); range.selectNodeContents(layer); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString();
      });
      assert.ok(selection.replace(/\s/g, '').includes('SyntheticDesigner'));
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-original-pdf-reader.png') });
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
      await page.evaluate(() => {
        const NativeWorker = window.Worker;
        window.__readerWorkers = 0;
        window.Worker = class extends NativeWorker {
          constructor(...args) { super(...args); window.__readerWorkers++; this.closed = false; }
          terminate() { if (!this.closed) { this.closed = true; window.__readerWorkers--; } return super.terminate(); }
        };
      });
      let release, started;
      const requested = new Promise(resolve => { started = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      await page.route('**/__resume/sources/' + source.id, async route => { started(); await held; await route.abort().catch(() => {}); });
      await page.getByRole('tab', { name: 'Original', exact: true }).click(); await requested;
      assert.equal(await page.evaluate(() => window.__readerWorkers), 0);
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
      await page.waitForFunction(() => window.__readerWorkers === 0); release();
      assert.deepEqual(preview.store.get(document.id), original); assert.deepEqual(preview.store.sourceFile(source.id).bytes, bytes);
      assert.ok(attempts >= 2); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Studio outline, inline field selection, entries, history, role proposals and original import', { timeout: 120000 }, async () => {
    const original = structuredClone(preview.store.get('avery-meridian').document); original.id = 'editing'; preview.store.create(original);
    const { page, context, errors } = await openSample(original.id);
    try {
      const canvas = page.frameLocator('iframe[title="Editable resume canvas"]');
      await canvas.locator('.pagedjs_page [data-field="name"]').click();
      await page.locator('[data-field-input="name"]:focus').waitFor();
      await page.getByLabel('Summary', { exact: true }).fill('');
      await page.getByLabel('Summary', { exact: true }).pressSequentially('Two words\nAnother line ', { delay: 20 });
      await saved(page);
      assert.equal(preview.store.get(original.id).document.model.summary, 'Two words\nAnother line ');
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
      await page.getByRole('button', { name: 'Redo', exact: true }).click(); await saved(page);
      assert.equal(preview.store.get(original.id).document.model.summary, 'Two words\nAnother line ');
      await page.getByRole('navigation', { name: 'Resume sections' }).getByRole('button', { name: 'Capabilities' }).click();
      const skills = page.locator('[data-field-input="methods.items"]');
      await skills.fill(''); await skills.pressSequentially('Research, Systems design, Figma', { delay: 20 }); await saved(page);
      assert.deepEqual(preview.store.get(original.id).document.model.sections[1].groups[0].items, ['Research', 'Systems design', 'Figma']);
      await page.getByRole('navigation', { name: 'Resume sections' }).getByRole('button', { name: 'Experience' }).click();
      await page.getByRole('button', { name: 'Move entry down', exact: true }).first().click(); await saved(page);
      assert.equal(preview.store.get(original.id).document.model.sections[0].items[0].id, 'common');
      await page.getByRole('button', { name: 'Remove entry', exact: true }).first().click(); await saved(page);
      assert.equal(preview.store.get(original.id).document.model.sections[0].items.length, 1);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
      assert.equal(preview.store.get(original.id).document.model.sections[0].items.length, 2);
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await page.getByRole('button', { name: 'Run checks', exact: true }).click();
      assert.equal(await page.locator('.rws-proposal').count(), 0);
      await page.getByRole('button', { name: 'Load sample', exact: true }).click();
      await page.locator('.rws-proposal').getByRole('button', { name: 'Apply', exact: true }).click(); await saved(page);
      assert.match(resumeFields(preview.store.get(original.id).document.model).find(field => field.id === 'onboarding').value, /^Redesigned onboarding/);
      await page.getByRole('button', { name: 'Version history', exact: true }).click();
      await page.locator('.rws-version-list button').last().click();
      await page.getByRole('button', { name: 'Restore v1', exact: true }).click(); await saved(page);
      assert.deepEqual(preview.store.get(original.id).document.model, original.model);
      await page.getByRole('button', { name: 'Duplicate for another role', exact: true }).click();
      await page.getByLabel('Resume name').fill('Another role'); await page.getByRole('button', { name: 'Create', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await saved(page);
      const duplicateId = await page.evaluate(() => localStorage.getItem('rk:resume-preview:selected'));
      assert.notEqual(duplicateId, original.id);
      await page.locator('.rws-target').click(); await page.getByLabel('Company', { exact: true }).fill('Second company');
      await page.getByLabel('Job description snapshot').fill('Research leadership and accessibility'); await page.getByRole('button', { name: 'Save target' }).click(); await saved(page);
      assert.equal(preview.store.get(original.id).document.target.company, 'Meridian');
      const bytes = Buffer.from('Original source text. Evidence retained byte-for-byte.');
      await page.locator('input[type=file]').setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: bytes });
      await page.getByRole('button', { name: 'Attach original', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await saved(page);
      const sourceId = preview.store.get(duplicateId).document.sourceIds.at(-1);
      assert.deepEqual(preview.store.sourceFile(sourceId).bytes, bytes);
      await page.reload(); await saved(page);
      assert.equal(await page.locator('.rws-document-name').innerText(), 'Another role');
      await page.getByRole('tab', { name: 'Sections', exact: true }).click();
      await page.getByRole('navigation', { name: 'Resume sections' }).getByRole('button', { name: 'Experience' }).click();
      await page.frameLocator('iframe[title="Editable resume canvas"]').locator('.pagedjs_page [data-field="name"]').waitFor();
      await page.waitForFunction(() => !document.querySelector('.rws-view-actions .lucide-loader-circle'));
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-studio-desktop.png') });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Failed saves recover after reload and conflicting tabs preserve both versions', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'recovery'; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      let offline = true;
      await page.route('**/__resume/api/resumes/recovery', route => offline && route.request().method() === 'PUT' ? route.abort() : route.continue());
      await page.getByLabel('Summary', { exact: true }).fill('Recover this local edit.'); await page.locator('.rws-status.is-error').waitFor();
      assert.equal(preview.store.get(document.id).document.model.summary, document.model.summary);
      assert.ok(await page.evaluate(() => localStorage.getItem('rk:resume-preview:pending:recovery')));
      offline = false; page.on('dialog', dialog => dialog.accept()); await page.reload(); await saved(page);
      assert.equal(preview.store.get(document.id).document.model.summary, 'Recover this local edit.');
      const remote = preview.store.get(document.id); remote.document.model.summary = 'Saved in the other tab.';
      preview.store.save(document.id, remote.document, remote.version);
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      await page.getByLabel('Summary', { exact: true }).fill('Keep my conflicting edit.'); await page.locator('.rws-status.is-conflict').waitFor();
      await page.getByRole('button', { name: 'Compare versions', exact: true }).click();
      await page.getByRole('button', { name: 'Keep mine as a copy' }).click(); await page.locator('.rws-status.is-saved').waitFor();
      const copyId = await page.evaluate(() => localStorage.getItem('rk:resume-preview:selected'));
      assert.notEqual(copyId, document.id);
      assert.equal(preview.store.get(copyId).document.model.summary, 'Keep my conflicting edit.');
      assert.equal(preview.store.get(document.id).document.model.summary, 'Saved in the other tab.');
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:resume-preview:pending:recovery')), null);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('User-authored proposals validate evidence, preview score changes and checkpoint before apply', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'proposal'; document.target.jd = 'Required accessibility and Figma.';
    const bytes = Buffer.from('Delivered accessibility audits and Figma prototypes.');
    const source = preview.store.source({ name: 'Evidence-' + 'LongSourceFilename'.repeat(5) + '.txt', type: 'text/plain', text: bytes.toString() }, bytes);
    document.sourceIds = [source.id]; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        if (width < 760 && !await page.getByRole('button', { name: 'Add revision', exact: true }).isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
        const tools = page.getByRole('group', { name: 'Suggestion actions', exact: true });
        await tools.scrollIntoViewIfNeeded();
        const layout = await page.locator('.rws-suggestions-heading').evaluate(header => {
          const heading = header.querySelector('h3').getBoundingClientRect();
          const buttons = [...header.querySelectorAll('button')].map(button => ({ box: button.getBoundingClientRect().toJSON(), fits: button.scrollWidth <= button.clientWidth, label: button.textContent.trim(), border: getComputedStyle(button).borderStyle }));
          return { heading: heading.toJSON(), buttons };
        });
        assert.deepEqual(layout.buttons.map(button => button.label), ['Add revision', 'Load sample']);
        assert.ok(layout.heading.bottom < layout.buttons[0].box.top);
        assert.equal(layout.buttons[0].box.top, layout.buttons[1].box.top);
        assert.ok(layout.buttons[0].box.right < layout.buttons[1].box.left);
        assert.ok(layout.buttons.every(button => button.fits && button.border === 'solid' && button.box.left >= 0 && button.box.right <= width));
        await page.screenshot({ path: join(tmpdir(), `rk-resume-suggestions-${width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Load sample', exact: true }).click();
      assert.equal(preview.store.get(document.id).version, 1);
      await page.getByRole('button', { name: 'Add revision', exact: true }).click();
      await page.getByLabel('Proposed wording').fill(bytes.toString());
      await page.getByLabel('Exact supporting excerpt').fill('This is not in the source.');
      await page.getByRole('button', { name: 'Review impact' }).click();
      await page.getByRole('dialog').getByRole('alert').waitFor();
      assert.equal(preview.store.get(document.id).version, 1);
      await page.getByLabel('Exact supporting excerpt').fill(bytes.toString());
      await page.getByRole('button', { name: 'Review impact' }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Add revision');
      assert.match(await page.locator('.rws-projection').innerText(), /Measured projection/);
      await saved(page);
      assert.equal(preview.store.get(document.id).version, 2);
      assert.deepEqual(preview.store.get(document.id).document.model, document.model);
      const beforeNavigation = preview.store.get(document.id);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const reducedMotion of ['no-preference', 'reduce']) {
          await page.emulateMedia({ reducedMotion });
          const proposal = page.locator('.rws-proposal');
          await proposal.locator('details').evaluate(element => { element.open = true; });
          const sourceLink = proposal.getByRole('button', { name: 'Open source: ' + source.name, exact: true });
          await sourceLink.focus();
          await page.waitForFunction(() => document.querySelector('iframe.rws-paper')?.contentWindow?.resumeReady);
          await page.waitForFunction(() => { const paper = document.querySelector('.rws-paper-footprint'); return Math.abs(paper.getBoundingClientRect().width - parseFloat(paper.style.width)) < 1; });
          const canvasTop = await page.locator('.rws-canvas').evaluate(element => { element.scrollTop = 100; return element.scrollTop; });
          const canvasDocument = await page.locator('iframe.rws-paper').evaluateHandle(element => element.contentDocument);
          const reviewTop = await page.locator('.rws-inspector-content').evaluate(element => element.scrollTop);
          const proposalText = await proposal.innerText();
          await page.keyboard.press('Enter');
          await page.getByLabel('Original source', { exact: true }).waitFor().catch(failure => { throw new Error(failure.message + '\nBrowser errors: ' + JSON.stringify(errors)); });
          assert.equal(await page.getByLabel('Original source', { exact: true }).inputValue(), source.id);
          assert.equal(await page.locator('.rws-original-view pre').innerText(), bytes.toString());
          assert.equal(await page.getByRole('button', { name: 'Back to suggestion', exact: true }).evaluate(element => element === document.activeElement), true);
          await page.getByRole('button', { name: 'Back to suggestion', exact: true }).press('Enter');
          await sourceLink.waitFor({ state: 'visible' });
          assert.equal(await sourceLink.evaluate(element => element === document.activeElement), true);
          assert.ok(Math.abs(await page.locator('.rws-inspector-content').evaluate(element => element.scrollTop) - reviewTop) < 2);
          assert.equal(await proposal.locator('details').getAttribute('open'), '');
          assert.equal(await proposal.innerText(), proposalText);
          assert.equal(await page.locator('iframe.rws-paper').evaluate((element, original) => element.contentDocument === original, canvasDocument), true);
          const returnedCanvasTop = await page.locator('.rws-canvas').evaluate(element => element.scrollTop);
          assert.ok(Math.abs(returnedCanvasTop - canvasTop) < 2, `${width}/${reducedMotion}: canvas scroll ${canvasTop} -> ${returnedCanvasTop}`);
          await canvasDocument.dispose();
          const editField = proposal.getByRole('button', { name: 'Edit suggested field', exact: true });
          await editField.focus();
          const fieldReviewTop = await page.locator('.rws-inspector-content').evaluate(element => element.scrollTop);
          await page.keyboard.press('Enter');
          const selected = page.locator('.rws-field.is-selected textarea');
          await selected.waitFor();
          assert.equal(await selected.inputValue(), 'Authored achievement 1');
          assert.equal(await selected.evaluate(element => element === document.activeElement), true);
          await page.getByRole('button', { name: 'Back to suggestion', exact: true }).press('Enter');
          assert.equal(await editField.evaluate(element => element === document.activeElement), true);
          assert.ok(Math.abs(await page.locator('.rws-inspector-content').evaluate(element => element.scrollTop) - fieldReviewTop) < 2);
          assert.equal(await proposal.innerText(), proposalText);
          assert.equal(await proposal.getByRole('button', { name: 'Apply', exact: true }).isEnabled(), true);
          assert.deepEqual(preview.store.get(document.id), beforeNavigation);
          const fit = await sourceLink.evaluate(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth; });
          assert.equal(fit, true);
        }
        await page.screenshot({ path: join(tmpdir(), `rk-resume-proposal-navigation-${width}.png`) });
      }
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator('.rws-proposal-actions').scrollIntoViewIfNeeded();
        const actions = await page.locator('.rws-proposal-actions').evaluate(footer => {
          const reference = document.createElement('div'); reference.className = 'adm'; reference.style.cssText = 'display:block;position:fixed;left:-10000px';
          document.body.append(reference);
          const properties = ['fontFamily', 'fontSize', 'fontWeight', 'textTransform', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundImage', 'backgroundColor', 'color', 'boxShadow'];
          const styleOf = element => Object.fromEntries(properties.map(property => [property, getComputedStyle(element)[property]]));
          const results = [...footer.querySelectorAll('button')].map(button => {
            const example = document.createElement('button'); example.className = button.className; example.textContent = button.textContent; reference.append(example);
            return { actual: styleOf(button), expected: styleOf(example), bounds: button.getBoundingClientRect().toJSON(), fits: button.scrollWidth <= button.clientWidth };
          });
          reference.remove(); return results;
        });
        for (const action of actions) { assert.deepEqual(action.actual, action.expected); assert.ok(action.fits && action.bounds.left >= 0 && action.bounds.right <= width); }
        assert.ok(Math.abs(actions[0].bounds.height - actions[1].bounds.height) < 1);
        assert.ok(actions[0].bounds.right < actions[1].bounds.left);
        await page.screenshot({ path: join(tmpdir(), `rk-resume-proposal-actions-${width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('.rws-proposal').getByRole('button', { name: 'Apply', exact: true }).focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('.rws-proposal').getByRole('button', { name: 'Dismiss', exact: true }).evaluate(button => button.matches(':focus-visible') && parseFloat(getComputedStyle(button).outlineWidth) > 0), true);
      await page.locator('.rws-proposal').getByRole('button', { name: 'Apply', exact: true }).click();
      await page.locator('.rws-proposal').waitFor({ state: 'hidden' }); await saved(page);
      const record = preview.store.get(document.id);
      assert.equal(record.document.model.sections[0].items[0].bullets[0].text, bytes.toString());
      assert.ok(record.versions.some(version => version.label.startsWith('Before suggestion:') && version.document.model.sections[0].items[0].bullets[0].text === 'Authored achievement 1'));
      await page.getByRole('button', { name: 'Version history' }).click();
      await page.getByLabel('Restore point name').fill('Before application'); await page.getByRole('button', { name: 'Save restore point' }).click();
      await page.getByRole('button', { name: /Before application/ }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('tab', { name: 'Sources', exact: true }).click();
      await page.getByRole('button', { name: 'Capture original source check' }).click(); await saved(page);
      const captured = preview.store.get(document.id).document.sourceAssessment;
      assert.equal(captured.characters, bytes.length);
      await page.getByRole('tab', { name: 'Content', exact: true }).click(); await page.getByLabel('Summary', { exact: true }).fill('Changed current document.'); await saved(page);
      assert.deepEqual(preview.store.get(document.id).document.sourceAssessment, captured);
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await page.getByRole('button', { name: 'Add revision', exact: true }).click();
      await page.getByLabel('Proposed wording').fill('Delivered accessibility audits.');
      await page.getByLabel('Exact supporting excerpt').fill(bytes.toString());
      await page.getByRole('button', { name: 'Review impact' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await saved(page);
      assert.ok(preview.store.get(document.id).document.proposals.some(proposal => proposal.after === 'Delivered accessibility audits.'));
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Add revision');
      await page.getByRole('button', { name: 'Edit suggested field', exact: true }).click();
      await page.locator('.rws-field.is-selected textarea').fill('Manually edited the achievement.');
      await saved(page);
      await page.getByRole('button', { name: 'Back to suggestion', exact: true }).click();
      assert.equal(await page.locator('.rws-proposal').getByRole('button', { name: 'Apply', exact: true }).isEnabled(), false);
      assert.equal(await page.getByRole('button', { name: 'Edit suggested field', exact: true }).isEnabled(), false);
      assert.match(await page.locator('.rws-proposal [role="status"]').innerText(), /Document changed/);
      assert.equal(await page.locator('.rws-proposal h4').evaluate(element => element === document.activeElement), true);
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, 'Manually edited the achievement.');
      assert.deepEqual(preview.store.sourceFile(source.id).bytes, bytes);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Author decisions prioritize findings, retain evidence and return to the correct proposal across phone layouts', { timeout: 90000 }, async () => {
    const { document, packet, manifest, response } = reviewFixture(); document.id = 'finding-decisions';
    response.findings = [{ criterionId: 'req-0', priority: 'low', action: 'Clarify existing experience.' }, { criterionId: 'req-1', priority: 'high', action: 'Check whether supporting evidence exists.' }];
    document.aiReview = { ...validateReview(response, packet, manifest), documentId: document.id, signature: resumeSignature(document), at: 123, provider: 'fixture', model: 'recorded-no-calls' };
    const proposal = { id: 'linked-proposal', fieldId: 'bullet-0', findingIndex: 0, origin: 'ai', title: 'Clarify the contribution', reason: 'Synthetic proposal for navigation only.', before: 'Authored achievement 1', after: 'Authored achievement 1.', signature: resumeSignature(document), evidence: [{ fieldId: 'bullet-0', quote: 'Authored achievement 1' }] };
    document.proposals = [{ ...proposal, impact: projectResumeProposal(document, proposal, []) }];
    preview.store.create(document);
    const { page, context, errors } = await openSample(document.id); let aiCalls = 0;
    await page.route('**/__resume/api/ai/complete', route => { aiCalls++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"No AI calls allowed in this test"}' }); });
    try {
      assert.deepEqual(await page.locator('[data-review-finding]').evaluateAll(rows => rows.map(row => Number(row.dataset.reviewFinding))), [1, 0]);
      await page.locator('[data-review-finding="0"] .rws-finding-context > summary').click();
      assert.equal(await page.locator('[data-review-finding="0"] .rws-review-passage blockquote').first().innerText(), manifest.requirements[0].quote);
      const original = preview.store.get(document.id).document;
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width < 760 && !await page.locator('[data-review-finding="0"]').isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
        await page.locator('[data-review-finding="0"]').getByRole('button', { name: 'Set aside', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Set aside finding', exact: true });
        assert.equal(await dialog.getByRole('button', { name: 'Set aside', exact: true }).isDisabled(), true);
        await dialog.getByLabel('Existing evidence', { exact: true }).selectOption('bullet-0');
        await dialog.getByLabel('Decision note', { exact: true }).fill('The cited passage already supplies this evidence.');
        for (const label of ['Reason', 'Existing evidence', 'Decision note']) {
          const control = dialog.getByLabel(label, { exact: true }); await control.scrollIntoViewIfNeeded();
          const bounds = await control.boundingBox(); assert.ok(bounds.width > 50 && bounds.x >= 0 && bounds.x + bounds.width <= width);
        }
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-finding-decision-' + width + '.png') });
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.deepEqual(preview.store.get(document.id).document, original);
      }
      await page.locator('[data-review-finding="0"]').getByRole('button', { name: 'Set aside', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Set aside finding', exact: true });
      await dialog.getByLabel('Existing evidence', { exact: true }).selectOption('bullet-0');
      await dialog.getByRole('button', { name: 'Set aside', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await saved(page);
      assert.equal(await page.locator('.rws-set-aside [data-review-finding="0"]').count(), 1);
      const decided = preview.store.get(document.id).document;
      assert.deepEqual(decided.model, original.model); assert.deepEqual(decided.aiReview, original.aiReview);
      assert.equal(decided.reviewDecisions[0].evidence.text, 'Authored achievement 1');
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
      assert.equal(preview.store.get(document.id).document.reviewDecisions, undefined);
      await page.getByRole('button', { name: 'Redo', exact: true }).click(); await saved(page);
      await page.reload(); await saved(page);
      if (!await page.locator('.rws-set-aside').isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
      await page.locator('.rws-set-aside > summary').click();
      await page.locator('.rws-set-aside').getByRole('button', { name: 'Reopen finding', exact: true }).click(); await saved(page);
      assert.equal(preview.store.get(document.id).document.reviewDecisions.length, 0);
      const proposalRow = page.locator('[data-proposal-id="linked-proposal"]');
      await proposalRow.getByRole('button', { name: 'Edit suggested field', exact: true }).click();
      await page.getByRole('button', { name: 'Back to suggestion', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.closest('[data-proposal-id]')?.dataset.proposalId === 'linked-proposal');
      await page.route('**/__resume/api/resumes/finding-decisions', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'Simulated decision save unavailable' } }) : route.continue());
      await page.locator('[data-review-finding="0"]').getByRole('button', { name: 'Set aside', exact: true }).click();
      await dialog.getByLabel('Reason', { exact: true }).selectOption('interpretation');
      await dialog.getByRole('button', { name: 'Set aside', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Simulated decision save unavailable' }).waitFor();
      assert.equal(preview.store.get(document.id).document.reviewDecisions.length, 0);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:resume-preview:pending:finding-decisions')).document.reviewDecisions[0].reason), 'interpretation');
      await page.unroute('**/__resume/api/resumes/finding-decisions');
      await dialog.getByRole('button', { name: 'Set aside', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await saved(page);
      assert.equal(preview.store.get(document.id).document.reviewDecisions.length, 1);
      assert.deepEqual(preview.store.get(document.id).document.model, original.model);
      assert.equal(aiCalls, 0); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Pending revisions survive additional proposals, reload, dismissal and selective Apply undo', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'proposal-retention';
    const bytes = Buffer.from('Delivered accessible prototypes.\nTested workflows with research partners.');
    const source = preview.store.source({ name: 'Retention evidence.txt', type: 'text/plain', text: bytes.toString() }, bytes);
    document.sourceIds = [source.id]; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      for (const wording of ['Delivered accessible prototypes.', 'Tested workflows with research partners.']) {
        await page.getByRole('button', { name: 'Add revision', exact: true }).click();
        await page.getByLabel('Proposed wording').fill(wording);
        await page.getByLabel('Exact supporting excerpt').fill(wording);
        await page.getByRole('button', { name: 'Review impact' }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' }); await saved(page);
        await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Add revision');
      }
      const pending = preview.store.get(document.id).document.proposals;
      assert.equal(pending.length, 2);
      assert.equal(await page.locator('.rws-proposal').count(), 2);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
      assert.equal(await page.locator('.rws-proposal').count(), 1);
      await page.getByRole('button', { name: 'Redo', exact: true }).click(); await saved(page);
      assert.deepEqual(preview.store.get(document.id).document.proposals, pending);
      await page.reload(); await saved(page);
      assert.equal(await page.locator('.rws-proposal').count(), 2);
      await page.locator('.rws-proposal').first().getByRole('button', { name: 'Dismiss', exact: true }).click(); await saved(page);
      assert.equal(await page.locator('.rws-proposal').count(), 1);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
      assert.equal(await page.locator('.rws-proposal').count(), 2);
      await page.locator('.rws-proposal').first().getByRole('button', { name: 'Apply', exact: true }).click(); await saved(page);
      await page.waitForFunction(() => document.querySelectorAll('.rws-proposal').length === 1);
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, pending[0].after);
      assert.equal(await page.locator('.rws-proposal').getByRole('button', { name: 'Apply', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
      assert.equal(await page.locator('.rws-proposal').count(), 2);
      assert.deepEqual(preview.store.get(document.id).document.model, document.model);
      assert.deepEqual(preview.store.get(document.id).document.proposals, pending);
      assert.deepEqual(preview.store.sourceFile(source.id).bytes, bytes);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Connected AI review approves inventory, retains revisions and saves missing-fact evidence', { timeout: 90000 }, async () => {
    const { document, inventory, response } = reviewFixture(); document.id = 'connected-ai'; document.name = 'Connected AI fixture';
    const bytes = Buffer.from('Delivered accessible interaction design across two teams.');
    const source = preview.store.source({ name: 'AI evidence.txt', type: 'text/plain', text: bytes.toString() }, bytes);
    document.sourceIds = [source.id]; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id), calls = [];
    let revisionCount = 0;
    await page.route('**/__resume/api/ai/config', route => route.fulfill({ json: { available: true, provider: 'mock-only', model: 'fixture', remaining: 1 } }));
    await page.route('**/__resume/api/ai/complete', async route => {
      const input = route.request().postDataJSON(); calls.push(input);
      let result;
      if (input.stage === 'requirements') result = inventory;
      if (input.stage === 'assessment') result = { ...response, findings: [{ criterionId: 'req-0', priority: 'high', action: 'Make the relevant work explicit.' }] };
      if (input.stage === 'revision') {
        revisionCount++;
        result = revisionCount === 1 ? { kind: 'revision', fieldId: 'bullet-0', after: bytes.toString(), reason: 'Clarify relevant design experience.', evidence: ['source-0'] } : revisionCount === 2 ? { kind: 'question', question: 'What part of the accessibility work did you personally own?', reason: 'Ownership is not yet clear.' } : { kind: 'supported', reason: 'The cited current passage is sufficient in this synthetic fixture.', evidence: [JSON.parse(input.user).fields.find(field => field.fieldId === 'bullet-0').id] };
      }
      await route.fulfill({ json: { text: JSON.stringify(result) } });
    });
    try {
      await page.getByRole('button', { name: 'Review with AI', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Review target requirements' });
      assert.equal(await dialog.getByRole('button', { name: 'Build requirements' }).isEnabled(), false);
      assert.equal(calls.length, 0);
      await dialog.getByRole('checkbox', { name: /Allow these job/ }).check();
      await dialog.getByRole('button', { name: 'Build requirements' }).click();
      await dialog.getByRole('checkbox', { name: /I reviewed/ }).waitFor();
      assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0].user).excerpts, undefined);
      assert.equal(await dialog.getByRole('button', { name: 'Approve and review' }).isEnabled(), false);
      const priority = dialog.locator('select').first();
      await priority.selectOption('responsibility');
      await dialog.getByRole('checkbox', { name: /I reviewed/ }).check();
      await dialog.getByRole('button', { name: 'Approve and review' }).click();
      await dialog.waitFor({ state: 'hidden' }); await saved(page);
      assert.deepEqual(calls.map(call => call.stage), ['requirements', 'assessment']);
      assert.equal(JSON.parse(calls[1].user).manifest.requirements[0].importance, 'responsibility');
      assert.equal(preview.store.get(document.id).document.reviewManifestOriginal.requirements[0].importance, inventory.requirements[0].importance);
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, 'Authored achievement 1');
      const reviewed = preview.store.get(document.id).document;
      const citation = reviewed.aiReview.breakdown[0].evidence[0];
      await page.locator('.rws-finding-context summary').first().click();
      await page.getByRole('button', { name: 'Open cited field', exact: true }).first().click();
      await page.locator('[data-field-input=' + JSON.stringify(citation.fieldId) + ']:focus').waitFor();
      assert.deepEqual(preview.store.get(document.id).document.model, reviewed.model);
      assert.equal(calls.length, 2);
      await page.getByRole('button', { name: 'Back to review', exact: true }).press('Enter');
      assert.equal(await page.locator('.rws-finding-context').first().evaluate(element => element.open), true);
      assert.equal(await page.getByRole('button', { name: 'Open cited field', exact: true }).first().evaluate(element => document.activeElement === element), true);
      await page.locator('.rws-finding-context summary').first().click();
      await page.getByRole('button', { name: 'Prepare revision', exact: true }).click();
      const revisionDialog = page.getByRole('dialog', { name: 'Prepare evidence-backed revision' });
      assert.equal(await revisionDialog.getByRole('button', { name: 'Approve revision request' }).isEnabled(), false);
      assert.equal(calls.length, 2);
      await revisionDialog.getByRole('checkbox', { name: /Allow these job/ }).check();
      await revisionDialog.getByRole('button', { name: 'Approve revision request' }).click();
      await page.locator('.rws-proposal').waitFor(); await saved(page);
      assert.match(await page.locator('.rws-proposal .rws-method-tag').innerText(), /AI PROPOSAL/);
      await page.reload(); await saved(page);
      assert.equal(await page.locator('.rws-proposal').count(), 1);
      assert.equal(calls.length, 3);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        if (!await page.getByRole('button', { name: 'Review again', exact: true }).isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
        await page.locator('.rws-ai-review').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.rws-ai-review').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        const finding = page.locator('.rws-ai-review .rws-review-finding').first();
        const ramp = await finding.evaluate(element => {
          const style = selector => { const target = element.querySelector(selector), computed = getComputedStyle(target); return { size: computed.fontSize, family: computed.fontFamily, height: target.getBoundingClientRect().height, letterSpacing: computed.letterSpacing }; };
          return { heading: style('h4'), body: style('.rws-finding-action'), action: style('.rws-secondary') };
        });
        assert.equal(ramp.heading.size, '12px'); assert.equal(ramp.body.size, '12px'); assert.equal(ramp.action.size, '11px');
        assert.match(ramp.body.family, /Hanken Grotesk/); assert.ok(['0px', 'normal'].includes(ramp.body.letterSpacing)); assert.ok(ramp.action.height >= 32 && ramp.action.height <= 34);
        const details = finding.locator('.rws-finding-context');
        assert.equal(await details.evaluate(element => element.open), false);
        await details.locator('summary').focus(); await details.locator('summary').press('Enter');
        assert.equal(await details.evaluate(element => element.open), true);
        assert.equal(await details.locator('p').first().evaluate(element => getComputedStyle(element).fontSize), '11px');
        assert.equal(await details.evaluate(element => element.scrollWidth <= element.clientWidth), true);
        await details.locator('summary').press('Enter');
        await page.frameLocator('iframe[title="Editable resume canvas"]').locator('.pagedjs_page').first().waitFor();
        await page.screenshot({ path: join(tmpdir(), `rk-resume-connected-review-${width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Review again', exact: true }).click();
      await dialog.getByRole('checkbox', { name: /Allow these job/ }).waitFor();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Prepare revision', exact: true }).click();
      await revisionDialog.getByRole('checkbox', { name: /Allow these job/ }).check();
      await revisionDialog.getByRole('button', { name: 'Approve revision request' }).click();
      await page.getByLabel('Your supporting evidence', { exact: true }).waitFor();
      await page.getByLabel('Your supporting evidence', { exact: true }).fill('I owned the screen reader interaction specification and tested it with the team.');
      await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
      await page.getByLabel('Your supporting evidence', { exact: true }).waitFor({ state: 'hidden' }); await saved(page);
      assert.equal(preview.store.get(document.id).document.sourceIds.length, 2);
      assert.equal(preview.store.get(document.id).document.evidenceAnswers[0].question.question, 'What part of the accessibility work did you personally own?');
      assert.equal(await page.getByRole('button', { name: 'Prepare revision', exact: true }).isEnabled(), true);
      assert.equal(await page.locator('.rws-proposal').getByRole('button', { name: 'Apply', exact: true }).isEnabled(), false);
      const beforeSupported = structuredClone(preview.store.get(document.id).document);
      await page.getByRole('button', { name: 'Prepare revision', exact: true }).click();
      await revisionDialog.getByRole('checkbox', { name: /Allow these job/ }).check();
      await revisionDialog.getByRole('button', { name: 'Approve revision request' }).click();
      await page.getByRole('heading', { name: 'No revision recommended', exact: true }).waitFor(); await saved(page);
      const supported = preview.store.get(document.id).document;
      assert.deepEqual(supported.model, beforeSupported.model); assert.deepEqual(supported.aiReview, beforeSupported.aiReview); assert.deepEqual(supported.proposals, beforeSupported.proposals);
      assert.equal(supported.aiResolution.evidence[0].quote, 'Authored achievement 1'); assert.equal(supported.reviewDecisions, undefined);
      await page.reload(); await saved(page);
      assert.equal(await page.locator('[data-revision-resolution="0"] blockquote').innerText(), 'Authored achievement 1');
      assert.equal(calls.length, 5);
      await page.getByRole('tab', { name: 'Sources', exact: true }).click();
      const originals = page.getByRole('region', { name: 'Original files', exact: true });
      const answers = page.getByRole('region', { name: 'Revision evidence', exact: true });
      assert.equal(await originals.locator('.rws-source').count(), 1); assert.equal(await answers.locator('.rws-source').count(), 1);
      assert.equal(await page.locator('.rws-available-sources').evaluate(element => element.open), false);
      assert.equal(await originals.locator('.rws-source-provenance').evaluate(element => element.open), false);
      await originals.locator('.rws-source-provenance summary').click();
      assert.match(await originals.locator('.rws-hash').innerText(), new RegExp(source.sha256));
      await answers.locator('.rws-source-provenance summary').click();
      assert.match(await answers.innerText(), /What part of the accessibility work did you personally own/);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        if (!await originals.isVisible()) await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Sources', exact: true }).click();
        assert.equal(await originals.evaluate(element => element.scrollWidth <= element.clientWidth), true);
        assert.equal(await answers.evaluate(element => element.scrollWidth <= element.clientWidth), true);
        await page.screenshot({ path: join(tmpdir(), 'rk-resume-grouped-sources-' + width + '.png') });
      }
      await originals.getByRole('checkbox').click(); await saved(page);
      assert.equal(await page.getByRole('button', { name: 'Capture original source check', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.rws-available-sources').evaluate(element => element.open), true);
      assert.equal(await page.locator('.rws-available-sources').getByRole('checkbox', { name: 'Use evidence from AI evidence.txt', exact: true }).evaluate(element => element === document.activeElement), true);
      await page.locator('.rws-available-sources').getByRole('checkbox', { name: 'Use evidence from AI evidence.txt', exact: true }).press('Space'); await saved(page);
      assert.equal(await originals.getByRole('checkbox').evaluate(element => element === document.activeElement && element.checked), true);
      await page.getByRole('button', { name: 'Capture original source check', exact: true }).click(); await saved(page);
      const sourceCheck = preview.store.get(document.id).document.sourceAssessment;
      assert.equal(sourceCheck.characters, bytes.length); assert.deepEqual(sourceCheck.sourceIds, [source.id]);
      assert.deepEqual(preview.store.get(document.id).document.model, beforeSupported.model);
      assert.deepEqual(preview.store.sourceFile(source.id).bytes, bytes);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Late author evidence never attaches after switching away and back to the same resume', { timeout: 90000 }, async () => {
    const { document, packet, manifest, response } = reviewFixture(); document.id = 'late-evidence'; document.name = 'Late evidence fixture';
    document.aiReview = { ...validateReview(response, packet, manifest), documentId: document.id, signature: resumeSignature(document), at: 123, provider: 'fixture', model: 'no-calls' };
    document.aiQuestion = { kind: 'question', question: 'Which contribution did you own?', reason: 'Ownership is unknown.', signature: resumeSignature(document) };
    preview.store.create(document);
    const before = structuredClone(preview.store.get(document.id)), other = structuredClone(preview.store.get('avery-master'));
    const { page, context, errors } = await openSample(document.id);
    let release, arrived;
    const held = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { arrived = resolve; });
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (String(url).endsWith('/sources') && options?.method === 'POST') return originalFetch(url, { ...options, signal: undefined }).then(response => { window.__lateEvidenceSettled = true; return response; });
        return originalFetch(url, options);
      };
    });
    await page.route('**/__resume/api/sources', async route => { arrived(); await held; await route.fulfill({ json: { id: 'late-source' } }); });
    try {
      await page.getByLabel('Your supporting evidence', { exact: true }).fill('A delayed author statement.');
      await page.getByRole('button', { name: 'Save evidence', exact: true }).click(); await requested;
      await page.getByRole('tab', { name: 'Resumes', exact: true }).click();
      await page.locator('.rws-library-row').filter({ hasText: 'Master resume' }).click();
      await page.waitForFunction(() => document.querySelector('.rws-document-name').textContent === 'Master resume');
      await page.getByRole('tab', { name: 'Resumes', exact: true }).click();
      await page.locator('.rws-library-row').filter({ hasText: 'Late evidence fixture' }).click();
      await page.getByLabel('Your supporting evidence', { exact: true }).waitFor();
      release(); await page.waitForFunction(() => window.__lateEvidenceSettled);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(preview.store.get(document.id), before); assert.deepEqual(preview.store.get('avery-master'), other);
      assert.equal(await page.getByLabel('Your supporting evidence', { exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Review again', exact: true }).isEnabled(), true);
      assert.equal(await page.evaluate(() => localStorage.getItem('rk:resume-preview:pending:late-evidence')), null);
      assert.deepEqual(errors, []);
    } finally { release(); await context.close(); }
  });
  test('Cancelled original imports cannot reopen or attach after document navigation', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'late-import'; document.name = 'Late import fixture'; preview.store.create(document);
    const before = structuredClone(preview.store.get(document.id)), other = structuredClone(preview.store.get('avery-master'));
    const { page, context, errors } = await openSample(document.id);
    try {
      await page.evaluate(() => {
        const arrayBuffer = File.prototype.arrayBuffer;
        window.__restoreImportRead = () => { File.prototype.arrayBuffer = arrayBuffer; };
        File.prototype.arrayBuffer = async function () {
          const bytes = await arrayBuffer.call(this);
          await new Promise(resolve => { window.__releaseImportRead = resolve; });
          return bytes;
        };
      });
      await page.locator('input[type=file]').setInputFiles({ name: 'delayed.txt', mimeType: 'text/plain', buffer: Buffer.from('Immutable original evidence.') });
      await page.waitForFunction(() => !!window.__releaseImportRead);
      await page.getByRole('tab', { name: 'Resumes', exact: true }).click();
      await page.locator('.rws-library-row').filter({ hasText: 'Master resume' }).click();
      await page.waitForFunction(() => document.querySelector('.rws-document-name').textContent === 'Master resume');
      await page.evaluate(() => window.__releaseImportRead());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.evaluate(() => {
        window.__restoreImportRead();
        const originalFetch = window.fetch;
        window.fetch = (url, options) => {
          if (options?.method === 'POST') return originalFetch(url, { ...options, signal: undefined }).then(response => { window.__importResponseSettled = true; return response; });
          return originalFetch(url, options);
        };
      });
      for (const createNew of [false, true]) {
        let release, arrived;
        const held = new Promise(resolve => { release = resolve; }), requested = new Promise(resolve => { arrived = resolve; });
        const endpoint = createNew ? '**/__resume/api/resumes' : '**/__resume/api/sources';
        const handler = async route => {
          arrived(); await held;
          await route.fulfill({ json: createNew ? { document: { ...fixture(), id: 'cancelled-created-resume' }, version: 1 } : { id: 'cancelled-original-source' } });
        };
        await page.route(endpoint, handler);
        try {
          await page.locator('input[type=file]').setInputFiles({ name: 'cancel-save.txt', mimeType: 'text/plain', buffer: Buffer.from('Immutable original evidence.') });
          await page.getByRole('button', { name: createNew ? 'Create resume from text' : 'Attach original', exact: true }).click(); await requested;
          assert.equal(await page.getByRole('button', { name: 'Attach original', exact: true }).isDisabled(), true);
          assert.equal(await page.getByRole('button', { name: 'Create resume from text', exact: true }).isDisabled(), true);
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          await page.getByRole('tab', { name: 'Resumes', exact: true }).click();
          await page.locator('.rws-library-row').filter({ hasText: 'Late import fixture' }).click();
          await page.waitForFunction(() => document.querySelector('.rws-document-name').textContent === 'Late import fixture');
          await page.getByRole('tab', { name: 'Resumes', exact: true }).click();
          await page.locator('.rws-library-row').filter({ hasText: 'Master resume' }).click();
          await page.waitForFunction(() => document.querySelector('.rws-document-name').textContent === 'Master resume');
          await page.evaluate(() => { window.__importResponseSettled = false; });
          release(); await page.waitForFunction(() => window.__importResponseSettled);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(await page.getByRole('dialog').count(), 0);
          assert.equal(await page.locator('.rws-document-name').textContent(), 'Master resume');
          assert.deepEqual(preview.store.get(document.id), before); assert.deepEqual(preview.store.get('avery-master'), other);
        } finally { release(); await page.unroute(endpoint, handler); }
      }
      assert.deepEqual(preview.store.get(document.id), before); assert.deepEqual(preview.store.get('avery-master'), other);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  test('Phone editor panels and dialogs fit without overlapping controls', { timeout: 90000 }, async () => {
    const { page, context, errors } = await openSample('avery-master', 390);
    try {
      await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Content', exact: true }).click();
      await page.getByLabel('Summary', { exact: true }).fill('A complete mobile edit.'); await saved(page);
      await page.getByRole('button', { name: 'Close properties' }).click();
      await page.getByRole('button', { name: 'Resume library', exact: true }).click();
      await page.getByRole('tab', { name: 'Sections', exact: true }).click();
      await page.getByRole('navigation', { name: 'Resume sections' }).getByRole('button', { name: 'Experience' }).click();
      assert.equal(await page.getByLabel('Resume section', { exact: true }).inputValue(), 'experience');
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-studio-mobile.png') });
      await page.getByRole('button', { name: 'Close properties' }).click();
      await page.getByRole('button', { name: 'Duplicate for another role' }).click();
      const bounds = await page.locator('dialog .pass__box').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await page.getByLabel('Resume name').fill('Mobile role');
      await page.screenshot({ path: join(tmpdir(), 'rk-resume-studio-mobile-dialog.png') });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      const fit = await page.evaluate(() => {
        const toolbar = [...document.querySelectorAll('.rws-workbar button')].map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
        return { overflow: document.documentElement.scrollWidth > innerWidth, outside: toolbar.some(rect => rect.left < 0 || rect.right > innerWidth), overlap: toolbar.some((rect, index) => toolbar.slice(index + 1).some(other => Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1 && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1)) };
      });
      assert.deepEqual(fit, { overflow: false, outside: false, overlap: false }); assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 320, height: 760 });
      const narrowFit = await page.evaluate(() => [...document.querySelectorAll('.rws-workbar button')].filter(element => element.getBoundingClientRect().width).every(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
      assert.equal(narrowFit, true);
      await page.getByRole('navigation', { name: 'Mobile workspace panels' }).getByRole('button', { name: 'Review', exact: true }).click();
      await page.getByRole('button', { name: 'Run checks', exact: true }).click();
      await page.getByText('Local diagnostic breakdown', { exact: true }).click();
      await page.locator('.rws-score').waitFor(); await page.screenshot({ path: join(tmpdir(), 'rk-resume-studio-review-320.png') });
    } finally { await context.close(); }
  });
  test('Export returns the matching document, marks stale artifacts and ignores a late result after navigation', { timeout: 90000 }, async () => {
    const document = fixture(); document.id = 'export-flow'; document.name = 'PDF navigation sample'; preview.store.create(document);
    const { page, context, errors } = await openSample(document.id);
    try {
      assert.equal(await page.getByRole('button', { name: 'Back to resumes', exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Toggle resume library', exact: true }).count(), 0);
      const exportStyle = await page.getByRole('button', { name: 'Export PDF', exact: true }).evaluate(button => {
        const swatch = document.createElement('span'); swatch.style.color = 'var(--accent)'; button.append(swatch);
        const result = { radius: getComputedStyle(button).borderRadius, color: getComputedStyle(button).color, accent: getComputedStyle(swatch).color, text: button.textContent, width: button.offsetWidth, height: button.offsetHeight };
        swatch.remove(); return result;
      });
      assert.equal(exportStyle.radius, '50%'); assert.equal(exportStyle.text, ''); assert.equal(exportStyle.width, exportStyle.height);
      assert.equal(exportStyle.color, exportStyle.accent);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const comparison = await page.getByRole('button', { name: 'Preview PDF', exact: true }).evaluate(button => {
          const reference = document.createElement('div'); reference.className = 'adm'; reference.style.cssText = 'display:block;position:fixed;left:-10000px';
          const bar = document.createElement('div'); bar.className = 'adm__workbar';
          const example = button.cloneNode(true); example.className = 'adm__bar-prev'; bar.append(example); reference.append(bar); document.body.append(reference);
          const properties = ['fontFamily', 'fontSize', 'fontWeight', 'textTransform', 'color', 'backgroundColor', 'borderRadius', 'borderColor', 'paddingTop', 'paddingRight', 'gap', 'height'];
          const styles = element => Object.fromEntries(properties.map(property => [property, getComputedStyle(element)[property]]));
          const result = { actual: styles(button), expected: styles(example), iconColor: getComputedStyle(button.querySelector('svg')).color, iconWidth: button.querySelector('svg').getBoundingClientRect().width, stroke: button.querySelector('svg').getAttribute('stroke-width') };
          reference.remove(); return result;
        });
        assert.deepEqual(comparison.actual, comparison.expected);
        assert.equal(comparison.iconColor, comparison.actual.color); assert.equal(comparison.iconWidth, 15); assert.equal(comparison.stroke, '1.8');
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: 'Preview PDF', exact: true }).click();
      await page.getByRole('region', { name: 'Verified exported PDF', exact: true }).locator('canvas').waitFor(); await saved(page);
      const reader = page.getByRole('region', { name: 'Verified exported PDF', exact: true });
      await reader.locator('.textLayer').first().waitFor();
      assert.ok((await reader.locator('.textLayer').first().textContent()).replace(/\s/g, '').includes('SyntheticDesigner'));
      assert.equal(await reader.locator('.annotationLayer a[href="https://example.test/work"]').getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await page.getByRole('complementary', { name: 'Resume library', exact: true }).isVisible(), false);
      assert.equal(await page.getByRole('complementary', { name: 'Resume properties', exact: true }).isVisible(), false);
      assert.match(await page.locator('.rws-canvas-tools').innerText(), /Current PDF/);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.getByRole('complementary', { name: 'Resume library', exact: true }).isVisible(), false);
        assert.equal(await page.getByRole('complementary', { name: 'Resume properties', exact: true }).isVisible(), false);
        assert.equal(await page.getByRole('navigation', { name: 'Mobile workspace panels' }).isVisible(), false);
        const workspace = await page.locator('.rws-workspace').boundingBox();
        assert.ok(workspace.x < 1 && workspace.width >= width - 1);
        await page.waitForFunction(() => {
          const reader = document.querySelector('.rws-pdf-reader'), page = reader?.querySelector('.pdfViewer .page'), canvas = page?.querySelector('canvas');
          if (!canvas || !page) return false;
          const box = page.getBoundingClientRect(), bounds = reader.getBoundingClientRect();
          if (box.left < bounds.left || box.right > bounds.right) return false;
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 200 && Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 160) ink++;
          return ink > 200;
        });
        const pdfControls = await reader.locator('.rws-pdf-controls').evaluate(toolbar => {
          const boxes = [...toolbar.querySelectorAll('button,input')].map(control => control.getBoundingClientRect());
          return boxes.every(box => box.width > 20 && box.left >= 0 && box.right <= innerWidth) && boxes.every((box, index) => boxes.slice(index + 1).every(other => Math.min(box.right, other.right) <= Math.max(box.left, other.left)));
        });
        assert.equal(pdfControls, true);
        const actions = await page.locator('.rws-workbar-actions > button').evaluateAll(buttons => buttons.map(button => ({ radius: getComputedStyle(button).borderRadius, box: button.getBoundingClientRect().toJSON(), labelled: button.classList.contains('rws-preview-pdf') })));
        for (const action of actions) {
          assert.equal(action.radius, action.labelled ? '100px' : '50%');
          assert.ok(action.box.x >= 0 && action.box.right <= width);
          if (!action.labelled) assert.ok(Math.abs(action.box.width - action.box.height) < 1);
        }
        await page.screenshot({ path: join(tmpdir(), `rk-resume-pdf-preview-${width}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      const beforeZoom = await reader.locator('.pdfViewer .page').first().evaluate(element => element.getBoundingClientRect().width);
      await reader.getByRole('button', { name: 'Zoom PDF in', exact: true }).click();
      await page.waitForFunction(width => document.querySelector('.pdfViewer .page').getBoundingClientRect().width > width, beforeZoom);
      await reader.getByRole('button', { name: 'Fit PDF width', exact: true }).click();
      await page.getByText('Parser reading order /', { exact: false }).click();
      assert.match(await page.locator('.rws-reading-order pre').innerText(), /Authored achievement 12/);
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
      assert.equal(await page.getByRole('complementary', { name: 'Resume library', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('complementary', { name: 'Resume properties', exact: true }).isVisible(), true);
      await page.getByRole('tab', { name: 'Content', exact: true }).click();
      await page.getByLabel('Summary', { exact: true }).fill('Edited after export.'); await saved(page);
      await page.getByRole('tab', { name: 'PDF', exact: true }).click();
      assert.match(await page.locator('.rws-canvas-tools').innerText(), /Historical PDF/);
      let release, requested;
      const held = new Promise(resolve => { release = resolve; }); const arrived = new Promise(resolve => { requested = resolve; });
      await page.route('**/__resume/api/resumes/export-flow/export', async route => { requested(); await held; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preview.store.get(document.id).exports[0]) }); });
      await page.getByRole('button', { name: 'Export PDF', exact: true }).click(); await arrived;
      await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
      await page.getByRole('tab', { name: 'Resumes', exact: true }).click();
      await page.locator('.rws-library-row').filter({ hasText: 'Master resume' }).click();
      await page.waitForFunction(() => document.querySelector('.rws-document-name').textContent === 'Master resume');
      release(); await page.getByRole('tab', { name: 'Canvas', exact: true }).waitFor().catch(error => { throw new Error(error.message + '\nPage errors: ' + JSON.stringify(errors)); });
      assert.equal(await page.getByRole('region', { name: 'Verified exported PDF', exact: true }).count(), 0);
      assert.equal(preview.store.get('avery-master').document.assessment, null);
      await page.getByRole('button', { name: 'Back to resumes', exact: true }).click();
      await page.locator('.rws[data-view="library"]').waitFor();
      assert.equal(await page.locator('.rws-body > main').isVisible(), false);
      assert.equal(await page.getByRole('complementary', { name: 'Resume properties', exact: true }).isVisible(), false);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const library = page.getByRole('complementary', { name: 'Resume library', exact: true });
        assert.equal(await library.isVisible(), true);
        const bounds = await library.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      }
      await page.getByRole('button', { name: /^PDF navigation sample General purpose/ }).click();
      await page.locator('.rws[data-view="edit"]').waitFor();
      assert.equal(preview.store.get('export-flow').document.model.summary, 'Edited after export.');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});

test('PDF bounds distinguish zero-height synthetic spacing from out-of-page visible text', () => {
  const document = fixture();
  const positions = [{ width: 595.28, height: 841.89, items: [{ str: resumeText(document), x: 40, y: 70, w: 450, h: 10 }, { str: ' ', x: 200, y: 70, w: 450, h: 0 }] }];
  assert.equal(verifyResumePdf(document, positions).verification.complete, true);
  positions[0].items[1].str = 'Outside';
  assert.throws(() => verifyResumePdf(document, positions), /bounds/);
  positions[0].items[1].str = ' '; positions[0].items[1].h = 10;
  assert.throws(() => verifyResumePdf(document, positions), /bounds/);
  positions[0].items[1].h = 0; positions[0].items[1].w = Infinity;
  assert.throws(() => verifyResumePdf(document, positions), /bounds/);
});

test('ATS migration storage verifies originals, retries without duplication and blocks late legacy edits', async () => {
  const { Miniflare } = await import('miniflare');
  const { createHostedResumeStore } = await import('./worker/resume-workspace.mjs');
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', r2Buckets: ['RESUMES', 'VAULT'] });
  try {
    const bucket = await runtime.getR2Bucket('RESUMES'), legacy = await runtime.getR2Bucket('VAULT'), store = createHostedResumeStore(bucket, legacy);
    const bytes = new TextEncoder().encode('Original immutable resume');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    const review = { id: 'original', tool: 'ats', kind: 'review', payload: { text: 'Original immutable resume', resumeDocument: { sha256, size: bytes.length, name: 'original.txt', type: 'text/plain', data: Buffer.from(bytes).toString('base64') } } };
    const entry = { id: 'edited', tool: 'ats', kind: 'workspace', payload: { rb: fixture().model, reviewId: review.id } };
    await legacy.put('prep/ats/original.json', JSON.stringify(review));
    await legacy.put('prep/ats/edited.json', JSON.stringify(entry));
    const [first, retry] = await Promise.all([store.migrate(entry, review), store.migrate(entry, review)]);
    assert.equal(first.document.id, retry.document.id);
    assert.equal((await store.list()).documents.length, 1);
    assert.deepEqual(new Uint8Array((await store.sourceFile(sha256)).bytes), bytes);
    assert.equal(first.document.ats.legacy.review.payload.resumeDocument.data, undefined);
    const edited = editResumeField(first.document, 'summary', 'Saved in the only editor');
    await store.save(edited.id, edited, 1);
    await bucket.delete(['legacy-links/edited.json', 'legacy-links/original.json']);
    assert.equal((await store.migrate(entry, review)).document.model.summary, edited.model.summary);
    assert.equal((await (await bucket.get('legacy-links/original.json')).json()).resumeId, edited.id);
    const changedReview = structuredClone(review); changedReview.payload.text += ' Late review update';
    await legacy.put('prep/ats/original.json', JSON.stringify(changedReview));
    await assert.rejects(store.migrate(entry, changedReview), error => error.code === 'legacy-conflict');
    await legacy.put('prep/ats/original.json', JSON.stringify(review));
    const stale = structuredClone(entry); stale.payload.rb.summary = 'Different old-tab edit';
    await legacy.put('prep/ats/edited.json', JSON.stringify(stale));
    await assert.rejects(store.migrate(entry, review), /changed/);
    await assert.rejects(store.save(edited.id, edited, 2), /older ATS tab/);
    assert.equal((await store.get(edited.id)).version, 2);
    assert.equal((await (await legacy.get('prep/ats/edited.json')).json()).payload.rb.summary, stale.payload.rb.summary);
    const local = structuredClone(stale); local.payload.rb.summary = 'Newest browser-only edit';
    const recovered = await store.recoverLegacy(edited.id, 2, { entry: local, review });
    assert.equal(recovered.document.model.summary, edited.model.summary);
    assert.equal(recovered.document.ats.recoveredIds.length, 2);
    const variants = await Promise.all(recovered.document.ats.recoveredIds.map(id => store.get(id)));
    assert.deepEqual(new Set(variants.map(record => record.document.model.summary)), new Set([stale.payload.rb.summary, local.payload.rb.summary]));
    assert.deepEqual(recovered.document.ats.legacy, first.document.ats.legacy);
    await store.save(edited.id, recovered.document, recovered.version);
    const count = (await store.list()).documents.length;
    await store.recoverLegacy(edited.id, recovered.version + 1, { entry: local, review });
    assert.equal((await store.list()).documents.length, count);
  } finally { await runtime.dispose(); }
});