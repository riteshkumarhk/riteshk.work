import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { PasskeyChallenges, passkeyChallenge } from "./worker/passkey-challenges.mjs";
import { contentRevision } from "./src/js/content-revision.mjs";
import { writeContentRevision } from "./worker/content-publishing.mjs";
import { readOperationalState, updateOperationalState } from "./worker/operational-state.mjs";
import { createHostedResumeStore } from "./worker/resume-workspace.mjs";
import { createResume, resumeText } from "./src/js/resume-workspace.mjs";
import { createPresenterMetadataStore, presenterMetadataRoute } from "./worker/presenter-metadata.mjs";
import { createPresenterMetadataSync } from "./src/js/presenter-metadata-sync.mjs";

const bundled = await build({ entryPoints: ["worker/rk-ai-proxy.js"], bundle: true, write: false, format: "esm", platform: "node", packages: "external" });
const { default: worker, ContentPublisher } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

function challengeFixture() {
  const stores = new Map();
  const binding = {
    idFromName: value => value,
    get(id) {
      if (!stores.has(id)) {
        const values = new Map();
        let queue = Promise.resolve();
        const storage = {
          get: async key => structuredClone(values.get(key)), put: async (key, value) => values.set(key, structuredClone(value)),
          setAlarm: async time => { storage.alarm = time; }, deleteAll: async () => values.clear(),
          transaction(run) { const result = queue.then(() => run(storage)); queue = result.catch(() => {}); return result; }
        };
        stores.set(id, { object: new PasskeyChallenges({ storage }), values, storage });
      }
      return { fetch: (url, options) => stores.get(id).object.fetch(new Request(url, options)) };
    }
  };
  return { env: { PASSKEY_CHALLENGES: binding }, stores };
}

test("Presenter metadata conditional writes preserve independent fields and reject stale edits", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', r2Buckets: ['PRESENTER'] });
  try {
    const bucket = await runtime.getR2Bucket('PRESENTER'), store = createPresenterMetadataStore(bucket);
    const initial = await store.get('case-one', 'deck-one');
    assert.deepEqual(initial, { version: 1, revision: 0, fields: [] });
    await Promise.all(['notes', 'title'].map(key => store.edit('case-one', 'deck-one', { slideId: 'first', key, initial: '', value: 'Private ' + key, expected: 0 })));
    const record = await store.get('case-one', 'deck-one');
    assert.equal(record.fields.length, 2);
    assert.equal(record.revision, 2);
    const edits = await Promise.allSettled(['Device one', 'Device two'].map(value => store.edit('case-one', 'deck-one', { slideId: 'first', key: 'notes', initial: '', value, expected: 1 })));
    assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(edits.find(result => result.status === 'rejected').reason.status, 409);
    const saved = await store.get('case-one', 'deck-one');
    assert.equal(saved.fields.find(field => field.key === 'notes').initial, '');
    assert.equal(saved.fields.find(field => field.key === 'title').value, 'Private title');
    await assert.rejects(store.edit('case-one', 'deck-one', { slideId: 'first', key: 'scene', initial: '', value: 'media', expected: 0 }), { status: 400 });
    await assert.rejects(store.get('../case', 'deck-one'), { status: 400 });
    assert.deepEqual((await store.get('case-two', 'deck-one')).fields, []);
    const response = await presenterMetadataRoute(new Request('https://example.test/admin/presenter-metadata?case=case-one&deck=deck-one'), bucket, {});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), saved);
  } finally { await runtime.dispose(); }
});

test("Presenter metadata clients retain offline edits, compare conflicts and ignore signed-out responses", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', r2Buckets: ['PRESENTER'] });
  try {
    const store = createPresenterMetadataStore(await runtime.getR2Bucket('PRESENTER'));
    const firstSlides = [{ id: 'first', notes: 'Original', title: '' }], secondSlides = structuredClone(firstSlides);
    let offline = false, firstState, secondState, valid = true, hold;
    const client = (slides, load, save) => createPresenterMetadataSync({
      storage: { load, save }, current: () => valid, read: () => slides,
      apply: async (id, key, value) => { slides.find(slide => slide.id === id)[key] = value; },
      request: async (method, body) => { if (offline) throw new Error('Offline; local edits kept.'); const result = method === 'GET' ? await store.get('case', 'native') : await store.edit('case', 'native', body); if (hold) await hold; return result; }
    });
    const first = client(firstSlides, () => firstState, value => { firstState = structuredClone(value); });
    const second = client(secondSlides, () => secondState, value => { secondState = structuredClone(value); });
    await first.refresh(); await second.refresh();
    firstSlides[0].title = 'Deferred name';
    await first.edit('first', 'title', 'Deferred name', '', { defer: true });
    assert.equal((await store.get('case', 'native')).fields.length, 0);
    await first.refresh({ applyRemote: false });
    await second.refresh({ applyRemote: false }); assert.equal(secondSlides[0].title, '');
    await second.refresh(); assert.equal(secondSlides[0].title, 'Deferred name');
    offline = true; firstSlides[0].notes = 'Offline private edit';
    assert.match((await first.edit('first', 'notes', firstSlides[0].notes, 'Original')).saveStatus, /Offline/);
    assert.equal(firstState.pending.length, 1);
    offline = false;
    await client(firstSlides, () => firstState, value => { firstState = value; }).refresh();
    assert.equal(firstState.pending.length, 0);
    await second.refresh(); assert.equal(secondSlides[0].notes, 'Offline private edit');
    secondSlides[0].notes = 'Second device'; await second.edit('first', 'notes', 'Second device', 'Offline private edit');
    firstSlides[0].notes = 'First device newer';
    const conflict = await first.edit('first', 'notes', 'First device newer', 'Offline private edit');
    assert.equal(conflict.conflicts[0].remote, 'Second device');
    assert.equal(firstSlides[0].notes, 'First device newer');
    await first.resolve('first', 'notes', 'local', 'First device newer', 'Second device');
    await second.refresh(); assert.equal(secondSlides[0].notes, 'First device newer');
    firstSlides[0].title = 'Private name'; await first.edit('first', 'title', 'Private name', '');
    let release; hold = new Promise(resolve => { release = resolve; });
    const refreshing = second.refresh();
    await new Promise(resolve => setImmediate(resolve)); valid = false; release();
    assert.match((await refreshing).saveStatus, /session changed/);
    assert.equal(secondSlides[0].title, 'Deferred name');
  } finally { await runtime.dispose(); }
});

test("Hosted resume R2 CAS preserves concurrent versions and immutable source bytes", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', r2Buckets: ['RESUMES'] });
  try {
    const bucket = await runtime.getR2Bucket('RESUMES'), store = createHostedResumeStore(bucket);
    const bytes = new TextEncoder().encode('Original fictional source.');
    const source = await store.source({ name: 'Original.txt', type: 'text/plain', text: 'Original fictional source.' }, bytes);
    const document = createResume({ id: 'cloud-fixture', name: 'Private resume', sourceIds: [source.id], model: { summary: 'Original summary', contact: {}, sections: [] } });
    await store.create(document);
    const updates = await Promise.allSettled(['First change', 'Second change'].map(summary => store.save(document.id, { ...document, model: { ...document.model, summary } }, 1)));
    assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(updates.find(result => result.status === 'rejected').reason.status, 409);
    const current = await store.get(document.id); assert.equal(current.version, 2); assert.equal(current.versions[0].document.model.summary, 'Original summary');
    await store.restore(document.id, 1, 2); assert.equal((await store.get(document.id)).version, 3);
    await assert.rejects(store.create(document), { status: 409 });
    assert.equal((await store.source({ name: 'Changed.txt', type: 'text/plain', text: 'Replacement extraction' }, bytes)).text, 'Original fictional source.');
    assert.deepEqual(new Uint8Array((await store.sourceFile(source.id)).bytes), bytes);
    assert.equal((await store.list()).documents.length, 1);
    await assert.rejects(store.get('../vault'), { status: 400 });
    await assert.rejects(store.save(document.id, { ...document, sourceIds: ['f'.repeat(64)] }, 3), /source is missing/);
    for (const change of [{ design: null }, { design: { ...document.design, font: 'unknown' } }, { target: { ...document.target, jd: 12 } }, { model: { ...document.model, summary: {} } }]) {
      await assert.rejects(store.save(document.id, { ...document, ...change }, 3), { status: 400 });
      assert.equal((await store.get(document.id)).version, 3);
    }
    const hybrid = { ...document, design: { ...document.design, layout: 'hybrid' } };
    await store.save(document.id, hybrid, 3);
    assert.equal((await store.get(document.id)).document.design.layout, 'hybrid');
    await store.restore(document.id, 3, 4);
    assert.equal((await store.get(document.id)).document.design.layout, 'single');
  } finally { await runtime.dispose(); }
});
test("transactional passkey challenges allow exactly one concurrent redemption", async () => {
  const fixture = challengeFixture(), challenge = "a".repeat(43);
  await passkeyChallenge(fixture.env, "issue", challenge, { type: "auth", purpose: "publish" });
  const results = await Promise.all(Array.from({ length: 12 }, () => passkeyChallenge(fixture.env, "consume", challenge, { type: "auth" })));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).purpose, "publish");
  assert.equal(await passkeyChallenge(fixture.env, "read", challenge, { type: "auth" }), null);
  assert.equal(await passkeyChallenge(fixture.env, "issue", challenge, { type: "auth" }), null);
  assert.ok(fixture.stores.get(challenge).storage.alarm > Date.now());
});

test("challenge expiry and type checks cannot redeem or replace an existing ceremony", async () => {
  const fixture = challengeFixture(), challenge = "b".repeat(43);
  await passkeyChallenge(fixture.env, "issue", challenge, { type: "reg" });
  assert.equal(await passkeyChallenge(fixture.env, "consume", challenge, { type: "auth" }), null);
  const store = fixture.stores.get(challenge);
  store.values.get("challenge").exp = Date.now() - 1;
  assert.equal(await passkeyChallenge(fixture.env, "consume", challenge, { type: "reg" }), null);
  await store.object.alarm();
  assert.equal(store.values.size, 0);
});

test("missing or failed challenge storage fails closed without KV fallback", async () => {
  await assert.rejects(passkeyChallenge({}, "issue", "a".repeat(43), { type: "auth" }), { status: 503 });
  const fixture = challengeFixture();
  fixture.env.PASSKEY_CHALLENGES.get = () => { throw new Error("Offline"); };
  await assert.rejects(passkeyChallenge(fixture.env, "consume", "a".repeat(43), { type: "auth" }), { status: 503 });
});

async function signedWorkerFixture() {
  const { env } = challengeFixture(), values = new Map();
  Object.assign(env, {
    SESSION_SECRET: "disposable-test-secret", ALLOW_ORIGIN: "https://synthetic.test", RP_ID: "synthetic.test",
    VAULT_GRANTS: { get: async (key, format) => { const value = values.get(key); return value ? format === "json" ? JSON.parse(value) : value : null; }, put: async (key, value) => values.set(key, value), list: async () => ({ keys: [] }) }
  });
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  values.set("wa:cred:synthetic", JSON.stringify({ jwk: await crypto.subtle.exportKey("jwk", keys.publicKey), alg: -257, counter: 0 }));
  const send = (action, body) => worker.fetch(new Request("https://synthetic.test/admin/webauthn/auth/" + action, { method: "POST", headers: { Origin: "https://synthetic.test", "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  async function assertion(purpose = "login", flags = 1) {
    const response = await send("begin", { purpose });
    assert.equal(response.status, 200);
    const { challenge } = await response.json();
    const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: "https://synthetic.test" }));
    const auth = Buffer.concat([Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from("synthetic.test"))), Buffer.from([flags, 0, 0, 0, 0])]);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, Buffer.concat([auth, Buffer.from(await crypto.subtle.digest("SHA-256", client))]));
    return { id: "synthetic", response: { clientDataJSON: client.toString("base64url"), authenticatorData: auth.toString("base64url"), signature: Buffer.from(signature).toString("base64url") } };
  }
  return { env, send, assertion, values };
}

test('ATS cutover rejects old-editor writes and deletes while retaining unrelated Prepare tools', async () => {
  const fixture = await signedWorkerFixture();
  const login = await (await fixture.send('finish', await fixture.assertion())).json();
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', r2Buckets: ['RESUMES', 'VAULT'] });
  try {
    fixture.env.RESUMES = await runtime.getR2Bucket('RESUMES'); fixture.env.VAULT = await runtime.getR2Bucket('VAULT');
    const request = (path, body, authorized = true) => worker.fetch(new Request('https://synthetic.test/admin/' + path, { method: 'POST', headers: { Origin: 'https://synthetic.test', Authorization: authorized ? 'Bearer ' + login.token : '', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), fixture.env);
    const entry = { id: 'legacy-route', tool: 'ats', kind: 'workspace', at: 1, payload: { rb: createResume({ model: { summary: 'Retained legacy text', contact: {}, sections: [] } }).model } };
    assert.equal((await request('prep/put', entry)).status, 200);
    assert.equal((await request('resume/migrate', { entry }, false)).status, 401);
    const migrated = await request('resume/migrate', { entry }); assert.equal(migrated.status, 200);
    const record = await migrated.json();
    assert.equal((await request('prep/put', entry)).status, 200);
    const changed = structuredClone(entry); changed.payload.rb.summary = 'Late old-editor change';
    const rejected = await request('prep/put', changed);
    assert.equal(rejected.status, 409); assert.equal((await rejected.json()).resumeId, record.document.id);
    assert.equal((await request('prep/del', { tool: 'ats', id: entry.id })).status, 409);
    assert.deepEqual(await (await fixture.env.VAULT.get('prep/ats/' + entry.id + '.json')).json(), entry);
    assert.equal((await request('prep/put', { id: 'letter-route', tool: 'cl', kind: 'letter', at: 2, payload: { letter: 'Unrelated Prepare content' } })).status, 200);
    assert.equal((await request('prep/del', { tool: 'cl', id: 'letter-route' })).status, 200);
    assert.equal((await request('resume/resumes/' + record.document.id + '/recover-legacy', {}, false)).status, 401);
    assert.equal((await createHostedResumeStore(fixture.env.RESUMES).get(record.document.id)).version, 1);
  } finally { await runtime.dispose(); }
});

test("Presenter metadata routes accept only owner sessions and allowed origins", async () => {
  const fixture = await signedWorkerFixture();
  const login = await (await fixture.send('finish', await fixture.assertion())).json();
  const publish = await (await fixture.send('finish', await fixture.assertion('publish'))).json();
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', r2Buckets: ['VAULT'] });
  try {
    fixture.env.VAULT = await runtime.getR2Bucket('VAULT');
    const request = (options = {}) => worker.fetch(new Request('https://synthetic.test/admin/presenter-metadata?case=case-one&deck=deck-one', {
      ...options, headers: { Origin: 'https://synthetic.test', Authorization: 'Bearer ' + login.token, ...options.headers }
    }), fixture.env);
    for (const token of ['', 'Bearer visitor', 'Bearer ' + publish.publishToken, 'Bearer ' + login.trust]) {
      const response = await request({ headers: { Authorization: token } });
      assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const origin of ['', 'https://untrusted.test']) {
      assert.equal((await request({ headers: { Origin: origin } })).status, 403);
      assert.equal((await request({ method: 'OPTIONS', headers: { Origin: origin } })).status, 403);
    }
    assert.equal((await request({ method: 'OPTIONS', headers: { Authorization: '' } })).status, 204);
    const input = { slideId: 'slide-one', key: 'notes', value: 'Private live note', initial: '', expected: 0 };
    assert.equal((await request({ method: 'POST', body: JSON.stringify(input) })).status, 200);
    assert.equal((await request({ method: 'POST', body: JSON.stringify(input) })).status, 409);
    const response = await request();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).fields[0].value, input.value);
    assert.deepEqual((await fixture.env.VAULT.list()).objects.map(object => object.key), ['presenter-metadata/case-one/deck-one.json']);
  } finally { await runtime.dispose(); }
});

test("Hosted resume routes require an owner session and allowed origin without touching the vault", async () => {
  const fixture = await signedWorkerFixture();
  const login = await (await fixture.send('finish', await fixture.assertion())).json();
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', r2Buckets: ['RESUMES'] });
  try {
    fixture.env.RESUMES = await runtime.getR2Bucket('RESUMES');
    const request = (path, options = {}) => worker.fetch(new Request('https://synthetic.test/admin/resume/' + path, { ...options, headers: { Origin: 'https://synthetic.test', Authorization: 'Bearer ' + login.token, ...options.headers } }), fixture.env);
    const preflight = await request('resumes/route-fixture', { method: 'OPTIONS', headers: { Authorization: '', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type,if-match,x-resume-pages' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /If-Match,X-Resume-Pages/);
    assert.equal(preflight.headers.get('Cache-Control'), 'no-store');
    assert.equal((await request('library', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.test' } })).status, 403);
    assert.equal((await request('library', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await request('library', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
    assert.equal((await request('library', { headers: { Origin: '' } })).status, 403);
    const document = createResume({ id: 'route-fixture', model: { summary: 'Private text', contact: {}, sections: [] } });
    assert.equal((await request('resumes', { method: 'POST', body: JSON.stringify({ document }) })).status, 200);
    assert.equal((await request('resumes/route-fixture', { method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify({ document }) })).status, 200);
    assert.equal((await request('resumes/route-fixture', { method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify({ document }) })).status, 409);
    const response = await request('library'); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).documents[0].version, 2);
    assert.equal((await request('sources', { method: 'POST', body: JSON.stringify({ base64: 'bad!', text: '' }) })).status, 400);
    let renders = 0;
    fixture.env.BROWSER = { async quickAction(action, options) {
      renders++; assert.equal(action, 'pdf'); assert.equal(options.waitForSelector.selector, 'html[data-resume-verified]');
      assert.match(options.html, /body\{visibility:hidden\}/); assert.equal(options.allowRequestPattern.length, 1);
      return new Response('%PDF-synthetic-unit-fixture-not-a-real-artifact');
    } };
    const staged = await (await request('resumes/route-fixture/export', { method: 'POST', headers: { 'If-Match': '2' }, body: '{}' })).json();
    const check = { id: staged.pending.id, sha256: staged.pending.sha256, expectedPages: 1, positions: [{ width: 595.28, height: 841.89, items: [{ str: resumeText(document), x: 40, y: 60, w: 300, h: 12 }] }], links: [] };
    const finish = input => request('resumes/route-fixture/finalize', { method: 'POST', headers: { 'If-Match': '2' }, body: JSON.stringify(input) });
    const expired = { ...staged.pending, id: 'expired-render', at: Date.now() - 16 * 60000 };
    await fixture.env.RESUMES.put('pending/expired-render.json', JSON.stringify(expired));
    await fixture.env.RESUMES.put('pending/expired-render.pdf', 'expired fixture bytes');
    const unrelated = { ...expired, id: 'other-resume-render', documentId: 'other-resume' };
    await fixture.env.RESUMES.put('pending/other-resume-render.json', JSON.stringify(unrelated));
    await fixture.env.RESUMES.put('pending/other-resume-render.pdf', 'other resume bytes');
    assert.equal((await finish({ ...check, id: unrelated.id })).status, 404);
    assert.ok(await fixture.env.RESUMES.head('pending/other-resume-render.pdf'));
    assert.equal((await finish({ ...check, id: expired.id })).status, 409);
    assert.equal(await fixture.env.RESUMES.head('pending/expired-render.json'), null);
    assert.equal(await fixture.env.RESUMES.head('pending/expired-render.pdf'), null);
    await fixture.env.RESUMES.put('pending/missing-render.json', JSON.stringify({ ...staged.pending, id: 'missing-render' }));
    const missing = await finish({ ...check, id: 'missing-render' });
    assert.equal(missing.status, 404); assert.match((await missing.json()).error, /Export again/);
    assert.ok(await fixture.env.RESUMES.head('pending/' + check.id + '.pdf'));
    assert.equal((await finish({ ...check, sha256: 'wrong' })).status, 422);
    assert.equal((await finish({ ...check, positions: [] })).status, 422);
    assert.equal((await request('resumes/route-fixture/exports/' + check.id)).status, 404);
    assert.equal((await finish(check)).status, 200);
    assert.equal((await request('resumes/route-fixture/exports/' + check.id)).status, 200);
    const cached = await (await request('resumes/route-fixture/export', { method: 'POST', headers: { 'If-Match': '2' }, body: '{}' })).json();
    assert.equal(cached.entry.id, check.id); assert.equal(renders, 1);
    assert.equal((await finish(check)).status, 404);
    assert.equal([...fixture.values.keys()].some(key => key.startsWith('prep/') || key.startsWith('resume/')), false);
  } finally { await runtime.dispose(); }
});
test("vault index publishing skips unchanged writes while retaining historical keys and response counts", async () => {
  const fixture = await signedWorkerFixture();
  const login = await (await fixture.send("finish", await fixture.assertion())).json();
  fixture.values.set("vaultkeys:example", JSON.stringify(["old.png", "current.png"]));
  const writes = [], put = fixture.env.VAULT_GRANTS.put;
  fixture.env.VAULT_GRANTS.put = async (key, value) => { writes.push(key); return put(key, value); };
  const publish = map => worker.fetch(new Request("https://synthetic.test/admin/vault/keycache", {
    method: "POST", headers: { Authorization: "Bearer " + login.token, "Content-Type": "application/json" }, body: JSON.stringify({ map })
  }), fixture.env);
  assert.deepEqual(await (await publish({ example: ["current.png"] })).json(), { ok: true, count: 1 });
  assert.deepEqual(writes, []);
  assert.deepEqual(await (await publish({ example: ["new.png"], empty: [] })).json(), { ok: true, count: 2 });
  assert.deepEqual(writes, ["vaultkeys:example"]);
  assert.deepEqual(JSON.parse(fixture.values.get("vaultkeys:example")), ["old.png", "current.png", "new.png"]);
  await publish({ example: ["new.png", "current.png"] });
  assert.deepEqual(writes, ["vaultkeys:example"]);
});

test("release checklist requires a scoped, user-verified owner passkey and rejects other tokens", async () => {
  const fixture = await signedWorkerFixture();
  const request = (token = "", origin = "https://synthetic.test", path = "/admin/release-checks") => worker.fetch(new Request("https://synthetic.test" + path, { headers: { Origin: origin, Authorization: "Bearer " + token } }), fixture.env);
  assert.equal((await request()).status, 401);
  const login = await (await fixture.send("finish", await fixture.assertion())).json();
  assert.equal((await request(login.token)).status, 401);
  const publish = await (await fixture.send("finish", await fixture.assertion("publish"))).json();
  assert.equal((await request(publish.publishToken)).status, 401);
  assert.equal((await fixture.send("finish", await fixture.assertion("release-checks"))).status, 401);
  const begin = await (await fixture.send("begin", { purpose: "release-checks" })).json();
  assert.equal(begin.userVerification, "required");
  const signed = await fixture.send("finish", await fixture.assertion("release-checks", 5));
  const access = await signed.json();
  assert.ok(access.checklistToken);
  assert.equal(access.token, undefined);
  assert.equal(access.trust, undefined);
  assert.equal(signed.headers.get("Cache-Control"), "no-store");
  assert.equal((await request(access.checklistToken)).status, 503);
  assert.equal((await request(access.checklistToken, "https://other.test")).status, 403);
  assert.equal((await request(access.checklistToken, "https://synthetic.test", "/admin/content")).status, 401);
  assert.equal((await request(access.checklistToken + "x")).status, 401);
  fixture.values.delete("wa:cred:synthetic");
  assert.equal((await request(access.checklistToken)).status, 401);
});

test("admin sessions reject visitor, publish, trust and malformed tokens without breaking legacy owner sessions", async () => {
  const fixture = await signedWorkerFixture();
  const login = await (await fixture.send("finish", await fixture.assertion())).json();
  const request = (path, token, body) => worker.fetch(new Request("https://synthetic.test" + path, {
    method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined
  }), fixture.env);
  assert.equal((await request("/admin/keyring", login.token)).status, 200);
  assert.equal((await request("/vault/grant", login.token, { code: "limited-fixture", keys: ["allowed.png"] })).status, 200);
  const grant = await (await request("/vault/redeem", "", { code: "limited-fixture" })).json();
  const publish = await (await fixture.send("finish", await fixture.assertion("publish"))).json();
  const checklist = await (await fixture.send("finish", await fixture.assertion("release-checks", 5))).json();
  const signingKey = await crypto.subtle.importKey("raw", Buffer.from(fixture.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sign = async (claim, prefix = "") => {
    const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
    return payload + "." + Buffer.from(await crypto.subtle.sign("HMAC", signingKey, Buffer.from(prefix + payload))).toString("base64url");
  };
  const exp = Date.now() + 60000;
  assert.equal((await request("/admin/keyring", await sign({ exp }))).status, 200);
  const rejected = [grant.token, publish.publishToken, checklist.checklistToken, login.trust, login.token + ".extra", login.token + "x",
    await sign({ exp: String(exp) }), await sign({ exp, g: "visitor" }), await sign({ exp, pub: 1 }), await sign({ exp: Date.now() - 1 }),
    await sign({ exp: Date.now() + 30 * 86400000 }), await sign({ exp, scope: "admin-session" }), await sign({ exp, scope: "admin-session", g: "visitor" }, "session.")];
  for (const token of rejected) {
    assert.equal((await request("/admin/keyring", token)).status, 401);
    assert.equal((await request("/admin/publish/config", token, { proof: "must-not-save", require: false })).status, 401);
  }
  assert.equal(fixture.values.has("cfg:publishproof"), false);
  assert.equal((await request("/vault/sign?key=allowed.png", grant.token)).status, 401);
  assert.equal((await worker.fetch(new Request("https://synthetic.test/vault/sign?key=allowed.png", { headers: { "X-Vault-Grant": grant.token } }), fixture.env)).status, 200);
});

test("existing pass codes and visitor tokens retain media access but never become owner sessions", async () => {
  const fixture = await signedWorkerFixture();
  const signingKey = await crypto.subtle.importKey("raw", Buffer.from(fixture.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sign = async value => Buffer.from(await crypto.subtle.sign("HMAC", signingKey, Buffer.from(value))).toString("base64url");
  const grantId = await sign("grant:existing-pass"), exp = Date.now() + 3600000;
  fixture.values.set("g:" + grantId, JSON.stringify({ keys: ["allowed.png"], exp }));
  const payload = Buffer.from(JSON.stringify({ g: grantId, exp })).toString("base64url");
  const existingToken = payload + "." + await sign(payload);
  const before = [...fixture.values];
  const redeemed = await worker.fetch(new Request("https://synthetic.test/vault/redeem", { method: "POST", body: JSON.stringify({ code: "existing-pass" }) }), fixture.env);
  const { token } = await redeemed.json();
  assert.equal(redeemed.status, 200);
  assert.deepEqual([...fixture.values], before);
  for (const visitorToken of [existingToken, token]) {
    const media = await worker.fetch(new Request("https://synthetic.test/vault/sign?key=allowed.png", { headers: { "X-Vault-Grant": visitorToken } }), fixture.env);
    assert.equal(media.status, 200);
    const denied = await worker.fetch(new Request("https://synthetic.test/admin/keyring", { headers: { Authorization: "Bearer " + visitorToken } }), fixture.env);
    assert.equal(denied.status, 401);
  }
});

test("inbox notifications report rejected HTTP actions as failures and retain successful feedback", async () => {
  for (const status of [200, 403, 500]) {
    const handlers = {}, shown = [];
    let completion;
    runInNewContext(readFileSync("inbox/sw.js", "utf8"), { self: { addEventListener: (name, callback) => { handlers[name] = callback; }, registration: { showNotification: async (title, options) => shown.push({ title, body: options.body }) } }, fetch: async () => new Response(status === 200 ? "Sent" : "Not sent", { status }), URL });
    handlers.notificationclick({ action: "allow", notification: { data: { allow: "https://synthetic.test/req/allow" }, close() {} }, waitUntil: promise => { completion = promise; } });
    await completion;
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title.startsWith("Access sent"), status === 200);
    assert.equal(shown[0].body, status === 200 ? "Sent" : "Not sent");
  }
});

test("one-tap access uses failure statuses and rejects GET without changing requests", async () => {
  const fixture = await signedWorkerFixture(), id = "req:fixture";
  fixture.values.set(id, JSON.stringify({ email: "synthetic@example.test" }));
  const key = await crypto.subtle.importKey("raw", Buffer.from(fixture.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const token = Buffer.from(await crypto.subtle.sign("HMAC", key, Buffer.from("reqallow." + id))).toString("base64url");
  const url = "https://synthetic.test/req/allow?id=" + encodeURIComponent(id) + "&t=" + token;
  assert.equal((await worker.fetch(new Request(url), fixture.env)).status, 405);
  for (const [grant, status] of [[null, 409], [{ code: "fixture", enabled: false }, 409], [{ code: "fixture", expiresAt: Date.now() - 1 }, 403]]) {
    if (grant) fixture.values.set("quickgrant:full", JSON.stringify(grant));
    const response = await worker.fetch(new Request(url, { method: "POST" }), fixture.env);
    assert.equal(response.status, status);
    assert.equal(fixture.values.has(id), true);
  }
});

function operationalBucket() {
  const records = new Map();
  let serial = 0;
  return {
    records, writes: () => serial,
    async get(key) { const record = records.get(key); return record ? { etag: record.etag, json: async () => JSON.parse(record.body) } : null; },
    async put(key, body, options) {
      const current = records.get(key);
      if (options.onlyIf.etagMatches ? current?.etag !== options.onlyIf.etagMatches : !!current) return null;
      const etag = String(++serial); records.set(key, { body, etag }); return { etag };
    }
  };
}

test("private operational state migrates KV history without writes or lost concurrent changes", async () => {
  const bucket = operationalBucket();
  const env = { VAULT: bucket, VAULT_GRANTS: { get: async () => ({ count: 7 }), put: () => assert.fail("KV writes forbidden") } };
  await Promise.all(Array.from({ length: 6 }, () => updateOperationalState(env, "analytics", {}, value => { value.count++; })));
  assert.equal((await readOperationalState(env, "analytics", {})).count, 13);
  const writes = bucket.writes();
  await updateOperationalState(env, "analytics", {}, () => false);
  assert.equal(bucket.writes(), writes);
  await assert.rejects(updateOperationalState({ ...env, VAULT: { get: async () => { throw new Error("Offline"); } } }, "analytics", {}, () => {}), /Offline/);
  await assert.rejects(updateOperationalState({ ...env, VAULT: { get: bucket.get, put: async () => null } }, "analytics", {}, () => {}), /busy/);
});

test("analytics and roaming usage avoid KV writes, retain history and merge concurrent devices", async () => {
  const fixture = await signedWorkerFixture();
  const session = await (await fixture.send("finish", await fixture.assertion())).json();
  const bucket = operationalBucket(), day = new Date().toISOString().slice(0, 10);
  fixture.env.VAULT = bucket;
  fixture.values.set("ev:agg", JSON.stringify({ v: 1, days: { [day]: { pv: 4, types: {}, geo: {}, dev: {}, brow: {}, os: {} } }, targets: {}, recent: [] }));
  fixture.values.set("ai:usage", JSON.stringify({ v: 1, devices: { legacy: { updated: Date.now(), days: {} } } }));
  const legacy = [...fixture.values];
  fixture.env.VAULT_GRANTS.put = () => assert.fail("Operational requests must not write KV");
  const send = (path, body) => worker.fetch(new Request("https://synthetic.test" + path, { method: body ? "POST" : "GET", headers: { Origin: "https://synthetic.test", Authorization: "Bearer " + session.token, "CF-Connecting-IP": "192.0.2.1" }, body: body ? JSON.stringify(body) : undefined }), fixture.env);
  await Promise.all(Array.from({ length: 5 }, () => send("/event", { t: "pageview" })));
  for (let index = 5; index < 125; index++) assert.equal((await send("/event", { t: "pageview" })).status, 200);
  const insights = await (await send("/admin/insights")).json();
  assert.equal(insights.events.pageviews, 124);
  const days = amount => ({ [day]: { openai: { fixture: { in: amount, out: 3, calls: 1 } } } });
  const responses = await Promise.all([send("/admin/ai/usage", { device: "first", days: days(10) }), send("/admin/ai/usage", { device: "second", days: days(20) })]);
  assert.ok(responses.every(response => response.status === 200));
  await send("/admin/ai/usage", { device: "first", days: days(1) });
  const usage = (await (await send("/admin/ai/usage")).json()).usage;
  assert.equal(usage.devices.first.days[day].openai.fixture.in, 10);
  assert.equal(usage.devices.second.days[day].openai.fixture.in, 20);
  assert.ok(usage.devices.legacy);
  assert.deepEqual([...fixture.values], legacy);
  const reset = await (await send("/admin/ai/usage", { reset: true, device: "first" })).json();
  assert.equal(reset.usage.devices.first, undefined);
  assert.ok(reset.usage.devices.second);
});

test("actual Worker rejects concurrent signed assertion replay and retains valid verification", async () => {
  const fixture = await signedWorkerFixture();
  const assertion = await fixture.assertion();
  const invalid = structuredClone(assertion);
  invalid.response.signature = Buffer.alloc(256).toString("base64url");
  assert.equal((await fixture.send("finish", invalid)).status, 401);
  const responses = await Promise.all(Array.from({ length: 5 }, () => fixture.send("finish", assertion)));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 400).length, 4);
  const session = await responses.find(response => response.status === 200).json();
  assert.ok(session.token && session.trust);
  const publish = await fixture.send("finish", await fixture.assertion("publish"));
  const result = await publish.json();
  assert.ok(result.publishToken);
  assert.equal(result.token, undefined);
});

function contentBucket(initial) {
  let bytes = new TextEncoder().encode(JSON.stringify(initial)), version = 1, writes = 0;
  return {
    get: async () => { const snapshot = bytes.slice(), etag = String(version); return { etag, json: async () => JSON.parse(new TextDecoder().decode(snapshot)), arrayBuffer: async () => snapshot.buffer }; },
    put: async (key, next, options) => { if (options.onlyIf.etagMatches !== String(version)) return null; bytes = new Uint8Array(next); version++; writes++; return { etag: String(version) }; },
    replace: value => { bytes = new TextEncoder().encode(JSON.stringify(value)); version++; },
    document: () => JSON.parse(new TextDecoder().decode(bytes)), writes: () => writes
  };
}

test("content revisions ignore key order but detect every content change", async () => {
  assert.equal(await contentRevision({ work: [], name: "first" }), await contentRevision({ name: "first", work: [] }));
  assert.notEqual(await contentRevision({ work: [], name: "first" }), await contentRevision({ work: [], name: "second" }));
});

test("conditional publishing rejects stale tabs without replacing newer content", async () => {
  const baseline = { work: [{ title: "Original" }] }, bucket = contentBucket(baseline), revision = await contentRevision(baseline);
  const publish = value => writeContentRevision(bucket, new TextEncoder().encode(JSON.stringify(value)), revision);
  const responses = await Promise.all([publish({ work: [{ title: "Newer" }] }), publish({ work: [{ title: "Older tab" }] })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412]);
  assert.equal(bucket.writes(), 1);
  const preserved = bucket.document();
  assert.equal((await publish({ work: [] })).status, 412);
  assert.deepEqual(bucket.document(), preserved);
});

test("R2 conditional write catches changes between the baseline check and write", async () => {
  const baseline = { work: [] }, bucket = contentBucket(baseline);
  const result = await writeContentRevision(bucket, new TextEncoder().encode(JSON.stringify({ work: [{ title: "Stale" }] })), await contentRevision(baseline), async () => bucket.replace({ work: [{ title: "Concurrent" }] }));
  assert.equal(result.status, 412);
  assert.equal(bucket.writes(), 0);
  assert.equal(bucket.document().work[0].title, "Concurrent");
});

test("old clients and invalid content fail without any storage mutation", async () => {
  const bucket = contentBucket({ work: [] }), bytes = new TextEncoder().encode("{}");
  assert.equal((await writeContentRevision(bucket, bytes, "")).status, 428);
  assert.equal((await writeContentRevision(bucket, new TextEncoder().encode("null"), "a".repeat(64))).status, 400);
  assert.equal(bucket.writes(), 0);
});

test("actual Worker enforces conditional publication and reports mirror state", async () => {
  const fixture = await signedWorkerFixture();
  const session = await (await fixture.send("finish", await fixture.assertion())).json();
  const baseline = { work: [] }, bucket = contentBucket(baseline), values = new Map();
  let queue = Promise.resolve();
  const state = {
    storage: { get: async key => values.get(key), put: async (key, value) => values.set(key, value), delete: async key => values.delete(key), setAlarm: async () => {}, deleteAlarm: async () => {} },
    blockConcurrencyWhile(run) { const result = queue.then(run); queue = result.catch(() => {}); return result; }
  };
  fixture.env.MEDIA = bucket;
  const publisher = new ContentPublisher(state, fixture.env);
  fixture.env.CONTENT_PUBLISHER = { idFromName: value => value, get: () => ({ fetch: (url, options) => publisher.fetch(new Request(url, options)) }) };
  const base = await contentRevision(baseline);
  const headers = { Origin: "https://synthetic.test", Authorization: "Bearer " + session.token, "X-Device-Trust": session.trust };
  const publish = revision => worker.fetch(new Request("https://synthetic.test/admin/content", { method: "POST", headers: { ...headers, "X-Content-Base": revision }, body: JSON.stringify({ work: [{ title: "New" }] }) }), fixture.env);
  const capabilities = await worker.fetch(new Request("https://synthetic.test/admin/content", { headers }), fixture.env);
  assert.equal((await capabilities.json()).conditional, true);
  assert.equal((await publish("")).status, 428);
  const success = await publish(base);
  const result = await success.json();
  assert.equal(success.status, 200);
  assert.equal(result.revision, await contentRevision(bucket.document()));
  assert.equal(result.git.ok, false);
  assert.equal(values.get("mirrorPending"), true);
  assert.equal((await publish(base)).status, 412);
  assert.equal(bucket.writes(), 1);
});

function publisherFixture(baseline) {
  const bucket = contentBucket(baseline), values = new Map(), objects = new Map();
  let queue = Promise.resolve(), serial = 0, head, patches = 0;
  const object = value => { const sha = "synthetic-" + ++serial; objects.set(sha, value); return sha; };
  const replaceGit = content => {
    const blob = object({ encoding: "base64", content: Buffer.from(JSON.stringify(content)).toString("base64") });
    const tree = object({ tree: [{ path: "content.json", type: "blob", sha: blob }] });
    head = object({ tree: { sha: tree }, parents: head ? [head] : [] });
  };
  replaceGit(baseline);
  const fixture = {
    bucket, values, loseAck: false, failCheckpoint: false, beforePatch: null,
    state: {
      storage: {
        get: async key => structuredClone(values.get(key)),
        put: async (key, value) => {
          if (fixture.failCheckpoint && key === "mirrorBase") { fixture.failCheckpoint = false; throw new Error("Synthetic storage interruption"); }
          if (typeof key === "object") Object.entries(key).forEach(([name, entry]) => values.set(name, structuredClone(entry)));
          else values.set(key, structuredClone(value));
        },
        delete: async key => values.delete(key),
        setAlarm: async time => { fixture.alarmAt = time; }, deleteAlarm: async () => { fixture.alarmAt = null; }
      },
      blockConcurrencyWhile(run) { const result = queue.then(run); queue = result.catch(() => {}); return result; }
    },
    fetch: async (url, options = {}) => {
      assert.match(url, /^https:\/\/api\.github\.com\/repos\/synthetic\/site\/git\//);
      const suffix = url.split("/git/")[1], method = options.method || "GET";
      if (method === "GET") return Response.json(suffix === "ref/heads/main" ? { object: { sha: head } } : objects.get(suffix.split("/")[1]));
      const body = JSON.parse(options.body);
      if (method === "POST") return Response.json({ sha: object(suffix === "commits" ? { ...body, tree: { sha: body.tree } } : body) });
      assert.equal(method, "PATCH");
      assert.equal(body.force, false);
      if (fixture.beforePatch) await fixture.beforePatch();
      if (objects.get(body.sha).parents[0] !== head) return Response.json({ message: "Ref changed" }, { status: 422 });
      head = body.sha;
      patches++;
      if (fixture.loseAck) { fixture.loseAck = false; throw new TypeError("Synthetic lost acknowledgement"); }
      return Response.json({ object: { sha: head } });
    },
    gitDocument: () => {
      const tree = objects.get(objects.get(head).tree.sha), blob = objects.get(tree.tree[0].sha);
      return JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"));
    },
    patches: () => patches, replaceGit,
    restart: () => { fixture.publisher = new ContentPublisher(fixture.state, { MEDIA: bucket, OWNER: "synthetic", REPO: "site", GH_TOKEN: "disposable" }); },
    publish: async (document, base) => fixture.publisher.fetch(new Request("https://publisher.test/", { method: "POST", headers: { "X-Content-Base": base }, body: JSON.stringify(document) }))
  };
  fixture.restart();
  return fixture;
}

test("publication mirror reconciles lost acknowledgements before the next revision", async context => {
  const baseline = { work: [] }, first = { work: [{ title: "First" }] }, latest = { work: [{ title: "Latest" }] };
  const fixture = publisherFixture(baseline);
  context.mock.method(globalThis, "fetch", fixture.fetch);
  fixture.loseAck = true;
  const firstResult = await (await fixture.publish(first, await contentRevision(baseline))).json();
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.git.ok, false);
  assert.deepEqual(fixture.gitDocument(), first);
  fixture.restart();
  const latestResult = await (await fixture.publish(latest, firstResult.revision)).json();
  assert.equal(latestResult.git.ok, true);
  assert.deepEqual(fixture.bucket.document(), latest);
  assert.deepEqual(fixture.gitDocument(), latest);
  assert.equal(fixture.patches(), 2);
  assert.equal(fixture.values.has("mirrorPending"), false);
});

test("publication mirror survives a storage interruption after Git accepted the content", async context => {
  const baseline = { work: [] }, latest = { work: [{ title: "Kept" }] }, fixture = publisherFixture(baseline);
  context.mock.method(globalThis, "fetch", fixture.fetch);
  fixture.beforePatch = () => { fixture.failCheckpoint = true; };
  await assert.rejects(fixture.publish(latest, await contentRevision(baseline)), /storage interruption/);
  assert.deepEqual(fixture.bucket.document(), latest);
  assert.deepEqual(fixture.gitDocument(), latest);
  fixture.beforePatch = null;
  fixture.restart();
  await fixture.publisher.alarm();
  assert.equal(fixture.patches(), 1);
  assert.equal(fixture.values.get("mirrorBase"), await contentRevision(latest));
  assert.equal(fixture.values.has("mirrorPending"), false);
});

test("publication mirror refuses independent edits and bounds background retries", async context => {
  const baseline = { work: [] }, independent = { work: [{ title: "Independent Git edit" }] }, fixture = publisherFixture(baseline);
  context.mock.method(globalThis, "fetch", fixture.fetch);
  fixture.replaceGit(independent);
  const result = await (await fixture.publish({ work: [{ title: "Live version" }] }, await contentRevision(baseline))).json();
  assert.equal(result.ok, true);
  assert.equal(result.git.ok, false);
  assert.match(result.git.error, /changed independently/);
  fixture.restart();
  await fixture.publisher.alarm();
  await fixture.publisher.alarm();
  assert.equal(fixture.alarmAt, null);
  assert.equal(fixture.values.get("mirrorPending"), true);
  assert.deepEqual(fixture.gitDocument(), independent);
  assert.equal(fixture.patches(), 0);
});

test("legacy Git proxy cannot bypass content publication but still accepts protected assets and fonts", async context => {
  const fixture = await signedWorkerFixture();
  const session = await (await fixture.send("finish", await fixture.assertion())).json();
  Object.assign(fixture.env, { OWNER: "synthetic", REPO: "site", GH_TOKEN: "disposable" });
  const upstream = [];
  context.mock.method(globalThis, "fetch", async (url, options) => { upstream.push({ url, options }); return Response.json({ sha: "synthetic-asset" }, { status: 201 }); });
  const send = (method, path) => worker.fetch(new Request("https://synthetic.test/admin/gh/repos/synthetic/site/" + path, {
    method, headers: { Origin: "https://synthetic.test", Authorization: "Bearer " + session.token, "X-Device-Trust": session.trust },
    body: JSON.stringify({ content: "c3ludGhldGlj", branch: "main" })
  }), fixture.env);
  for (const [method, path] of [["PATCH", "git/refs/heads/main"], ["PUT", "contents/content.json"], ["PUT", "contents/%63ontent.json"], ["POST", "merges"], ["POST", "git/refs"]]) {
    assert.equal((await send(method, path)).status, 428, method + " " + path);
  }
  assert.equal(upstream.length, 0);
  for (const path of ["contents/assets/protected/synthetic.enc", "contents/assets/uploads/synthetic.png", "contents/fonts/synthetic.woff2"]) {
    assert.equal((await send("PUT", path)).status, 201);
  }
  assert.equal(upstream.length, 3);
});

test("Cloudflare local runtime persists atomic challenges and conditional publications across restart", { timeout: 45000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "rk-worker-stability-"));
  const options = {
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-07-14",
    durableObjects: { PASSKEY_CHALLENGES: { className: "PasskeyChallenges", useSQLite: true }, CONTENT_PUBLISHER: { className: "ContentPublisher", useSQLite: true } },
    durableObjectsPersist: join(directory, "objects"), r2Buckets: ["MEDIA", "VAULT"], r2Persist: join(directory, "r2"),
    outboundService: () => { throw new Error("Local validation must not contact an external service"); }
  };
  let runtime = new Miniflare(options);
  try {
    const challenges = await runtime.getDurableObjectNamespace("PASSKEY_CHALLENGES");
    const challenge = "runtime".padEnd(43, "a"), object = challenges.get(challenges.idFromName(challenge));
    const send = action => object.fetch("https://challenge.test/" + action, { method: "POST", body: JSON.stringify({ type: "auth", purpose: "login" }) });
    assert.equal((await send("issue")).status, 200);
    const consumed = await Promise.all(Array.from({ length: 16 }, () => send("consume")));
    assert.equal(consumed.filter(response => response.status === 200).length, 1);
    assert.equal(consumed.filter(response => response.status === 409).length, 15);
    const bucket = await runtime.getR2Bucket("MEDIA"), baseline = { work: [] };
    await bucket.put("content.json", JSON.stringify(baseline));
    const base = await contentRevision(baseline), publishers = await runtime.getDurableObjectNamespace("CONTENT_PUBLISHER");
    const publisher = publishers.get(publishers.idFromName("content.json"));
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => publisher.fetch("https://publisher.test/", { method: "POST", headers: { "X-Content-Base": base }, body: JSON.stringify({ work: [{ title: "Concurrent " + index }] }) })));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 412).length, 7);
    const result = await responses.find(response => response.status === 200).json();
    const saved = await (await bucket.get("content.json")).json();
    assert.equal(result.revision, await contentRevision(saved));
    const operations = { VAULT: await runtime.getR2Bucket("VAULT"), VAULT_GRANTS: { get: async () => ({ count: 2 }) } };
    await Promise.all(Array.from({ length: 4 }, () => updateOperationalState(operations, "analytics", {}, value => { value.count++; })));
    assert.equal((await readOperationalState(operations, "analytics", {})).count, 6);
    await runtime.dispose();
    runtime = new Miniflare(options);
    const restartedChallenges = await runtime.getDurableObjectNamespace("PASSKEY_CHALLENGES");
    assert.equal((await restartedChallenges.get(restartedChallenges.idFromName(challenge)).fetch("https://challenge.test/consume", { method: "POST", body: JSON.stringify({ type: "auth" }) })).status, 409);
    const restartedBucket = await runtime.getR2Bucket("MEDIA");
    assert.deepEqual(await (await restartedBucket.get("content.json")).json(), saved);
    assert.equal((await readOperationalState({ VAULT: await runtime.getR2Bucket("VAULT") }, "analytics", {})).count, 6);
    const restartedPublishers = await runtime.getDurableObjectNamespace("CONTENT_PUBLISHER");
    const stale = await restartedPublishers.get(restartedPublishers.idFromName("content.json")).fetch("https://publisher.test/", { method: "POST", headers: { "X-Content-Base": base }, body: JSON.stringify(baseline) });
    assert.equal(stale.status, 412);
    assert.deepEqual(await (await restartedBucket.get("content.json")).json(), saved);
  } finally {
    await runtime.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});