import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserShards, shardCommands } from './tools/browser-shards.mjs';
import { rootTestFiles, releaseCommands, validateLocalServer } from './tools/release-check.mjs';

test('browser shards retain every release file and partition all deck test registrations exactly once', () => {
  const tasks = Object.values(browserShards).flat();
  const expected = ['admin-session.browser.test.mjs', 'resume-workspace.test.mjs', 'ai-ribbon.test.mjs', 'ai-appearance.browser.test.mjs', 'project-recovery.browser.test.mjs', 'slide-studio-deck.test.mjs', 'slide-presenter-readonly.browser.test.mjs', 'release-checks.browser.test.mjs', 'presenter-dj.browser.test.mjs', 'presenter-macos.browser.test.mjs', 'presenter-native.browser.test.mjs', 'presenter-web.browser.test.mjs', 'slide-presenter.browser.test.mjs', 'studio-capture-download.browser.test.mjs'];
  assert.deepEqual([...new Set(tasks.flatMap(task => task.files))].sort(), expected.sort());
  for (const file of expected.filter(file => file !== 'slide-studio-deck.test.mjs')) {
    assert.equal(tasks.filter(task => task.files.includes(file) && !task.pattern).length, 1, file);
  }
  const patterns = tasks.filter(task => task.files.includes('slide-studio-deck.test.mjs')).map(task => name => task.pattern ? new RegExp(task.pattern).test(name) : !new RegExp(task.skipPattern).test(name));
  const source = readFileSync(new URL('./slide-studio-deck.test.mjs', import.meta.url), 'utf8');
  const registrations = [...source.matchAll(/\btest\(\s*(["'])([^\n]+?)\1/g)].map(match => match[2]);
  assert.ok(registrations.length >= 64);
  for (const name of [...registrations, 'Future regression', 'Prepare future regression']) {
    assert.equal(patterns.filter(pattern => pattern(name)).length, 1, name);
  }
  for (const shard of Object.keys(browserShards)) for (const command of shardCommands(shard)) {
    assert.ok(command.includes('./tools/browser-test-guard.mjs'));
    assert.ok(command.includes('--test-concurrency=1'));
  }
  assert.throws(() => shardCommands('missing'), /Unknown/);
  const workflow = readFileSync(new URL('./.github/workflows/build-check.yml', import.meta.url), 'utf8');
  for (const file of readdirSync(new URL('.', import.meta.url)).filter(file => /\.test\.(?:mjs|cjs)$/.test(file))) {
    if (!/\b(?:chromium|firefox|webkit|puppeteer)\.launch\s*\(/.test(readFileSync(new URL(file, import.meta.url), 'utf8'))) continue;
    assert.ok(expected.includes(file), file + ' needs a browser-equipped shard');
    assert.ok(!rootTestFiles().includes(file), file + ' must not run in the browser-free build job');
  }
  assert.match(workflow, /run: npm run test:root/);
});

test('local release preflight includes every CI gate and rejects missing or live browser servers', () => {
  const commands = releaseCommands();
  const roots = readdirSync(new URL('.', import.meta.url)).filter(file => /\.test\.(?:mjs|cjs)$/.test(file) && !file.endsWith('.browser.test.mjs') && !['slide-studio-deck.test.mjs', 'ai-ribbon.test.mjs', 'resume-workspace.test.mjs'].includes(file)).sort();
  assert.deepEqual(rootTestFiles(), roots);
  assert.deepEqual(commands[0][1], ['--test', '--test-concurrency=1', ...roots]);
  const scripts = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).scripts;
  assert.equal(scripts['test:root'], 'node tools/release-check.mjs root');
  assert.equal(scripts['check:release'], 'node tools/release-check.mjs');
  assert.deepEqual(commands.slice(1, 4).map(([, args]) => 'node ' + args.join(' ')), [scripts.build, scripts['build:slide-lab'], scripts['build:resume']]);
  assert.deepEqual(commands.filter(([label]) => label.startsWith('Browser:')).map(([, args]) => args), Object.keys(browserShards).flatMap(shardCommands));
  const bundles = readdirSync(new URL('./js/', import.meta.url)).filter(name => name.endsWith('.js')).sort();
  assert.deepEqual(commands.filter(([label]) => label.startsWith('Syntax:')).map(([, args]) => args), bundles.map(name => ['--check', 'js/' + name]));
  assert.throws(() => validateLocalServer(), /required/);
  assert.throws(() => validateLocalServer('https://riteshk.work'), /local test server/);
  assert.throws(() => validateLocalServer('file:///tmp/site'), /local test server/);
  assert.equal(validateLocalServer('http://127.0.0.1:5510').port, '5510');
});

test('Node executes complementary shards once without a parent-file pattern matching every child', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-shard-'));
  try {
    const file = join(directory, 'fixture.test.mjs');
    writeFileSync(file, "import test from 'node:test';\n" + ['Prepare synthetic', 'AI synthetic', 'Sections synthetic', 'Future synthetic'].map(name => 'test(' + JSON.stringify(name) + ', () => {});').join('\n'));
    const observed = [];
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    for (const shard of ['authoring', 'sections']) {
      const args = shardCommands(shard)[0].map(value => value === 'slide-studio-deck.test.mjs' ? file : value);
      const result = spawnSync(process.execPath, ['--test-reporter=tap', ...args], { encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /# tests 2\b/);
      observed.push(...[...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]));
    }
    assert.equal(observed.length, 4);
    assert.equal(new Set(observed).size, 4);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Pages requires the build and every browser shard against the same tested artifact', () => {
  const workflow = readFileSync(new URL('./.github/workflows/build-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /needs: \[verify-build, browser-checks\]/);
  assert.match(workflow, /shard: \[authoring, sections, recovery\]/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /node tools\/browser-shards\.mjs/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /git archive --format=tar HEAD/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
});