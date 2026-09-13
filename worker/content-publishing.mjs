import { contentRevision } from "../src/js/content-revision.mjs";

export async function writeContentRevision(bucket, bytes, expected, beforeWrite = async () => {}) {
  const failure = (status, error) => ({ status, body: { ok: false, conflict: status === 412 || status === 428, error } });
  if (!/^[a-f0-9]{64}$/.test(expected || "")) return failure(428, "A loaded content revision is required. Keep your draft and reopen Studio.");
  if (!bytes?.byteLength) return failure(400, "Empty content");
  if (bytes.byteLength > 40 * 1024 * 1024) return failure(413, "Content too large");
  let proposed;
  try { proposed = JSON.parse(new TextDecoder().decode(bytes)); } catch (error) { return failure(400, "Not valid JSON - nothing written"); }
  if (!proposed || typeof proposed !== "object" || Array.isArray(proposed)) return failure(400, "Not a content document - nothing written");
  const current = await bucket.get("content.json");
  if (!current) return failure(412, "The published baseline is unavailable. Your draft has not been published.");
  const actual = await contentRevision(await current.json());
  if (actual !== expected) return failure(412, "Published content changed since this draft was opened. Your draft is kept.");
  const revision = await contentRevision(proposed);
  await beforeWrite();
  const written = await bucket.put("content.json", bytes, { onlyIf: { etagMatches: current.etag }, httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { revision } });
  if (!written) return failure(412, "Another publication completed first. Your draft is kept.");
  return { status: 200, body: { ok: true, revision, size: bytes.byteLength } };
}