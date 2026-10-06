import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { createAssessmentHistoryStore, assessmentHistoryRoute } from './worker/resume-assessment-history.mjs';
import { createAssessmentBudgetStore } from './worker/resume-assessment-budget.mjs';
import { captureAssessmentInput } from './src/js/resume-assessment-input.mjs';
import { createAssessmentPilot } from './src/js/resume-assessment-pilot.mjs';
import { createAssessmentBudgetClient } from './src/js/resume-assessment-budget-client.mjs';
import { createAssessmentHistoryClient } from './src/js/resume-assessment-history-client.mjs';
import { createAssessmentHistory, validateAssessmentHistory, historyHash } from './src/js/resume-assessment-history.mjs';

async function fixture(persistence = {}) {
  const runtimeOptions = { modules: true, script: 'export default {fetch(){return new Response("offline")}}', r2Buckets: ['PRIVATE'], ...persistence };
  const runtime = new Miniflare(runtimeOptions);
  const bucket = await runtime.getR2Bucket('PRIVATE'), store = createAssessmentHistoryStore(bucket);
  const input = { kind: 'upload', mediaType: 'text/plain', bytes: new TextEncoder().encode('Avery\nUsed Python to build reports.'),
    target: { company: 'Example', role: 'Designer', level: 'staff', jd: 'Python' },
    extraction: { text: 'Avery\nUsed Python to build reports.', extractorVersion: 'utf8-text-v1' } };
  const snapshot = await captureAssessmentInput(input);
  const config = { version: 1, provider: 'anthropic', maxCost: 2, checkedAt: Date.now(), models: [
    { id: 'scripted-history-model', pricing: { input: 1, output: 2 }, maxInputTokens: 128000, maxOutputTokens: 12000, contextWindow: 140000, reasoning: false }
  ] };
  const budgetStore = createAssessmentBudgetStore(bucket, config); let calls = 0;
  const invoke = request => {
    calls++; const data = JSON.parse(request.user);
    const reviews = values => values.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted review.', ...(item.evidence ? { evidence: item.evidence } : {}) }));
    const value = request.stage === 'requirements' ? { revision: 1, segments: [{ id: 'jd-0', disposition: 'criteria', reason: 'Scripted criterion.' }],
      requirements: [{ id: 'python', label: 'Python', importance: 'required', condition: { kind: 'atom', id: 'python', segmentId: 'jd-0', quote: 'Python' } }] }
      : request.stage === 'assessment' ? {
        ratings: [{ id: 'python', state: 'mentioned', reason: 'Scripted judgment.', evidence: ['artifact-1'] }],
        communication: ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 2, reason: 'Scripted judgment.', evidence: ['artifact-1'] })),
        semantic: { version: 'source-attribution-v1', excerpts: data.evidence.map(item => ({ id: item.id, kind: 'general', reason: 'Scripted classification.' })), groups: [] }
      } : { ratings: reviews(data.draft.ratings), communication: reviews(data.draft.communication), inventoryIssues: [],
        semantic: { version: 'source-attribution-v1', excerpts: reviews(data.evidence), groups: [], segments: reviews(data.segments) } };
    return { text: JSON.stringify(value), provider: request.provider, model: request.model, requestId: 'scripted-' + calls, usage: null };
  };
  const budget = { id: 'candidate-review', scope: 'server', maxCost: 2, approved: true };
  const authority = await createAssessmentBudgetClient({ budget, request: (action, body) => action === 'approve' ? budgetStore.approve(body) : action === 'reserve' ? budgetStore.reserve(body) : budgetStore.execute(body, invoke) });
  const values = new Map();
  const pilot = await createAssessmentPilot({ snapshot, getCurrent: () => snapshot, provider: config.provider, model: config.models[0].id,
    pricing: { ...config.models[0].pricing, checkedAt: config.checkedAt }, budget, authority,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, locks: { request: async (_, action) => action() } });
  await pilot.inventory({ confirmed: true }); await pilot.approveInventory({ confirmed: true });
  await pilot.approveEvidence({ confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }] });
  const result = await pilot.evaluate({ confirmed: true });
  const record = await createAssessmentHistory({ input, label: 'Fictional original', ...pilot.historyData(result.report.id) });
  return { runtime, runtimeOptions, bucket, store, input, snapshot, record, result, pilot, calls: () => calls };
}

test('Private history retains exact excluded original bytes, complete results and server request/output provenance without another call', async () => {
  const value = await fixture();
  try {
    await value.store.putArtifact(value.record.artifactSha256, value.input.bytes, value.input.mediaType);
    const saved = await value.store.save(value.record, '*');
    assert.equal(saved.receiptStatus, 'server-receipted-not-independent-truth');
    const reopened = await createAssessmentHistoryStore(value.bucket).get(value.record.id);
    assert.deepEqual(reopened.record, value.record); assert.equal(reopened.etag, saved.etag);
    assert.equal(reopened.record.result.promptRevision, 2);
    assert.deepEqual((await value.store.artifact(value.record.artifactSha256)).bytes, value.input.bytes);
    assert.match(reopened.record.input.extraction.text, /Avery/);
    assert.equal(reopened.record.result.selection.excluded[0].reason, 'name');
    assert.deepEqual((await value.store.save(structuredClone(value.record), '*')).etag, saved.etag);
    const page = await value.store.list();
    assert.equal(page.items.length, 1); assert.equal(page.items[0].id, value.record.id); assert.equal(page.cursor, null);
    await value.pilot.restore(value.record.id);
    assert.deepEqual(value.pilot.historyData(value.record.id).inventory, value.record.inventory);
    assert.equal(value.calls(), 3);
  } finally { await value.runtime.dispose(); }
});
test('Private history rejects prompt-revision downgrades without replacing a valid saved record', async () => {
  const value = await fixture();
  try {
    await value.store.putArtifact(value.record.artifactSha256, value.input.bytes, value.input.mediaType);
    const saved = await value.store.save(value.record, '*');
    for (const revision of [undefined, null, 1, 3]) {
      const changed = structuredClone(value.record);
      if (revision === undefined) delete changed.result.promptRevision;
      else changed.result.promptRevision = revision;
      await assert.rejects(value.store.save(changed, saved.etag), /execution receipt does not match|unsupported semantic prompt revision/);
    }
    assert.deepEqual((await value.store.get(value.record.id)).record, value.record);
    assert.equal(value.calls(), 3);
  } finally { await value.runtime.dispose(); }
});
test('Content-addressed artifacts reject wrong hashes/types and historical reconstruction detects changed bytes and extraction', async () => {
  const value = await fixture();
  try {
    const hash = value.record.artifactSha256;
    await assert.rejects(value.store.save(value.record, '*'), /artifact is missing/);
    await assert.rejects(value.store.putArtifact(hash, new TextEncoder().encode('wrong'), 'text/plain'), /hash/);
    await value.store.putArtifact(hash, value.input.bytes, 'text/plain');
    await assert.rejects(value.store.putArtifact(hash, value.input.bytes, 'application/pdf'), /different recorded type/);
    const changed = structuredClone(value.record); changed.input.extraction.text += '\nInvented evidence';
    await assert.rejects(value.store.save(changed, '*'), /changed/);
    await value.store.save(value.record, '*');
    await value.bucket.put('assessment-history/artifacts/' + hash, 'corrupt');
    await assert.rejects(value.store.get(value.record.id), /content hash/);
  } finally { await value.runtime.dispose(); }
});
test('Private original files and paginated history survive an actual isolated R2 runtime restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-private-history-'));
  const value = await fixture({ r2Persist: join(directory, 'r2') }); let runtime = value.runtime;
  try {
    await value.store.putArtifact(value.record.artifactSha256, value.input.bytes, 'text/plain');
    for (let index = 0; index < 21; index++) {
      const record = structuredClone(value.record);
      record.id = record.result.report.id = 'history-page-' + String(index).padStart(3, '0');
      await value.store.save(record, '*');
    }
    await runtime.dispose(); runtime = new Miniflare(value.runtimeOptions);
    const reopened = createAssessmentHistoryStore(await runtime.getR2Bucket('PRIVATE'));
    const first = await reopened.list(), second = await reopened.list(first.cursor);
    assert.equal(first.items.length, 20); assert.equal(second.items.length, 1); assert.equal(second.cursor, null);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 21);
    const saved = await reopened.get(first.items[0].id);
    assert.deepEqual(saved.record.input, value.record.input);
    assert.deepEqual((await reopened.artifact(saved.record.artifactSha256)).bytes, value.input.bytes);
    assert.equal(saved.receiptStatus, 'server-receipted-not-independent-truth');
  } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
test('History rejects fabricated inventory execution and malformed client diagnostics', async () => {
  const value = await fixture();
  try {
    for (const mutate of [
      record => { record.inventory.execution[0].requestSha256 = '0'.repeat(64); },
      record => { record.inventory.reservations[0].amount += 1; },
      record => { record.inventory.approvalRequired = false; },
      record => { record.inventory.reusedFrom = 'nonexistent-baseline'; },
      record => { record.failures.push({ at: 0, snapshotFingerprint: value.snapshot.fingerprint, message: 'Malformed diagnostic', attempt: { status: 'failed' } }); },
    ]) {
      const changed = structuredClone(value.record); mutate(changed);
      await assert.rejects(validateAssessmentHistory(changed, value.input.bytes));
    }
    const controller = new AbortController(), body = new ReadableStream({ start() {} });
    const request = new Request('https://example.test/admin/resume/history/artifacts/' + value.record.artifactSha256,
      { method: 'PUT', body, duplex: 'half', signal: controller.signal, headers: { 'X-Assessment-Retention': 'confirmed', 'Content-Type': 'text/plain' } });
    const response = assessmentHistoryRoute(request, { VAULT: value.bucket, RESUME_ASSESSMENT_HISTORY: 'enabled' }, {});
    controller.abort();
    assert.equal((await response).status, 408);
    assert.equal((await value.bucket.list({ prefix: 'assessment-history/' })).objects.length, 0);
    const unavailable = await assessmentHistoryRoute(new Request('https://example.test/admin/resume/history/records'),
      { RESUME_ASSESSMENT_HISTORY: 'enabled', VAULT: { list: async () => { throw new Error('Synthetic storage unavailable'); } } }, {});
    assert.equal(unavailable.status, 503);
  } finally { await value.runtime.dispose(); }
});
test('A schema-valid forged challenge cannot acquire a server-attested archive', async () => {
  const value = await fixture();
  try {
    await value.store.putArtifact(value.record.artifactSha256, value.input.bytes, 'text/plain');
    const forged = structuredClone(value.record);
    forged.result.challenge.ratings[0].reason = 'Forged reviewer explanation.';
    await validateAssessmentHistory(forged, value.input.bytes);
    await assert.rejects(value.store.save(forged, '*'), /server request\/output receipt/);
    const missingPolicy = structuredClone(value.record);
    missingPolicy.result.execution.forEach(entry => { delete entry.requestPolicy; });
    await validateAssessmentHistory(missingPolicy, value.input.bytes);
    await assert.rejects(value.store.save(missingPolicy, '*'), /server request\/output receipt/);
    assert.equal((await value.store.list()).items.length, 0);
    const ledgerObject = await value.bucket.get('system/resume-assessment-budget-v1.json'), ledger = await ledgerObject.json();
    ledger.reservations.forEach(item => item.attempts.forEach(attempt => { delete attempt.binding; }));
    await value.bucket.put('system/resume-assessment-budget-v1.json', JSON.stringify(ledger));
    assert.equal((await value.store.save(value.record, '*')).receiptStatus, 'owner-imported-not-server-attested');
  } finally { await value.runtime.dispose(); }
});
test('Conditional append-only history rejects stale devices, removal of diagnostics and replacement of the original assessment', async () => {
  const value = await fixture();
  try {
    await value.store.putArtifact(value.record.artifactSha256, value.input.bytes, 'text/plain');
    const initial = await value.store.save(value.record, '*');
    const first = structuredClone(value.record), second = structuredClone(value.record);
    first.failures.push({ at: Date.now(), snapshotFingerprint: value.snapshot.fingerprint, message: 'Client-reported cancellation.', attempt: { status: 'cancelled', execution: [], reservations: [] } });
    second.failures.push({ at: Date.now(), snapshotFingerprint: value.snapshot.fingerprint, message: 'Another client-reported failure.', attempt: { status: 'failed', execution: [], reservations: [] } });
    const results = await Promise.allSettled([value.store.save(first, initial.etag), createAssessmentHistoryStore(value.bucket).save(second, initial.etag)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    const current = await value.store.get(value.record.id);
    assert.equal(current.record.failures.length, 1);
    await assert.rejects(value.store.save(value.record, current.etag), /immutable/);
    const changed = structuredClone(current.record); changed.label = 'Replace historical identity';
    await assert.rejects(value.store.save(changed, current.etag), /immutable/);
    assert.deepEqual((await value.store.get(value.record.id)).record.result, value.result);
  } finally { await value.runtime.dispose(); }
});
test('History requires explicit retention and remains readable independently of spending-policy expiry', async () => {
  const value = await fixture();
  try {
    const env = { VAULT: value.bucket, RESUME_ASSESSMENT_HISTORY: 'enabled' };
    const call = (path, options = {}) => assessmentHistoryRoute(new Request('https://example.test/admin/resume/history/' + path, options), env, { 'Cache-Control': 'no-store' });
    const path = 'artifacts/' + value.record.artifactSha256;
    assert.equal((await call(path, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: value.input.bytes })).status, 400);
    assert.equal((await value.bucket.list({ prefix: 'assessment-history/' })).objects.length, 0);
    env.RESUME_ASSESSMENT_HISTORY = 'disabled';
    assert.equal((await call('records')).status, 503);
    env.RESUME_ASSESSMENT_HISTORY = 'enabled';
    const client = createAssessmentHistoryClient(async (path, options = {}) => {
      const { binary, ...request } = options, response = await call(path, request);
      if (!response.ok) throw new Error((await response.json()).error);
      return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
    });
    await assert.rejects(client.save({ input: value.input, result: value.result, label: 'Fictional original' }), /consent/);
    const saved = await client.save({ input: value.input, result: value.result, label: 'Fictional original', confirmed: true });
    const restored = await client.read(saved.record.id);
    assert.equal(restored.input.bytes.length, value.input.bytes.length); assert.deepEqual(restored.record.result, value.result);
    const malformed = { ...saved.record, label: '' };
    assert.equal((await call('records/' + saved.record.id, { method: 'PUT', headers: { 'Content-Type': 'application/json',
      'X-Assessment-Retention': 'confirmed', 'If-Match': saved.etag }, body: JSON.stringify(malformed) })).status, 400);
    assert.equal((await call('records/' + saved.record.id, { method: 'DELETE' })).status, 405);
    assert.equal(value.calls(), 3);
  } finally { await value.runtime.dispose(); }
});
test('Interrupted metadata saving reports retained originals and safely retries without another provider call', async () => {
  const value = await fixture();
  try {
    let rejectRecord = true;
    const client = createAssessmentHistoryClient(async (path, options) => {
      if (path.startsWith('artifacts/')) return value.store.putArtifact(path.split('/')[1], options.body, options.headers['Content-Type']);
      if (rejectRecord) throw new Error('Synthetic metadata outage');
      return value.store.save(JSON.parse(options.body), options.headers['If-Match']);
    });
    const data = { confirmed: true, input: value.input, result: value.result, label: 'Fictional original' };
    await assert.rejects(client.save(data), /original file may already be retained/);
    assert.deepEqual((await value.store.artifact(await historyHash(value.input.bytes))).bytes, value.input.bytes);
    assert.equal((await value.store.list()).items.length, 0);
    rejectRecord = false; await client.save(data);
    assert.equal((await value.store.list()).items.length, 1); assert.equal(value.calls(), 3);
  } finally { await value.runtime.dispose(); }
});
