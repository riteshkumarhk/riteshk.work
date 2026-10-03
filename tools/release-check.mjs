import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { browserShards, shardCommands, testSummary } from './browser-shards.mjs';
export { testSummary } from './browser-shards.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const browserFiles = new Set(Object.values(browserShards).flatMap(tasks => tasks.flatMap(task => task.files)));

export function rootTestFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.test\.(?:mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.browser.test.mjs') && !browserFiles.has(entry.name))
    .map(entry => entry.name).sort();
}

export function releaseCommands() {
  return [
    ['Root regressions', ['--test', '--test-concurrency=1', ...rootTestFiles()]],
    ['Public bundles', ['build.mjs']],
    ['Slide bundles', ['slide-lab.build.mjs']],
    ['Resume bundles', ['tools/resume-preview.mjs', '--build']],
    ...readdirSync(new URL('../js/', import.meta.url)).filter(name => name.endsWith('.js')).sort()
      .map(name => ['Syntax: ' + name, ['--check', 'js/' + name]]),
    ...Object.keys(browserShards).flatMap(shard => shardCommands(shard).map(args => ['Browser: ' + shard, args]))
  ];
}

export function validateLocalServer(value) {
  if (!value) throw new Error('SLIDE_LAB_URL is required; release browser checks must not silently skip');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Release checks require a local test server, never a live owner site');
  }
  return url;
}

export function parseReleaseOptions(args) {
  args = [...args];
  const options = { mode: 'local', shards: [], files: [], pattern: null, tooling: false, report: null };
  if (['root', 'all', 'full'].includes(args[0])) options.mode = args.shift() === 'root' ? 'root' : 'all';
  while (args.length) {
    const flag = args.shift();
    if (flag === '--tooling') { options.tooling = true; continue; }
    if (!['--shard', '--file', '--pattern', '--report'].includes(flag)) throw new Error('Unknown release option: ' + flag);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
    if (flag === '--shard') {
      if (!Object.hasOwn(browserShards, value)) throw new Error('Unknown browser shard: ' + value);
      if (!options.shards.includes(value)) options.shards.push(value);
    } else if (flag === '--file') {
      if (!browserFiles.has(value)) throw new Error('Expected a registered browser test file: ' + value);
      if (!options.files.includes(value)) options.files.push(value);
    } else if (flag === '--pattern') { new RegExp(value); options.pattern = value; }
    else {
      options.report = resolve(value);
      const path = relative(root, options.report);
      if (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)) throw new Error('Release reports belong outside the public repository; use a private/session path.');
    }
  }
  const selected = options.shards.length || options.files.length;
  if (options.pattern && !options.files.length) throw new Error('--pattern requires --file');
  if (options.tooling && selected) throw new Error('--tooling cannot be combined with browser selections');
  if (options.mode !== 'local' && (selected || options.tooling || options.pattern)) throw new Error('Full/root checks do not accept local selections');
  if (options.mode === 'local' && !selected && !options.tooling) {
    throw new Error('Select relevant local checks: --shard <' + Object.keys(browserShards).join('|') +
      '> or --file <registered test> [--pattern <regex>]. Pipeline-only changes may use --tooling. Use check:release:full for all local checks.');
  }
  return options;
}

export function selectedCommands(options) {
  const commands = releaseCommands();
  if (options.mode === 'root') return commands.slice(0, 1);
  if (options.mode === 'all') return commands;
  return [
    ...commands.filter(([label]) => !label.startsWith('Browser:')),
    ...options.shards.flatMap(shard => shardCommands(shard).map(args => ['Browser: ' + shard, args])),
    ...(options.files.length ? [['Browser: selected files', [
      '--import', './tools/browser-test-guard.mjs', '--test', '--test-concurrency=1',
      ...(options.pattern ? ['--test-name-pattern=' + options.pattern] : []), ...options.files
    ]]] : [])
  ];
}

const generated = path => /^(js\/|studio\/(?:slide-lab|resume-preview)\/assets\/)/.test(path);
const incidental = path => path.startsWith('__pycache__/');

export function toolingChangesOnly(paths, previousPackage, currentPackage) {
  const allowed = new Set(['tools/release-check.mjs', 'tools/browser-shards.mjs',
    'browser-shards.test.mjs', 'release-runner.test.mjs', '.github/workflows/build-check.yml', 'package.json']);
  if (paths.some(path => !generated(path) && !incidental(path) && !path.endsWith('.md') && !allowed.has(path))) return false;
  if (paths.includes('package.json')) {
    const { scripts: previousScripts, ...previous } = previousPackage;
    const { scripts: currentScripts, ...current } = currentPackage;
    if (!isDeepStrictEqual(previous, current)) return false;
  }
  return true;
}

function git(args, directory = root) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

export function toolingScope(directory = root) {
  const baseRevision = git(['merge-base', 'HEAD', 'origin/main'], directory).trim();
  return {
    baseRevision,
    paths: [...git(['diff', '--name-only', '-z', baseRevision], directory).split('\0'),
      ...git(['ls-files', '--others', '--exclude-standard', '-z'], directory).split('\0')].filter(Boolean),
    previousPackage: JSON.parse(git(['show', baseRevision + ':package.json'], directory)),
    currentPackage: JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  };
}

export function inputFingerprint(directory = root) {
  const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], directory).split('\0').filter(Boolean))]
    .filter(path => !generated(path) && !incidental(path)).sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const full = join(directory, path);
    if (!existsSync(full)) { hash.update(JSON.stringify([path, 'deleted'])); continue; }
    const stat = lstatSync(full);
    const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(full)) : readFileSync(full);
    hash.update(JSON.stringify([path, stat.isSymbolicLink() ? 'link' : 'file', stat.mode & 0o777, bytes.length]));
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function runCommand(args) {
  return new Promise((resolveResult, reject) => {
    const test = args.includes('--test');
    const child = spawn(process.execPath, test ? ['--test-reporter=tap', ...args] : args, {
      cwd: root, env: { ...process.env, NODE_DISABLE_COLORS: '1' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let tail = '';
    const capture = (stream, chunk) => { stream.write(chunk); tail = (tail + chunk.toString()).slice(-65536); };
    child.stdout.on('data', chunk => capture(process.stdout, chunk));
    child.stderr.on('data', chunk => capture(process.stderr, chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolveResult({ exitCode: code ?? 1, signal, ...(test ? { summary: testSummary(tail) } : {}) }));
  });
}

export async function runReleaseCommands(commands, execute = runCommand) {
  const results = [];
  for (const [label, args] of commands) {
    console.log('\n=== ' + label + ' ===');
    const startedAt = new Date().toISOString(), start = performance.now();
    let outcome;
    try { outcome = await execute(args); }
    catch (error) { outcome = { exitCode: 1, error: error.message }; }
    const empty = args.includes('--test') && outcome.exitCode === 0 && !outcome.summary?.passed;
    const result = { label, args, startedAt, durationMs: Math.round(performance.now() - start), ...outcome,
      exitCode: empty ? 1 : outcome.exitCode, ...(empty ? { error: 'No passing tests executed; empty/skipped-only selections are not validation.' } : {}) };
    results.push(result);
    if (result.exitCode !== 0) {
      console.error('Release check failed: ' + label + (result.error ? ': ' + result.error : ''));
      if (!label.startsWith('Browser:')) break;
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseReleaseOptions(process.argv.slice(2));
  const revision = git(['rev-parse', 'HEAD']).trim();
  const reportPath = options.report || join(tmpdir(), 'rk-release-' + Date.now() + '-' + process.pid + '.json');
  const report = { schemaVersion: 1, revision, startedAt: new Date().toISOString(), ...options, report: reportPath,
    status: 'running', ciRequired: true, deploymentVerified: false, closeoutComplete: false, commands: [] };
  try {
    if (options.mode !== 'root') {
      const response = await fetch(new URL('/index.html', validateLocalServer(process.env.SLIDE_LAB_URL)), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(readFileSync(new URL('../index.html', import.meta.url)))) {
        throw new Error('Local server must serve this working tree before release checks run');
      }
      if (options.tooling) {
        const scope = toolingScope();
        report.comparisonRevision = scope.baseRevision;
        if (!toolingChangesOnly(scope.paths, scope.previousPackage, scope.currentPackage)) {
          throw new Error('--tooling is restricted to release infrastructure/docs and package scripts. Select browser coverage for application/dependency changes.');
        }
      }
    }
    report.inputFingerprint = inputFingerprint();
    report.commands = await runReleaseCommands(selectedCommands(options));
    if (git(['rev-parse', 'HEAD']).trim() !== revision || inputFingerprint() !== report.inputFingerprint) {
      throw new Error('Release inputs changed during checks; validate the final integrated tree before pushing.');
    }
    report.status = report.commands.some(result => result.exitCode !== 0) ? 'failed' : 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    console.error(error);
  } finally {
    report.completedAt = new Date().toISOString();
    report.durationMs = Date.parse(report.completedAt) - Date.parse(report.startedAt);
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log('Release timing/evidence report: ' + reportPath);
  }
  process.exitCode = report.status === 'passed' ? 0 : 1;
  if (report.status === 'passed') console.log('Local ' + options.mode + ' checks passed. Fresh-fetch before push; full CI, live verification and private release closeout are still required.');
}
