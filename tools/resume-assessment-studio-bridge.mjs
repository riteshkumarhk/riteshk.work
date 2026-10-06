import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { awaitAssessment } from '../src/js/resume-assessment-evaluator.mjs';
import { assessmentResponseSchema, validateAssessmentOutputContract } from '../src/js/resume-assessment-output.mjs';

export const STUDIO_ORIGIN = 'https://riteshk.work';
export const STUDIO_KEY_PLACEHOLDER = 'studio-session-stays-in-browser';
const fault = (message, status = 409) => Object.assign(new Error('Studio probe: ' + message), { status });

export function validateStudioProbeBody(body) {
  const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const structured = Object.hasOwn(body?.output_config ?? {}, 'format');
  if (!shape(body, ['model', 'max_tokens', 'thinking', 'output_config', 'stream', 'system', 'messages']) ||
      body.model !== 'claude-sonnet-5-5' || ![4000, 8000, 12000].includes(body.max_tokens) || body.stream !== false ||
      !shape(body.thinking, ['type']) || body.thinking.type !== 'adaptive' ||
      !shape(body.output_config, ['effort', ...(structured ? ['format'] : [])]) || body.output_config.effort !== 'medium' ||
      typeof body.system !== 'string' || !body.system || !Array.isArray(body.messages) || body.messages.length !== 1 ||
      !shape(body.messages[0], ['role', 'content']) || body.messages[0].role !== 'user' ||
      typeof body.messages[0].content !== 'string' || !body.messages[0].content ||
      new TextEncoder().encode(JSON.stringify(body)).length > 750000) throw new Error('Studio probe: request differs from the fixed approved profile.');
  const binding = body.system.match(/\nStructured binding: ([a-z0-9-]+)\/(requirements|assessment|revision|challenge)\.$/);
  if (structured !== Boolean(binding)) throw new Error('Studio probe: missing structured contract or format.');
  if (structured) {
    const [, responseContract, stage] = binding;
    validateAssessmentOutputContract(responseContract, 'anthropic', body.model);
    const format = body.output_config.format;
    const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    if (!shape(format, ['type', 'schema']) || format.type !== 'json_schema' ||
        body.max_tokens !== { requirements: 8000, assessment: 12000, revision: 4000, challenge: 12000 }[stage] ||
        canonical(format.schema) !== canonical(assessmentResponseSchema({ stage, responseContract, user: body.messages[0].content }))) {
      throw new Error('Studio probe: structured schema differs from its exact input targets.');
    }
  }
}

// Serialized into a small local-only module; defaults run solely in the signed-in page.
export async function studioProbeClient({ url, ticket, maxCalls = 2 }, {
  fetcher = fetch, origin = location.origin, signal,
  getSession = () => {
    const state = window.__rkAdminAuth, session = state?.session;
    return session && !state.locked && session.exp > Date.now() && state.lastActivity + 1800000 > Date.now() ? session.token : null;
  },
} = {}) {
  const endpoint = new URL(url);
  if (origin !== 'https://riteshk.work' || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password ||
      !/^[a-f0-9]{64}$/.test(ticket) || ![2, 9].includes(maxCalls)) throw new Error('Studio probe: invalid local connection or Studio origin.');
  const lifetime = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(maxCalls === 9 ? 900000 : 300000)]);
  const initial = getSession();
  const session = () => {
    lifetime.throwIfAborted();
    if (!initial || getSession() !== initial) throw new Error('Studio probe: sign-in expired or changed; no automatic reconnection.');
    return initial;
  };
  const worker = 'https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/ai/';
  const local = async (path, body) => {
    const response = await fetcher(url + path, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Probe-Ticket': ticket }, body: JSON.stringify(body), signal: lifetime });
    if (!response.ok) throw new Error('Studio probe: local acknowledgement failed; do not replay.');
    return response.json();
  };
  try {
    const configured = await fetcher(worker + 'keys', { headers: { Authorization: 'Bearer ' + session() },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([lifetime, AbortSignal.timeout(10000)]) });
    if (!configured.ok || (await configured.json()).providers?.anthropic?.set !== true) throw new Error('Connection unavailable');
    session();
    await local('/ready', { ready: true });
  } catch {
    await local('/unavailable', { unavailable: true });
    throw new Error('Studio probe: the signed-in Anthropic connection is unavailable.');
  }
  const seen = new Set();
  for (;;) {
    try { session(); }
    catch {
      await local('/unavailable', { unavailable: true });
      throw new Error('Studio probe: sign-in expired or changed; no automatic reconnection.');
    }
    const next = await local('/next', {});
    if (next.done === true) return { transportClosed: true, calls: seen.size };
    if (!next.job) {
      await new Promise(resolve => setTimeout(resolve, 250));
      continue;
    }
    const job = next.job;
    if (typeof job.id !== 'string' || seen.has(job.id) || seen.size >= maxCalls ||
        !Number.isSafeInteger(job.expiresAt) || job.expiresAt <= Date.now() || job.expiresAt > Date.now() + 110000) throw new Error('Studio probe: repeated or expired delivery.');
    validateStudioProbeBody(job.body);
    seen.add(job.id);
    let result = { id: job.id, status: 502, body: '' };
    try {
      const response = await fetcher(worker + 'anthropic/messages', { method: 'POST', credentials: 'omit', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(job.body), signal: AbortSignal.any([lifetime, AbortSignal.timeout(Math.max(1, job.expiresAt - Date.now()))]) });
      if (response.ok) {
        const reader = response.body.getReader(), chunks = []; let length = 0;
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            length += item.value.length;
            if (length > 300000) { await reader.cancel(); throw new Error('Response exceeds bound'); }
            chunks.push(item.value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        result = { id: job.id, status: response.status, body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
      } else {
        await response.body?.cancel();
        result.status = response.status;
      }
    } catch {
      // Only a generic unknown outcome leaves the page; upstream errors may contain credentials.
      result = { id: job.id, status: 502, body: '' };
    }
    await local('/result', result);
    if (result.status < 200 || result.status >= 300) throw new Error('Studio probe: provider outcome failed or is unknown; reservation retained, no retry.');
  }
}

export async function startStudioProbeBridge({ signal, maxCalls = 2 } = {}) {
  if (![2, 9].includes(maxCalls)) throw fault('unsupported fixed connection call limit.');
  const ticket = randomBytes(32).toString('hex'), lifetime = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(maxCalls === 9 ? 900000 : 300000)]);
  let ready = false, done = false, closed = false, active = null, calls = 0, base, resolveReady, rejectReady, resolveFinished;
  const connection = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  connection.catch(() => {});
  const abort = () => { rejectReady(lifetime.reason); active?.reject(lifetime.reason); };
  lifetime.addEventListener('abort', abort, { once: true });
  const client = buildSync({ stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    contents: 'import { assessmentResponseSchema, validateAssessmentOutputContract } from "./src/js/resume-assessment-output.mjs";\n' +
      'const validateStudioProbeBody = ' + validateStudioProbeBody.toString() + ';\nexport default ' + studioProbeClient.toString() + ';\n' },
    bundle: true, platform: 'browser', format: 'esm', write: false }).outputFiles[0].text;
  const server = createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.headers.host !== new URL(base).host || request.headers.origin !== STUDIO_ORIGIN) throw fault('origin or host denied.', 403);
      response.setHeader('Access-Control-Allow-Origin', STUDIO_ORIGIN);
      response.setHeader('Vary', 'Origin');
      const path = new URL(request.url, base).pathname;
      if (!['/ready', '/next', '/result', '/unavailable', '/client.mjs'].includes(path)) throw fault('unknown route.', 404);
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', path === '/client.mjs' ? 'GET' : 'POST');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Probe-Ticket');
        if (request.headers['access-control-request-private-network'] === 'true') response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.writeHead(204); return response.end();
      }
      if (path === '/client.mjs' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' }); return response.end(client);
      }
      if (request.method !== 'POST' || request.headers['x-probe-ticket'] !== ticket) throw fault('connection ticket or method denied.', 403);
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 750000) throw fault('body exceeds bound.', 413); chunks.push(chunk); }
      lifetime.throwIfAborted();
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const exact = keys => value && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
      if (path === '/unavailable') {
        if (!exact(['unavailable']) || value.unavailable !== true) throw fault('unexpected connection failure.');
        done = true;
        const error = fault('Studio connection unavailable; no automatic reconnection.');
        rejectReady(error); active?.reject(error); active = null;
        return send(200, { stopped: true });
      }
      if (path === '/ready') {
        if (!exact(['ready']) || value.ready !== true || ready || done) throw fault('connection already claimed or invalid.');
        ready = true; resolveReady(); return send(200, { ready: true });
      }
      if (!ready) throw fault('connect before requesting work.');
      if (path === '/next') {
        if (!exact([])) throw fault('unexpected poll fields.');
        if (done) { send(200, { done: true }); resolveFinished?.(); return; }
        const job = active && !active.delivered ? active : null;
        if (job) job.delivered = true;
        return send(200, { job: job ? { id: job.id, body: job.body, expiresAt: job.expiresAt } : null });
      }
      if (!exact(['id', 'status', 'body']) || !active || !active.delivered || value.id !== active.id ||
          !Number.isInteger(value.status) || value.status < 200 || value.status > 599 ||
          typeof value.body !== 'string' || new TextEncoder().encode(value.body).length > 300000) throw fault('unexpected or repeated response.');
      const receipt = new Response(value.body || null, { status: value.status });
      const job = active; active = null;
      send(200, { accepted: true });
      job.resolve(receipt);
    } catch (error) {
      send(error.status || 400, { error: error.status ? error.message : 'Studio probe: invalid or interrupted local request.' });
    }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
  return {
    descriptor: { url: base, ticket, ...(maxCalls === 9 ? { maxCalls } : {}) },
    async preflight() { await awaitAssessment(connection, AbortSignal.any([lifetime, AbortSignal.timeout(120000)])); },
    async fetcher(url, options) {
      if (!ready || done || active || calls >= maxCalls || url !== 'https://api.anthropic.com/v1/messages' || options.method !== 'POST' ||
          new Headers(options.headers).get('x-api-key') !== STUDIO_KEY_PLACEHOLDER) throw fault('unexpected or unconnected provider request.');
      const body = JSON.parse(options.body); validateStudioProbeBody(body);
      const callSignal = AbortSignal.any([lifetime, options.signal, AbortSignal.timeout(110000)]);
      callSignal.throwIfAborted(); calls++;
      const pending = new Promise((resolve, reject) => { active = { id: randomUUID(), body, expiresAt: Date.now() + 110000, delivered: false, resolve, reject }; });
      try { return await awaitAssessment(pending, callSignal); }
      catch (error) { done = true; active = null; throw error; }
    },
    async close() {
      if (closed) return;
      closed = true;
      done = true;
      const error = fault('connection closed; inspect retained state, never replay.');
      rejectReady(error); active?.reject(error); active = null;
      lifetime.removeEventListener('abort', abort);
      if (ready && !lifetime.aborted) await new Promise(resolve => {
        const timer = setTimeout(resolve, 1000);
        resolveFinished = () => { clearTimeout(timer); resolve(); };
      });
      const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closing;
    },
  };
}
