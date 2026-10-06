import { randomUUID } from 'node:crypto';
import { AI_AGENT_LIMITS } from '../src/js/ai-task-agent.mjs';
import { awaitAssessment } from '../src/js/resume-assessment-evaluator.mjs';
import { baselineCodeFingerprint } from './resume-baseline-accounting.mjs';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const fail = message => { throw new Error('Baseline Studio: ' + message); };

export async function connectBaselineStudio(page, { document, exportId, signal } = {}) {
  const url = page.url(), location = new URL(url);
  if (location.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) ||
      location.username || location.password || !document || typeof exportId !== 'string' || !exportId) {
    fail('an existing local candidate Studio, saved document and export identity are required.');
  }
  signal?.throwIfAborted();
  const codeSha256 = await baselineCodeFingerprint();
  const binding = '__rkBaseline_' + randomUUID().replaceAll('-', '');
  const controller = new AbortController();
  const lifetime = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
  let closed = false, attempted = false, store, runId, inputSha256;
  const context = await page.evaluateHandle(({ document, exportId, binding, codeSha256 }) => {
    const baseline = window.__RKStudio?.resume?.baseline;
    const frame = window.document.querySelector('iframe.adm__resume-host');
    const auth = () => {
      const state = window.__rkAdminAuth, session = state?.session;
      return session && !state.locked && session.exp > Date.now() && state.lastActivity + 1800000 > Date.now() ? session.token : null;
    };
    const initialSession = auth(), caller = frame?.contentWindow, url = location.href;
    if (baseline?.version !== 1 || typeof baseline.prepare !== 'function' || typeof baseline.assess !== 'function') {
      throw new Error('Baseline Studio: version1 capability is required; old bundles cannot execute.');
    }
    if (baseline.sourceSha256 !== codeSha256) throw new Error('Baseline Studio: loaded bundle differs from the reviewed runtime; no stale execution.');
    if (!caller || !initialSession) throw new Error('Baseline Studio: an existing unlocked saved-Resume session is required.');
    const controller = new AbortController();
    const check = () => {
      controller.signal.throwIfAborted();
      if (location.href !== url || window.__RKStudio?.resume?.baseline !== baseline ||
          !frame.isConnected || frame.contentWindow !== caller || auth() !== initialSession) {
        throw new Error('Baseline Studio: page, capability, frame or owner session changed; no reconnection.');
      }
    };
    const calls = new Map();
    const call = async (op, payload, send, signal) => {
      check();
      const callController = new AbortController();
      const lifetime = AbortSignal.any([controller.signal, callController.signal, ...(signal ? [signal] : [])]);
      lifetime.throwIfAborted();
      const id = crypto.randomUUID();
      calls.set(id, { op, payload, send, check, controller: callController, signal: lifetime });
      try {
        const result = await window[binding](id);
        check(); lifetime.throwIfAborted();
        return result;
      } finally { calls.delete(id); }
    };
    const embedding = async (request, signal) => {
      check();
      const path = request.provider === 'openai' ? 'openai/embeddings' :
        request.provider === 'gemini' ? 'gemini/models/' + encodeURIComponent(request.model) + ':batchEmbedContents' : null;
      if (!path || request.kind !== 'embedding') throw new Error('Baseline Studio: unsupported embedding transport.');
      return fetch('https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/ai/' + path, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth() }, body: request.body,
      });
    };
    const accounting = {
      verifyConfiguration: snapshot => call('configuration', snapshot),
      verifyInput: input => call('input', input),
      semantic: (text, jd, signal) => call('semantic', [text, jd], embedding, signal),
      request: async (request, send, signal) => {
        const value = await call('request', request, send, signal);
        const bytes = Uint8Array.from(atob(value.body), character => character.charCodeAt(0));
        return new Response([204, 205, 304].includes(value.status) ? null : bytes, { status: value.status, headers: value.headers });
      },
    };
    return { controller, check, calls,
      prepare: async () => { check(); const value = await baseline.prepare(document, exportId, caller, controller.signal); check(); return value; },
      assess: async () => { check(); const value = await baseline.assess(document, exportId, caller, accounting, controller.signal); check(); return value; },
    };
  }, { document, exportId, binding, codeSha256 });
  const assertOpen = () => {
    lifetime.throwIfAborted();
    if (closed || page.isClosed() || page.url() !== url) fail('connection closed or navigated; no reconnection.');
  };
  const send = async (handle, request, signal) => {
    const abort = () => { void handle.evaluate(call => call.controller.abort(new Error('Baseline Studio: transport cancelled.'))).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      assertOpen(); signal.throwIfAborted();
      const receipt = await awaitAssessment(handle.evaluate(async (call, request) => {
        call.check(); call.signal.throwIfAborted();
        let response, reader;
        try {
          response = request ? await call.send(request, call.signal) : await call.send(call.signal);
          if (!(response instanceof Response)) throw new Error('Invalid response');
          const chunks = []; let length = 0;
          reader = response.body?.getReader();
          if (reader) for (;;) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 8 * 1024 * 1024) throw new Error('Oversized response');
            chunks.push(next.value);
          }
          call.check(); call.signal.throwIfAborted();
          let binary = '';
          for (const chunk of chunks) for (let offset = 0; offset < chunk.length; offset += 8192) {
            binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
          }
          const headers = {};
          for (const name of ['content-type', 'request-id', 'x-request-id']) {
            const value = response.headers.get(name);
            if (value !== null) headers[name] = value;
          }
          return { status: response.status, headers, body: btoa(binary) };
        } catch {
          call.controller.abort();
          if (reader) void reader.cancel().catch(() => {});
          throw new Error('Baseline Studio: provider outcome unavailable or unknown; no replay.');
        } finally { reader?.releaseLock(); }
      }, request), signal);
      const bytes = Buffer.from(receipt.body, 'base64');
      if (bytes.length > MAX_RESPONSE_BYTES) fail('response exceeds the receipt bound.');
      return new Response([204, 205, 304].includes(receipt.status) ? null : bytes, { status: receipt.status, headers: receipt.headers });
    } finally { signal.removeEventListener('abort', abort); }
  };
  let registration;
  try {
    registration = await page.exposeBinding(binding, async (source, id) => {
      assertOpen();
      if (source.page !== page || source.frame !== page.mainFrame() || !store || typeof id !== 'string') fail('unexpected or unenrolled caller.');
      const handle = await context.evaluateHandle((value, id) => {
        if (!value.calls.has(id)) throw new Error('Baseline Studio: unknown operation.');
        return value.calls.get(id);
      }, id);
      try {
        const { op, payload } = await handle.evaluate(call => {
          call.check(); call.signal.throwIfAborted();
          return { op: call.op, payload: call.payload };
        });
        if (op === 'configuration') return await store.verifyConfiguration(payload);
        if (op === 'input') return await store.verifyInput(runId, inputSha256, payload);
        if (op === 'semantic') return await store.semantic(runId, inputSha256, payload, (request, signal) => send(handle, request, signal), lifetime);
        if (op !== 'request') fail('unknown accounting operation.');
        const response = await store.dispatch(runId, inputSha256, payload, signal => send(handle, null, signal), lifetime);
        return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()).toString('base64') };
      } finally { await handle.dispose(); }
    });
  } catch (error) {
    await context.dispose();
    throw error;
  }
  const abort = () => { void context.evaluate(value => value.controller.abort(new Error('Baseline Studio: connection cancelled.'))).catch(() => {}); };
  lifetime.addEventListener('abort', abort, { once: true });
  if (lifetime.aborted) abort();
  return {
    async prepare() {
      assertOpen();
      if (attempted) fail('preparation cannot be repeated after an execution attempt.');
      return await awaitAssessment(context.evaluate(value => value.prepare()), lifetime);
    },
    async assess(accounting, identity) {
      assertOpen();
      if (attempted) fail('this connection has already attempted execution; no replay.');
      attempted = true;
      if (await baselineCodeFingerprint() !== codeSha256) fail('source changed since connection preparation.');
      store = accounting; ({ runId, inputSha256 } = identity);
      const status = await store.status(), run = status.runs.find(item => item.id === runId);
      if (!run || run.inputSha256 !== inputSha256 || run.status !== 'open' || run.attempts.length) fail('a fresh, explicitly approved and reserved run is required.');
      const timeout = setTimeout(() => controller.abort(new Error('Baseline Studio: run timed out; reservation retained.')), AI_AGENT_LIMITS.milliseconds);
      try {
        const result = await awaitAssessment(context.evaluate(value => value.assess()), lifetime);
        assertOpen();
        await store.finish(runId, true);
        return result;
      } catch (error) {
        controller.abort(error);
        try {
          const status = await store.status();
          if (status.runs.find(item => item.id === runId)?.status === 'open') await store.finish(runId, false);
        } catch (storageError) {
          throw new AggregateError([error, storageError], 'Baseline Studio: run failed and closeout requires audit; no replay or refund.');
        }
        throw error;
      } finally { clearTimeout(timeout); store = null; }
    },
    async close() {
      if (closed) return;
      closed = true; controller.abort(new Error('Baseline Studio: connection closed.'));
      lifetime.removeEventListener('abort', abort);
      try {
        await registration.dispose();
      } finally { await context.dispose(); }
    },
  };
}
