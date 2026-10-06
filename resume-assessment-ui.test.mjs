import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSESSMENT_DEVELOPMENT_CASES, createSampleAssessmentPilot } from './src/js/resume-assessment-sample.mjs';
import { captureAssessmentSource } from './src/js/resume-assessment-pilot.mjs';
import { sampleResumes } from './src/js/resume-sample.mjs';
import { createResume } from './src/js/resume-workspace.mjs';
import { Miniflare } from 'miniflare';
import { createAssessmentBudgetStore, assessmentBudgetRoute } from './worker/resume-assessment-budget.mjs';
import { assessmentHistoryRoute, createAssessmentHistoryStore } from './worker/resume-assessment-history.mjs';
import { assessmentResponseSchema } from './src/js/resume-assessment-output.mjs';
import { assessmentRequestParameters } from './src/js/resume-assessment-request-policy.mjs';
import { RESUME_COMPLETION_LIMITS } from './src/js/resume-review.mjs';

test('Candidate development references are versioned scripted fixtures, not a held-out quality result', async () => {
  assert.equal(new Set(ASSESSMENT_DEVELOPMENT_CASES.map(item => item.id)).size, 4);
  for (const reference of ASSESSMENT_DEVELOPMENT_CASES) {
    assert.equal(reference.version, 1); assert.ok(reference.acceptance.length);
    const before = structuredClone(reference), { pilot, snapshot } = await createSampleAssessmentPilot(reference.id);
    assert.equal(pilot.state().phase, 'ready');
    await pilot.inventory({ confirmed: true }); await pilot.approveInventory({ confirmed: true });
    await pilot.approveEvidence({ confirmed: true, excluded: [{ id: 'artifact-0', reason: 'name' }, { id: 'artifact-1', reason: 'contact' }] });
    const result = await pilot.evaluate({ confirmed: true });
    for (const atom of reference.atoms) assert.equal(result.report.dimensions.roleEvidence.ratings.find(item => item.id === atom.id).state, atom.expected);
    assert.equal(result.report.headline.value, null);
    assert.ok(result.execution.every(item => item.model === 'scripted-offline-example' && item.usage === null));
    assert.equal(snapshot.artifact.text, reference.text);
    assert.deepEqual(reference, before);
  }
  await assert.rejects(createSampleAssessmentPilot('not-a-case'), /Unknown fictional/);
});

test('Candidate attached-source capture binds original bytes, stored extraction and current document without mixing editor text', async () => {
  const bytes = new TextEncoder().encode('Original submitted resume text.'), id = createHash('sha256').update(bytes).digest('hex');
  const document = sampleResumes(id)[0], source = { id, sha256: id, type: 'text/plain', text: new TextDecoder().decode(bytes), name: 'Original.txt' };
  const original = structuredClone(document);
  const snapshot = await captureAssessmentSource({ document, version: 1, source, bytes });
  assert.equal(snapshot.artifact.text, source.text); assert.equal(snapshot.binding.documentId, document.id);
  assert.doesNotMatch(snapshot.artifact.text, /median setup time/);
  assert.equal(snapshot.artifact.extractorVersion, 'stored-source-text-unverified-v1');
  assert.deepEqual(document, original);
  await assert.rejects(captureAssessmentSource({ document, version: 1, source, bytes: new TextEncoder().encode('Wrong bytes') }), /expected hash/);
  assert.throws(() => captureAssessmentSource({ document: { ...document, sourceIds: [] }, version: 1, source, bytes }), /attached original/);
  assert.throws(() => captureAssessmentSource({ document, version: 1, source: { ...source, sha256: 'f'.repeat(64) }, bytes }), /recorded content hash/);
});

describe('Candidate visible review browser acceptance', () => {
  let preview, browser, directory, pilotModule, bridgeSource;
  before(async () => {
    const { buildPreview, startPreview } = await import('./tools/resume-preview.mjs');
    const { chromium } = await import('playwright-core');
    const { build } = await import('esbuild');
    await buildPreview();
    pilotModule = (await build({ stdin: { contents: 'export {createAssessmentPilot,captureAssessmentSource} from "./src/js/resume-assessment-pilot.mjs"; export {createAssessmentBudgetClient} from "./src/js/resume-assessment-budget-client.mjs"; export {createAssessmentHistoryClient} from "./src/js/resume-assessment-history-client.mjs"; export {captureAssessmentInput} from "./src/js/resume-assessment-input.mjs"; export {assertAssessmentCurrent} from "./src/js/resume-assessment.mjs"; export {resumeCompletionReservation} from "./src/js/resume-review.mjs"; export {createAiOrchestrator} from "./src/js/ai-orchestrator.mjs"; export {assessmentRequestPolicy} from "./src/js/resume-assessment-request-policy.mjs";', resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false })).outputFiles[0].text;
    const studio = readFileSync(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
    bridgeSource = studio.slice(studio.indexOf('  async function resumeAiConfiguration()'), studio.lastIndexOf('})();'));
    directory = mkdtempSync(join(tmpdir(), 'rk-candidate-ui-'));
    preview = await startPreview({ port: Number(process.env.RESUME_CANDIDATE_TEST_PORT || 5564), directory });
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  });
  after(async () => {
    await browser?.close(); await preview?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  async function open(flag = true) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const external = [], writes = [], errors = [];
    await context.route('**/*', route => {
      const request = route.request(), url = request.url();
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(url);
      if (url.startsWith(preview.origin + '/')) return route.continue();
      external.push(url); return route.abort();
    });
    await context.addInitScript(() => localStorage.setItem('rk:resume-preview:selected', 'avery-meridian'));
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(preview.origin + '/studio/resume-preview/' + (flag ? '?candidate=1' : ''));
    await page.locator('.rws-status.is-saved').waitFor();
    await page.getByRole('heading', { name: 'Review', exact: true }).waitFor();
    return { context, page, external, writes, errors };
  }
  async function launch(page) {
    await page.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Candidate assessment', exact: true });
    await dialog.getByRole('button', { name: 'Start fictional walkthrough' }).click();
    await dialog.locator('[data-candidate-phase="ready"]').waitFor(); return dialog;
  }
  async function checkedExport(page, id, action) {
    const before = structuredClone(preview.store.get(id));
    const received = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/resumes/' + id + '/export') && response.request().method() === 'POST');
    await action();
    const response = await received;
    assert.equal(response.status(), 200);
    const { base64, ...entry } = await response.json();
    assert.equal(entry.transient, true);
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(entry.verification.complete, true);
    assert.deepEqual(preview.store.get(id), before, 'Preparing assessment bytes must not create a checkpoint or retained PDF');
    return entry;
  }
  async function inventory(dialog) {
    await dialog.getByRole('checkbox', { name: 'Continue with the fictional job inventory' }).check();
    await dialog.getByRole('button', { name: 'Build job inventory', exact: true }).click();
    await dialog.locator('[data-candidate-phase="inventory-review"]').waitFor();
  }
  async function approveInventory(dialog) {
    await dialog.getByRole('checkbox', { name: 'I reviewed all job requirements' }).check();
    await dialog.getByRole('button', { name: 'Approve job inventory', exact: true }).click();
    await dialog.locator('[data-candidate-phase="evidence-review"]').waitFor();
  }
  async function approveEvidence(dialog) {
    await dialog.getByLabel('Handling: artifact-0', { exact: true }).selectOption('name');
    await dialog.getByLabel('Handling: artifact-1', { exact: true }).selectOption('contact');
    await dialog.getByRole('checkbox', { name: 'I reviewed the included evidence' }).check();
    await dialog.getByRole('button', { name: 'Approve included evidence', exact: true }).click();
    await dialog.locator('[data-candidate-phase="assessment-ready"]').waitFor();
  }
  async function screenshot(dialog, name) {
    const folder = process.env.RESUME_CANDIDATE_SCREENSHOT_DIR;
    if (folder) { mkdirSync(folder, { recursive: true }); await dialog.locator('.pass__box').screenshot({ path: join(folder, name + '.png') }); }
  }
  test('Candidate dialog is opt-in and its complete fictional walkthrough preserves the actual resume', async () => {
    const { context, page, external, writes, errors } = await open(false);
    try {
      assert.equal(await page.getByRole('button', { name: 'Preview candidate assessment' }).count(), 0);
      await page.goto(preview.origin + '/studio/resume-preview/?candidate=1');
      await page.locator('.rws-status.is-saved').waitFor();
      await page.getByRole('heading', { name: 'Review', exact: true }).waitFor();
      const original = structuredClone(preview.store.get('avery-meridian'));
      writes.length = 0;
      const dialog = await launch(page);
      assert.equal(await dialog.getByRole('button', { name: 'Build job inventory', exact: true }).isDisabled(), true);
      await inventory(dialog);
      assert.equal(await dialog.getByLabel('Condition relationship').inputValue(), 'anyOf');
      const sourceCoverage = dialog.locator('[data-candidate-jd-sources]');
      await sourceCoverage.locator(':scope > summary').click();
      assert.equal(await sourceCoverage.locator('[data-candidate-jd-segment]').count(), 2);
      assert.match(await sourceCoverage.innerText(), /Python or Java/);
      assert.match(await sourceCoverage.innerText(), /python, characters 0–6/);
      await screenshot(dialog, 'candidate-jd-source-coverage-desktop');
      await sourceCoverage.locator(':scope > summary').click();
      await screenshot(dialog, 'candidate-inventory');
      await approveInventory(dialog); await approveEvidence(dialog);
      assert.equal(await dialog.getByRole('button', { name: 'Run assessment and challenge', exact: true }).isDisabled(), true);
      await dialog.getByRole('checkbox', { name: 'Run the scripted assessment and challenge' }).check();
      await dialog.getByRole('button', { name: 'Run assessment and challenge', exact: true }).click();
      await dialog.locator('[data-candidate-phase="complete"]').waitFor();
      assert.match(await dialog.locator('[data-candidate-result]').innerText(), /1 required criterion is not fully supported/);
      assert.match(await dialog.innerText(), /No headline score is available/);
      assert.match(await dialog.innerText(), /reading order[\s\S]*unknown/i);
      assert.match(await dialog.locator('[data-candidate-summary]').innerText(), /1 of 2 approved compound criteria supported; 1 unresolved/);
      assert.match(await dialog.locator('[data-candidate-finding="role-tools"]').innerText(), /No change needed/);
      assert.equal(await dialog.locator('[data-candidate-finding="role-java"]').count(), 0);
      assert.match(await dialog.locator('[data-candidate-findings]').innerText(), /Checked revisions are available only/);
      const findingIds = await dialog.locator('[data-candidate-finding]').evaluateAll(items => items.map(item => item.dataset.candidateFinding));
      await dialog.locator('[data-candidate-summary]').scrollIntoViewIfNeeded();
      await screenshot(dialog, 'candidate-coherent-findings-desktop');
      await dialog.getByRole('heading', { name: 'Role evidence', exact: true }).scrollIntoViewIfNeeded();
      await screenshot(dialog, 'candidate-result');
      const challenge = dialog.getByText('Assessment and challenge', { exact: true }).nth(2);
      await challenge.click();
      assert.match(await dialog.innerText(), /Keep this unresolved/);
      await dialog.getByText('Saved candidate results — this pilot budget', { exact: true }).click();
      await dialog.getByLabel('Saved assessment', { exact: true }).selectOption({ index: 1 });
      await dialog.getByRole('button', { name: 'Open saved assessment', exact: true }).click();
      await dialog.locator('[data-candidate-phase="historical"]').waitFor();
      await dialog.locator('[data-candidate-result]').waitFor();
      assert.deepEqual(await dialog.locator('[data-candidate-finding]').evaluateAll(items => items.map(item => item.dataset.candidateFinding)), findingIds);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent.includes('Preview candidate assessment'));
      assert.deepEqual(preview.store.get('avery-meridian'), original);
      assert.equal(writes.length, 0); assert.equal(external.filter(url => /anthropic|openai|\/admin\/ai/.test(url)).length, 0);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('rk:resume:assessment-pilot:'))), false);
    } finally { await context.close(); }
  });

  test('Candidate source relationship challenge visibly withholds an otherwise agreeing judgment and survives history', async () => {
    const { context, page, writes, errors } = await open();
    const original = structuredClone(preview.store.get('avery-meridian'));
    try {
      writes.length = 0;
      await page.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Candidate assessment', exact: true });
      await dialog.getByLabel('Fictional scenario', { exact: true }).selectOption('dev-attribution');
      await dialog.getByRole('button', { name: 'Start fictional walkthrough', exact: true }).click();
      await dialog.locator('[data-candidate-phase="ready"]').waitFor();
      await inventory(dialog); await approveInventory(dialog); await approveEvidence(dialog);
      await dialog.getByRole('checkbox', { name: 'Run the scripted assessment and challenge' }).check();
      await dialog.getByRole('button', { name: 'Run assessment and challenge', exact: true }).click();
      await dialog.locator('[data-candidate-phase="complete"]').waitFor();
      const group = dialog.locator('[data-candidate-group="north"]');
      assert.match(await group.innerText(), /Proposed: Lead Designer \/ Atlas\s+unknown/);
      assert.match(await group.innerText(), /source says Northstar, not Atlas/);
      assert.match(await dialog.innerText(), /Affected judgments have been withheld/);
      assert.match(await dialog.innerText(), /required criterion is not fully supported/);
      assert.match(await dialog.locator('[data-candidate-finding="source-group-north"]').innerText(), /source says Northstar, not Atlas/);
      assert.equal(await dialog.locator('[data-candidate-finding="role-criterion"]').count(), 0);
      await group.scrollIntoViewIfNeeded(); await screenshot(dialog, 'candidate-semantic-challenge-desktop');
      await dialog.getByText('Every JD segment: semantic completeness challenge', { exact: true }).click();
      assert.match(await dialog.locator('[data-candidate-semantics]').innerText(), /jd-0/);
      await dialog.getByText('Saved candidate results — this pilot budget', { exact: true }).click();
      await dialog.getByLabel('Saved assessment', { exact: true }).selectOption({ index: 1 });
      await dialog.getByRole('button', { name: 'Open saved assessment', exact: true }).click();
      await dialog.locator('[data-candidate-phase="historical"]').waitFor();
      assert.match(await dialog.locator('[data-candidate-group="north"]').innerText(), /unknown/);
      assert.deepEqual(preview.store.get('avery-meridian'), original);
      assert.equal(writes.length, 0); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test('Candidate JD source review exposes unscored segments and removes invalid coverage rather than implying completeness', async () => {
    const { context, page, errors } = await open();
    try {
      const dialog = await launch(page); await inventory(dialog);
      await dialog.getByText('All job segments and structural corrections', { exact: true }).click();
      const editor = dialog.getByLabel('Full candidate inventory JSON', { exact: true });
      const original = await editor.inputValue(), corrected = JSON.parse(original);
      corrected.segments[1].disposition = 'context'; corrected.segments[1].reason = 'Fictional classification for review testing.';
      corrected.requirements = corrected.requirements.slice(0, 1);
      await editor.fill(JSON.stringify(corrected));
      const coverage = dialog.locator('[data-candidate-jd-sources]');
      await coverage.locator(':scope > summary').click();
      const segment = coverage.locator('[data-candidate-jd-segment="jd-1"]');
      assert.match(await segment.innerText(), /Marked context/);
      assert.match(await segment.innerText(), /Lead cross-team work/);
      assert.match(await segment.innerText(), /No scored criterion is linked/);
      assert.equal(await dialog.getByRole('button', { name: 'Approve job inventory', exact: true }).isDisabled(), true);
      await coverage.scrollIntoViewIfNeeded();
      await screenshot(dialog, 'candidate-jd-source-coverage-desktop');
      await editor.fill(original);
      assert.match(await segment.innerText(), /Cross-team leadership/);
      corrected.segments.pop();
      await editor.fill(JSON.stringify(corrected));
      await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.locator('[data-candidate-jd-sources]').count(), 0);
      assert.equal(await dialog.getByRole('button', { name: 'Approve job inventory', exact: true }).isDisabled(), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test('Candidate inventory corrections, consent resets and evidence exclusions cannot bypass validation', async () => {
    const { context, page, errors } = await open();
    try {
      const dialog = await launch(page); await inventory(dialog);
      await dialog.getByRole('checkbox', { name: 'I reviewed all job requirements' }).check();
      await dialog.getByLabel('Priority: Cross-team leadership', { exact: true }).selectOption('preferred');
      assert.equal(await dialog.getByRole('checkbox', { name: 'I reviewed all job requirements' }).isChecked(), false);
      await dialog.getByLabel('Condition relationship').selectOption('allOf');
      await dialog.getByText('All job segments and structural corrections', { exact: true }).click();
      const editor = dialog.getByLabel('Full candidate inventory JSON');
      const correct = await editor.inputValue();
      await editor.fill('{"revision":null}');
      assert.ok(await dialog.getByRole('alert').count());
      assert.equal(await dialog.getByRole('button', { name: 'Approve job inventory', exact: true }).isDisabled(), true);
      await editor.fill(correct); await approveInventory(dialog);
      for (let index = 0; index < 5; index++) await dialog.getByLabel('Handling: artifact-' + index, { exact: true }).selectOption('contact');
      await dialog.getByRole('checkbox', { name: 'I reviewed the included evidence' }).check();
      assert.equal(await dialog.getByRole('button', { name: 'Approve included evidence', exact: true }).isDisabled(), true);
      await dialog.getByLabel('Handling: artifact-2', { exact: true }).selectOption('include');
      assert.equal(await dialog.getByRole('checkbox', { name: 'I reviewed the included evidence' }).isChecked(), false);
      await dialog.getByRole('button', { name: 'Review inventory again', exact: true }).click();
      assert.equal(await dialog.getByLabel('Condition relationship').inputValue(), 'allOf');
      assert.equal(await dialog.getByLabel('Priority: Cross-team leadership', { exact: true }).inputValue(), 'preferred');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await dialog.locator('.pass__box').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await screenshot(dialog, 'candidate-narrow');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test('Closing during candidate preparation discards late completion without touching the workspace', async () => {
    const { context, page, errors } = await open();
    try {
      await page.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Candidate assessment', exact: true });
      await page.evaluate(() => {
        const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
        window.__candidateDigests = 0;
        crypto.subtle.digest = (...args) => {
          window.__candidateDigests++;
          if (!first) return digest(...args);
          first = false;
          return new Promise(resolve => { window.__releaseCandidateDigest = async () => resolve(await digest(...args)); });
        };
      });
      await dialog.getByRole('button', { name: 'Start fictional walkthrough' }).click();
      await dialog.getByRole('button', { name: 'Cancel and close', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.evaluate(() => window.__releaseCandidateDigest());
      await page.waitForFunction(() => window.__candidateDigests >= 4);
      await page.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      assert.equal(await dialog.locator('[data-candidate-mode="setup"]').count(), 1);
      assert.equal(await dialog.getByRole('button', { name: 'Start fictional walkthrough' }).isEnabled(), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const mode of ['source', 'upload']) test('Candidate ' + mode + ' crosses the actual Studio connector realm without trusting copied snapshot metadata', async () => {
    const reference = ASSESSMENT_DEVELOPMENT_CASES[0], sample = await createSampleAssessmentPilot(reference.id);
    const inventory = await sample.pilot.inventory({ confirmed: true }); await sample.pilot.approveInventory({ confirmed: true });
    await sample.pilot.approveEvidence({ confirmed: true }); const result = await sample.pilot.evaluate({ confirmed: true });
    const quoteOnly = node => node.kind === 'atom' ? { kind: node.kind, id: node.id, segmentId: node.segmentId, quote: node.quote } : { ...node, children: node.children.map(quoteOnly) };
    const requirements = { ...inventory.manifest, requirements: inventory.manifest.requirements.map(item => ({ ...item, condition: quoteOnly(item.condition) })) };
    const bytes = Buffer.from(reference.text), source = preview.store.source({ name: 'Fictional original.txt', type: 'text/plain', text: 'Deliberately stale cached text.' }, bytes);
    const document = sampleResumes(source.id)[0]; document.id = 'candidate-' + mode; document.target.jd = reference.jd;
    preview.store.create(document);
    const original = structuredClone(preview.store.get(document.id));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const outbound = [], errors = [];
    await context.route('**/*', route => {
      const path = new URL(route.request().url()).pathname;
      if (!route.request().url().startsWith(preview.origin + '/')) { outbound.push(route.request().url()); return route.abort(); }
      if (path === '/__candidate-pilot.mjs') return route.fulfill({ contentType: 'text/javascript', body: pilotModule });
      if (path === '/__candidate-host') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script type="module">
        import {createAssessmentPilot,captureAssessmentSource,captureAssessmentInput,assertAssessmentCurrent,resumeCompletionReservation} from '/__candidate-pilot.mjs';
        const root={classList:{contains:()=>true}}, pricing={input:1,output:2}, updatedAt=Date.now();
        const aiCfg=()=>({provider:'anthropic',key:'synthetic-not-a-secret',base:'https://example.test'});
        const aiCatalog={discover:async()=>({updatedAt,models:[{id:'synthetic-fixed-model',pricing,output:['text'],maxOutputTokens:12000,maxInputTokens:128000,contextWindow:140000}]})};
        const outputs=${JSON.stringify({ requirements, assessment: result.draft, challenge: result.challenge })};
        window.__candidateCalls=[];
        const aiChatOnce=async(config,model,system,user,options)=>{
          const stage=system.includes('Inventory the job BEFORE')?'requirements':system.includes('Independently challenge')?'challenge':'assessment';
          window.__candidateCalls.push({stage,user});
          const output=structuredClone(outputs[stage]);
          if(output.semantic) output.semantic.excerpts=output.semantic.excerpts.filter(item=>JSON.parse(user).evidence.some(excerpt=>excerpt.id===item.id));
          return {ok:true,receipt:{text:JSON.stringify(output),provider:config.provider,model,requestId:'synthetic-'+window.__candidateCalls.length,usage:{inputTokens:100,outputTokens:200}}};
        };
        window.__RKStudio={resume:{initialize:async()=>({resumeId:${JSON.stringify(document.id)}}),request:async(path,options={})=>{
          const response=await fetch('/__resume/'+(path.startsWith('sources/')&&!options.method?'':'api/')+path,options);
          if(response.ok&&options.method==='POST'&&path.endsWith('/export')) return new Response(JSON.stringify({entry:await response.json()}),{headers:{'Content-Type':'application/json'}});
          return response;
        }}};
        ${bridgeSource}
        const connect=window.__RKStudio.resumeAI.connectAssessment.bind(window.__RKStudio.resumeAI);
        window.__candidateInputs=[];
        window.__RKStudio.resumeAI.connectAssessment=async options=>{
          const input=await options.getInput(), pilot=await connect(options);
          window.__candidateInputs.push({kind:input.kind,exportId:input.entry?.id,version:input.version,expectedFingerprint:options.expectedFingerprint});
          return pilot;
        };
        const frame=document.createElement('iframe'); frame.title='Synthetic Resume host'; frame.style='position:fixed;inset:0;width:100%;height:100%;border:0';frame.src='/studio/resume/?hosted=1&candidate=1';document.body.append(frame);
        </script></body></html>` });
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(preview.origin + '/__candidate-host');
      const frame = page.frameLocator('iframe[title="Synthetic Resume host"]');
      await frame.locator('.rws-status.is-saved').waitFor();
      await frame.getByRole('heading', { name: 'Review', exact: true }).waitFor();
      await frame.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      const dialog = frame.getByRole('dialog', { name: 'Candidate assessment', exact: true });
      if (mode === 'source') {
        await dialog.getByLabel('Original file to assess', { exact: true }).selectOption(source.id);
        await dialog.getByRole('button', { name: 'Prepare selected original', exact: true }).click();
      } else await dialog.getByLabel('Upload file for candidate assessment', { exact: true }).setInputFiles({ name: 'Unattached intake.txt', mimeType: 'text/plain', buffer: bytes });
      await dialog.getByLabel('Budget authority', { exact: true }).selectOption('browser-origin');
      await dialog.getByRole('button', { name: 'Load available models', exact: true }).click();
      await dialog.getByLabel('Pilot model', { exact: true }).selectOption('synthetic-fixed-model');
      await dialog.getByLabel('Approved total budget (USD)', { exact: true }).fill('1');
      await dialog.getByRole('checkbox', { name: 'I approve this browser-local pilot budget' }).check();
      await dialog.getByRole('button', { name: 'Connect approved pilot', exact: true }).click();
      await dialog.locator(`[data-candidate-mode="${mode}"][data-candidate-phase="ready"]`).waitFor();
      assert.equal(await page.evaluate(() => window.__candidateCalls.length), 0);
      await dialog.getByRole('checkbox', { name: 'Allow this complete job description' }).check();
      await dialog.getByRole('button', { name: 'Build job inventory', exact: true }).click();
      await dialog.locator('[data-candidate-phase="inventory-review"]').waitFor();
      await dialog.getByLabel('Priority: Cross-team leadership', { exact: true }).selectOption('preferred');
      await approveInventory(dialog); await approveEvidence(dialog);
      await dialog.getByRole('checkbox', { name: 'Allow the selected evidence to be sent' }).check();
      await dialog.getByRole('button', { name: 'Run assessment and challenge', exact: true }).click();
      await dialog.locator('[data-candidate-phase="complete"]').waitFor();
      const calls = await page.evaluate(() => window.__candidateCalls);
      await dialog.locator('[data-candidate-result]').waitFor();
      assert.equal(await dialog.locator('[data-candidate-summary]').count(), 1);
      assert.equal(calls.length, 3);
      assert.ok(calls.every(call => !call.user.includes('avery@example.test') && !call.user.includes('Avery Example')));
      assert.match(calls[1].user, /Built Python prototypes/);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:resume:assessment-pilot:candidate-review')));
      assert.equal(saved.results[0].approval.manifest.revision, 2);
      assert.equal(saved.results[0].snapshotFingerprint, saved.results[0].selection.snapshotFingerprint);
      assert.equal(saved.results[0].report.binding.artifactSha256, source.id);
      assert.equal(saved.results[0].report.binding.documentId, mode === 'upload' ? null : document.id);
      assert.deepEqual(preview.store.get(document.id), original);
      await page.keyboard.press('Escape');
      await frame.locator('.rws-page-count[aria-busy="false"]').waitFor();
      const paper = frame.frameLocator('.rws-paper');
      await paper.locator('.pagedjs_page [data-field="summary"]').first().click();
      await paper.locator('[data-inline-field="summary"]').fill('A changed fictional summary.');
      await paper.locator('[data-inline-field="summary"]').press('Control+Enter');
      await frame.locator('.rws-status.is-saved').waitFor();
      await frame.getByRole('heading', { name: 'Review', exact: true }).waitFor();
      await frame.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      if (mode === 'source') assert.match(await dialog.innerText(), /result is historical/);
      else {
        assert.doesNotMatch(await dialog.innerText(), /result is historical/);
        await dialog.locator('[data-candidate-result]').waitFor();
        assert.equal(await dialog.locator('[data-candidate-result]').count(), 1);
      }
      if (mode === 'source') {
        await dialog.getByRole('button', { name: 'Start over', exact: true }).click();
        const entry = await checkedExport(page, document.id, async () => {
          await dialog.getByRole('button', { name: 'Prepare current checked PDF', exact: true }).click();
          await dialog.locator('[data-candidate-artifact-hash]').waitFor({ timeout: 30000 });
        });
        const record = preview.store.get(document.id);
        assert.equal(await dialog.locator('[data-candidate-artifact-hash]').textContent(), entry.sha256);
        await dialog.getByLabel('Budget authority', { exact: true }).selectOption('browser-origin');
        await dialog.getByRole('button', { name: 'Load available models', exact: true }).click();
        await dialog.getByLabel('Pilot model', { exact: true }).selectOption('synthetic-fixed-model');
        await dialog.getByRole('checkbox', { name: 'I approve this browser-local pilot budget' }).check();
        await dialog.getByRole('button', { name: 'Connect approved pilot', exact: true }).click();
        await dialog.locator('[data-candidate-mode="export"][data-candidate-phase="ready"]').waitFor();
        const captured = await page.evaluate(() => window.__candidateInputs.at(-1));
        assert.equal(captured.kind, 'export'); assert.equal(captured.exportId, entry.id); assert.equal(captured.version, record.version);
        assert.deepEqual(preview.store.get(document.id).document, record.document);
      }
      assert.equal(await page.evaluate(() => window.__candidateCalls.length), 3);
      assert.deepEqual(outbound.filter(url => !/^https:\/\/media\.riteshk\.work\/[a-f0-9]+\.woff2$/.test(url)), []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  const handoffFailures = [
    { id: 'unauthorized', call: 1, status: 401 },
    { id: 'rate-limit', call: 1, status: 429 },
    { id: 'deadline', call: 1 },
    { id: 'malformed-json', call: 1 },
    { id: 'oversized-reply', call: 1 },
    { id: 'truncated-assessment', call: 2 },
    { id: 'missing-challenge-target', call: 3 },
    { id: 'refused-revision', call: 4 },
    { id: 'wrong-model-recheck', call: 8 },
  ];
  const handoffs = [
    ...['browser-origin', 'server', 'server-structured', 'server-evidence', 'server-future'].map(mode => ({ mode, failure: null })),
    ...handoffFailures.map(failure => ({ mode: 'server-evidence', failure })),
  ];
  for (const { mode, failure } of handoffs) test(failure
    ? 'Candidate Sonnet handoff blocks ' + failure.id + ' at raw call ' + failure.call
    : 'Candidate checked revision blocks disputes, applies with undo and explicitly rechecks the edited PDF against its frozen inventory - ' + mode, async () => {
    const future = mode === 'server-future', evidencePolicy = mode === 'server-evidence' || future;
    const structured = mode === 'server-structured' || evidencePolicy, scope = structured ? 'server' : mode;
    const selectedModel = future ? 'fictional-future-model' : structured ? 'claude-sonnet-5-5' : 'synthetic-fixed-model';
    const beforeText = 'Built Python services with the team.', afterText = 'With the team, built Python services.';
    const ledgerKey = (scope === 'server' ? 'rk:resume:assessment-server-history:' : 'rk:resume:assessment-pilot:') + 'candidate-review';
    const budgetConsent = scope === 'server' ? 'I approve this server-enforced shared budget.' : 'I approve this browser-local pilot budget';
    const centralPolicy = { version: 1, provider: 'anthropic', maxCost: 10, checkedAt: Date.now(), models: [
      { id: selectedModel, pricing: structured ? { input: 2, output: 10 } : { input: 1, output: 2 },
        maxOutputTokens: 12000, maxInputTokens: structured ? 110000 : 128000, contextWindow: structured ? 1000000 : 140000, reasoning: future,
        ...(future ? { structuredOutput: true } : {}) }
    ] };
    const runtime = scope === 'server' ? new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("offline")}}', r2Buckets: ['BUDGET'] }) : null;
    const privateBucket = runtime && await runtime.getR2Bucket('BUDGET');
    const centralStore = runtime && createAssessmentBudgetStore(privateBucket, centralPolicy);
    const privateHistory = runtime && createAssessmentHistoryStore(privateBucket);
    let centralUnavailable = scope === 'server';
    const document = createResume({ id: 'candidate-revision-ui-' + mode + (failure ? '-' + failure.id : ''), target: { company: 'Example', role: 'Designer', level: 'staff', jd: 'Python' },
      model: { name: 'Avery', title: 'Product Designer', summary: '', contact: { email: 'private@example.test', links: [] },
        sections: [{ id: 'experience', heading: 'Experience', kind: 'experience', items: [{ id: 'north', org: 'Northstar', role: 'Lead Designer', dates: '2021 - Present', location: '',
          bullets: [{ id: 'revision-work', text: beforeText }] }] }] } });
    preview.store.create(document);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const outbound = [], errors = [], wireCalls = [];
    await context.route('**/*', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!request.url().startsWith(preview.origin + '/')) { outbound.push(request.url()); return route.abort(); }
      if (path.startsWith('/admin/resume/history/')) {
        assert.ok(privateHistory, 'Only the explicitly selected server fixture may access private history.');
        assert.equal(request.headers().authorization, 'Bearer scripted-owner-session');
        const response = await assessmentHistoryRoute(new Request(request.url(), { method: request.method(), headers: request.headers(),
          ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postDataBuffer() }) }),
        { VAULT: privateBucket, RESUME_ASSESSMENT_HISTORY: 'enabled' }, { 'Cache-Control': 'no-store' });
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      if (path.startsWith('/admin/resume/assessment/')) {
        assert.ok(centralStore, 'Browser-local mode must not contact central spending.');
        if (centralUnavailable) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Central spending is not enabled. No fallback.' }) });
        assert.equal(request.headers().authorization, 'Bearer scripted-owner-session');
        const input = request.method() === 'POST' ? request.postDataJSON() : null;
        const response = await assessmentBudgetRoute(new Request(request.url(), { method: request.method(), headers: request.headers(),
          ...(input ? { body: request.postDataBuffer() } : {}) }),
        { VAULT: privateBucket, RESUME_ASSESSMENT_POLICY: JSON.stringify(centralPolicy) }, { 'Cache-Control': 'no-store' },
        async provider => { assert.equal(provider, 'anthropic'); return 'scripted-provider-key'; },
        async (url, options) => {
          assert.equal(url, 'https://api.anthropic.com/v1/messages');
          assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
          assert.equal(options.headers['x-api-key'], 'scripted-provider-key');
          const body = JSON.parse(options.body);
          const parameters = assessmentRequestParameters('anthropic', selectedModel, future);
          if (structured) parameters.output_config = { ...parameters.output_config,
            format: { type: 'json_schema', schema: assessmentResponseSchema(input) } };
          assert.deepEqual(body, { model: selectedModel, max_tokens: RESUME_COMPLETION_LIMITS[input.stage], ...parameters,
            stream: false, system: input.system, messages: [{ role: 'user', content: input.user }] });
          const budget = await (await privateBucket.get('system/resume-assessment-budget-v1.json')).json();
          assert.equal(budget.reservations.find(entry => entry.plan.id === input.reservationId).attempts.find(attempt => attempt.stage === input.stage).status, 'started');
          wireCalls.push({ stage: input.stage, body, input: structuredClone(input) });
          const failNow = failure?.call === wireCalls.length;
          if (failNow && failure.status) return Response.json({ error: { type: 'scripted-provider-rejection', message: 'Scripted rejection, not a real provider response.' } }, { status: failure.status });
          if (failNow && failure.id === 'deadline') throw new DOMException('Scripted upstream deadline; no network request.', 'TimeoutError');
          const receipt = await page.evaluate(call => window.__centralInvoke(call), {
            provider: 'anthropic', model: body.model, system: body.system, user: body.messages[0].content,
            stage: input.stage, ...(input.responseContract ? { responseContract: input.responseContract } : {}),
          });
          if (failNow && failure.id === 'missing-challenge-target') {
            const value = JSON.parse(receipt.text); delete value.ratings.python; receipt.text = JSON.stringify(value);
          }
          const envelope = { id: 'scripted-wire-' + wireCalls.length, type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
            content: [{ type: 'thinking', thinking: 'SCRIPTED_HIDDEN_REASONING_NOT_UI' }, { type: 'text', text: receipt.text }],
            usage: { input_tokens: 100, output_tokens: 200 } };
          if (failNow && failure.id === 'truncated-assessment') envelope.stop_reason = 'max_tokens';
          if (failNow && failure.id === 'refused-revision') envelope.stop_reason = 'refusal';
          if (failNow && failure.id === 'wrong-model-recheck') envelope.model = 'unselected-scripted-model';
          if (failNow && failure.id === 'malformed-json') envelope.content[1].text = '{"unfinished":';
          if (failNow && failure.id === 'oversized-reply') return new Response('x'.repeat(300001));
          return Response.json(envelope, { headers: { 'request-id': envelope.id } });
        });
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      if (path === '/__candidate-pilot.mjs') return route.fulfill({ contentType: 'text/javascript', body: pilotModule });
      if (path === '/__revision-host') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script type="module">
        import {createAssessmentPilot,createAssessmentBudgetClient,createAssessmentHistoryClient,captureAssessmentSource,captureAssessmentInput,assertAssessmentCurrent,resumeCompletionReservation,createAiOrchestrator,assessmentRequestPolicy} from '/__candidate-pilot.mjs';
        const root={classList:{contains:()=>true}},pricing=${JSON.stringify(centralPolicy.models[0].pricing)},updatedAt=${centralPolicy.checkedAt};
        const ADMIN_WORKER=${JSON.stringify(preview.origin)},adminSession=()=>'scripted-owner-session',adminSessionInfo=()=>({sessionId:'scripted-owner'});
        const aiCfg=()=>({provider:'anthropic',key:'synthetic-not-a-secret',base:'https://example.test'});
        const aiCatalog={discover:async()=>({updatedAt,scope:'fictional-anthropic-scope',models:[{provider:'anthropic',id:${JSON.stringify(selectedModel)},name:${JSON.stringify(selectedModel)},pricing,output:['text'],structured:${structured},reasoning:${structured},maxOutputTokens:12000,maxInputTokens:128000,contextWindow:140000}]})};
        const aiOrchestrator=createAiOrchestrator({catalog:aiCatalog,store:{read:async()=>({policy:{maxCost:null,useReference:false},observations:[],incumbents:{}})}});
        window.__revisionCalls=[];window.__revisionBlocked=true;
        const aiChatOnce=async(config,model,system,user,options)=>{
          const data=JSON.parse(user), stage=options.stage;window.__revisionCalls.push({stage,user});
          const reviews=values=>values.map(item=>({id:item.id,verdict:'agree',reason:'Scripted review, not independent truth.',...(item.evidence?{evidence:item.evidence}:{})}));
          let value;
          if(stage==='requirements') value={revision:1,segments:data.segments.map(item=>({id:item.id,disposition:'criteria',reason:'Fictional requirement.'})),requirements:[{id:'python',label:'Python',importance:'required',condition:{kind:'atom',id:'python',segmentId:'jd-0',quote:'Python'}}]};
          else if(stage==='assessment'){
            const ref=quote=>({id:data.evidence.find(item=>item.text.includes(quote)).id,quote});
            const revised=data.evidence.some(item=>item.text.includes(${JSON.stringify(afterText)}));
            const group={id:'north',role:ref('Lead Designer'),employer:ref('Northstar'),dates:ref('2021 - Present'),achievements:[ref(revised?${JSON.stringify(afterText)}:${JSON.stringify(beforeText)})],certainty:'explicit',reason:'Scripted source group.'};
            const ids=[group.role,group.employer,group.dates,...group.achievements].map(item=>item.id);
            value={ratings:[{id:'python',state:revised?'supported':'mentioned',reason:'Scripted evidence judgment; a wording change does not independently prove improvement.',evidence:[group.achievements[0].id]}],communication:['scope','outcomes','clarity'].map(id=>({id,rating:revised?3:2,reason:'Scripted contribution judgment.',evidence:[group.achievements[0].id]})),semantic:{version:'source-attribution-v1',excerpts:data.evidence.map(item=>({id:item.id,kind:ids.includes(item.id)?'experience':'general',reason:'Scripted classification.'})),groups:[group]}};
          } else if(stage==='revision') value={kind:'revision',after:${JSON.stringify(afterText)},reason:'Clarify the phrasing.',claims:[{id:'claim-1',quote:${JSON.stringify(afterText)},evidence:[{id:data.evidence.find(item=>item.text.includes(${JSON.stringify(beforeText)})).id,quote:${JSON.stringify(beforeText)}}]}]};
          else if(data.field) value={verdict:window.__revisionBlocked?'disagree':'agree',reason:window.__revisionBlocked?'Scripted preservation disagreement: do not apply.':'Scripted complete wording check.',claims:[{id:'claim-1',verdict:'agree',reason:'Scripted claim review.'}]};
          else value={ratings:reviews(data.draft.ratings),communication:reviews(data.draft.communication),inventoryIssues:[],semantic:{version:'source-attribution-v1',excerpts:reviews(data.evidence),groups:reviews(data.draft.semantic.groups),segments:reviews(data.segments)}};
          return {ok:true,receipt:{text:JSON.stringify(value),provider:config.provider,model,requestId:'scripted-'+window.__revisionCalls.length,usage:null}};
        };
        window.__centralInvoke=async call=>{
          const receipt=(await aiChatOnce({provider:call.provider},call.model,call.system,call.user,{stage:call.stage})).receipt;
          if(call.responseContract){
            const value=JSON.parse(receipt.text),data=JSON.parse(call.user),keyed=items=>Object.fromEntries(items.map(item=>[item.id,item]));
            if(call.stage==='requirements')value.segments=keyed(value.segments);
            else if(call.responseContract==='revision-json-v1'){
              if(call.stage==='challenge')value.claims=keyed(value.claims);
            }else{
              if(call.responseContract==='assessment-semantic-evidence-json-v1'&&call.stage==='challenge'){
                for(const entry of [...value.ratings,...value.communication]){
                  const context=data.evidence.find(item=>!entry.evidence.includes(item.id)&&data.draft.semantic.excerpts.find(excerpt=>excerpt.id===item.id)?.kind==='general');
                  entry.contextEvidence=context?[{id:context.id,reason:'Scripted additional background, not a dependency of this judgment.'}]:[];
                }
              }
              value.ratings=keyed(value.ratings);value.communication=keyed(value.communication);
              value.semantic.excerpts=keyed(value.semantic.excerpts);
              if(call.stage==='challenge'){
                value.semantic.groups=keyed(value.semantic.groups);value.semantic.segments=keyed(value.semantic.segments);
                value.inventoryIssues=Object.fromEntries(data.segments.map(segment=>[segment.id,{segmentId:segment.id,issue:false,reason:''}]));
              }
            }
            receipt.text=JSON.stringify(value);
          }
          return receipt;
        };
        window.__RKStudio={resume:{initialize:async()=>({resumeId:${JSON.stringify(document.id)}}),request:async(path,options={})=>{
          const response=await fetch('/__resume/'+(path.startsWith('sources/')&&!options.method?'':'api/')+path,options);
          if(response.ok&&options.method==='POST'&&path.endsWith('/export'))return new Response(JSON.stringify({entry:await response.json()}),{headers:{'Content-Type':'application/json'}});
          return response;
        }}};
        ${bridgeSource}
        const frame=document.createElement('iframe');frame.title='Revision host';frame.style='position:fixed;inset:0;width:100%;height:100%;border:0';frame.src='/studio/resume/?hosted=1&candidate=1${evidencePolicy ? '&evidencePolicy=decision-context-v1' : ''}';document.body.append(frame);
        </script></body></html>` });
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    const expectHandoffFailure = async (dialog, expectedText, expectedResults) => {
      await dialog.locator('[data-candidate-phase="failed"]').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /failed|unknown|unavailable/i);
      assert.match(await dialog.innerText(), /pilot stopped.*reservations are retained/i);
      assert.doesNotMatch(await dialog.innerText(), /SCRIPTED_HIDDEN_REASONING_NOT_UI/);
      assert.equal(await dialog.getByRole('button', { name: 'Apply reviewed revision', exact: true }).count(), 0);
      assert.equal(await dialog.locator('[data-candidate-comparison]').count(), 0);
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, expectedText);
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), ledgerKey);
      assert.equal(saved.results.length, expectedResults);
      assert.equal(saved.failures.length, 1);
      const status = await centralStore.status();
      const ledger = await (await privateBucket.get('system/resume-assessment-budget-v1.json')).json();
      const attempts = ledger.reservations.flatMap(entry => entry.attempts);
      assert.equal(attempts.filter(attempt => attempt.status === 'failed').length, 1);
      assert.equal(attempts.filter(attempt => attempt.status === 'received').length, failure.call - 1);
      assert.ok(status.reserved > 0);
      assert.equal(wireCalls.length, failure.call);
      const replayStatus = await page.evaluate(async input => (await fetch('/admin/resume/assessment/execute', {
        method: 'POST', headers: { Authorization: 'Bearer scripted-owner-session', 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })).status, wireCalls.at(-1).input);
      assert.equal(replayStatus, 409);
      await dialog.getByRole('button', { name: 'Refresh shared budget (no AI call)' }).click();
      await dialog.locator('[data-candidate-phase="failed"]').waitFor();
      assert.equal((await centralStore.status()).reserved, status.reserved);
      assert.equal(wireCalls.length, failure.call);
      assert.deepEqual((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), ledgerKey)).results, saved.results);
      assert.equal((await privateHistory.list()).items.length, failure.call === 8 ? 1 : 0);
      assert.deepEqual(errors, []);
      assert.ok(outbound.every(url => /^https:\/\/media\.riteshk\.work\/[a-f0-9]{64}\.woff2$/.test(url)));
    };
    try {
      await page.goto(preview.origin + '/__revision-host');
      const frame = page.frameLocator('iframe[title="Revision host"]');
      await frame.locator('.rws-status.is-saved').waitFor();
      await frame.getByRole('heading', { name: 'Review', exact: true }).waitFor();
      await frame.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      const dialog = frame.getByRole('dialog', { name: 'Candidate assessment', exact: true });
      await dialog.getByRole('button', { name: 'Prepare current checked PDF', exact: true }).click();
      await dialog.locator('[data-candidate-artifact-hash]').waitFor({ timeout: 30000 });
      await dialog.getByLabel('Budget authority', { exact: true }).selectOption(scope);
      if (scope === 'server') {
        await dialog.getByRole('button', { name: 'Load available models' }).click();
        await dialog.getByRole('alert').waitFor();
        assert.match(await dialog.getByRole('alert').innerText(), /not enabled.*No fallback/);
        assert.equal(await dialog.getByLabel('Pilot model', { exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => window.__revisionCalls.length), 0);
        centralUnavailable = false;
      }
      await dialog.getByRole('button', { name: 'Load available models' }).click();
      if (scope === 'server') {
        assert.equal(await dialog.getByLabel('Pilot model', { exact: true }).inputValue(), selectedModel);
        await dialog.locator('[data-candidate-model-recommendation] > summary').click();
        assert.match(await dialog.locator('[data-candidate-model-recommendation]').innerText(), /Provisional selection/);
        await screenshot(dialog, 'candidate-task-model-recommendation-desktop');
        assert.equal(await dialog.getByRole('button', { name: 'Connect approved pilot' }).isDisabled(), true);
      }
      await dialog.getByLabel('Pilot model', { exact: true }).selectOption(selectedModel);
      await dialog.getByLabel('Approved total budget (USD)', { exact: true }).fill('10');
      await dialog.getByRole('checkbox', { name: budgetConsent }).check();
      await dialog.getByRole('button', { name: 'Connect approved pilot' }).click();
      await dialog.getByRole('checkbox', { name: 'Allow this complete job description' }).check();
      await dialog.getByRole('button', { name: 'Build job inventory', exact: true }).click();
      if (failure?.call === 1) return await expectHandoffFailure(dialog, beforeText, 0);
      await dialog.locator('[data-candidate-phase="inventory-review"]').waitFor(); await approveInventory(dialog);
      await dialog.getByRole('checkbox', { name: 'I reviewed the included evidence' }).check();
      await dialog.getByRole('button', { name: 'Approve included evidence' }).click();
      await dialog.getByRole('checkbox', { name: 'Allow the selected evidence to be sent' }).check();
      await dialog.getByRole('button', { name: 'Run assessment and challenge' }).click();
      if ([2, 3].includes(failure?.call)) return await expectHandoffFailure(dialog, beforeText, 0);
      const section = dialog.locator('[data-candidate-revision]');
      await section.waitFor();
      await section.getByLabel('Revision finding', { exact: true }).selectOption('role-python');
      await section.getByLabel('Revision field', { exact: true }).selectOption('revision-work');
      const consent = section.getByRole('checkbox', { name: 'Allow the selected field, approved evidence' });
      await section.getByText('Additional author-provided evidence', { exact: true }).click();
      await section.getByLabel('Author-provided facts', { exact: true }).fill('x'.repeat(8001));
      await section.getByRole('checkbox', { name: 'I confirm these facts as author-provided evidence.' }).check();
      await consent.check();
      assert.equal((await section.getByLabel('Author-provided facts', { exact: true }).inputValue()).length, 8001);
      assert.equal(await section.getByRole('button', { name: 'Prepare checked revision' }).isDisabled(), true);
      assert.match(await section.getByRole('alert').innerText(), /exceeds 8,000/);
      assert.equal(await page.evaluate(() => window.__revisionCalls.length), 3);
      await section.getByLabel('Author-provided facts', { exact: true }).fill('');
      await section.getByText('Additional author-provided evidence', { exact: true }).click();
      await consent.check(); await section.getByRole('button', { name: 'Prepare checked revision' }).click();
      if (failure?.call === 4) return await expectHandoffFailure(dialog, beforeText, 1);
      await section.getByRole('heading', { name: 'blocked', exact: true }).waitFor();
      assert.equal(await section.getByRole('button', { name: 'Apply reviewed revision' }).count(), 0);
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, beforeText);
      const blockedId = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).revisions[0].id, ledgerKey);
      await page.evaluate(() => { window.__revisionBlocked = false; });
      await consent.check(); await section.getByRole('button', { name: 'Prepare checked revision' }).click();
      await section.getByRole('heading', { name: 'review required', exact: true }).waitFor();
      const readyId = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).revisions[1].id, ledgerKey);
      await section.getByText('Saved candidate revisions and questions', { exact: true }).click();
      await section.getByLabel('Saved revision', { exact: true }).selectOption(blockedId);
      await section.getByRole('button', { name: 'Open saved revision' }).click();
      await section.getByRole('heading', { name: 'blocked', exact: true }).waitFor();
      await section.getByLabel('Saved revision', { exact: true }).selectOption(readyId);
      await section.getByRole('button', { name: 'Open saved revision' }).click();
      await section.getByRole('heading', { name: 'review required', exact: true }).waitFor();
      assert.equal(await section.getByRole('button', { name: 'Apply reviewed revision' }).isDisabled(), true);
      await section.getByRole('checkbox', { name: 'I reviewed the original, proposed wording' }).check();
      await section.locator('[data-candidate-revision-result]').scrollIntoViewIfNeeded();
      await screenshot(dialog, 'candidate-checked-revision-desktop');
      if (privateHistory) {
        assert.equal((await privateHistory.list()).items.length, 0);
        const save = dialog.locator('[data-candidate-save-history]');
        assert.equal(await save.getByRole('button', { name: 'Save private assessment history' }).isDisabled(), true);
        await save.getByRole('checkbox').check();
        await save.getByRole('button', { name: 'Save private assessment history' }).click();
        await dialog.locator('[data-candidate-save-history] [role="status"], [role="alert"]').first().waitFor();
        assert.equal(await dialog.getByRole('alert').count(), 0, await dialog.innerText());
        await save.getByRole('status').waitFor();
        const stored = await privateHistory.get((await privateHistory.list()).items[0].id);
        assert.equal(stored.record.revisions.length, 2);
        assert.equal(stored.receiptStatus, 'server-receipted-not-independent-truth');
        if (evidencePolicy) {
          assert.equal(stored.record.result.evidencePolicy, 'decision-context-v1');
          assert.ok(stored.record.result.challenge.ratings.some(entry => entry.contextEvidence.length));
          assert.ok(await dialog.locator('[data-candidate-context]').count());
          const contextEvidence = dialog.locator('[data-candidate-context]').first(), parent = contextEvidence.locator('..');
          if (!await parent.evaluate(element => element.open)) await parent.locator(':scope > summary').click();
          await contextEvidence.locator(':scope > summary').click();
          await contextEvidence.locator('.rws-candidate-references > details > summary').first().click();
          assert.match(await contextEvidence.innerText(), /relevance is not independently verified/);
          assert.ok((await contextEvidence.locator('blockquote').first().innerText()).trim());
          await contextEvidence.evaluate(element => element.scrollIntoView({ block: 'start' }));
          await screenshot(dialog, 'candidate-evidence-context-desktop');
        }
        assert.ok([stored.record.result, ...stored.record.revisions].every(value =>
          value.execution.every(entry => entry.requestPolicy === (future ? 'anthropic-reasoning-default-v1' : structured ? 'anthropic-sonnet-5-5-medium-v1' : 'anthropic-temperature-zero-v1') &&
            Boolean(entry.responseContract) === structured)));
        assert.equal(await page.evaluate(() => window.__revisionCalls.length), 7);
      }
      const previous = preview.store.get(document.id);
      await section.getByRole('button', { name: 'Apply reviewed revision' }).click();
      await dialog.getByText(/This result is historical/).waitFor();
      const applied = preview.store.get(document.id);
      assert.equal(applied.version, previous.version + 2);
      assert.equal(applied.document.model.sections[0].items[0].bullets[0].text, afterText);
      assert.equal(applied.document.candidateEdits[0].revision.id, readyId);
      assert.ok(applied.versions.some(item => item.label === 'Before candidate revision: ' + readyId));
      assert.deepEqual(applied.document.assessment, previous.document.assessment);
      assert.equal(await page.evaluate(() => window.__revisionCalls.length), 7);
      const originalAssessment = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).results[0], ledgerKey);
      const recheckedExport = await checkedExport(page, document.id, async () => {
        await dialog.getByRole('button', { name: 'Prepare explicit PDF recheck' }).click();
        await dialog.locator('[data-candidate-artifact-hash], [role="alert"]').first().waitFor({ timeout: 30000 });
        assert.equal(await dialog.getByRole('alert').count(), 0, await dialog.innerText());
        await dialog.locator('[data-candidate-artifact-hash]').waitFor({ timeout: 30000 });
      });
      assert.notEqual(recheckedExport.sha256, originalAssessment.report.binding.artifactSha256);
      assert.equal(recheckedExport.verification.complete, true);
      assert.equal(await page.evaluate(() => window.__revisionCalls.length), 7);
      await dialog.getByRole('button', { name: 'Load available models' }).click();
      await dialog.getByLabel('Pilot model', { exact: true }).selectOption(selectedModel);
      assert.match(await dialog.innerText(), /Maximum reservation: \$0\.0000 for inventory/);
      await dialog.getByRole('checkbox', { name: budgetConsent }).check();
      if (scope === 'server') {
        assert.match(await dialog.innerText(), /Shared across supported desktop devices/);
        await dialog.getByLabel('Budget authority', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
        await screenshot(dialog, 'candidate-central-budget-desktop');
      }
      if (evidencePolicy) await dialog.evaluate(() => {
        const url = new URL(location.href); url.searchParams.delete('evidencePolicy');
        history.replaceState(null, '', url);
      });
      await dialog.getByRole('button', { name: 'Connect approved pilot' }).click();
      const reuse = dialog.getByRole('button', { name: 'Reuse approved inventory (no AI call)' });
      assert.equal(await reuse.isDisabled(), true);
      assert.equal(await dialog.getByRole('button', { name: 'Build job inventory', exact: true }).count(), 0);
      await dialog.getByRole('checkbox', { name: 'I reviewed the original approved inventory' }).check();
      await reuse.click();
      await dialog.locator('[data-candidate-phase="evidence-review"]').waitFor();
      assert.equal(await page.evaluate(() => window.__revisionCalls.length), 7);
      assert.equal(await dialog.getByRole('button', { name: 'Approve included evidence' }).isDisabled(), true);
      await dialog.getByRole('checkbox', { name: 'I reviewed the included evidence' }).check();
      await dialog.getByRole('button', { name: 'Approve included evidence' }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Run assessment and challenge' }).isDisabled(), true);
      await dialog.getByRole('checkbox', { name: 'Allow the selected evidence to be sent' }).check();
      await dialog.getByRole('button', { name: 'Run assessment and challenge' }).click();
      if (failure?.call === 8) return await expectHandoffFailure(dialog, afterText, 1);
      const comparison = dialog.locator('[data-candidate-comparison]');
      await comparison.getByRole('heading', { name: 'Before / after recheck', exact: true }).waitFor();
      assert.match(await comparison.innerText(), /Improved: 4/);
      const transition = comparison.locator('[data-candidate-transition="role-python"]');
      await transition.locator(':scope > summary').click();
      for (const [side, text] of [['before', beforeText], ['after', afterText]]) {
        const value = transition.locator('[data-candidate-comparison-side="' + side + '"]');
        await value.locator('.rws-candidate-references > details > summary').click();
        assert.ok((await value.innerText()).includes(text));
        assert.ok(!(await value.innerText()).includes(side === 'before' ? afterText : beforeText));
        await value.locator('[data-candidate-pdf-spans] > summary').click();
        assert.match(await value.innerText(), /Page 1, item \d+, characters/);
        await value.locator('[data-candidate-pdf-spans] > summary').click();
      }
      await comparison.getByRole('heading', { name: 'Before / after recheck', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
      await screenshot(dialog, scope === 'server' ? 'candidate-central-budget-recheck-desktop' : 'candidate-explicit-recheck-desktop');
      const paired = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), ledgerKey);
      assert.equal(paired.results.length, 2); assert.equal(paired.comparisons.length, 1);
      assert.deepEqual(paired.results[0], originalAssessment);
      if (evidencePolicy) assert.equal(paired.results[1].evidencePolicy, originalAssessment.evidencePolicy);
      assert.equal(paired.results[1].approval.manifestSha256, originalAssessment.approval.manifestSha256);
      assert.equal(paired.results[1].report.binding.documentVersion, applied.version);
      assert.equal(paired.results[1].report.binding.artifactSha256, recheckedExport.sha256);
      assert.deepEqual(await page.evaluate(() => window.__revisionCalls.map(item => item.stage)), ['requirements', 'assessment', 'challenge', 'revision', 'challenge', 'revision', 'challenge', 'assessment', 'challenge']);
      if (centralStore) {
        assert.deepEqual(wireCalls.map(item => item.stage), ['requirements', 'assessment', 'challenge', 'revision', 'challenge', 'revision', 'challenge', 'assessment', 'challenge']);
        assert.ok(paired.results.every(result => result.execution.every(entry => entry.requestId.startsWith('scripted-wire-') && entry.usage.inputTokens === 100 && entry.usage.outputTokens === 200)));
        assert.doesNotMatch(await dialog.innerText(), /SCRIPTED_HIDDEN_REASONING_NOT_UI/);
      }
      await dialog.getByText('Saved candidate results — this pilot budget', { exact: true }).click();
      await dialog.getByLabel('Saved assessment', { exact: true }).selectOption(paired.results[1].report.id);
      await dialog.getByRole('button', { name: 'Open saved assessment' }).click();
      await dialog.locator('[data-candidate-phase="historical"]').waitFor();
      await comparison.getByRole('heading', { name: 'Before / after recheck', exact: true }).waitFor();
      if (scope === 'server') {
        await dialog.getByRole('button', { name: 'Refresh shared budget (no AI call)' }).click();
        await dialog.locator('[data-candidate-phase="historical"]').waitFor();
        const save = dialog.locator('[data-candidate-save-history]');
        await save.getByRole('checkbox').check();
        await save.getByRole('button', { name: 'Save private assessment history' }).click();
        await dialog.locator('[data-candidate-save-history] [role="status"], [role="alert"]').first().waitFor();
        assert.equal(await dialog.getByRole('alert').count(), 0, await dialog.innerText());
        await save.getByRole('status').waitFor();
        assert.equal((await privateHistory.list()).items.length, 2);
        const savedPair = await privateHistory.get(paired.results[1].report.id);
        assert.equal(savedPair.record.baselineId, originalAssessment.report.id);
        assert.deepEqual(savedPair.record.comparison, paired.comparisons[0]);
        assert.equal(savedPair.record.inventory.reusedFrom, originalAssessment.report.id);
      }
      assert.equal(await page.evaluate(() => window.__revisionCalls.length), 9);
      await page.keyboard.press('Escape');
      await frame.getByRole('button', { name: 'Undo', exact: true }).click(); await frame.locator('.rws-status.is-saved').waitFor();
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, beforeText);
      await frame.getByRole('button', { name: 'Redo', exact: true }).click(); await frame.locator('.rws-status.is-saved').waitFor();
      assert.equal(preview.store.get(document.id).document.model.sections[0].items[0].bullets[0].text, afterText);
      assert.equal(await page.evaluate(() => window.__revisionCalls.length), 9);
      if (centralStore) {
        const reserved = (await centralStore.status()).reserved;
        assert.equal(reserved, Math.round(paired.reservations.reduce((sum, plan) => sum + plan.amount, 0) * 1e6) / 1e6);
        await page.evaluate(key => localStorage.removeItem(key), ledgerKey);
        assert.equal((await createAssessmentBudgetStore(await runtime.getR2Bucket('BUDGET'), centralPolicy).status()).reserved, reserved);
        await page.reload();
        await frame.locator('.rws-status.is-saved').waitFor();
        await frame.getByRole('heading', { name: 'Review', exact: true }).waitFor();
        await frame.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
        const privatePanel = dialog.locator('[data-candidate-private-history]');
        await privatePanel.locator(':scope > summary').click();
        await privatePanel.getByRole('button', { name: 'Load private history', exact: true }).click();
        await privatePanel.getByLabel('Private assessment', { exact: true }).selectOption(paired.results[1].report.id);
        const unchanged = structuredClone(preview.store.get(document.id));
        await privatePanel.getByRole('button', { name: 'Open private assessment', exact: true }).click();
        const restored = privatePanel.locator('[data-candidate-restored-history]');
        await restored.getByRole('heading', { name: 'Before / after recheck', exact: true }).waitFor();
        assert.match(await restored.innerText(), /responses match server request\/output receipts/);
        assert.equal(await restored.getByRole('button', { name: 'Apply reviewed revision' }).count(), 0);
        const downloadEvent = page.waitForEvent('download');
        await restored.getByRole('button', { name: 'Download stored original' }).click();
        const download = await downloadEvent;
        assert.equal(createHash('sha256').update(readFileSync(await download.path())).digest('hex'), recheckedExport.sha256);
        assert.deepEqual(preview.store.get(document.id), unchanged);
        assert.equal(await page.evaluate(() => window.__revisionCalls.length), 0);
        await restored.locator('h3').first().evaluate(element => element.scrollIntoView({ block: 'start' }));
        await screenshot(dialog, 'candidate-private-history-restored-desktop');
        await restored.getByRole('heading', { name: 'Before / after recheck', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
        await screenshot(dialog, 'candidate-private-history-comparison-desktop');
        await restored.getByRole('button', { name: 'Use saved baseline for explicit recheck' }).click();
        await dialog.locator('[data-candidate-artifact-hash], [role="alert"]').first().waitFor({ timeout: 30000 });
        assert.equal(await dialog.getByRole('alert').count(), 0, await dialog.innerText());
        await dialog.getByRole('button', { name: 'Load available models' }).click();
        await dialog.getByLabel('Pilot model', { exact: true }).selectOption(selectedModel);
        await dialog.getByLabel('Approved total budget (USD)', { exact: true }).fill('10');
        await dialog.getByRole('checkbox', { name: budgetConsent }).check();
        await dialog.getByRole('button', { name: 'Connect approved pilot' }).click();
        await dialog.getByRole('checkbox', { name: 'I reviewed the original approved inventory' }).check();
        await dialog.getByRole('button', { name: 'Reuse approved inventory (no AI call)' }).click();
        await dialog.locator('[data-candidate-phase="evidence-review"]').waitFor();
        assert.equal(await page.evaluate(() => window.__revisionCalls.length), 0);
        assert.equal((await centralStore.status()).reserved, reserved);
      }
      assert.ok(outbound.every(url => /^https:\/\/media\.riteshk\.work\/[a-f0-9]{64}\.woff2$/.test(url)));
      assert.deepEqual(errors, []);
    } finally { await context.close(); await runtime?.dispose(); }
  });

  test('Candidate current PDF reads the actual checked export without changing scores or replacing an original', async () => {
    const { context, page, writes, errors } = await open();
    const before = structuredClone(preview.store.get('avery-meridian'));
    try {
      await page.getByRole('button', { name: 'Preview candidate assessment', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Candidate assessment', exact: true });
      const rendering = page.waitForResponse(response => response.url().endsWith('/resumes/avery-meridian/export') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Prepare current checked PDF', exact: true }).click();
      await dialog.locator('[data-candidate-artifact-hash]').waitFor({ timeout: 30000 });
      const after = preview.store.get('avery-meridian'), entry = await (await rendering).json();
      const pdfBytes = Buffer.from(entry.base64, 'base64');
      assert.equal(entry.transient, true);
      assert.equal(createHash('sha256').update(pdfBytes).digest('hex'), entry.sha256);
      assert.deepEqual(after, before, 'Candidate preparation stores neither PDF bytes nor a new version');
      assert.equal(await dialog.locator('[data-candidate-artifact-hash]').textContent(), entry.sha256);
      assert.deepEqual(after.document, before.document); assert.equal(after.version, before.version);
      assert.equal(entry.verification.complete, true);
      assert.match(await dialog.innerText(), /CURRENT CHECKED PDF/);
      await dialog.getByText('Target job and recovered file text', { exact: true }).click();
      assert.match(await dialog.innerText(), /median setup time\s+by 32%/);
      const structure = dialog.locator('[data-candidate-structure]');
      assert.equal(await structure.count(), 1);
      const native = structure.locator(':scope > details').first();
      await native.locator(':scope > summary').click();
      await native.getByText('Exact PDF field locations', { exact: true }).click();
      assert.match(await native.innerText(), /northstar\.role/);
      assert.match(await native.innerText(), /Page 1, item \d+, characters/);
      await screenshot(dialog, 'candidate-pdf-structure-desktop');
      await native.locator(':scope > summary').click();
      assert.equal(await dialog.getByRole('button', { name: 'Load available models' }).isDisabled(), true);
      assert.ok(writes.every(url => url.endsWith('/export')));
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
      await screenshot(dialog, 'candidate-checked-export-narrow');
      await dialog.getByRole('button', { name: 'Start over', exact: true }).click();
      await page.route('**/resumes/avery-meridian/export', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'PDF verification found missing text: Summary, Phone. No file was offered for download.' }) }));
      await dialog.getByRole('button', { name: 'Prepare current checked PDF', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /missing text: Summary, Phone/);
      assert.equal(await dialog.locator('[data-candidate-artifact-hash]').count(), 0);
      assert.equal(await dialog.getByRole('button', { name: 'Load available models' }).count(), 0);
      assert.deepEqual(preview.store.get('avery-meridian').document, before.document);
      const file = await context.request.get(preview.origin + '/__resume/api/resumes/avery-meridian/exports/' + entry.id);
      assert.equal(file.status(), 404);
      await dialog.getByLabel('Upload file for candidate assessment', { exact: true }).setInputFiles({ name: 'Same actual bytes.pdf', mimeType: 'application/pdf', buffer: pdfBytes });
      await dialog.locator('[data-candidate-mode="upload"]').waitFor();
      assert.equal(await dialog.locator('[data-candidate-artifact-hash]').textContent(), entry.sha256);
      assert.match(await dialog.innerText(), /UPLOADED ORIGINAL ONLY/);
      assert.equal(await dialog.locator('[data-candidate-structure]').count(), 0);
      await page.setViewportSize({ width: 1440, height: 1000 });
      const order = dialog.locator('[data-candidate-pdf-order]');
      assert.equal(await order.count(), 1);
      assert.match(await order.innerText(), /Reference-free horizontal PDF probes/);
      const firstPage = order.locator(':scope > details').first();
      await firstPage.locator(':scope > summary').click();
      await firstPage.getByText('PDF content order', { exact: true }).click();
      assert.match(await firstPage.innerText(), /Page 1, item \d+, characters/);
      assert.match(await firstPage.innerText(), /Avery/);
      await order.scrollIntoViewIfNeeded();
      await screenshot(dialog, 'candidate-original-pdf-order-desktop');
      const provenance = dialog.locator('[data-candidate-evidence-map]');
      await provenance.locator(':scope > summary').click();
      assert.ok(await provenance.getByText('Exact PDF source (1 span)', { exact: true }).count() > 0);
      const employer = provenance.locator('[data-candidate-mapped-excerpt]').filter({ hasText: 'Northstar' }).first();
      await employer.locator('[data-candidate-pdf-spans] > summary').click();
      assert.match(await employer.innerText(), /Page 1, item \d+, characters/);
      await employer.scrollIntoViewIfNeeded();
      await screenshot(dialog, 'candidate-evidence-provenance-desktop');
      await dialog.getByRole('button', { name: 'Start over', exact: true }).click();
      await page.unroute('**/resumes/avery-meridian/export');
      await page.route('**/resumes/avery-meridian/export', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...entry, sha256: 'f'.repeat(64) }) }));
      await dialog.getByRole('button', { name: 'Prepare current checked PDF', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').innerText(), /expected hash/);
      assert.equal(await dialog.locator('[data-candidate-artifact-hash]').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
