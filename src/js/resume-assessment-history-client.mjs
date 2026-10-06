import { createAssessmentHistory, validateAssessmentHistory } from './resume-assessment-history.mjs';
import { captureAssessmentInput } from './resume-assessment-input.mjs';
import { validateEvaluatedAssessment } from './resume-assessment-evaluator.mjs';

export function createAssessmentHistoryClient(request) {
  const read = async (id, signal) => {
    const saved = await request('records/' + encodeURIComponent(id), {}, signal);
    const bytes = await request('artifacts/' + saved.record.artifactSha256, { binary: true }, signal);
    return { ...saved, input: { ...saved.record.input, bytes } };
  };
  return {
    list: (cursor, signal) => request('records' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), {}, signal),
    async read(id, signal) {
      const saved = await read(id, signal);
      const baseline = saved.record.baselineId ? await read(saved.record.baselineId, signal) : null;
      let before = null;
      if (baseline) {
        const snapshot = await captureAssessmentInput(baseline.input);
        before = { snapshot, result: await validateEvaluatedAssessment(baseline.record.result, snapshot) };
      }
      await validateAssessmentHistory(saved.record, saved.input.bytes, before);
      return { ...saved, baseline };
    },
    async save({ confirmed, input, result, label, revisions, inventory, failures, baseline = null, expected = '*' }, signal) {
      if (confirmed !== true) throw new Error('Explicit consent to retain the original file and complete private history is required.');
      input = structuredClone(input);
      baseline = baseline && structuredClone(baseline);
      const record = await createAssessmentHistory({ input, result, label, revisions, inventory, failures,
        baselineId: baseline?.result.report.id ?? null, comparison: baseline?.comparison ?? null });
      const before = baseline ? { snapshot: await captureAssessmentInput(baseline.input), result: baseline.result } : null;
      await validateAssessmentHistory(record, input.bytes, before);
      await request('artifacts/' + record.artifactSha256, { method: 'PUT', body: input.bytes,
        headers: { 'Content-Type': record.input.mediaType, 'X-Assessment-Retention': 'confirmed' } }, signal);
      try {
        return await request('records/' + record.id, { method: 'PUT', body: JSON.stringify(record),
          headers: { 'Content-Type': 'application/json', 'X-Assessment-Retention': 'confirmed', 'If-Match': expected } }, signal);
      } catch (cause) {
        throw new Error('Private history was not acknowledged. The original file may already be retained; retry does not duplicate it. ' + cause.message, { cause });
      }
    }
  };
}
