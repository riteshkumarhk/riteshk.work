import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { AdminSessions } from './worker/admin-sessions.mjs';
import { PasskeyChallenges } from './worker/passkey-challenges.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const launchOptions = { headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.platform === 'win32' ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' } : {}) };
const scripts = new Map();
for (const name of ['admin', 'admin-studio']) {
  const bundle = await build({ entryPoints: ['src/js/' + name + '.js'], bundle: true, write: false, format: 'iife' });
  scripts.set('/js/' + name + '.js', bundle.outputFiles[0].text);
}
const bundled = await build({ entryPoints: ['worker/rk-ai-proxy.js'], bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external' });
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

function durableStorage() {
  const values = new Map();
  let queue = Promise.resolve();
  const transaction = run => { const result = queue.then(() => run(storage)); queue = result.catch(() => {}); return result; };
  const storage = { get: async key => structuredClone(values.get(key)), put: async (key, value) => values.set(key, structuredClone(value)), deleteAll: async () => values.clear(), setAlarm: async () => {}, deleteAlarm: async () => {}, transaction };
  return { values, storage, blockConcurrencyWhile: transaction };
}

async function fixture(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  const store = durableStorage(), sessions = new AdminSessions(store), challenges = new Map(), kv = new Map();
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const credentialId = Buffer.from('synthetic-session-passkey').toString('base64url');
  kv.set('wa:cred:' + credentialId, { jwk: await crypto.subtle.exportKey('jwk', keys.publicKey), alg: -7, counter: 0, label: 'Synthetic passkey', createdAt: Date.now() });
  const env = {
    ALLOW_ORIGIN: 'https://riteshk.work', SESSION_SECRET: 'synthetic-test-secret-not-production', RP_ID: 'riteshk.work',
    ADMIN_SESSIONS: { idFromName: value => value, get: () => ({ fetch: (url, init) => sessions.fetch(new Request(url, init)) }) },
    PASSKEY_CHALLENGES: { idFromName: value => value, get: id => {
      if (!challenges.has(id)) challenges.set(id, new PasskeyChallenges(durableStorage()));
      return { fetch: (url, init) => challenges.get(id).fetch(new Request(url, init)) };
    } },
    VAULT_GRANTS: {
      get: async (key, format) => { const value = kv.get(key); return format === 'json' ? typeof value === 'string' ? JSON.parse(value) : value : typeof value === 'object' ? JSON.stringify(value) : value ?? null; },
      put: async (key, value) => kv.set(key, value), delete: async key => kv.delete(key),
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) })
    }
  };
  const published = JSON.parse(readFileSync(join(directory, 'content.json'), 'utf8'));
  published.work = [{ id: 'session-fixture', client: 'Synthetic client', title: 'Session validation', study: { blocks: [{ type: 'text', heading: 'Retained draft', body: 'Original fictional content.' }] } }];
  published.contact = { ...published.contact, name: 'Synthetic owner', avatar: '', email: 'owner@example.test' };
  let offline = false;
  const observed = [];
  await context.route('**/*', async route => {
    const incoming = route.request(), url = new URL(incoming.url());
    if (url.pathname.endsWith('/content.json')) return route.fulfill({ json: published });
    if (url.pathname.startsWith('/admin/session/') || url.pathname.startsWith('/admin/webauthn/auth/')) {
      if (offline) return route.abort('internetdisconnected');
      const headers = await incoming.allHeaders();
      const response = await worker.fetch(new Request(incoming.url(), { method: incoming.method(), headers, ...(incoming.method() === 'POST' ? { body: incoming.postData() } : {}) }), env);
      const body = await response.text();
      observed.push({ path: url.pathname, status: response.status, body: JSON.parse(body) });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
    }
    if (url.pathname === '/admin/auth/status') return route.fulfill({ json: { passwordless: true, hasRecovery: true, passkeys: 1, hasAdminPass: true } });
    if (url.pathname === '/admin/webauthn/list') return route.fulfill({ json: { passkeys: [{ id: credentialId, label: 'Synthetic passkey' }] } });
    if (url.pathname.startsWith('/admin/')) return route.fulfill({ json: { requests: [], grants: [], bookings: [], documents: [], enabled: false } });
    if (url.origin !== 'https://riteshk.work') return route.abort();
    if (scripts.has(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: scripts.get(url.pathname) });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Public site</title><p>Published visitor page</p>' });
    const pathname = url.pathname === '/studio/' || url.pathname === '/studio' ? '/studio/index.html' : decodeURIComponent(url.pathname);
    if (pathname.includes('..')) return route.abort();
    const path = join(directory, pathname);
    if (!existsSync(path)) return route.fulfill({ status: 404, body: 'Not found' });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    return route.fulfill({ contentType: types[extname(path)] || 'application/octet-stream', body: readFileSync(path) });
  });
  async function page() {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: Buffer.from(credentialId, 'base64url').toString('base64'), isResidentCredential: true, rpId: 'riteshk.work', privateKey: Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64'), userHandle: Buffer.from('synthetic-owner').toString('base64'), signCount: 0 } });
    return page;
  }
  return { context, page, store, sessions, observed, offline: value => { offline = value; } };
}

async function login(page, remember = false) {
  await page.goto('https://riteshk.work/studio/');
  await page.locator('[data-auth-gate]').waitFor();
  assert.equal(await page.locator('[data-remember]').getAttribute('aria-checked'), 'false');
  if (remember) await page.locator('[data-remember]').click();
  await page.locator('[data-passkey]').click();
  await page.waitForFunction(() => !!window.__rkAdminAuth?.session || !!document.querySelector('.pass__err')?.textContent);
  const error = page.locator('[data-auth-gate] .pass__err');
  if (await error.count()) assert.equal(await error.textContent(), '');
  await page.locator('.adm.is-open').waitFor();
}

test('Remember information toggles independently by pointer and keyboard on desktop and phone', { timeout: 60000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    for (const width of [1440, 390, 320]) {
      const run = await fixture(browser, { viewport: { width, height: width === 1440 ? 1000 : 844 }, hasTouch: width < 400 });
      const page = await run.page();
      await page.goto('https://riteshk.work/studio/');
      const info = page.getByRole('button', { name: 'About remembering this device' });
      const remember = page.getByRole('switch', { name: 'Remember this device' });
      const note = page.locator('#admin-remember-note');
      await info.waitFor();
      assert.equal(await info.getAttribute('aria-controls'), await note.getAttribute('id'));
      assert.equal(await info.getAttribute('aria-expanded'), 'false');
      assert.equal(await note.isVisible(), false);
      assert.equal(await remember.getAttribute('aria-checked'), 'false');
      const iconBounds = await info.boundingBox(), labelBounds = await remember.boundingBox();
      assert.ok(iconBounds.x + iconBounds.width <= labelBounds.x);
      if (width < 400) await info.tap(); else await info.click();
      assert.equal(await note.isVisible(), true);
      assert.equal(await info.getAttribute('aria-expanded'), 'true');
      assert.equal(await remember.getAttribute('aria-checked'), 'false');
      assert.equal(await note.textContent(), '7-day maximum. Locks after 30 minutes of inactivity. Local drafts remain on this browser.');
      assert.equal(await page.locator('.pass__box').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.x >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth;
      }), true);
      await page.screenshot({ path: join(tmpdir(), `rk-remember-info-${width}-open.png`), fullPage: true });
      await info.press('Enter');
      assert.equal(await note.isVisible(), false);
      assert.equal(await info.getAttribute('aria-expanded'), 'false');
      await remember.click();
      await info.press('Space');
      assert.equal(await note.isVisible(), true);
      assert.equal(await remember.getAttribute('aria-checked'), 'true');
      await info.click();
      assert.equal(await note.isVisible(), false);
      assert.equal(await remember.getAttribute('aria-checked'), 'true');
      await page.screenshot({ path: join(tmpdir(), `rk-remember-info-${width}-closed.png`), fullPage: true });
      await page.reload(); await info.waitFor();
      assert.equal(await note.isVisible(), false);
      assert.equal(await remember.getAttribute('aria-checked'), 'false');
      await run.context.close();
    }
  } finally { await browser.close(); }
});

test('Admin default-off sign-in stays in memory and remember restores an HttpOnly session', { timeout: 90000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const run = await fixture(browser), page = await run.page();
    await login(page);
    assert.equal((await run.context.cookies()).some(cookie => cookie.name === '__Host-rk-admin'), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:admin:sess')), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:trust')), null);
    await page.reload(); await page.locator('[data-auth-gate]').waitFor();
    await page.locator('[data-remember]').click(); await page.locator('[data-passkey]').click();
    await page.locator('.adm.is-open').waitFor();
    const cookie = (await run.context.cookies()).find(cookie => cookie.name === '__Host-rk-admin');
    assert.ok(cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict');
    assert.ok(cookie.expires * 1000 <= Date.now() + 7 * 86400000);
    assert.equal(await page.evaluate(() => document.cookie.includes('__Host-rk-admin')), false);
    assert.ok(run.observed.every(result => !result.body.refresh && !result.body.rememberCredential));
    await page.reload(); await page.locator('.adm.is-open').waitFor();
    assert.equal(await page.locator('[data-auth-gate]').count(), 0);
    await page.clock.install();
    const original = await page.evaluate(() => {
      const session = window.__rkAdminAuth.session;
      session.exp = Date.now() + 30000;
      return { token: session.token, id: session.sessionId };
    });
    await page.clock.runFor(16000);
    await page.waitForFunction(token => window.__rkAdminAuth.session?.token !== token, original.token);
    assert.equal(await page.evaluate(() => window.__rkAdminAuth.session.sessionId), original.id);
    assert.equal(await page.locator('[data-auth-gate]').count(), 0);
    assert.equal(await page.locator('.adm.is-open').count(), 1);
    await page.clock.resume();
    await page.screenshot({ path: join(tmpdir(), 'rk-admin-session-desktop.png'), fullPage: true });
    await run.context.close();
    const mobile = await fixture(browser, { viewport: { width: 390, height: 844 } }), phone = await mobile.page();
    await phone.goto('https://riteshk.work/studio/'); await phone.locator('[data-remember]').waitFor();
    await phone.locator('[data-remember]').click();
    assert.equal(await phone.locator('[data-remember]').getAttribute('aria-checked'), 'true');
    const bounds = await phone.locator('.pass__box').boundingBox();
    assert.ok(bounds.width <= 390 && bounds.x >= 0);
    await phone.screenshot({ path: join(tmpdir(), 'rk-admin-session-phone.png'), fullPage: true });
    await phone.locator('[data-passkey]').click();
    await phone.locator('[data-mob="exit"]').waitFor();
    await phone.locator('[data-mob="exit"]').click();
    await phone.waitForURL('https://riteshk.work/');
    assert.equal(mobile.store.values.get('sessions').length, 0);
    assert.equal((await mobile.context.cookies()).some(cookie => cookie.name === '__Host-rk-admin'), false);
    await mobile.context.close();
  } finally { await browser.close(); }
});

test('Admin sign-out preserves drafts, revokes other tabs and reports offline revocation', { timeout: 90000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const run = await fixture(browser), first = await run.page();
    await login(first, true);
    await first.evaluate(() => window.__RKStudio.addDraftIcon({ name: 'Synthetic retained icon', svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>', keywords: 'session-test' }));
    const draft = await first.evaluate(() => localStorage.getItem('rk:content:draft'));
    const second = await run.page(); await second.goto('https://riteshk.work/studio/'); await second.locator('.adm.is-open').waitFor();
    run.offline(true);
    await first.locator('[data-exit]').click(); await first.locator('[data-exit-save]').click();
    await first.locator('[data-signout-dialog]').waitFor();
    assert.match(await first.locator('[data-signout-dialog]').innerText(), /revocation is pending/);
    await second.waitForFunction(() => !window.__rkAdminAuth.session);
    assert.equal(await first.evaluate(() => window.__rkAdminAuth.session), null);
    assert.equal(await first.evaluate(() => localStorage.getItem('rk:content:draft')), draft);
    assert.equal(await first.evaluate(() => localStorage.getItem('rk:admin:blocked')), '1');
    run.offline(false);
    await first.locator('[data-signout-dialog] [data-retry]').click();
    await first.waitForURL('https://riteshk.work/');
    assert.equal((await run.context.cookies()).some(cookie => cookie.name === '__Host-rk-admin'), false);
    assert.equal(run.store.values.get('sessions').length, 0);
    await run.context.close();
  } finally { await browser.close(); }
});

test('Admin failed draft save stays recoverable and idle lock requires a passkey', { timeout: 90000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const run = await fixture(browser), page = await run.page();
    await login(page, true);
    await page.evaluate(() => {
      window.originalStorageSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key === 'rk:content:draft') throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); return window.originalStorageSet.call(this, key, value); };
    });
    await page.locator('[data-exit]').click(); await page.locator('[data-exit-save]').click();
    await page.locator('[data-signout-dialog]').waitFor();
    assert.match(await page.locator('[data-signout-dialog]').innerText(), /Draft not saved/);
    assert.ok(await page.evaluate(() => !!window.__rkAdminAuth.session));
    await page.locator('[data-signout-dialog] [data-stay]').click();
    const settings = await page.locator('[data-opensettings]').boundingBox();
    await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; window.__rkAdminAuth.lastActivity -= 31 * 60000; });
    await page.mouse.click(settings.x + settings.width / 2, settings.y + settings.height / 2);
    await page.locator('[data-auth-gate]').waitFor();
    assert.equal(await page.locator('.adm').evaluate(element => element.inert), true);
    assert.match(await page.locator('[data-auth-gate]').innerText(), /Session locked/);
    await page.locator('[data-passkey]').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('rk-session-locked'));
    assert.equal(await page.locator('.adm').evaluate(element => element.inert), false);
    const remote = await (await run.sessions.fetch(new Request('https://session.internal/issue', { method: 'POST', body: JSON.stringify({ label: 'Second synthetic browser', remember: true }) }))).json();
    await page.locator('[data-opensettings]').click(); await page.locator('[data-cat="security"]').click();
    await page.locator('[data-act="open-sessions"]').click(); await page.locator('[data-verify]').click();
    await page.locator('.adm__session-row').first().waitFor();
    assert.ok(await page.locator('.adm__session-row').count() >= 1);
    await page.screenshot({ path: join(tmpdir(), 'rk-admin-session-management.png'), fullPage: true });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.adm__session-row').filter({ hasText: 'Second synthetic browser' }).getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.locator('.adm__session-row').filter({ hasText: 'Second synthetic browser' }).waitFor({ state: 'detached' });
    assert.equal(run.store.values.get('sessions').some(session => session.id === remote.sessionId), false);
    const saved = await page.evaluate(() => localStorage.getItem('rk:content:draft'));
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-all]').click();
    await page.waitForURL('https://riteshk.work/');
    assert.equal(run.store.values.get('sessions').length, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:content:draft')), saved);
    await run.context.close();
  } finally { await browser.close(); }
});