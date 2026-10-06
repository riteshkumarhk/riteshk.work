import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startStudioProbeBridge, studioProbeClient, validateStudioProbeBody, STUDIO_ORIGIN, STUDIO_KEY_PLACEHOLDER } from './tools/resume-assessment-studio-bridge.mjs';
import { assessmentRequestParameters } from './src/js/resume-assessment-request-policy.mjs';
import { assessmentResponseSchema, structuredAssessmentPrompt } from './src/js/resume-assessment-output.mjs';

const worker = 'https://rk-ai-proxy.riteshkumarhk.workers.dev/admin/ai/';
const body = () => ({ model: 'claude-sonnet-5-5', max_tokens: 8000,
  ...assessmentRequestParameters('anthropic', 'claude-sonnet-5-5'), stream: false, system: 'Fictional system', messages: [{ role: 'user', content: 'Fictional request' }] });
const structuredBody = () => {
  const request = { responseContract: 'assessment-json-v1', stage: 'requirements', user: JSON.stringify({ segments: [{ id: 'jd-0', text: 'Python' }] }) };
  return { ...body(), system: structuredAssessmentPrompt('Fictional structured system', request.responseContract, request.stage),
    messages: [{ role: 'user', content: request.user }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: assessmentResponseSchema(request) } } };
};
const options = signal => ({ method: 'POST', headers: { 'x-api-key': STUDIO_KEY_PLACEHOLDER }, body: JSON.stringify(body()), signal: signal ?? new AbortController().signal });
const execute = (bridge, signal) => bridge.fetcher('https://api.anthropic.com/v1/messages', options(signal));
const post = (bridge, path, value, overrides = {}) => fetch(bridge.descriptor.url + path, { method: 'POST',
  headers: { Origin: STUDIO_ORIGIN, 'Content-Type': 'application/json', 'X-Probe-Ticket': bridge.descriptor.ticket, ...overrides }, body: JSON.stringify(value) });
function clientFixture(bridge, control = {}) {
  const calls = [];
  const task = studioProbeClient(bridge.descriptor, { origin: STUDIO_ORIGIN, getSession: () => control.token ?? 'fictional-owner-session',
    signal: control.signal, fetcher: async (url, init) => {
      if (url.startsWith(bridge.descriptor.url + '/')) {
        assert.equal(new Headers(init.headers).has('Authorization'), false);
        assert.equal(JSON.stringify(init).includes('fictional-owner-session'), false);
        return fetch(url, { ...init, headers: { ...init.headers, Origin: STUDIO_ORIGIN } });
      }
      assert.equal(init.headers.Authorization, 'Bearer ' + (control.token ?? 'fictional-owner-session'));
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      if (url === worker + 'keys') return Response.json({ providers: { anthropic: { set: !control.missing } } });
      assert.equal(url, worker + 'anthropic/messages');
      calls.push(JSON.parse(init.body));
      if (control.onCall) return control.onCall(init);
      return Response.json({ scripted: true });
    } });
  task.catch(() => {});
  return { task, calls };
}

test('Studio transport keeps session in page, preserves exact request settings and delivers each job once', async () => {
  const bridge = await startStudioProbeBridge(), client = clientFixture(bridge);
  try {
    await bridge.preflight();
    assert.deepEqual(await (await execute(bridge)).json(), { scripted: true });
    assert.deepEqual(await (await execute(bridge)).json(), { scripted: true });
    assert.deepEqual(client.calls, [body(), body()]);
    await assert.rejects(execute(bridge), /unexpected/);
  } finally { await bridge.close(); }
  assert.deepEqual(await client.task, { transportClosed: true, calls: 2 });
});
test('Approved whole-workflow Studio connection permits exactly nine structured calls while the default remains two', async () => {
  await assert.rejects(startStudioProbeBridge({ maxCalls: 10 }), /unsupported fixed/);
  const bridge = await startStudioProbeBridge({ maxCalls: 9 }), client = clientFixture(bridge);
  try {
    await bridge.preflight();
    const expected = structuredBody();
    for (let index = 0; index < 9; index++) {
      const response = await bridge.fetcher('https://api.anthropic.com/v1/messages', { ...options(), body: JSON.stringify(expected) });
      assert.deepEqual(await response.json(), { scripted: true });
    }
    await assert.rejects(execute(bridge), /unexpected/);
    assert.deepEqual(client.calls, Array.from({ length: 9 }, () => expected));
  } finally { await bridge.close(); }
  assert.deepEqual(await client.task, { transportClosed: true, calls: 9 });
});
test('Studio bridge rejects foreign origins, missing tickets, unsolicited results and duplicate delivery', async () => {
  const bridge = await startStudioProbeBridge();
  try {
    assert.equal((await post(bridge, '/ready', { ready: true }, { Origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await post(bridge, '/ready', { ready: true }, { 'X-Probe-Ticket': 'wrong' })).status, 403);
    assert.equal((await post(bridge, '/next', {})).status, 409);
    assert.equal((await post(bridge, '/ready', { ready: true })).status, 200);
    assert.equal((await post(bridge, '/ready', { ready: true })).status, 409);
    assert.equal((await post(bridge, '/result', { id: 'unsolicited', status: 200, body: '{}' })).status, 409);
    const response = execute(bridge);
    const jobs = await Promise.all([post(bridge, '/next', {}).then(r => r.json()), post(bridge, '/next', {}).then(r => r.json())]);
    assert.equal(jobs.filter(item => item.job).length, 1);
    const job = jobs.find(item => item.job).job;
    const receipt = { id: job.id, status: 200, body: '{"once":true}' };
    assert.equal((await post(bridge, '/result', receipt)).status, 200);
    assert.deepEqual(await (await response).json(), { once: true });
    assert.equal((await post(bridge, '/result', receipt)).status, 409);
  } finally { await bridge.close(); }
});
test('Studio preflight and request-profile failures do not dispatch inference', async () => {
  const controller = new AbortController(), bridge = await startStudioProbeBridge({ signal: controller.signal });
  const client = clientFixture(bridge, { missing: true });
  try {
    await assert.rejects(client.task, /connection is unavailable/);
    await assert.rejects(bridge.preflight(), /connection unavailable/);
    await assert.rejects(execute(bridge), /unconnected/);
    controller.abort(new Error('Fixture ended'));
    await assert.rejects(bridge.preflight(), /Fixture ended/);
    assert.equal(client.calls.length, 0);
    assert.throws(() => validateStudioProbeBody(null), /fixed approved profile/);
    assert.throws(() => validateStudioProbeBody({ ...body(), temperature: 0 }), /fixed approved profile/);
    assert.throws(() => validateStudioProbeBody({ ...body(), model: 'another-model' }), /fixed approved profile/);
  } finally { await bridge.close(); }
});
test('Cancelled delivery cannot be collected or acknowledged later and never retries the provider', async () => {
  const bridge = await startStudioProbeBridge(), controller = new AbortController();
  try {
    await post(bridge, '/ready', { ready: true });
    const pending = execute(bridge, controller.signal);
    const job = (await (await post(bridge, '/next', {})).json()).job;
    controller.abort(new Error('Cancelled fixture'));
    await assert.rejects(pending, /Cancelled fixture/);
    assert.equal((await post(bridge, '/result', { id: job.id, status: 200, body: '{}' })).status, 409);
    assert.equal((await (await post(bridge, '/next', {})).json()).done, true);
    await assert.rejects(execute(bridge), /unexpected/);
  } finally { await bridge.close(); }
});
test('Studio client contains upstream failures and refuses session changes without exporting error details', async () => {
  for (const outcome of ['failure', 'session']) {
    const bridge = await startStudioProbeBridge(), control = {};
    if (outcome === 'failure') control.onCall = async () => { throw new Error('Sensitive upstream detail must stay in the page'); };
    const client = clientFixture(bridge, control);
    try {
      await bridge.preflight();
      if (outcome === 'failure') {
        const response = await execute(bridge);
        assert.equal(response.status, 502); assert.equal(await response.text(), '');
        await assert.rejects(client.task, /outcome failed or is unknown/);
        assert.equal(client.calls.length, 1);
      } else {
        control.token = 'changed-session';
        await assert.rejects(client.task, /expired or changed/);
        assert.equal(client.calls.length, 0);
      }
    } finally { await bridge.close(); }
  }
});
for (const allowed of [false, true]) test('Actual browser Studio loopback permission ' + (allowed ? 'granted forwards through the mocked proxy' : 'denied prevents any provider request'), async () => {
  const bridge = await startStudioProbeBridge();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  let client;
  try {
    const page = await browser.newPage(); let calls = 0;
    page.on('console', message => { if (message.type() === 'error') console.error('Synthetic browser fixture:', message.text()); });
    await page.route('https://riteshk.work/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Fictional Studio</title>' }));
    await page.route(worker + '**', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': STUDIO_ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, anthropic-version',
      } });
      const headers = route.request().headers();
      assert.equal(headers.authorization, 'Bearer fictional-browser-session');
      if (route.request().url().endsWith('/keys')) return route.fulfill({ json: { providers: { anthropic: { set: true } } }, headers: { 'Access-Control-Allow-Origin': STUDIO_ORIGIN } });
      calls++; assert.deepEqual(route.request().postDataJSON(), calls === 1 ? body() : structuredBody());
      return route.fulfill({ json: { browser: true }, headers: { 'Access-Control-Allow-Origin': STUDIO_ORIGIN } });
    });
    await page.goto('https://riteshk.work/studio');
    const protocol = await page.context().newCDPSession(page);
    const { targetInfo } = await protocol.send('Target.getTargetInfo');
    await protocol.send('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: allowed ? 'granted' : 'denied',
      origin: STUDIO_ORIGIN, browserContextId: targetInfo.browserContextId });
    assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'loopback-network' })).state), allowed ? 'granted' : 'denied');
    await page.evaluate(() => { window.__rkAdminAuth = { session: { token: 'fictional-browser-session', exp: Date.now() + 600000 }, locked: false, lastActivity: Date.now() }; });
    client = page.evaluate(async descriptor => { const { default: run } = await import(descriptor.url + '/client.mjs'); return run(descriptor); }, bridge.descriptor);
    client.catch(() => {});
    if (!allowed) {
      await assert.rejects(client, /Failed to fetch dynamically imported module/);
      assert.equal(calls, 0); return;
    }
    await Promise.race([bridge.preflight(), client.then(() => { throw new Error('Client ended before preflight'); })]);
    assert.deepEqual(await (await execute(bridge)).json(), { browser: true });
    assert.deepEqual(await (await bridge.fetcher('https://api.anthropic.com/v1/messages', {
      ...options(), body: JSON.stringify(structuredBody()),
    })).json(), { browser: true });
    await bridge.close();
    assert.deepEqual(await client, { transportClosed: true, calls: 2 }); assert.equal(calls, 2);
  } finally { await bridge.close(); await browser.close(); }
});
