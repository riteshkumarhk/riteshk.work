import { resumeSignature } from './resume-workspace.mjs';
import { atsParseLayout } from './ats-core.js';
import { inspectAuthoredPdf, inspectPdfReadingOrder } from './resume-pdf-structure.mjs';
import { mapResumePdfEvidence } from './resume-pdf.mjs';
import { SEMANTIC_REVIEW } from './resume-assessment-semantics.mjs';

export const ASSESSMENT_SCHEMA_VERSION = 1;
export const ASSESSMENT_LIMITS = Object.freeze({ jd: 20000, evidence: 60000, segments: 300, requirements: 60, atoms: 120, pages: 50, items: 50000 });
export const ASSESSMENT_EVIDENCE_STATES = Object.freeze(['not-evidenced', 'mentioned', 'partially-supported', 'supported', 'contradicted', 'unknown', 'conflicting-evidence']);
const states = ASSESSMENT_EVIDENCE_STATES;
const communicationIds = ['scope', 'outcomes', 'clarity'];
const snapshots = new WeakSet();
const fail = message => { throw new Error('Candidate assessment: ' + message); };
const clone = value => structuredClone(value);
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('invalid object fields.');
}
function text(value, limit = 4000, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > limit) fail('invalid or oversized text; no input was truncated.');
}
function list(value, limit) { if (!Array.isArray(value) || value.length > limit) fail('invalid or oversized list; no input was dropped.'); }
function integer(value, min, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid integer.'); }
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('invalid identity.'); }
function unique(values) { if (new Set(values).size !== values.length) fail('duplicate identity or source span.'); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function jsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (!value || typeof value !== 'object' || ancestors.has(value) || ancestors.size > 30) fail('record must contain finite, acyclic JSON values.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('record must contain plain JSON objects.');
  if (Object.getOwnPropertySymbols(value).length || (Array.isArray(value) && Object.keys(value).length !== value.length)) fail('record must contain plain JSON arrays and fields.');
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) jsonValue(child, ancestors);
  ancestors.delete(value);
}
export function validateAssessmentJson(value) { jsonValue(value); return value; }
function trustedSnapshot(snapshot) {
  if (!snapshots.has(snapshot)) fail('input snapshot changed or was not captured from original bytes; rebuild it before validation.');
}
function canonical(value) {
  return JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
const equal = (first, second) => canonical(first) === canonical(second);
async function digest(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function segments(value, prefix) {
  return [...value.matchAll(/[^\r\n]+/g)].filter(match => match[0].trim()).map((match, index) => {
    const start = match.index + match[0].length - match[0].trimStart().length;
    const end = match.index + match[0].trimEnd().length;
    return { id: prefix + index, start, end, text: value.slice(start, end) };
  });
}
function targetSnapshot(target) {
  shape(target, ['company', 'role', 'level', 'jd'], ['mode', 'url']);
  for (const key of ['company', 'role', 'level']) text(target[key], 1000, true);
  text(target.jd, ASSESSMENT_LIMITS.jd, true);
  const mode = target.mode ?? (target.jd.trim() ? 'job' : 'general'), url = target.url ?? '';
  text(url, 4000, true);
  if (!['job', 'general'].includes(mode) || !['senior', 'staff', 'leader'].includes(target.level)) fail('unsupported assessment target.');
  if (mode === 'job' && !target.jd.trim()) fail('a job-specific check needs the job description; it cannot become a general review.');
  if (mode === 'general' && target.jd.trim()) fail('choose job mode to assess the supplied job description.');
  return { company: target.company, role: target.role, level: target.level, jd: target.jd, mode, url };
}
function validatePages(pages) {
  if (pages === null) return;
  list(pages, ASSESSMENT_LIMITS.pages);
  let count = 0;
  for (const page of pages) {
    shape(page, ['width', 'height', 'items']);
    if (![page.width, page.height].every(value => Number.isFinite(value) && value > 0)) fail('invalid page dimensions.');
    list(page.items, ASSESSMENT_LIMITS.items); count += page.items.length;
    if (count > ASSESSMENT_LIMITS.items) fail('too many positional items.');
    for (const item of page.items) {
      shape(item, ['str', 'x', 'y', 'w', 'h'], ['rotation', 'direction', 'hasEOL']); text(item.str, ASSESSMENT_LIMITS.evidence, true);
      if (!['x', 'y', 'w', 'h'].every(key => Number.isFinite(item[key])) || item.w < 0 || item.h < 0) fail('invalid positional item.');
      if (item.rotation !== undefined && (!Number.isFinite(item.rotation) || Math.abs(item.rotation) > 180)) fail('invalid text rotation.');
      if (item.direction !== undefined && !['ltr', 'rtl', 'ttb', 'unknown'].includes(item.direction)) fail('invalid text direction.');
      if (Object.hasOwn(item, 'hasEOL') && typeof item.hasEOL !== 'boolean') fail('invalid PDF line boundary.');
    }
  }
}

export async function createAssessmentSnapshot(input) {
  shape(input, ['artifact', 'target'], ['document', 'documentVersion']);
  const { artifact, document = null, documentVersion = null } = input;
  shape(artifact, ['bytes', 'mediaType', 'text', 'extractorVersion'], ['pages', 'rendererVersion', 'expectedSha256', 'inspectStructure', 'inspectReadingOrder', 'bindPdfEvidence', 'semanticReview']);
  if (artifact.semanticReview !== undefined && artifact.semanticReview !== SEMANTIC_REVIEW) fail('unsupported semantic review contract.');
  if (!(artifact.bytes instanceof Uint8Array) || !artifact.bytes.length) fail('original artifact bytes are required.');
  const bytes = new Uint8Array(artifact.bytes);
  if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(artifact.mediaType)) fail('unsupported artifact format.');
  text(artifact.text, ASSESSMENT_LIMITS.evidence, true); text(artifact.extractorVersion, 160);
  const pages = clone(artifact.pages ?? null), rendererVersion = artifact.rendererVersion ?? null;
  if (rendererVersion !== null) integer(rendererVersion, 1);
  if (artifact.mediaType !== 'application/pdf' && pages !== null) fail('PDF positions cannot describe a different format.');
  validatePages(pages);
  if (artifact.inspectStructure !== undefined && (artifact.inspectStructure !== 'authored-pdf-order-v1' || !document || rendererVersion === null || artifact.mediaType !== 'application/pdf' || pages === null)) fail('authored structure inspection requires a bound rendered PDF and positional extraction.');
  if (artifact.inspectReadingOrder !== undefined && (artifact.inspectReadingOrder !== 'pdf-order-probes-v1' || artifact.mediaType !== 'application/pdf' || pages === null)) fail('reading-order inspection requires PDF positional extraction and a supported method.');
  if (artifact.bindPdfEvidence !== undefined && (artifact.bindPdfEvidence !== 'pdf-evidence-map-v1' || artifact.mediaType !== 'application/pdf' || !pages?.length ||
      pages.some(page => page.items.some(item => typeof item.hasEOL !== 'boolean')))) fail('PDF evidence binding requires positional extraction with line boundaries and a supported method.');
  const target = targetSnapshot(input.target);
  if (documentVersion !== null) integer(documentVersion, 1);
  if (!document && documentVersion !== null) fail('document version requires a document.');
  if (document) {
    id(document.id);
    if (!equal(target, targetSnapshot({ company: document.target.company, role: document.target.role, level: document.target.level,
      jd: document.target.jd, ...(document.target.mode ? { mode: document.target.mode } : {}), ...(document.target.url ? { url: document.target.url } : {}) }))) fail('document and assessment targets differ.');
  }
  const jobSegments = segments(target.jd, 'jd-');
  list(jobSegments, ASSESSMENT_LIMITS.segments);
  const evidence = segments(artifact.text, 'artifact-').map(segment => ({ ...segment, source: 'submitted-artifact' }));
  if (JSON.stringify(evidence).length > ASSESSMENT_LIMITS.evidence) fail('complete evidence exceeds the review budget; split explicitly.');
  const extracted = { mediaType: artifact.mediaType, text: artifact.text, extractorVersion: artifact.extractorVersion, pages, rendererVersion };
  if (artifact.semanticReview) extracted.semanticReview = artifact.semanticReview;
  if (artifact.bindPdfEvidence) {
    const mapped = mapResumePdfEvidence(pages, artifact.inspectStructure ? document : null);
    if (mapped.unmappedGlyphs || mapped.unresolvedMarkers || mapped.text !== artifact.text) fail('PDF evidence text does not match its positional extraction; no guessed source matches are allowed.');
    for (const excerpt of evidence) excerpt.pdfSpans = mapped.spans.filter(span => span.start < excerpt.end && span.end > excerpt.start).map(span => ({
      page: span.page, item: span.item, start: span.sourceStart + Math.max(0, excerpt.start - span.start),
      end: span.sourceEnd - Math.max(0, span.end - excerpt.end),
    }));
    if (evidence.some(excerpt => !excerpt.pdfSpans.length)) fail('a PDF evidence excerpt has no positional source.');
    extracted.evidenceMap = { version: artifact.bindPdfEvidence, excerptCount: evidence.length, spanCount: evidence.reduce((sum, excerpt) => sum + excerpt.pdfSpans.length, 0) };
  }
  if (artifact.inspectStructure) extracted.structure = inspectAuthoredPdf(document, pages);
  if (artifact.inspectReadingOrder) extracted.readingOrder = inspectPdfReadingOrder(pages);
  // Capture all caller-owned data before hashing yields to another edit.
  const binding = { documentId: document?.id ?? null, documentVersion, documentSignature: document ? resumeSignature(document) : null,
    artifactSha256: '', artifactBytes: bytes.length, extractionSha256: '', targetSha256: '', schemaVersion: ASSESSMENT_SCHEMA_VERSION };
  const expectedSha256 = artifact.expectedSha256;
  binding.artifactSha256 = await digest(bytes);
  if (expectedSha256 !== undefined && expectedSha256 !== binding.artifactSha256) fail('artifact bytes do not match the expected hash.');
  binding.extractionSha256 = await digest(extracted);
  binding.targetSha256 = await digest(target);
  const snapshot = freeze({ binding, fingerprint: await digest(binding), target, artifact: extracted, jobSegments, evidence });
  snapshots.add(snapshot);
  return snapshot;
}

export function assertAssessmentCurrent(snapshot, current) {
  trustedSnapshot(snapshot); trustedSnapshot(current);
  if (!equal(snapshot.binding, current.binding)) fail('resume, target, evidence or artifact changed; discard the stale assessment.');
}

function atoms(condition) { return condition.kind === 'atom' ? [condition] : condition.children.flatMap(atoms); }
export function validateAssessmentManifest(input, snapshot) {
  trustedSnapshot(snapshot);
  shape(input, ['revision', 'segments', 'requirements']);
  integer(input.revision, 1); list(input.segments, ASSESSMENT_LIMITS.segments); list(input.requirements, ASSESSMENT_LIMITS.requirements);
  if (input.segments.length !== snapshot.jobSegments.length) fail('every JD segment needs a disposition.');
  for (const segment of input.segments) {
    shape(segment, ['id', 'disposition', 'reason']); text(segment.reason);
    if (!snapshot.jobSegments.some(original => original.id === segment.id) || !['criteria', 'context', 'benefits', 'eligibility', 'unsafe-instruction'].includes(segment.disposition)) fail('unknown JD segment or disposition.');
  }
  unique(input.segments.map(segment => segment.id));
  const allAtoms = [];
  function condition(node, depth = 0) {
    if (depth > 4) fail('compound requirement is too deep.');
    if (node?.kind === 'atom') {
      shape(node, ['kind', 'id', 'segmentId', 'start', 'end', 'quote']); id(node.id); text(node.quote);
      integer(node.start, 0); integer(node.end, node.start + 1, snapshot.target.jd.length);
      const segment = snapshot.jobSegments.find(segment => segment.id === node.segmentId);
      if (!segment || node.start < segment.start || node.end > segment.end || snapshot.target.jd.slice(node.start, node.end) !== node.quote ||
          input.segments.find(segment => segment.id === node.segmentId)?.disposition !== 'criteria') fail('requirement needs an exact criterion source span.');
      allAtoms.push(node);
      if (allAtoms.length > ASSESSMENT_LIMITS.atoms) fail('too many atomic conditions; no criteria were dropped.');
    } else {
      shape(node, ['kind', 'children']);
      if (!['allOf', 'anyOf'].includes(node.kind)) fail('unknown compound requirement.');
      list(node.children, ASSESSMENT_LIMITS.atoms);
      if (node.children.length < 2) fail('compound requirements need at least two conditions.');
      node.children.forEach(child => condition(child, depth + 1));
    }
  }
  for (const requirement of input.requirements) {
    shape(requirement, ['id', 'label', 'importance', 'condition']); id(requirement.id); text(requirement.label, 240);
    if (!['required', 'responsibility', 'preferred'].includes(requirement.importance)) fail('invalid requirement importance.');
    condition(requirement.condition);
  }
  unique(input.requirements.map(requirement => requirement.id)); unique(allAtoms.map(atom => atom.id));
  unique(allAtoms.map(atom => atom.start + ':' + atom.end));
  for (const segment of input.segments) if (segment.disposition === 'criteria' && !allAtoms.some(atom => atom.segmentId === segment.id)) fail('criteria segment has no requirement.');
  return freeze(clone(input));
}

function validateCitations(value, snapshot) {
  list(value, 8); unique(value);
  if (value.some(reference => !snapshot.evidence.some(evidence => evidence.id === reference))) fail('unknown submitted-artifact evidence reference.');
}
function validateRatings(value, manifest, snapshot) {
  if (value === null) return null;
  const expected = manifest.requirements.flatMap(requirement => atoms(requirement.condition));
  list(value, ASSESSMENT_LIMITS.atoms);
  if (value.length !== expected.length) fail('every atomic condition needs exactly one judgment.');
  for (const rating of value) {
    shape(rating, ['id', 'state', 'reason', 'evidence']); text(rating.reason); validateCitations(rating.evidence, snapshot);
    if (!expected.some(atom => atom.id === rating.id) || !states.includes(rating.state)) fail('unknown condition or judgment state.');
    if (!['unknown', 'not-evidenced'].includes(rating.state) && !rating.evidence.length) fail('this judgment needs evidence.');
    if (rating.state === 'not-evidenced' && rating.evidence.length) fail('not-evidenced cannot cite supporting evidence.');
    if (rating.state === 'not-evidenced' && !snapshot.artifact.text.trim()) fail('empty extraction cannot establish that a requirement is not evidenced.');
    if (rating.state === 'conflicting-evidence' && rating.evidence.length < 2) fail('conflicting evidence needs both sources.');
  }
  unique(value.map(rating => rating.id));
  return clone(value);
}
function combinedState(condition, ratings) {
  if (condition.kind === 'atom') return ratings.find(rating => rating.id === condition.id).state;
  const children = condition.children.map(child => combinedState(child, ratings));
  if (condition.kind === 'anyOf' && children.includes('supported')) return 'supported';
  if (children.every(state => state === 'supported')) return 'supported';
  if (condition.kind === 'allOf' && children.includes('contradicted')) return 'contradicted';
  if (children.includes('conflicting-evidence')) return 'conflicting-evidence';
  if (children.includes('unknown')) return 'unknown';
  if (children.every(state => state === 'contradicted')) return 'contradicted';
  if (children.some(state => ['supported', 'partially-supported'].includes(state))) return 'partially-supported';
  if (children.includes('mentioned')) return 'mentioned';
  return 'not-evidenced';
}
function artifactDimension(snapshot) {
  const { text: extractedText, pages, mediaType } = snapshot.artifact;
  const pdf = mediaType === 'application/pdf', items = pages?.flatMap(page => page.items).filter(item => item.str.trim()) ?? [];
  const observation = (id, status, reason) => ({ id, status, reason });
  const outOfBounds = pages?.some(page => page.items.some(item => item.str.trim() && (item.x < -2 || item.x + item.w > page.width + 2 || item.y - item.h < -2 || item.y > page.height + 2)));
  const observations = [
    observation('recovered-text', extractedText.trim() ? 'pass' : 'fail', extractedText.trim() ? 'Text was supplied by the named extractor; its accuracy is not independently verified.' : 'No readable text was recovered.'),
    observation('positions', !pdf ? 'not-applicable' : pages === null ? 'unknown' : items.length ? 'pass' : 'fail',
      !pdf ? 'PDF geometry does not apply to this format.' : pages === null ? 'No positional extraction was supplied.' : items.length ? 'Positional text was recovered.' : 'No positional text was recovered; parse success cannot be established.'),
    observation('physical-bounds', !pdf ? 'not-applicable' : !items.length ? 'unknown' : outOfBounds ? 'fail' : 'pass',
      outOfBounds ? 'Text extends beyond a physical page boundary.' : 'This checks supplied text bounds, not glyph clipping or employer parsing.'),
    observation('field-association', 'unknown', 'Role, employer, date and achievement association has not been independently checked.'),
    observation('reading-order', 'unknown', 'Text presence alone does not establish correct reading order.')
  ];
  if (items.length) {
    const layout = atsParseLayout(pages);
    if (layout.columns > 1) observations.push(observation('column-risk', 'warn', 'A whitespace channel suggests columns. Compare extracted associations; this is not a universal ATS failure.'));
    if (layout.headerFooterRisk) observations.push(observation('contact-region', 'warn', 'Contact text is near a page edge. Check field extraction; placement alone does not establish loss.'));
  }
  const structure = snapshot.artifact.structure;
  if (structure) observations.push(observation('authored-structure-agreement', structure.status === 'mismatch' ? 'fail' : structure.status === 'consistent' ? 'pass' : 'unknown',
    structure.reason + ' This is a comparison with authored fields, not independent employer parsing or semantic verification.'));
  const readingOrder = snapshot.artifact.readingOrder;
  if (readingOrder) observations.push(observation('pdf-order-probes', readingOrder.status === 'ambiguous' ? 'warn' : 'unknown',
    readingOrder.status + ': ' + readingOrder.reason));
  const evidenceMap = snapshot.artifact.evidenceMap;
  if (evidenceMap) observations.push(observation('pdf-evidence-provenance', 'pass',
    'Excerpt locations were reconstructed from PDF text items and line boundaries, including repeated text. This establishes source locations, not semantic attribution or factual truth.'));
  return { status: observations.some(item => item.status === 'fail') ? 'blocked' : 'partial', observations, pageCount: pages?.length ?? null, itemCount: pdf && pages !== null ? items.length : null,
    ...(structure ? { structure } : {}), ...(readingOrder ? { readingOrder } : {}), ...(evidenceMap ? { evidenceMap } : {}) };
}
function communicationDimension(input, snapshot) {
  if (input === null) return { status: 'not-assessed', ratings: null, verification: 'not-performed' };
  list(input, 3);
  if (input.length !== 3) fail('all three communication criteria need a judgment.');
  for (const rating of input) {
    shape(rating, ['id', 'rating', 'reason', 'evidence']); text(rating.reason); validateCitations(rating.evidence, snapshot);
    if (!communicationIds.includes(rating.id)) fail('unknown communication criterion.');
    if (rating.rating !== null) { integer(rating.rating, 0, 4); if (!rating.evidence.length) fail('communication judgments need evidence.'); }
  }
  unique(input.map(rating => rating.id));
  return { status: 'partial', ratings: clone(input), verification: 'reference-checked-only' };
}
const method = Object.freeze({ id: 'unified-resume-candidate', version: 1, stage: 'contract-foundation', scoringPolicy: null });

export async function createCandidateAssessment(snapshot, input = {}) {
  trustedSnapshot(snapshot);
  shape(input, [], ['id', 'createdAt', 'manifest', 'ratings', 'communication']);
  const assessmentId = Object.hasOwn(input, 'id') ? input.id : crypto.randomUUID(), createdAt = Object.hasOwn(input, 'createdAt') ? input.createdAt : Date.now();
  id(assessmentId); integer(createdAt, 0);
  const manifest = input.manifest === undefined || input.manifest === null ? null : validateAssessmentManifest(input.manifest, snapshot);
  if (!manifest && input.ratings != null) fail('judgments require a bound requirements inventory.');
  const ratings = manifest ? validateRatings(input.ratings ?? null, manifest, snapshot) : null;
  const requirements = manifest?.requirements.map(requirement => ({ id: requirement.id, importance: requirement.importance,
    state: ratings === null ? 'not-assessed' : combinedState(requirement.condition, ratings) })) ?? [];
  const roleEvidence = { status: snapshot.target.mode === 'general' ? 'not-applicable' : 'partial', ratings, requirements,
    requiredGaps: requirements.filter(requirement => requirement.importance === 'required' && requirement.state !== 'supported').map(requirement => requirement.id),
    verification: ratings === null ? 'not-performed' : 'reference-checked-only' };
  const artifact = artifactDimension(snapshot), communication = communicationDimension(input.communication ?? null, snapshot);
  const record = { schemaVersion: ASSESSMENT_SCHEMA_VERSION, id: assessmentId, createdAt, status: artifact.status === 'blocked' ? 'blocked' : 'partial',
    binding: { ...snapshot.binding, manifestSha256: manifest ? await digest(manifest) : null }, target: clone(snapshot.target), method: clone(method), execution: [],
    coverage: { inputCharacters: snapshot.artifact.text.length, jdCharacters: snapshot.target.jd.length, totalSegments: snapshot.jobSegments.length,
      accountedSegments: manifest?.segments.length ?? 0, inventoryVerification: manifest ? 'structural-only' : 'not-performed',
      totalRequirements: manifest?.requirements.length ?? null, assessedRequirements: requirements.filter(requirement => !['not-assessed', 'unknown', 'conflicting-evidence'].includes(requirement.state)).length,
      unresolvedRequirements: requirements.filter(requirement => ['not-assessed', 'unknown', 'conflicting-evidence'].includes(requirement.state)).length,
      submittedExcerpts: snapshot.evidence.length },
    requirements: manifest, evidence: clone(snapshot.evidence), dimensions: { artifact, roleEvidence, communication }, findings: [],
    headline: { value: null, policyId: null, contributions: [], unavailableReason: 'No validated scoring policy; evidence relevance and extraction associations are not independently verified.' },
    limitations: ['This foundation record alone does not attest AI execution. Any evaluator execution requires its separately validated run receipt. No claim-safe revision or vendor parser is attested.',
      'Exact citations establish provenance, not semantic correctness. Compound results are conditional on the supplied atomic judgments.',
      'Original extraction accuracy, field association, intended links and supported language/role quality remain unverified.',
      'No findings have been generated; an empty list is not a clean bill of health.'] };
  return freeze(record);
}

export async function validateCandidateAssessment(record, snapshot) {
  trustedSnapshot(snapshot); jsonValue(record);
  shape(record, ['schemaVersion', 'id', 'createdAt', 'status', 'binding', 'target', 'method', 'execution', 'coverage', 'requirements', 'evidence', 'dimensions', 'findings', 'headline', 'limitations']);
  shape(record.dimensions, ['artifact', 'roleEvidence', 'communication']);
  shape(record.dimensions.roleEvidence, ['status', 'ratings', 'requirements', 'requiredGaps', 'verification']);
  shape(record.dimensions.communication, ['status', 'ratings', 'verification']);
  const expected = await createCandidateAssessment(snapshot, { id: record.id, createdAt: record.createdAt, manifest: record.requirements,
    ratings: record.dimensions.roleEvidence.ratings, communication: record.dimensions.communication.ratings });
  if (!equal(record, expected)) fail('record does not match its bound inputs or derived facts.');
  return expected;
}
