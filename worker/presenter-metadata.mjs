const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const identity = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw fault('Invalid presentation identity.');
  return value;
};
function validateValue(key, value) {
  if (key === 'notes' && typeof value === 'string' && value.length <= 100000) return;
  if (key === 'title' && typeof value === 'string' && value.length <= 200) return;
  if (key === 'durationMinutes' && Number.isFinite(value) && value >= 0 && value <= 240) return;
  throw fault('Invalid presenter metadata.');
}

export function createPresenterMetadataStore(bucket) {
  if (!bucket) throw fault('Private presenter sync is unavailable.', 503);
  const path = (caseId, deckId) => 'presenter-metadata/' + identity(caseId) + '/' + identity(deckId) + '.json';
  async function read(caseId, deckId) {
    const object = await bucket.get(path(caseId, deckId));
    return { etag: object?.etag, record: object ? await object.json() : { version: 1, revision: 0, fields: [] } };
  }
  return {
    async get(caseId, deckId) { return (await read(caseId, deckId)).record; },
    async edit(caseId, deckId, input) {
      identity(input?.slideId);
      const { slideId, key, value, initial, expected } = input;
      validateValue(key, value);
      validateValue(key, initial);
      if (!Number.isSafeInteger(expected) || expected < 0) throw fault('A saved metadata revision is required.');
      for (let attempt = 0; attempt < 3; attempt++) {
        const { etag, record } = await read(caseId, deckId);
        const previous = record.fields.find(field => field.slideId === slideId && field.key === key);
        if ((previous?.revision || 0) !== expected) throw fault('This field changed on another device. Your local edit is kept; compare both versions before retrying.', 409);
        const field = { slideId, key, value, initial: previous ? previous.initial : initial, revision: expected + 1 };
        const next = { version: 1, revision: record.revision + 1, fields: [...record.fields.filter(field => field.slideId !== slideId || field.key !== key), field] };
        const text = JSON.stringify(next);
        if (next.fields.length > 1500 || new TextEncoder().encode(text).length > 1024 * 1024) throw fault('Private presenter metadata is full. No saved field was removed.', 413);
        const saved = await bucket.put(path(caseId, deckId), text, {
          httpMetadata: { contentType: 'application/json' },
          onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' }
        });
        if (saved) return next;
      }
      throw fault('Private presenter metadata is still changing. Your local edit is kept; retry shortly.', 409);
    }
  };
}

export async function presenterMetadataRoute(request, bucket, headers) {
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  try {
    const url = new URL(request.url), store = createPresenterMetadataStore(bucket);
    const caseId = url.searchParams.get('case'), deckId = url.searchParams.get('deck');
    if (request.method === 'GET') return respond(await store.get(caseId, deckId));
    if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 220000) throw fault('Presenter metadata request is too large.', 413);
    let input;
    try { input = JSON.parse(text); } catch { throw fault('Invalid presenter metadata request.'); }
    return respond(await store.edit(caseId, deckId, input));
  } catch (error) {
    return respond({ error: error.status ? error.message : 'Private presenter sync failed. Your local edit is kept.' }, error.status || 503);
  }
}