export const LIBRARY_LIMIT = 10 * 1024 * 1024;
const KEY = "owner/library.json";

export function validateLibrary(items) {
  if (!Array.isArray(items) || items.length > 1000) throw new Error("Library must contain at most 1000 items.");
  const ids = new Set();
  let count = 0;
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 200 || ids.has(item.id) || !Array.isArray(item.elements) || !["published", "unpublished"].includes(item.status)) throw new Error("Invalid library item.");
    ids.add(item.id);
    count += item.elements.length;
    if (!item.elements.length || count > 20000 || item.elements.some(element => !element || typeof element.id !== "string" || typeof element.type !== "string" || ![element.x, element.y, element.width, element.height].every(Number.isFinite))) throw new Error("Invalid library elements or library too large.");
  }
  return items;
}

export async function libraryRoute(request, bucket, cors) {
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
  if (!bucket) return reply({ error: "Library storage unavailable" }, 503);
  try {
    if (request.method === "GET") {
      const object = await bucket.get(KEY);
      return reply({ revision: object?.etag || null, items: object ? await object.json() : [] });
    }
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Missing library" }, 400);
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIBRARY_LIMIT) { await reader.cancel(); return reply({ error: "Library exceeds 10 MB" }, 413); }
      chunks.push(value);
    }
    let body;
    try {
      body = JSON.parse(await new Blob(chunks).text());
      if (body.revision !== null && (typeof body.revision !== "string" || !/^[a-f0-9]{32}$/.test(body.revision))) throw new Error("Invalid library revision.");
      validateLibrary(body.items);
    } catch (error) { return reply({ error: error.message }, 400); }
    const object = await bucket.put(KEY, JSON.stringify(body.items), {
      onlyIf: body.revision === null ? { etagDoesNotMatch: "*" } : { etagMatches: body.revision },
      httpMetadata: { contentType: "application/json" }
    });
    if (!object) return reply({ error: "Library changed on another device" }, 409);
    return reply({ revision: object.etag });
  } catch { return reply({ error: "Library storage unavailable; local changes are retained" }, 503); }
}