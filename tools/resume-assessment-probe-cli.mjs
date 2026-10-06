import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync, mkdtempSync, rmSync, fsyncSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Miniflare } from 'miniflare';
import { createAssessmentProbe, probePolicy, CONTINUATION_KEY, CONTINUATION_CLAIM_KEY, SMOKE_KEY, SMOKE_CLAIM_KEY, STRUCTURED_SMOKE_KEY, STRUCTURED_SMOKE_CLAIM_KEY } from './resume-assessment-probe.mjs';
import { startPreview } from './resume-preview.mjs';
import { extractAssessmentArtifact, captureAssessmentInput } from '../src/js/resume-assessment-input.mjs';
import { historyHash } from '../src/js/resume-assessment-history.mjs';
import { assessmentBudgetRoute } from '../worker/resume-assessment-budget.mjs';
import { startStudioProbeBridge, STUDIO_KEY_PLACEHOLDER } from './resume-assessment-studio-bridge.mjs';

export const PAID_PROBE_DIRECTORY = join(homedir(), '.riteshk-work', 'assessment-probe-v1');
const fail = message => { throw new Error('Probe CLI: ' + message); };
function writeDurably(path, data, flag = 'w') {
  const descriptor = openSync(path, flag, 0o600);
  try { writeFileSync(descriptor, data); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
function writeJson(path, value) {
  const temporary = path + '.pending';
  writeDurably(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
}
async function immutableFile(path, bytes) {
  if (existsSync(path)) {
    if (await historyHash(new Uint8Array(readFileSync(path))) !== await historyHash(new Uint8Array(bytes))) fail('an inspection copy changed; no file was replaced.');
  } else writeDurably(path, bytes, 'wx');
}
export async function renderProbeExport(document, version) {
  const directory = mkdtempSync(join(tmpdir(), 'rk-probe-render-'));
  let preview;
  try {
    preview = await startPreview({ port: 0, directory });
    preview.store.create(document);
    for (let current = 1; current < version; current++) preview.store.save(document.id, document, current, 'Isolated fictional render version');
    const response = await fetch(preview.origin + '/__resume/api/resumes/' + document.id + '/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': String(version) }, body: '{}',
    });
    const entry = await response.json();
    if (!response.ok) fail(entry.error || 'isolated PDF rendering failed.');
    const bytes = new Uint8Array(preview.store.exportFile(document.id, entry.id).bytes);
    const extraction = await extractAssessmentArtifact(bytes, 'application/pdf', { document, loadPdf: () => import('pdfjs-dist/legacy/build/pdf.mjs') });
    const input = { kind: 'export', document, version, entry, bytes, mediaType: 'application/pdf', extraction };
    await captureAssessmentInput(input);
    return input;
  } finally {
    await preview?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runProbeCommand({ directory, args, signal, onStudioBridge, getKey = () => process.env.ANTHROPIC_API_KEY, fetcher = fetch, renderExport = renderProbeExport }) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    'prices-checked-at': { type: 'string' }, approval: { type: 'string' }, 'allow-provider': { type: 'boolean' },
    finding: { type: 'string' }, field: { type: 'string' }, reason: { type: 'string' }, confirm: { type: 'boolean' },
    studio: { type: 'boolean' }, continuation: { type: 'boolean' }, smoke: { type: 'boolean' }, structured: { type: 'boolean' },
  } });
  if (positionals.length !== 1 || !['prepare', 'status', 'review', 'run', 'finish', 'check-studio', 'review-continuation', 'register-continuation', 'review-smoke', 'register-smoke', 'run-smoke', 'review-structured', 'register-structured', 'run-structured'].includes(positionals[0])) fail('choose a supported probe inspection, registration or execution command. No reset, directory or arbitrary budget override exists.');
  const command = positionals[0];
  if (values.studio && !['review', 'run', 'run-smoke', 'run-structured'].includes(command)) fail('--studio is only valid for a phase review or run.');
  if (values.structured && (values.smoke || values.continuation || !['status', 'review', 'finish', 'run-structured'].includes(command))) fail('--structured selects only its status, review, finish or fixed execution.');
  if (command === 'run-structured' && (!values.structured || !values.studio || values.finding || values.field)) fail('the structured smoke requires --structured --studio and fixed edit targets.');
  if (values.smoke && (values.continuation || !['status', 'review', 'finish', 'run-smoke'].includes(command))) fail('--smoke selects only its status, review, finish or fixed execution.');
  if (command === 'run-smoke' && (!values.smoke || !values.studio || values.finding || values.field)) fail('the fixed smoke requires --smoke --studio and does not accept alternate edit targets.');
  if (values.continuation && !['status', 'review', 'run', 'finish'].includes(command)) fail('--continuation selects only status, review, run or finish of the registered follow-up.');
  if (['review-continuation', 'register-continuation', 'review-smoke', 'register-smoke', 'review-structured', 'register-structured'].includes(command) && values['allow-provider']) fail('registration is unpaid and cannot authorize provider access.');
  signal?.throwIfAborted();
  directory = resolve(directory);
  const anchor = join(directory, 'identity.json'), lock = join(directory, 'operation.lock');
  if (!existsSync(directory)) {
    if (command !== 'prepare') fail('prepare the fixed fictional workspace first.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeDurably(anchor, JSON.stringify({ version: 1, identity: 'four-dollar-fictional-probe', state: 'initializing' }), 'wx');
  }
  if (!existsSync(anchor)) fail('workspace identity is missing; do not initialize or reset this directory.');
  const identity = JSON.parse(readFileSync(anchor, 'utf8'));
  if (identity.version !== 1 || identity.identity !== 'four-dollar-fictional-probe' || !['initializing', 'ready'].includes(identity.state)) fail('workspace identity changed.');
  if (identity.continuationApprovalSha256 !== undefined && !/^[a-f0-9]{64}$/.test(identity.continuationApprovalSha256)) fail('the continuation identity anchor changed.');
  if (identity.smokeApprovalSha256 !== undefined && !/^[a-f0-9]{64}$/.test(identity.smokeApprovalSha256)) fail('the smoke identity anchor changed.');
  if (identity.structuredApprovalSha256 !== undefined && !/^[a-f0-9]{64}$/.test(identity.structuredApprovalSha256)) fail('the structured identity anchor changed.');
  if (identity.state !== 'ready' && command !== 'prepare') fail('initialization is incomplete; no paid command is allowed.');
  let descriptor;
  try { descriptor = openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('another command or an interrupted process owns the lock. Audit it; do not remove it automatically.'); throw error; }
  let runtime, studio, connectionFile;
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, command, at: Date.now() })); fsyncSync(descriptor);
    const r2Directory = join(directory, 'r2');
    if (identity.state === 'ready' && !existsSync(r2Directory)) fail('persistent storage disappeared. No budget recreation is allowed.');
    runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("Not an assessment endpoint",{status:404})}}',
      r2Buckets: ['PROBE'], r2Persist: r2Directory });
    const bucket = await runtime.getR2Bucket('PROBE');
    const claim = await bucket.get(CONTINUATION_CLAIM_KEY), child = await bucket.get(CONTINUATION_KEY);
    if (identity.continuationApprovalSha256 !== undefined || claim || child) {
      if (!claim || !child || (await claim.json()).approvalSha256 !== identity.continuationApprovalSha256) fail('the continuation anchor or registered state disappeared or changed; never recreate it.');
    }
    const smokeApproval = await bucket.get(SMOKE_CLAIM_KEY), smokeState = await bucket.get(SMOKE_KEY);
    if (identity.smokeApprovalSha256 !== undefined || smokeApproval || smokeState) {
      if (!smokeApproval || !smokeState || (await smokeApproval.json()).approvalSha256 !== identity.smokeApprovalSha256) fail('the smoke anchor or state disappeared; never recreate it.');
    }
    const structuredApproval = await bucket.get(STRUCTURED_SMOKE_CLAIM_KEY), structuredState = await bucket.get(STRUCTURED_SMOKE_KEY);
    if (identity.structuredApprovalSha256 !== undefined || structuredApproval || structuredState) {
      if (!structuredApproval || !structuredState || (await structuredApproval.json()).approvalSha256 !== identity.structuredApprovalSha256) fail('the structured smoke anchor or state disappeared; never recreate it.');
    }
    const connectStudio = async () => {
      if (studio) { await studio.preflight(); return; }
      studio = await startStudioProbeBridge({ signal, maxCalls: ['run-smoke', 'run-structured'].includes(command) ? 9 : 2 });
      const path = join(directory, 'studio-connection.json');
      writeDurably(path, JSON.stringify(studio.descriptor), 'wx');
      connectionFile = path;
      if (onStudioBridge) await onStudioBridge(studio.descriptor);
      else console.log(JSON.stringify({ studioConnectionFile: path, waitingForSignedInStudio: true }));
      await studio.preflight();
    };
    const codeFiles = ['tools/resume-assessment-probe.mjs', 'tools/resume-assessment-probe-cli.mjs', 'tools/resume-assessment-studio-bridge.mjs',
      'tools/resume-preview.mjs', 'worker/resume-assessment-budget.mjs', 'worker/resume-assessment-history.mjs',
      ...['evaluator', 'semantics', 'output', 'request-policy', 'history', 'input', 'pilot', 'revisions', 'presentation', 'comparison'].map(name => 'src/js/resume-assessment-' + name + '.mjs'),
      ...['resume-assessment.mjs', 'resume-review.mjs', 'resume-workspace.mjs', 'resume-pdf.mjs', 'resume-render.mjs', 'resume-pdf-structure.mjs'].map(name => 'src/js/' + name)];
    const codeSha256 = await historyHash(await Promise.all(codeFiles.map(async name => [name, await historyHash(new Uint8Array(readFileSync(new URL('../' + name, import.meta.url))))])));
    const probe = createAssessmentProbe({ bucket, renderExport, continuation: values.continuation === true, smoke: values.smoke === true, structured: values.structured === true, codeSha256,
      request: async (action, body, checkedAt, signal, retainResponse) => {
        const policy = probePolicy(checkedAt, values.smoke === true || values.structured === true);
        const response = await assessmentBudgetRoute(new Request('https://isolated.invalid/admin/resume/assessment/' + action, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
        }), { VAULT: bucket, RESUME_ASSESSMENT_POLICY: JSON.stringify(policy) }, {}, async () => {
          if (studio) return STUDIO_KEY_PLACEHOLDER;
          const key = getKey();
          if (typeof key !== 'string' || !key.trim()) fail('ANTHROPIC_API_KEY is absent. Do not paste it into chat or source.');
          return key;
        }, studio ? studio.fetcher : fetcher, { retainResponse });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Probe request was not acknowledged.');
        return value;
      } });
    const options = { pricesCheckedAt: values['prices-checked-at'] ? Date.parse(values['prices-checked-at']) : undefined,
      findingId: values.finding, fieldId: values.field, transport: values.studio ? 'studio' : 'environment' };
    let result;
    if (command === 'prepare') {
      if (identity.state === 'ready') await probe.status();
      result = await probe.prepare();
      writeJson(anchor, { ...identity, state: 'ready' });
    } else if (command === 'status') result = await probe.status();
    else if (command === 'check-studio') {
      await probe.status();
      await connectStudio();
      result = await probe.status();
    }
    else if (command === 'review') result = await probe.review(options);
    else if (command === 'review-continuation') result = await probe.reviewContinuation(options);
    else if (command === 'review-smoke') result = await probe.reviewSmoke(options);
    else if (command === 'review-structured') result = await probe.reviewStructured(options);
    else if (command === 'register-structured') result = await probe.registerStructured({ ...options, confirmed: values.confirm, approvalSha256: values.approval,
      onClaim: async approvalSha256 => {
        if (identity.structuredApprovalSha256 !== undefined) fail('this workspace already claimed its structured smoke.');
        writeJson(anchor, { ...identity, structuredApprovalSha256: approvalSha256 });
      } });
    else if (command === 'register-smoke') result = await probe.registerSmoke({ ...options, confirmed: values.confirm, approvalSha256: values.approval,
      onClaim: async approvalSha256 => {
        if (identity.smokeApprovalSha256 !== undefined) fail('this workspace already claimed its fixed smoke.');
        writeJson(anchor, { ...identity, smokeApprovalSha256: approvalSha256 });
      } });
    else if (command === 'run-smoke' || command === 'run-structured') result = await probe.runSmoke({ ...options, signal, approvalSha256: values.approval,
      allowProvider: values['allow-provider'] === true, preflight: connectStudio });
    else if (command === 'register-continuation') result = await probe.registerContinuation({ ...options, confirmed: values.confirm, approvalSha256: values.approval,
      onClaim: async approvalSha256 => {
        if (identity.continuationApprovalSha256 !== undefined) fail('this workspace already claimed its one continuation.');
        writeJson(anchor, { ...identity, continuationApprovalSha256: approvalSha256 });
      } });
    else if (command === 'finish') result = await probe.finish({ confirmed: values.confirm, reason: values.reason });
    else result = await probe.run({ ...options, signal, approvalSha256: values.approval, allowProvider: values['allow-provider'] === true,
      previousAssessmentApproved: values.confirm === true,
      preflight: async () => {
        if (values.studio) {
          await connectStudio();
          return;
        }
        const key = getKey();
        if (typeof key !== 'string' || !key.trim()) fail('ANTHROPIC_API_KEY is absent; no phase has been claimed. Supply it securely to this process, never in chat.');
      } });
    try {
      const reports = join(directory, 'reports'), originals = join(directory, 'originals');
      mkdirSync(reports, { recursive: true }); mkdirSync(originals, { recursive: true });
      const inspectionFile = join(reports, command + (values.structured ? '-structured' : values.smoke ? '-smoke' : values.continuation ? '-continuation' : '') + '-' + await historyHash(result) + '.json');
      await immutableFile(inspectionFile, new TextEncoder().encode(JSON.stringify(result, null, 2)));
      const current = ['review', 'review-continuation', 'review-smoke', 'review-structured'].includes(command) ? await probe.status() : result, originalFiles = {};
      for (const name of Object.keys(current.inputs)) {
        const input = await probe.original(name), extension = input.mediaType === 'application/pdf' ? 'pdf' : 'txt';
        const path = join(originals, name + '-' + current.inputs[name].sha256 + '.' + extension);
        await immutableFile(path, input.bytes); originalFiles[name] = path;
      }
      return { inspectionFile, originalFiles, next: current.next, spending: current.spending,
        ...(result.approvalSha256 ? { approvalSha256: result.approvalSha256 } : {}),
        stopped: current.stopped, limitation: current.limitation };
    } catch (error) {
      throw new Error('The ' + command + ' operation completed in durable state, but inspection export failed. Read status; do not replay a paid phase. ' + error.message, { cause: error });
    }
  } finally {
    try { await studio?.close(); }
    finally {
      try { await runtime?.dispose(); }
      finally {
        try { if (connectionFile) unlinkSync(connectionFile); }
        finally { closeSync(descriptor); unlinkSync(lock); }
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController(), cancel = () => controller.abort(new Error('Probe cancelled; inspect retained state before any further action.'));
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try { console.log(JSON.stringify(await runProbeCommand({ directory: PAID_PROBE_DIRECTORY, args: process.argv.slice(2), signal: controller.signal }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
