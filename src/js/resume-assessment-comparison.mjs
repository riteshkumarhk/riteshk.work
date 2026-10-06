import { validateEvaluatedAssessment } from './resume-assessment-evaluator.mjs';
import { validateAssessmentJson } from './resume-assessment.mjs';

export const ASSESSMENT_COMPARISON_VERSION = 1;
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => canonical(a) === canonical(b);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const atoms = node => node.kind === 'atom' ? [node.id] : node.children.flatMap(atoms);
const unique = values => [...new Set(values)];
const method = (result, snapshot) => ({
  evaluator: result.version, assessment: result.report.method, schema: snapshot.binding.schemaVersion,
  mediaType: snapshot.artifact.mediaType, extractor: snapshot.artifact.extractorVersion, renderer: snapshot.artifact.rendererVersion,
  semantics: snapshot.artifact.semanticReview ?? null, provenance: snapshot.artifact.evidenceMap?.version ?? null,
  structure: snapshot.artifact.structure?.version ?? null, order: snapshot.artifact.readingOrder?.version ?? null,
  execution: result.execution.map(item => ({ stage: item.stage, provider: item.provider, model: item.model })),
});
const exclusions = (result, snapshot) => result.selection.excluded.map(item => ({
  ...item, text: snapshot.evidence.find(excerpt => excerpt.id === item.id).text,
})).sort((a, b) => a.id.localeCompare(b.id, 'en'));
function direction(before, after, dimension) {
  if (before === null || after === null || [before, after].some(value => ['unknown', 'conflicting-evidence', 'not-assessed'].includes(value))) return 'unresolved';
  if (before === after) return 'unchanged';
  if (dimension === 'communication') return after > before ? 'improved' : 'worsened';
  const order = dimension === 'artifact' ? ['fail', 'warn', 'pass'] : ['not-evidenced', 'mentioned', 'partially-supported', 'supported'];
  if (order.includes(before) && order.includes(after)) return order.indexOf(after) > order.indexOf(before) ? 'improved' : 'worsened';
  if (dimension === 'role' && before === 'supported' && after === 'contradicted') return 'worsened';
  if (dimension === 'role' && before === 'contradicted' && after === 'supported') return 'improved';
  return 'changed';
}
export async function compareCandidateAssessments(beforeValue, beforeSnapshot, afterValue, afterSnapshot) {
  const [before, after] = await Promise.all([
    validateEvaluatedAssessment(beforeValue, beforeSnapshot), validateEvaluatedAssessment(afterValue, afterSnapshot),
  ]);
  const reasons = [];
  if (!beforeSnapshot.binding.documentId || beforeSnapshot.binding.documentId !== afterSnapshot.binding.documentId) reasons.push('These inputs do not identify the same editable resume.');
  if (beforeSnapshot.artifact.rendererVersion === null || afterSnapshot.artifact.rendererVersion === null) reasons.push('Comparable edits require checked exports, not an unbound original or a different artifact origin.');
  if (beforeSnapshot.binding.targetSha256 !== afterSnapshot.binding.targetSha256) reasons.push('The target job, level, mode or complete job description changed.');
  if (before.approval.manifestSha256 !== after.approval.manifestSha256) reasons.push('The approved inventory changed. Criteria, priorities and compound conditions are not equivalent.');
  if (!same(method(before, beforeSnapshot), method(after, afterSnapshot))) reasons.push('The evaluator, extraction/rendering method, provider or model changed.');
  if ((before.promptRevision ?? 1) !== (after.promptRevision ?? 1)) reasons.push('The semantic prompt revision changed. No comparable improvement is asserted.');
  if ((before.evidencePolicy ?? null) !== (after.evidencePolicy ?? null)) reasons.push('The decision/context evidence policy changed. No comparable improvement is asserted.');
  if (!same(before.execution.map(item => item.responseContract ?? null), after.execution.map(item => item.responseContract ?? null))) reasons.push('The structured response contract changed. No comparable improvement is asserted.');
  if (!same(before.execution.map(item => item.requestPolicy ?? null), after.execution.map(item => item.requestPolicy ?? null))) reasons.push('The recorded provider request policy changed or is unavailable on one side.');
  if (!same(exclusions(before, beforeSnapshot), exclusions(after, afterSnapshot))) reasons.push('The excluded source occurrences changed. Review the input scope; no comparable improvement is asserted.');
  if (before.report.id === after.report.id) reasons.push('This is the same assessment, not a separate recheck.');
  if (after.report.createdAt < before.report.createdAt) reasons.push('The recheck predates the baseline; confirm the selected records and clock.');
  const rows = [];
  const add = (id, label, dimension, first, second) => rows.push({ id, label, dimension, before: first, after: second,
    direction: reasons.length ? 'not-comparable' : direction(first.state, second.state, dimension) });
  const roleValue = (result, id) => {
    const item = result.report.dimensions.roleEvidence.requirements.find(item => item.id === id);
    const requirement = result.approval.manifest.requirements.find(item => item.id === id);
    const ratings = requirement ? result.report.dimensions.roleEvidence.ratings.filter(rating => atoms(requirement.condition).includes(rating.id)) : [];
    return { state: item?.state ?? 'not-assessed', reasons: ratings.map(rating => rating.id + ': ' + rating.reason), evidence: unique(ratings.flatMap(rating => rating.evidence)) };
  };
  for (const id of unique([...before.approval.manifest.requirements, ...after.approval.manifest.requirements].map(item => item.id))) {
    const requirement = after.approval.manifest.requirements.find(item => item.id === id) || before.approval.manifest.requirements.find(item => item.id === id);
    add('role-' + id, requirement.label, 'role', roleValue(before, id), roleValue(after, id));
  }
  for (const id of ['scope', 'outcomes', 'clarity']) {
    const value = result => {
      const item = result.report.dimensions.communication.ratings.find(item => item.id === id);
      return { state: item.rating, reasons: [item.reason], evidence: item.evidence };
    };
    add('communication-' + id, id, 'communication', value(before), value(after));
  }
  const observations = result => result.report.dimensions.artifact.observations;
  for (const id of unique([...observations(before), ...observations(after)].map(item => item.id))) {
    const value = result => {
      const item = observations(result).find(item => item.id === id);
      return { state: item?.status ?? 'not-reported', reasons: [item?.reason ?? 'This observation was not reported; absence is not an automatic pass.'], evidence: [] };
    };
    add('artifact-' + id, id.replaceAll('-', ' '), 'artifact', value(before), value(after));
  }
  return freeze({ version: ASSESSMENT_COMPARISON_VERSION, beforeId: before.report.id, afterId: after.report.id,
    beforeFingerprint: beforeSnapshot.fingerprint, afterFingerprint: afterSnapshot.fingerprint, comparable: reasons.length === 0, reasons,
    artifactChanged: beforeSnapshot.binding.artifactSha256 !== afterSnapshot.binding.artifactSha256,
    textChanged: beforeSnapshot.artifact.text !== afterSnapshot.artifact.text,
    documentChanged: beforeSnapshot.binding.documentSignature !== afterSnapshot.binding.documentSignature,
    versionChanged: beforeSnapshot.binding.documentVersion !== afterSnapshot.binding.documentVersion,
    rows, counts: Object.fromEntries(['improved', 'worsened', 'unchanged', 'unresolved', 'changed', 'not-comparable'].map(key => [key, rows.filter(row => row.direction === key).length])),
    limitations: ['Transitions describe recorded observations and challenged model judgments, not an ATS score, hiring probability or independent truth.',
      'Unknown or conflicting judgments do not become numeric gains. Contradiction versus absence is not forced onto one scale.',
      'Unchanged recovered text can still have layout, extraction or model-judgment differences; a recheck does not establish that an edit caused a change.'] });
}
export async function validateAssessmentComparison(value, before, beforeSnapshot, after, afterSnapshot) {
  validateAssessmentJson(value);
  const captured = structuredClone(value), expected = await compareCandidateAssessments(before, beforeSnapshot, after, afterSnapshot);
  if (!same(captured, expected)) throw new Error('Assessment comparison: the saved comparison was altered or belongs to different inputs.');
  return expected;
}
