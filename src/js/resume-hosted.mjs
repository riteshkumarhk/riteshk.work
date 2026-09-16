import { verifyResumePdf } from './resume-pdf.mjs';

export function createHostedResumeClient({ request, ai, storage = localStorage }) {
  let adapter = null;
  const budgetKey = 'rk:resume:active-review-budget';
  async function send(path, options = {}) {
    const response = await request(path, options);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw Object.assign(new Error(failure.error || 'Private resume storage is unavailable.'), { status: response.status });
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
      const id = path.split('/')[1], record = await (await send('resumes/' + id)).json();
      const bytes = Uint8Array.from(atob(result.base64), character => character.charCodeAt(0));
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (sha256 !== result.pending.sha256 || record.version !== result.pending.version) throw new Error('The document or rendered bytes changed. Export again.');
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/build/pdf.mjs');
      GlobalWorkerOptions.workerSrc = '/studio/resume-preview/assets/pdf.worker.mjs';
      const pdf = await getDocument({ data: bytes }).promise, positions = [], links = [];
      try {
        for (let number = 1; number <= pdf.numPages; number++) {
          if (pdf.numPages > 50) throw new Error('PDF exceeds the supported page count.');
          const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 }), text = await page.getTextContent();
          positions.push({ width: viewport.width, height: viewport.height, items: text.items.filter(item => item.str).map(item => ({ str: item.str, x: item.transform[4], y: viewport.height - item.transform[5], w: item.width, h: item.height })) });
          links.push(...(await page.getAnnotations()).filter(item => item.subtype === 'Link').map(item => item.url || item.unsafeUrl));
        }
      } finally { await pdf.destroy(); }
      const expectedPages = Number(options.headers?.['X-Resume-Pages']) || null;
      verifyResumePdf(record.document, positions, links, expectedPages);
      return (await send('resumes/' + id + '/finalize', { method: 'POST', headers: options.headers, body: JSON.stringify({ id: result.pending.id, sha256, expectedPages, positions, links }) })).json();
    },
    async file(path, type) {
      const response = await send(path);
      return new Blob([await response.arrayBuffer()], { type });
    }
  };
}