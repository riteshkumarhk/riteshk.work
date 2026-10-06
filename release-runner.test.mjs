import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  inputFingerprint, parseReleaseOptions, runReleaseCommands, selectedCommands,
  testSummary, toolingChangesOnly, toolingScope, validateLocalServer
} from './tools/release-check.mjs';
import { browserShards, shardCommands } from './tools/browser-shards.mjs';

test('preview server admits module bursts and reuses connections with exact uncached JavaScript', () => {
  const output = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import http.client,json,socket,threading
from pathlib import Path
from serve import PreviewHTTPServer,NoCacheHandler
server=PreviewHTTPServer(('127.0.0.1',0),NoCacheHandler)
clients=[]
worker=None
try:
    for _ in range(32):
        clients.append(socket.create_connection(server.server_address,timeout=5))
    worker=threading.Thread(target=server.serve_forever,daemon=True)
    worker.start()
    path='tools/browser-editor-ready.mjs'
    expected=Path(path).read_bytes()
    for client in clients:
        client.sendall(('GET /'+path+' HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n').encode('ascii'))
    for client in clients:
        with client.makefile('rb') as response:
            headers,body=response.read().split(b'\\r\\n\\r\\n',1)
        assert headers.startswith(b'HTTP/1.1 200'),headers
        assert b'content-type: text/javascript' in headers.lower(),headers
        assert b'cache-control: no-store' in headers.lower(),headers
        assert body==expected
    connection=http.client.HTTPConnection(*server.server_address,timeout=5)
    try:
        for index in range(3):
            connection.request('GET','/'+path)
            response=connection.getresponse()
            assert response.status==200
            assert response.version==11
            assert response.read()==expected
            assert connection.sock is not None
            if index==0:
                original=connection.sock
            else:
                assert connection.sock is original
        connection.request('HEAD','/'+path)
        response=connection.getresponse()
        assert response.status==200
        assert int(response.getheader('Content-Length'))==len(expected)
        assert response.read()==b''
        assert connection.sock is original
    finally:
        connection.close()
    print(json.dumps({'connections':len(clients),'exactBodies':True,'reusedConnection':True}))
finally:
    for client in clients:
        client.close()
    if worker is not None:
        server.shutdown()
        worker.join()
    server.server_close()
`], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.deepEqual(JSON.parse(output), { connections: 32, exactBodies: true, reusedConnection: true });
});

test('focused release checks require explicit known coverage and reject empty or ambiguous arguments', () => {
  assert.throws(() => parseReleaseOptions([]), /Select relevant local checks/);
  assert.throws(() => parseReleaseOptions(['--shard', 'missing']), /Unknown browser shard/);
  assert.throws(() => parseReleaseOptions(['--file', '../other.test.mjs']), /registered browser test/);
  assert.throws(() => parseReleaseOptions(['--pattern', 'Journey']), /requires --file/);
  assert.throws(() => parseReleaseOptions(['--file', 'project-recovery.browser.test.mjs', '--pattern', '[']), SyntaxError);
  assert.throws(() => parseReleaseOptions(['--report']), /Missing value/);
  assert.throws(() => parseReleaseOptions(['--tooling', '--report', join(process.cwd(), 'release.json')]), /outside the public repository/);
  assert.throws(() => parseReleaseOptions(['--tooling', '--report', join(process.cwd(), '..receipt.json')]), /outside the public repository/);
  assert.throws(() => parseReleaseOptions(['--skip-ci']), /Unknown release option/);
  assert.throws(() => parseReleaseOptions(['all', '--shard', 'authoring']), /do not accept local selections/);
  assert.throws(() => parseReleaseOptions(['--tooling', '--shard', 'authoring']), /cannot be combined/);
});

test('focused release selection retains all root build and syntax checks plus the requested browser commands', () => {
  const options = parseReleaseOptions(['--file', 'project-recovery.browser.test.mjs', '--pattern', 'Journey',
    '--shard', 'authoring', '--shard', 'authoring']);
  assert.deepEqual(options.shards, ['authoring']);
  const commands = selectedCommands(options);
  assert.equal(commands[0][0], 'Root regressions');
  for (const label of ['Public bundles', 'Slide bundles', 'Resume bundles', 'Syntax: journey.js']) {
    assert.ok(commands.some(([name]) => name === label), label);
  }
  const browser = commands.filter(([label]) => label.startsWith('Browser:'));
  assert.deepEqual(browser.slice(0, -1).map(([, args]) => args), shardCommands('authoring'));
  assert.deepEqual(browser.at(-1)[1], ['--import', './tools/browser-test-guard.mjs', '--test', '--test-concurrency=1',
    '--test-name-pattern=Journey', 'project-recovery.browser.test.mjs']);
});

test('full local diagnostics still include every mandatory browser shard and root mode stays small', () => {
  const all = selectedCommands(parseReleaseOptions(['all']));
  assert.deepEqual(all.filter(([label]) => label.startsWith('Browser:')).map(([, args]) => args),
    Object.keys(browserShards).flatMap(shardCommands));
  assert.equal(selectedCommands(parseReleaseOptions(['root'])).length, 1);
  assert.equal(selectedCommands(parseReleaseOptions(['--tooling'])).some(([label]) => label.startsWith('Browser:')), false);
});

test('pipeline-only mode rejects application content native code unknown files and dependency changes', () => {
  const base = { name: 'test', scripts: { build: 'old' }, devDependencies: { test: '1' } };
  const scripts = { ...base, scripts: { build: 'new' } };
  assert.equal(toolingChangesOnly(['tools/release-check.mjs', 'package.json', '.github/workflows/build-check.yml',
    'browser-shards.test.mjs', 'release-runner.test.mjs', 'js/render.js', '__pycache__/scratch.pyc'], base, scripts), true);
  for (const path of ['src/js/render.js', 'content.json', 'package-lock.json', 'tools/studio-presenter/Program.cs', 'unknown.mjs']) {
    assert.equal(toolingChangesOnly([path], base, base), false, path);
  }
  assert.equal(toolingChangesOnly(['package.json'], base, { ...scripts, devDependencies: { test: '2' } }), false);
});

test('release server validation cannot target live sites or omit required browser checks', () => {
  assert.equal(validateLocalServer('http://127.0.0.1:5510').port, '5510');
  assert.throws(() => validateLocalServer(), /required/);
  assert.throws(() => validateLocalServer('https://riteshk.work'), /local test server/);
  assert.throws(() => validateLocalServer('file:///tmp/site'), /local test server/);
});

test('release timing collects independent browser failures without reruns or success-shaped fallbacks', async () => {
  const commands = [['Root regressions', ['--test', 'root']], ['Public bundles', ['build']],
    ['Browser: first', ['--test', 'first']], ['Browser: second', ['--test', 'second']]];
  const called = [];
  const results = await runReleaseCommands(commands, async args => {
    called.push(args.at(-1));
    return { exitCode: args.at(-1) === 'first' ? 1 : 0, ...(args.includes('--test') ? { summary: { passed: 2 } } : {}) };
  });
  assert.deepEqual(called, ['root', 'build', 'first', 'second']);
  assert.deepEqual(results.map(result => result.exitCode), [0, 0, 1, 0]);
  assert.ok(results.every(result => result.startedAt && result.durationMs >= 0));
  const failedBuild = await runReleaseCommands(commands, async args => ({ exitCode: args.includes('--test') ? 0 : 1, summary: { passed: 1 } }));
  assert.equal(failedBuild.length, 2);
  const launchFailure = await runReleaseCommands(commands, async () => { throw new Error('Cannot start process'); });
  assert.equal(launchFailure.length, 1);
  assert.match(launchFailure[0].error, /Cannot start process/);
});

test('zero-match and skipped-only browser selections fail explicitly while ordinary TODOs do not hide passing tests', async () => {
  for (const output of ['# tests 0\n# pass 0\n# fail 0\n', '# tests 4\n# pass 0\n# skipped 4\n']) {
    const results = await runReleaseCommands([['Browser: selected', ['--test']]],
      async () => ({ exitCode: 0, summary: testSummary(output) }));
    assert.equal(results[0].exitCode, 1);
    assert.match(results[0].error, /No passing tests/);
  }
  assert.deepEqual(testSummary('# tests 100\n# pass 98\n# fail 1\n# skipped 0\n# todo 1\n'),
    { tests: 100, passed: 98, failed: 1, skipped: 0, todo: 1 });
});

test('input receipt detects dirty tracked files new source deletion and settings changes but permits regenerated bundles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-release-inputs-'));
  try {
    execFileSync('git', ['init', '--quiet', directory]);
    mkdirSync(join(directory, 'js'));
    writeFileSync(join(directory, 'source.mjs'), 'export const value = 1;\n');
    writeFileSync(join(directory, 'package.json'), '{}\n');
    writeFileSync(join(directory, 'js', 'bundle.js'), 'first');
    execFileSync('git', ['-C', directory, 'add', '.']);
    const initial = inputFingerprint(directory);
    writeFileSync(join(directory, 'js', 'bundle.js'), 'rebuilt');
    assert.equal(inputFingerprint(directory), initial);
    writeFileSync(join(directory, 'source.mjs'), 'export const value = 2;\n');
    assert.notEqual(inputFingerprint(directory), initial);
    writeFileSync(join(directory, 'source.mjs'), 'export const value = 1;\n');
    assert.equal(inputFingerprint(directory), initial);
    writeFileSync(join(directory, 'new.test.mjs'), 'test');
    assert.notEqual(inputFingerprint(directory), initial);
    rmSync(join(directory, 'new.test.mjs'));
    rmSync(join(directory, 'source.mjs'));
    assert.notEqual(inputFingerprint(directory), initial);
    writeFileSync(join(directory, 'source.mjs'), 'export const value = 1;\n');
    writeFileSync(join(directory, 'package.json'), '{"changed":true}\n');
    assert.notEqual(inputFingerprint(directory), initial);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('pipeline-only scope includes committed unpublished application changes rather than only dirty files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-release-scope-'));
  const git = args => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' });
  try {
    git(['init', '--quiet']);
    writeFileSync(join(directory, 'package.json'), '{}\n');
    writeFileSync(join(directory, 'application.mjs'), 'original');
    git(['add', '.']);
    const commit = () => git(['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    commit();
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(directory, 'application.mjs'), 'unpublished');
    git(['add', '.']);
    commit();
    const scope = toolingScope(directory);
    assert.deepEqual(scope.paths, ['application.mjs']);
    assert.equal(toolingChangesOnly(scope.paths, scope.previousPackage, scope.currentPackage), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
