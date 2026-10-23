import test from 'node:test';
import assert from 'node:assert/strict';
import diagnostics from 'node:diagnostics_channel';
import { Miniflare } from 'miniflare';
import { R2_TEST_WORKER, r2TestBucket } from './tools/r2-test-bucket.mjs';

async function exercise(bucket) {
  const out = [];
  const first = await bucket.put('a/1.json', JSON.stringify({ n: 1 }), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
  out.push(['put-new', !!first, first.size, first.httpMetadata]);
  out.push(['put-duplicate', await bucket.put('a/1.json', 'x', { onlyIf: { etagDoesNotMatch: '*' } })]);
  out.push(['put-stale', await bucket.put('a/1.json', 'x', { onlyIf: { etagMatches: 'stale' } })]);
  const second = await bucket.put('a/1.json', JSON.stringify({ n: 2 }), { onlyIf: { etagMatches: first.etag } });
  out.push(['put-match', !!second, second.etag !== first.etag]);
  await bucket.put('a/2.bin', new Uint8Array([1, 2, 3])); await bucket.put('b/3', 'three');
  const object = await bucket.get('a/1.json');
  out.push(['get', object.key, object.size, object.etag === second.etag, object.bodyUsed, await object.json(), object.bodyUsed]);
  out.push(['reread', await object.text().then(() => 'read', () => 'rejected')]);
  out.push(['bytes', [...new Uint8Array(await (await bucket.get('a/2.bin')).arrayBuffer())]]);
  const streamed = await bucket.get('b/3');
  out.push(['stream', await new Response(streamed.body).text()]);
  out.push(['missing', await bucket.get('missing'), await bucket.head('missing')]);
  const head = await bucket.head('b/3');
  out.push(['head', head.size, 'body' in head, head.uploaded instanceof Date, head.etag === streamed.etag, (await bucket.head('a/1.json')).httpMetadata]);
  const listed = await bucket.list({ prefix: 'a/' });
  out.push(['list', listed.objects.map(item => [item.key, item.size, item.uploaded instanceof Date]), listed.truncated]);
  const page = await bucket.list({ prefix: 'a/', limit: 1 }), rest = await bucket.list({ prefix: 'a/', limit: 1, cursor: page.cursor });
  out.push(['page', page.truncated, page.objects[0].key, rest.objects[0].key, rest.truncated]);
  const conditional = await bucket.get('a/1.json', { onlyIf: { etagMatches: 'stale' } });
  out.push(['get-precondition', !!conditional, 'body' in conditional]);
  await bucket.delete(['a/1.json', 'a/2.bin']); await bucket.delete('missing');
  out.push(['deleted', (await bucket.list()).objects.map(item => item.key)]);
  const empty = await bucket.put('empty', '');
  out.push(['empty', empty.size, await (await bucket.get('empty')).text()]);
  return out;
}

test('Test R2 adapter matches Miniflare R2 semantics', async () => {
  const runtime = new Miniflare({ modules: true, script: R2_TEST_WORKER, r2Buckets: ['NATIVE', 'ADAPTER'] });
  try {
    const adapter = r2TestBucket(runtime, 'ADAPTER');
    assert.deepEqual(await exercise(adapter), await exercise(await runtime.getR2Bucket('NATIVE')));

    await adapter.put('typed', 'x', { httpMetadata: { contentType: 'text/plain', cacheControl: 'no-store' } });
    const headers = new Headers();
    (await adapter.head('typed')).writeHttpMetadata(headers);
    assert.deepEqual([...headers], [['cache-control', 'no-store'], ['content-type', 'text/plain']]);
    await assert.rejects(adapter.put('dated', 'x', { onlyIf: { uploadedBefore: new Date() } }), /only supports JSON R2 options/);
    await assert.rejects(r2TestBucket(runtime, 'UNKNOWN').head('x'), /Unknown test bucket/);

    // dispatchFetch opens one TCP connection per request and exhausts Windows ephemeral ports.
    const pooled = r2TestBucket({ ready: runtime.ready, dispatchFetch() { throw new Error('dispatchFetch must not be used'); } }, 'ADAPTER');
    assert.equal(await (await pooled.get('typed')).text(), 'x');
    let sockets = 0;
    const count = () => sockets++;
    diagnostics.subscribe('net.client.socket', count);
    try { for (let index = 0; index < 20; index++) await (await pooled.get('typed')).text(); }
    finally { diagnostics.unsubscribe('net.client.socket', count); }
    assert.ok(sockets <= 1, 'R2 test operations must reuse a kept-alive connection, opened ' + sockets);
  } finally { await runtime.dispose(); }
});
