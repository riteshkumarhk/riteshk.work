import { resumeFields, resumeSignature } from '../src/js/resume-workspace.mjs';
import { renderResumeHtml, RESUME_FONTS, RESUME_RENDER_VERSION } from '../src/js/resume-render.mjs';
import { verifyResumePdf } from '../src/js/resume-pdf.mjs';

const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const identity = value => {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value || '')) throw fault('Invalid resume identity.');
  return value;
};
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const metadata = { httpMetadata: { contentType: 'application/json' } };

export function createHostedResumeStore(bucket) {
  if (!bucket) throw fault('Resume storage is not configured.', 503);
  const documentKey = id => 'documents/' + identity(id) + '.json';
  async function read(id) {
    const object = await bucket.get(documentKey(id));
    if (!object) throw fault('Resume not found.', 404);
    return { record: await object.json(), etag: object.etag };
  }
  function validate(document) {
    identity(document?.id);
    if (document.schema !== 1 || !Array.isArray(document.sourceIds) || document.sourceIds.some(id => !/^[a-f0-9]{64}$/.test(id))) throw fault('Invalid resume document.');
    if (JSON.stringify(document).length > 1000000) throw fault('This resume exceeds the document size limit.', 413);
    if (typeof document.name !== 'string' || !document.target || !document.design || !document.model) throw fault('Invalid resume document.');
    const { design, target, model } = document;
    if (!Object.hasOwn(RESUME_FONTS, design.font) || !['a4', 'letter'].includes(design.size) || !['normal', 'narrow'].includes(design.margin) || !['normal', 'compact', 'airy'].includes(design.density) || !['single', 'sidebar', 'hybrid'].includes(design.layout) || typeof design.keepWhole !== 'boolean' || !/^#[a-f0-9]{6}$/i.test(design.accent)) throw fault('Invalid resume design.');
    if (['company', 'role', 'level', 'jd'].some(key => typeof target[key] !== 'string') || !Array.isArray(model.sections) || !Array.isArray(model.contact?.links)) throw fault('Invalid resume fields.');
    for (const [key, minimum, maximum] of [['bodySize', 8, 14], ['lineHeight', 1.15, 1.8], ['pageLimit', 1, 50]]) {
      if (design[key] != null && (!Number.isFinite(design[key]) || design[key] < minimum || design[key] > maximum || (key === 'pageLimit' && !Number.isInteger(design[key])))) throw fault('Invalid resume typography or page limit.');
    }
    if (model.sections.some(section => section.columns != null && ![1, 2, 3].includes(section.columns))) throw fault('Invalid resume entry columns.');
    try {
      for (const field of resumeFields(model)) {
        const value = field.owner[field.key];
        if (field.key === 'items' ? !Array.isArray(value) || value.some(item => typeof item !== 'string') : value != null && typeof value !== 'string') throw fault('Invalid resume fields.');
      }
      resumeSignature(document);
    } catch { throw fault('Invalid resume fields.'); }
  }
  async function put(record, etag = null) {
    const text = JSON.stringify(record);
    if (text.length > 16 * 1024 * 1024) throw fault('This resume history is full. Duplicate it to continue; no earlier versions were removed.', 413);
    const result = await bucket.put(documentKey(record.document.id), text, { ...metadata, onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' } });
    if (!result) throw fault('A newer version was saved. Compare your local copy before replacing it.', 409);
    return record;
  }
  async function objects(prefix) {
    const found = []; let cursor;
    do {
      const result = await bucket.list({ prefix, cursor }); found.push(...result.objects);
      if (found.length > 500) throw fault('This workspace exceeds the listing limit. No items were silently omitted.', 413);
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
    return found;
  }
  return {
    async list() {
      const documents = [], sources = [];
      for (const object of await objects('documents/')) {
        const { document, version, versions, exports } = await (await bucket.get(object.key)).json();
        documents.push({ document, version, versionCount: versions.length, exports });
      }
      for (const object of await objects('sources/meta/')) sources.push(await (await bucket.get(object.key)).json());
      return { documents, sources };
    },
    async get(id) { return (await read(id)).record; },
    async create(document) {
      validate(document);
      for (const id of document.sourceIds) if (!await bucket.head('sources/meta/' + id + '.json')) throw fault('A source is missing.');
      const snapshot = structuredClone(document), at = Date.now();
      return put({ document: snapshot, version: 1, versions: [{ number: 1, at, label: 'Created resume', document: snapshot }], exports: [] });
    },
    async save(id, document, expected, label = 'Edited resume') {
      validate(document);
      if (id !== document.id || !Number.isInteger(Number(expected)) || Number(expected) < 1) throw fault('Document identity or version is invalid.');
      const { record, etag } = await read(id);
      if (record.version !== Number(expected)) throw fault('A newer version was saved. Your edits are kept locally.', 409);
      for (const sourceId of document.sourceIds) if (!await bucket.head('sources/meta/' + sourceId + '.json')) throw fault('A source is missing.');
      const snapshot = structuredClone(document); snapshot.updatedAt = Date.now();
      record.version++; record.document = snapshot;
      record.versions.push({ number: record.version, at: Date.now(), label: String(label).slice(0, 120), document: snapshot });
      return put(record, etag);
    },
    async restore(id, number, expected) {
      const record = await this.get(id), version = record.versions.find(item => item.number === Number(number));
      if (!version) throw fault('Version not found.', 404);
      return this.save(id, version.document, expected, 'Restored version ' + number);
    },
    async source(source, bytes) {
      if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024 || typeof source.text !== 'string' || source.text.length > 120000) throw fault('Source exceeds the supported size.', 413);
      const id = await hash(bytes), key = 'sources/meta/' + id + '.json';
      const existing = await bucket.get(key); if (existing) return existing.json();
      const entry = { id, sha256: id, name: String(source.name).slice(0, 160), type: String(source.type || 'application/octet-stream').slice(0, 100), text: source.text, size: bytes.byteLength, at: Date.now() };
      await bucket.put('sources/bytes/' + id, bytes, { onlyIf: { etagDoesNotMatch: '*' } });
      const written = await bucket.put(key, JSON.stringify(entry), { ...metadata, onlyIf: { etagDoesNotMatch: '*' } });
      return written ? entry : (await bucket.get(key)).json();
    },
    async sourceFile(id) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw fault('Source not found.', 404);
      const meta = await bucket.get('sources/meta/' + id + '.json'), bytes = await bucket.get('sources/bytes/' + id);
      if (!meta || !bytes) throw fault('Source not found.', 404);
      return { source: await meta.json(), bytes: await bytes.arrayBuffer() };
    },
    async export(id, entry, bytes, expected, signature) {
      const { record, etag } = await read(id);
      if (record.version !== Number(expected) || resumeSignature(record.document) !== signature) throw fault('The resume changed while rendering. Export the current version.', 409);
      if (!entry.verification?.complete || !entry.layoutBoundsVerified || entry.sha256 !== await hash(bytes)) throw fault('PDF verification is incomplete.', 422);
      identity(entry.id);
      await bucket.put('exports/' + id + '/' + entry.id, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/pdf' } });
      record.exports.push(entry); await put(record, etag); return entry;
    },
    async exportFile(id, exportId) {
      identity(exportId);
      const record = await this.get(id), entry = record.exports.find(item => item.id === exportId);
      if (!entry) throw fault('Export not found.', 404);
      const bytes = await bucket.get('exports/' + id + '/' + exportId);
      if (!bytes) throw fault('Export bytes not found.', 404);
      return { entry, bytes: await bytes.arrayBuffer() };
    }
  };
}

export async function resumeWorkspaceRoute(request, bucket, headers, browser = null, fetchAsset = fetch) {
  const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  try {
    const store = createHostedResumeStore(bucket), url = new URL(request.url);
    const parts = url.pathname.slice('/admin/resume/'.length).split('/'), expected = request.headers.get('If-Match');
    const body = async () => {
      if (Number(request.headers.get('Content-Length')) > 30 * 1024 * 1024) throw fault('Upload is too large.', 413);
      const reader = request.body?.getReader(); if (!reader) throw fault('Missing request body.');
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 30 * 1024 * 1024) { await reader.cancel(); throw fault('Upload is too large.', 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fault('Invalid JSON.'); }
    };
    if (request.method === 'GET' && parts.join('/') === 'library') return reply(await store.list());
    if (request.method === 'POST' && parts.join('/') === 'resumes') return reply(await store.create((await body()).document));
    if (request.method === 'POST' && parts.join('/') === 'sources') {
      const input = await body();
      if (typeof input.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw fault('Invalid source bytes.');
      return reply(await store.source(input, Uint8Array.from(atob(input.base64), character => character.charCodeAt(0))));
    }
    if (request.method === 'GET' && parts[0] === 'sources' && parts.length === 2) {
      const { source, bytes } = await store.sourceFile(parts[1]);
      return new Response(bytes, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="' + source.name.replace(/[^a-z0-9 ._-]/gi, '') + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (parts[0] === 'resumes' && parts.length === 2) {
      if (request.method === 'GET') return reply(await store.get(parts[1]));
      if (request.method === 'PUT') { const input = await body(); return reply(await store.save(parts[1], input.document, expected, input.label)); }
    }
    if (request.method === 'POST' && parts[0] === 'resumes' && parts[2] === 'restore' && parts.length === 3) return reply(await store.restore(parts[1], (await body()).number, expected));
    if (request.method === 'POST' && parts[0] === 'resumes' && parts[2] === 'export' && parts.length === 3) {
      const record = await store.get(parts[1]), document = record.document, signature = resumeSignature(document);
      if (record.version !== Number(expected)) throw fault('Save the current version before exporting.', 409);
      const existing = record.exports.findLast(entry => entry.signature === signature && entry.renderVersion === RESUME_RENDER_VERSION);
      if (existing) return reply({ entry: existing });
      if (!browser) throw fault('Checked PDF rendering is not configured.', 503);
      if (!RESUME_FONTS[document.design.font]) throw fault('The selected font is unavailable. Nothing was substituted.', 422);
      let fontCss = '';
      const fonts = [...new Set([document.design.font, 'inter'])];
      for (const key of fonts) {
        const font = RESUME_FONTS[key];
        for (const file of font.files) {
          const response = await fetchAsset('https://riteshk.work/fonts/' + file);
          if (!response.ok) throw fault('A required font is unavailable. Nothing was substituted.', 422);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length > 512 * 1024 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'wOF2') throw fault('A required font could not be verified.', 422);
          let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          const weight = key === 'gambetta' ? '300 700' : file.match(/normal-(\d+)-/)[1];
          fontCss += "@font-face{font-family:'" + font.family + "';font-style:normal;font-weight:" + weight + ";src:url(data:font/woff2;base64," + btoa(binary) + ") format('woff2')}";
        }
      }
      const html = renderResumeHtml(document, { base: 'https://riteshk.work/' }).replace('<link rel="stylesheet" href="/css/fonts.css">', '<style>' + fontCss + '</style>').replace('</head>', '<style>body{visibility:hidden}html[data-resume-verified] body{visibility:visible}</style></head>');
      const result = await browser.quickAction('pdf', { html, waitForSelector: { selector: 'html[data-resume-verified]', timeout: 30000 }, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 30000 }, allowRequestPattern: ['^https://riteshk\\.work/(fonts/[a-zA-Z0-9._-]+\\.woff2|css/fonts\\.css|studio/resume-preview/assets/paged\\.polyfill\\.js)$'], pdfOptions: { format: document.design.size === 'letter' ? 'letter' : 'a4', printBackground: true, preferCSSPageSize: true } });
      if (!result.ok) throw fault('PDF rendering failed. No export was saved.', 502);
      const bytes = new Uint8Array(await result.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw fault('The renderer did not return a supported PDF.', 422);
      const current = await store.get(parts[1]);
      if (current.version !== record.version) throw fault('The resume changed while rendering. Export the current version.', 409);
      const pending = { id: crypto.randomUUID(), documentId: document.id, version: record.version, signature, sha256: await hash(bytes), at: Date.now(), renderVersion: RESUME_RENDER_VERSION };
      await bucket.put('pending/' + pending.id + '.pdf', bytes);
      await bucket.put('pending/' + pending.id + '.json', JSON.stringify(pending), metadata);
      let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return reply({ pending, base64: btoa(binary) });
    }
    if (request.method === 'POST' && parts[0] === 'resumes' && parts[2] === 'finalize' && parts.length === 3) {
      const input = await body(), pendingId = identity(input.id), object = await bucket.get('pending/' + pendingId + '.json');
      if (!object) throw fault('The pending PDF is unavailable. Export again.', 404);
      const pending = await object.json(), record = await store.get(parts[1]);
      if (pending.documentId !== parts[1]) throw fault('The pending PDF belongs to another resume.', 404);
      if (Date.now() - pending.at > 15 * 60000) {
        await bucket.delete(['pending/' + pendingId + '.json', 'pending/' + pendingId + '.pdf']);
        throw fault('PDF verification expired. Export again.', 409);
      }
      if (pending.version !== Number(expected) || pending.signature !== resumeSignature(record.document) || record.version !== Number(expected)) throw fault('The resume changed. Export the current version.', 409);
      if (pending.sha256 !== input.sha256) throw fault('PDF bytes did not match the rendered artifact.', 422);
      const checked = verifyResumePdf(record.document, input.positions, input.links, input.expectedPages);
      const artifact = await bucket.get('pending/' + pendingId + '.pdf');
      if (!artifact) throw fault('The pending PDF is unavailable. Export again.', 404);
      const bytes = new Uint8Array(await artifact.arrayBuffer());
      const entry = { ...checked, id: pendingId, at: Date.now(), version: record.version, signature: pending.signature, sha256: pending.sha256, bytes: bytes.length, renderVersion: RESUME_RENDER_VERSION, font: record.document.design.font, size: record.document.design.size, name: record.document.name.replace(/[^a-z0-9 -]/gi, '').trim() + '.pdf', verificationMethod: 'browser-pdfjs-and-worker-v1' };
      await store.export(parts[1], entry, bytes, expected, pending.signature);
      await bucket.delete(['pending/' + pendingId + '.json', 'pending/' + pendingId + '.pdf']);
      return reply(entry);
    }
    if (request.method === 'GET' && parts[0] === 'resumes' && parts[2] === 'exports' && parts.length === 4) {
      const { entry, bytes } = await store.exportFile(parts[1], parts[3]);
      return new Response(bytes, { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + entry.name.replace(/[^a-z0-9 ._-]/gi, '') + '"', 'Cache-Control': 'no-store' } });
    }
    throw fault('Resume route not found.', 404);
  } catch (error) { return reply({ error: error.status ? error.message : 'Resume storage is unavailable. Your local copy has not been replaced.' }, error.status || 503); }
}