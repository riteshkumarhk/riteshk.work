import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResume, resumeFields, validatePdfText, normalizeResumePdfText } from './src/js/resume-workspace.mjs';
import { inspectAuthoredPdf, inspectPdfReadingOrder } from './src/js/resume-pdf-structure.mjs';
import { verifyResumePdf } from './src/js/resume-pdf.mjs';
import { createAssessmentSnapshot, createCandidateAssessment, validateCandidateAssessment } from './src/js/resume-assessment.mjs';
import { captureAssessmentInput, extractAssessmentArtifact } from './src/js/resume-assessment-input.mjs';

function fixture(id = 'structure-test') {
  return createResume({ id, model: { name: 'Avery Example', title: 'Staff Product Designer', summary: 'I deliver clear workflows and measurable outcomes.',
    contact: { phone: '+1 415 555-0142', links: [] }, sections: [
      { id: 'experience', kind: 'experience', heading: 'Experience', items: [
        { id: 'north', role: 'Lead Product Designer', org: 'Northstar', dates: '2021 - Present', bullets: [{ id: 'pricing', text: 'Launched pricing workflows for forty customers.' }] },
        { id: 'atlas', role: 'Product Designer', org: 'Atlas', dates: '2018 - 2021', bullets: [{ id: 'support', text: 'Improved support routing for twenty teams.' }] },
      ] },
      { id: 'skills', kind: 'skills', heading: 'Capabilities', groups: [{ id: 'methods', label: 'Practice', items: ['Research', 'Prototyping'] }] },
    ] } });
}
function positions(document) {
  return [{ width: 595.28, height: 841.89, items: resumeFields(document.model).filter(field => field.value && !field.id.endsWith('.url'))
    .map((field, index) => ({ str: field.value, x: 40, y: 40 + index * 25, w: 480, h: 12 })) }];
}
const text = pages => pages.flatMap(page => page.items.map(item => item.str)).join(' ');

function orderItem(str, x, y, w = 150) {
  return { str, x, y, w, h: 12, rotation: 0, direction: 'ltr' };
}
function columnPage() {
  return { width: 595.28, height: 841.89, items: [
    orderItem('Avery Example - professional history and skills', 40, 40, 480),
    orderItem('Northstar', 40, 80), orderItem('Lead Designer', 40, 105), orderItem('Built pricing workflows.', 40, 130),
    orderItem('Atlas', 330, 80), orderItem('Designer', 330, 105), orderItem('Improved support routing.', 330, 130),
    orderItem('Additional experience and selected contributions', 40, 170, 480),
    orderItem('Meridian', 40, 210), orderItem('Staff Designer', 40, 235), orderItem('Led research.', 40, 260),
    orderItem('Cedar', 330, 210), orderItem('Researcher', 330, 235), orderItem('Built prototypes.', 330, 260),
  ] };
}

test('Reference-free order probes retain every item and spanning bands without assigning employers', () => {
  const pages = [columnPage()], before = structuredClone(pages), audit = inspectPdfReadingOrder(pages), page = audit.pages[0];
  assert.equal(audit.status, 'ambiguous');
  assert.equal(page.gutter.supportRows, 6);
  assert.deepEqual(page.orders.columns, page.orders.native);
  assert.notDeepEqual(page.orders.rows, page.orders.native);
  for (const order of Object.values(page.orders)) {
    assert.deepEqual([...order].sort((a, b) => a - b), pages[0].items.map((_, i) => i));
    assert.equal(new Set(order).size, order.length);
  }
  assert.equal(page.orders.columns[0], 0); assert.equal(page.orders.columns[7], 7);
  assert.deepEqual(pages, before);
  assert.match(audit.reason, /not a vendor ATS pass/);
});

test('Agreement is scoped; aligned dates and multiple gutters never become a verified column layout', () => {
  const single = { width: 600, height: 800, items: [orderItem('Employer', 40, 60), orderItem('Role', 40, 85), orderItem('Achievement', 40, 110)] };
  assert.equal(inspectPdfReadingOrder([single]).status, 'agreement');
  const dates = structuredClone(single);
  dates.items.push(...[60, 85, 110].map((y, i) => orderItem('202' + i, 420, y, 40)));
  const possible = inspectPdfReadingOrder([dates]);
  assert.equal(possible.status, 'ambiguous');
  assert.match(possible.pages[0].reasons.join(' '), /aligned dates or a table/);
  const three = { width: 600, height: 800, items: [40, 230, 420].flatMap((x, column) => [60, 85, 110].map((y, row) => orderItem('Column ' + column + ' row ' + row, x, y, 80))) };
  const ambiguous = inspectPdfReadingOrder([three]);
  assert.equal(ambiguous.status, 'ambiguous'); assert.equal(ambiguous.pages[0].orders.columns, null);
  assert.match(ambiguous.pages[0].reasons.join(' '), /Multiple incompatible/);
});

test('Unsupported writing geometry, image-only pages and bounded overflows stay explicitly unknown', () => {
  for (const patch of [{ rotation: 90 }, { direction: 'rtl' }, { direction: 'unknown' }, { rotation: undefined }, { h: 0 }, { x: -30 }]) {
    const page = columnPage(); Object.assign(page.items[2], patch);
    const audit = inspectPdfReadingOrder([page]); assert.equal(audit.status, 'unknown'); assert.equal(audit.pages[0].orders.columns, null);
  }
  const overlap = columnPage(); overlap.items.push({ ...overlap.items[1] });
  assert.equal(inspectPdfReadingOrder([overlap]).status, 'unknown');
  assert.equal(inspectPdfReadingOrder([{ width: 600, height: 800, items: [] }]).status, 'unknown');
  const overflow = columnPage(); overflow.items = Array.from({ length: 2001 }, () => orderItem('x', 40, 60));
  assert.deepEqual(inspectPdfReadingOrder([columnPage(), overflow]).pages, []);
  overflow.items = [orderItem('x'.repeat(120001), 40, 60)];
  assert.deepEqual(inspectPdfReadingOrder([overflow]).pages, []);
  const manyGaps = { width: 600, height: 20000, items: Array.from({ length: 513 }, (_, index) =>
    [orderItem('Left', 40, 40 + index * 25), orderItem('Right', 330, 40 + index * 25)]).flat() };
  assert.equal(inspectPdfReadingOrder([manyGaps]).pages[0].status, 'unknown');
  assert.match(inspectPdfReadingOrder([manyGaps]).pages[0].reasons[0], /512 horizontal gaps/);
  assert.throws(() => inspectPdfReadingOrder([{ ...columnPage(), width: NaN }]), /invalid page geometry/);
});

test('Original PDF order is authoritative, immutable and versioned without rewriting old snapshots', async () => {
  const pages = [columnPage()], input = { target: fixture().target, artifact: { bytes: new TextEncoder().encode('fictional PDF'), mediaType: 'application/pdf',
    text: text(pages), pages, extractorVersion: 'scripted-geometry-v1' } };
  const old = await createAssessmentSnapshot(input);
  const pending = createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, inspectReadingOrder: 'pdf-order-probes-v1' } });
  pages[0].items[0].str = 'Later mutation';
  const snapshot = await pending;
  assert.equal(snapshot.binding.documentId, null); assert.equal(snapshot.artifact.structure, undefined);
  assert.equal(old.artifact.readingOrder, undefined); assert.notEqual(old.fingerprint, snapshot.fingerprint);
  assert.equal(snapshot.artifact.pages[0].items[0].str, 'Avery Example - professional history and skills');
  assert.ok(Object.isFrozen(snapshot.artifact.readingOrder.pages[0].orders.columns));
  const report = await createCandidateAssessment(snapshot);
  assert.equal(report.dimensions.artifact.observations.find(item => item.id === 'pdf-order-probes').status, 'warn');
  assert.equal(report.dimensions.artifact.observations.find(item => item.id === 'field-association').status, 'unknown');
  assert.equal(report.headline.value, null);
  assert.deepEqual(await validateCandidateAssessment(JSON.parse(JSON.stringify(report)), snapshot), report);
  const altered = structuredClone(report); altered.dimensions.artifact.readingOrder.pages[0].orders.columns.reverse();
  await assert.rejects(validateCandidateAssessment(altered, snapshot), /record does not match its bound inputs or derived facts/);
  await assert.rejects(createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, inspectReadingOrder: 'future-version' } }), /supported method/);
  const oldReport = await createCandidateAssessment(old);
  assert.deepEqual(await validateCandidateAssessment(JSON.parse(JSON.stringify(oldReport)), old), oldReport);
});

test('Authored PDF probes localize exact spans without mistaking a longer title for a shorter role', () => {
  const document = fixture(), pages = positions(document), audit = inspectAuthoredPdf(document, pages);
  assert.equal(audit.status, 'consistent', JSON.stringify(audit));
  for (const order of [audit.native, audit.rows]) {
    assert.equal(order.association, 'consistent'); assert.equal(order.order, 'consistent');
    for (const field of order.fields.filter(field => field.state === 'located')) {
      const recovered = field.spans.map(span => pages[span.page - 1].items[span.item].str.slice(span.start, span.end)).join('');
      assert.equal(normalizeResumePdfText(recovered), normalizeResumePdfText(resumeFields(document.model).find(item => item.id === field.id).value));
    }
    assert.equal(order.fields.find(field => field.id === 'atlas.role').spans[0].item, pages[0].items.findIndex(item => item.str === 'Product Designer'));
  }
});

test('All words can be present while achievements or dates belong to the wrong authored entry', () => {
  const document = fixture();
  for (const pair of [['Launched pricing workflows for forty customers.', 'Improved support routing for twenty teams.'], ['2021 - Present', '2018 - 2021']]) {
    const pages = positions(document), first = pages[0].items.find(item => item.str === pair[0]), second = pages[0].items.find(item => item.str === pair[1]);
    [first.str, second.str] = [second.str, first.str];
    assert.equal(validatePdfText(document, text(pages)).complete, true);
    assert.equal(verifyResumePdf(document, pages).verification.complete, true);
    assert.equal(inspectAuthoredPdf(document, pages).status, 'mismatch');
  }
});

test('Content order is not visual order; disagreeing probes and duplicated evidence remain unknown', () => {
  const document = fixture(), pages = positions(document);
  const first = pages[0].items.find(item => item.str.startsWith('Launched')), second = pages[0].items.find(item => item.str.startsWith('Improved'));
  [first.y, second.y] = [second.y, first.y];
  const moved = inspectAuthoredPdf(document, pages);
  assert.equal(moved.native.association, 'consistent'); assert.equal(moved.rows.association, 'mismatch'); assert.equal(moved.status, 'unknown');
  const duplicate = positions(document); duplicate[0].items.push({ ...duplicate[0].items.find(item => item.str === 'Northstar'), y: 790 });
  const ambiguous = inspectAuthoredPdf(document, duplicate);
  assert.equal(ambiguous.status, 'unknown');
  assert.equal(ambiguous.native.fields.find(field => field.id === 'north.org').state, 'unknown');
});

test('Unexpected word prefixes cannot masquerade as exact employer or role fields', () => {
  const document = fixture(), pages = positions(document);
  const company = pages[0].items.find(item => item.str === 'Northstar');
  company.str = 'SuperNorthstar';
  assert.equal(validatePdfText(document, text(pages)).complete, true);
  assert.equal(inspectAuthoredPdf(document, pages).native.fields.find(field => field.id === 'north.org').state, 'unknown');
  company.str = 'Northstar';
  const index = pages[0].items.indexOf(company);
  pages[0].items.splice(index, 0, { ...company, str: 'Super', x: 10, w: 30 });
  assert.equal(inspectAuthoredPdf(document, pages).native.fields.find(field => field.id === 'north.org').state, 'unknown');
});

test('Reversed entry order is visible even when each entry retains its own achievements', () => {
  const document = fixture(), reversed = structuredClone(document);
  reversed.model.sections[0].items.reverse();
  const audit = inspectAuthoredPdf(document, positions(reversed));
  assert.equal(audit.native.association, 'consistent'); assert.equal(audit.rows.association, 'consistent');
  assert.equal(audit.native.order, 'mismatch'); assert.equal(audit.rows.order, 'mismatch'); assert.notEqual(audit.status, 'consistent');
});

test('Structure inspection excludes only recognized page counters and retains multipage field references', () => {
  const document = fixture(), pages = positions(document);
  const index = pages[0].items.findIndex(item => item.str.startsWith('Launched'));
  const rest = pages[0].items.splice(index + 1).map((item, i) => ({ ...item, y: 70 + i * 25 }));
  pages[0].items[index].str = 'Launched pricing';
  pages[0].items.push({ str: '1 / 2', x: 540, y: 825, w: 30, h: 10 });
  pages.push({ width: 595.28, height: 841.89, items: [{ str: 'workflows for forty customers.', x: 40, y: 40, w: 400, h: 12 }, ...rest, { str: '2 / 2', x: 540, y: 825, w: 30, h: 10 }] });
  const audit = inspectAuthoredPdf(document, pages);
  assert.equal(audit.status, 'consistent', JSON.stringify(audit));
  assert.deepEqual(audit.native.fields.find(field => field.id === 'pricing').spans.map(span => span.page), [1, 2]);
  assert.equal(verifyResumePdf(document, pages).verification.complete, true);
  const bodyFraction = structuredClone(document); bodyFraction.model.sections[0].items[0].bullets[0].text = 'Authored fraction 1 / 2 stays visible.';
  assert.equal(inspectAuthoredPdf(bodyFraction, positions(bodyFraction)).status, 'consistent');
});

test('Absent, invalid, duplicated-identity and oversized structure inputs never produce agreement', () => {
  const document = fixture();
  assert.equal(inspectAuthoredPdf(document, []).status, 'unknown');
  assert.equal(inspectAuthoredPdf(document, [{ width: 595, height: 842, items: [] }]).status, 'unknown');
  const invalid = positions(document); invalid[0].items[0].x = NaN;
  assert.throws(() => inspectAuthoredPdf(document, invalid), /invalid text geometry/);
  const huge = positions(document); huge[0].items.push({ str: 'x'.repeat(120001), x: 0, y: 0, w: 1, h: 1 });
  assert.match(inspectAuthoredPdf(document, huge).reason, /budget/);
  const duplicate = structuredClone(document); duplicate.model.sections[0].items[1].id = 'north';
  assert.match(inspectAuthoredPdf(duplicate, positions(duplicate)).reason, /duplicate identities/);
});

test('Structure inspection is opt-in, snapshot-bound and revalidated rather than trusted from saved reports', async () => {
  const document = fixture(), pages = positions(document);
  const input = { document, documentVersion: 1, target: document.target, artifact: { bytes: new TextEncoder().encode('Scripted PDF contract bytes'),
    mediaType: 'application/pdf', text: text(pages), pages, rendererVersion: 9, extractorVersion: 'scripted-geometry-v1' } };
  const original = await createAssessmentSnapshot(input);
  assert.equal(original.artifact.structure, undefined);
  const inspected = await createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, inspectStructure: 'authored-pdf-order-v1' } });
  assert.notEqual(inspected.binding.extractionSha256, original.binding.extractionSha256);
  assert.ok(Object.isFrozen(inspected.artifact.structure.native.fields[0].spans));
  const report = await createCandidateAssessment(inspected);
  assert.equal(report.dimensions.artifact.structure.status, 'consistent');
  assert.equal(report.dimensions.artifact.observations.find(item => item.id === 'field-association').status, 'unknown');
  assert.equal(report.headline.value, null);
  const corrupted = structuredClone(report); corrupted.dimensions.artifact.structure.native.entries[0].state = 'unknown';
  await assert.rejects(validateCandidateAssessment(corrupted, inspected), /bound inputs/);
  await assert.rejects(createAssessmentSnapshot({ target: input.target, artifact: { ...input.artifact, inspectStructure: 'authored-pdf-order-v1' } }), /bound rendered PDF/);
});

test('Invisible line-break controls do not mimic missing summary or phone digits; visible omissions still fail', () => {
  const document = fixture();
  document.model.summary = 'I lead cross\u00adfunctional work and user\u200bcentred research.';
  document.model.contact.phone = '+1 415 555\u00ad0142';
  const actual = text(positions(document)).replaceAll('\u00ad', '').replaceAll('\u200b', '');
  assert.equal(validatePdfText(document, actual).complete, true);
  assert.equal(validatePdfText(document, actual.replace('crossfunctional', 'cross-functional').replace('5550142', '555-0142')).complete, true);
  for (const broken of [actual.replace('research', ''), actual.replace('0142', '014'), actual.replace('crossfunctional', 'cross functional nonsense')]) assert.equal(validatePdfText(document, broken).complete, false);
  document.model.contact.phone = '+1 415 555-0142';
  assert.ok(validatePdfText(document, actual).missing.some(field => field.label === 'Phone'));
  document.model.summary = 'Do not remove this negation.';
  assert.ok(validatePdfText(document, actual + ' Do remove this negation.').missing.some(field => field.label === 'Summary'));
});

describe('Authored PDF real-rendering checks', () => {
  let preview, directory;
  before(async () => {
    const { startPreview } = await import('./tools/resume-preview.mjs');
    directory = mkdtempSync(join(tmpdir(), 'rk-pdf-structure-'));
    preview = await startPreview({ port: 5565, directory });
  });
  after(async () => { await preview?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  test('A real original two-column PDF exposes alternate orders without borrowing an edited document', async () => {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.abort());
      await page.setContent(`<style>@page{size:A4;margin:0}body{margin:40pt;font:12pt Arial}header{margin-bottom:20pt}.columns{display:grid;grid-template-columns:190pt 190pt;gap:70pt}p{margin:0 0 12pt}</style>
        <header>Avery Example - professional history and selected skills</header>
        <div class="columns"><div><p>Northstar</p><p>Lead Product Designer</p><p>Built pricing workflows.</p><p>Reduced support handoffs.</p></div>
        <div><p>Atlas</p><p>Product Designer</p><p>Improved support routing.</p><p>Built research prototypes.</p></div></div>`);
      const bytes = new Uint8Array(await page.pdf({ preferCSSPageSize: true }));
      const extraction = await extractAssessmentArtifact(bytes, 'application/pdf', { loadPdf: () => import('pdfjs-dist/legacy/build/pdf.mjs') });
      const snapshot = await captureAssessmentInput({ kind: 'upload', bytes, mediaType: 'application/pdf', extraction, target: fixture().target });
      const audit = snapshot.artifact.readingOrder, order = audit.pages[0];
      assert.equal(audit.status, 'ambiguous', JSON.stringify(audit)); assert.ok(order.gutter);
      assert.equal(snapshot.binding.documentId, null); assert.equal(snapshot.artifact.structure, undefined);
      const ordered = key => order.orders[key].map(index => extraction.pages[0].items[index].str).join('\n');
      assert.ok(ordered('columns').indexOf('Reduced support') < ordered('columns').indexOf('Atlas'));
      assert.ok(ordered('rows').indexOf('Atlas') < ordered('rows').indexOf('Built pricing'));
      for (const indices of Object.values(order.orders)) assert.equal(new Set(indices).size, order.orders.native.length);
      assert.match(snapshot.artifact.text, /Northstar/); assert.match(snapshot.artifact.text, /Atlas/);
      assert.equal(snapshot.artifact.text, extraction.text);
      assert.equal(snapshot.artifact.evidenceMap.version, 'pdf-evidence-map-v1');
      for (const excerpt of snapshot.evidence) {
        const original = excerpt.pdfSpans.map(span => extraction.pages[span.page - 1].items[span.item].str.slice(span.start, span.end)).join('');
        assert.equal(original.replace(/\s/g, ''), excerpt.text.replace(/\s/g, ''));
      }
    } finally { await browser.close(); }
  });
  test('Real exports preserve formatting-control fields and produce exact structure observations across two fonts', async () => {
    for (const font of ['inter', 'gelasio']) {
      const document = fixture('structure-' + font);
      document.design.font = font;
      document.model.summary = 'I lead cross\u00adfunctional teams and user\u200bcentred research.';
      document.model.contact.phone = '+1 415 555\u00ad0142';
      preview.store.create(document);
      const response = await fetch(preview.origin + '/__resume/api/resumes/' + document.id + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '1' }, body: '{}' });
      const entry = await response.json(); assert.equal(response.status, 200, JSON.stringify(entry));
      const bytes = new Uint8Array(preview.store.exportFile(document.id, entry.id).bytes);
      const extraction = await extractAssessmentArtifact(bytes, 'application/pdf', { document, loadPdf: () => import('pdfjs-dist/legacy/build/pdf.mjs') });
      const snapshot = await captureAssessmentInput({ kind: 'export', document, version: 1, entry, bytes, mediaType: 'application/pdf', extraction });
      assert.equal(snapshot.artifact.structure.status, 'consistent', JSON.stringify(snapshot.artifact.structure));
      assert.doesNotMatch(extraction.text, /1\s*\/\s*1/);
      assert.match(extraction.extractorVersion, /checked-body-v1/);
      const raw = await extractAssessmentArtifact(bytes, 'application/pdf', { loadPdf: () => import('pdfjs-dist/legacy/build/pdf.mjs') });
      assert.match(raw.text, /1\s*\/\s*1/);
      assert.ok(snapshot.evidence.every(excerpt => excerpt.pdfSpans.length > 0));
      assert.ok(!snapshot.evidence.some(excerpt => excerpt.text === '1 / 1'));
      assert.equal(preview.store.get(document.id).version, 1);
    }
  });
  test('A real long checked export retains achievements across page counters without grading a truncated field', async () => {
    const document = fixture('structure-long');
    document.design.keepWhole = false;
    document.model.sections[0].items[0].bullets[0].text = Array.from({ length: 70 }, (_, i) => 'Milestone ' + (i + 1) + ' improved an explicitly measured customer workflow.').join(' ');
    preview.store.create(document);
    const response = await fetch(preview.origin + '/__resume/api/resumes/' + document.id + '/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '1' }, body: '{}' });
    const entry = await response.json(); assert.equal(response.status, 200, JSON.stringify(entry)); assert.ok(entry.pages > 1);
    const bytes = new Uint8Array(preview.store.exportFile(document.id, entry.id).bytes);
    const extraction = await extractAssessmentArtifact(bytes, 'application/pdf', { document, loadPdf: () => import('pdfjs-dist/legacy/build/pdf.mjs') });
    const snapshot = await captureAssessmentInput({ kind: 'export', document, version: 1, entry, bytes, mediaType: 'application/pdf', extraction });
    const field = snapshot.artifact.structure.native.fields.find(field => field.id === 'pricing');
    assert.equal(field.state, 'located'); assert.ok(new Set(field.spans.map(span => span.page)).size > 1);
    assert.match(extraction.text, /Milestone 70/);
    const milestone = snapshot.evidence.filter(excerpt => /Milestone/.test(excerpt.text));
    assert.ok(new Set(milestone.flatMap(excerpt => excerpt.pdfSpans.map(span => span.page))).size > 1);
    for (const excerpt of milestone) {
      const original = excerpt.pdfSpans.map(span => extraction.pages[span.page - 1].items[span.item].str.slice(span.start, span.end)).join('');
      assert.equal(original.replace(/\s/g, ''), excerpt.text.replace(/\s/g, ''));
    }
  });
});
