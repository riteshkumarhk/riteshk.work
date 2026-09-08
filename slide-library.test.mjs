import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { libraryRoute, validateLibrary, LIBRARY_LIMIT } from "./worker/slide-library.mjs";
import { mergeLibrary, createLibrarySync, applyLibrarySnapshot } from "./src/js/slide-library-sync.mjs";

const item = id => ({ id, status: "published", created: 1, elements: [{ id: `${id}-shape`, type: "rectangle", x: 0, y: 0, width: 100, height: 50 }] });
function storage() {
  let current = null;
  return {
    async get() { return current && { etag: current.etag, json: async () => JSON.parse(current.text) }; },
    async put(key, text, { onlyIf }) {
      if (onlyIf.etagDoesNotMatch === "*" ? current !== null : current?.etag !== onlyIf.etagMatches) return null;
      current = { text, etag: createHash("md5").update(text).digest("hex") };
      return current;
    }
  };
}
const request = body => new Request("https://example.test/admin/slide-library", { method: "POST", body: JSON.stringify(body) });

test("library stores original elements, detects stale writes and supports deletion", async () => {
  const bucket = storage();
  const initial = await (await libraryRoute(new Request("https://example.test"), bucket, {})).json();
  assert.deepEqual(initial, { revision: null, items: [] });
  const saved = await libraryRoute(request({ revision: null, items: [item("one")] }), bucket, {});
  const { revision } = await saved.json();
  assert.equal(saved.headers.get("Cache-Control"), "no-store");
  assert.equal((await libraryRoute(request({ revision: null, items: [] }), bucket, {})).status, 409);
  const loaded = await (await libraryRoute(new Request("https://example.test"), bucket, {})).json();
  assert.deepEqual(loaded.items, [item("one")]);
  assert.equal((await libraryRoute(request({ revision, items: [] }), bucket, {})).status, 200);
  assert.equal((await libraryRoute(request({ revision, items: [item("one")] }), bucket, {})).status, 409);
});

test("library validates shapes, duplicate ids, methods, revisions and payload limits", async () => {
  assert.throws(() => validateLibrary([item("one"), item("one")]));
  assert.throws(() => validateLibrary([{ ...item("bad"), elements: [{}] }]));
  const bucket = storage();
  assert.equal((await libraryRoute(request({ items: [] }), bucket, {})).status, 400);
  assert.equal((await libraryRoute(new Request("https://example.test", { method: "DELETE" }), bucket, {})).status, 405);
  assert.equal((await libraryRoute(new Request("https://example.test"), null, {})).status, 503);
  const oversized = new Request("https://example.test", { method: "POST", body: " ".repeat(LIBRARY_LIMIT + 1) });
  assert.equal((await libraryRoute(oversized, bucket, {})).status, 413);
});

test("three-way merge retains other-device additions and does not resurrect unchanged deleted items", () => {
  assert.deepEqual(mergeLibrary([item("old")], [item("old"), item("local")], [item("remote")]), [item("remote"), item("local")]);
  assert.deepEqual(mergeLibrary([item("old")], [], [item("old"), item("remote")]), [item("remote")]);
  assert.deepEqual(mergeLibrary([], [item("one")], [item("one")]), [item("one")]);
});

test("native queued updates preserve local additions during cloud application", async () => {
  let callback;
  const baseline = [item("existing")];
  await applyLibrarySnapshot({ updateLibrary: options => { callback = options.libraryItems; assert.equal(options.merge, false); } }, baseline, [item("remote")]);
  assert.deepEqual(callback([...baseline, item("added-while-queued")]), [item("remote"), item("added-while-queued")]);
});

test("sync retries conflicts and retains edits made during upload", async () => {
  let saved = { base: [], items: [item("local")] }, cloud = [], attempts = 0, applied;
  const statuses = [];
  const sync = createLibrarySync({
    cache: async value => { if (value) saved = structuredClone(value); return saved; },
    session: () => "test-session", onStatus: value => statuses.push(value), onItems: items => { applied = items; },
    request: async (token, body) => {
      if (!body) return { revision: null, items: cloud };
      if (++attempts === 1) { cloud = [item("remote")]; return { conflict: true }; }
      if (attempts === 2) await sync.change([item("local"), item("during-upload")]);
      cloud = body.items;
      return { revision: "next" };
    }
  });
  await sync.sync();
  assert.deepEqual(applied.map(entry => entry.id), ["remote", "local", "during-upload"]);
  await sync.sync();
  assert.deepEqual(cloud.map(entry => entry.id), ["remote", "local", "during-upload"]);
  assert.equal(statuses.at(-1), "Library: synced");
  sync.stop();
});

test("offline edits persist and reload without uploading until authenticated", async () => {
  let saved, token = null, requests = 0;
  const options = { cache: async value => { if (value) saved = structuredClone(value); return saved; }, session: () => token, request: async () => { requests++; throw new Error("offline"); }, onItems: () => {}, onStatus: () => {} };
  const first = createLibrarySync(options);
  await first.change([item("offline")]);
  await first.sync();
  assert.equal(requests, 0);
  first.stop();
  const second = createLibrarySync(options);
  assert.deepEqual(await second.ready, [item("offline")]);
  token = "test-session";
  await second.sync();
  assert.deepEqual(saved.items, [item("offline")]);
  assert.equal(requests, 1);
  second.stop();
});

test("Worker library gate rejects anonymous, forged and expired sessions before storage", async () => {
  const source = (await readFile(new URL("./worker/rk-ai-proxy.js", import.meta.url), "utf8")).replace('"./slide-library.mjs"', JSON.stringify(new URL("./worker/slide-library.mjs", import.meta.url).href));
  const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  let reads = 0;
  const env = { SESSION_SECRET: "test-only-secret", ALLOW_ORIGIN: "https://example.test", SLIDE_LIBRARIES: { get: async () => { reads++; return null; } } };
  const makeToken = exp => {
    const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    return payload + "." + createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  };
  for (const token of ["", "forged.token", makeToken(Date.now() - 1000)]) {
    const response = await worker.fetch(new Request("https://example.test/admin/slide-library", { headers: { Authorization: "Bearer " + token } }), env);
    assert.equal(response.status, 401);
  }
  assert.equal(reads, 0);
  const response = await worker.fetch(new Request("https://example.test/admin/slide-library", { headers: { Authorization: "Bearer " + makeToken(Date.now() + 60000), Origin: "https://example.test" } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://example.test");
  assert.equal(reads, 1);
});