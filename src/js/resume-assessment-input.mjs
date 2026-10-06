import { createAssessmentSnapshot } from './resume-assessment.mjs';
import { readResumePdf, verifyResumePdf } from './resume-pdf.mjs';
import { resumeSignature, validatePdfText } from './resume-workspace.mjs';
import { RESUME_RENDER_VERSION } from './resume-render.mjs';
import { SEMANTIC_REVIEW } from './resume-assessment-semantics.mjs';

const types = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
const fail = message => { throw new Error('Assessment input: ' + message); };
export function assessmentFileType({ name, type }) {
  const expected = types[String(name).split('.').at(-1).toLowerCase()];
  if (!expected || (type && type !== 'application/octet-stream' && type !== expected)) fail('choose a PDF, DOCX or UTF-8 TXT file with a matching file type.');
  return expected;
}

export async function extractAssessmentArtifact(bytes, mediaType, { signal, document, loadPdf, loadDocx = () => import('mammoth/mammoth.browser.js') } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 20 * 1024 * 1024) fail('choose a nonempty file no larger than 20 MB.');
  const captured = bytes.slice();
  signal?.throwIfAborted();
  let extraction;
  if (mediaType === types.pdf) {
    extraction = await readResumePdf(captured, { signal, document, loadPdf, separateDistantRuns: true });
    if (extraction.unmappedGlyphs || extraction.unresolvedMarkers) fail('PDF text contains unmapped glyphs or unresolved list markers. Inspect the original; no assessment was started.');
  } else if (mediaType === types.docx) {
    const mammoth = await loadDocx();
    signal?.throwIfAborted();
    const result = await (mammoth.default || mammoth).extractRawText({ arrayBuffer: captured.buffer });
    if (result.messages?.length) fail('DOCX extraction needs review: ' + result.messages.map(item => item.message).join('; '));
    extraction = { text: result.value, extractorVersion: 'mammoth-raw-text-v1' };
  } else if (mediaType === types.txt) {
    extraction = { text: new TextDecoder('utf-8', { fatal: true }).decode(captured), extractorVersion: 'utf8-text-v1' };
  } else fail('unsupported file type.');
  signal?.throwIfAborted();
  if (!extraction.text?.trim()) fail('no readable text was recovered. OCR is not connected.');
  if (extraction.text.includes('\u0000') || extraction.text.includes('\ufffd')) fail('text contains unresolved characters. Correct the source encoding before assessment.');
  if (extraction.text.length > 60000) fail('extracted text exceeds the assessment limit. Nothing was truncated.');
  return extraction;
}

// Reconstruct in the receiving realm; never accept another bundle's snapshot brand.
export function captureAssessmentInput(input) {
  const { kind, bytes, mediaType, extraction, target, document, version, source, entry } = structuredClone(input);
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 20 * 1024 * 1024) fail('choose a nonempty file no larger than 20 MB.');
  if (!extraction || typeof extraction.extractorVersion !== 'string' || !extraction.text?.trim()) fail('an actual-byte extraction is required.');
  if (extraction.extractorVersion.endsWith('-pdf-evidence-map-v1') && extraction.evidenceMapVersion !== 'pdf-evidence-map-v1') fail('mapped PDF extraction cannot discard its provenance method.');
  if (kind !== 'upload' && (!document || !Number.isInteger(version) || version < 1 || target !== undefined)) fail('a saved document and version are required for this artifact.');
  let expectedSha256, rendererVersion;
  if (kind === 'upload') {
    if (document !== undefined || version !== undefined || source !== undefined || entry !== undefined) fail('upload intake must not inherit an editable document.');
  } else if (kind === 'source') {
    if (entry !== undefined) fail('an original cannot inherit export metadata.');
    if (!source || !document?.sourceIds?.includes(source.id) || source.id !== source.sha256) fail('select an attached original with a recorded content hash.');
    if (mediaType !== assessmentFileType(source)) fail('original file type changed.');
    expectedSha256 = source.sha256;
  } else if (kind === 'export') {
    if (source !== undefined) fail('an export cannot inherit original metadata.');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(entry?.id || '') || !Number.isInteger(entry.pages) || entry.pages < 1 || mediaType !== types.pdf || entry.signature !== resumeSignature(document) ||
        entry.renderVersion !== RESUME_RENDER_VERSION || !Number.isInteger(entry.version) || entry.version < 1 || entry.version > version ||
        entry.verification?.complete !== true || entry.layoutBoundsVerified !== true || entry.bytes !== bytes?.length) fail('a checked export matching the current saved document and renderer is required.');
    if (!Array.isArray(extraction.pages) || !Array.isArray(extraction.links)) fail('checked PDF geometry and links must be read from its actual bytes.');
    verifyResumePdf(document, extraction.pages, extraction.links, entry.pages);
    const textCheck = validatePdfText(document, extraction.text);
    if (!textCheck.complete) fail('recovered PDF evidence is missing authored text: ' + textCheck.missing.slice(0, 2).map(field => field.label).join(', ') + '. No assessment was started.');
    expectedSha256 = entry.sha256; rendererVersion = entry.renderVersion;
  } else fail('unknown artifact origin.');
  if (kind !== 'upload' && !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) fail('the artifact content hash is missing.');
  return createAssessmentSnapshot({ ...(kind === 'upload' ? {} : { document, documentVersion: version }),
    target: kind === 'upload' ? target : document.target,
    artifact: { bytes, mediaType, text: extraction.text, pages: extraction.pages, extractorVersion: extraction.extractorVersion, rendererVersion, expectedSha256, semanticReview: SEMANTIC_REVIEW,
      ...(mediaType === types.pdf ? { inspectReadingOrder: 'pdf-order-probes-v1' } : {}),
      ...(extraction.evidenceMapVersion !== undefined ? { bindPdfEvidence: extraction.evidenceMapVersion } : {}),
      ...(kind === 'export' ? { inspectStructure: 'authored-pdf-order-v1' } : {}) } });
}
