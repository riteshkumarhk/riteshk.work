import { open, readFile, unlink } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { AI_AGENT_LIMITS } from '../src/js/ai-task-agent.mjs';
import { AI_TEXT_REQUEST_ATTEMPTS, aiEmbeddingInput } from '../src/js/ai-request-limits.mjs';
import { atsEmbedScore } from '../src/js/ats-core.js';
import { historyHash, canonicalHistory } from '../src/js/resume-assessment-history.mjs';
import { validateAssessmentJson } from '../src/js/resume-assessment.mjs';
import { awaitAssessment } from '../src/js/resume-assessment-evaluator.mjs';
import { validateAssessmentBudget } from '../worker/resume-assessment-budget.mjs';

export const BASELINE_BUDGET_KEY = 'system/resume-baseline-budget-v1.json';
const PARENT_KEY = 'system/resume-assessment-budget-v1.json';
const RAW_COMPLETIONS = AI_AGENT_LIMITS.calls * AI_TEXT_REQUEST_ATTEMPTS;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const BASELINE_CODE_FILES = Object.freeze([
  'src/js/admin-studio.js', 'src/js/resume-ats.mjs', 'src/js/ats-core.js',
  'src/js/ai-task-agent.mjs', 'src/js/ai-request-limits.mjs', 'src/js/ai-orchestrator.mjs',
  'src/js/ai-model-router.mjs', 'src/js/ai-model-catalog.mjs', 'src/js/ai-model-evaluations.mjs', 'src/js/ai-session.mjs',
  'src/js/resume-assessment-history.mjs', 'src/js/resume-assessment.mjs', 'src/js/resume-assessment-evaluator.mjs',
  'src/js/resume-assessment-output.mjs', 'src/js/resume-assessment-request-policy.mjs',
  'src/js/resume-assessment-pilot.mjs', 'src/js/resume-review.mjs', 'src/js/resume-pdf.mjs',
  'src/js/resume-render.mjs', 'src/js/resume-workspace.mjs', 'src/js/resume-assessment-input.mjs',
  'worker/resume-assessment-budget.mjs', 'worker/rk-ai-proxy.js', 'tools/resume-baseline-accounting.mjs',
  'tools/resume-baseline-studio.mjs', 'build.mjs', 'package.json', 'package-lock.json',
]);
export async function baselineCodeFingerprint() {
  return historyHash(await Promise.all(BASELINE_CODE_FILES.map(async name => ({
    name, sha256: await historyHash(new Uint8Array(await readFile(new URL('../' + name, import.meta.url)))),
  }))));
}
const loadedCodeSha256 = await baselineCodeFingerprint();
const fail = message => { throw new Error('Baseline accounting: ' + message); };
const same = (left, right) => canonicalHistory(left) === canonicalHistory(right);
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('unexpected record fields.');
}
function integer(value, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum) fail('invalid integer bound.'); }
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('an exact source/configuration binding is required.'); }
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('invalid operation identity.'); }
function units(value) {
  const result = Math.round(value * 1e6);
  integer(result);
  if (typeof value !== 'number' || result / 1e6 !== value) fail('money must use exact whole millionths.');
  return result;
}
function cost(model, input, output) {
  const numerator = BigInt(input) * BigInt(units(model.pricing.input)) + BigInt(output) * BigInt(units(model.pricing.output));
  const result = Number((numerator + 999999n) / 1000000n);
  integer(result); return result;
}
function policyValue(value) {
  validateAssessmentJson(value);
  shape(value, ['version', 'maxCost', 'checkedAt', 'codeSha256', 'configurationSha256', 'automaticEvaluation', 'embedding', 'models']);
  if (value.version !== 1 || value.automaticEvaluation !== false || !units(value.maxCost)) fail('a bounded policy with explicitly frozen automatic evaluation OFF is required.');
  integer(value.checkedAt); hash(value.codeSha256); hash(value.configurationSha256);
  if (!Array.isArray(value.models) || !value.models.length || value.models.length > 100) fail('a frozen model catalogue is required.');
  for (const model of value.models) {
    shape(model, ['provider', 'id', 'kind', 'pricing', 'maxInputTokens', 'maxOutputTokens']);
    shape(model.pricing, ['input', 'output']); units(model.pricing.input); units(model.pricing.output);
    if (!['anthropic', 'openai', 'gemini'].includes(model.provider) || !['completion', 'embedding'].includes(model.kind) ||
        typeof model.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(model.id)) fail('invalid frozen model.');
    integer(model.maxInputTokens, 1); integer(model.maxOutputTokens);
    if (model.maxInputTokens > 2000000 || model.maxOutputTokens > 1000000 ||
        (model.kind === 'completion') !== (model.maxOutputTokens > 0) ||
        model.kind === 'embedding' && model.provider === 'anthropic' ||
        model.kind === 'completion' && model.provider === 'gemini') fail('unsupported model capacity; bounded completions currently support Anthropic and OpenAI only.');
  }
  const keys = value.models.map(model => [model.provider, model.id, model.kind].join(':'));
  if (new Set(keys).size !== keys.length || !value.models.some(model => model.kind === 'completion')) fail('duplicate or missing completion models.');
  if (value.embedding !== null) {
    shape(value.embedding, ['provider', 'id']);
    if (!value.models.some(model => model.kind === 'embedding' && model.provider === value.embedding.provider && model.id === value.embedding.id)) fail('the frozen embedding selection is missing.');
  }
  return structuredClone(value);
}
function quoteUnits(policy) {
  const completions = policy.models.filter(model => model.kind === 'completion');
  const completion = Math.max(...completions.map(model => cost(model, model.maxInputTokens, model.maxOutputTokens)));
  const embedding = policy.embedding && policy.models.find(model => model.kind === 'embedding' && model.provider === policy.embedding.provider && model.id === policy.embedding.id);
  const total = RAW_COMPLETIONS * completion + (embedding ? cost(embedding, embedding.maxInputTokens, 0) : 0);
  integer(total); return total;
}
function wireBound(policy, request) {
  shape(request, ['id', 'kind', 'provider', 'model', 'body']);
  id(request.id);
  const model = policy.models.find(item => item.kind === request.kind && item.provider === request.provider && item.id === request.model);
  if (!model || request.kind === 'embedding' && !same(policy.embedding, { provider: request.provider, id: request.model })) fail('unapproved provider/model or embedding selection.');
  if (typeof request.body !== 'string' || request.body.length > 8 * 1024 * 1024) fail('invalid request body.');
  let body;
  try { body = JSON.parse(request.body); } catch { fail('unreadable request body.'); }
  validateAssessmentJson(body);
  const allowed = request.kind === 'embedding'
    ? request.provider === 'openai' ? ['model', 'input'] : ['requests']
    : request.provider === 'anthropic' ? ['model', 'max_tokens', 'temperature', 'system', 'messages', 'stream', 'output_config', 'thinking']
      : request.provider === 'openai' ? ['model', 'messages', 'temperature', 'max_tokens', 'max_completion_tokens', 'stream', 'stream_options', 'response_format']
        : ['contents', 'systemInstruction', 'generationConfig'];
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail('unsupported baseline request feature.');
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['cache_control', 'tools', 'image_url', 'inlineData', 'inline_data', 'fileData'].includes(key) || key === 'type' && item === 'image') fail('unpriced request feature.');
      inspect(item);
    }
  };
  inspect(body);
  if (request.provider !== 'gemini' && body.model !== request.model) fail('wire model changed.');
  let output = 0;
  if (request.kind === 'completion') {
    output = request.provider === 'anthropic' ? body.max_tokens : request.provider === 'gemini' ? body.generationConfig?.maxOutputTokens : body.max_completion_tokens ?? body.max_tokens;
    if (request.provider === 'openai' && Object.hasOwn(body, 'max_completion_tokens') && Object.hasOwn(body, 'max_tokens')) fail('ambiguous output capacity.');
    integer(output, 1);
  } else if (request.provider === 'gemini') {
    if (!Array.isArray(body.requests) || !body.requests.length || body.requests.some(item => item.model !== 'models/' + request.model)) fail('embedding wire model changed.');
  } else if (!Array.isArray(body.input) || !body.input.length || body.input.some(item => typeof item !== 'string')) fail('invalid embedding input.');
  const input = new TextEncoder().encode(request.body).length + 2048;
  if (input > model.maxInputTokens || output > model.maxOutputTokens) fail('request exceeds its frozen token capacity; nothing was truncated.');
  return cost(model, input, output);
}

export function createBaselineAccounting({ bucket, identityPath, policy: supplied, now = Date.now }) {
  if (!bucket || !isAbsolute(identityPath || '')) fail('persistent storage and a separate absolute identity-file path are required.');
  const policy = policyValue(supplied), allocation = quoteUnits(policy);
  const fresh = () => { if (policy.checkedAt > now() || now() - policy.checkedAt > 86400000) fail('verify current prices; timestamps are not renewed automatically.'); };
  async function verifyCode() {
    if (policy.codeSha256 !== loadedCodeSha256 || await baselineCodeFingerprint() !== loadedCodeSha256) fail('runtime source changed; use a fresh process and newly reviewed code binding.');
  }
  async function exclusive(action) {
    let lock;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { lock = await open(identityPath + '.lock', 'wx'); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    if (!lock) fail('accounting is busy or has an orphaned lock; inspect it rather than deleting it automatically.');
    try { return await action(); }
    finally { await lock.close(); await unlink(identityPath + '.lock'); }
  }
  async function writeIdentity(marker) {
    const file = await open(identityPath, 'r+');
    try { await file.truncate(0); await file.writeFile(JSON.stringify(marker)); await file.sync(); }
    finally { await file.close(); }
  }
  async function parent() {
    const object = await bucket.get(PARENT_KEY);
    if (!object) fail('the historical budget is missing; it cannot be recreated.');
    const value = await object.json();
    const reserved = validateAssessmentBudget(value, value.maxCost);
    return { sha256: await historyHash(value), reserved, ceiling: units(value.maxCost) };
  }
  async function review() {
    fresh(); await verifyCode();
    const previous = await parent();
    const packet = { version: 1, policy, parent: previous, completionRequests: RAW_COMPLETIONS, embeddingRequests: policy.embedding ? 1 : 0, allocation };
    return { ...packet, approvalSha256: await historyHash(packet), additionalPerRun: allocation / 1e6,
      protectedHistoricalCeiling: previous.ceiling / 1e6, historicalReserved: previous.reserved / 1e6,
      limitation: 'Reserve the historical authority ceiling, not just observed spend, to prevent a cross-ledger race. Supplied metadata is not an independently authenticated catalogue or payment approval.' };
  }
  async function read() {
    let marker;
    try { marker = JSON.parse(await readFile(identityPath, 'utf8')); }
    catch (error) { throw new Error('Baseline accounting: enrollment identity is unavailable or unreadable; do not reset it.', { cause: error }); }
    shape(marker, ['version', 'approvalSha256', 'ledgerSha256', 'pending']);
    if (marker.pending !== null) fail('a durable update is pending or its acknowledgement was lost; operator audit is required.');
    const object = await bucket.get(BASELINE_BUDGET_KEY);
    if (!object?.etag) fail('the enrolled ledger is missing or lacks concurrency identity; do not recreate it.');
    const value = await object.json();
    shape(value, ['version', 'policy', 'parent', 'approvalSha256', 'runs']);
    const previous = await parent();
    if (value.version !== 1 || !same(value.policy, policy) || !same(value.parent, previous) ||
        marker.version !== 1 || marker.approvalSha256 !== value.approvalSha256) fail('enrollment, policy or historical budget changed.');
    if (marker.ledgerSha256 !== await historyHash(value)) fail('the ledger was changed or rolled back independently of its durable identity.');
    const packet = { version: 1, policy, parent: previous, completionRequests: RAW_COMPLETIONS, embeddingRequests: policy.embedding ? 1 : 0, allocation };
    if (await historyHash(packet) !== value.approvalSha256 || !Array.isArray(value.runs) || value.runs.length > 1000) fail('corrupt enrollment.');
    const ids = new Set();
    for (const run of value.runs) {
      shape(run, ['id', 'inputSha256', 'inputVerified', 'semanticSha256', 'allocation', 'status', 'attempts']);
      id(run.id); hash(run.inputSha256);
      if (ids.has(run.id) || typeof run.inputVerified !== 'boolean' || run.allocation !== allocation || !['open', 'complete', 'stopped'].includes(run.status) || !Array.isArray(run.attempts) ||
          run.attempts.length && !run.inputVerified) fail('invalid stored run.');
      ids.add(run.id);
      if (run.inputVerified) hash(run.semanticSha256);
      else if (run.semanticSha256 !== null) fail('unverified run claims semantic input.');
      const attempts = new Set();
      for (const [index, attempt] of run.attempts.entries()) {
        shape(attempt, ['id', 'kind', 'provider', 'model', 'requestSha256', 'maximumUnits', 'at', 'status', 'httpStatus', 'responseSha256']);
        id(attempt.id); hash(attempt.requestSha256); integer(attempt.maximumUnits); integer(attempt.at);
        const model = policy.models.find(item => item.provider === attempt.provider && item.id === attempt.model && item.kind === attempt.kind);
        if (!model || attempt.kind === 'embedding' && !same(policy.embedding, { provider: attempt.provider, id: attempt.model }) ||
            attempts.has(attempt.id) || attempt.maximumUnits > cost(model, model.maxInputTokens, model.maxOutputTokens) ||
            !['started', 'received', 'unknown'].includes(attempt.status) || index < run.attempts.length - 1 && attempt.status !== 'received') fail('invalid stored attempt.');
        if (attempt.status === 'received') {
          integer(attempt.httpStatus, 100); hash(attempt.responseSha256);
          if (attempt.httpStatus > 599) fail('invalid HTTP receipt.');
        } else if (attempt.httpStatus !== null || attempt.responseSha256 !== null) fail('unreceived attempt claims a response.');
        attempts.add(attempt.id);
      }
      if (run.attempts.filter(item => item.kind === 'completion').length > RAW_COMPLETIONS ||
          run.attempts.filter(item => item.kind === 'embedding').length > (policy.embedding ? 1 : 0) ||
          run.status === 'complete' && (!run.attempts.length || run.attempts.some(item => item.status !== 'received'))) fail('invalid run completion or request count.');
    }
    const reserved = previous.ceiling + value.runs.length * allocation;
    integer(reserved);
    if (reserved > units(policy.maxCost)) fail('cumulative authority ceiling exceeded.');
    return { value, etag: object.etag, reserved };
  }
  async function update(change) {
    return exclusive(async () => {
      const current = await read();
      change(current.value);
      if (current.value.runs.length > 1000 || current.value.parent.ceiling + current.value.runs.length * allocation > units(policy.maxCost)) fail('cumulative ceiling cannot cover another whole baseline run.');
      const nextSha256 = await historyHash(current.value);
      const marker = JSON.parse(await readFile(identityPath, 'utf8'));
      await writeIdentity({ ...marker, pending: nextSha256 });
      const saved = await bucket.put(BASELINE_BUDGET_KEY, JSON.stringify(current.value), { onlyIf: { etagMatches: current.etag } });
      if (!saved) fail('ledger update was not acknowledged; its durable intent remains pending.');
      await writeIdentity({ ...marker, ledgerSha256: nextSha256, pending: null });
      return current.value;
    });
  }
  async function dispatch(runId, inputSha256, request, send, signal) {
    fresh(); await verifyCode(); id(runId); hash(inputSha256);
    if (typeof send !== 'function') fail('an explicit transport is required.');
    request = structuredClone(request);
    const maximumUnits = wireBound(policy, request), requestSha256 = await historyHash(request);
    const controller = new AbortController();
    const lifetime = AbortSignal.any([controller.signal, AbortSignal.timeout(AI_AGENT_LIMITS.milliseconds), ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    await update(value => {
      const run = value.runs.find(item => item.id === runId);
      if (!run || run.inputSha256 !== inputSha256 || run.status !== 'open' || !run.inputVerified) fail('run is missing, changed, unverified or closed.');
      if (run.attempts.some(item => item.id === request.id) || run.attempts.some(item => item.status !== 'received')) fail('already attempted or unresolved operation; no replay.');
      const limit = request.kind === 'completion' ? RAW_COMPLETIONS : policy.embedding ? 1 : 0;
      if (run.attempts.filter(item => item.kind === request.kind).length >= limit) fail('raw request limit reached.');
      run.attempts.push({ id: request.id, kind: request.kind, provider: request.provider, model: request.model, requestSha256,
        maximumUnits, at: now(), status: 'started', httpStatus: null, responseSha256: null });
    });
    let response, bytes;
    try {
      lifetime.throwIfAborted();
      response = await awaitAssessment(Promise.resolve().then(() => send(lifetime)), lifetime);
      if (!(response instanceof Response) || response.status < 200 || response.status > 599) fail('transport did not return an HTTP response.');
      const reader = response.body?.getReader(), chunks = []; let length = 0;
      if (reader) {
        try {
          for (;;) {
            const next = await awaitAssessment(reader.read(), lifetime);
            if (next.done) break;
            length += next.value.byteLength;
            if (length > MAX_RESPONSE_BYTES) fail('response exceeds the bounded receipt size.');
            chunks.push(next.value);
          }
        } catch (error) {
          controller.abort(error);
          // A stalled cleanup must not prevent the original failure from being recorded.
          void reader.cancel().catch(() => {});
          throw error;
        } finally { reader.releaseLock(); }
      }
      bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } catch (error) {
      controller.abort(error);
      try { await update(value => { const run = value.runs.find(item => item.id === runId); run.status = 'stopped'; run.attempts.at(-1).status = 'unknown'; }); }
      catch (storageError) { throw new AggregateError([error, storageError], 'Baseline request failed and its outcome could not be recorded; reservation remains held.'); }
      throw error;
    }
    const responseSha256 = await historyHash(bytes);
    let closed = false;
    await update(value => {
      const run = value.runs.find(item => item.id === runId), attempt = run.attempts.at(-1);
      if (attempt.id !== request.id || attempt.requestSha256 !== requestSha256 || attempt.status !== 'started') fail('attempt changed before receipt persistence.');
      closed = run.status !== 'open';
      Object.assign(attempt, { status: 'received', httpStatus: response.status, responseSha256 });
    });
    lifetime.throwIfAborted();
    if (closed) fail('run was closed while the request was in flight; no result was released.');
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  return {
    review,
    async verifyConfiguration(snapshot) {
      fresh(); await verifyCode(); await exclusive(read);
      if (!snapshot || !Object.hasOwn(snapshot, 'embedding') || !same(snapshot.embedding, policy.embedding)) fail('the frozen embedding configuration differs; it cannot be silently disabled or switched.');
      if (await historyHash(snapshot) !== policy.configurationSha256) fail('the frozen routing configuration changed.');
    },
    async verifyInput(runId, inputSha256, input) {
      fresh(); await verifyCode();
      input = structuredClone(input);
      validateAssessmentJson(input);
      shape(input, ['version', 'artifactSha256', 'text', 'target']);
      shape(input.target, ['level', 'company', 'jd']);
      if (input.artifactSha256 !== null) hash(input.artifactSha256);
      if (input.version !== 1 || typeof input.text !== 'string' || !input.text.trim() ||
          !['senior', 'staff', 'leader'].includes(input.target.level) ||
          typeof input.target.company !== 'string' || typeof input.target.jd !== 'string' ||
          await historyHash(input) !== inputSha256) fail('actual artifact, extracted text or target differs from the reserved input.');
      const semanticSha256 = await historyHash([input.text, input.target.jd]);
      await update(value => {
        const run = value.runs.find(item => item.id === runId);
        if (!run || run.inputSha256 !== inputSha256 || run.status !== 'open') fail('input run is missing, changed or closed.');
        run.inputVerified = true;
        run.semanticSha256 = semanticSha256;
      });
    },
    async approve({ approvalSha256 }) {
      await exclusive(async () => {
        const packet = await review();
        if (approvalSha256 !== packet.approvalSha256 || packet.parent.ceiling + allocation > units(policy.maxCost)) fail('exact approval and a sufficient cumulative ceiling are required.');
        if (await bucket.get(BASELINE_BUDGET_KEY)) fail('existing enrollment cannot be replaced.');
        const value = { version: 1, policy, parent: packet.parent, approvalSha256, runs: [] };
        const ledgerSha256 = await historyHash(value), marker = { version: 1, approvalSha256, ledgerSha256: null, pending: ledgerSha256 };
        const file = await open(identityPath, 'wx');
        try { await file.writeFile(JSON.stringify(marker)); await file.sync(); }
        finally { await file.close(); }
        if (!await bucket.put(BASELINE_BUDGET_KEY, JSON.stringify(value), { onlyIf: { etagDoesNotMatch: '*' } })) fail('enrollment was not acknowledged; do not retry or remove its identity.');
        await writeIdentity({ ...marker, ledgerSha256, pending: null });
      });
      return this.status();
    },
    async status() {
      const current = await exclusive(read);
      return { maxCost: policy.maxCost, historicalReserved: current.value.parent.reserved / 1e6, protectedHistoricalCeiling: current.value.parent.ceiling / 1e6,
        reserved: current.reserved / 1e6, baselineReserved: current.value.runs.length * allocation / 1e6, runs: structuredClone(current.value.runs) };
    },
    async reserve({ id: runId, inputSha256 }) {
      fresh(); await verifyCode(); id(runId); hash(inputSha256);
      await update(value => {
        if (value.runs.some(item => item.id === runId)) fail('run identity has already been reserved; no recreation.');
        value.runs.push({ id: runId, inputSha256, inputVerified: false, semanticSha256: null, allocation, status: 'open', attempts: [] });
      });
    },
    dispatch,
    async finish(runId, complete = false) {
      if (typeof complete !== 'boolean') fail('explicit completion state is required.');
      if (complete) await verifyCode();
      await update(value => {
        const run = value.runs.find(item => item.id === runId);
        if (!run || run.status !== 'open') fail('run is missing or closed.');
        const last = run.attempts.findLast(item => item.kind === 'completion');
        if (complete && (!last || last.httpStatus < 200 || last.httpStatus >= 300 || run.attempts.some(item => item.status !== 'received'))) fail('unresolved run cannot complete.');
        run.status = complete ? 'complete' : 'stopped';
      });
    },
    async semantic(runId, inputSha256, texts, send, signal) {
      fresh(); await verifyCode(); signal?.throwIfAborted();
      const current = await exclusive(read), run = current.value.runs.find(item => item.id === runId);
      if (!run || run.inputSha256 !== inputSha256 || run.status !== 'open' || !run.inputVerified) fail('semantic run is missing, unverified or changed.');
      if (!Array.isArray(texts) || texts.length !== 2 || texts.some(text => typeof text !== 'string') ||
          await historyHash(texts) !== run.semanticSha256) fail('semantic input differs from the verified resume and job.');
      if (texts.some(text => !text.trim())) return { off: true };
      if (!policy.embedding) return { unavailable: true, reason: 'The explicitly frozen baseline configuration has no embedding provider.' };
      if (typeof send !== 'function') fail('an explicit embedding transport is required.');
      const input = aiEmbeddingInput({ input: texts });
      if (!input || input.length !== 2) fail('resume and job text are required for semantic comparison.');
      const { provider, id: model } = policy.embedding;
      const body = provider === 'openai' ? { model, input } : { requests: input.map(text => ({ model: 'models/' + model, content: { parts: [{ text }] }, taskType: 'SEMANTIC_SIMILARITY' })) };
      const request = { id: 'embedding', kind: 'embedding', provider, model, body: JSON.stringify(body) };
      const response = await dispatch(runId, inputSha256, request, lifetime => send(structuredClone(request), lifetime), signal);
      if (!response.ok) fail('configured embedding request failed (HTTP ' + response.status + '); no silent lexical fallback.');
      const value = await response.json();
      const vectors = provider === 'openai' ? value.data?.map(item => item.embedding) : value.embeddings?.map(item => item.values);
      const score = vectors?.length === 2 ? atsEmbedScore(vectors[0], vectors[1]) : null;
      if (score === null || !Number.isFinite(score)) fail('malformed embedding result; no silent lexical fallback.');
      return { ok: true, score };
    },
  };
}

export function bindBaselineAccounting(store, { runId, inputSha256, embeddingTransport }) {
  id(runId); hash(inputSha256);
  return {
    verifyConfiguration: snapshot => store.verifyConfiguration(snapshot),
    verifyInput: input => store.verifyInput(runId, inputSha256, input),
    request: (request, send, signal) => store.dispatch(runId, inputSha256, request, send, signal),
    semantic: (text, jd, signal) => store.semantic(runId, inputSha256, [text, jd], embeddingTransport, signal),
  };
}
