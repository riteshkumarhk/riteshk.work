// Miniflare's getR2Bucket() proxy blocks Node's event loop (Atomics.wait) on every call and
// property access, roughly 10-35 ms per object read on Windows. Browser tests that route
// requests through Node stall while it blocks. This adapter runs each operation inside
// workerd's real R2 emulator via an async HTTP request instead, keeping R2 semantics
// (etags, onlyIf, listing) without blocking.

import http from 'node:http';

export const R2_TEST_WORKER = `
const meta = object => object && { key: object.key, version: object.version, size: object.size, etag: object.etag, httpEtag: object.httpEtag,
  uploaded: object.uploaded.getTime(), httpMetadata: object.httpMetadata, customMetadata: object.customMetadata, range: object.range, storageClass: object.storageClass };
export default { async fetch(request, env) {
  try {
    const bucket = env[request.headers.get('x-r2-bucket')], op = request.headers.get('x-r2-op'), args = JSON.parse(decodeURIComponent(request.headers.get('x-r2-args')));
    if (!bucket) throw new Error('Unknown test bucket.');
    if (op === 'get') {
      const object = await bucket.get(...args), body = !!object && 'body' in object;
      return new Response(body ? object.body : null, { headers: { 'x-r2-meta': encodeURIComponent(JSON.stringify(meta(object))), 'x-r2-body': String(body) } });
    }
    if (op === 'put') return Response.json(meta(await bucket.put(args[0], request.headers.get('x-r2-null') === '1' ? null : await request.arrayBuffer(), args[1])));
    if (op === 'head') return Response.json(meta(await bucket.head(...args)));
    if (op === 'delete') { await bucket.delete(...args); return Response.json(null); }
    if (op === 'list') { const result = await bucket.list(...args); return Response.json({ ...result, objects: result.objects.map(meta) }); }
    throw new Error('Unsupported test bucket operation.');
  } catch (error) { return Response.json({ name: error.name, message: error.message }, { status: 500 }); }
} };
`;

const HTTP_HEADERS = [['contentType', 'content-type'], ['contentLanguage', 'content-language'], ['contentDisposition', 'content-disposition'], ['contentEncoding', 'content-encoding'], ['cacheControl', 'cache-control']];

function encodeArgs(args) {
  return encodeURIComponent(JSON.stringify(args, function (key, value) {
    const raw = this[key];
    if (raw instanceof Date || ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer || (typeof Headers !== 'undefined' && raw instanceof Headers)) throw new TypeError('r2TestBucket only supports JSON R2 options; extend tools/r2-test-bucket.mjs for ' + key + '.');
    return value;
  }));
}

async function putBody(value) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob || value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  throw new TypeError('Unsupported R2 put value.');
}

function revive(meta, bytes = null) {
  if (!meta) return null;
  const object = { ...meta, uploaded: new Date(meta.uploaded), writeHttpMetadata(headers) {
    for (const [field, header] of HTTP_HEADERS) if (meta.httpMetadata?.[field] != null) headers.set(header, meta.httpMetadata[field]);
    if (meta.httpMetadata?.cacheExpiry != null) headers.set('expires', new Date(meta.httpMetadata.cacheExpiry).toUTCString());
  } };
  if (!bytes) return object;
  let used = false;
  const take = () => { if (used) throw new TypeError('Body has already been used.'); used = true; return bytes; };
  return Object.defineProperties(object, Object.getOwnPropertyDescriptors({
    get bodyUsed() { return used; },
    get body() { const data = take(); return new ReadableStream({ start(controller) { controller.enqueue(data.slice()); controller.close(); } }); },
    async arrayBuffer() { return take().slice().buffer; },
    async bytes() { return take().slice(); },
    async text() { return new TextDecoder().decode(take()); },
    async json() { return JSON.parse(new TextDecoder().decode(take())); },
    async blob() { return new Blob([take()], { type: meta.httpMetadata?.contentType || '' }); }
  }));
}

// Miniflare's dispatchFetch opens a new TCP connection per request, so thousands of R2 operations
// exhaust Windows ephemeral ports (each closed socket waits ~2 minutes in TIME_WAIT). Node's fetch
// keep-alive to workerd stalls ~15 ms per request on Windows; a keep-alive node:http agent does neither.
const agent = new http.Agent({ keepAlive: true });

function send(origin, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : typeof body === 'string' ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    const request = http.request(origin, { method: 'POST', agent, headers: { ...headers, 'content-length': String(data?.length ?? 0) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const bytes = new Uint8Array(Buffer.concat(chunks));
        resolve({ status: response.statusCode, header: name => response.headers[name] ?? null, bytes, json: () => JSON.parse(new TextDecoder().decode(bytes)) });
      });
    });
    request.on('error', reject);
    request.end(data ?? undefined);
  });
}

export function r2TestBucket(runtime, name) {
  let origin;
  const call = async (op, args, body) => {
    origin ??= runtime.ready.then(url => new URL('/', url));
    const response = await send(await origin, { 'x-r2-bucket': name, 'x-r2-op': op, 'x-r2-args': encodeArgs(args), ...(body === null ? { 'x-r2-null': '1' } : {}) }, body);
    if (response.status === 500) { const error = response.json(); throw Object.assign(new Error(error.message), { name: error.name }); }
    return response;
  };
  return {
    async get(...args) {
      const response = await call('get', args);
      return revive(JSON.parse(decodeURIComponent(response.header('x-r2-meta'))), response.header('x-r2-body') === 'true' ? response.bytes : null);
    },
    async head(...args) { return revive((await call('head', args)).json()); },
    async put(key, value, options) { return revive((await call('put', options === undefined ? [key] : [key, options], await putBody(value))).json()); },
    async delete(...args) { await call('delete', args); },
    async list(...args) { const result = (await call('list', args)).json(); return { ...result, objects: result.objects.map(meta => revive(meta)) }; }
  };
}
