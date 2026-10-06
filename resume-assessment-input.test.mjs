import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessmentFileType, captureAssessmentInput, extractAssessmentArtifact } from './src/js/resume-assessment-input.mjs';
import { assertAssessmentCurrent, createCandidateAssessment, validateCandidateAssessment } from './src/js/resume-assessment.mjs';
import { readResumePdf } from './src/js/resume-pdf.mjs';
import { resumeFields, resumeSignature } from './src/js/resume-workspace.mjs';
import { RESUME_RENDER_VERSION } from './src/js/resume-render.mjs';
import { sampleResumes } from './src/js/resume-sample.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = text => new TextEncoder().encode(text);
const target = { company: 'Example', role: 'Engineer', level: 'senior', jd: 'Python experience required.' };
async function original() {
  const bytes = encode('Avery Example\n\nBuilt Python prototypes.'), id = hash(bytes);
  const source = { name: 'Original.txt', type: 'text/plain', id, sha256: id, text: 'Stale cached text that must never be used.' };
  const document = sampleResumes(id)[0]; document.target = target;
  return { kind: 'source', document, version: 2, source, bytes, mediaType: source.type, extraction: await extractAssessmentArtifact(bytes, source.type) };
}
async function exported() {
  const input = await original();
  const text = resumeFields(input.document.model).filter(field => !field.id.endsWith('.url')).map(field => field.value).join(' ');
  const pages = [{ width: 595.28, height: 841.89, items: [{ str: text, x: 40, y: 60, w: 500, h: 12 }] }];
  const { source, ...base } = input;
  return { ...base, kind: 'export', mediaType: 'application/pdf', extraction: { text, pages, links: [], extractorVersion: 'scripted-parser-v1' },
    entry: { id: 'checked-example', version: 1, signature: resumeSignature(input.document), renderVersion: RESUME_RENDER_VERSION,
      sha256: hash(input.bytes), bytes: input.bytes.length, pages: 1, verification: { complete: true }, layoutBoundsVerified: true } };
}
function pdfFixture({ text = 'Avery Example', numPages = 1, items } = {}) {
  let destroyed = 0, supplied;
  return { loadPdf: async () => ({ version: 'scripted', getDocument: options => {
    supplied = options.data;
    return { destroy: async () => { destroyed++; }, promise: Promise.resolve({ numPages,
      getPage: async () => ({ getViewport: () => ({ width: 595.28, height: 841.89 }),
        getTextContent: async () => ({ items: items || [{ str: text, width: 80, height: 12, transform: [1, 0, 0, 1, 40, 780], hasEOL: true }] }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        getAnnotations: async () => [{ subtype: 'Link', url: 'https://example.test' }] }) }) };
  } }), get destroyed() { return destroyed; }, get supplied() { return supplied; } };
}

test('Artifact intake and attached original use identical actual text without editor or cached-text substitution', async () => {
  const input = await original(), before = structuredClone(input);
  const source = await captureAssessmentInput(input);
  const upload = await captureAssessmentInput({ kind: 'upload', bytes: input.bytes, mediaType: input.mediaType, extraction: input.extraction, target });
  assert.deepEqual(source.artifact, upload.artifact);
  assert.equal(upload.binding.documentId, null); assert.equal(upload.binding.documentVersion, null);
  assert.equal(source.binding.documentVersion, 2);
  assert.doesNotMatch(source.artifact.text, /cached|median setup/);
  assert.deepEqual(input, before);
  await assert.rejects(captureAssessmentInput({ ...input, bytes: encode('Wrong original') }), /expected hash/);
  assert.throws(() => captureAssessmentInput({ ...input, document: { ...input.document, sourceIds: [] } }), /attached original/);
  assert.throws(() => captureAssessmentInput({ ...input, version: undefined }), /saved document/);
  assert.throws(() => captureAssessmentInput({ ...input, kind: 'upload', target }), /must not inherit/);
});

test('Capture freezes pending inputs and rejects later target or saved-version changes', async () => {
  const input = await original(), pending = captureAssessmentInput(input);
  input.extraction.text = 'Changed after capture'; input.bytes.fill(0);
  const captured = await pending;
  assert.match(captured.artifact.text, /Built Python/);
  const fresh = await original();
  const changed = await captureAssessmentInput({ ...fresh, version: 3 });
  assert.throws(() => assertAssessmentCurrent(captured, changed), /changed/);
  fresh.document.target = { ...target, jd: 'Java required.' };
  const changedTarget = await captureAssessmentInput(fresh);
  assert.notEqual(captured.binding.targetSha256, changedTarget.binding.targetSha256);
});

test('Checked export binds actual bytes and current content; a reusable older export is not an older document assessment', async () => {
  const input = await exported(), snapshot = await captureAssessmentInput(input);
  assert.equal(snapshot.binding.documentVersion, 2);
  assert.equal(snapshot.artifact.rendererVersion, RESUME_RENDER_VERSION);
  assert.equal(snapshot.binding.artifactSha256, hash(input.bytes));
  for (const patch of [{ renderVersion: RESUME_RENDER_VERSION - 1 }, { version: 3 }, { signature: 'stale' }, { verification: { complete: false } },
    { layoutBoundsVerified: false }, { bytes: 1 }]) {
    assert.throws(() => captureAssessmentInput({ ...input, entry: { ...input.entry, ...patch } }), /checked export/);
  }
  await assert.rejects(captureAssessmentInput({ ...input, bytes: encode('x'.repeat(input.bytes.length)) }), /expected hash/);
  assert.throws(() => captureAssessmentInput({ ...input, entry: { ...input.entry, sha256: undefined } }), /content hash/);
});

test('A checked flag cannot bypass missing text, absent geometry, wrong page count or physical overflow', async () => {
  const input = await exported();
  for (const [patch, message] of [
    [{ text: 'Avery Example' }, /evidence is missing authored text/],
    [{ pages: null }, /geometry/],
    [{ pages: [] }, /page counts/],
    [{ pages: [{ ...input.extraction.pages[0], items: [] }] }, /missing text/],
    [{ pages: [{ ...input.extraction.pages[0], items: [{ ...input.extraction.pages[0].items[0], str: 'Avery Example' }] }] }, /missing text/],
    [{ pages: [{ ...input.extraction.pages[0], items: [{ ...input.extraction.pages[0].items[0], w: 900 }] }] }, /bounds/],
    [{ links: ['javascript:alert(1)'] }, /Invalid PDF links/],
  ]) assert.throws(() => captureAssessmentInput({ ...input, extraction: { ...input.extraction, ...patch } }), message);
  assert.throws(() => captureAssessmentInput({ ...input, entry: { ...input.entry, pages: 2 } }), /page counts/);
});

test('PDF reader shares positions, raw link targets and line text while retaining the original bytes', async () => {
  const fixture = pdfFixture(), bytes = encode('%PDF-scripted-unit-fixture');
  const result = await extractAssessmentArtifact(bytes, 'application/pdf', fixture);
  assert.equal(result.text, 'Avery Example');
  assert.equal(result.pages[0].items[0].y, 61.889999999999986);
  assert.deepEqual(result.links, ['https://example.test']);
  assert.equal(fixture.destroyed, 1); assert.notEqual(fixture.supplied, bytes);
  assert.deepEqual(fixture.supplied, bytes);
});

test('Candidate PDF evidence separates distant same-row runs while legacy extraction stays unchanged', async () => {
  const make = (str, x, width) => ({ str, width, height: 12, dir: 'ltr', transform: [1, 0, 0, 1, x, 780], hasEOL: false });
  const fixture = pdfFixture({ items: [make('North', 40, 30), make('star', 70, 20), make('Atlas', 330, 60)] });
  const bytes = encode('%PDF-scripted-column-fixture');
  const legacy = await readResumePdf(bytes, fixture), candidate = await extractAssessmentArtifact(bytes, 'application/pdf', fixture);
  assert.equal(legacy.text, 'Northstar Atlas');
  assert.equal(candidate.text, 'Northstar\nAtlas');
  assert.match(candidate.extractorVersion, /separated-runs-v1/);
  assert.doesNotMatch(legacy.extractorVersion, /separated-runs/);
  assert.equal(candidate.pages[0].items[0].rotation, 0); assert.equal(candidate.pages[0].items[0].direction, 'ltr');
  const snapshot = await captureAssessmentInput({ kind: 'upload', bytes, mediaType: 'application/pdf', extraction: candidate, target });
  assert.deepEqual(snapshot.evidence.map(item => item.text), ['Northstar', 'Atlas']);
  assert.equal(snapshot.artifact.readingOrder.status, 'ambiguous');
  assert.equal(snapshot.artifact.structure, undefined);
});

async function mappedOriginal() {
  const make = (str, x, y, width, hasEOL = true) => ({ str, width, height: 12, dir: 'ltr', transform: [1, 0, 0, 1, x, y], hasEOL });
  const reader = pdfFixture({ items: [
    make(' Avery Example ', 40, 780, 100, false), make('', 0, 0, 0),
    make('Northstar', 40, 750, 80), make(' Built ', 40, 730, 45, false), make('tools. ', 85, 730, 40),
    make('Atlas', 40, 680, 80), make('Built tools.', 40, 660, 85),
    make('\u2022', 25, 730, 5), make('\u2022', 25, 660, 5),
  ] });
  const bytes = encode('%PDF-scripted-exact-source-fixture');
  return { kind: 'upload', bytes, mediaType: 'application/pdf', target, extraction: await extractAssessmentArtifact(bytes, 'application/pdf', reader) };
}

test('PDF evidence follows exact repeated occurrences, trimmed fragments and late-drawn bullets', async () => {
  const input = await mappedOriginal(), snapshot = await captureAssessmentInput(input);
  assert.equal(snapshot.artifact.evidenceMap.version, 'pdf-evidence-map-v1');
  const repeated = snapshot.evidence.filter(excerpt => excerpt.text === '\u2022 Built tools.');
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated[0].pdfSpans.map(span => span.item), [6, 2, 3]);
  assert.deepEqual(repeated[1].pdfSpans.map(span => span.item), [7, 5]);
  assert.equal(repeated[0].pdfSpans[1].start, 1);
  assert.equal(snapshot.evidence[0].pdfSpans[0].start, 1);
  assert.equal(snapshot.artifact.pages[0].items[0].hasEOL, true);
  for (const excerpt of snapshot.evidence) {
    const recovered = excerpt.pdfSpans.map(span => snapshot.artifact.pages[span.page - 1].items[span.item].str.slice(span.start, span.end)).join('');
    assert.equal(recovered.replace(/\s/g, ''), excerpt.text.replace(/\s/g, ''));
    assert.ok(Object.isFrozen(excerpt.pdfSpans));
  }
  const report = await createCandidateAssessment(snapshot);
  assert.deepEqual(await validateCandidateAssessment(JSON.parse(JSON.stringify(report)), snapshot), report);
  const altered = structuredClone(report);
  altered.evidence.find(excerpt => excerpt.id === repeated[0].id).pdfSpans = repeated[1].pdfSpans;
  await assert.rejects(validateCandidateAssessment(altered, snapshot), /record does not match/);
  assert.equal(report.dimensions.artifact.observations.find(item => item.id === 'field-association').status, 'unknown');
});

test('Mapped PDF evidence rejects changed text, missing line boundaries and method downgrades before judgment', async () => {
  const input = await mappedOriginal();
  await assert.rejects(captureAssessmentInput({ ...input, extraction: { ...input.extraction, text: input.extraction.text.replace('Northstar', 'Meridian') } }), /does not match its positional extraction/);
  const missing = structuredClone(input); delete missing.extraction.pages[0].items[0].hasEOL;
  await assert.rejects(captureAssessmentInput(missing), /line boundaries/);
  assert.throws(() => captureAssessmentInput({ ...input, extraction: { ...input.extraction, evidenceMapVersion: undefined } }), /cannot discard/);
  assert.throws(() => captureAssessmentInput({ ...input, extraction: { ...input.extraction, evidenceMapVersion: 'future-version' } }), /cannot discard/);
  const pending = captureAssessmentInput(input); input.extraction.pages[0].items[1].str = 'Mutation after capture';
  assert.equal((await pending).artifact.pages[0].items[1].str, 'Northstar');
});

test('PDF extraction fails closed for empty text, unmapped glyphs, page/item bounds and cancellation', async () => {
  const bytes = encode('%PDF-scripted-unit-fixture');
  for (const [options, message] of [[{ text: '' }, /no readable text/], [{ text: 'Unknown\u0000glyph' }, /unmapped glyphs/],
    [{ numPages: 51 }, /page count/], [{ items: Array(50001).fill({ str: 'x' }) }, /item count/]]) {
    const fixture = pdfFixture(options);
    await assert.rejects(extractAssessmentArtifact(bytes, 'application/pdf', fixture), message);
    assert.equal(fixture.destroyed, 1);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readResumePdf(bytes, { signal: controller.signal }), /abort/i);
  const running = new AbortController(); let rejectPdf, destroyed = 0;
  const pending = readResumePdf(bytes, { signal: running.signal, loadPdf: async () => ({ getDocument: () => ({
    promise: new Promise((_, reject) => { rejectPdf = reject; }),
    destroy: async () => { destroyed++; rejectPdf(running.signal.reason); },
  }) }) });
  await new Promise(resolve => setImmediate(resolve)); running.abort();
  await assert.rejects(pending, /abort/i); assert.equal(destroyed, 1);
});

test('Text/file limits are explicit and DOCX extraction warnings cannot become clean evidence', async () => {
  assert.equal(assessmentFileType({ name: 'CV.TXT', type: '' }), 'text/plain');
  assert.throws(() => assessmentFileType({ name: 'CV.pdf', type: 'text/plain' }), /matching file type/);
  assert.throws(() => assessmentFileType({ name: 'CV.md' }), /choose a PDF/);
  for (const bytes of [new Uint8Array(), new Uint8Array(20 * 1024 * 1024 + 1)]) await assert.rejects(extractAssessmentArtifact(bytes, 'text/plain'), /20 MB/);
  await assert.rejects(extractAssessmentArtifact(Uint8Array.of(255), 'text/plain'), /encoded data/);
  await assert.rejects(extractAssessmentArtifact(encode('x'.repeat(60001)), 'text/plain'), /Nothing was truncated/);
  const mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const loadDocx = async () => ({ extractRawText: async () => ({ value: 'Avery Example', messages: [{ message: 'Unsupported content omitted' }] }) });
  await assert.rejects(extractAssessmentArtifact(encode('scripted-docx'), mediaType, { loadDocx }), /Unsupported content omitted/);
});

test('Actual Mammoth parser extracts a complete fictional DOCX without importing an editable document', async () => {
  const files = [
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Avery Example</w:t></w:r></w:p><w:p><w:r><w:t>Built Python prototypes.</w:t></w:r></w:p></w:body></w:document>'],
  ];
  const local = [], central = []; let offset = 0;
  for (const [path, text] of files) {
    const name = Buffer.from(path), data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = new Uint8Array(Buffer.concat([...local, directory, end]));
  const mediaType = assessmentFileType({ name: 'Fictional.docx' });
  const extraction = await extractAssessmentArtifact(bytes, mediaType);
  assert.equal(extraction.text, 'Avery Example\n\nBuilt Python prototypes.\n\n');
  const snapshot = await captureAssessmentInput({ kind: 'upload', bytes, mediaType, extraction, target });
  assert.equal(snapshot.binding.documentId, null);
  assert.equal(snapshot.binding.artifactSha256, hash(bytes));
  assert.equal(snapshot.artifact.pages, null);
});
