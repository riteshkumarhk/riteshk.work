import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { releaseChecksRoute } from "./worker/release-checks.mjs";
import { testSummary } from "./tools/browser-shards.mjs";

function fixture() {
  const check = { id: "CHECK-01", title: "Synthetic check", steps: ["Check the fixture"], expected: "Fixture works" };
  const document = { schemaVersion: 1, releases: [{ id: "fixture", version: "v1", checks: [check] }] };
  const values = new Map([["validation-checks.json", JSON.stringify(document)], ["check-results.json", JSON.stringify({ schemaVersion: 1, revision: 0, checks: {} })]]);
  let revision = 0, writes = 0;
  const bucket = {
    async get(key) { const value = values.get(key), etag = String(revision); return value === undefined ? null : { etag, json: async () => JSON.parse(value) }; },
    async put(key, value, options) { if (options.onlyIf.etagMatches !== String(revision)) return null; values.set(key, value); revision++; writes++; return { etag: String(revision) }; }
  };
  const send = (method = "GET", body, suffix = "") => releaseChecksRoute(new Request("https://test.invalid/admin/release-checks" + suffix, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }), bucket);
  return { bucket, values, document, send, writes: () => writes };
}

test("cloud checklist preserves local fingerprints and rejects concurrent cross-device saves", async () => {
  const fixtureData = fixture();
  const response = await fixtureData.send();
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const initial = await response.json(), check = initial.document.releases[0].checks[0];
  assert.equal(check.definitionVersion, createHash("sha256").update(JSON.stringify({ release: "fixture", version: "v1", check: fixtureData.document.releases[0].checks[0] })).digest("hex"));
  const input = { revision: 0, definitionVersion: check.definitionVersion, status: "passed", notes: "Synthetic browser result" };
  const saves = await Promise.all([fixtureData.send("PUT", input, "/results/CHECK-01"), fixtureData.send("PUT", { ...input, status: "issue" }, "/results/CHECK-01")]);
  assert.deepEqual(saves.map(result => result.status).sort(), [200, 409]);
  assert.equal(fixtureData.writes(), 1);
  const conflict = await saves.find(result => result.status === 409).json();
  assert.equal(conflict.current.results.revision, 1);
  assert.equal(conflict.current.results.checks[check.id].history.length, 1);
  const retry = await fixtureData.send("PUT", { ...input, revision: 1, status: "issue" }, "/results/CHECK-01");
  assert.equal(retry.status, 200);
  const saved = await retry.json();
  assert.equal(saved.results.checks[check.id].history.length, 2);
  assert.deepEqual((await (await fixtureData.send()).json()).results, saved.results);
});

test("cloud definitions update independently without changing manual evidence", async () => {
  const fixtureData = fixture(), initial = await (await fixtureData.send()).json();
  const input = { revision: 0, definitionVersion: initial.document.releases[0].checks[0].definitionVersion, status: "blocked", notes: "Keep this history" };
  const saved = await (await fixtureData.send("PUT", input, "/results/CHECK-01")).json();
  fixtureData.document.releases[0].playwright = { "CHECK-01": { approved: true } };
  fixtureData.values.set("validation-checks.json", JSON.stringify(fixtureData.document));
  const updated = await (await fixtureData.send()).json();
  assert.equal(updated.document.releases[0].checks[0].definitionVersion, input.definitionVersion);
  assert.deepEqual(updated.results, saved.results);
  fixtureData.document.releases[0].checks[0].steps.push("Changed instruction");
  fixtureData.values.set("validation-checks.json", JSON.stringify(fixtureData.document));
  assert.equal((await fixtureData.send("PUT", { ...input, revision: 1 }, "/results/CHECK-01")).status, 409);
  assert.deepEqual((await (await fixtureData.send()).json()).results, saved.results);
});

test("cloud checklist fails closed on malformed, missing or unavailable storage", async () => {
  const fixtureData = fixture();
  assert.equal((await fixtureData.send("PUT", { notes: "bad" }, "/results/CHECK-01")).status, 400);
  assert.equal((await fixtureData.send("PUT", { notes: "x".repeat(17000) }, "/results/CHECK-01")).status, 413);
  assert.equal((await fixtureData.send("GET", undefined, "/../../memories")).status, 404);
  fixtureData.values.set("check-results.json", "not JSON");
  assert.equal((await fixtureData.send()).status, 503);
  assert.equal(fixtureData.values.get("check-results.json"), "not JSON");
  fixtureData.values.delete("check-results.json");
  assert.equal((await fixtureData.send()).status, 503);
  assert.equal(fixtureData.writes(), 0);
});

test("real local R2 conditional saves retain one winner and survive runtime restart", { timeout: 60000 }, async context => {
  if (!global.gc) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, ["--expose-gc", "--test", "--test-reporter=tap",
      "--test-name-pattern=^" + context.name + "$", fileURLToPath(import.meta.url)], { env, timeout: 55000 });
    assert.equal(testSummary(stdout).passed, 1, stdout);
    assert.ok(stdout.includes("ok 1 - " + context.name), stdout);
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "rk-checklist-r2-"));
  const bundle = await build({ stdin: { contents: 'import { releaseChecksRoute } from "./worker/release-checks.mjs"; export default { fetch(request, env) { return releaseChecksRoute(request, env.RELEASE_CHECKS); } };', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser" });
  const options = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-14", r2Buckets: ["RELEASE_CHECKS"], r2Persist: directory, outboundService: () => new Response(null, { status: 503 }) };
  let runtime = new Miniflare(options);
  // Keep the original fetch response alive; dispatchFetch wraps a GC-owned Undici stream.
  const send = async (suffix = "", init) => fetch(new URL("/admin/release-checks" + suffix, await runtime.ready), init);
  try {
    const bucket = await runtime.getR2Bucket("RELEASE_CHECKS"), fixtureData = fixture();
    for (const [key, value] of fixtureData.values) await bucket.put(key, value);
    const initial = await (await send()).json();
    const input = { revision: 0, definitionVersion: initial.document.releases[0].checks[0].definitionVersion, status: "passed", notes: "Synthetic durable result" };
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => send("/results/CHECK-01", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, notes: input.notes + " " + index }) })));
    for (let turn = 0; turn < 8; turn++) { await nextTurn(); global.gc(); await nextTurn(); }
    assert.ok(responses.every(response => !response.bodyUsed), "All response bodies must survive GC before consumption");
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 409).length, 7);
    const bodies = await Promise.all(responses.map(response => response.json()));
    const winner = responses.findIndex(response => response.status === 200), saved = bodies[winner];
    assert.equal(saved.results.revision, 1);
    assert.equal(saved.results.checks["CHECK-01"].notes, input.notes + " " + winner);
    assert.equal(saved.results.checks["CHECK-01"].history.length, 1);
    for (const [index, response] of responses.entries()) {
      if (response.status === 409) assert.deepEqual(bodies[index].current.results, saved.results);
    }
    await runtime.dispose(); runtime = new Miniflare(options);
    const restarted = await (await send()).json();
    assert.deepEqual(restarted.results, saved.results);
  } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
});