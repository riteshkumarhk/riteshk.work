import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const deck = 'slide-studio-deck.test.mjs';
const authoring = '(?:Prepare |Resume canvas |AI |Draft entire deck |fixed cover |empty hosted deck |linked cover )';
const recovery = 'project-recovery.browser.test.mjs';
const journey = 'Journey';
export const browserShards = {
  authoring: [{ files: [deck], pattern: '^' + authoring }],
  sections: [{ files: [deck], skipPattern: '^' + authoring }],
  'resume-workspace': [{ files: ['resume-workspace.test.mjs', 'resume-assessment-ui.test.mjs', 'resume-pdf-structure.test.mjs', 'resume-assessment-studio-bridge.test.mjs', 'resume-baseline-accounting.test.mjs'] }],
  journey: [{ files: [recovery], pattern: journey }],
  recovery: [{ files: [
    'admin-session.browser.test.mjs',
    'ai-ribbon.test.mjs',
    'ai-appearance.browser.test.mjs',
    'release-checks.browser.test.mjs'
  ] }, { files: [recovery], skipPattern: journey }],
  presenters: [{ files: [
    'slide-presenter-readonly.browser.test.mjs', 'presenter-dj.browser.test.mjs',
    'presenter-macos.browser.test.mjs', 'presenter-native.browser.test.mjs',
    'slide-presenter.browser.test.mjs',
    'studio-capture-download.browser.test.mjs'
  ] }, { files: ['presenter-web.browser.test.mjs'] }]
};

export function shardCommands(shard) {
  if (!Object.hasOwn(browserShards, shard)) throw new Error('Unknown browser shard: ' + shard);
  return browserShards[shard].map(({ files, pattern, skipPattern }) => [
    '--import', './tools/browser-test-guard.mjs', '--test', '--test-concurrency=1',
    ...(pattern ? ['--test-name-pattern=' + pattern] : []),
    ...(skipPattern ? ['--test-skip-pattern=' + skipPattern] : []), ...files
  ]);
}

export function testSummary(output) {
  const count = key => Number([...output.matchAll(new RegExp('^# ' + key + ' (\\d+)\\s*$', 'gm'))].at(-1)?.[1] || 0);
  // Node can count an empty file wrapper as a passing test after a name filter matches nothing.
  const emptyFiles = [...output.matchAll(/^1\.\.0\s*$/gm)].length;
  return {
    tests: Math.max(0, count('tests') - emptyFiles), passed: Math.max(0, count('pass') - emptyFiles),
    failed: count('fail'), skipped: count('skipped'), todo: count('todo')
  };
}

function runBrowserTask(executable, args) {
  return new Promise(resolveResult => {
    const child = spawn(executable, ['--test-reporter=tap', ...args], { stdio: ['inherit', 'pipe', 'inherit'] });
    let tail = '';
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      tail = (tail + chunk.toString()).slice(-65536);
    });
    child.on('error', error => resolveResult({ error }));
    child.on('close', (status, signal) => {
      resolveResult({ status, signal, summary: testSummary(tail) });
    });
  });
}

export async function runShard(shard, { run = runBrowserTask, now = () => performance.now(), onTask = () => {} } = {}) {
  const commands = shardCommands(shard);
  const started = now();
  const tasks = [];
  for (const [index, args] of commands.entries()) {
    const start = now();
    let result;
    try {
      result = await run(process.execPath, args);
    } catch (error) {
      result = { error };
    }
    const empty = result.status === 0 && !result.summary?.passed;
    const task = {
      shard, index, ...browserShards[shard][index],
      durationMs: Math.max(0, now() - start),
      status: result.error || result.signal || empty ? 1 : (result.status ?? 1),
      signal: result.signal || null,
      error: result.error ? String(result.error.message || result.error) : empty ? 'No passing tests executed; empty/skipped-only selections are not validation.' : null,
      summary: result.summary || null
    };
    onTask(task);
    tasks.push(task);
  }
  return {
    schemaVersion: 1, shard, status: tasks.some(task => task.status !== 0) ? 1 : 0,
    durationMs: Math.max(0, now() - started), tasks
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.SLIDE_LAB_URL) throw new Error('SLIDE_LAB_URL is required; browser coverage must not silently skip');
  const report = await runShard(process.argv[2], {
    onTask: task => console.log('[browser-task] ' + JSON.stringify(task))
  });
  if (process.env.BROWSER_SHARD_REPORT) writeFileSync(process.env.BROWSER_SHARD_REPORT, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status;
}