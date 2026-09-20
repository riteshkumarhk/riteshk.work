import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./src/js/admin-core.js", import.meta.url), "utf8");
const assertion = { id: "synthetic", rawId: new Uint8Array([1]).buffer, type: "public-key", response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null } };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(overrides = {}) {
  const values = new Map(), requests = [], stages = [];
  const context = {
    AbortController, DOMException, setTimeout, clearTimeout, atob, btoa, Uint8Array, TextEncoder, TextDecoder, crypto,
    window: {}, navigator: { credentials: { get: async () => assertion } },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return Response.json(url.endsWith("/begin") ? { challenge: "AQ", rpId: "synthetic.test" } : { token: "synthetic-session", exp: Date.now() + 60000, trust: "synthetic-trust", trustExp: Date.now() + 60000 });
    }, ...overrides
  };
  const api = runInNewContext(source.replace(/^export /gm, "") + "\n;({webauthnAuth,authStatus,authStage,adminLogin,recoverWithPassphrase,adminSession,adminSessionIdentity,saveAdminSession,signOutAdmin,restoreAdminSession});", context);
  return { ...api, values, requests, stages, context, options: { onStage: value => stages.push(value) } };
}

test("passkey login keeps completed credentials in memory only and reports no credentials", async () => {
  const fixture = setup();
  assert.equal((await fixture.webauthnAuth("login", fixture.options)).ok, true);
  assert.equal(fixture.adminSession(), "synthetic-session");
  assert.equal(fixture.values.has("rk:admin:sess"), false);
  assert.equal(fixture.values.has("rk:trust"), false);
  assert.deepEqual(fixture.stages.map(stage => stage.stage), ["Challenge", "Passkey provider", "Verification"]);
  assert.doesNotMatch(JSON.stringify(fixture.stages), /synthetic-session|synthetic-trust|signature|clientDataJSON/);
});

test("session identity survives token renewal but not logout, lock or a different login", async () => {
  const fixture = setup();
  fixture.saveAdminSession("first", Date.now() + 60000, { sessionId: "same-session" });
  assert.equal(fixture.adminSessionIdentity(), "same-session");
  fixture.saveAdminSession("renewed", Date.now() + 60000, { sessionId: "same-session" });
  assert.equal(fixture.adminSessionIdentity(), "same-session");
  fixture.context.window.__rkAdminAuth.locked = true;
  assert.equal(fixture.adminSessionIdentity(), "");
  fixture.saveAdminSession("new-login", Date.now() + 60000, { sessionId: "new-session" });
  assert.equal(fixture.adminSessionIdentity(), "new-session");
  await fixture.signOutAdmin();
  assert.equal(fixture.adminSessionIdentity(), "");
});

test("late remembered-session restoration cannot replace a newer explicit sign-in", async () => {
  let release;
  const fixture = setup({ fetch: async () => new Promise(resolve => { release = () => resolve(Response.json({ token: "old-restore", exp: Date.now() + 60000, sessionId: "old" })); }) });
  const restoring = fixture.restoreAdminSession();
  await tick();
  fixture.saveAdminSession("new-signin", Date.now() + 60000, { sessionId: "new" });
  release();
  assert.equal(await restoring, false);
  assert.equal(fixture.adminSession(), "new-signin");
  assert.equal(fixture.adminSessionIdentity(), "new");
});

test("remember is opt-in, sign-out clears memory and blocks automatic restoration", async () => {
  const fixture = setup();
  await fixture.webauthnAuth("login", { remember: true });
  assert.equal(fixture.requests.filter(request => request.url.endsWith("/remember")).length, 1);
  assert.equal(JSON.parse(fixture.requests[0].options.body).remember, true);
  await fixture.signOutAdmin();
  assert.equal(fixture.adminSession(), "");
  assert.equal(fixture.values.get("rk:admin:blocked"), "1");
  assert.equal(await fixture.restoreAdminSession(), false);
  assert.equal(fixture.requests.some(request => request.url.endsWith("/restore")), false);
  assert.doesNotMatch(JSON.stringify([...fixture.values]), /synthetic-session|synthetic-trust/);
});

for (const stage of ["challenge", "provider", "verification"]) {
  test(`passkey cancellation during ${stage} rejects late success without session writes`, async () => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const fixture = setup();
    const originalFetch = fixture.context.fetch;
    fixture.context.fetch = async (url, options) => {
      if (url.endsWith(stage === "challenge" ? "/begin" : "/finish") && stage !== "provider") await held;
      return originalFetch(url, options);
    };
    if (stage === "provider") fixture.context.navigator.credentials.get = async () => { await held; return assertion; };
    const controller = new AbortController();
    const completion = fixture.webauthnAuth("login", { signal: controller.signal });
    const rejected = assert.rejects(completion, { name: "AbortError" });
    await tick();
    controller.abort();
    await rejected;
    release();
    await tick();
    assert.equal(fixture.values.has("rk:admin:sess"), false);
    assert.equal(fixture.values.has("rk:trust"), false);
    if (stage !== "verification") assert.equal(fixture.requests.some(request => request.url.endsWith("/finish")), false);
  });
}

test("publish verification returns its result without establishing a login session", async () => {
  const fixture = setup();
  await fixture.webauthnAuth("publish");
  assert.equal(fixture.values.size, 0);
});

test("provider errors remain distinct from server verification errors", async () => {
  const fixture = setup({ navigator: { credentials: { get: async () => { throw new DOMException("Provider unavailable", "NotAllowedError"); } } } });
  await assert.rejects(fixture.webauthnAuth("login"), error => error.stage === "Passkey provider" && error.name === "NotAllowedError" && !/incorrect/i.test(error.message));
  assert.equal(fixture.requests.length, 1);
});

test("network deadlines abort the request even when the underlying task ignores cancellation", async () => {
  const fixture = setup();
  let signal;
  await assert.rejects(fixture.authStage("Challenge", incoming => { signal = incoming; return new Promise(() => {}); }, {}, 5), { name: "TimeoutError", stage: "Challenge" });
  assert.equal(signal.aborted, true);
});

test("unavailable account status preserves the last known mode without inventing a password fallback", async () => {
  const fixture = setup({ fetch: async () => { throw new TypeError("Offline"); } });
  const cached = { passwordless: true, hasRecovery: true, passkeys: 2, hasAdminPass: true };
  fixture.values.set("rk:authmode", JSON.stringify(cached));
  const mode = await fixture.authStatus();
  assert.equal(mode.unavailable, true);
  assert.equal(mode.passwordless, true);
  assert.equal(mode.hasRecovery, true);
  assert.deepEqual(JSON.parse(fixture.values.get("rk:authmode")), cached);
  fixture.values.clear();
  assert.equal((await fixture.authStatus()).passwordless, null);
});

test("cancelled password and recovery requests cannot persist late sessions", async () => {
  for (const method of ["adminLogin", "recoverWithPassphrase"]) {
    let release, requestStarted;
    const started = new Promise(resolve => { requestStarted = resolve; });
    const fixture = setup({ fetch: async () => { requestStarted(); return new Promise(resolve => { release = () => resolve(Response.json({ token: "late", exp: Date.now() + 60000 })); }); } });
    const controller = new AbortController();
    const completion = method === "adminLogin" ? fixture.adminLogin("synthetic", { signal: controller.signal }) : fixture.recoverWithPassphrase("synthetic", "", { signal: controller.signal });
    const rejection = assert.rejects(completion, { name: "AbortError" });
    await started;
    controller.abort();
    await rejection;
    release();
    await tick();
    assert.equal(fixture.values.has("rk:admin:sess"), false);
  }
});

test("gate cancellation and navigation ignore late success and prevent overlapping ceremonies", async () => {
  const admin = readFileSync(new URL("./src/js/admin.js", import.meta.url), "utf8");
  const start = admin.indexOf("    let gateAttempt"), end = admin.indexOf("    let recovering", start);
  assert.ok(start > 0 && end > start);
  for (const cancel of ["done", "leaveGate"]) {
    let release, opened = 0, attempts = 0, signal;
    const buttons = [{ disabled: false }, { disabled: false }];
    const gate = runInNewContext(`(() => { ${admin.slice(start, end)} return {doPasskey,done,leaveGate}; })()`, {
      AbortController, modal: { querySelectorAll: () => buttons, remove() {} }, err: { textContent: "" },
      window: { addEventListener() {}, removeEventListener() {} }, rememberDevice: () => false,
      webauthnAuth: async (purpose, options) => { attempts++; signal = options.signal; await new Promise(resolve => { release = resolve; }); },
      openStudio: () => { opened++; }
    });
    const completion = gate.doPasskey();
    await gate.doPasskey();
    assert.equal(attempts, 1);
    gate[cancel]();
    assert.equal(signal.aborted, true);
    release();
    await completion;
    assert.equal(opened, 0);
  }
});

test("a verified server login does not depend on optional local gate caching", async () => {
  const admin = readFileSync(new URL("./src/js/admin.js", import.meta.url), "utf8");
  const start = admin.indexOf("    async function submit()"), end = admin.indexOf('\n    modal.querySelector("[data-go]").addEventListener', start);
  assert.ok(start >= 0 && end > start);
  for (const failAt of ["hash", "record", "storage"]) {
    let opened = 0;
    const attempt = new AbortController();
    const submit = runInNewContext(`(${admin.slice(start, end)})`, {
      gateClosed: false, gateAttempt: null, recovering: false, creating: false, publishedGate: null, stored: null, ADMIN_WORKER: "synthetic-worker", rememberDevice: () => false,
      pass: { value: "synthetic-password", style: { display: "" } }, err: { textContent: "" },
      beginGateAttempt: () => attempt, currentGateAttempt: () => !attempt.signal.aborted, endGateAttempt: () => {},
      adminLogin: async () => ({ ok: true }),
      sha256: async () => { if (failAt === "hash") throw new Error("Synthetic cache failure"); return "synthetic-hash"; },
      rkGateRecord: async () => { if (failAt === "record") throw new Error("Synthetic cache failure"); return {}; },
      localStorage: { setItem() { if (failAt === "storage") throw new Error("Synthetic quota failure"); } },
      HASH_KEY: "synthetic-hash", GATE_KEY: "synthetic-gate", done: () => {}, openStudio: () => { opened++; }
    });
    await submit();
    assert.equal(opened, 1, failAt);
  }
});