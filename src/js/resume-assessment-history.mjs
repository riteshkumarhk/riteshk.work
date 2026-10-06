import { captureAssessmentInput } from './resume-assessment-input.mjs';
import { validateAssessmentJson } from './resume-assessment.mjs';
import { validateEvaluatedAssessment, validateAssessmentInventory } from './resume-assessment-evaluator.mjs';
import { validateAssessmentPlan } from './resume-assessment-pilot.mjs';
import { RESUME_COMPLETION_LIMITS } from './resume-review.mjs';
import { validateAssessmentRequestPolicy } from './resume-assessment-request-policy.mjs';
import { validateAssessmentOutputContract } from './resume-assessment-output.mjs';
import { validateAssessmentRevision } from './resume-assessment-revisions.mjs';
import { validateAssessmentComparison } from './resume-assessment-comparison.mjs';

export const ASSESSMENT_HISTORY_VERSION = 1;
export const canonicalHistory = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export async function historyHash(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(canonicalHistory(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function historyInput(input) {
  return structuredClone(Object.fromEntries(['kind', 'mediaType', 'extraction', 'target', 'document', 'version', 'source', 'entry']
    .filter(key => input[key] !== undefined).map(key => [key, input[key]])));
}
function diagnostic(failure, fingerprint) {
  const exact = (value, keys) => value && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const text = (value, maximum) => typeof value === 'string' && value.trim() && value.length <= maximum;
  const attempt = failure.attempt;
  if (!exact(failure, ['at', 'snapshotFingerprint', 'message', 'attempt']) || failure.snapshotFingerprint !== fingerprint ||
      !text(failure.message, 4000) || !Number.isSafeInteger(failure.at) || failure.at < 0 ||
      !exact(attempt, ['status', 'execution', 'reservations']) || !['failed', 'cancelled'].includes(attempt.status) ||
      !Array.isArray(attempt.execution) || attempt.execution.length > 2 || !Array.isArray(attempt.reservations) || attempt.reservations.length > 1) throw new Error('Invalid bound client failure diagnostic.');
  for (const { status, ...plan } of attempt.reservations) {
    validateAssessmentPlan(plan);
    if (!['pending', 'reserved'].includes(status)) throw new Error('Invalid failure reservation status.');
  }
  const plan = attempt.reservations[0];
  for (const [index, entry] of attempt.execution.entries()) {
    if (!exact(entry, ['stage', 'status', 'provider', 'model', 'requestSha256', 'requestId', 'usage', ...(Object.hasOwn(entry, 'requestPolicy') ? ['requestPolicy'] : []),
      ...(Object.hasOwn(entry, 'responseContract') ? ['responseContract'] : [])]) ||
        plan?.status !== 'reserved' || entry.stage !== plan.stages[index]?.stage || entry.provider !== plan.provider || entry.model !== plan.model ||
        !['started', 'received', 'parsed', 'failed', 'cancelled-outcome-unknown'].includes(entry.status) ||
        !/^[a-f0-9]{64}$/.test(entry.requestSha256) || !(entry.requestId === null || text(entry.requestId, 200)) ||
        ['received', 'parsed'].includes(entry.status) && entry.requestId === null) throw new Error('Invalid client failure execution.');
    if (Object.hasOwn(entry, 'requestPolicy')) validateAssessmentRequestPolicy(entry.requestPolicy, entry.provider, entry.model);
    if (Object.hasOwn(entry, 'responseContract')) validateAssessmentOutputContract(entry.responseContract, entry.provider, entry.model);
    if (entry.responseContract !== attempt.execution[0].responseContract) throw new Error('Failure output contract changed within the phase.');
    if (entry.usage !== null && (!exact(entry.usage, ['inputTokens', 'outputTokens']) ||
        !Number.isSafeInteger(entry.usage.inputTokens) || entry.usage.inputTokens < 0 || entry.usage.inputTokens > 110000 ||
        !Number.isSafeInteger(entry.usage.outputTokens) || entry.usage.outputTokens < 0 || entry.usage.outputTokens > RESUME_COMPLETION_LIMITS[entry.stage])) throw new Error('Invalid client failure usage.');
  }
}
export async function createAssessmentHistory({ input, result, label, revisions = [], inventory = null, failures = [], baselineId = null, comparison = null }) {
  const snapshot = await captureAssessmentInput(input);
  return { version: ASSESSMENT_HISTORY_VERSION, id: result.report.id, label, input: historyInput(input), artifactSha256: snapshot.binding.artifactSha256,
    snapshotFingerprint: snapshot.fingerprint, result: structuredClone(result), revisions: structuredClone(revisions),
    inventory: structuredClone(inventory), failures: structuredClone(failures), baselineId, comparison: structuredClone(comparison) };
}
export async function validateAssessmentHistory(record, bytes, baseline = null) {
  validateAssessmentJson(record); record = structuredClone(record);
  const keys = ['version', 'id', 'label', 'input', 'artifactSha256', 'snapshotFingerprint', 'result', 'revisions', 'inventory', 'failures', 'baselineId', 'comparison'];
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key)) || record.version !== ASSESSMENT_HISTORY_VERSION ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(record.id) || record.result?.report?.id !== record.id || typeof record.label !== 'string' || !record.label.trim() || record.label.length > 200 ||
      !/^[a-f0-9]{64}$/.test(record.artifactSha256) || canonicalHistory(record.input) !== canonicalHistory(historyInput(record.input))) throw new Error('Invalid private assessment history record.');
  const snapshot = await captureAssessmentInput({ ...record.input, bytes });
  if (snapshot.fingerprint !== record.snapshotFingerprint || snapshot.binding.artifactSha256 !== record.artifactSha256) throw new Error('Stored artifact or captured input changed.');
  const result = await validateEvaluatedAssessment(record.result, snapshot);
  if (!Array.isArray(record.revisions) || record.revisions.length > 50 || new Set(record.revisions.map(value => value.id)).size !== record.revisions.length ||
      !Array.isArray(record.failures) || record.failures.length > 100) throw new Error('Invalid or oversized private assessment history.');
  for (const revision of record.revisions) await validateAssessmentRevision(revision, snapshot, result, {
    document: record.input.document, version: record.input.version, findingId: revision.context.findingId,
    fieldId: revision.context.fieldId, authorEvidence: revision.context.authorEvidence
  });
  if (record.inventory !== null) {
    await validateAssessmentInventory(record.inventory, snapshot, record.baselineId);
    if (record.inventory.targetSha256 !== result.approval.targetSha256) throw new Error('Inventory belongs to another target.');
  }
  for (const failure of record.failures) diagnostic(failure, snapshot.fingerprint);
  if (record.baselineId !== null) {
    if (!baseline || record.baselineId !== baseline.result.report.id || record.baselineId === record.id) throw new Error('The saved comparison baseline is missing or incorrect.');
    await validateAssessmentComparison(record.comparison, baseline.result, baseline.snapshot, result, snapshot);
  } else if (record.comparison !== null) throw new Error('A comparison cannot discard its baseline.');
  return { record, snapshot, result };
}
