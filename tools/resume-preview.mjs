import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { sampleResumes, SAMPLE_EVIDENCE } from '../src/js/resume-sample.mjs';
import { resumeSignature, validatePdfText, resumeFields } from '../src/js/resume-workspace.mjs';
import { renderResumeHtml, RESUME_FONTS, RESUME_RENDER_VERSION } from '../src/js/resume-render.mjs';
import { atsParseLayout } from '../src/js/ats-core.js';
import { cornerEnginePlugin } from '../slide-lab-engine.mjs';
import { mergerThemePlugin } from '../slide-merge-theme.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (message, status = 400) => Object.assign(new Error(message), { status });

export function createPreviewStore(directory) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'library.json');
  const write = data => { const temporary = file + '.tmp'; writeFileSync(temporary, JSON.stringify(data)); renameSync(temporary, file); };
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  if (!existsSync(file)) {
    const bytes = Buffer.from(SAMPLE_EVIDENCE), id = digest(bytes);
    writeFileSync(join(directory, id), bytes);
    const source = { id, name: 'Career evidence - fictional sample.txt', type: 'text/plain', text: SAMPLE_EVIDENCE, size: bytes.length, sha256: id, at: Date.now() };
    const documents = sampleResumes(id).map(document => ({ document, version: 1, versions: [{ number: 1, label: 'Created from sample evidence', at: Date.now(), document }], exports: [] }));
    write({ documents, sources: [source] });
  }
  const find = (data, id) => { const record = data.documents.find(record => record.document.id === id); if (!record) throw fault('Resume not found.', 404); return record; };
  const check = (record, expected) => { if (record.version !== Number(expected)) throw fault('A newer version was saved in another tab. Your edits are kept here; compare before replacing.', 409); };
  return {
    list() { const data = read(); return { documents: data.documents.map(({ document, version, exports, versions }) => ({ document, version, exports, versionCount: versions.length })), sources: data.sources }; },
    get(id) { return find(read(), id); },
    create(document) { const data = read(); if (data.documents.some(record => record.document.id === document.id)) throw fault('This resume already exists.', 409); const record = { document, version: 1, versions: [{ number: 1, at: Date.now(), label: 'Created resume', document }], exports: [] }; data.documents.push(record); write(data); return record; },
    save(id, document, expected, label = 'Edited resume') { const data = read(), record = find(data, id); check(record, expected); if (document.id !== id || document.schema !== 1) throw fault('Document identity mismatch.'); resumeFields(document.model); if (JSON.stringify(document).length > 1000000) throw fault('This resume is too large for the sample.'); document = structuredClone(document); document.updatedAt = Date.now(); record.version++; record.document = document; record.versions.push({ number: record.version, at: Date.now(), label: String(label).slice(0, 120), document }); write(data); return record; },
    restore(id, number, expected) { const record = this.get(id); const version = record.versions.find(version => version.number === Number(number)); if (!version) throw fault('Version not found.', 404); return this.save(id, version.document, expected, 'Restored version ' + number); },
    source(source, bytes) { if (!bytes.length || bytes.length > 20 * 1024 * 1024 || source.text.length > 120000) throw fault('Choose a source under 20 MB and 120,000 extracted characters. No content was omitted.'); const data = read(), id = digest(bytes); if (!data.sources.some(source => source.id === id)) { writeFileSync(join(directory, id), bytes); data.sources.push({ id, sha256: id, name: String(source.name).slice(0, 160), type: source.type, text: source.text, size: bytes.length, at: Date.now() }); write(data); } return data.sources.find(source => source.id === id); },
    sourceFile(id) { if (!/^[a-f0-9]{64}$/.test(id)) throw fault('Source not found.', 404); const source = read().sources.find(source => source.id === id); if (!source) throw fault('Source not found.', 404); return { source, bytes: readFileSync(join(directory, id)) }; },
    export(id, entry, bytes, expected, signature) { const data = read(), record = find(data, id); check(record, expected); if (resumeSignature(record.document) !== signature) throw fault('The resume changed while rendering. Export the current version.', 409); writeFileSync(join(directory, entry.id + '.pdf'), bytes); record.exports.push(entry); write(data); },
    exportFile(id, exportId) { if (!/^[a-z0-9-]+$/i.test(exportId)) throw fault('Export not found.', 404); const entry = this.get(id).exports.find(entry => entry.id === exportId); if (!entry) throw fault('Export not found.', 404); return { entry, bytes: readFileSync(join(directory, entry.id + '.pdf')) }; }
  };
}

export async function buildPreview({ clean = false } = {}) {
  const outdir = join(root, 'studio/resume-preview/assets');
  mkdirSync(outdir, { recursive: true });
  const result = await build({ absWorkingDir: root, entryPoints: ['src/js/resume-preview.jsx'], bundle: true, format: 'esm', target: 'es2022', outdir, entryNames: 'app', splitting: true, chunkNames: '[name]-[hash]', jsx: 'automatic', conditions: ['production'], plugins: [cornerEnginePlugin(), mergerThemePlugin()], loader: { '.woff2': 'file', '.svg': 'file', '.gif': 'file' }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, metafile: true, logLevel: 'warning' });
  copyFileSync(join(root, 'node_modules/pagedjs/dist/paged.polyfill.js'), join(outdir, 'paged.polyfill.js'));
  copyFileSync(join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), join(outdir, 'pdf.worker.mjs'));
  if (clean) {
    const outputs = new Set([...Object.keys(result.metafile.outputs).map(path => resolve(root, path)), join(outdir, 'paged.polyfill.js'), join(outdir, 'pdf.worker.mjs')]);
    for (const entry of readdirSync(outdir, { withFileTypes: true })) if (entry.isFile() && !outputs.has(join(outdir, entry.name))) rmSync(join(outdir, entry.name));
  }
}

export async function startPreview({ port = 5530, directory = join(tmpdir(), 'rk-resume-preview-v1'), ai = null } = {}) {
  const store = createPreviewStore(directory), origin = 'http://127.0.0.1:' + port;
  let browserPromise, renderQueue = Promise.resolve();
  const render = async (id, expected) => {
    const record = store.get(id);
    if (record.version !== Number(expected)) throw fault('Save the current version before exporting.', 409);
    const document = record.document, signature = resumeSignature(document);
    const existing = record.exports.findLast(entry => entry.signature === signature && entry.renderVersion === RESUME_RENDER_VERSION);
    if (existing) return existing;
    for (const file of (RESUME_FONTS[document.design.font] || RESUME_FONTS.inter).files) if (!existsSync(join(root, 'fonts', file))) throw fault('The selected font is unavailable. Nothing was substituted.', 422);
    browserPromise ||= chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const browser = await browserPromise, page = await browser.newPage();
    try {
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await page.goto(origin + '/__resume/render/' + id);
      await page.waitForFunction(() => window.resumeReady || window.resumeError, null, { timeout: 25000 });
      const ready = await page.evaluate(() => ({ ...window.resumeReady, error: window.resumeError }));
      if (ready.error || !ready.fontLoaded) throw fault(ready.error || 'The selected font did not load. Export stopped.', 422);
      if (ready.layoutError) throw fault(ready.layoutError, 422);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.pagedjs_page [data-field]')].filter(element => {
        const area = element.closest('.pagedjs_page').getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0 && (rect.left < area.left - 2 || rect.right > area.right + 2 || rect.top < area.top - 2 || rect.bottom > area.bottom + 2));
      }).map(element => element.dataset.field));
      if (overflow.length) throw fault('PDF layout exceeds the page bounds at ' + overflow[0] + '. Adjust the layout before exporting. No file was downloaded.', 422);
      const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const parsed = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      let text = '', verificationText = ''; const links = [], positions = [];
      for (let number = 1; number <= parsed.numPages; number++) {
        const pdfPage = await parsed.getPage(number), viewport = pdfPage.getViewport({ scale: 1 }), content = await pdfPage.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
        const marginPoints = (document.design.margin === 'narrow' ? 10 : 15) * 72 / 25.4;
        const footer = content.items.filter(item => item.str && viewport.height - item.transform[5] > viewport.height - marginPoints);
        const footerMatches = footer.map(item => item.str).join('').replace(/\s/g, '') === number + '/' + parsed.numPages;
        verificationText += content.items.filter(item => !footerMatches || !footer.includes(item)).map(item => item.str).join(' ') + '\n';
        positions.push({ width: viewport.width, height: viewport.height, items: content.items.filter(item => item.str).map(item => ({ str: item.str, x: item.transform[4], y: viewport.height - item.transform[5], w: item.width, h: item.height })) });
        links.push(...(await pdfPage.getAnnotations()).filter(annotation => annotation.subtype === 'Link').map(annotation => annotation.url || annotation.unsafeUrl));
      }
      const verification = validatePdfText(document, verificationText), pages = parsed.numPages; await parsed.destroy();
      if (!verification.complete) throw fault('PDF verification found missing text: ' + verification.missing.slice(0, 2).map(field => field.label).join(', ') + '. No file was offered for download.', 422);
      if (pages !== ready.pages) throw fault('Preview and PDF page counts differ. Export stopped.', 422);
      const entry = { id: randomUUID(), at: Date.now(), version: record.version, signature, pages, bytes: bytes.length, sha256: digest(bytes), verification, links, extractedText: text, font: document.design.font, size: document.design.size, name: document.name.replace(/[^a-z0-9 -]/gi, '').trim() + '.pdf' };
      entry.renderVersion = RESUME_RENDER_VERSION; entry.layout = atsParseLayout(positions); entry.layoutBoundsVerified = true;
      store.export(id, entry, bytes, expected, signature); return entry;
    } finally { await page.close(); }
  };
  const server = createServer(async (request, response) => {
    const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
    try {
      if (request.headers.host !== '127.0.0.1:' + port && request.headers.host !== 'localhost:' + port) throw fault('Loopback access only.', 403);
      if (request.headers.origin && ![origin, 'http://localhost:' + port].includes(request.headers.origin)) throw fault('Cross-origin writes are blocked.', 403);
      const url = new URL(request.url, origin), parts = url.pathname.split('/').filter(Boolean);
      const body = async () => { let bytes = 0; const chunks = []; for await (const chunk of request) { bytes += chunk.length; if (bytes > 30 * 1024 * 1024) throw fault('Upload is too large.', 413); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString() || '{}'); };
      if (url.pathname === '/__resume/api/ai/config' && request.method === 'GET') return json(ai ? await ai.configuration() : { available: false });
      if (url.pathname === '/__resume/api/ai/complete' && request.method === 'POST') {
        if (request.headers.origin !== origin && request.headers.origin !== 'http://localhost:' + port) throw fault('Same-origin AI request required.', 403);
        if (!ai) throw fault('Connect the existing Studio AI session before requesting a review.', 503);
        const input = await body();
        if (!['requirements', 'assessment', 'revision'].includes(input.stage) || typeof input.system !== 'string' || typeof input.user !== 'string' || input.system.length + input.user.length > 100000 || !Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 12000) throw fault('Invalid bounded AI request.');
        const controller = new AbortController();
        const close = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', close);
        try { return json({ text: await ai.complete({ ...input, signal: controller.signal }) }); }
        finally { response.off('close', close); }
      }
      if (url.pathname === '/__resume/api/library' && request.method === 'GET') return json(store.list());
      if (url.pathname === '/__resume/api/resumes' && request.method === 'POST') return json(store.create((await body()).document));
      if (parts[0] === '__resume' && parts[1] === 'api' && parts[2] === 'sources' && request.method === 'POST') { const input = await body(); return json(store.source(input, Buffer.from(input.base64, 'base64'))); }
      if (parts[0] === '__resume' && parts[1] === 'sources' && request.method === 'GET') { const { source, bytes } = store.sourceFile(parts[2]); response.writeHead(200, { 'Content-Type': source.type || 'application/octet-stream', 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${source.name.replace(/[^a-z0-9 ._-]/gi, '')}"`, 'Cache-Control': 'no-store' }); return response.end(bytes); }
      if (parts[0] === '__resume' && parts[1] === 'render' && request.method === 'GET') { const document = store.get(parts[2]).document; response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return response.end(renderResumeHtml(document, { base: origin + '/' })); }
      if (parts[0] === '__resume' && parts[1] === 'api' && parts[2] === 'resumes') {
        const id = parts[3], expected = request.headers['if-match'];
        if (request.method === 'GET' && !parts[4]) return json(store.get(id));
        if (request.method === 'PUT' && !parts[4]) { const input = await body(); return json(store.save(id, input.document, expected, input.label)); }
        if (request.method === 'POST' && parts[4] === 'restore') return json(store.restore(id, (await body()).number, expected));
        if (request.method === 'POST' && parts[4] === 'export') { const pending = renderQueue.then(() => render(id, expected)); renderQueue = pending.catch(() => {}); return json(await pending); }
        if (request.method === 'GET' && parts[4] === 'exports') { const { entry, bytes } = store.exportFile(id, parts[5]); response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${entry.name}"`, 'Cache-Control': 'no-store' }); return response.end(bytes); }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw fault('Method not allowed.', 405);
      if (!['/studio/resume-preview/', '/studio/resume/', '/fonts/', '/css/'].some(prefix => url.pathname.startsWith(prefix)) && url.pathname !== '/content.json') throw fault('Not found.', 404);
      let filename = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!filename.startsWith(resolve(root) + sep)) throw fault('Not found.', 404);
      if (url.pathname.endsWith('/')) filename = join(filename, 'index.html');
      const bytes = readFileSync(filename), mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json' }[extname(filename)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) { json({ error: error.message }, error.status || (error.code === 'ENOENT' ? 404 : 500)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, store, origin, async close() { await (await browserPromise)?.close(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildPreview({ clean: process.argv.includes('--build') });
  if (process.argv.includes('--build')) {
    console.log('Resume Studio assets built.');
  } else {
  const preview = await startPreview({ port: Number(process.env.RESUME_SAMPLE_PORT || 5530) });
  console.log('Resume sample: ' + preview.origin + '/studio/resume-preview/');
  console.log('Synthetic preview store: ' + join(tmpdir(), 'rk-resume-preview-v1') + '. No Cloudflare writes or paid AI.');
  process.on('SIGINT', async () => { await preview.close(); process.exit(0); });
  }
}