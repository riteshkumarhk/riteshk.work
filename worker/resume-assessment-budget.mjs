import { RESUME_COMPLETION_LIMITS, resumeCompletionReservation } from '../src/js/resume-review.mjs';
import { assessmentProviderReceipt, validateAssessmentPlan } from '../src/js/resume-assessment-pilot.mjs';
import { awaitAssessment, parseAssessmentResponse } from '../src/js/resume-assessment-evaluator.mjs';
import { assessmentRequestPolicy, assessmentRequestParameters, validateAssessmentRequestPolicy, assessmentStructuredOutput } from '../src/js/resume-assessment-request-policy.mjs';
import { validateAssessmentOutputContract, assessmentResponseSchema, assessmentRequestIdentity, decodeAssessmentResponse } from '../src/js/resume-assessment-output.mjs';

const KEY = 'system/resume-assessment-budget-v1.json';
const ID = 'candidate-review';
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => canonical(a) === canonical(b);
const units = value => {
  const result = Math.round(value * 1e6);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(result) || result / 1e6 !== value) throw fault('Invalid server budget amount.');
  return result;
};
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) throw fault('Unexpected or missing assessment budget fields.');
}
async function readJson(message, maximum, status = 400) {
  const reader = message.body?.getReader();
  if (!reader) throw fault('A JSON body is required.', status);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw fault('Assessment body exceeds its bound.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fault('Unreadable assessment JSON.', status); }
}
function policyValue(value) {
  if (!value) throw fault('Central assessment spending is not enabled. No browser-budget fallback is allowed.', 503);
  let policy;
  try { policy = typeof value === 'string' ? JSON.parse(value) : structuredClone(value); }
  catch { throw fault('Invalid server assessment policy.', 503); }
  shape(policy, ['version', 'provider', 'checkedAt', 'maxCost', 'models']);
  if (policy.version !== 1 || !['anthropic', 'openai'].includes(policy.provider) || !units(policy.maxCost) ||
      !Array.isArray(policy.models) || !policy.models.length || policy.models.length > 20) throw fault('Invalid server assessment policy.', 503);
  for (const model of policy.models) {
    shape(model, ['id', 'pricing', 'maxInputTokens', 'maxOutputTokens', 'contextWindow', 'reasoning', ...(Object.hasOwn(model, 'structuredOutput') ? ['structuredOutput'] : [])]);
    assessmentStructuredOutput(policy.provider, model.id, model.structuredOutput);
    shape(model.pricing, ['input', 'output']);
    if (typeof model.id !== 'string' || !model.id.trim() || model.id.length > 160 || /automatic|auto selection/i.test(model.id) ||
        typeof model.reasoning !== 'boolean' || [model.maxInputTokens, model.maxOutputTokens, model.contextWindow].some(n => !Number.isSafeInteger(n) || n < 1) ||
        model.maxOutputTokens < 12000 || model.contextWindow <= 12000) throw fault('Invalid server model limits.', 503);
    resumeCompletionReservation({ stage: 'assessment', system: '', user: '', maxTokens: 12000 }, { ...model.pricing, checkedAt: policy.checkedAt });
  }
  if (new Set(policy.models.map(model => model.id)).size !== policy.models.length) throw fault('Duplicate server models.', 503);
  return policy;
}

export function validateAssessmentBudget(value, maxCost) {
  shape(value, ['version', 'id', 'maxCost', 'approvedAt', 'reservations']);
  if (!units(maxCost) || value.version !== 1 || value.id !== ID || !units(value.maxCost) || value.maxCost > maxCost ||
      !Number.isSafeInteger(value.approvedAt) || value.approvedAt < 0 || !Array.isArray(value.reservations) || value.reservations.length > 1000) throw fault('The central budget needs operator review.', 503);
  let total = 0;
  for (const reservation of value.reservations) {
    shape(reservation, ['plan', 'attempts', ...(Object.hasOwn(reservation, 'requestPolicy') ? ['requestPolicy'] : [])]); validateAssessmentPlan(reservation.plan);
    if (Object.hasOwn(reservation, 'requestPolicy')) validateAssessmentRequestPolicy(reservation.requestPolicy, reservation.plan.provider, reservation.plan.model);
    if (!Array.isArray(reservation.attempts) || reservation.attempts.length !== reservation.plan.stages.length) throw fault('Invalid central execution history.', 503);
    reservation.attempts.forEach((attempt, index) => {
      shape(attempt, ['stage', 'status', 'requestSha256', 'at', 'requestId', 'usage', 'error', ...(Object.hasOwn(attempt, 'binding') ? ['binding'] : []),
        ...(Object.hasOwn(attempt, 'rawResponseSha256') ? ['rawResponseSha256'] : []),
        ...(Object.hasOwn(attempt, 'responseContract') ? ['responseContract'] : [])]);
      if (Object.hasOwn(attempt, 'responseContract')) {
        validateAssessmentOutputContract(attempt.responseContract, reservation.plan.provider, reservation.plan.model);
        if (attempt.status === 'reserved') throw fault('An unstarted attempt cannot claim an output contract.', 503);
      }
      if (index && attempt.status !== 'reserved' && attempt.responseContract !== reservation.attempts[0].responseContract) throw fault('Stored phase output contracts differ.', 503);
      if (attempt.binding !== undefined) {
        shape(attempt.binding, ['request', 'response']);
        if (![attempt.binding.request, attempt.binding.response].every(value => value === null || /^[a-f0-9]{64}$/.test(value))) throw fault('Invalid stored request/output binding.', 503);
        if ((attempt.binding.request === null) !== (attempt.status === 'reserved') ||
            (attempt.binding.response !== null) !== (attempt.status === 'received')) throw fault('Inconsistent stored request/output binding.', 503);
      }
      if (attempt.stage !== reservation.plan.stages[index].stage || !['reserved', 'started', 'received', 'failed'].includes(attempt.status) ||
          (attempt.status !== 'reserved' && (!/^[a-f0-9]{64}$/.test(attempt.requestSha256) || !Number.isSafeInteger(attempt.at) || attempt.at < 0))) throw fault('Invalid central execution state.', 503);
      if (attempt.status === 'reserved' && [attempt.requestSha256, attempt.at, attempt.requestId, attempt.usage, attempt.error].some(value => value !== null) ||
          attempt.status === 'started' && [attempt.requestId, attempt.usage, attempt.error].some(value => value !== null) ||
          attempt.status === 'received' && (typeof attempt.requestId !== 'string' || !attempt.requestId || attempt.requestId.length > 200 || attempt.error !== null) ||
          attempt.status === 'failed' && (typeof attempt.error !== 'string' || !attempt.error || attempt.error.length > 500) ||
          index && attempt.status !== 'reserved' && reservation.attempts[index - 1].status !== 'received') throw fault('Inconsistent central attempt receipt.', 503);
      if (Object.hasOwn(attempt, 'rawResponseSha256') && (!/^[a-f0-9]{64}$/.test(attempt.rawResponseSha256) ||
          !['received', 'failed'].includes(attempt.status))) throw fault('Invalid stored raw response binding.', 503);
      if (attempt.usage !== null) {
        shape(attempt.usage, ['inputTokens', 'outputTokens']);
        if (!Number.isSafeInteger(attempt.usage.inputTokens) || attempt.usage.inputTokens < 0 || attempt.usage.inputTokens > 110000 ||
            !Number.isSafeInteger(attempt.usage.outputTokens) || attempt.usage.outputTokens < 0 || attempt.usage.outputTokens > RESUME_COMPLETION_LIMITS[attempt.stage]) throw fault('Invalid stored provider usage.', 503);
      }
    });
    total += units(reservation.plan.amount);
  }
  if (!Number.isSafeInteger(total) || total > units(value.maxCost) ||
      new Set(value.reservations.map(item => item.plan.id)).size !== value.reservations.length) throw fault('Inconsistent central budget history.', 503);
  return total;
}

export function createAssessmentBudgetStore(bucket, configuredPolicy, { retainResponse } = {}) {
  if (!bucket) throw fault('Central assessment storage is unavailable.', 503);
  if (retainResponse !== undefined && typeof retainResponse !== 'function') throw fault('Response retention callback is invalid.', 503);
  const policy = policyValue(configuredPolicy);
  const validate = value => validateAssessmentBudget(value, policy.maxCost);
  const selected = (provider, id, pricing) => {
    const model = policy.models.find(item => item.id === id);
    const quote = model && { ...model.pricing, checkedAt: policy.checkedAt };
    if (provider !== policy.provider || !model || pricing && !same(pricing, quote)) throw fault('The server model or price quote differs. Refresh and explicitly reconnect.', 409);
    resumeCompletionReservation({ stage: 'assessment', system: '', user: '', maxTokens: 12000 }, quote);
    return { ...model, pricing: quote };
  };
  async function read(required = true) {
    const object = await bucket.get(KEY);
    if (!object) {
      if (required) throw fault('Approve the central budget before reserving or executing.', 409);
      return { value: null, etag: null };
    }
    const value = await object.json(); validate(value);
    if (!object.etag) throw fault('Central storage did not provide a concurrency token.', 503);
    return { value, etag: object.etag };
  }
  const summary = value => {
    const reserved = value ? validate(value) / 1e6 : 0;
    return { version: 1, scope: 'server', id: ID, approved: !!value, maxCost: value?.maxCost ?? null, ceiling: policy.maxCost,
      reserved, remaining: value ? (units(value.maxCost) - units(reserved)) / 1e6 : null, observedAt: Date.now(),
      provider: policy.provider, checkedAt: policy.checkedAt, models: policy.models.map(model => ({ ...structuredClone(model),
        structuredOutput: assessmentStructuredOutput(policy.provider, model.id, model.structuredOutput) })) };
  };
  async function update(change, allowCreate = false) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await read(!allowCreate), value = change(current.value);
      validate(value);
      const serialized = JSON.stringify(value);
      if (serialized.length > 2 * 1024 * 1024) throw fault('Central budget history is full. No reservations were discarded.', 413);
      const saved = await bucket.put(KEY, serialized, { onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });
      if (saved) return value;
    }
    throw fault('Central budget is busy. No provider request was sent.', 409);
  }
  return {
    async status() { return summary((await read(false)).value); },
    async approve(input) {
      shape(input, ['confirmed', 'maxCost']);
      if (input.confirmed !== true || !units(input.maxCost) || input.maxCost > policy.maxCost) throw fault('Explicit approval within the server ceiling is required.');
      return summary(await update(value => {
        if (value && value.maxCost !== input.maxCost) throw fault('The existing central ceiling cannot be reset or changed from a device.', 409);
        return value || { version: 1, id: ID, maxCost: input.maxCost, approvedAt: Date.now(), reservations: [] };
      }, true));
    },
    async reserve(plan) {
      plan = structuredClone(plan); validateAssessmentPlan(plan);
      const model = selected(plan.provider, plan.model, plan.pricing);
      const requestPolicy = assessmentRequestPolicy(plan.provider, plan.model, model.reasoning);
      if (!Number.isSafeInteger(plan.at) || Math.abs(Date.now() - plan.at) > 300000) throw fault('The phase reservation is stale. No request was sent.', 409);
      const value = await update(value => {
        const prior = value.reservations.find(item => item.plan.id === plan.id);
        if (prior) {
          if (!same(prior.plan, plan)) throw fault('Reservation identity was reused with different contents.', 409);
          return value;
        }
        if (validate(value) + units(plan.amount) > units(value.maxCost)) throw fault('The central assessment budget is exhausted. No request was sent.', 409);
        value.reservations.push({ plan, requestPolicy, attempts: plan.stages.map(item => ({ stage: item.stage, status: 'reserved', requestSha256: null,
          at: null, requestId: null, usage: null, error: null, binding: { request: null, response: null } })) });
        return value;
      });
      return { id: plan.id, amount: plan.amount, budget: summary(value) };
    },
    async execute(input, invoke, signal) {
      signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);
      shape(input, ['reservationId', 'provider', 'model', 'stage', 'system', 'user', 'maxTokens',
        ...(Object.hasOwn(input, 'responseContract') ? ['responseContract'] : [])]);
      input = structuredClone(input);
      const { reservationId, ...request } = input;
      if (Object.hasOwn(request, 'responseContract')) validateAssessmentOutputContract(request.responseContract, request.provider, request.model);
      const model = selected(request.provider, request.model);
      if (request.responseContract !== undefined && !assessmentStructuredOutput(request.provider, request.model, model.structuredOutput)) {
        throw fault('The server has not enabled structured output for this model. Refresh its verified capabilities before execution.', 409);
      }
      const requestPolicy = assessmentRequestPolicy(request.provider, request.model, model.reasoning);
      if (!Object.hasOwn(RESUME_COMPLETION_LIMITS, request.stage) || request.maxTokens !== RESUME_COMPLETION_LIMITS[request.stage]) throw fault('Unapproved stage or output cap.');
      const { inputBound } = resumeCompletionReservation(request, model.pricing);
      if (inputBound > model.maxInputTokens || inputBound + request.maxTokens > model.contextWindow) throw fault('The complete input exceeds the server model capacity. Nothing was truncated.', 413);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ ...request, requestPolicy })));
      const requestSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const requestBinding = await hash(assessmentRequestIdentity(request));
      signal?.throwIfAborted();
      await update(value => {
        const entry = value.reservations.find(item => item.plan.id === reservationId);
        if (!entry || entry.plan.provider !== request.provider || entry.plan.model !== request.model || !same(entry.plan.pricing, model.pricing)) throw fault('A matching server reservation is required.', 409);
        if (entry.requestPolicy !== requestPolicy) throw fault('The reserved request policy is missing or changed. No provider request was sent.', 409);
        const index = entry.attempts.findIndex(item => item.stage === request.stage), attempt = entry.attempts[index];
        if (!attempt || attempt.status !== 'reserved' || index && entry.attempts[index - 1].status !== 'received') throw fault('Stage is unplanned, out of order or already attempted. No retry was sent.', 409);
        if (index && entry.attempts[0].responseContract !== request.responseContract) throw fault('The phase output contract changed. No provider request was sent.', 409);
        Object.assign(attempt, { status: 'started', requestSha256, at: Date.now(), binding: { request: requestBinding, response: null },
          ...(request.responseContract === undefined ? {} : { responseContract: request.responseContract }) });
        return value;
      });
      let receipt = null, failure = null, responseBinding = null, rawResponseSha256 = null, retentionFailed = false;
      try {
        signal?.throwIfAborted();
        receipt = await awaitAssessment(invoke(request, model, signal), signal);
        shape(receipt, ['text', 'provider', 'model', 'requestId', 'usage']);
        if (receipt.usage !== null) shape(receipt.usage, ['inputTokens', 'outputTokens']);
        if (receipt.provider !== request.provider || receipt.model !== request.model || typeof receipt.text !== 'string' || !receipt.text.trim() || receipt.text.length > 60000 ||
            typeof receipt.requestId !== 'string' || !receipt.requestId || receipt.requestId.length > 200 ||
            receipt.usage !== null && (!Number.isSafeInteger(receipt.usage.inputTokens) || receipt.usage.inputTokens < 0 || receipt.usage.inputTokens > 110000 ||
              !Number.isSafeInteger(receipt.usage.outputTokens) || receipt.usage.outputTokens < 0 || receipt.usage.outputTokens > request.maxTokens)) throw fault('The provider receipt did not match the server reservation.', 502);
        if (retainResponse) {
          rawResponseSha256 = await hash(receipt);
          try {
            await awaitAssessment(retainResponse({ reservationId, stage: request.stage, requestSha256: requestBinding,
              receipt: structuredClone(receipt), sha256: rawResponseSha256 }), signal);
          } catch (error) { retentionFailed = true; throw error; }
        }
        responseBinding = await hash(decodeAssessmentResponse(request, parseAssessmentResponse(receipt.text, request.responseContract !== undefined)));
      } catch (error) { failure = error instanceof Error ? error : new Error('Unrecognized provider failure.'); receipt = null; }
      const saved = await update(value => {
        const attempt = value.reservations.find(item => item.plan.id === reservationId)?.attempts.find(item => item.stage === request.stage);
        if (!attempt || attempt.status !== 'started' || attempt.requestSha256 !== requestSha256) throw fault('Central execution acknowledgement conflict. Do not retry the request.', 409);
        Object.assign(attempt, { status: failure ? 'failed' : 'received', requestId: receipt?.requestId ?? null, usage: receipt?.usage ?? null,
          error: failure ? failure.message.slice(0, 500) || 'Provider outcome unknown.' : null, binding: { request: requestBinding, response: responseBinding },
          ...(rawResponseSha256 ? { rawResponseSha256 } : {}) });
        return value;
      });
      if (failure) throw fault(retentionFailed ? 'Response retention was not acknowledged; reservation retained. No automatic retry.'
        : 'Provider attempt failed or its outcome is unknown; reservation retained. No automatic retry.', 502);
      return { receipt: { ...receipt, requestPolicy, ...(request.responseContract === undefined ? {} : { responseContract: request.responseContract }) }, budget: summary(saved) };
    }
  };
}

export async function assessmentBudgetRoute(request, env, headers, resolveKey, fetcher = fetch, retention = {}) {
  try {
    const action = new URL(request.url).pathname.slice('/admin/resume/assessment/'.length);
    if (action === 'budget' ? request.method !== 'GET' : !['approve', 'reserve', 'execute'].includes(action) || request.method !== 'POST') throw fault('Assessment budget route or method is not available.', 405);
    const store = createAssessmentBudgetStore(env.VAULT, env.RESUME_ASSESSMENT_POLICY, retention);
    if (action === 'budget') return Response.json(await store.status(), { headers });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120000)]);
    const input = await awaitAssessment(readJson(request, 750000), signal);
    if (action === 'approve') return Response.json(await store.approve(input), { headers });
    if (action === 'reserve') return Response.json(await store.reserve(input), { headers });
    const result = await store.execute(input, async (call, model, signal) => {
      const key = await resolveKey(call.provider);
      if (!key) throw fault('The selected server provider is not configured.', 503);
      signal.throwIfAborted();
      resumeCompletionReservation(call, model.pricing);
      const anthropic = call.provider === 'anthropic';
      const parameters = assessmentRequestParameters(call.provider, call.model, model.reasoning);
      if (call.responseContract !== undefined && anthropic) parameters.output_config = { ...parameters.output_config,
        format: { type: 'json_schema', schema: assessmentResponseSchema(call) } };
      const body = anthropic ? { model: call.model, max_tokens: call.maxTokens, ...parameters, stream: false, system: call.system, messages: [{ role: 'user', content: call.user }] }
        : { model: call.model, stream: false, [model.reasoning ? 'max_completion_tokens' : 'max_tokens']: call.maxTokens,
          ...parameters, response_format: call.responseContract === undefined ? { type: 'json_object' }
            : { type: 'json_schema', json_schema: { name: 'resume_assessment', strict: true, schema: assessmentResponseSchema(call) } },
          messages: [{ role: 'system', content: call.system }, { role: 'user', content: call.user }] };
      const response = await fetcher(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json',
          ...(anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer ' + key }) }, body: JSON.stringify(body) });
      if (!response.ok) throw fault('The provider rejected the single assessment attempt.', 502);
      return assessmentProviderReceipt(call.provider, await readJson(response, 300000, 502), response);
    }, signal);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error.status ? error.message : 'Central assessment storage or execution is unavailable; no automatic retry or refund.', reservationRetained: true },
      { status: error.status || 503, headers });
  }
}
