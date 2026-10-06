import { assertAssessmentCurrent, createAssessmentSnapshot, validateAssessmentJson } from './resume-assessment.mjs';
import { awaitAssessment, inventoryCandidateAssessment, approveAssessmentInventory, approveAssessmentEvidence, evaluateCandidateAssessment, validateEvaluatedAssessment } from './resume-assessment-evaluator.mjs';
import { RESUME_COMPLETION_LIMITS, resumeCompletionReservation } from './resume-review.mjs';
import { proposeAssessmentRevision, validateAssessmentRevision } from './resume-assessment-revisions.mjs';
import { compareCandidateAssessments, validateAssessmentComparison } from './resume-assessment-comparison.mjs';
import { ASSESSMENT_EVIDENCE_POLICY } from './resume-assessment-output.mjs';

const fail = message => { throw new Error('Assessment pilot: ' + message); };
const copy = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const text = value => typeof value === 'string' && value.trim() && value.length <= 200;
export function captureAssessmentSource(input) {
  const { document, version, source, bytes } = copy(input);
  if (!source || !document?.sourceIds?.includes(source.id) || source.sha256 !== source.id) fail('select an attached original with a recorded content hash.');
  return createAssessmentSnapshot({ document, documentVersion: version, target: document.target,
    artifact: { bytes, mediaType: source.type, text: source.text, extractorVersion: source.extractorVersion || 'stored-source-text-unverified-v1', expectedSha256: source.sha256 } });
}
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('invalid saved budget fields.');
}
function money(value) {
  const units = Math.round(value * 1e6);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(units) || units / 1e6 !== value) fail('a positive budget in whole millionths of a dollar is required.');
  return units;
}

export function assessmentProviderReceipt(provider, payload, response) {
  if (!['openai', 'anthropic'].includes(provider) || !payload || typeof payload !== 'object') fail('unreadable provider receipt.');
  if (!text(payload.model) || !text(payload.id)) fail('the provider did not identify its actual model and response.');
  let answer, input, output;
  const tokens = value => {
    if (!Number.isSafeInteger(value) || value < 0) fail('invalid provider token usage.');
    return value;
  };
  if (provider === 'anthropic') {
    if (payload.type !== 'message' || payload.role !== 'assistant' || payload.stop_reason !== 'end_turn' ||
        !Array.isArray(payload.content) || payload.content.some(block => !['text', 'thinking', 'redacted_thinking'].includes(block?.type))) fail('the provider did not finish a text answer.');
    answer = payload.content.filter(block => block.type === 'text').map(block => {
      if (typeof block.text !== 'string') fail('invalid provider answer text.');
      return block.text;
    }).join('');
    if (payload.usage != null) {
      input = tokens(payload.usage.input_tokens) +
        tokens(payload.usage.cache_read_input_tokens === undefined ? 0 : payload.usage.cache_read_input_tokens) +
        tokens(payload.usage.cache_creation_input_tokens === undefined ? 0 : payload.usage.cache_creation_input_tokens);
      output = tokens(payload.usage.output_tokens);
    }
  } else {
    const choice = payload.choices?.[0];
    if (payload.choices?.length !== 1 || choice?.finish_reason !== 'stop' || choice.message?.role !== 'assistant' ||
        choice.message.refusal || choice.message.tool_calls?.length || choice.message.function_call) fail('the provider did not finish a text answer.');
    answer = choice.message.content;
    if (payload.usage != null) { input = tokens(payload.usage.prompt_tokens); output = tokens(payload.usage.completion_tokens); }
  }
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 60000) fail('empty or oversized provider answer.');
  if (input !== undefined && (!Number.isSafeInteger(input) || input > 110000)) fail('provider input exceeded the reserved bounds.');
  const requestId = response.headers.get('request-id') || response.headers.get('x-request-id') || payload.id;
  if (!text(requestId)) fail('invalid provider request identity.');
  return { text: answer, provider, model: payload.model, requestId, usage: input === undefined ? null : { inputTokens: input, outputTokens: output } };
}

export function validateAssessmentPlan(plan) {
  fields(plan, ['id', 'provider', 'model', 'pricing', 'stages', 'amount', 'at']);
  if (!text(plan.id) || !text(plan.model) || !['openai', 'anthropic'].includes(plan.provider) || !Array.isArray(plan.stages) ||
      !['requirements', 'assessment,challenge', 'revision,challenge'].includes(plan.stages.map(item => item?.stage).join(','))) fail('invalid saved phase reservation.');
  const maximum = plan.stages.reduce((sum, item) => {
    fields(item, ['stage', 'maximumAmount']);
    const expected = resumeCompletionReservation({ stage: item.stage, system: '', user: '', maxTokens: RESUME_COMPLETION_LIMITS[item.stage] }, plan.pricing, plan.at).maximumAmount;
    if (item.maximumAmount !== expected) fail('saved phase reservation changed.');
    return sum + expected;
  }, 0);
  if (money(plan.amount) !== money(Math.ceil(maximum * 1e6) / 1e6)) fail('saved phase total changed.');
}

export async function createAssessmentPilot({ snapshot, getCurrent, provider, model, pricing, invoke, storage, locks, budget, signal, timeoutMs, baseline = null, authority = null, evidencePolicy }) {
  assertAssessmentCurrent(snapshot, snapshot);
  if (baseline) {
    assertAssessmentCurrent(baseline.snapshot, baseline.snapshot);
    if (!text(baseline.id)) fail('a saved baseline identity is required.');
    baseline = { snapshot: baseline.snapshot, id: baseline.id, ...(baseline.result ? { result: copy(baseline.result) } : {}) };
  }
  if (budget?.approved !== true || !['browser-origin', 'server'].includes(budget.scope) || !/^[a-zA-Z0-9_-]{1,80}$/.test(budget.id || '')) fail('explicit pilot budget approval is required.');
  if (budget.scope === 'server' ? budget.id !== 'candidate-review' || ['reserve', 'invoke', 'budget'].some(key => typeof authority?.[key] !== 'function') : authority !== null) fail('a matching server budget authority is required; no local fallback.');
  if (!authority && provider === 'anthropic' && model === 'claude-sonnet-5-5') fail('this model requires the server request policy; the browser-development transport is not compatible.');
  if (typeof getCurrent !== 'function' || !authority && typeof invoke !== 'function' || typeof storage?.getItem !== 'function' ||
      typeof storage?.setItem !== 'function' || typeof locks?.request !== 'function') fail('current inputs, transport, writable storage and Web Locks are required.');
  const maximum = money(budget.maxCost), budgetId = budget.id, maxCost = budget.maxCost, prices = copy(pricing);
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)) fail('invalid operation deadline.');
  if (!['openai', 'anthropic'].includes(provider) || !text(model) || /automatic|auto selection/i.test(model)) fail('lock an actual supported model.');
  resumeCompletionReservation({ stage: 'assessment', system: '', user: '', maxTokens: 12000 }, prices);
  const key = (authority ? 'rk:resume:assessment-server-history:' : 'rk:resume:assessment-pilot:') + budgetId, controller = new AbortController();
  if (baseline && !(authority && baseline.result) && storage.getItem(key) === null) fail('the baseline budget is missing; it cannot be reset for a recheck.');
  const activeSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let busy = false, state = { phase: 'ready', inventory: null, approval: null, selection: null, result: null, error: null };
  const current = async () => {
    const guardSignal = AbortSignal.any([activeSignal, AbortSignal.timeout(timeoutMs ?? 120000)]);
    guardSignal.throwIfAborted();
    const value = await awaitAssessment(getCurrent(), guardSignal);
    guardSignal.throwIfAborted(); assertAssessmentCurrent(snapshot, value); return value;
  };
  const read = () => {
    const raw = storage.getItem(key);
    if (raw === null) fail('the approved budget is missing; no request was sent.');
    const saved = JSON.parse(raw); validateAssessmentJson(saved);
    fields(saved, ['version', 'id', 'maxCost', 'reservations', 'inventories', 'results', 'failures',
      ...['revisions', 'comparisons', 'inventoryReceipts'].filter(key => Object.hasOwn(saved, key))]);
    if (saved.version !== 1 || saved.id !== budgetId || saved.maxCost !== maxCost || !Array.isArray(saved.reservations) ||
        !Array.isArray(saved.inventories) || !Array.isArray(saved.results) || !Array.isArray(saved.failures) ||
        ['revisions', 'comparisons', 'inventoryReceipts'].some(key => Object.hasOwn(saved, key) && !Array.isArray(saved[key]))) fail('the saved budget needs review.');
    saved.reservations.forEach(validateAssessmentPlan);
    if (new Set(saved.reservations.map(plan => plan.id)).size !== saved.reservations.length ||
        saved.reservations.reduce((sum, plan) => sum + money(plan.amount), 0) > maximum) fail('the saved budget is inconsistent.');
    return saved;
  };
  const write = saved => {
    const serialized = JSON.stringify(saved);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) fail('the budget/result was not durably acknowledged.');
  };
  const update = action => locks.request(key, async () => { const saved = read(); const result = await action(saved); write(saved); return result; });
  await current();
  await locks.request(key, () => {
    if (storage.getItem(key) === null) {
      if (baseline && !(authority && baseline.result)) fail('the baseline budget disappeared; no recheck ledger was created.');
      write({ version: 1, id: budgetId, maxCost, reservations: [], inventories: [], results: [], failures: [] });
    }
    read();
  });
  await current();
  let baselineResult = null;
  if (baseline) {
    const saved = authority && baseline.result ? baseline.result : read().results.find(item => item.report?.id === baseline.id);
    if (!saved) fail('the saved baseline assessment was not found in this budget.');
    if (saved.report?.id !== baseline.id) fail('the restored baseline identity changed.');
    baselineResult = await validateEvaluatedAssessment(saved, baseline.snapshot);
    if (!snapshot.binding.documentId || snapshot.binding.documentId !== baseline.snapshot.binding.documentId ||
        snapshot.artifact.rendererVersion === null || baseline.snapshot.artifact.rendererVersion === null) fail('a recheck needs checked exports of the same editable resume.');
    if (snapshot.binding.targetSha256 !== baseline.snapshot.binding.targetSha256) fail('the target changed; start a separate assessment, not a comparable recheck.');
    if (baselineResult.execution.some(entry => entry.provider !== provider || entry.model !== model)) fail('reuse the baseline provider/model for this recheck; a different model needs a separate assessment.');
    await current();
  }
  let activePlan = null;
  if (evidencePolicy === undefined) evidencePolicy = baselineResult?.evidencePolicy ?? null;
  if (evidencePolicy !== null && evidencePolicy !== ASSESSMENT_EVIDENCE_POLICY) fail('unsupported experimental evidence policy.');
  if (baselineResult && evidencePolicy !== (baselineResult.evidencePolicy ?? null)) fail('a recheck cannot change the baseline evidence policy.');
  const structuredModel = authority?.budget().models?.find(item => item.id === model);
  const options = { provider, model, pricing: prices, consent: true, signal: activeSignal, timeoutMs, getCurrent: current, evidencePolicy,
    ...(structuredModel?.structuredOutput === undefined ? {} : { structuredOutput: structuredModel.structuredOutput }),
    invoke: authority ? request => authority.invoke(activePlan.id, request) : invoke,
    reserve: async plan => {
      await current(); validateAssessmentPlan(plan);
      if (authority) {
        const receipt = await authority.reserve(plan);
        if (receipt.id !== plan.id || receipt.amount !== plan.amount) fail('the central reservation was not acknowledged exactly.');
        activePlan = plan;
      }
      return update(async saved => {
      await current(); validateAssessmentPlan(plan);
      const previous = saved.reservations.find(item => item.id === plan.id);
      if (previous && canonical(previous) !== canonical(plan)) fail('reservation identity was reused with different contents.');
      if (!previous) {
        const total = saved.reservations.reduce((sum, item) => sum + money(item.amount), 0) + money(plan.amount);
        if (total > maximum) fail('the approved browser-local budget is exhausted. No request was sent.');
        saved.reservations.push(copy(plan));
      }
      return { id: plan.id, amount: plan.amount };
      });
    } };
  function idle() { if (busy) fail('another pilot operation is still running.'); activeSignal.throwIfAborted(); }
  async function saveReceipt(value, collection, comparison = null) {
    try {
      await update(saved => {
        if (collection === 'results' && saved.results.some(item => item.report.id === value.report.id)) fail('a result with this identity already exists.');
        if (collection === 'revisions') {
          if (!Object.hasOwn(saved, 'revisions')) saved.revisions = [];
          if (saved.revisions.some(item => item.id === value.id)) fail('a revision with this identity already exists.');
        }
        saved[collection].push(copy(value));
        if (collection === 'results') {
          saved.inventoryReceipts ??= [];
          saved.inventoryReceipts.push({ assessmentId: value.report.id, inventory: copy(state.inventory) });
        }
        if (comparison) {
          if (!Object.hasOwn(saved, 'comparisons')) saved.comparisons = [];
          if (saved.comparisons.some(item => item.afterId === comparison.afterId)) fail('a comparison for this result already exists.');
          saved.comparisons.push(copy(comparison));
        }
      });
    } catch (cause) {
      throw Object.assign(new Error('The provider completed, but its receipt could not be saved.', { cause }), {
        assessmentAttempt: { status: 'failed', execution: copy(value.execution), reservations: copy(value.reservations) }
      });
    }
  }
  async function operate(phase, action) {
    idle(); busy = true; state.phase = phase; state.error = null;
    try { await current(); const result = await action(); await current(); return result; }
    catch (error) {
      state.phase = activeSignal.aborted ? 'cancelled' : 'failed'; state.error = error.message;
      if (error.assessmentAttempt) {
        try { await update(saved => { saved.failures.push({ at: Date.now(), snapshotFingerprint: snapshot.fingerprint, message: error.message, attempt: copy(error.assessmentAttempt) }); }); }
        catch (storageError) { state.error += ' Failure receipt could not be saved.'; throw new AggregateError([error, storageError], state.error); }
      }
      throw error;
    } finally { busy = false; }
  }
  return {
    state: () => copy({ ...state, busy }),
    historyData(id) {
      const saved = read(), result = saved.results.find(item => item.report?.id === id);
      if (!result || result.snapshotFingerprint !== snapshot.fingerprint) fail('select a completed result for this captured input.');
      return copy({ result, inventory: saved.inventoryReceipts?.find(item => item.assessmentId === id)?.inventory ?? null,
        revisions: (saved.revisions || []).filter(item => item.context.assessmentId === id),
        failures: saved.failures.filter(item => item.snapshotFingerprint === snapshot.fingerprint) });
    },
    budget: () => { if (authority) return authority.budget(); const saved = read(); return { id: budgetId, scope: 'browser-origin', maxCost, reserved: saved.reservations.reduce((sum, item) => sum + money(item.amount), 0) / 1e6 }; },
    async refreshBudget() {
      if (typeof authority?.refresh !== 'function') fail('this pilot has no central budget to refresh.');
      const phase = state.phase;
      return operate('refreshing-budget', async () => {
        const value = await authority.refresh(); state.phase = phase; return value;
      });
    },
    history: () => {
      const saved = read();
      return saved.results.filter(result => !baseline || saved.comparisons?.some(item => item.beforeId === baseline.id && item.afterId === result.report.id))
        .map(result => ({ id: result.report.id, createdAt: result.report.createdAt, snapshotFingerprint: result.snapshotFingerprint }));
    },
    async reuseInventory({ confirmed } = {}) {
      if (confirmed !== true || !baselineResult) fail('explicitly confirm the validated baseline inventory before rechecking.');
      return operate('reusing-inventory', async () => {
        const inventory = { version: 1, targetSha256: baselineResult.approval.targetSha256, manifest: baselineResult.approval.manifest,
          execution: [], reservations: [], approvalRequired: true, reusedFrom: baselineResult.report.id };
        const approval = await approveAssessmentInventory(snapshot, inventory, { confirmed: true });
        state = { ...state, phase: 'evidence-review', inventory, approval, selection: null, result: null, revision: null, comparison: null };
        return approval;
      });
    },
    revisionHistory: () => (read().revisions || []).map(item => ({ id: item.id, assessmentId: item.context.assessmentId, createdAt: item.createdAt, status: item.interpretation.status })),
    async proposeRevision({ confirmed, ...input } = {}) {
      if (confirmed !== true) fail('approve the selected field, evidence and both revision calls first.');
      const captured = copy(input);
      return operate('revising', async () => {
        if (!state.result) fail('open a complete assessment before requesting a revision.');
        const revision = await proposeAssessmentRevision(snapshot, state.result, captured, options);
        await current(); await saveReceipt(revision, 'revisions'); await current();
        state.revision = revision; state.phase = 'complete'; return revision;
      });
    },
    async restoreRevision(id, input) {
      const captured = copy(input);
      return operate('restoring-revision', async () => {
        if (!state.result) fail('open the original assessment before its revision.');
        const value = (read().revisions || []).find(item => item.id === id);
        if (!value) fail('saved revision not found.');
        const revision = await validateAssessmentRevision(value, snapshot, state.result, {
          ...captured, findingId: value.context.findingId, fieldId: value.context.fieldId, authorEvidence: value.context.authorEvidence,
        });
        await current(); state.revision = revision; state.phase = 'complete'; return revision;
      });
    },
    async inventory({ confirmed } = {}) {
      if (baseline) fail('this recheck must reuse its approved baseline inventory, not generate easier criteria.');
      if (confirmed !== true) fail('approve sending this job description first.');
      return operate('inventorying', async () => {
        const inventory = await inventoryCandidateAssessment(snapshot, options);
        await saveReceipt(inventory, 'inventories');
        state = { ...state, phase: 'inventory-review', inventory, approval: null, selection: null, result: null, revision: null };
        return inventory;
      });
    },
    async approveInventory({ confirmed, manifest } = {}) {
      return operate('approving-inventory', async () => {
        if (baselineResult && manifest && canonical(manifest) !== canonical(baselineResult.approval.manifest)) fail('a comparable recheck cannot change the frozen inventory.');
        const approval = await approveAssessmentInventory(snapshot, state.inventory, { confirmed, ...(manifest ? { manifest: copy(manifest) } : {}) });
        state.approval = approval; state.phase = 'evidence-review'; return approval;
      });
    },
    async approveEvidence({ confirmed, excluded } = {}) {
      return operate('approving-evidence', async () => {
        if (!state.approval) fail('approve the job inventory first.');
        const selection = approveAssessmentEvidence(snapshot, { confirmed, excluded });
        state.selection = selection; state.phase = 'assessment-ready'; return selection;
      });
    },
    async evaluate({ confirmed } = {}) {
      if (confirmed !== true) fail('approve sending the selected evidence for assessment and challenge first.');
      return operate('evaluating', async () => {
        const result = await evaluateCandidateAssessment(snapshot, { ...options, approval: state.approval, selection: state.selection });
        const comparison = baselineResult ? await compareCandidateAssessments(baselineResult, baseline.snapshot, result, snapshot) : null;
        await current();
        await saveReceipt(result, 'results', comparison);
        await current(); state.result = result; state.revision = null; state.comparison = comparison; state.phase = 'complete'; return result;
      });
    },
    async restore(id) {
      return operate('restoring', async () => {
        const ledger = read(), saved = ledger.results.find(result => result.report?.id === id);
        if (!saved) fail('saved assessment not found.');
        const result = await validateEvaluatedAssessment(saved, snapshot);
        let comparison = null;
        if (baselineResult) {
          const recorded = ledger.comparisons?.find(item => item.beforeId === baseline.id && item.afterId === id);
          if (!recorded) fail('the saved result has no comparison with this baseline.');
          comparison = await validateAssessmentComparison(recorded, baselineResult, baseline.snapshot, result, snapshot);
        }
        await current(); state = { ...state, phase: 'historical', inventory: ledger.inventoryReceipts?.find(item => item.assessmentId === id)?.inventory ?? null, approval: null, selection: null, result, comparison }; return result;
      });
    },
    cancel() { controller.abort(new DOMException('The assessment pilot was cancelled.', 'AbortError')); state.phase = 'cancelled'; }
  };
}
