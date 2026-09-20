import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { PasskeyChallenges } from "./worker/passkey-challenges.mjs";

const bundle = await build({ entryPoints: ["worker/rk-ai-proxy.js"], bundle: true, write: false, format: "esm", platform: "node", packages: "external" });
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

function fixture() {
  const credentials = new Map(), challenges = new Map();
  const document = { schemaVersion: 1, environment: "Synthetic release", safety: "Disposable test data", releases: [{ id: "fixture", title: "Synthetic release", version: "v1", date: "2026-09-14", automatedEvidence: "Synthetic evidence", checks: [{ id: "CHECK-01", title: "Private runtime check", area: "Runtime", when: "Now", steps: ["Inspect synthetic runtime"], expected: "Synthetic runtime stays available" }] }] };
  const values = new Map([["validation-checks.json", JSON.stringify(document)], ["check-results.json", JSON.stringify({ schemaVersion: 1, revision: 0, checks: {} })]]);
  let revision = 0;
  const env = {
    SESSION_SECRET: "synthetic-checklist-test-secret", ALLOW_ORIGIN: "https://riteshk.work", RP_ID: "riteshk.work",
    VAULT_GRANTS: { get: async (key, format) => { const value = credentials.get(key); return value ? format === "json" ? JSON.parse(value) : value : null; }, put: async (key, value) => credentials.set(key, value) },
    PASSKEY_CHALLENGES: { idFromName: value => value, get(identifier) {
      if (!challenges.has(identifier)) {
        const stored = new Map(); let queue = Promise.resolve();
        const storage = { get: async key => structuredClone(stored.get(key)), put: async (key, value) => stored.set(key, structuredClone(value)), setAlarm: async () => {}, transaction(run) { const result = queue.then(() => run(storage)); queue = result.catch(() => {}); return result; } };
        challenges.set(identifier, new PasskeyChallenges({ storage }));
      }
      return { fetch: (url, options) => challenges.get(identifier).fetch(new Request(url, options)) };
    } },
    RELEASE_CHECKS: { get: async key => { const data = values.get(key), etag = String(revision); return data === undefined ? null : { etag, json: async () => JSON.parse(data) }; }, put: async (key, data, options) => { if (options.onlyIf.etagMatches !== String(revision)) return null; values.set(key, data); revision++; return { etag: String(revision) }; } }
  };
  return { env, credentials, values, errors: [], privateReads: 0, finishes: 0, offline: false, holdFinish: null, holdGet: null };
}

async function device(browser, fixtureData, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const identifier = crypto.getRandomValues(new Uint8Array(32));
  fixtureData.credentials.set("wa:cred:" + Buffer.from(identifier).toString("base64url"), JSON.stringify({ jwk: await crypto.subtle.exportKey("jwk", keys.publicKey), alg: -7, counter: 0 }));
  await session.send("WebAuthn.addCredential", { authenticatorId, credential: { credentialId: Buffer.from(identifier).toString("base64"), isResidentCredential: true, rpId: "riteshk.work", privateKey: Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64"), userHandle: Buffer.from("synthetic-owner").toString("base64"), signCount: 0 } });
  page.on("pageerror", error => fixtureData.errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = request.url();
    if (url.startsWith("https://riteshk.work/release-checks/")) return route.fulfill({ path: "release-checks/index.html", contentType: "text/html" });
    if (url.startsWith("https://riteshk.work/src/js/admin-core.js")) return route.fulfill({ path: "src/js/admin-core.js", contentType: "text/javascript" });
    if (url.startsWith("https://media.riteshk.work/") && url.includes(".woff2")) return route.continue();
    if (!url.startsWith("https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/") && !url.startsWith("https://riteshk.work/admin/")) return route.abort();
    if (url.includes("/release-checks")) {
      fixtureData.privateReads++;
      if (fixtureData.offline) return route.abort("internetdisconnected");
    }
    const response = await worker.fetch(new Request(url, { method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData() } : {}) }), fixtureData.env);
    const body = Buffer.from(await response.arrayBuffer());
    if (url.endsWith("/auth/finish")) { fixtureData.finishes++; if (fixtureData.holdFinish) await fixtureData.holdFinish; }
    if (url.endsWith("/release-checks") && fixtureData.holdGet) await fixtureData.holdGet;
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
  });
  await page.goto("https://riteshk.work/release-checks/");
  return { page, context };
}

async function signIn(page) {
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await page.locator('.case[data-id="CHECK-01"]').waitFor();
}

test("hosted checklist uses real virtual passkey assertions and shares results across devices", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const fixtureData = fixture(), desktop = await device(browser, fixtureData), mobile = await device(browser, fixtureData, 390);
    assert.equal(fixtureData.privateReads, 0);
    assert.equal(await desktop.page.locator("#checklist").isVisible(), false);
    assert.equal(await desktop.page.getByText("Private runtime check").count(), 0);
    await signIn(desktop.page); await signIn(mobile.page);
    await desktop.page.getByLabel("Mark CHECK-01 passed", { exact: true }).check();
    await desktop.page.waitForFunction(() => document.documentElement.dataset.pending === "0");
    await mobile.page.getByRole("button", { name: "Refresh checks" }).click();
    await mobile.page.waitForFunction(() => document.querySelector('[data-field="passed"]').checked);
    assert.equal(JSON.parse(fixtureData.values.get("check-results.json")).checks["CHECK-01"].history.length, 1);
    for (const { page } of [desktop, mobile]) {
      await page.locator(".case-details > summary").click();
      await page.evaluate(async () => { await Promise.all([document.fonts.load('500 28px "Schibsted Grotesk"'), document.fonts.load('400 14px "Hanken Grotesk"'), document.fonts.load('400 11px "Martian Mono"')]); await document.fonts.ready; });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.evaluate(() => [...document.fonts].filter(face => face.status === "loaded").length >= 3), true);
      await page.screenshot({ path: join(tmpdir(), "rk-hosted-checklist-" + page.viewportSize().width + ".png"), fullPage: true });
    }
    await desktop.page.getByRole("button", { name: "Lock checklist" }).click();
    assert.equal(await desktop.page.getByText("Private runtime check").count(), 0);
    assert.equal(await desktop.page.locator("#checklist").isVisible(), false);
    assert.equal(await desktop.page.evaluate(() => Object.keys(localStorage).length), 0);
    await signIn(desktop.page);
    assert.equal(await desktop.page.getByLabel("Mark CHECK-01 passed", { exact: true }).isChecked(), true);
    assert.deepEqual(fixtureData.errors, []);
  } finally { await browser.close(); }
});

test("hosted checklist cancels late sign-in, recovers failed saves and rejects stale results", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const fixtureData = fixture(), first = await device(browser, fixtureData);
    let releaseFinish;
    fixtureData.holdFinish = new Promise(resolve => { releaseFinish = resolve; });
    await first.page.getByRole("button", { name: "Sign in with passkey" }).dblclick();
    await assertPoll(() => fixtureData.finishes === 1);
    await first.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await first.page.getByText("Sign-in cancelled.", { exact: true }).waitFor();
    releaseFinish(); fixtureData.holdFinish = null;
    assert.equal(fixtureData.privateReads, 0);
    assert.equal(await first.page.locator("#checklist").isVisible(), false);
    await signIn(first.page);
    const second = await device(browser, fixtureData, 390); await signIn(second.page);
    fixtureData.offline = true;
    await first.page.locator(".case-details > summary").click();
    await first.page.getByLabel("Observed result / notes").fill("Synthetic pending note");
    await first.page.getByRole("button", { name: "Save notes", exact: true }).click();
    await first.page.getByText(/Save not confirmed/).waitFor();
    assert.equal(JSON.parse(fixtureData.values.get("check-results.json")).revision, 0);
    fixtureData.offline = false;
    await second.page.getByLabel("Mark CHECK-01 passed", { exact: true }).check();
    await second.page.waitForFunction(() => document.documentElement.dataset.pending === "0");
    await first.page.getByRole("button", { name: "Retry saving", exact: true }).click();
    await first.page.getByText("Saved result changed", { exact: true }).waitFor();
    await first.page.getByRole("button", { name: "Keep my result", exact: true }).click();
    await first.page.waitForFunction(() => document.documentElement.dataset.pending === "0");
    assert.equal(JSON.parse(fixtureData.values.get("check-results.json")).checks["CHECK-01"].notes, "Synthetic pending note");
    fixtureData.credentials.clear();
    await first.page.getByRole("button", { name: "Refresh checks" }).click();
    await first.page.getByRole("button", { name: "Sign in with passkey" }).waitFor();
    assert.equal(await first.page.getByText("Private runtime check").count(), 0);
    assert.deepEqual(fixtureData.errors, []);
  } finally { await browser.close(); }
});

test("hosted checklist restores pending notes after reload and conceals data on expiry or late reads", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const fixtureData = fixture(), { page } = await device(browser, fixtureData, 390);
    await signIn(page);
    fixtureData.offline = true;
    await page.locator(".case-details > summary").click();
    await page.getByLabel("Observed result / notes").fill("Retain after reload");
    await page.getByRole("button", { name: "Save notes", exact: true }).click();
    await page.getByText(/Save not confirmed/).waitFor();
    page.once("dialog", dialog => dialog.accept());
    await page.reload();
    assert.equal(await page.locator("#checklist").isVisible(), false);
    fixtureData.offline = false;
    await signIn(page);
    await page.getByText(/Recovered unsaved results/).waitFor();
    await page.getByRole("button", { name: "Retry saving", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.pending === "0");
    assert.equal(JSON.parse(fixtureData.values.get("check-results.json")).checks["CHECK-01"].notes, "Retain after reload");
    let releaseRead;
    fixtureData.holdGet = new Promise(resolve => { releaseRead = resolve; });
    const reads = fixtureData.privateReads;
    await page.getByRole("button", { name: "Refresh checks" }).click();
    await assertPoll(() => fixtureData.privateReads > reads);
    await page.getByRole("button", { name: "Lock checklist" }).click();
    releaseRead(); fixtureData.holdGet = null;
    assert.equal(await page.getByText("Private runtime check").count(), 0);
    await page.clock.install();
    await signIn(page);
    await page.clock.fastForward(3600001);
    await page.getByRole("button", { name: "Sign in with passkey" }).waitFor();
    assert.equal(await page.getByText("Private runtime check").count(), 0);
    assert.equal(await page.locator("#checklist").isVisible(), false);
    assert.deepEqual(fixtureData.errors, []);
  } finally { await browser.close(); }
});

async function assertPoll(check) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("Expected browser operation did not complete");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}