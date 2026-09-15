import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const deck = 'slide-studio-deck.test.mjs';
const authoring = '(?:Prepare |Resume canvas |AI |Draft entire deck )';
export const browserShards = {
  authoring: [{ files: [deck], pattern: '^' + authoring }],
  sections: [{ files: [deck], pattern: '^(?!' + authoring + ')' }],
  recovery: [{ files: [
    'project-recovery.browser.test.mjs', 'slide-presenter-readonly.browser.test.mjs',
    'release-checks.browser.test.mjs', 'presenter-dj.browser.test.mjs',
    'presenter-macos.browser.test.mjs', 'presenter-native.browser.test.mjs',
    'presenter-web.browser.test.mjs', 'slide-presenter.browser.test.mjs',
    'studio-capture-download.browser.test.mjs'
  ] }]
};

export function shardCommands(shard) {
  if (!Object.hasOwn(browserShards, shard)) throw new Error('Unknown browser shard: ' + shard);
  return browserShards[shard].map(({ files, pattern }) => [
    '--import', './tools/browser-test-guard.mjs', '--test', '--test-concurrency=1',
    ...(pattern ? ['--test-name-pattern=' + pattern] : []), ...files
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.SLIDE_LAB_URL) throw new Error('SLIDE_LAB_URL is required; browser coverage must not silently skip');
  for (const args of shardCommands(process.argv[2])) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
}