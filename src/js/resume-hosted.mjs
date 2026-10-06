import { readResumePdf, verifyResumePdf } from './resume-pdf.mjs';

export const RESUME_CANVAS_STORAGE_KEY = 'rk:resume-preview:canvas';

export function readResumeCanvasMode() {
  try { return localStorage.getItem(RESUME_CANVAS_STORAGE_KEY) === 'light' ? 'light' : 'dark'; }
  catch (error) { console.warn('Resume canvas preference could not be read.', error); return 'dark'; }
}

export function saveResumeCanvasMode(mode) {
  try { localStorage.setItem(RESUME_CANVAS_STORAGE_KEY, mode); }
  catch (error) { console.warn('Resume canvas preference could not be saved.', error); }
}

export function observeResumeViewControls(tools, banners, frame = null) {
  const canvas = tools.parentElement;
  function fit() {
    const controls = tools.getBoundingClientRect(), bottom = canvas.getBoundingClientRect().bottom - 12;
    let lift = 0;
    for (const banner of banners) {
      if (banner.hidden || !banner.getClientRects().length) continue;
      const notice = banner.getBoundingClientRect();
      const offset = banner.ownerDocument !== tools.ownerDocument ? frame?.getBoundingClientRect() : null;
      const left = notice.left - (offset?.left || 0), right = notice.right - (offset?.left || 0);
      const top = notice.top - (offset?.top || 0), end = notice.bottom - (offset?.top || 0);
      if (controls.right > left - 12 && controls.left < right + 12 &&
          bottom > top - 12 && bottom - controls.height < end + 12) {
        lift = Math.max(lift, bottom - top + 12);
      }
    }
    canvas.style.setProperty('--resume-view-controls-lift', lift + 'px');
  }
  const observer = new ResizeObserver(fit);
  [canvas, tools, ...banners, frame].filter(Boolean).forEach(element => observer.observe(element));
  fit();
  return { fit, dispose() { observer.disconnect(); canvas.style.removeProperty('--resume-view-controls-lift'); } };
}

export function resumeSaveFailureFeedback({ status, offline = false } = {}) {
  if (status === 401) return { message: 'Sign in again to save your changes.', actionLabel: '' };
  if (status === 403) return { message: "You don't have permission to save these changes.", actionLabel: '' };
  const message = offline ? "You're offline. Reconnect to save."
    : status === 429 ? "Changes weren't saved. Try again shortly."
    : status >= 500 && status <= 599 ? "Changes weren't saved. Try again later."
    : 'Save not confirmed. Try again.';
  return { message, actionLabel: 'Retry' };
}

export function createHostedResumeClient({ request, ai, storage = localStorage }) {
  let adapter = null;
  const budgetKey = 'rk:resume:active-review-budget';
  async function send(path, options = {}) {
    const response = await request(path, options);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw Object.assign(new Error(failure.error || 'Private resume storage is unavailable.'), { status: response.status, code: failure.code, resumeId: failure.resumeId });
    }
    return response;
  }
  async function configuration() {
    if (adapter) return adapter.configuration();
    const catalog = await ai.models();
    const saved = JSON.parse(storage.getItem(budgetKey) || 'null');
    if (saved && saved.provider === catalog.provider) {
      const selected = catalog.models.find(model => model.id === saved.model);
      if (selected) {
        adapter = await ai.connect({ ...saved, pricing: { ...selected.pricing, checkedAt: catalog.checkedAt } });
        return adapter.configuration();
      }
    }
    return { available: false, ...catalog };
  }
  return {
    async api(path, options = {}) {
      if (path === 'ai/config') return configuration();
      if (path === 'ai/connect') {
        const input = JSON.parse(options.body), catalog = await ai.models(), selected = catalog.models.find(model => model.id === input.model);
        if (!selected || !input.approved || !Number.isFinite(selected.pricing?.input) || !Number.isFinite(selected.pricing?.output)) throw new Error('Approve a model with verified pricing first.');
        const saved = JSON.parse(storage.getItem(budgetKey) || 'null');
        const connection = saved ? { ...saved, model: selected.id, provider: catalog.provider } : { model: selected.id, provider: catalog.provider, budgetId: crypto.randomUUID(), maxCost: 1 };
        adapter = await ai.connect({ ...connection, pricing: { ...selected.pricing, checkedAt: catalog.checkedAt } });
        storage.setItem(budgetKey, JSON.stringify(connection));
        return adapter.configuration();
      }
      if (path === 'ai/complete') {
        if (!adapter) await configuration();
        if (!adapter) throw new Error('Authorize the review budget first.');
        const input = JSON.parse(options.body), config = adapter.configuration();
        if (input.provider !== config.provider || input.model !== config.model) throw new Error('The selected model changed. Review consent again.');
        return { text: await adapter.complete({ ...input, signal: options.signal }) };
      }
      const result = await (await send(path, options)).json();
      if (!/^resumes\/[a-zA-Z0-9_-]+\/export$/.test(path) || options.method !== 'POST') return result;
      if (result.entry) return result.entry;
      const id = path.split('/')[1], record = await (await send('resumes/' + id, { signal: options.signal })).json();
      const bytes = Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      const snapshot = result.pending.transient ? record.versions.find(entry => entry.number === result.pending.version)?.document : record.document;
      if (!snapshot || sha256 !== result.pending.sha256 || record.version !== (result.pending.expectedVersion ?? result.pending.version)) throw new Error('The document or rendered bytes changed. Export again.');
      const { pages: positions, links } = await readResumePdf(bytes, { signal: options.signal });
      const expectedPages = Number(options.headers?.['X-Resume-Pages']) || null;
      verifyResumePdf(snapshot, positions, links, expectedPages);
      const entry = await (await send('resumes/' + id + '/finalize', { method: 'POST', headers: options.headers, signal: options.signal, body: JSON.stringify({ id: result.pending.id, sha256, expectedPages, positions, links }) })).json();
      return entry.transient ? { ...entry, base64: result.base64 } : entry;
    },
    async file(path, type, options = {}) {
      const response = await send(path, options);
      return new Blob([await response.arrayBuffer()], { type });
    }
  };
}