import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserShards, shardCommands, runShard, testSummary } from './tools/browser-shards.mjs';
import { rootTestFiles, releaseCommands, validateLocalServer } from './tools/release-check.mjs';

test('browser shards retain every release file and partition all test registrations exactly once', () => {
  const tasks = Object.values(browserShards).flat();
  const expected = ['admin-session.browser.test.mjs', 'resume-workspace.test.mjs', 'ai-ribbon.test.mjs', 'ai-appearance.browser.test.mjs', 'project-recovery.browser.test.mjs', 'slide-studio-deck.test.mjs', 'slide-presenter-readonly.browser.test.mjs', 'release-checks.browser.test.mjs', 'presenter-dj.browser.test.mjs', 'presenter-macos.browser.test.mjs', 'presenter-native.browser.test.mjs', 'presenter-web.browser.test.mjs', 'slide-presenter.browser.test.mjs', 'studio-capture-download.browser.test.mjs'];
  assert.deepEqual([...new Set(tasks.flatMap(task => task.files))].sort(), expected.sort());
  const splitFiles = ['slide-studio-deck.test.mjs', 'project-recovery.browser.test.mjs'];
  for (const file of expected) {
    const selections = tasks.filter(task => task.files.includes(file));
    assert.equal(selections.length, splitFiles.includes(file) ? 2 : 1, file);
    if (splitFiles.includes(file)) {
      assert.equal(selections[0].pattern, selections[1].skipPattern, file + ' must have exact complements');
      assert.ok(selections[0].pattern);
      assert.equal(selections[0].skipPattern, undefined);
      assert.equal(selections[1].pattern, undefined);
      assert.ok(selections.every(task => task.files.length === 1), file + ' filters must not affect other files');
    } else {
      assert.equal(selections[0].pattern, undefined, file);
      assert.equal(selections[0].skipPattern, undefined, file);
    }
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const registrations = [...source.matchAll(/^\s*test\(\s*(["'])([^\n]+?)\1/gm)].map(match => match[2]);
    assert.ok(registrations.length > 0, file);
    assert.equal(registrations.length, [...source.matchAll(/^\s*test\(/gm)].length, file + ' registration parser must cover every test');
    if (file === splitFiles[0]) assert.ok(registrations.length >= 64);
    if (file === splitFiles[1]) assert.ok(registrations.length >= 40);
    const selected = (task, name) => (!task.pattern || new RegExp(task.pattern).test(name)) && (!task.skipPattern || !new RegExp(task.skipPattern).test(name));
    for (const name of [...registrations, 'Future regression', 'Prepare future regression', 'Journey future regression', 'Studio and Journey future regression']) {
      assert.equal(selections.filter(task => selected(task, name)).length, 1, file + ': ' + name);
    }
    for (const selection of selections) assert.ok(registrations.some(name => selected(selection, name)), file + ' must not create an empty partition');
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
  const directory = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.browser-shards-fixture-'));
  try {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    for (const [name, shards, names] of [
      ['slide-studio-deck.test.mjs', ['authoring', 'sections'], ['Prepare synthetic', 'AI synthetic', 'Sections synthetic', 'Future synthetic']],
      ['project-recovery.browser.test.mjs', ['journey', 'recovery'], ['Journey synthetic', 'Studio and Journey synthetic', 'Recovery synthetic', 'Future synthetic']]
    ]) {
      const file = join(directory, name);
      writeFileSync(file, "import test from 'node:test';\n" + names.map(name => 'test(' + JSON.stringify(name) + ', () => {});').join('\n'));
      const observed = [];
      for (const shard of shards) {
        const args = shardCommands(shard).find(args => args.includes(name)).map(value => value === name ? file : value);
        const result = spawnSync(process.execPath, ['--test-reporter=tap', ...args], { encoding: 'utf8', env });
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.match(result.stdout, /# tests 2\b/);
        observed.push(...[...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match => match[1]));
      }
      assert.deepEqual(observed.sort(), names.sort(), name);
      assert.equal(new Set(observed).size, 4);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('shard runner collects every independent task failure and machine-readable timings without retries', async () => {
  for (const results of [
    [{ status: 2 }, { status: 3 }],
    [{ error: new Error('spawn failed') }, { status: 0 }],
    [{ status: null, signal: 'SIGTERM' }, { status: 0 }],
    [new Error('spawn threw'), { status: 0 }],
    [{ status: null }, { status: 0 }],
    [{ status: 0 }, { status: 0 }]
  ]) {
    const calls = [], events = [];
    let time = 0;
    const report = await runShard('presenters', {
      now: () => time += 10,
      onTask: task => events.push(task),
      run: (executable, args) => {
        calls.push(args);
        assert.equal(executable, process.execPath);
        const result = results[calls.length - 1];
        if (result instanceof Error) throw result;
        return { ...result, summary: { tests: 1, passed: result.status === 0 ? 1 : 0, failed: result.status === 0 ? 0 : 1, skipped: 0, todo: 0 } };
      }
    });
    assert.deepEqual(calls, shardCommands('presenters'));
    assert.deepEqual(events, report.tasks);
    assert.equal(report.status, results.every(result => result.status === 0) ? 0 : 1);
    assert.deepEqual(report.tasks.map(task => task.status), results.map(result => result.status ?? 1));
    assert.deepEqual(report.tasks.map(task => task.durationMs), [10, 10]);
    assert.equal(report.durationMs, 50);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.shard, 'presenters');
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
    for (const [index, task] of report.tasks.entries()) {
      assert.equal(task.index, index);
      assert.deepEqual(task.files, browserShards.presenters[index].files);
      assert.equal(task.error, results[index] instanceof Error ? results[index].message : results[index].error?.message || null);
      assert.equal(task.signal, results[index].signal || null);
    }
  }
  await assert.rejects(runShard('missing', { run: () => assert.fail('must not spawn') }), /Unknown/);
});

test('shard runner rejects empty skipped-only todo-only and missing execution summaries without skipping later tasks', async () => {
  for (const summary of [
    undefined,
    { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
    { tests: 2, passed: 0, failed: 0, skipped: 2, todo: 0 },
    { tests: 2, passed: 0, failed: 0, skipped: 0, todo: 2 }
  ]) {
    let calls = 0;
    const report = await runShard('presenters', { run: async () => {
      calls++;
      return { status: 0, summary };
    } });
    assert.equal(calls, 2);
    assert.equal(report.status, 1);
    assert.ok(report.tasks.every(task => task.status === 1 && /No passing tests executed/.test(task.error)));
  }
});

test('real shard subprocess summaries reject an unmatched selection and still execute the next task', async () => {
  const directory = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.browser-shards-fixture-'));
  const file = join(directory, 'fixture.test.mjs');
  const context = process.env.NODE_TEST_CONTEXT;
  try {
    delete process.env.NODE_TEST_CONTEXT;
    writeFileSync(file, "import test from 'node:test';\ntest('Passing synthetic', () => {});\n");
    browserShards.fixture = [{ files: [file], pattern: '^Missing synthetic$' }, { files: [file] }];
    const report = await runShard('fixture');
    assert.equal(report.status, 1);
    assert.equal(report.tasks[0].status, 1);
    assert.equal(report.tasks[0].summary.passed, 0);
    assert.match(report.tasks[0].error, /No passing tests executed/);
    assert.equal(report.tasks[1].status, 0);
    assert.equal(report.tasks[1].summary.passed, 1);
    const unmatched = spawnSync(process.execPath, [
      '--test-reporter=tap', '--test', '--test-concurrency=1', '--test-name-pattern=^Missing synthetic$', file
    ], { encoding: 'utf8' });
    assert.equal(unmatched.status, 0, unmatched.stderr);
    assert.deepEqual(testSummary(unmatched.stdout), { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
  } finally {
    if (context !== undefined) process.env.NODE_TEST_CONTEXT = context;
    delete browserShards.fixture;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shared TAP summary excludes empty wrappers while retaining real results and final counters', () => {
  assert.deepEqual(testSummary(''), { tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
  const output = '1..0\n# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# todo 0\n' +
    '# tests 6\n# pass 3\n# fail 1\n# skipped 1\n# todo 1\n';
  assert.deepEqual(testSummary(output), { tests: 5, passed: 2, failed: 1, skipped: 1, todo: 1 });
});

test('shard CLI fails before executing tests when the required server is missing or the shard is unknown', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.SLIDE_LAB_URL;
  const missing = spawnSync(process.execPath, ['tools/browser-shards.mjs', 'authoring'], { encoding: 'utf8', env });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /SLIDE_LAB_URL is required/);
  const unknown = spawnSync(process.execPath, ['tools/browser-shards.mjs', 'missing'], { encoding: 'utf8', env: { ...env, SLIDE_LAB_URL: 'http://127.0.0.1:5510' } });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown browser shard/);
});

test('Pages requires the build and every browser shard against the same tested artifact', () => {
  const workflow = readFileSync(new URL('./.github/workflows/build-check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /needs: \[verify-build, browser-checks\]/);
  assert.deepEqual(Object.keys(browserShards), ['authoring', 'sections', 'resume-workspace', 'journey', 'recovery', 'presenters']);
  assert.equal(workflow.match(/shard: \[([^\]]+)\]/)[1], Object.keys(browserShards).join(', '));
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /node tools\/browser-shards\.mjs/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /git archive --format=tar HEAD/);
  assert.match(workflow, /BROWSER_SHARD_REPORT: browser-timings-\$\{\{ matrix\.shard \}\}\.json/);
  assert.match(workflow, /Preserve browser task timings\s+if: always\(\)/);
  assert.match(workflow, /Preserve browser failure evidence\s+if: failure\(\)/);
  assert.match(workflow, /actions\/cache@v4/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
});

test('native web capture belongs only to presenters while authoring retains its deck partition', () => {
  const capture = 'presenter-web.browser.test.mjs';
  assert.deepEqual(Object.entries(browserShards).filter(([, tasks]) => tasks.some(task => task.files.includes(capture))).map(([shard]) => shard), ['presenters']);
  assert.deepEqual(browserShards.authoring.map(task => task.files), [['slide-studio-deck.test.mjs']]);
  assert.deepEqual(browserShards.presenters.at(-1), { files: [capture] });
});