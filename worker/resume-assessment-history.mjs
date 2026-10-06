import { canonicalHistory, historyHash, validateAssessmentHistory } from '../src/js/resume-assessment-history.mjs';
import { captureAssessmentInput } from '../src/js/resume-assessment-input.mjs';
import { awaitAssessment, validateEvaluatedAssessment } from '../src/js/resume-assessment-evaluator.mjs';

const ROOT = 'assessment-history/';
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const id = value => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value || '')) throw fault('Invalid history identity.'); return value; };
const digest = value => { if (!/^[a-f0-9]{64}$/.test(value || '')) throw fault('Invalid artifact hash.'); return value; };
const same = (a, b) => canonicalHistory(a) === canonicalHistory(b);
const types = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
async function boundedBytes(request, maximum) {
  const reader = request.body?.getReader();
  if (!reader) throw fault('A nonempty history body is required.');
  const chunks = []; let length = 0, complete = false;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  try {
    for (;;) {
      const { done, value } = await awaitAssessment(reader.read(), signal);
      if (done) { complete = true; break; }
      length += value.length;
      if (length > maximum) throw fault('Private history input exceeds its size limit; nothing was truncated.', 413);
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw fault('Private history upload was cancelled or timed out before storage.', 408);
    throw error;
  } finally {
    if (!complete) reader.cancel().catch(() => console.error('Private history body cancellation failed.'));
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export function createAssessmentHistoryStore(bucket) {
  if (!bucket) throw fault('Private assessment storage is unavailable.', 503);
  const artifactKey = hash => ROOT + 'artifacts/' + digest(hash);
  const recordKey = value => ROOT + 'records/' + id(value) + '.json';
  async function artifact(hash) {
    const object = await bucket.get(artifactKey(hash));
    if (!object) throw fault('The immutable assessment artifact is missing.', 404);
    if (object.size > 20 * 1024 * 1024) throw fault('Stored assessment artifact exceeds its size limit.', 409);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024 || await historyHash(bytes) !== hash) throw fault('Stored assessment artifact failed its content hash.', 409);
    if (!types.includes(object.httpMetadata?.contentType)) throw fault('Stored artifact media type is invalid.', 409);
    return { bytes, mediaType: object.httpMetadata?.contentType };
  }
  async function raw(value) {
    const object = await bucket.get(recordKey(value));
    if (!object) throw fault('Private assessment history was not found.', 404);
    if (object.size > 4 * 1024 * 1024 || !object.etag) throw fault('Invalid stored history object.', 503);
    const saved = await object.json();
    if (saved.record?.id !== value || saved.version !== 1 || Object.keys(saved).length !== 4 ||
        !Number.isSafeInteger(saved.savedAt) || saved.savedAt < 0 ||
        !['server-receipted-not-independent-truth', 'owner-imported-not-server-attested'].includes(saved.receiptStatus)) throw fault('Stored history identity or receipt metadata changed.', 409);
    return { ...saved, etag: object.etag };
  }
  async function baseline(value) {
    if (!value) return null;
    const saved = await raw(value), source = await artifact(saved.record.artifactSha256);
    const snapshot = await captureAssessmentInput({ ...saved.record.input, bytes: source.bytes });
    if (snapshot.fingerprint !== saved.record.snapshotFingerprint) throw fault('Stored baseline input changed.', 409);
    return { snapshot, result: await validateEvaluatedAssessment(saved.record.result, snapshot) };
  }
  async function verifyReceipts(record) {
    const object = await bucket.get('system/resume-assessment-budget-v1.json'), ledger = object && await object.json();
    let verified = 0, total = 0;
    for (const value of [record.result, ...record.revisions]) {
      const { status, ...plan } = value.reservations[0];
      const actual = ledger?.reservations?.find(item => item.plan?.id === plan.id);
      if (actual && !same(actual.plan, plan)) throw fault('Stored server reservation differs from the submitted history.', 409);
      for (const [index, entry] of value.execution.entries()) {
        total++;
        const attempt = actual?.attempts?.find(item => item.stage === entry.stage);
        if (!attempt?.binding) continue;
        const response = index === 0 ? value.draft : value.challenge;
        if (attempt.status !== 'received' || attempt.binding.request !== entry.requestSha256 || attempt.binding.response !== await historyHash(response) ||
            attempt.requestId !== entry.requestId || !same(attempt.usage, entry.usage) ||
            attempt.responseContract !== entry.responseContract ||
            (actual.requestPolicy ?? null) !== (entry.requestPolicy ?? null)) throw fault('Assessment history does not match the server request/output receipt.', 409);
        verified++;
      }
    }
    return verified === total ? 'server-receipted-not-independent-truth' : 'owner-imported-not-server-attested';
  }
  return {
    artifact,
    async putArtifact(hash, bytes, mediaType) {
      digest(hash);
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 20 * 1024 * 1024 || !types.includes(mediaType) || await historyHash(bytes) !== hash) throw fault('Artifact bytes, type or content hash do not match.');
      const saved = await bucket.put(artifactKey(hash), bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: mediaType, cacheControl: 'no-store' } });
      if (!saved) {
        const existing = await artifact(hash);
        if (existing.mediaType !== mediaType) throw fault('This artifact already has a different recorded type.', 409);
      }
      return { sha256: hash, bytes: bytes.length, mediaType };
    },
    async get(value) {
      const saved = await raw(value), source = await artifact(saved.record.artifactSha256);
      const before = await baseline(saved.record.baselineId);
      try { await validateAssessmentHistory(saved.record, source.bytes, before); }
      catch (error) { throw fault(error.message, 409); }
      const receiptStatus = await verifyReceipts(saved.record);
      if (receiptStatus !== saved.receiptStatus) throw fault('Server execution provenance changed; inspect the stored record.', 409);
      return saved;
    },
    async list(cursor = undefined) {
      if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2000)) throw fault('Invalid history cursor.');
      const page = await bucket.list({ prefix: ROOT + 'records/', limit: 20, cursor, include: ['customMetadata'] });
      return { items: page.objects.map(item => ({ id: item.key.slice((ROOT + 'records/').length, -5), ...item.customMetadata })),
        cursor: page.truncated ? page.cursor : null };
    },
    async save(record, expected) {
      record = structuredClone(record);
      id(record.id);
      if (typeof expected !== 'string' || !expected || expected.length > 200) throw fault('An explicit history revision or first-create precondition is required.', 428);
      const source = await artifact(record.artifactSha256);
      if (source.mediaType !== record.input?.mediaType) throw fault('Stored artifact type differs from captured input.');
      const before = await baseline(record.baselineId);
      try { await validateAssessmentHistory(record, source.bytes, before); }
      catch (error) { throw fault(error.message); }
      const receiptStatus = await verifyReceipts(record);
      const old = await bucket.get(recordKey(record.id));
      if (old) {
        const previous = await old.json();
        if (same(previous.record, record) && previous.receiptStatus === receiptStatus) return { ...previous, etag: old.etag };
        if (expected !== old.etag) throw fault('Private history changed on another device. Reload it; no record was replaced.', 409);
        const { revisions: priorRevisions, failures: priorFailures, ...fixed } = previous.record;
        const { revisions, failures, ...next } = record;
        if (!same(fixed, next) || priorRevisions.some(item => !revisions.some(next => next.id === item.id && same(item, next))) ||
            priorFailures.some(item => !failures.some(next => same(item, next)))) throw fault('History inputs/results and prior receipts are immutable.', 409);
      } else if (expected !== '*') throw fault('The expected private history revision is missing.', 409);
      const saved = { version: 1, record, receiptStatus, savedAt: Date.now() }, body = JSON.stringify(saved);
      if (new TextEncoder().encode(body).length > 4 * 1024 * 1024) throw fault('Private assessment history is full. No receipts were removed.', 413);
      const result = await bucket.put(recordKey(record.id), body, { onlyIf: old ? { etagMatches: expected } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
        customMetadata: { label: record.label, createdAt: String(record.result.report.createdAt), artifactSha256: record.artifactSha256, receiptStatus } });
      if (!result?.etag) throw fault('Private history changed or its save was not acknowledged. Reload before retrying.', 409);
      return { ...saved, etag: result.etag };
    }
  };
}
export async function assessmentHistoryRoute(request, env, headers) {
  try {
    if (env.RESUME_ASSESSMENT_HISTORY !== 'enabled') throw fault('Private assessment history is not enabled. No input was saved.', 503);
    const store = createAssessmentHistoryStore(env.VAULT), url = new URL(request.url);
    const path = url.pathname.slice('/admin/resume/history/'.length);
    if (path === 'records' && request.method === 'GET') return Response.json(await store.list(url.searchParams.get('cursor') ?? undefined), { headers });
    if (/^artifacts\/[a-f0-9]{64}$/.test(path)) {
      const hash = path.split('/')[1];
      if (request.method === 'GET') {
        const value = await store.artifact(hash);
        return new Response(value.bytes, { headers: { ...headers, 'Content-Type': value.mediaType, 'Content-Disposition': 'attachment' } });
      }
      if (request.method === 'PUT') {
        if (request.headers.get('X-Assessment-Retention') !== 'confirmed') throw fault('Explicit original-file retention consent is required.');
        return Response.json(await store.putArtifact(hash, await boundedBytes(request, 20 * 1024 * 1024), request.headers.get('Content-Type')), { headers });
      }
    }
    if (/^records\/[a-zA-Z0-9_-]{1,80}$/.test(path)) {
      const identity = path.split('/')[1];
      if (request.method === 'GET') return Response.json(await store.get(identity), { headers });
      if (request.method === 'PUT') {
        if (request.headers.get('X-Assessment-Retention') !== 'confirmed') throw fault('Explicit complete-history retention consent is required.');
        let record;
        try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(request, 4 * 1024 * 1024))); }
        catch (error) { if (error.status) throw error; throw fault('Unreadable history JSON.'); }
        if (record?.id !== identity) throw fault('History path and record identity differ.');
        return Response.json(await store.save(record, request.headers.get('If-Match')), { headers });
      }
    }
    throw fault('Unsupported private assessment history route or method.', 405);
  } catch (error) {
    return Response.json({ error: error.message || 'Private assessment history is unavailable.' }, { status: error.status || 503, headers });
  }
}
