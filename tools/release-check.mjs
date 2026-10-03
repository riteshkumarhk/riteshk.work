import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserShards, shardCommands } from './browser-shards.mjs';

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'all';
  if (!['all', 'root'].includes(mode)) throw new Error('Unknown release check mode: ' + mode);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (mode === 'all') {
    const response = await fetch(new URL('/index.html', validateLocalServer(process.env.SLIDE_LAB_URL)), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(readFileSync(new URL('../index.html', import.meta.url)))) {
      throw new Error('Local server must serve this working tree before release checks run');
    }
  }
  for (const [label, args] of mode === 'root' ? releaseCommands().slice(0, 1) : releaseCommands()) {
    console.log('\n=== ' + label + ' ===');
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error('Release gate failed: ' + label + '. Do not push or bypass this check.');
      process.exit(result.status || 1);
    }
  }
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== revision) {
    throw new Error('HEAD changed during checks; validate the final integrated revision before pushing');
  }
  console.log('\nRequired ' + mode + ' checks passed against ' + revision + ' and its working tree. Review rebuilt outputs; fetch again before pushing.');
}
