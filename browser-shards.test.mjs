import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { browserShards, shardCommands } from './tools/browser-shards.mjs';

test('browser shards retain every release file and partition all deck test registrations exactly once', () => {
  const tasks = Object.values(browserShards).flat();
  const expected = ['ai-ribbon.test.mjs', 'project-recovery.browser.test.mjs', 'slide-studio-deck.test.mjs', 'slide-presenter-readonly.browser.test.mjs', 'release-checks.browser.test.mjs', 'presenter-dj.browser.test.mjs', 'presenter-macos.browser.test.mjs', 'presenter-native.browser.test.mjs', 'presenter-web.browser.test.mjs', 'slide-presenter.browser.test.mjs', 'studio-capture-download.browser.test.mjs'];
  assert.deepEqual([...new Set(tasks.flatMap(task => task.files))].sort(), expected.sort());
  for (const file of expected.filter(file => file !== 'slide-studio-deck.test.mjs')) {
    assert.equal(tasks.filter(task => task.files.includes(file) && !task.pattern).length, 1, file);
  }
  const patterns = tasks.filter(task => task.files.includes('slide-studio-deck.test.mjs')).map(task => new RegExp(task.pattern));
  const source = readFileSync(new URL('./slide-studio-deck.test.mjs', import.meta.url), 'utf8');
  const registrations = [...source.matchAll(/\btest\(\s*(["'])([^\n]+?)\1/g)].map(match => match[2]);
  assert.ok(registrations.length >= 64);
  for (const name of [...registrations, 'Future regression', 'Prepare future regression']) {
    assert.equal(patterns.filter(pattern => pattern.test(name)).length, 1, name);
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
    if (!file.endsWith('.browser.test.mjs')) assert.ok(workflow.includes("! -name '" + file + "'"), file + ' must not run in the browser-free build job');
  }
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