import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { openIsolatedBrowserHost, waitForSlideEditor } from "./tools/browser-editor-ready.mjs";
import { assertStudioToolbar, assertResumeViewTools } from "./tools/studio-toolbar-assertions.mjs";
import { rkDecWithSek, rkUnwrapSek, rkNewSek, rkWrapSek, rkEncWithSek } from "./src/js/admin-core.js";
import { assertStudioDeckPublishable, createStudioDeck, STUDIO_DECK_SCHEMA } from "./src/js/slide-studio-deck.mjs";
import { AI_AGENT_SYSTEM } from "./src/js/ai-task-agent.mjs";
import { COMPOSITION_RESPONSE_SCHEMA } from "./src/js/slide-merge-ai.mjs";
import { contentRevision } from "./src/js/content-revision.mjs";
import { loadProtectedBlocks } from "./src/js/project-recovery.mjs";
import { resumeSaveFailureFeedback } from "./src/js/resume-hosted.mjs";
import { normalizeSectionReference } from "./src/js/slide-merge-section-component.mjs";
import { publicDeckPayload, setDeckVisibility } from "./src/js/slide-merge-visibility.mjs";
import { Miniflare } from "miniflare";
import { presenterMetadataRoute } from "./worker/presenter-metadata.mjs";
import { HYBRID_REST_PATH } from "./src/js/ai-ribbon-motion.mjs";

test("AI activity presents structured drafts without raw-code flicker and preserves details and cancellation", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = JSON.stringify({questions:[{q:'How would you validate the outcome?',why:'Separate observations from assumptions.'},{q:'What would you test next?',why:'Explore the next decision.'}],score:0,confirmed:false,title:'<img src=x onerror=alert(1)>'});
  try {
    await openIntegratedFixture(page);
    const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('[data-ai-session-toggle]').click();
    await page.evaluate(() => {
      const session = window.__rkAiSession, job = session.begin('analysis', 'Interview questions');
      window.__activityJob = job;
      session.route(job.id, {id:'display-fixture',agentRole:'draft',provider:'fixture',modelName:'Test model',status:'running'});
      session.activity(job.id,{id:'draft',summary:'Drafting questions from selected evidence.',status:'running'});
      session.output(job.id,'display-fixture','{"questions":[');
      session.recordUsage(1200,180,{sessionId:job.sessionId,jobId:job.id,callId:'display-fixture'});
    });
    const panel = page.locator('[data-ai-session-panel]');
    await panel.getByText('Receiving structured draft', {exact:false}).waitFor();
    assert.doesNotMatch(await panel.innerText(), /\{"questions"|Test model/);
    assert.equal(await panel.locator('pre').isVisible(), false);
    assert.equal(await panel.locator('[data-ai-jobstatus]').innerText(), 'Drafting');
    await page.evaluate(response => window.__rkAiSession.output(window.__activityJob.id,'display-fixture',response.slice('{"questions":['.length)),response);
    await panel.getByText('How would you validate the outcome?',{exact:true}).waitFor();
    assert.equal(await panel.locator('.adm__ai-readable dt').filter({hasText:/^Question$/}).count(),2);
    assert.equal(await panel.locator('.adm__ai-readable img').count(),0);
    assert.match(await panel.locator('.adm__ai-readable').innerText(), /Score\s+0\s+Confirmed\s+false/);
    assert.equal(await panel.locator('pre').isVisible(),false);
    for (const [width,theme,motion] of [[1440,'night','no-preference'],[1024,'day','reduce']]) {
      await page.setViewportSize({width,height:900});
      await page.emulateMedia({reducedMotion:motion});
      await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
      await page.evaluate(()=>document.fonts.ready);
      const bounds = await panel.evaluate(element => {
        const box=element.getBoundingClientRect();
        return {visible:box.width>0&&box.height>0,inside:box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight,overflow:element.scrollWidth>element.clientWidth,font:getComputedStyle(element.querySelector('.adm__ai-readable')).fontFamily};
      });
      assert.ok(bounds.visible&&bounds.inside&&!bounds.overflow,JSON.stringify(bounds));
      assert.doesNotMatch(bounds.font,/monospace/i);
      await page.screenshot({path:join(tmpdir(),'rk-ai-structured-'+width+'-'+theme+'.png')});
    }
    const disclosure=panel.locator('summary').filter({hasText:'Original response'});
    await disclosure.focus(); await page.keyboard.press('Enter');
    await panel.locator('pre').waitFor({state:'visible'});
    assert.equal(await panel.locator('pre').innerText(),response);
    await page.evaluate(()=>window.__rkAiSession.activity(window.__activityJob.id,{id:'review',summary:'Checking the draft against the source.',status:'running'}));
    await panel.locator('[data-ai-current]').filter({hasText:'Checking the draft against the source.'}).waitFor();
    assert.equal(await panel.locator('pre').isVisible(),true,'Stream updates retain the disclosure state');
    await disclosure.click();
    await panel.locator('[data-ai-request-details] summary').click();
    await panel.getByText('draft / Test model / running',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Stop AI request',exact:true}).click();
    await panel.getByText('Stopped',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__activityJob.signal.aborted),true);
    assert.equal(await panel.locator('[data-ai-output-state]').innerText(),'Partial');
    await page.evaluate(()=>window.__rkAiSession.output(window.__activityJob.id,'display-fixture','IGNORED LATE CHUNK'));
    assert.equal(await page.evaluate(()=>window.__rkAiSession.state().jobs[0].outputs[0].text),response);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),before);
    assert.doesNotMatch(await page.evaluate(()=>sessionStorage.getItem('rk:ai:admin-session')),/How would you|questions|onerror/);
    await page.evaluate(()=>{
      const session=window.__rkAiSession,job=session.begin('writing','Incomplete response');
      session.output(job.id,'broken','{"title":"Unfinished'); session.finish(job.id,'error','Connection ended before completion.');
    });
    await panel.getByText('Structured preview unavailable',{exact:false}).waitFor();
    await panel.getByRole('alert').filter({hasText:'Connection ended before completion.'}).waitFor();
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("AI activity discovers connected models and pins the next request without changing an active job", {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript(()=>{
      localStorage.setItem('rk:ai:img:provider','openai'); localStorage.setItem('rk:ai:img:key','synthetic-picker-key');
      const original=window.fetch; window.modelRequests=[]; window.modelDiscoveries=[];
      window.fetch=async(resource,options={})=>{
        const url=new URL(typeof resource==='string'?resource:resource.url,location.href);
        if(!['api.anthropic.com','api.openai.com'].includes(url.hostname))return original(resource,options);
        const provider=url.hostname==='api.anthropic.com'?'anthropic':'openai';
        if(url.pathname.endsWith('/models')){
          window.modelDiscoveries.push(provider);
          if(window.failModelDiscovery)return Response.json({error:'Unavailable'},{status:503});
          const ids=window.emptyModelDiscovery?[]:provider==='anthropic'?['service-choice-a','service-choice-b']:['service-choice-c'];
          return Response.json({data:ids.map(id=>({id,display_name:id+' live name',input_modalities:['text','image'],output_modalities:['text'],max_input_tokens:200000,max_tokens:48000,pricing:{input:1,output:3},capabilities:{structured_outputs:{supported:true}}}))});
        }
        const request=JSON.parse(options.body),system=request.system || request.messages[0].content;
        const coordinator=system.startsWith("You are Studio's outcome coordinator.");
        window.modelRequests.push({provider,model:request.model,coordinator});
        let text='Completed synthetic answer';
        if(coordinator){
          const input=JSON.parse(request.messages.at(-1).content);
          text=JSON.stringify({decision:input.candidate?{action:'finish'}:{action:'draft',modelRef:input.draftModels[0],task:'writing',instruction:'',inputs:[]}});
        }else if(window.holdModelDraft){await new Promise(resolve=>{window.releaseModelDraft=resolve;});}
        return Response.json(provider==='anthropic'?{content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5}}:{choices:[{message:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}});
      };
    });
    await openIntegratedFixture(page);
    const before=await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('[data-ai-session-toggle]').click();
    const panel=page.locator('[data-ai-session-panel]'),select=panel.getByLabel('Model for next request');
    await page.waitForFunction(()=>document.querySelectorAll('[data-ai-model] optgroup option').length===3);
    assert.equal(await select.inputValue(),'');
    assert.deepEqual(await select.locator('optgroup').evaluateAll(groups=>groups.map(group=>group.label)),['anthropic','openai']);
    assert.equal(await page.evaluate(()=>window.modelRequests.length),0,'Discovery must not generate content');
    const choose=async model=>select.selectOption({label:model+' live name'});
    await choose('service-choice-b');
    await page.getByRole('button',{name:'Close AI activity',exact:true}).click();
    await page.locator('[data-ai-session-toggle]').click();
    await page.waitForFunction(()=>document.querySelector('[data-ai-model-status]').textContent==='');
    assert.match(await select.inputValue(),/service-choice-b/);
    await page.evaluate(()=>{window.holdModelDraft=true;window.modelResult=null;window.__RKStudio.improveText('Original selected copy',{}).then(value=>{window.modelResult=value;},error=>{window.modelResult=error.message;});});
    await page.waitForFunction(()=>!!window.releaseModelDraft);
    await choose('service-choice-c');
    await page.evaluate(()=>{window.holdModelDraft=false;window.releaseModelDraft();});
    await page.waitForFunction(()=>window.modelResult!==null);
    assert.equal(await page.evaluate(()=>window.modelResult),'Completed synthetic answer');
    assert.ok(await page.evaluate(()=>window.modelRequests.every(request=>request.model==='service-choice-b')),'A picker change cannot switch the running job or review');
    await page.evaluate(()=>{window.modelRequests=[];window.modelResult=null;window.__RKStudio.improveText('Another selected copy',{}).then(value=>{window.modelResult=value;},error=>{window.modelResult=error.message;});});
    await page.waitForFunction(()=>window.modelResult!==null);
    assert.equal(await page.evaluate(()=>window.modelResult),'Completed synthetic answer');
    assert.ok(await page.evaluate(()=>window.modelRequests.length===3&&window.modelRequests.every(request=>request.model==='service-choice-c'&&request.provider==='openai')));
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:ai:txt:provider')),'anthropic','Manual selection does not rewrite API-key settings');
    await page.evaluate(()=>{window.failModelDiscovery=true;});
    await page.getByRole('button',{name:'Refresh models',exact:true}).click();
    await panel.locator('[data-ai-model-status]').filter({hasText:'HTTP 503'}).waitFor();
    assert.match(await select.inputValue(),/service-choice-c/);
    assert.match(await select.locator('option:checked').textContent(),/Unavailable/);
    await page.evaluate(()=>{window.failModelDiscovery=false;window.emptyModelDiscovery=true;});
    await page.getByRole('button',{name:'Refresh models',exact:true}).click();
    await panel.locator('[data-ai-model-status]').filter({hasText:'Selected model unavailable'}).waitFor();
    await page.evaluate(()=>{window.modelRequests=[];window.modelResult=null;window.__RKStudio.improveText('No fallback',{}).then(value=>{window.modelResult=value;},error=>{window.modelResult=error.message;});});
    await page.waitForFunction(()=>window.modelResult!==null);
    assert.match(await page.evaluate(()=>window.modelResult),/selected model is unavailable/);
    assert.equal(await page.evaluate(()=>window.modelRequests.length),0);
    await select.selectOption('');
    await page.evaluate(()=>{window.emptyModelDiscovery=false;});
    await page.getByRole('button',{name:'Refresh models',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-ai-model] optgroup option').length===3);
    await page.evaluate(()=>{window.modelRequests=[];window.modelResult=null;window.__RKStudio.improveText('Auto request',{}).then(value=>{window.modelResult=value;},error=>{window.modelResult=error.message;});});
    await page.waitForFunction(()=>window.modelResult!==null);
    assert.equal(await page.evaluate(()=>window.modelResult),'Completed synthetic answer');
    assert.ok(await page.evaluate(()=>window.modelRequests.length===3&&window.modelRequests.every(request=>request.provider==='anthropic')),'Auto retains the configured routing policy');
    for(const width of [1440,1024]){
      await page.setViewportSize({width,height:900});
      assert.ok(await select.evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.width>0&&bounds.right<=innerWidth&&bounds.left>=0;}));
      await page.screenshot({path:join(tmpdir(),'rk-ai-model-picker-'+width+'.png')});
    }
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),before);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

async function openProjectSlides(page, index = 0) {
  await page.locator('[data-act="study-toggle"][data-index="' + index + '"]').click();
  const tab = page.locator('[data-l2tab="slides"]');
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
}

async function assertCoverSitePalette(page) {
  const result = await page.evaluate(async () => {
    const styles = getComputedStyle(document.querySelector('.merge-shell'));
    let elements = window.__slideMerge?.api.getSceneElements();
    if (!elements) {
      const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('rk-studio-slide-decks-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        const saved = await new Promise((resolve, reject) => { const request = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]); request.onsuccess = () => resolve(request.result.document); request.onerror = () => reject(request.error); });
        elements = saved.slides[0].scene.elements;
      } finally { database.close(); }
    }
    const cover = elements.find(element => element.id === 'lab-slide').customData.slideSettings.cover;
    const tokens = { background: '--bg', rail: '--bg-2', panel: '--bg-elev', text: '--text', muted: '--text-dim' };
    const expected = Object.fromEntries(Object.entries(tokens).map(([key, token]) => [key, styles.getPropertyValue(token).trim().toLowerCase()]));
    const actual = Object.fromEntries(Object.keys(tokens).map(key => [key, cover[key].toLowerCase()]));
    const painted = Object.fromEntries([['background', 'background'], ['rail', 'rail'], ['panel', 'media-panel'], ['text', 'title']].map(([key, role]) => {
      const element = elements.find(element => element.customData?.slideCover === role);
      return [key, (element.type === 'text' ? element.strokeColor : element.backgroundColor).toLowerCase()];
    }));
    return { expected, actual, painted };
  });
  assert.deepEqual(result.actual, result.expected, 'Cover snapshots the active site tokens');
  for (const [key, color] of Object.entries(result.painted)) assert.equal(color, result.expected[key], 'Native ' + key + ' uses the token');
  return result.actual;
}

async function assertCoverPixel(page, position, expected) {
  await page.waitForFunction(({ position, expected }) => {
    const state = window.__slideMerge.api.getAppState(), canvas = document.querySelector('.excalidraw__canvas.static'), box = canvas.getBoundingClientRect();
    const positionX = (position[0] + state.scrollX) * state.zoom.value * canvas.width / box.width;
    const positionY = (position[1] + state.scrollY) * state.zoom.value * canvas.height / box.height;
    const pixel = [...canvas.getContext('2d').getImageData(Math.floor(positionX), Math.floor(positionY), 1, 1).data].slice(0, 3);
    return pixel.every((channel, index) => channel === expected[index]);
  }, { position, expected });
}

test("native text case preserves source editing history mixed selection small caps and exports", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      if (!localStorage.getItem('rk:theme')) localStorage.setItem('rk:theme', 'day');
      window.casePaint = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (/mixed/i.test(String(text))) window.casePaint.push({ text, font: this.font });
        return fillText.call(this, text, ...args);
      };
      window.caseResizeEvents = [];
      window.addEventListener('pointerdown', event => {
        if (!event.target.matches?.('.excalidraw__canvas.interactive')) return;
        const state = window.__slideMerge?.api.getAppState();
        if (!state) return;
        window.caseResizeEvents.push({
          x: event.clientX, y: event.clientY, cursor: getComputedStyle(event.target).cursor,
          canvas: event.target.getBoundingClientRect().toJSON(), offsetLeft: state.offsetLeft, offsetTop: state.offsetTop,
          scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, selection: state.selectedElementIds
        });
      }, true);
    });
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5510') + '/studio/slide-merge-lab/');
    const ready = () => waitForSlideEditor(page);
    await ready();
    await page.evaluate(async () => {
      const api = window.__slideMerge.api, original = api.getSceneElements(), template = original.find(element => element.type === 'text');
      const text = 'Mixed words\nnext Line';
      const first = { ...template, id: 'case-first', x: 60, y: 80, width: 300, height: 70, fontSize: 28, autoResize: false, containerId: null, groupIds: [], boundElements: [], locked: false, text, originalText: text, customData: { fixture: 'retained' } };
      const second = { ...first, id: 'case-second', x: 650, autoResize: true };
      const locked = { ...second, id: 'case-locked', y: 300, locked: true };
      api.updateScene({ elements: [original.find(element => element.id === 'lab-slide'), first, second, locked], appState: { selectedElementIds: { 'case-first': true } }, captureUpdate: 'IMMEDIATELY' });
      await window.__slideMerge.save();
    });
    const controls = page.getByRole('group', { name: 'Text case', exact: true });
    const button = name => controls.getByRole('button', { name, exact: true });
    const read = () => page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'case-first'));
    const before = await read();
    const others = await page.evaluate(() => window.__slideMerge.api.getSceneElements().filter(element => element.id !== 'case-first'));
    for (const [name, mode, text] of [['All caps', 'upper', 'MIXED WORDS\nNEXT LINE'], ['Lowercase', 'lower', 'mixed words\nnext line'], ['Title case', 'title', 'Mixed Words\nNext Line'], ['Small caps', 'small-caps', before.originalText], ['As typed', 'typed', before.originalText]]) {
      await button(name).click();
      const actual = await read();
      assert.equal(actual.text, text);
      assert.equal(actual.originalText, before.originalText);
      assert.equal(actual.customData.textFormat.case, mode);
      assert.equal(actual.customData.fixture, 'retained');
      assert.equal(await button(name).getAttribute('aria-pressed'), 'true');
      assert.ok(Number.isFinite(actual.height) && actual.height > 0);
    }
    assert.deepEqual(await page.evaluate(() => window.__slideMerge.api.getSceneElements().filter(element => element.id !== 'case-first')), others);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'case-first').customData.textFormat.case === 'small-caps');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'case-first').customData.textFormat.case === 'typed');
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'case-first': true, 'case-second': true, 'case-locked': true } } }));
    await button('All caps').click();
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'case-first': true } } }));
    await button('Lowercase').click();
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'case-first': true, 'case-second': true } } }));
    await page.waitForFunction(() => { const api = window.__slideMerge.api, selected = api.getAppState().selectedElementIds; return !!selected['case-first'] && !!selected['case-second'] && document.querySelectorAll('.lab-text-case [aria-pressed="true"]').length === 0; });
    assert.equal(await controls.locator('[aria-pressed="true"]').count(), 0, 'Mixed modes do not report a false selection');
    await button('Small caps').click();
    const mixed = await page.evaluate(() => window.__slideMerge.api.getSceneElements());
    assert.equal(mixed.find(element => element.id === 'case-locked').customData.textFormat, undefined);
    assert.equal(mixed.find(element => element.id === 'case-second').customData.textFormat.case, 'small-caps');
    await page.waitForFunction(() => window.casePaint.some(entry => entry.font.includes('small-caps')));
    const caps = await page.evaluate(() => {
      const context = document.createElement('canvas').getContext('2d');
      context.font = window.casePaint.find(entry => entry.font.includes('small-caps')).font;
      return { lower: context.measureText('ggg').actualBoundingBoxAscent, upper: context.measureText('GGG').actualBoundingBoxAscent };
    });
    assert.ok(caps.lower > 0 && caps.lower < caps.upper, 'Small caps use smaller uppercase glyphs, not ordinary uppercase');
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'case-first': true } } }));
    await button('All caps').click();
    const resize = await page.evaluate(() => {
      const api = window.__slideMerge.api, state = api.getAppState(), text = api.getSceneElements().find(element => element.id === 'case-first');
      // The native side-resize band is centered 4 CSS pixels outside the element's strict inner boundary.
      return {
        x: state.offsetLeft + (text.x + text.width + state.scrollX) * state.zoom.value + 4,
        y: state.offsetTop + (text.y + text.height / 2 + state.scrollY) * state.zoom.value,
        delta: 40 * state.zoom.value, width: text.width, elementX: text.x, elementY: text.y, fontSize: text.fontSize
      };
    });
    await page.mouse.move(resize.x, resize.y);
    await page.mouse.down();
    await page.mouse.move(resize.x - resize.delta, resize.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(width => window.__slideMerge.api.getSceneElements().find(element => element.id === 'case-first').width < width - 20, resize.width).catch(async error => {
      await page.screenshot({ path: join(tmpdir(), 'rk-native-text-case-resize-failure.png') });
      const after = await read(), resizeTarget = await page.evaluate(() => window.caseResizeEvents);
      throw new Error(`Native text resize failed: ${JSON.stringify({ resize, resizeTarget, after: { x: after.x, y: after.y, width: after.width, height: after.height, angle: after.angle } })}`, { cause: error });
    });
    assert.equal(await page.evaluate(() => window.caseResizeEvents.at(-1)?.cursor), 'ew-resize', 'The real drag starts on the horizontal resize band');
    const resized = await read();
    assert.equal(resized.x, resize.elementX, 'Width resize does not move the text');
    assert.equal(resized.y, resize.elementY);
    assert.equal(resized.fontSize, resize.fontSize, 'Width resize does not scale the font');
    assert.equal((await read()).text, 'MIXED WORDS\nNEXT LINE', 'Native width resize retains display casing');
    assert.equal((await read()).originalText, before.originalText);
    const point = await page.evaluate(() => { const api = window.__slideMerge.api, state = api.getAppState(), text = api.getSceneElements().find(element => element.id === 'case-first'), box = document.querySelector('.lab-canvas').getBoundingClientRect(); return { x: box.left + (text.x + 60 + state.scrollX) * state.zoom.value, y: box.top + (text.y + 15 + state.scrollY) * state.zoom.value }; });
    await page.mouse.dblclick(point.x, point.y);
    const editable = page.locator('.excalidraw-wysiwyg');
    await editable.waitFor();
    assert.equal(await editable.inputValue(), before.originalText);
    assert.equal(await editable.evaluate(element => getComputedStyle(element).textTransform), 'uppercase');
    await editable.fill('Mixed edited\nkeep This');
    await page.keyboard.press('Escape');
    assert.equal((await read()).originalText, 'Mixed edited\nkeep This');
    assert.equal((await read()).text, 'MIXED EDITED\nKEEP THIS');
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'case-first': true } } }));
    await button('As typed').click();
    assert.equal((await read()).text, 'Mixed edited\nkeep This');
    await button('Small caps').click();
    await page.locator('.lab-text-format').getByRole('button', { name: 'Bold', exact: true }).click();
    assert.equal((await read()).customData.textFormat.case, 'small-caps');
    await page.evaluate(() => window.__slideMerge.save());
    await page.reload();
    await ready();
    assert.equal((await read()).originalText, 'Mixed edited\nkeep This');
    assert.equal((await read()).customData.textFormat.case, 'small-caps');
    await page.waitForFunction(() => [...document.querySelectorAll('.merge-slide-card.is-active svg text')].some(text => text.textContent.includes('Mixed edited') && text.getAttribute('font-variant') === 'small-caps' && text.getAttribute('font-weight') === 'bold'));
    for (const appearance of ['day', 'night']) {
      if (appearance === 'night') { await page.evaluate(() => localStorage.setItem('rk:theme', 'night')); await page.reload(); await ready(); }
      await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'case-first': true } } }));
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width === 390) await page.getByRole('button', { name: 'Open properties', exact: true }).click();
        await button('Small caps').scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        const bounds = await controls.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, buttons: [...element.querySelectorAll('button')].map(button => ({ title: button.title, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) }));
        assert.equal(bounds.buttons.length, 5);
        assert.ok(bounds.scroll <= bounds.width + 1);
        assert.ok(bounds.buttons.every(button => button.width >= 28 && button.height >= 28 && button.title));
        assert.equal(await button('Small caps').getAttribute('aria-pressed'), 'true');
        await button('Title case').focus();
        await page.keyboard.press('Enter');
        assert.equal((await read()).text, 'Mixed Edited\nKeep This');
        await button('Small caps').click();
        await page.screenshot({ path: join(tmpdir(), `rk-slide-case-${appearance}-${width}.png`) });
        if (width === 390) await page.getByRole('button', { name: 'Close panel', exact: true }).click();
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("native text styles bullets and indents retain editing history exports and mobile controls", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      if (!localStorage.getItem('rk:theme')) localStorage.setItem('rk:theme', 'day');
      window.formatFonts = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (String(text).includes('Formatting example')) window.formatFonts.push(this.font);
        return fillText.call(this, text, ...args);
      };
    });
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5510') + '/studio/slide-merge-lab/');
    await waitForSlideEditor(page);
    await page.evaluate(async () => {
      const api = window.__slideMerge.api, original = api.getSceneElements(), text = original.find(element => element.type === 'text');
      const first = { ...text, id: 'format-first', x: 60, y: 80, width: 450, height: 70, fontSize: 28, autoResize: false, containerId: null, groupIds: [], boundElements: [], locked: false, text: 'Formatting example\nSecond paragraph', originalText: 'Formatting example\nSecond paragraph', customData: { fixture: 'preserve' } };
      const second = { ...first, id: 'format-second', x: 650, originalText: 'Other text', text: 'Other text' };
      const locked = { ...second, id: 'format-locked', y: 300, locked: true };
      api.updateScene({ elements: [original.find(element => element.id === 'lab-slide'), first, second, locked], appState: { selectedElementIds: { 'format-first': true } }, captureUpdate: 'IMMEDIATELY' });
      await window.__slideMerge.save();
    });
    const controls = page.locator('.lab-text-format');
    const button = name => controls.getByRole('button', { name, exact: true });
    const readText = () => page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-first'));
    await button('Bold').waitFor();
    assert.equal(await button('Bullet style').count(), 0);
    const before = await readText();
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
      await button(name).click();
      assert.equal(await button(name).getAttribute('aria-pressed'), 'true');
    }
    await page.waitForFunction(() => window.formatFonts.some(font => font.includes('italic') && font.includes('bold')));
    assert.deepEqual((await readText()).customData.textFormat, { bold: true, italic: true, underline: true, strikethrough: true });
    assert.equal((await readText()).customData.fixture, 'preserve');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => !window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-first').customData.textFormat.strikethrough);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-first').customData.textFormat.strikethrough);
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'format-first': true } } }));
    await button('Bullets').click();
    assert.equal((await readText()).originalText, '\u2022 Formatting example\n\u2022 Second paragraph');
    const markers = [['Number', '1.', '2.'], ['Alphabet', 'a.', 'b.'], ['Dash', '-', '-'], ['Dot', '\u2022', '\u2022']];
    let previousStyle = 'Dot';
    for (const [style, first, second] of markers) {
      await button('Bullet style').click();
      const menu = page.getByRole('menu', { name: 'Bullet styles' });
      assert.equal(await menu.getByRole('menuitemradio', { name: previousStyle, exact: true }).getAttribute('aria-checked'), 'true');
      await menu.getByRole('menuitemradio', { name: style, exact: true }).click();
      assert.equal((await readText()).originalText, `${first} Formatting example\n${second} Second paragraph`);
      assert.equal(await button('Bullets').getAttribute('aria-pressed'), 'true');
      previousStyle = style;
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-first').originalText.startsWith('- '));
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-first').originalText.startsWith('\u2022 '));
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'format-first': true } } }));
    await button('Increase indent').click();
    assert.equal((await readText()).originalText, '  \u2022 Formatting example\n  \u2022 Second paragraph');
    assert.ok((await readText()).text.startsWith('  \u2022 Formatting example'));
    await button('Decrease indent').click();
    await button('Bullets').click();
    assert.equal((await readText()).originalText, before.originalText);
    assert.equal(await button('Bullet style').count(), 0);
    assert.equal(await button('Decrease indent').isDisabled(), true);
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'format-first': true, 'format-second': true, 'format-locked': true } } }));
    assert.equal(await button('Bold').getAttribute('aria-pressed'), 'mixed');
    await button('Bold').click();
    assert.equal(await button('Bold').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-locked').customData.textFormat), undefined);
    await button('Bullets').click();
    await button('Bullet style').click();
    await page.getByRole('menuitemradio', { name: 'Alphabet', exact: true }).click();
    assert.ok((await readText()).originalText.startsWith('a. '));
    await page.evaluate(async () => { await window.__slideMerge.save(); });
    const saved = await readText();
    await page.reload();
    await waitForSlideEditor(page);
    assert.deepEqual((await readText()).customData, saved.customData);
    assert.equal((await readText()).originalText, saved.originalText);
    assert.ok(Number.isFinite((await readText()).height) && (await readText()).height > 0);
    await page.waitForFunction(() => [...document.querySelectorAll('.merge-slide-card.is-active svg text')].some(text => text.textContent.includes('Formatting example') && text.getAttribute('font-weight') === 'bold' && text.getAttribute('font-style') === 'italic' && text.getAttribute('text-decoration') === 'underline line-through'));
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'format-first': true } } }));
    const point = await page.evaluate(() => { const api = window.__slideMerge.api, state = api.getAppState(), text = api.getSceneElements().find(element => element.id === 'format-first'), box = document.querySelector('.lab-canvas').getBoundingClientRect(); return { x: box.left + (text.x + 60 + state.scrollX) * state.zoom.value, y: box.top + (text.y + 15 + state.scrollY) * state.zoom.value }; });
    await page.mouse.dblclick(point.x, point.y);
    const editable = page.locator('.excalidraw-wysiwyg');
    await editable.waitFor();
    const editingStyle = await editable.evaluate(element => { const style = getComputedStyle(element); return { weight: style.fontWeight, style: style.fontStyle, decoration: style.textDecorationLine }; });
    assert.deepEqual(editingStyle, { weight: '700', style: 'italic', decoration: 'underline line-through' });
    await editable.fill('\u2022 Formatting example edited\n\u2022 Second paragraph');
    await button('Bullet style').click();
    await page.getByRole('menuitemradio', { name: 'Number', exact: true }).click();
    assert.equal((await readText()).originalText, '1. Formatting example edited\n2. Second paragraph');
    await button('Bullets').click();
    assert.equal((await readText()).originalText, 'Formatting example edited\nSecond paragraph');
    if (await editable.count()) assert.equal(await editable.inputValue(), 'Formatting example edited\nSecond paragraph');
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { await window.__slideMerge.save(); window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'format-first': true } } }); });
    for (const appearance of ['day', 'night']) {
      if (appearance === 'night') {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => localStorage.setItem('rk:theme', 'night'));
        await page.reload();
        await waitForSlideEditor(page);
        await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { 'format-first': true } } }));
      }
      await page.evaluate(() => document.fonts.ready);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        if (width === 390) await page.getByRole('button', { name: 'Open properties', exact: true }).click();
        await button('Bold').scrollIntoViewIfNeeded();
        assert.equal(await button('Bold').getAttribute('aria-pressed'), 'true');
        if (await button('Bullets').getAttribute('aria-pressed') !== 'true') await button('Bullets').click();
        const triggerBox = await button('Bullet style').boundingBox(), indentBox = await button('Increase indent').boundingBox();
        assert.ok(triggerBox.x > indentBox.x + indentBox.width, 'Style picker is the rightmost list control');
        const separators = await page.evaluate(() => {
          const native = document.querySelector('[data-testid="font-family-show-fonts"]').closest('.FontPicker__container').querySelector(':scope > div[style]');
          return [native, ...document.querySelectorAll('.lab-font-size .button-separator, .lab-text-format .button-separator')].map(element => {
            const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
            return { width: bounds.width, height: bounds.height, background: style.backgroundColor, margin: style.margin, opacity: style.opacity };
          });
        });
        assert.equal(separators.length, 3);
        assert.equal(separators[0].width, 1);
        assert.ok(separators[0].height > 0);
        assert.notEqual(separators[0].background, 'rgba(0, 0, 0, 0)');
        assert.deepEqual(separators[1], separators[0], 'Font-size divider matches native font family');
        assert.deepEqual(separators[2], separators[0], 'List divider matches native font family');
        for (const fieldset of await controls.all()) {
          const bounds = await fieldset.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, children: [...element.querySelectorAll('button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) }));
          assert.ok(bounds.scrollWidth <= bounds.width + 1);
          assert.ok(bounds.children.every(button => button.width >= 28 && button.height >= 28));
        }
        await page.screenshot({ path: join(tmpdir(), `rk-slide-text-format-${appearance}-${width}.png`) });
        await button('Bullet style').click();
        const popup = page.locator('.lab-bullet-picker');
        const popupBounds = await popup.boundingBox();
        assert.ok(popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= width + 1);
        assert.ok(popupBounds.y >= 0 && popupBounds.y + popupBounds.height <= page.viewportSize().height + 1);
        assert.equal(await page.getByRole('menu', { name: 'Bullet styles' }).getByRole('menuitemradio').count(), 4);
        await page.screenshot({ path: join(tmpdir(), `rk-slide-bullet-picker-${appearance}-${width}.png`) });
        await page.getByRole('menuitemradio', { name: 'Dot', exact: true }).focus();
        await page.keyboard.press('End');
        assert.equal(await page.getByRole('menuitemradio', { name: 'Dash', exact: true }).evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Home');
        assert.equal(await page.getByRole('menuitemradio', { name: 'Dot', exact: true }).evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Escape');
        await popup.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Bullet style');
        assert.equal(await button('Bullet style').evaluate(element => element === document.activeElement), true);
        if (width === 390) assert.equal(await page.locator('.merge-sheet-head').isVisible(), true, 'Escape closes the picker without dismissing properties');
        await page.evaluate(() => window.__slideMerge.save());
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("native bound text formatting preserves container geometry history and readonly presentation", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true });
      navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      window.audienceTextFonts = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (document.querySelector('.pjp') && String(text).includes('useful')) window.audienceTextFonts.push(this.font);
        return fillText.call(this, text, ...args);
      };
    });
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5510') + '/studio/slide-merge-lab/');
    await waitForSlideEditor(page);
    await page.evaluate(async () => {
      const api = window.__slideMerge.api, original = api.getSceneElements(), template = original.find(element => element.type === 'text');
      const shape = { ...template, type: 'rectangle', id: 'format-shape', x: 80, y: 160, width: 280, height: 180, locked: false, boundElements: [{ id: 'format-label', type: 'text' }], customData: { fixture: 'container' } };
      const text = 'A useful next action with a clear outcome';
      const label = { ...template, id: 'format-label', x: 85, y: 165, width: 260, height: 140, fontSize: 28, text, originalText: text, autoResize: true, containerId: shape.id, boundElements: [], locked: false, customData: {} };
      api.updateScene({ elements: [original.find(element => element.id === 'lab-slide'), shape, label], appState: { selectedElementIds: { [shape.id]: true } }, captureUpdate: 'IMMEDIATELY' });
      await window.__slideMerge.save();
    });
    const controls = page.locator('.lab-text-format');
    await controls.getByRole('button', { name: 'All caps', exact: true }).click();
    const capitalLabel = await page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-label'));
    assert.equal(capitalLabel.text, capitalLabel.text.toUpperCase());
    assert.equal(capitalLabel.originalText, 'A useful next action with a clear outcome');
    await controls.getByRole('button', { name: 'Small caps', exact: true }).click();
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) await controls.getByRole('button', { name, exact: true }).click();
    const rendered = await page.evaluate(() => {
      const elements = window.__slideMerge.api.getSceneElements(), label = elements.find(element => element.id === 'format-label'), shape = elements.find(element => element.id === 'format-shape');
      return { label, shape };
    });
    assert.ok(Number.isFinite(rendered.label.height) && rendered.label.height > 0);
    assert.ok(rendered.label.width <= rendered.shape.width);
    assert.ok(rendered.label.y >= rendered.shape.y && rendered.label.y + rendered.label.height <= rendered.shape.y + rendered.shape.height);
    assert.equal(rendered.shape.customData.textFormat, undefined);
    assert.equal(rendered.label.customData.textFormat.bold, true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => !window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-label').customData.textFormat.strikethrough);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'format-label').customData.textFormat.strikethrough);
    await page.evaluate(() => window.__slideMerge.save());
    const waiting = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Slide Show', exact: true }).click();
    const pad = await waiting;
    await page.waitForFunction(() => window.audienceTextFonts.some(font => font.includes('bold') && font.includes('italic') && font.includes('small-caps')));
    const pixels = await page.locator('.pjp .excalidraw__canvas.static').evaluate(canvas => { const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; const colors = new Set(); for (let index = 0; index < bytes.length; index += 4) if (bytes[index + 3]) colors.add(`${bytes[index]},${bytes[index + 1]},${bytes[index + 2]}`); return colors.size; });
    assert.ok(pixels > 10, 'Audience renders actual antialiased native content');
    await page.screenshot({ path: join(tmpdir(), 'rk-slide-text-format-audience.png') });
    assert.equal(await page.locator('.pjp .lab-text-format').count(), 0);
    await pad.getByRole('button', { name: 'End presentation', exact: true }).click();
    await page.waitForSelector('.pjp', { state: 'detached' });
  } finally { await browser.close(); }
});

test("cover theme follows editor audience and public previews without changing saved colours", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem('rk:theme', 'night'));
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5510') + '/studio/slide-merge-lab/');
    await waitForSlideEditor(page);
    await page.locator('summary[aria-label="Add a slide"]').click();
    await page.getByRole('button', { name: 'Add cover', exact: true }).click();
    await page.getByLabel('Cover title', { exact: true }).waitFor();
    await page.evaluate(async () => {
      const api = window.__slideMerge.api;
      api.updateScene({ elements: api.getSceneElements().map(element => element.customData?.slideCover === 'rail' ? { ...element, backgroundColor: '#123456', version: element.version + 1 } : element) });
      await window.__slideMerge.save();
    });
    const saved = await page.evaluate(() => window.__slideMerge.deck());
    const artwork = deck => ({ ...deck, slides: deck.slides.map(slide => {
      const { scrollX, scrollY, zoom, ...appState } = slide.scene.appState;
      return { ...slide, scene: { ...slide.scene, appState } };
    }) });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [mode, channels] of [['day', [242, 238, 230]], ['night', [8, 8, 10]]]) {
        await page.evaluate(mode => window.__theme.set(mode), mode);
        await assertCoverPixel(page, [400, 660], channels);
        await assertCoverPixel(page, [60, 500], [18, 52, 86]);
        await page.screenshot({ path: join(tmpdir(), `rk-cover-theme-${mode}-${width}.png`) });
        assert.deepEqual(artwork(await page.evaluate(() => window.__slideMerge.deck())), artwork(saved), 'Theme switching preserves all artwork; responsive camera fitting is excluded');
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const authored = saved.slides.find(slide => slide.id === saved.selected);
    const published = publicDeckPayload(setDeckVisibility({ ...saved, slides: [authored] }, 'public'), { reviewedSources: true, production: true });
    assert.equal(published.slides[0].scene.elements.find(element => element.id === 'lab-slide').customData.slideSettings.cover, undefined);
    for (const legacy of [false, true]) {
      const document = structuredClone(published);
      if (legacy) for (const element of document.slides[0].scene.elements) if (element.customData) delete element.customData.slideCover;
      document.slides.push({ ...structuredClone(document.slides[0]), id: 'theme-next-preview' });
      await page.evaluate(async document => {
        const { presentNativeDocument } = await import('/studio/slide-lab/assets/audience.js');
        window.coverPlayer = await presentNativeDocument({}, document, { audienceOnly: true, autoStart: true });
      }, document);
      await page.locator('.pjp .excalidraw__canvas.static').waitFor();
      for (const [mode, channels] of [['day', [242, 238, 230]], ['night', [8, 8, 10]]]) {
        await page.evaluate(mode => window.__theme.set(mode), mode);
        await page.waitForFunction(channels => {
          const canvas = document.querySelector('.pjp .excalidraw__canvas.static');
          const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width * 400 / 1280), Math.floor(canvas.height * 660 / 720), 1, 1).data;
          return channels.every((channel, index) => channel === pixel[index]);
        }, channels);
        await page.waitForFunction(color => document.querySelector('[data-pjp-nextthumb] svg')?.outerHTML.includes(color), mode === 'day' ? '#f2eee6' : '#08080a');
        const html = await page.locator('[data-pjp-nextthumb]').innerHTML();
        assert.ok(html.includes(mode === 'day' ? '#f2eee6' : '#08080a'));
        assert.ok(html.includes('#123456'));
        await page.screenshot({ path: join(tmpdir(), `rk-cover-audience-${legacy ? 'legacy' : 'current'}-${mode}.png`) });
      }
      await page.evaluate(() => window.coverPlayer.close());
      await page.locator('.pjp').waitFor({ state: 'detached' });
    }
    await page.evaluate(() => window.__slideMerge.save());
    assert.deepEqual(await page.evaluate(() => window.__slideMerge.deck().slides.find(slide => slide.id === window.__slideMerge.deck().selected).scene.elements), authored.scene.elements);
    await page.reload();
    await page.getByLabel('Cover title', { exact: true }).waitFor();
    await page.evaluate(() => window.__theme.set('day'));
    await assertCoverPixel(page, [400, 660], [242, 238, 230]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("fixed cover edits from the right panel preserve media, other slides and history", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem('rk:theme', 'day'));
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5541') + '/studio/slide-merge-lab/');
    await waitForSlideEditor(page);
    const before = await page.evaluate(async () => { await window.__slideMerge.save(); return window.__slideMerge.deck(); });
    await page.locator('summary[aria-label="Add a slide"]').click();
    await page.getByRole('button', { name: 'Add cover', exact: true }).click();
    const title = page.getByLabel('Cover title', { exact: true });
    await title.waitFor();
    const slides = page.getByRole('complementary', { name: 'Slides', exact: true });
    const assertPanels = async target => {
      const rail = await slides.boundingBox(), workspace = await page.locator('.merge-editor').boundingBox(), panel = await target.boundingBox();
      assert.ok(rail.x < workspace.x && rail.x + rail.width <= workspace.x + 1, 'Slides stay to the left of the canvas');
      assert.ok(panel.x >= workspace.x + workspace.width - 1 && panel.x + panel.width <= page.viewportSize().width + 1, 'Editing and insert controls stay in the right panel');
      assert.ok(panel.height > workspace.height - 60, 'Editing controls use a full-height panel, not a floating dock');
      assert.equal(await page.locator('.merge-slide-list').isVisible(), true, 'Insert tools do not replace slide navigation');
      assert.ok(await target.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Panel content fits its width');
    };
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForFunction(() => Math.abs(document.querySelector('.merge-slide-properties').getBoundingClientRect().right - innerWidth) < 1);
      await assertPanels(page.getByRole('complementary', { name: 'Slide properties', exact: true }));
      await page.evaluate(() => window.__slideMerge.api.setActiveTool({ type: 'rectangle' }));
      await page.locator('.selected-shape-actions .App-menu__left').waitFor({ state: 'visible' });
      await assertPanels(page.locator('.selected-shape-actions .App-menu__left'));
      await page.screenshot({ path: join(tmpdir(), `rk-right-object-panel-${width}.png`) });
      await page.evaluate(() => window.__slideMerge.api.setActiveTool({ type: 'selection' }));
    }
    for (const label of ['Icons', 'Text', 'Badges', 'Sections', 'Open library']) {
      await page.locator('.merge-canvas-tools').getByRole('button', { name: label, exact: true }).click();
      await page.locator('.sidebar').waitFor({ state: 'visible' });
      await assertPanels(page.locator('.sidebar'));
      assert.equal(await title.isVisible(), false, 'Insert views replace properties only');
      await page.locator('.merge-inspector').getByRole('button', { name: 'Close panel', exact: true }).click();
      await title.waitFor({ state: 'visible' });
    }
    for (const tab of ['media', 'layout', 'source', 'layers', 'draft']) {
      await page.evaluate(tab => window.__slideMerge.api.updateScene({ appState: { openSidebar: { name: 'insert', tab } } }), tab);
      await page.locator('.sidebar').waitFor({ state: 'visible' });
      await assertPanels(page.locator('.sidebar'));
      await page.locator('.merge-inspector').getByRole('button', { name: 'Close panel', exact: true }).click();
      await title.waitFor({ state: 'visible' });
    }
    const resizer = page.getByRole('separator', { name: 'Resize slide navigation', exact: true });
    const initialWidth = Number(await resizer.getAttribute('aria-valuenow'));
    await resizer.press('ArrowRight');
    assert.equal(Number(await resizer.getAttribute('aria-valuenow')), initialWidth + 16);
    await resizer.press('ArrowLeft');
    assert.equal(Number(await resizer.getAttribute('aria-valuenow')), initialWidth);
    const initialPalette = await assertCoverSitePalette(page);
    await assertCoverPixel(page, [400, 660], [242, 238, 230]);
    await title.fill('Reinventing Edge Onboarding Journey');
    await page.getByLabel('Cover client', { exact: true }).fill('Microsoft AI');
    assert.equal(await page.getByLabel('Cover brand initials', { exact: true }).count(), 0);
    const logoData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
      const context = canvas.getContext('2d'); context.fillStyle = '#d8a657'; context.fillRect(0, 0, 240, 120);
      return canvas.toDataURL('image/png');
    });
    await page.getByRole('button', { name: 'Upload brand logo', exact: true }).click();
    await page.locator('.merge-shell > input[type="file"]').setInputFiles({ name: 'brand-original.png', mimeType: 'image/png', buffer: Buffer.from(logoData.split(',')[1], 'base64') });
    await page.getByRole('button', { name: 'Replace brand logo', exact: true }).waitFor();
    await assertCoverPixel(page, [68, 58], [216, 166, 87]);
    await page.getByLabel('Cover status', { exact: true }).fill('In development');
    await page.getByLabel('Cover duration', { exact: true }).fill('2025 - Current');
    const team = page.getByLabel('Cover team', { exact: true });
    const teammates = ['1 designer', '1 product manager', '3 engineers', '1 contenet designer', 'Data Science', 'Privacy'];
    await team.fill(teammates.join(', '));
    assert.equal(await team.getAttribute('aria-invalid'), 'false');
    assert.equal(await team.evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
    assert.ok(await team.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    const chips = await page.evaluate(() => window.__slideMerge.api.getSceneElements().filter(element => /^team-(?:box-)?\d+$/.test(element.customData?.slideCover || '')).map(element => ({ type: element.type, text: element.text })));
    assert.deepEqual(chips.filter(element => element.type === 'text').map(element => element.text), teammates);
    assert.equal(chips.filter(element => element.type === 'rectangle').length, teammates.length);
    await page.getByLabel('Cover role description', { exact: true }).fill('Led onboarding vision, growth strategy, concept development, executive storytelling, product alignment, and final UX design');
    await page.getByLabel('Cover footnote', { exact: true }).fill('First Run Experience targeted for user activation, personalization, and retention on new Windows devices');
    const imageData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      const context = canvas.getContext('2d'); context.fillStyle = '#bdeaf4'; context.fillRect(0, 0, 1600, 900);
      context.fillStyle = '#1678a0'; context.fillRect(600, 250, 400, 400);
      return canvas.toDataURL('image/png');
    });
    await page.getByRole('button', { name: 'Upload hero image', exact: true }).click();
    await page.locator('.merge-shell > input[type="file"]').setInputFiles({ name: 'cover-original.png', mimeType: 'image/png', buffer: Buffer.from(imageData.split(',')[1], 'base64') });
    await page.getByRole('button', { name: 'Replace hero image', exact: true }).waitFor();
    await assertCoverPixel(page, [531, 219], [242, 238, 230]);
    await assertCoverPixel(page, [1276, 221], [226, 220, 208]);
    await assertCoverPixel(page, [533, 716], [226, 220, 208]);
    await assertCoverPixel(page, [580, 268], [226, 220, 208]);
    await page.evaluate(() => window.__slideMerge.save());
    const result = await page.evaluate(() => {
      const api = window.__slideMerge.api, elements = api.getSceneElements(), frame = elements.find(element => element.id === 'lab-slide');
      return { deck: window.__slideMerge.deck(), elements, cover: frame.customData.slideSettings.cover, files: api.getFiles(), theme: api.getAppState().theme };
    });
    assert.equal(result.deck.slides.length, before.slides.length + 1);
    assert.equal(result.cover.title, 'Reinventing Edge Onboarding Journey');
    assert.equal(result.files[result.cover.image.fileId].dataURL, imageData, 'Original image bytes survive cover cropping');
    assert.equal(result.files[result.cover.logo.fileId].dataURL, logoData, 'Original logo bytes survive containment');
    const logo = result.elements.find(element => element.customData?.slideCover === 'logo');
    assert.equal(logo.width / logo.height, 2);
    assert.ok(logo.width <= 54 && logo.height <= 54);
    assert.equal(result.theme, 'light', 'Authored cover colours are not inverted by the dark UI');
      const coverPart = role => result.elements.find(element => element.customData?.slideCover === role);
      assert.equal(coverPart('title').x - 136, 48);
      assert.equal(1280 - coverPart('title').x - coverPart('title').width, 48);
      assert.ok(720 - coverPart('footnote').y - coverPart('footnote').height >= 48);
      assert.deepEqual(coverPart('media-panel').customData.labCorners, { mode: 'squircle', radius: 32, topRightCornerRadius: 0, bottomRightCornerRadius: 0, bottomLeftCornerRadius: 0 });
      assert.ok(result.elements.filter(element => /^team-\d+$/.test(element.customData?.slideCover)).every(element => element.fontSize === 14 && !element.text.includes('\n')));
    assert.ok(result.elements.filter(element => element.customData?.slideCover).every(element => element.locked));
    for (const slide of before.slides) assert.deepEqual(result.deck.slides.find(item => item.id === slide.id).scene.elements, slide.scene.elements);
    const coverId = result.deck.selected;
    const published = publicDeckPayload(setDeckVisibility({ ...result.deck, slides: result.deck.slides.filter(slide => slide.id === coverId) }, 'public'), { reviewedSources: true, production: true });
    assert.equal(published.slides[0].scene.elements.find(element => element.id === 'lab-slide').customData.slideSettings.cover, undefined, 'Public audience gets visible objects, not duplicate editor fields');
    assert.deepEqual(published.slides[0].scene.elements.find(element => element.type === 'rectangle' && element.x === coverPart('media-panel').x && element.y === coverPart('media-panel').y).customData.labCorners, coverPart('media-panel').customData.labCorners);
    assert.ok(published.slides[0].scene.elements.some(element => element.type === 'text' && element.text === result.cover.title));
    const publicImages = published.slides[0].scene.elements.filter(element => element.type === 'image');
    assert.equal(published.slides[0].scene.files[publicImages.find(element => element.crop).fileId].dataURL, imageData);
    assert.equal(published.slides[0].scene.files[publicImages.find(element => !element.crop).fileId].dataURL, logoData);
    assert.equal(await title.evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
    assert.ok(await title.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Long title wraps inside the right panel');
    await page.waitForFunction(() => {
      const api = window.__slideMerge.api, state = api.getAppState(), image = api.getSceneElements().find(element => element.customData?.slideCover === 'image');
      const canvas = document.querySelector('.excalidraw__canvas.static'), box = canvas.getBoundingClientRect();
      const positionX = (image.x + image.width / 2 + state.scrollX) * state.zoom.value * canvas.width / box.width;
      const positionY = (image.y + image.height / 2 + state.scrollY) * state.zoom.value * canvas.height / box.height;
      const pixel = canvas.getContext('2d').getImageData(Math.floor(positionX), Math.floor(positionY), 1, 1).data;
      return pixel[0] === 22 && pixel[1] === 120 && pixel[2] === 160;
    });
    const inspector = page.getByRole('complementary', { name: 'Slide properties', exact: true });
    await inspector.evaluate(element => { element.scrollTop = 0; });
    const panelBox = await inspector.boundingBox();
    assert.ok(panelBox.x >= 1200 && panelBox.width <= 240, 'Cover uses the full-height right panel');
    await page.screenshot({ path: join(tmpdir(), 'rk-fixed-cover-1440.png') });
    await page.getByRole('button', { name: 'Remove brand logo', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__slideMerge.api.getSceneElements().some(element => element.customData?.slideCover === 'logo')), false);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Replace brand logo', exact: true }).waitFor();
    await title.fill('Independent cover edit');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Cover title"]')?.value === 'Reinventing Edge Onboarding Journey');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Cover title"]')?.value === 'Independent cover edit');
    await page.locator('.merge-slide-card.is-active').getByRole('button', { name: 'Duplicate slide', exact: true }).click();
    await title.fill('Duplicate only');
    await page.evaluate(() => window.__slideMerge.save());
    assert.equal(await page.evaluate(id => window.__slideMerge.deck().slides.find(slide => slide.id === id).scene.elements.find(element => element.id === 'lab-slide').customData.slideSettings.cover.title, coverId), 'Independent cover edit');
    await page.reload();
    await title.waitFor();
    assert.equal(await title.inputValue(), 'Duplicate only');
    assert.equal(await page.evaluate(() => { const api = window.__slideMerge.api; const image = api.getSceneElements().find(element => element.customData?.slideCover === 'image'); return api.getFiles()[image.fileId].dataURL; }), imageData);
    assert.equal(await page.evaluate(() => { const api = window.__slideMerge.api; const logo = api.getSceneElements().find(element => element.customData?.slideCover === 'logo'); return api.getFiles()[logo.fileId].dataURL; }), logoData);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open properties', exact: true }).click();
    await title.waitFor({ state: 'visible' });
    assert.ok(await inspector.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1; }));
    await page.getByLabel('Cover role description', { exact: true }).fill('Mobile field edit');
    await page.screenshot({ path: join(tmpdir(), 'rk-fixed-cover-390.png') });
    await page.getByRole('button', { name: 'Replace brand logo', exact: true }).click();
    await page.locator('.merge-shell > input[type="file"]').setInputFiles({ name: 'replacement-logo.png', mimeType: 'image/png', buffer: Buffer.from(imageData.split(',')[1], 'base64') });
    await page.getByRole('button', { name: 'Replace brand logo', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => { const logo = window.__slideMerge.api.getSceneElements().find(element => element.customData?.slideCover === 'logo'); return logo.width / logo.height; }), 1600 / 900);
    await page.evaluate(() => window.__theme.set('night'));
    const preserved = await page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === 'lab-slide').customData.slideSettings.cover);
    for (const [key, color] of Object.entries(initialPalette)) assert.equal(preserved[key].toLowerCase(), color, 'Changing UI theme preserves authored colours');
    await page.getByRole('button', { name: 'Use site colours', exact: true }).click();
    const darkPalette = await assertCoverSitePalette(page);
    assert.notEqual(darkPalette.background, initialPalette.background);
    await assertCoverPixel(page, [400, 660], [8, 8, 10]);
    await page.screenshot({ path: join(tmpdir(), 'rk-fixed-cover-dark-390.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("fixed cover fields persist in hosted Studio without changing case content", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await openIntegratedFixture(page, undefined, { timeline: '2023 - 2024', team: '1 Lead designer, 2 junior designers to work on high fidelity mocks, 1 Product Manager, 1 Engineer, 1 System Architect', role: 'Lead', scope: 'Activation' });
      const original = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks));
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="highlights"]').click();
      await page.getByLabel('Current status', { exact: true }).selectOption('Launched');
      assert.equal(await page.locator('[data-sfield="timeline"]').count(), 0);
      await page.locator('[data-l2tab="details"]').click();
      const logo = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 40;
        canvas.getContext('2d').fillRect(0, 0, 80, 40); return canvas.toDataURL();
      });
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload logo', exact: true }).click();
      await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo.split(',')[1], 'base64') });
      await page.locator('.adm__brand-logo').waitFor();
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].brandLogo), logo);
      await page.route('https://logo.fixture/original.png', route => route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(logo.split(',')[1], 'base64') }));
      await page.getByLabel('Image URL', { exact: true }).fill('https://logo.fixture/original.png');
      await page.getByRole('button', { name: 'Fetch link', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-act="brand-logo-fetch"]').disabled);
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].brandLogo), logo);
      await page.getByLabel('Image URL', { exact: true }).fill('javascript:alert(1)');
      await page.getByRole('button', { name: 'Fetch link', exact: true }).click();
      assert.match(await page.locator('[data-brand-logo-error]').textContent(), /HTTPS/);
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].brandLogo), logo);
      await page.locator('[data-l2tab="slides"]').click();
      await page.getByRole('button', { name: 'Add cover', exact: true }).click();
      const title = page.getByLabel('Cover title', { exact: true });
      if (width === 1440) {
        const rail = await page.locator('.merge-slides').boundingBox(), editor = await page.locator('.merge-editor').boundingBox(), panel = await page.locator('.merge-slide-properties').boundingBox();
        assert.ok(rail.x + rail.width <= editor.x + 1 && panel.x >= editor.x + editor.width - 1, 'Hosted Studio uses left slides and right editing panel');
        assert.ok(panel.height > editor.height - 60, 'Hosted properties fill the right column');
        await page.screenshot({ path: join(tmpdir(), 'rk-hosted-right-panel-1440.png') });
      }
      await page.locator('.merge-cover-overrides > summary').click();
      assert.equal(await title.inputValue(), 'Integrated project');
      assert.equal(await page.getByLabel('Cover status', { exact: true }).inputValue(), 'Launched');
      assert.equal(await page.getByLabel('Cover footnote', { exact: true }).inputValue(), 'Activation');
      await title.fill('A field-driven cover');
      await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount === 1);
      await page.locator('.merge-slide-properties').getByRole('button', { name: 'Highlights', exact: true }).click();
      await page.getByLabel('Current status', { exact: true }).selectOption('custom');
      await page.getByLabel('Custom current status', { exact: true }).fill('Beta - live');
      await page.locator('[data-l2tab="slides"]').click();
      if (width === 390) await page.getByRole('button', { name: 'Open properties', exact: true }).click();
      await page.locator('.merge-cover-overrides > summary').click();
      assert.equal(await title.inputValue(), 'A field-driven cover');
      assert.equal(await page.getByLabel('Cover status', { exact: true }).inputValue(), 'Beta - live');
      if (width === 390) await page.getByRole('button', { name: 'Close panel', exact: true }).click();
      await page.locator('[data-l2-back]').click();
      await openProjectSlides(page);
      if (width === 390) await page.getByRole('button', { name: 'Open properties', exact: true }).click();
      await page.locator('.merge-cover-overrides > summary').click();
      assert.equal(await title.inputValue(), 'A field-driven cover');
      assert.equal(await page.getByLabel('Cover status', { exact: true }).inputValue(), 'Beta - live');
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.timeline), '2023 - 2024');
      await assertCoverSitePalette(page);
      assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks)), original);
      assert.ok(await title.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }));
      await page.screenshot({ path: join(tmpdir(), 'rk-hosted-cover-' + width + '.png') });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("cover byte fetches recover from a cached image response without CORS headers", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const server = createServer(), requests = [];
  try {
    const page = await browser.newPage();
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5541') + '/studio/slide-runtime/component.html');
    const compiled = await build({ stdin:{ contents:'export { fetchCoverMedia } from "./src/js/slide-merge-cover.mjs"; export { originalImage } from "./src/js/slide-lab-core.mjs";', resolveDir:fileURLToPath(new URL('.', import.meta.url)) }, bundle:true, write:false, format:'iife', globalName:'coverCacheTest' });
    await page.addScriptTag({ content:compiled.outputFiles[0].text });
    const original = await page.evaluate(() => { const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;const context=canvas.getContext('2d');context.fillStyle='#1678a0';context.fillRect(0,0,120,80);return canvas.toDataURL(); });
    server.on('request', (request, response) => {
      requests.push(request.headers.origin || null);
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('Cache-Control', 'public, max-age=3600');
      if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', '*');
      response.end(Buffer.from(original.split(',')[1], 'base64'));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const result = await page.evaluate(async url => {
      const image = new Image(); image.src=url; await image.decode();
      let cachedError = '';
      try { await fetch(url, { credentials:'omit', referrerPolicy:'no-referrer' }); }
      catch (error) { cachedError=error.name+': '+error.message; }
      const { fetchCoverMedia, originalImage } = window.coverCacheTest;
      const restored = [];
      for (const timeout of [15000, 8000]) {
        const response = await fetchCoverMedia(url, timeout);
        restored.push(await originalImage(await response.blob()));
      }
      return { cachedError, restored };
    }, 'http://127.0.0.1:'+server.address().port+'/original.png');
    assert.equal(result.cachedError, 'TypeError: Failed to fetch');
    assert.deepEqual(requests, [null, new URL(page.url()).origin, new URL(page.url()).origin]);
    for (const image of result.restored) {
      assert.equal(image.dataURL, original);
      assert.equal(image.width, 120); assert.equal(image.height, 80);
      assert.equal(image.bytes, Buffer.from(original.split(',')[1], 'base64').length);
    }
  } finally {
    await browser.close();
    if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test("empty hosted deck adds a cover when project media fails and retries without losing edits", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    let available = false;
    await openIntegratedFixture(page, undefined, { status:'Worldwide experimentation - Canary state', role: 'Product designer', team: '1 Designer, 1 Product Manager, 3 Engineers, 1 Content Designer, Privacy, Data Science' }, { image: 'https://cover.fixture/original.png', brandLogo:'https://cover.fixture/original.png', period:'2025 - Current' });
    const original = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0]));
    const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80; const context=canvas.getContext('2d');context.fillStyle='#1678a0';context.fillRect(0, 0, 120, 80); return canvas.toDataURL(); });
    await page.context().route('https://cover.fixture/original.png', route => available ? route.fulfill({ contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(image.split(',')[1], 'base64') }) : route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'Unavailable' }));
    await openProjectSlides(page);
    await page.getByRole('button', { name: 'Add cover', exact: true }).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount === 1, null, { timeout: 10000 });
    await page.getByRole('button', { name: 'Refresh linked cover', exact: true }).waitFor();
    assert.match(await page.locator('.merge-cover-error').textContent(), /image.*could not be loaded/i);
    await page.locator('.merge-cover-overrides > summary').click();
    await page.getByLabel('Cover title', { exact: true }).fill('Retain this cover edit');
    await page.locator('[data-l2-back]').click();
    await page.locator('.merge-shell').waitFor({state:'detached'});
    const failedDraft = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0]));
    const failedAudienceOpened = page.waitForEvent('popup');
    await page.locator('[data-act="study-slideshow-preview"][data-index="0"]').click();
    const failedAudience = await failedAudienceOpened;
    if (!failedAudience.isClosed()) await failedAudience.waitForEvent('close');
    await page.getByText('The linked cover image could not be loaded. Check the connection and retry the presentation.', {exact:true}).waitFor();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0])), failedDraft);
    available = true;
    const unloadedAudienceOpened = page.waitForEvent('popup');
    await page.locator('[data-act="study-slideshow-preview"][data-index="0"]').click();
    const unloadedAudience = await unloadedAudienceOpened;
    await unloadedAudience.locator('.pjp .excalidraw__canvas.static').waitFor();
    await unloadedAudience.waitForFunction(() => {
      const canvas = document.querySelector('.pjp .excalidraw__canvas.static');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] === 22 && pixels[offset + 1] === 120 && pixels[offset + 2] === 160) count++;
      return count > 10000;
    }, null, {timeout:10000});
    await unloadedAudience.screenshot({path:join(tmpdir(), 'rk-presenter-cover-unloaded-1440.png')});
    await unloadedAudience.close();
    await page.waitForFunction(() => document.activeElement?.matches('[data-act="study-slideshow-preview"]'));
    await openProjectSlides(page);
    await page.locator('.merge-cover-overrides > summary').click();
    await page.getByRole('button', { name: 'Refresh linked cover', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.merge-cover-error'));
    assert.equal(await page.locator('.merge-cover-error').count(), 0);
    assert.equal(await page.getByLabel('Cover title', { exact: true }).inputValue(), 'Retain this cover edit');
    await page.locator('.merge-cover-overrides').getByRole('button', { name: 'Replace hero image', exact: true }).waitFor();
    const readSaved=()=>page.evaluate(async()=>{
      const reference=window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const requested=request=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Cover fixture storage request timed out')),5000);request.onsuccess=()=>{clearTimeout(timer);resolve(request.result);};request.onerror=()=>{clearTimeout(timer);reject(request.error);};});
      const database=await requested(indexedDB.open('rk-studio-slide-decks-v1'));
      try{const record=await requested(database.transaction('documents').objectStore('documents').get([reference.id,reference.revision]));const scene=record.document.slides[0].scene;await Promise.all(Object.entries(scene.files).map(async([id,key])=>{scene.files[id]=await requested(database.transaction('assets').objectStore('assets').get(key));}));return scene;}finally{database.close();}
    });
    const assertImagePixels=()=>page.waitForFunction(()=>{const canvas=document.querySelector('.excalidraw__canvas.static'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset]===22&&pixels[offset+1]===120&&pixels[offset+2]===160)count++;return count>1000;},null,{timeout:10000});
    const savedScene=await readSaved(),part=role=>savedScene.elements.find(element=>element.customData?.slideCover===role);
    const geometry={status:part('status'),duration:part('duration'),statusBox:part('status-box'),team:part('team-0'),role:part('role'),logo:part('logo')};
    assert.equal(geometry.status.fontSize,18);assert.equal(geometry.duration.fontSize,18);
    assert.equal(geometry.statusBox.width,geometry.status.width+24);
    assert.equal(geometry.team.x,geometry.role.x);
    assert.equal(geometry.logo.customData.labCorners.mode,'squircle');
    await assertImagePixels();
    await page.screenshot({path:join(tmpdir(),'rk-cover-recovered-1440.png')});
    await page.locator('[data-l2-back]').click();
    const savedCover=await page.evaluate(async()=>{
      const reference=window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const database=await new Promise(resolve=>{const request=indexedDB.open('rk-studio-slide-decks-v1');request.onsuccess=()=>resolve(request.result);});
      try{return await new Promise((resolve,reject)=>{const transaction=database.transaction('documents','readwrite'),store=transaction.objectStore('documents'),request=store.get([reference.id,reference.revision]);let cover;request.onsuccess=()=>{const record=request.result,scene=record.document.slides[0].scene;cover=scene.elements.find(element=>element.id==='lab-slide').customData.slideSettings.cover;delete scene.files[cover.image.fileId];store.put(record,[reference.id,reference.revision]);};transaction.oncomplete=()=>resolve(cover);transaction.onerror=()=>reject(transaction.error);});}finally{database.close();}
    });
    const coverAudienceOpened = page.waitForEvent('popup');
    await page.locator('[data-act="study-slideshow-preview"][data-index="0"]').click();
    const coverAudience = await coverAudienceOpened;
    await coverAudience.locator('.pjp .excalidraw__canvas.static').waitFor();
    await coverAudience.waitForFunction(() => {
      const canvas = document.querySelector('.pjp .excalidraw__canvas.static');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] === 22 && pixels[offset + 1] === 120 && pixels[offset + 2] === 160) count++;
      return count > 10000;
    }, null, {timeout:10000});
    await coverAudience.screenshot({path:join(tmpdir(), 'rk-presenter-cover-recovered-1440.png')});
    await coverAudience.setViewportSize({width:390,height:844});
    await coverAudience.screenshot({path:join(tmpdir(), 'rk-presenter-cover-recovered-390.png')});
    await coverAudience.close();
    await page.waitForFunction(() => document.activeElement?.matches('[data-act="study-slideshow-preview"]'));
    assert.equal((await readSaved()).files[savedCover.image.fileId], undefined, 'Presentation recovery must not rewrite the saved deck');
    await openProjectSlides(page);
    await page.locator('.merge-cover-overrides > summary').click();
    assert.equal(await page.getByLabel('Cover title', { exact: true }).inputValue(), 'Retain this cover edit');
    const recoveredScene=await readSaved(),cover=recoveredScene.elements.find(element=>element.id==='lab-slide').customData.slideSettings.cover;
    const recovered={cover,image:recoveredScene.files[cover.image.fileId]?.dataURL};
    assert.deepEqual(recovered.cover,savedCover,'Recovery with unchanged hashed metadata retains the file');
    assert.equal(recovered.image,image);
    await assertImagePixels();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(tmpdir(),'rk-cover-recovered-390.png')});
    const work = await page.evaluate(() => window.__RKStudio.getDraft().work[0]);
    assert.deepEqual(work.study.blocks, JSON.parse(original).study.blocks);
    assert.equal(work.image, JSON.parse(original).image);
    assert.equal(work.study.nativeDeck.slideCount, 1);
  } finally { await browser.close(); }
});

test("linked cover depth renders saved originals and degrades to static media", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const media = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const context = canvas.getContext('2d');
      for (let index = 0; index < 16; index++) { context.fillStyle = index % 2 ? '#d8a657' : '#1678a0'; context.fillRect(index * 50, 0, 50, 600); }
      const image = canvas.toDataURL();
      const gradient = context.createLinearGradient(0, 0, 800, 600); gradient.addColorStop(0, '#111'); gradient.addColorStop(1, '#eee'); context.fillStyle = gradient; context.fillRect(0, 0, 800, 600);
      return { image, depth: canvas.toDataURL() };
    });
    await openIntegratedFixture(page, undefined, { role: 'Lead', scope: 'Activation' }, { image: media.image, period: '2025 - Present', depth: { on: true, map: media.depth, strength: .08, softness: .014, focus: .5, zoom: 1.1 } });
    await page.evaluate(() => history.replaceState(null, '', location.pathname + '?devstub=1&depth'));
    await openProjectSlides(page);
    await page.getByRole('button', { name: 'Add cover', exact: true }).click();
    await page.getByLabel('Parallax on hover', { exact: true }).waitFor();
    await page.locator('.merge-cover-overrides > summary').click();
    assert.equal(await page.getByLabel('Cover duration', { exact: true }).inputValue(), '2025 - Present');
    await page.locator('.merge-cover-overrides > summary').click();
    const overlay = page.locator('.lab-canvas > .merge-native-sections .merge-cover-depth');
    await overlay.locator('canvas').waitFor();
    const editingBounds = await overlay.boundingBox();
    await page.mouse.move(editingBounds.x + 50, editingBounds.y + 50);
    await page.waitForFunction(() => document.querySelector('.merge-cover-depth canvas')?.classList.contains('is-on'));
    assert.equal(await overlay.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.match(await overlay.evaluate(element => getComputedStyle(element.parentElement).clipPath), /^path\(/, 'Live depth uses the same squircle clipping');
    const editingFirst = await overlay.screenshot();
    await page.mouse.move(editingBounds.x + editingBounds.width - 25, editingBounds.y + editingBounds.height - 25, { steps: 15 });
    assert.notDeepEqual(await overlay.screenshot(), editingFirst, 'Editor hover keeps the same live parallax');
    assert.ok(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', { x: editingBounds.x + 50, y: editingBounds.y + 50 }), 'Native canvas still receives editing input');
    await page.getByRole('button', { name: 'Editing on', exact: true }).click();
    await overlay.locator('canvas').waitFor();
    await overlay.hover({ position: { x: 50, y: 50 } });
    await page.waitForFunction(() => document.querySelector('.merge-cover-depth canvas')?.classList.contains('is-on'));
    const first = await overlay.screenshot();
    const bounds = await overlay.boundingBox();
    await page.mouse.move(bounds.x + bounds.width - 25, bounds.y + bounds.height - 25, { steps: 15 });
    const second = await overlay.screenshot();
    assert.notDeepEqual(first, second, 'Pointer depth changes actual rendered pixels');
    const sample = await overlay.evaluate(element => new Promise(resolve => requestAnimationFrame(() => {
      const canvas = element.querySelector('canvas'), gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); resolve([...pixel]);
    })));
    assert.ok(sample.slice(0, 3).some(channel => channel > 20), 'Depth canvas is nonblank');
    await page.screenshot({ path: join(tmpdir(), 'rk-linked-cover-depth-1440.png') });
    await page.evaluate(async () => {
      window.__RK_NATIVE_PRESENTER = true;
      const bridge = new EventTarget(); bridge.postMessage = state => { window.coverState = state; }; window.chrome.webview = bridge;
      const draft = window.__RKStudio.getDraft();
      await window.__RKStudio.presentNativeDeck(draft.work[0].id,{},(work,options)=>{
        const document=structuredClone(options.document),first=document.slides[0];
        document.slides.push({id:'depth-away',title:'Away',notes:'',scene:{...first.scene,elements:first.scene.elements.filter(element=>element.type==='frame'),files:{}}});
        return window.RK.presentDeck(work,{...options,document});
      });
    });
    const presented = page.locator('.pjp .merge-cover-depth');
    await presented.locator('canvas').waitFor();
    await presented.hover({position:{x:50,y:50}});
    await page.waitForFunction(() => document.querySelector('.pjp .merge-cover-depth canvas')?.classList.contains('is-on'));
    const presentationFirst = await presented.screenshot();
    const presentationBounds = await presented.boundingBox();
    await page.mouse.move(presentationBounds.x + presentationBounds.width - 40, presentationBounds.y + presentationBounds.height - 40, {steps:15});
    assert.notDeepEqual(await presented.screenshot(), presentationFirst);
    await page.evaluate(()=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{channel:'rk-presenter',command:'next'}})));
    await presented.waitFor({state:'detached'});
    await page.evaluate(()=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{channel:'rk-presenter',command:'prev'}})));
    await presented.locator('canvas').waitFor();
    await presented.hover({position:{x:50,y:50}});
    await page.waitForFunction(()=>document.querySelector('.pjp .merge-cover-depth canvas')?.classList.contains('is-on'));
    const revisited=await presented.screenshot();
    const revisitedBounds=await presented.boundingBox();
    await page.mouse.move(revisitedBounds.x+revisitedBounds.width-40,revisitedBounds.y+revisitedBounds.height-40,{steps:15});
    assert.notDeepEqual(await presented.screenshot(),revisited,'Revisited cover responds with changing depth pixels');
    await page.evaluate(() => window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{channel:'rk-presenter',command:'exit'}})));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await overlay.locator('canvas').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(tmpdir(), 'rk-linked-cover-static-390.png') });
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
    await page.getByRole('button', { name: 'Open properties', exact: true }).click();
    await page.getByLabel('Show team', { exact: true }).uncheck();
    await page.getByLabel('Cover crop x', { exact: true }).press('End');
    assert.equal(await page.getByLabel('Cover crop x', { exact: true }).inputValue(), '100');
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.locator('[data-l2-back]').click();
    await page.locator('.merge-shell').waitFor({ state: 'detached' });
    const saved = await page.evaluate(async () => {
      const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const database = await new Promise(resolve => { const request = indexedDB.open('rk-studio-slide-decks-v1'); request.onsuccess = () => resolve(request.result); });
      try {
        const transaction = database.transaction(['documents', 'assets']);
        const document = await new Promise(resolve => { const request = transaction.objectStore('documents').get([reference.id, reference.revision]); request.onsuccess = () => resolve(request.result.document); });
        await Promise.all(document.slides.flatMap(slide => Object.entries(slide.scene.files).map(([id, key]) => new Promise(resolve => { const request = transaction.objectStore('assets').get(key); request.onsuccess = () => { slide.scene.files[id] = request.result; resolve(); }; }))));
        return document;
      } finally { database.close(); }
    });
    const scene = saved.slides[0].scene, cover = scene.elements.find(element => element.id === 'lab-slide').customData.slideSettings.cover;
    assert.equal(scene.files[cover.image.fileId].dataURL, media.image);
    assert.equal(scene.files[cover.depth.fileId].dataURL, media.depth);
    assert.equal(cover.crop.x, 100);
    assert.ok(cover.hidden.includes('team'));
    const audience = publicDeckPayload(setDeckVisibility(saved, 'public'), { reviewedSources: true });
    const publicImage = audience.slides[0].scene.elements.find(element => element.customData?.slideDepth);
    assert.equal(audience.slides[0].scene.files[publicImage.customData.slideDepth.fileId].dataURL, media.depth);
    assert.equal(JSON.stringify(audience).includes('integrated-case'), false);
    const publishedBefore=await page.evaluate(()=>JSON.stringify(window.RK.studioPublished));
    await page.locator('[data-act="study-slideshow-preview"]').first().click();
    await page.locator('.pjp--native').waitFor();
    await page.waitForFunction(()=>window.coverState?.editable===true);
    for (const [key,value] of [['notes','PRIVATE LOCAL DJ NOTE'],['title','Renamed privately']]) {
      await page.evaluate(({key,value})=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{channel:'rk-presenter',command:'edit',index:0,key,value}})),{key,value});
      await page.waitForFunction(()=>window.coverState.saveStatus==='Saved to deck');
    }
    await page.evaluate(()=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{channel:'rk-presenter',command:'exit'}})));
    await page.locator('.pjp').waitFor({state:'detached'});
    await page.locator('[data-act="study-slideshow-preview"]').first().click();
    await page.waitForFunction(()=>window.coverState?.notes==='PRIVATE LOCAL DJ NOTE' && window.coverState?.slides[0].title==='Renamed privately');
    assert.equal(await page.locator('[data-pjp-notes]').textContent(),'');
    assert.equal(await page.evaluate(()=>JSON.stringify(window.RK.studioPublished)),publishedBefore);
    await page.evaluate(()=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{channel:'rk-presenter',command:'exit'}})));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Private DJ metadata sync crosses independent owner profiles without Publish and retains conflicts', { timeout: 120000 }, async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', r2Buckets: ['PRESENTER'] });
  const bucket = await runtime.getR2Bucket('PRESENTER');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const first = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const second = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let offline = false;
  async function connect(page) {
    await page.context().route('**/admin/presenter-metadata?**', async route => {
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-presenter-owner');
      if (offline) return route.fulfill({ status: 503, json: { error: 'Offline fixture' } });
      const request = new Request(route.request().url(), { method: route.request().method(), body: route.request().postData() || undefined });
      const response = await presenterMetadataRoute(request, bucket, { 'Access-Control-Allow-Origin': '*' });
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await page.evaluate(() => {
      window.__rkAdminAuth = { session: { token: 'synthetic-presenter-owner', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
      window.__RK_NATIVE_PRESENTER = true;
      const bridge = new EventTarget(); bridge.postMessage = state => { if (state.type === 'state') window.syncedPresenter = state; };
      window.chrome.webview = bridge;
    });
  }
  const send = (page, command, value = {}) => page.evaluate(({ command, value }) => window.chrome.webview.dispatchEvent(new MessageEvent('message', { data: { channel: 'rk-presenter', command, ...value } })), { command, value });
  const start = async page => { await page.locator('[data-act="study-slideshow-preview"]').first().click(); await page.locator('.pjp--native').waitFor(); await page.waitForFunction(() => window.syncedPresenter?.syncEnabled); };
  const edit = async (page, key, value) => { await send(page, 'edit', { index: 0, key, value }); await page.waitForFunction(() => /Private sync pending/.test(window.syncedPresenter.saveStatus)); };
  const sync = async page => { await send(page, 'metadata-sync'); await page.waitForFunction(() => !window.syncedPresenter.syncBusy && /synced privately/.test(window.syncedPresenter.saveStatus)); };
  try {
    await openIntegratedFixture(first);
    await openProjectSlides(first);
    await first.getByRole('button', { name: 'Add cover', exact: true }).click();
    await first.getByLabel('Cover title', { exact: true }).waitFor({ state: 'attached' });
    const original = await first.evaluate(async () => {
      let document;
      await window.__RKStudio.presentNativeDeck('integrated-case', {}, (_work, options) => { document = options.document; return true; });
      return document;
    });
    await first.locator('[data-l2-back]').click();
    await connect(first);
    const firstPublished = await first.evaluate(() => JSON.stringify(window.RK.studioPublished));
    await start(first);
    await edit(first, 'notes', 'Private note from first profile'); await sync(first);
    await edit(first, 'title', 'Private cross-profile name'); await sync(first);
    const reference = { schema: STUDIO_DECK_SCHEMA, version: 1, caseStudyId: 'integrated-case', id: 'independent-local-copy', revision: 0, slideCount: original.slides.length };
    await openIntegratedFixture(second, undefined, { nativeDeck: reference });
    const storageBundle = await build({ entryPoints: [fileURLToPath(new URL('./src/js/slide-studio-deck.mjs', import.meta.url))], bundle: true, format: 'iife', globalName: 'StudioDeckStorage', write: false });
    await second.addScriptTag({ content: storageBundle.outputFiles[0].text });
    await second.evaluate(async ({ reference, original }) => {
      await window.StudioDeckStorage.saveStudioDeck(reference, original);
    }, { reference, original });
    await connect(second);
    const secondPublished = await second.evaluate(() => JSON.stringify(window.RK.studioPublished));
    await start(second);
    await second.waitForFunction(() => window.syncedPresenter.notes === 'Private note from first profile' && window.syncedPresenter.slides[0].title === 'Private cross-profile name');
    await send(second, 'metadata-busy', { value: true });
    await edit(first, 'notes', 'Remote update during typing'); await sync(first);
    await sync(second);
    assert.equal(await second.evaluate(() => window.syncedPresenter.notes), 'Private note from first profile');
    await send(second, 'metadata-busy', { value: false }); await sync(second);
    await second.waitForFunction(() => window.syncedPresenter.notes === 'Remote update during typing');
    await edit(second, 'notes', 'Retained conflicting local note');
    await edit(first, 'notes', 'Retained cloud note'); await sync(first);
    await send(second, 'metadata-sync');
    await second.waitForFunction(() => window.syncedPresenter.conflicts.length === 1);
    const conflict = await second.evaluate(() => window.syncedPresenter.conflicts[0]);
    assert.equal(conflict.local, 'Retained conflicting local note'); assert.equal(conflict.remote, 'Retained cloud note');
    await send(second, 'metadata-resolve', { value: { ...conflict, choice: 'remote' } });
    await second.waitForFunction(() => window.syncedPresenter.notes === 'Retained cloud note' && window.syncedPresenter.conflicts.length === 0);
    offline = true;
    await edit(first, 'notes', 'Offline note survives reopen');
    await send(first, 'metadata-sync'); await first.waitForFunction(() => /failed \(503\)/.test(window.syncedPresenter.saveStatus));
    await send(first, 'exit'); await first.locator('.pjp').waitFor({ state: 'detached' });
    await start(first); assert.equal(await first.evaluate(() => window.syncedPresenter.notes), 'Offline note survives reopen');
    offline = false; await sync(first); await sync(second);
    await second.waitForFunction(() => window.syncedPresenter.notes === 'Offline note survives reopen');
    for (const [page, published] of [[first, firstPublished], [second, secondPublished]]) {
      assert.equal(await page.evaluate(() => JSON.stringify(window.RK.studioPublished)), published);
      assert.equal(await page.locator('[data-pjp-notes]').textContent(), '');
      await send(page, 'exit'); await page.locator('.pjp').waitFor({ state: 'detached' });
      const scene = await page.evaluate(async () => {
        let document;
        await window.__RKStudio.presentNativeDeck('integrated-case', {}, (_work, options) => { document = options.document; return true; });
        return document.slides[0].scene;
      });
      assert.deepEqual(scene, original.slides[0].scene);
    }
  } finally { await browser.close(); await runtime.dispose(); }
});

test("slide eyedropper samples screen results over inserted sections and outside the canvas", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const published = JSON.parse(readFileSync(new URL('./content.json', import.meta.url), 'utf8'));
    published.work = [{ id: 'colour-source', title: 'Colour source', study: { blocks: [{ type: 'text', heading: 'Inserted colour section', body: 'Original section remains unchanged.' }] } }];
    await page.route('**/content.json', route => route.fulfill({ json: published }));
    await page.addInitScript(() => {
      window.screenPicks = [];
      window.EyeDropper = class { open({ signal }) {
        return new Promise((resolve, reject) => {
          const pick = { resolve, reject, signal, active: navigator.userActivation.isActive };
          window.screenPicks.push(pick);
          signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
        });
      } };
    });
    await page.goto((process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5541') + '/studio/slide-merge-lab/');
    await waitForSlideEditor(page);
    await page.getByRole('button', { name: 'Sections', exact: true }).click();
    await page.locator('.merge-study-choices button').filter({ hasText: 'Colour source' }).click();
    await page.locator('.merge-section-choices button').filter({ hasText: 'Inserted colour section' }).click();
    const section = page.locator('.lab-canvas > .merge-native-sections .merge-native-section').first();
    await section.waitFor();
    const sectionContent = section.frameLocator('iframe.lab-section-component').locator('[data-section-runtime][data-component-type="text"]');
    await sectionContent.waitFor();
    const original = await page.evaluate(() => JSON.stringify(window.__slideMerge.api.getSceneElements().find(element => element.customData?.sectionComponent)));
    await section.evaluate(element => { element.style.background = '#237b70'; });
    await sectionContent.evaluate(element => { element.style.background = '#237b70'; });
    await page.locator('.merge-inspector').getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.evaluate(() => {
      const api = window.__slideMerge.api;
      const shape = api.getSceneElements().find(element => element.type === 'rectangle' && !element.locked);
      window.pickTarget = shape.id;
      api.updateScene({ appState: { selectedElementIds: { [shape.id]: true }, theme: 'light' } });
    });
    await page.locator('.selected-shape-actions button[aria-label="Stroke"]').click();
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 1);
    assert.equal(await page.evaluate(() => window.screenPicks[0].active), true, 'Native open retains user activation');
    assert.equal(await page.locator('.excalidraw-eye-dropper-preview').count(), 0, 'Canvas-only sampler is not layered over the screen');
    const sectionBox = await section.boundingBox();
    const screenPixel = async (x, y) => page.evaluate(async ({ png, x, y }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
    }, { png: (await page.screenshot()).toString('base64'), x: Math.floor(x), y: Math.floor(y) });
    const sampled = await screenPixel(sectionBox.x + sectionBox.width - 12, sectionBox.y + 12);
    assert.equal(sampled, '#237b70', 'Inserted section has a distinct visible pixel');
    await page.evaluate(color => window.screenPicks.at(-1).resolve({ sRGBHex: color }), sampled);
    await page.waitForFunction(color => window.__slideMerge.api.getSceneElements().find(element => element.id === window.pickTarget).strokeColor === color, sampled);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__slideMerge.api.getSceneElements().find(element => element.customData?.sectionComponent))), original);
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 2);
    await page.evaluate(() => window.screenPicks.at(-1).reject(new DOMException('Escape', 'AbortError')));
    await page.waitForFunction(() => window.screenPicks.at(-1).signal.aborted);
    assert.equal(await page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === window.pickTarget).strokeColor), sampled);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: {} } }));
    await page.locator('.merge-slide-color button[aria-label="Background"]').click();
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 3);
    await page.locator('header').evaluate(element => { element.style.backgroundColor = '#d8a657'; });
    const outside = await screenPixel(1400, 20);
    assert.equal(outside, '#d8a657', 'Sample the rendered header outside the canvas');
    await page.evaluate(color => window.screenPicks.at(-1).resolve({ sRGBHex: color }), outside);
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.customData?.slideSettings)?.customData.slideSettings.background?.color === '#d8a657');
    await page.screenshot({ path: join(tmpdir(), 'rk-screen-eyedropper-1440.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.customData?.slideSettings)?.customData.slideSettings.background?.color !== '#d8a657');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.customData?.slideSettings)?.customData.slideSettings.background?.color === '#d8a657');
    await page.evaluate(() => window.__slideMerge.api.updateScene({ appState: { selectedElementIds: { [window.pickTarget]: true } } }));
    await page.locator('.selected-shape-actions button[aria-label="Background"]').click();
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 4);
    await page.evaluate(() => window.screenPicks.at(-1).resolve({ sRGBHex: '#c84b65' }));
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === window.pickTarget).backgroundColor === '#c84b65');
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 5);
    await page.evaluate(() => window.screenPicks.at(-1).reject(new DOMException('Denied', 'NotAllowedError')));
    await page.getByText('Screen colour picking is unavailable.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === window.pickTarget).backgroundColor), '#c84b65');
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 6);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.screenPicks.at(-1).signal.aborted);
    await page.evaluate(() => window.screenPicks.at(-1).resolve({ sRGBHex: '#ff0000' }));
    assert.equal(await page.evaluate(() => window.__slideMerge.api.getSceneElements().find(element => element.id === window.pickTarget).backgroundColor), '#c84b65');
    await page.evaluate(() => {
      const api = window.__slideMerge.api, text = api.getSceneElements().find(element => element.type === 'text' && !element.containerId && !element.locked);
      window.pickText = text.id;
      api.updateScene({ appState: { selectedElementIds: { [text.id]: true } } });
    });
    await page.locator('.selected-shape-actions button[aria-label="Stroke"]').click();
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.waitForFunction(() => window.screenPicks.length === 7);
    await page.evaluate(() => window.screenPicks.at(-1).resolve({ sRGBHex: '#375a7f' }));
    await page.waitForFunction(() => window.__slideMerge.api.getSceneElements().find(element => element.id === window.pickText).strokeColor === '#375a7f');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.EyeDropper = undefined; });
    await page.locator('.selected-shape-actions button[aria-label="Stroke"]').click();
    await page.locator('.excalidraw-eye-dropper-trigger').click();
    await page.locator('.excalidraw-eye-dropper-preview').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.excalidraw-eye-dropper-preview').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(tmpdir(), 'rk-screen-eyedropper-390.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('case authoring keeps sources private and requires reviewed selective application', {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:960}}), page = await context.newPage();
      await openIntegratedFixture(page);
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="gen"]').click();
      await page.waitForFunction(()=>!document.querySelector('[data-act="csgen-run"]').disabled);
      await page.locator('[data-csgen="material"]').fill('We interviewed 12 people.');
      const studyBefore = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study));
      await page.waitForFunction(()=>document.querySelector('[data-csgen-status]').textContent==='Sources saved locally.');
      await page.evaluate(async()=>{
        const work=window.__RKStudio.getDraft().work[0];
        const db=await new Promise(resolve=>{const request=indexedDB.open('rk-case-authoring-v1',1);request.onsuccess=()=>resolve(request.result);});
        const state=await new Promise(resolve=>{const request=db.transaction('projects').objectStore('projects').get(work.id);request.onsuccess=()=>resolve(request.result);});
        if (!state) throw new Error('Missing workspace for project ' + work.id);
        state.proposal={revision:JSON.stringify([work.id,work.title,work.client,work.study||{}]),summary:'Research-led proposal',questions:['What shipped?'],outline:['Research'],entries:[{block:{type:'text',heading:'Research',body:'We interviewed 12 people.'},evidence:[{sourceId:'notes',label:'Author notes',quote:'We interviewed 12 people.'}]}]};
        await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(state,work.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
      });
      await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
      await page.evaluate(()=>document.querySelectorAll('.pass--lock').forEach(dialog=>dialog.remove()));
      await page.locator('.adm__tab[data-tab="work"]').click();
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();await page.locator('[data-l2tab="gen"]').click();
      await page.locator('[data-act="csgen-review"]').waitFor();
      assert.equal(await page.locator('[data-csgen="material"]').inputValue(),'We interviewed 12 people.');
      await page.locator('[data-act="csgen-review"]').click();
      const dialog=page.locator('.csgen-review');
      assert.equal(await dialog.locator('pre').count(),0);
      assert.match(await dialog.locator('.csgen-review__preview').innerText(),/Research/);
      await dialog.locator('[data-apply]').click();assert.match(await dialog.locator('.pass__err').innerText(),/confirm/);
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study)),studyBefore);
      await dialog.locator('[data-target="0"]').selectOption('0');
      await dialog.locator('summary').filter({hasText:'Edit copy'}).click();
      await dialog.locator('[data-edit="0.heading"]').fill('Reviewed research');
      await dialog.locator('[data-verified]').check();
      if (width===1440) {
        await page.evaluate(()=>{window.caseOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='rk:content:draft')throw new DOMException('Fixture quota','QuotaExceededError');return window.caseOriginalSetItem.call(this,key,value);};});
        await dialog.locator('[data-apply]').click();
        assert.match(await dialog.locator('.pass__err').innerText(),/could not be saved/);
        assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study)),studyBefore);
        await page.evaluate(()=>{Storage.prototype.setItem=window.caseOriginalSetItem;});
      }
      assert.ok(await dialog.evaluate(element=>{const box=element.querySelector('.pass__box').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&element.querySelector('.pass__box').scrollWidth<=box.width+1;}));
      await page.screenshot({path:join(tmpdir(),'case-authoring-review-'+width+'.png')});
      await dialog.locator('[data-apply]').click();await dialog.waitFor({state:'detached'});
      const study=await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study);assert.equal(study.blocks.length,1);assert.equal(study.blocks[0].heading,'Reviewed research');assert.ok(!JSON.stringify(study).includes('sourceId'));
      await context.close();
    }
  } finally { await browser.close(); }
});

async function openIntegratedFixture(page, blocks = [{ type: "text", heading: "Published heading", body: "Supported source content." }], studyFields = {}, workFields = {}) {
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [
    { id: "integrated-case", client: "Studio fixture", title: "Integrated project", ...workFields, study: { ...studyFields, blocks } },
    { id: "empty-case", client: "Empty fixture", title: "Empty project", study: { blocks: [] } }
  ];
  await page.context().route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(published) });
    if (url.hostname === "models.dev") return route.fulfill({ contentType: "application/json", body: "{}" });
    if (url.hostname === "api.anthropic.com") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "session-model", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 32000, capabilities: { thinking: { supported: true }, structured_outputs: { supported: true } }, pricing: { input: 1, output: 3 } }] }) });
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => { localStorage.setItem("rk:dev:stub", "1"); localStorage.setItem("rk:ai:mode", "local"); localStorage.setItem("rk:ai:same", "0"); localStorage.setItem("rk:ai:txt:provider", "anthropic"); localStorage.setItem("rk:ai:txt:key", "synthetic-session-key"); });
  await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
  await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
  await page.evaluate(() => window.__rkDevStudio());
  await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
  await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
  await page.locator('.adm__tab[data-tab="work"]').click();
  return published;
}

test("Audience section references require actual recovered content and react to relocking", () => {
  const source = readFileSync(new URL('./src/js/project.js',import.meta.url),'utf8');
  const start = source.indexOf('  function isUnlocked('), end = source.indexOf('  /* ---------- locked-section decryption',start);
  const values = new Map(), events = [];
  const work = {id:'case',study:{blocks:[{type:'text',sectionId:'stable',locked:true,body:'Private source'}]}};
  const api = runInNewContext(source.slice(start,end)+';({setUnlocked,clearUnlocked,sectionAccess,resolveSection})',{
    normalizeSectionReference,structuredClone,Event,UNLOCK_KEY:'test:',activeId:null,
    sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    workById:id=>id===work.id?work:null,data:()=>({work:[work]}),window:{RK:{},dispatchEvent:event=>events.push(event.type)}
  });
  const reference = {version:1,caseStudyId:'case',sectionId:'stable'};
  assert.equal(api.resolveSection(reference),null);
  api.setUnlocked('case');
  const visible = api.resolveSection(reference);
  assert.equal(visible.block.body,'Private source');
  visible.block.body='Not the source';
  assert.equal(work.study.blocks[0].body,'Private source');
  work.study.blocks[0].encStub=true;
  assert.equal(api.resolveSection(reference),null);
  delete work.study.blocks[0].encStub;
  api.clearUnlocked('case');
  assert.equal(api.resolveSection(reference),null);
  assert.deepEqual(events,['rk:section-access','rk:section-access']);
  delete work.study.blocks[0].locked;
  assert.equal(api.resolveSection(reference).block.body,'Private source','Removing protection keeps existing references usable');
});

test("Ticket and Present-mode access notify existing section views after recovery and relock", async () => {
  const source = readFileSync(new URL('./src/js/render.js',import.meta.url),'utf8');
  const values = new Map(), events = [];
  const work = {id:'ticket-case',study:{blocks:[{type:'text',locked:true,body:'Recovered source'}]}};
  const environment = {
    Event,RK_UNLOCK_PREFIX:'unlock:',RK_PRESENT_IDS:'present-ids',RK_PRESENT_ACTIVE:'present-active',DRAFT_KEY:'draft',
    sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    localStorage:{getItem:()=>null},baseData:()=>({work:[work]}),hasStudioOwnerCopies:()=>false,
    window:{RK:{},dispatchEvent:event=>events.push({type:event.type,data:environment.window.RK.data,unlocked:values.get('unlock:ticket-case')})},
    showUnlockingBanner(){},showPresentBanner(){},render(){},revealAll(){},DATA:null,presentActive:false,presentOwnerKeys:new Map()
  };
  const markStart = source.indexOf('  function rkMarkUnlocked('), markEnd = source.indexOf('  async function rkDecryptStudyBlocks(',markStart);
  const presentStart = source.indexOf('  async function presentAll('), presentEnd = source.indexOf('  function exitPresent()',presentStart);
  const api = runInNewContext(source.slice(markStart,markEnd)+source.slice(presentStart,presentEnd)+';({rkMarkUnlocked,presentAll,rkClearPresent})',environment);
  api.rkMarkUnlocked('ticket-case');
  assert.equal(events.at(-1).unlocked,'1');
  assert.equal((await api.presentAll('synthetic-recovery')).ok,true);
  assert.equal(events.at(-1).data.work[0].study.blocks[0].body,'Recovered source');
  values.set('present-ids',JSON.stringify(['ticket-case']));
  api.rkClearPresent();
  assert.equal(events.at(-1).unlocked,undefined);
  assert.ok(events.every(event=>event.type==='rk:section-access'));
});

test("Protected section references survive legacy encryption and old vault recovery", async () => {
  const full = {type:'text',body:'Private original',sectionId:'old-body-id'}, sek = rkNewSek();
  const stub = {type:'text',locked:true,encStub:true,sectionId:'stable-reference',...await rkEncWithSek(sek,full)};
  for (const [file,name,endMarker] of [
    ['project.js','decryptStudyBlocks','  // Unlock a study'],
    ['render.js','rkDecryptStudyBlocks','  // A server-minted']
  ]) {
    const source = readFileSync(new URL('./src/js/'+file,import.meta.url),'utf8');
    const start = source.indexOf('async function '+name+'('), end = source.indexOf(endMarker,start);
    const decrypt = runInNewContext('('+source.slice(start,end)+')',{rkDecWithSek,rkResolveEncImages:async()=>{}});
    const study = {blocks:[structuredClone(stub)]};
    assert.equal(await decrypt(study,sek),true);
    assert.equal(study.blocks[0].sectionId,'stable-reference');
    assert.equal(study.blocks[0].locked,true);
  }
  const restored = await loadProtectedBlocks([{type:'text',locked:true,vaultBlock:'old-vault-body',sectionId:'stable-reference'}],{sign:async()=> 'https://example.test/vault',fetch:async()=>({ok:true,json:async()=>structuredClone(full)})});
  assert.equal(restored.blocks[0].sectionId,'stable-reference');
  assert.equal(restored.blocks[0].body,'Private original');
  assert.equal(restored.blocks[0].locked,true);
});

async function assertOpenShackle(icon, stacked = false) {
  const shape = await icon.evaluate(element => {
    const body = element.querySelector('rect').getBBox(), shackle = element.querySelector('path[d^="M13 "]');
    const start = shackle.getPointAtLength(0), tip = shackle.getPointAtLength(shackle.getTotalLength());
    return {body:{x:body.x,y:body.y,width:body.width},start:{x:start.x,y:start.y},tip:{x:tip.x,y:tip.y},stroke:parseFloat(getComputedStyle(shackle).strokeWidth),fill:getComputedStyle(shackle).fill,contained:[...element.children].every(part=>{
      const bounds=part.getBBox(),halfStroke=parseFloat(getComputedStyle(part).strokeWidth)/2;
      return bounds.x-halfStroke>=0 && bounds.y-halfStroke>=0 && bounds.x+bounds.width+halfStroke<=24 && bounds.y+bounds.height+halfStroke<=24;
    })};
  });
  assert.deepEqual(shape.body,{x:3,y:stacked?9:11,width:14});
  assert.deepEqual(shape.start,{x:13,y:shape.body.y});
  assert.deepEqual(shape.tip,{x:21,y:stacked?7:8});
  assert.ok(shape.tip.x-shape.body.x-shape.body.width-shape.stroke>=2,'The open tip clears the body even including stroke width');
  assert.ok(shape.body.y-shape.tip.y>=2,'The open tip is visibly above the body');
  assert.equal(shape.fill,'none');
  assert.equal(shape.contained,true,'The swung-open arm is not clipped');
}

test("Native toolbar and Layers share the clearly open lock", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    const base = process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5537';
    await page.goto(base+'/studio/slide-lab/');
    const native = page.locator('.excalidraw .lucide-lock-keyhole-open').first();
    await native.waitFor({state:'visible'});
    await assertOpenShackle(native);
    await page.screenshot({path:join(tmpdir(),'rk-open-lock-native-1440.png')});
    await page.goto(base+'/studio/slide-merge-lab/');
    await waitForSlideEditor(page);
    const documentSnapshot = () => page.evaluate(() => {
      const deck = window.__slideMerge.deck();
      for (const slide of deck.slides) if (slide.scene) {
        const { scrollX, scrollY, zoom, ...appState } = slide.scene.appState;
        slide.scene.appState = appState;
      }
      return deck;
    });
    const before = await documentSnapshot();
    await page.getByRole('button',{name:'Manage layers',exact:true}).click();
    const layer = page.getByRole('button',{name:'Lock layer',exact:true}).first();
    await assertOpenShackle(layer.locator('svg'));
    assert.equal(await layer.locator('circle').getAttribute('cx'),'10');
    assert.deepEqual(await documentSnapshot(),before);
    await page.screenshot({path:join(tmpdir(),'rk-open-lock-layers-1440.png')});
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Studio protected inserts share recovery-gated access across case and slideshow", {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const pass = 'synthetic-section-recovery', sek = rkNewSek(), wrap = await rkWrapSek(pass,sek);
  const media = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#237b70"/></svg>';
  const full = {type:'gallery',locked:true,heading:'Private prototype',kicker:'Private kicker',items:[{src:'vault:synthetic-original',caption:'Private caption'}]};
  const encrypted = {type:'gallery',locked:true,encStub:true,...await rkEncWithSek(sek,full)};
  const assertAccessLabel = async (control, text, width) => {
    assert.equal(await control.locator('span').textContent(),text);
    assert.ok((await control.getAttribute('aria-label')).startsWith(text+':'),'The visible label is included in its accessible name');
    const icon = control.locator('svg'), iconBounds = await icon.boundingBox();
    assert.equal(iconBounds.width,18);
    assert.equal(iconBounds.height,18);
    assert.equal(await icon.locator('[data-lock-stack]').count(),1);
    assert.equal(await icon.locator('[data-lock-stack]').evaluate(element=>getComputedStyle(element).fill),'none');
    if (text==='Unlocked') await assertOpenShackle(icon,true);
    assert.deepEqual(await icon.locator('path').evaluateAll(elements=>elements.map(element=>element.getAttribute('d'))),[
      'M20 12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9',
      text==='Unlocked'?'M13 9V6a4 4 0 0 1 8 0v1':'M6 9V6a4 4 0 0 1 8 0v3'
    ]);
    assert.equal(await icon.evaluate(element=>[...element.children].every(shape=>{
      const box=shape.getBBox(),halfStroke=parseFloat(getComputedStyle(shape).strokeWidth)/2;
      return box.x-halfStroke>=0 && box.y-halfStroke>=0 && box.x+box.width+halfStroke<=24 && box.y+box.height+halfStroke<=24;
    })),true,'Both lock layers fit inside their icon');
    const bounds = await control.boundingBox();
    assert.equal(bounds.height,34);
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,'The labelled access toggle fits the viewport');
    const labelGeometry = await control.evaluate(element=>{
      const label=element.querySelector('span'),box=element.getBoundingClientRect(),labelBox=label.getBoundingClientRect();
      return { unclipped:element.scrollWidth<=element.clientWidth && labelBox.width>0 && labelBox.left>=box.left && labelBox.right<=box.right && label.scrollWidth<=label.clientWidth,
        text:label.textContent,controlWidth:box.width,controlScroll:element.scrollWidth,controlClient:element.clientWidth,
        labelWidth:labelBox.width,labelScroll:label.scrollWidth,labelClient:label.clientWidth,font:getComputedStyle(label).font,spacing:getComputedStyle(label).letterSpacing };
    });
    assert.equal(labelGeometry.unclipped,true,'The label is visible and unclipped: '+JSON.stringify(labelGeometry));
    return bounds.width;
  };
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:width===1440?'no-preference':'reduce'}), page = await context.newPage();
      const errors = [];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(() => { window.__rkAdminAuth = { session: { token: 'synthetic-section-test', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 }; });
      await openIntegratedFixture(page,[{type:'text',heading:'Public section',body:'Public source'},encrypted],{enc:{wraps:{owner:wrap}}});
      const progress = await page.locator('.adm__statusbar').evaluate(element => {
        const style = getComputedStyle(element,'::after');
        return {top:style.top,height:style.height,pointerEvents:style.pointerEvents};
      });
      assert.deepEqual(progress,{top:'-2px',height:'2px',pointerEvents:'none'});
      const draftBeforeSimulation = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
      await page.evaluate(()=>{window.progressSimulation=window.__rkPubSim('recoverable');});
      await page.waitForFunction(()=>parseFloat(document.querySelector('.adm__statusbar').style.getPropertyValue('--pub-pct'))>=50);
      const activeProgress = await page.locator('.adm__statusbar').evaluate(element=>{
        const style=getComputedStyle(element,'::after'),box=element.getBoundingClientRect();
        return {opacity:style.opacity,color:style.backgroundColor,width:parseFloat(style.width),top:box.top+parseFloat(style.top),bottom:box.top+parseFloat(style.top)+parseFloat(style.height),barTop:box.top};
      });
      assert.ok(Number(activeProgress.opacity)>=0.9,'The active progress line is visible');
      assert.equal(activeProgress.color,'rgb(216, 166, 87)');
      assert.ok(activeProgress.width>0 && activeProgress.top>=0 && activeProgress.bottom<=activeProgress.barTop);
      await page.screenshot({path:join(tmpdir(),'rk-studio-progress-'+width+'.png')});
      await page.evaluate(()=>window.progressSimulation);
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),draftBeforeSimulation);
      let privateReads = 0;
      await context.route('**/vault/**',route=> {
        const url = new URL(route.request().url());
        if (url.pathname === '/vault/sign') return route.fulfill({json:{url:'/vault/file/synthetic-original?sig=synthetic-only'}});
        if (url.pathname === '/vault/file/synthetic-original') { privateReads++; return route.fulfill({contentType:'image/svg+xml',body:media}); }
        return route.abort();
      });
      await openProjectSlides(page);
      await page.locator('.merge-empty-actions button').first().click();
      await page.getByRole('button',{name:'Sections',exact:true}).click();
      const choice = page.locator('.merge-section-choices button').filter({hasText:'Protected section'});
      await choice.waitFor();
      assert.equal(await choice.isEnabled(),true);
      assert.doesNotMatch(await page.locator('.merge-section-choices').innerText(),/Private prototype|Private caption/);
      await choice.click();
      await page.locator('.lab-canvas > .merge-native-sections .merge-section-locked').waitFor();
      assert.equal(privateReads,0);
      const access = page.locator('[data-native-slide-toolbar] .merge-section-access');
      assert.equal(await access.getAttribute('aria-checked'),'false');
      const accessWidth = await assertAccessLabel(access,'Locked',width);
      assert.equal(await page.locator('.adm__statusbar [data-lock-stack]').count(),0,'The footer keeps its single-lock icon');
      assert.equal(await access.locator('rect').evaluate(element=>getComputedStyle(element).fill),'rgb(216, 166, 87)');
      const accessBox = await access.boundingBox(), editingBox = await page.locator('[data-native-slide-toolbar] [aria-label="Editing on"]').boundingBox();
      assert.ok(accessBox.x+accessBox.width<=editingBox.x);
      await page.screenshot({path:join(tmpdir(),'rk-access-stack-locked-'+width+'.png')});
      await access.click();
      const prompt = page.locator('.pass').filter({has:page.getByText('Recovery passphrase',{exact:true})});
      await prompt.waitFor();
      assert.equal(await assertAccessLabel(access,'Unlocking',width),accessWidth);
      await prompt.locator('[data-cancel]').click();
      await page.waitForFunction(()=>document.querySelector('[data-native-slide-toolbar] .merge-section-access')?.getAttribute('aria-busy')==='false');
      assert.equal(await access.getAttribute('aria-checked'),'false');
      assert.equal(await assertAccessLabel(access,'Locked',width),accessWidth);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1].encStub),true);
      await access.click();
      await prompt.locator('input[type="password"]').fill(pass);
      await prompt.locator('[data-go]').click();
      await page.waitForFunction(()=>document.querySelector('[data-native-slide-toolbar] .merge-section-access')?.getAttribute('aria-checked')==='true');
      assert.equal(await assertAccessLabel(access,'Unlocked',width),accessWidth);
      await page.frameLocator('.lab-canvas > .merge-native-sections iframe.lab-section-component').getByText('Private prototype',{exact:true}).waitFor();
      await page.waitForFunction(()=>document.querySelector('.lab-canvas > .merge-native-sections iframe.lab-section-component')?.contentDocument.querySelector('img')?.naturalWidth===640);
      await page.screenshot({path:join(tmpdir(),'rk-protected-insert-'+width+'.png')});
      const closePanel = page.getByRole('button',{name:'Close panel',exact:true});
      if (await closePanel.isVisible()) await closePanel.click();
      const protectedBounds = await page.locator('.lab-canvas > .merge-native-sections iframe.lab-section-component').boundingBox();
      await page.mouse.click(protectedBounds.x+8,protectedBounds.y+8,{button:'right'});
      await page.getByText('Show/hide',{exact:true}).click();
      const visibility = page.getByRole('menu',{name:'Show/hide',exact:true});
      assert.deepEqual(await visibility.getByRole('menuitemcheckbox').allTextContents(),['Heading','Kicker','Caption']);
      await visibility.getByRole('menuitemcheckbox',{name:'Caption',exact:true}).click();
      await page.frameLocator('.lab-canvas > .merge-native-sections iframe.lab-section-component').getByText('Private caption',{exact:true}).waitFor({state:'hidden'});
      await page.keyboard.press('Escape');
      await access.click();
      await page.locator('.lab-canvas > .merge-native-sections .merge-section-locked').waitFor();
      assert.equal(await page.locator('.lab-canvas > .merge-native-sections iframe.lab-section-component').count(),0);
      await page.locator('[data-l2tab="story"]').click();
      await page.locator('.study-sections').waitFor();
      const caseAccess = page.locator('[data-section-access]');
      assert.equal(await caseAccess.getAttribute('aria-checked'),'false');
      const caseWidth = await assertAccessLabel(caseAccess,'Locked',width);
      assert.equal(await caseAccess.locator('rect').evaluate(element=>getComputedStyle(element).fill),'rgb(216, 166, 87)');
      const previewToggle = page.locator('[data-prevtoggle]');
      await previewToggle.click();
      assert.equal(await caseAccess.locator('rect').evaluate(element=>getComputedStyle(element).fill),'rgb(216, 166, 87)');
      await previewToggle.click();
      assert.equal(await page.locator('.study-sections input[data-bfield="heading"][value="Private prototype"]').count(),0);
      assert.equal(await page.locator('.study-sections .study__block--enc').count(),1);
      const caseBox = await caseAccess.boundingBox(), splitBox = await page.locator('[data-prevtoggle]').boundingBox();
      assert.ok(caseBox.x+caseBox.width<=splitBox.x);
      await caseAccess.click();
      await page.waitForFunction(()=>document.querySelector('[data-section-access]')?.getAttribute('aria-checked')==='true');
      assert.equal(await assertAccessLabel(caseAccess,'Unlocked',width),caseWidth);
      assert.equal(await caseAccess.locator('rect').evaluate(element=>getComputedStyle(element).fill),'none');
      assert.equal(await caseAccess.evaluate(element=>getComputedStyle(element).color),'rgb(143, 138, 132)');
      const publicSectionHead = page.locator('.study-sections .study__block-head[data-bindex="0"]');
      for (let toggles=0; toggles<3 && !await publicSectionHead.isVisible(); toggles++) await previewToggle.click();
      await publicSectionHead.click();
      await assertOpenShackle(page.locator('.study__block-lock:not(.is-locked):visible svg').first());
      await page.screenshot({path:join(tmpdir(),'rk-access-case-'+width+'.png')});
      await page.locator('[data-l2tab="slides"]').click();
      await page.frameLocator('.lab-canvas > .merge-native-sections iframe.lab-section-component').getByText('Private prototype',{exact:true}).waitFor();
      const opening = page.waitForEvent('popup');
      await page.locator('[data-native-slide-toolbar] .merge-bar-play').click();
      const audience = await opening;
      audience.on('pageerror',error=>errors.push(error.message));
      await audience.frameLocator('.merge-present-stage iframe.lab-section-component').getByText('Private prototype',{exact:true}).waitFor();
      await audience.waitForFunction(()=>document.querySelector('.merge-present-stage iframe.lab-section-component')?.contentDocument.querySelector('img')?.naturalWidth===640);
      assert.equal(await audience.frameLocator('.merge-present-stage iframe.lab-section-component').getByText('Private caption',{exact:true}).isHidden(),true);
      await page.evaluate(()=>window.__RKStudio.toggleSections('integrated-case'));
      await audience.locator('.merge-present-stage .merge-section-locked').waitFor();
      assert.equal(await audience.locator('.merge-present-stage iframe.lab-section-component').count(),0);
      await page.evaluate(()=>window.__RKStudio.unlockSections('integrated-case'));
      await audience.frameLocator('.merge-present-stage iframe.lab-section-component').getByText('Private prototype',{exact:true}).waitFor();
      assert.equal(await audience.frameLocator('.merge-present-stage iframe.lab-section-component').getByText('Private caption',{exact:true}).isHidden(),true);
      await audience.screenshot({path:join(tmpdir(),'rk-protected-audience-'+width+'.png')});
      const audienceClosed = audience.waitForEvent('close');
      await audience.getByRole('button', {name:'Exit presentation', exact:true}).click();
      await audienceClosed;
      await page.locator('[data-l2-back]').click();
      const saved = await page.evaluate(async()=>{
        const reference=window.__RKStudio.getDraft().work[0].study.nativeDeck;
        const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('rk-studio-slide-decks-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        try{return await new Promise((resolve,reject)=>{const request=database.transaction('documents').objectStore('documents').get([reference.id,reference.revision]);request.onsuccess=()=>resolve(request.result.document);request.onerror=()=>reject(request.error);});}finally{database.close();}
      });
      const component=saved.slides[0].scene.elements.find(element=>element.customData?.sectionReference);
      assert.equal(component.customData.sectionReference.caseStudyId,'integrated-case');
      assert.deepEqual(component.customData.sectionTextVisibility,{caption:false});
      assert.doesNotMatch(JSON.stringify(saved),/Private prototype|Private caption|Private kicker|base64,|synthetic-original|synthetic-only|sectionComponent/);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1].locked),true);
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();}
});

test("Studio section recovery preserves navigation, newer edits and failed saves in the browser", {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const pass = 'synthetic-stale-recovery', wrap = await rkWrapSek(pass,rkNewSek());
  try {
    for (const width of [1440,390]) for (const scenario of ['navigate','edit','save-failure']) {
      const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}), page = await context.newPage();
      const errors = []; page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        window.__rkAdminAuth = { session: { token: 'synthetic-stale-recovery', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
        const originalFetch = window.fetch;
        window.fetch = function(resource,options) {
          const address = typeof resource === 'string' ? resource : resource.url;
          if (!address.includes('/vault/file/stale-section')) return originalFetch.call(this,resource,options);
          window.syntheticVaultStarted = true;
          return new Promise(resolve=>{window.releaseSyntheticVault=()=>resolve(new Response(JSON.stringify({type:'text',locked:true,heading:'Recovered private heading',body:'Recovered private body'}),{headers:{'Content-Type':'application/json'}}));});
        };
      });
      await openIntegratedFixture(page,[{type:'text',heading:'Public heading',body:'Original public body'},{type:'text',locked:true,sectionId:'stale-source',vaultBlock:'stale-section'}],{enc:{wraps:{owner:wrap}}});
      await context.route('**/vault/sign?**',route=>route.fulfill({json:{url:'/vault/file/stale-section'}}));
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-section-access]').click();
      const prompt = page.locator('.pass').filter({has:page.getByText('Recovery passphrase',{exact:true})});
      await prompt.locator('input[type="password"]').fill(pass);
      await prompt.locator('[data-go]').click();
      await page.waitForFunction(()=>window.syntheticVaultStarted);
      assert.equal(await page.locator('[data-section-access] span').textContent(),'Unlocking');
      if (scenario==='navigate') {
        await page.locator('[data-l2-back]').click();
        await page.locator('[data-act="study-toggle"][data-index="1"]').click();
      } else if (scenario==='edit') {
        await page.evaluate(()=>window.__rkDevEdit('work.0.study.blocks.0.body','Newer source edit during recovery'));
      } else {
        await page.evaluate(()=>{
          window.originalSetItem=Storage.prototype.setItem;
          Storage.prototype.setItem=function(key,value){if(key==='rk:content:draft')throw new DOMException('Synthetic quota','QuotaExceededError');return window.originalSetItem.call(this,key,value);};
        });
      }
      const before = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
      await page.evaluate(()=>window.releaseSyntheticVault());
      await page.waitForFunction(()=>!window.__RKStudio.sectionAccess('integrated-case').busy);
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),before,scenario+' at '+width);
      assert.equal(await page.evaluate(()=>window.__RKStudio.sectionAccess('integrated-case').unlocked),false);
      assert.equal(await page.locator('input[data-bfield="heading"][value="Recovered private heading"]').count(),0);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1].vaultBlock),'stale-section');
      if (scenario==='save-failure') {
        assert.match(await page.locator('.adm__statusbar').innerText(),/could not be saved|unchanged/i);
        await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
      }
      if (scenario==='navigate') {
        assert.equal(await page.evaluate(()=>window.__RKStudio.sectionAccess('empty-case').unlocked),false);
        await page.locator('[data-l2-back]').click();
        await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      }
      await page.evaluate(()=>{window.syntheticVaultStarted=false;});
      await page.locator('[data-section-access]').click();
      await page.waitForFunction(()=>window.syntheticVaultStarted);
      await page.evaluate(()=>window.releaseSyntheticVault());
      await page.waitForFunction(()=>window.__RKStudio.sectionAccess('integrated-case').unlocked);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1].locked),true);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].body),scenario==='edit'?'Newer source edit during recovery':'Original public body');
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();}
});

test("Section Show/hide preserves source media, undo and independent saved instances", {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const media = 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#237b70"/></svg>').toString('base64');
  const source = {type:'text',heading:'Instance heading',kicker:'Instance kicker',body:'<p>Original description</p><figure><img src="'+media+'"><figcaption>Original caption</figcaption></figure>'};
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}), page = await context.newPage();
      const errors = [];page.on('pageerror',error=>errors.push(error.message));
      await openIntegratedFixture(page,[source]);
      await openProjectSlides(page);
      await page.locator('.merge-empty-actions button').first().click();
      await page.getByRole('button',{name:'Sections',exact:true}).click();
      await page.locator('.merge-section-choices button').filter({hasText:'Instance heading'}).click();
      const closePanel = page.getByRole('button',{name:'Close panel',exact:true});
      if (await closePanel.isVisible()) await closePanel.click();
      const frame = page.frameLocator('.lab-canvas > .merge-native-sections iframe.lab-section-component');
      await frame.getByText('Instance heading',{exact:true}).waitFor();
      await frame.locator('img').evaluate(image=>{window.retainedImage=image;});
      const bounds = await page.locator('.lab-canvas > .merge-native-sections iframe.lab-section-component').boundingBox();
      await page.mouse.click(bounds.x+8,bounds.y+8,{button:'right'});
      await page.getByText('Show/hide',{exact:true}).click();
      const menu = page.getByRole('menu',{name:'Show/hide',exact:true});
      await menu.waitFor();
      assert.deepEqual(await menu.getByRole('menuitemcheckbox').allTextContents(),['Heading','Kicker','Description','Caption']);
      for (const label of ['Heading','Kicker','Description','Caption']) {
        const item = menu.getByRole('menuitemcheckbox',{name:label,exact:true});
        assert.equal(await item.getAttribute('aria-checked'),'true');
        await item.click();
        await page.waitForFunction(label=>[...document.querySelectorAll('.merge-section-visibility button')].find(button=>button.textContent===label)?.getAttribute('aria-checked')==='false',label);
      }
      assert.equal(await frame.getByText('Instance heading',{exact:true}).isHidden(),true);
      assert.equal(await frame.getByText('Instance kicker',{exact:true}).isHidden(),true);
      assert.equal(await frame.getByText('Original description',{exact:true}).isHidden(),true);
      assert.equal(await frame.getByText('Original caption',{exact:true}).isHidden(),true);
      assert.equal(await frame.locator('img').isVisible(),true);
      assert.equal(await frame.locator('img').evaluate(image=>image===window.retainedImage),true);
      const menuBox = await menu.boundingBox();
      assert.ok(menuBox.x>=0 && menuBox.x+menuBox.width<=width+1 && menuBox.y>=0 && menuBox.y+menuBox.height<=1001);
      assert.ok(menuBox.y>=bounds.y-8,'Show/hide stays beside the selected section, not the viewport corner');
      await page.screenshot({path:join(tmpdir(),'rk-section-visibility-'+width+'.png')});
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'Undo',exact:true}).click();
      await frame.getByText('Original caption',{exact:true}).waitFor({state:'visible'});
      await page.getByRole('button',{name:'Redo',exact:true}).click();
      await frame.getByText('Original caption',{exact:true}).waitFor({state:'hidden'});
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks),[source]);
      await page.locator('[data-l2-back]').click();
      await page.reload();
      await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
      await page.evaluate(()=>document.querySelectorAll('.pass--lock').forEach(dialog=>dialog.remove()));
      await page.locator('.adm__tab[data-tab="work"]').click();
      await openProjectSlides(page);
      await frame.locator('.pjb__h').waitFor({state:'attached'});
      assert.equal(await frame.getByText('Instance heading',{exact:true}).isHidden(),true);
      await page.getByRole('button',{name:'Sections',exact:true}).click();
      await page.locator('.merge-section-choices button').filter({hasText:'Instance heading'}).click();
      const frames = page.locator('.lab-canvas > .merge-native-sections iframe.lab-section-component');
      await frames.nth(1).waitFor();
      await page.frameLocator('.lab-canvas > .merge-native-sections iframe.lab-section-component').nth(1).getByText('Instance heading',{exact:true}).waitFor();
      assert.equal(await page.frameLocator('.lab-canvas > .merge-native-sections iframe.lab-section-component').nth(0).getByText('Instance heading',{exact:true}).isHidden(),true);
      await page.locator('[data-l2-back]').click();
      const saved = await page.evaluate(async()=>{
        const reference=window.__RKStudio.getDraft().work[0].study.nativeDeck;
        const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('rk-studio-slide-decks-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        try{return await new Promise((resolve,reject)=>{const request=database.transaction('documents').objectStore('documents').get([reference.id,reference.revision]);request.onsuccess=()=>resolve(request.result.document);request.onerror=()=>reject(request.error);});}finally{database.close();}
      });
      const instances = saved.slides[0].scene.elements.filter(element=>element.customData?.sectionComponent);
      assert.equal(instances.length,2);
      assert.deepEqual(instances[0].customData.sectionTextVisibility,{heading:false,kicker:false,description:false,caption:false});
      assert.equal(instances[1].customData.sectionTextVisibility,undefined);
      for (const instance of instances) assert.deepEqual(instance.customData.sectionComponent,source);
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();}
});

test("Sections protected headers keep More before an actionable lock and consistent reassurance", () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const start = source.indexOf('  function blockActionMenu('), end = source.indexOf('  function smeta(',start);
  const render = runInNewContext(source.slice(start,end)+'\nblockEditor', {
    studyBlockTypeName: block => block.type, escHtml: String, GRIP_SVG: '',
    IC: new Proxy({}, { get: () => '' }), svgIco: markup => markup
  });
  for (const block of [{type:'media',encStub:true},{type:'gallery',vaultBlock:'private-reference'}]) {
    const html = render(0,block,0,1,false);
    assert.ok(html.indexOf('class="study__actions"') < html.indexOf('class="iconbtn study__protected-lock"'));
    assert.match(html, /<button[^>]*study__protected-lock[^>]*data-act="study-decrypt"[^>]*aria-label="Unlock section"/);
    assert.match(html, /Your content is safe and protected/);
    assert.doesNotMatch(html, /isn.t in your published file|study__block-chev/);
  }
});

test("Protected section identity survives encrypted and vault publication without exposing content", async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const block = {type:'text',sectionId:'section-stable',locked:true,heading:'Private heading',body:'Private source'};
  const encryptedStart = source.indexOf('  function makeStub(');
  const makeStub = runInNewContext(source.slice(encryptedStart,source.indexOf('  // Destructive-action confirm',encryptedStart))+'\nmakeStub',{rkEncWithSek});
  const sek = rkNewSek(), encrypted = await makeStub(sek,block);
  assert.equal(encrypted.sectionId,block.sectionId);
  assert.deepEqual(await rkDecWithSek(sek,encrypted),block);
  assert.doesNotMatch(JSON.stringify(encrypted),/Private heading|Private source/);
  const vaultStart = source.indexOf('  async function vaultBlockPointer(');
  const makePointer = runInNewContext(source.slice(vaultStart,source.indexOf('  async function encryptLockedForPublish(',vaultStart))+'\nvaultBlockPointer',{Blob,vaultBlockKeys:{},vaultUpload:async ()=>'opaque-key'});
  const vaulted = await makePointer('case',block);
  assert.equal(vaulted.sectionId,block.sectionId);
  assert.equal(vaulted.vaultBlock,'opaque-key');
  assert.doesNotMatch(JSON.stringify(vaulted),/Private heading|Private source/);
});

test("Studio global section unlock verifies recovery and rejects stale or unsaved results", async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const start = source.indexOf('  var studyUnlockRequests = new Map();');
  const code = source.slice(start,source.indexOf('  var removingSectionProtection',start));
  const sek = rkNewSek(), pass = 'synthetic-recovery', wrap = await rkWrapSek(pass,sek);
  const encrypted = await rkEncWithSek(sek,{type:'text',heading:'Private heading',body:'Preserved source'});
  for (const scenario of ['success','cancel','wrong','navigate','edit','save-failure','vault-failure','relock']) {
    const sealed = scenario==='vault-failure' ? {type:'text',locked:true,sectionId:'stable',vaultBlock:'opaque'} : {type:'text',locked:true,sectionId:'stable',encStub:true,...encrypted};
    const blocks = [sealed], work = {id:'case',study:{blocks,enc:{wraps:{owner:wrap}}}};
    let prompts = 0, saves = 0, unlocked = false, release;
    const environment = {
      data:{work:[work]},openStudy:0,root:{classList:{contains:()=>true}},AbortController,
      window:{addEventListener(){},removeEventListener(){}},paintStudyAccess(){},
      ensureRecoveryPass:()=>{prompts++;return new Promise(resolve=>{release=resolve;});},
      rkUnwrapSek,rkDecWithSek,rkResolveEncToDataUri:async()=>{},loadProtectedBlocks,
      adminSession:()=>true,vaultSignedUrl:async()=>null,fetch:async()=>{throw new Error('Unexpected fetch');},
      saveDraft:()=>{saves++;return scenario!=='save-failure';},setStudyContentAccess:()=>{unlocked=true;},
      renderL2(){},refreshL2Preview(){},status(){},recoveryPassCache:null
    };
    const api = runInNewContext(code+'\n({unlock:decryptStudyForEdit,requests:studyUnlockRequests})',environment);
    const pending = api.unlock(0), repeated = api.unlock(0);
    assert.equal(prompts,1);
    if (scenario==='navigate') environment.openStudy=1;
    if (scenario==='edit') sealed.editorName='Newer user edit';
    if (scenario==='relock') api.requests.get('case').controller.abort();
    release(scenario==='cancel'?null:scenario==='wrong'?'incorrect':pass);
    assert.equal(await pending,scenario==='success');
    await repeated;
    assert.equal(api.requests.size,0);
    assert.equal(unlocked,scenario==='success');
    if (scenario==='success') {
      assert.equal(work.study.blocks[0].sectionId,'stable');
      assert.equal(work.study.blocks[0].locked,true);
      assert.equal(work.study.blocks[0].body,'Preserved source');
      assert.equal(saves,1);
    } else {
      assert.equal(work.study.blocks,blocks);
      assert.equal(work.study.blocks[0],sealed);
      assert.equal(saves,scenario==='save-failure'?1:0);
    }
  }
});

test("Sections remove protection requires unlock and preserves sealed data on failure", async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const start = source.indexOf('  var removingSectionProtection = new WeakSet();');
  const code = source.slice(start,source.indexOf('  // Owner-only: turn a hidden encrypted project',start));
  const sek = rkNewSek(), pass = 'synthetic-test-pass', full = {type:'media',locked:true,heading:'Restored',items:[{src:'data:image/png;base64,AA=='}]};
  const wrap = await rkWrapSek(pass,sek), cipher = await rkEncWithSek(sek,full);
  for (const scenario of ['cancel','cancel-pass','wrong-pass','legacy','vault','denied','invalid','save-failure','stale']) {
    const vaulted = ['vault','denied','invalid','stale'].includes(scenario);
    const sealed = vaulted ? {type:'media',locked:true,vaultBlock:'private-original'} : {type:'media',locked:true,encStub:true,...cipher};
    const other = {type:'text',heading:'Unchanged'}, study = {blocks:[sealed,other],enc:{wraps:{owner:wrap}}};
    let saves = 0, fetches = 0;
    const environment = {data:{work:[{id:'case',study}]},openBlock:-1,recoveryPassCache:null,
      confirmModal:async()=>scenario!=='cancel',adminSession:()=>scenario!=='denied',
      ensureRecoveryPass:async()=>scenario==='cancel-pass'?null:scenario==='wrong-pass'?'wrong':pass,
      vaultSignedUrl:async()=>{if(scenario==='stale')study.blocks.splice(0,1);return 'https://synthetic.invalid/section';},
      fetch:async()=>{fetches++;return {ok:true,json:async()=>scenario==='invalid'?{encStub:true}:{...structuredClone(full),items:[{src:'vault:original-bytes'}]}};},
      rkUnwrapSek,rkDecWithSek,rkResolveEncToDataUri:async()=>{},saveDraft:()=>{saves++;return scenario!=='save-failure';},
      renderL2:()=>{},refreshL2Preview:()=>{},status:()=>{}};
    const remove = runInNewContext(code+'\nremoveSectionProtection',environment);
    await remove(0,0);
    if (scenario==='legacy'||scenario==='vault') {
      assert.equal(study.blocks[0].locked,undefined);
      assert.equal(study.blocks[0].heading,'Restored');
      assert.equal(study.blocks[1],other);
      assert.equal(study.blocks[0].items[0].src,scenario==='vault'?'vault:original-bytes':full.items[0].src);
      assert.equal(study.blocks[0].vault,scenario==='vault'?true:undefined);
      assert.equal(saves,1);
    } else if (scenario==='stale') { assert.deepEqual(study.blocks,[other]);assert.equal(saves,0); }
    else { assert.equal(study.blocks[0],sealed);assert.equal(sealed.locked,true);assert.equal(saves,scenario==='save-failure'?1:0); }
    if (scenario==='cancel'||scenario==='denied') assert.equal(fetches,0);
  }
});

test("Sections insertion opens the real picker at the selected gap", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,reducedMotion:"reduce"});
      const page = await context.newPage();
      await openIntegratedFixture(page,[{type:"text",heading:"First",body:"Keep first"},{type:"text",heading:"Second",body:"Keep second"}]);
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="story"]').click();
      const gap = page.locator('.study-sections .study__insert-gap').first();
      await gap.click();
      await page.locator('.secpick .pass__title').filter({hasText:"Add a section above"}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks.map(block=>block.heading)),["First","Second"]);
      await page.locator('.secpick [data-pick="cards"]').click();
      const inserted = await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks);
      assert.deepEqual(inserted.map(block=>block.type),["text","cards","text"]);
      assert.equal(inserted[0].heading,"First");
      assert.equal(inserted[2].heading,"Second");
      await context.close();
    }
  } finally { await browser.close(); }
});

test("Sections duplication opens the copy in view for immediate editing", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:844},hasTouch:width===390,reducedMotion:"reduce"});
      const page = await context.newPage();
      await openIntegratedFixture(page,Array.from({length:18},(_,index)=>({type:"text",heading:"Section "+index,body:"Original content "+index})));
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="story"]').click();
      for (const expanded of [false,true]) {
        const rows = page.locator('.study-sections .study__block');
        const source = rows.nth(16);
        if (expanded) {
          await source.locator('.study__block-label').click();
          await page.waitForFunction(()=>document.querySelectorAll('.study-sections .study__block')[16].classList.contains('is-open'));
        }
        await source.locator('summary').click();
        await source.locator('.study__action-menu [data-act="study-blockdup"]').click();
        const copy = rows.nth(17);
        assert.equal(await copy.evaluate(element=>element.classList.contains('is-open')),true);
        assert.equal(await page.locator('.study-sections .study__block.is-open').count(),1);
        const heading = copy.locator('input[data-bfield="heading"]');
        const bounds = await heading.boundingBox();
        assert.ok(bounds && bounds.y>=0 && bounds.y+bounds.height<=844,'Copy heading must be visible without scrolling');
        await heading.fill('Edited copy');
        await heading.blur();
        const blocks = await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks);
        assert.equal(blocks[16].heading,'Section 16');
        assert.equal(blocks[17].heading,'Edited copy');
        assert.equal(blocks[17].body,blocks[16].body);
      }
      await context.close();
    }
  } finally { await browser.close(); }
});

test("Sections controls preserve names, checked states and protected content", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,reducedMotion:"reduce"});
      const page = await context.newPage();
      await openIntegratedFixture(page,[{type:"text",heading:"First",body:"Keep content"},{type:"text",heading:"Second",sep:false},{type:"media",locked:true,encStub:true},{type:"text",locked:true,vaultBlock:true}]);
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="story"]').click();
      const row = page.locator('.study-sections .study__block').first();
      const label = row.locator('.study__block-label');
      await label.dblclick();
      await row.locator('.study__block-rename').fill('Custom section name');
      await row.locator('.study__block-rename').press('Enter');
      assert.equal(await label.textContent(),'Custom section name');
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].heading),'First');
      await label.dblclick();
      await row.locator('.study__block-rename').fill('Discard this');
      await row.locator('.study__block-rename').press('Escape');
      assert.equal(await label.textContent(),'Custom section name');
      const openMenu = async () => { await row.locator('summary').focus(); await row.locator('summary').press('Enter'); await row.locator('.study__action-menu:popover-open').waitFor(); };
      for (const [command,initial] of [['sep','true'],['off','false']]) {
        await openMenu();
        const toggle = row.locator('.study__action-menu [data-act="study-block'+command+'"]');
        assert.equal(await toggle.getAttribute('aria-pressed'),initial);
        await toggle.click();
        await openMenu();
        assert.equal(await toggle.getAttribute('aria-pressed'),initial==='true'?'false':'true');
        assert.equal(await toggle.locator('.study__action-check svg').count(),initial==='true'?0:1);
        await page.keyboard.press('Escape');
        assert.equal(await row.locator('summary').evaluate(element=>element===document.activeElement),true);
      }
      await openMenu();
      assert.equal(await row.locator('.study__action-menu [data-act="study-blocklock"] rect').evaluate(element=>getComputedStyle(element).fill),'none');
      const bounds = await row.locator('.study__action-menu').boundingBox();
      assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=1000);
      await row.locator('.study__action-menu [data-act="study-blocklock"]').click();
      await row.locator('.study__protected-lock').waitFor();
      assert.equal(await row.locator('.study__protected-lock rect').evaluate(element=>getComputedStyle(element).fill),'rgb(216, 166, 87)');
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].body),'Keep content');
      const sealed = page.locator('.study-sections .study__block--enc');
      assert.equal(await sealed.count(),3);
      assert.equal(await sealed.locator('input,textarea,.study__block-rename,.study__block-chev').count(),0);
      assert.equal(await sealed.locator('[data-act="study-decrypt"]').count(),6);
      assert.equal(await sealed.locator('[data-act="study-blockremove"]').count(),0);
      assert.equal(await sealed.locator('[data-act="study-unprotect"]').count(),3);
      const sealedBefore = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks.slice(2)));
      await sealed.first().locator('summary').click();
      await sealed.first().locator('[data-act="study-unprotect"]').click();
      await page.getByText('Remove section protection?',{exact:true}).waitFor();
      await page.locator('.pass').filter({hasText:'Remove section protection?'}).getByRole('button',{name:'Cancel',exact:true}).click();
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks.slice(2))),sealedBefore);
      assert.equal(await sealed.first().locator('[data-act="study-decrypt"]').first().isEnabled(),true);
      assert.equal(await sealed.first().locator('.study__protected-lock rect').evaluate(element=>getComputedStyle(element).fill),'rgb(216, 166, 87)');
      await page.screenshot({path:join(tmpdir(),`rk-sections-${width}.png`)});
      await page.reload();
      await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].editorName),'Custom section name');
      await context.close();
    }
  } finally { await browser.close(); }
});

test("Sections protected menus move sealed data intact and allow insertion above", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:844},hasTouch:width===390,reducedMotion:"reduce"});
      const page = await context.newPage();
      const encrypted = {type:"media",locked:true,encStub:true,iv:"original-iv",ct:"original-ciphertext"};
      const vaulted = {type:"media",locked:true,vaultBlock:"original-vault-reference"};
      await openIntegratedFixture(page,[encrypted,{type:"text",heading:"Middle"},vaulted]);
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="story"]').click();
      const rows = page.locator('.study-sections .study__block');
      const openMenu = async index => {
        const row = rows.nth(index);
        await row.locator('summary').click();
        const menu = row.locator('.study__action-menu:popover-open');
        await menu.waitFor();
        assert.deepEqual(await menu.locator('button').evaluateAll(buttons=>buttons.map(button=>button.dataset.act)),['study-blockadd','study-blockup','study-blockdown','study-unprotect']);
        const bounds = await menu.boundingBox();
        assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=844);
        const lock = await row.locator('.study__protected-lock').boundingBox();
        const trigger = await row.locator('summary').boundingBox();
        assert.ok(trigger.x+trigger.width<=lock.x,'More stays before the lock in the chevron position');
        return menu;
      };
      let menu = await openMenu(0);
      assert.equal(await menu.locator('[data-act="study-blockup"]').isDisabled(),true);
      await menu.locator('[data-act="study-blockdown"]').click();
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1]),encrypted);
      menu = await openMenu(1);
      await menu.locator('[data-act="study-blockup"]').click();
      menu = await openMenu(2);
      assert.equal(await menu.locator('[data-act="study-blockdown"]').isDisabled(),true);
      await menu.locator('[data-act="study-blockup"]').click();
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1]),vaulted);
      menu = await openMenu(1);
      await menu.locator('[data-act="study-blockdown"]').click();
      menu = await openMenu(2);
      await page.screenshot({path:join(tmpdir(),`rk-protected-menu-${width}.png`)});
      await menu.locator('[data-act="study-blockadd"]').click();
      await page.locator('.secpick [data-pick="cards"]').click();
      const blocks = await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks);
      assert.deepEqual(blocks[0],encrypted);
      assert.equal(blocks[2].type,'cards');
      assert.deepEqual(blocks[3],vaulted);
      assert.equal(await page.locator('.study__block--enc input,.study__block--enc textarea').count(),0);
      await page.reload();
      await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks),blocks);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("Sections header dragging respects clicks, editing and protected positions", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
    const page = await context.newPage();
    await openIntegratedFixture(page,[{type:"text",heading:"First",body:"Keep"},{type:"media",locked:true,encStub:true},{type:"text",heading:"Third"},{type:"text",heading:"Fourth"}]);
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('[data-l2tab="story"]').click();
    const rows = page.locator('.study-sections .study__block');
    const label = rows.first().locator('.study__block-label');
    await label.click();
    await page.waitForFunction(()=>document.querySelector('.study-sections .study__block').classList.contains('is-open'));
    await rows.first().locator('input[data-bfield="heading"]').click();
    assert.equal(await page.locator('.is-sortdrag').count(),0);
    await label.click();
    await page.waitForFunction(()=>!document.querySelector('.study-sections .study__block').classList.contains('is-open'));
    const source = await label.boundingBox(), target = await rows.last().boundingBox();
    await page.mouse.move(source.x+20,source.y+source.height/2);
    await page.mouse.down();
    await page.mouse.move(source.x+20,target.y+target.height-2,{steps:12});
    const held=page.locator('.adm__sort-preview');
    assert.equal(await held.textContent(),'First');
    assert.equal(await held.evaluate(element=>getComputedStyle(element).pointerEvents),'none');
    assert.match(await rows.last().evaluate(element=>getComputedStyle(element).boxShadow),/inset/);
    await page.keyboard.press('Escape');
    assert.equal(await held.count(),0);
    await page.mouse.up();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks.map(block=>block.encStub?'Protected':block.heading)),['First','Protected','Third','Fourth']);
    await page.mouse.move(source.x+20,source.y+source.height/2);
    await page.mouse.down();
    await page.mouse.move(source.x+22,source.y+source.height/2+2);
    assert.equal(await page.locator('.is-sortdrag').count(),0);
    await page.mouse.move(source.x+20,target.y+target.height-2,{steps:12});
    assert.equal(await page.locator('.is-sortdrag').count(),1);
    await page.mouse.up();
    const blocks = await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks);
    assert.deepEqual(blocks.map(block=>block.encStub?'Protected':block.heading),['Protected','Third','Fourth','First']);
    assert.equal(blocks[3].body,'Keep');
    assert.equal(await page.locator('.study-sections .study__block.is-open').count(),0);
    const sealedBefore = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks[0]));
    const sealedHead = await rows.first().locator('.study__block-label').boundingBox(), end = await rows.last().boundingBox();
    await page.mouse.move(sealedHead.x+20,sealedHead.y+sealedHead.height/2);
    await page.mouse.down();
    await page.mouse.move(sealedHead.x+20,end.y+end.height-2,{steps:12});
    assert.match(await held.textContent(),/encrypted at rest/);
    assert.equal(await held.locator('input,textarea,iframe,video,button').count(),0);
    await page.screenshot({path:join(tmpdir(),'rk-held-protected-section.png')});
    await page.mouse.up();
    assert.equal(await held.count(),0);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks[3])),sealedBefore);
    await context.close();
  } finally { await browser.close(); }
});

test("Sections touch header hold reorders while swipes scroll", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"});
    const page = await context.newPage();
    await openIntegratedFixture(page,Array.from({length:14},(_,index)=>({type:"text",heading:"Section "+index,body:"Original content "+index})));
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('[data-l2tab="story"]').click();
    const session = await context.newCDPSession(page);
    const touch = (type,x,y)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
    const rows = page.locator('.study-sections .study__block');
    await rows.first().scrollIntoViewIfNeeded();
    let source = await rows.first().locator('.study__block-label').boundingBox();
    let target = await rows.nth(2).boundingBox();
    await touch('touchStart',source.x+20,source.y+source.height/2);
    await page.waitForFunction(()=>document.body.classList.contains('adm-sorting'));
    await touch('touchMove',source.x+20,target.y+target.height-2);
    assert.equal(await page.locator('.adm__sort-preview').textContent(),'Section 0');
    const heldBounds=await page.locator('.adm__sort-preview').boundingBox();
    assert.ok(heldBounds.x>=8 && heldBounds.x+heldBounds.width<=382 && heldBounds.y>=8 && heldBounds.y+heldBounds.height<=836);
    await page.screenshot({path:join(tmpdir(),'rk-held-touch-section.png')});
    await touch('touchEnd');
    await page.waitForFunction(()=>!document.body.classList.contains('adm-sorting'));
    assert.equal(await page.locator('.adm__sort-preview').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks.slice(0,3).map(block=>block.heading)),['Section 1','Section 2','Section 0']);
    assert.equal(await page.locator('.study-sections .study__block.is-open').count(),0);
    await rows.nth(4).scrollIntoViewIfNeeded();
    source = await rows.nth(4).locator('.study__block-label').boundingBox();
    const before = await page.evaluate(()=>({order:window.__RKStudio.getDraft().work[0].study.blocks.map(block=>block.heading),top:document.querySelector('.adm__editor').scrollTop}));
    await touch('touchStart',source.x+20,source.y+source.height/2);
    await touch('touchMove',source.x+20,source.y-30);
    await touch('touchMove',source.x+20,source.y-100);
    await touch('touchEnd');
    await page.waitForFunction(top=>document.querySelector('.adm__editor').scrollTop!==top,before.top);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks.map(block=>block.heading)),before.order);
    assert.equal(await page.locator('.is-sortdrag').count(),0);
    await context.close();
  } finally { await browser.close(); }
});

test("Work card Edit renders as primary and opens the project on desktop and phone", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
      const page = await context.newPage();
      await openIntegratedFixture(page);
      const edit = page.locator('[data-act="study-toggle"][data-index="0"]');
      const preview = page.locator('[data-act="study-preview"][data-index="0"]');
      await edit.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
      for (const state of ['rest','hover','focus']) {
        if (state === 'hover') await edit.hover();
        if (state === 'focus') await edit.focus();
        const style = await edit.evaluate(element => {
          const computed = getComputedStyle(element), bounds = element.getBoundingClientRect();
          return {background:computed.backgroundImage,color:computed.color,left:bounds.left,right:bounds.right,width:innerWidth};
        });
        assert.match(style.background,/linear-gradient/);
        assert.equal(style.color,'rgb(36, 26, 9)');
        assert.ok(style.left >= 0 && style.right <= style.width);
      }
      assert.equal(await preview.evaluate(element => getComputedStyle(element).backgroundImage),'none');
      await page.mouse.move(0,0);
      await edit.evaluate(element => element.blur());
      await page.screenshot({path:join(tmpdir(),`rk-work-edit-primary-${width}.png`)});
      await edit.click();
      await page.locator('[data-l2tab="story"][aria-selected="true"]').waitFor();
      assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())),before);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("Prepare local test link opens directly and leaves normal sign-in enforced", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const server = process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5512';
  const published = JSON.parse(readFileSync(new URL('./content.json',import.meta.url),'utf8'));
  published.work = [{id:'local-gate-fixture',title:'Local test project',study:{blocks:[{type:'text',body:'Public test evidence.'}]}}];
  try {
    for (const scenario of [
      {origin:server,query:'?devstub=1',width:1440,dev:true},
      {origin:'http://localhost:5512',query:'?devstub=1',width:390,dev:true},
      {origin:server,query:'',width:1440,dev:false},
      {origin:'https://riteshk.work',query:'?devstub=1',width:1440,dev:false},
      {origin:'https://localhost.example.test',query:'?devstub=1',width:1440,dev:false}
    ]) {
      const context = await browser.newContext({viewport:{width:scenario.width,height:1000},reducedMotion:'reduce'}), page = await context.newPage(), writes = [];
      await context.route('**/*',async route => {
        const request = route.request(), url = new URL(request.url());
        if (!['GET','HEAD'].includes(request.method())) { writes.push(url.pathname); return route.abort(); }
        if (url.pathname.endsWith('/content.json')) return route.fulfill({contentType:'application/json',body:JSON.stringify(published)});
        if (url.pathname.startsWith('/admin/')) return route.abort();
        if (url.origin === scenario.origin) {
          const asset = new URL('.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''), import.meta.url);
          return route.fulfill({path:fileURLToPath(asset)});
        }
        return route.abort();
      });
      await page.goto(scenario.origin + '/studio/' + scenario.query);
      if (scenario.dev) {
        await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
        assert.equal(await page.locator('.pass--lock').count(),0);
        assert.equal(await page.evaluate(() => window.__RK_DEV),true);
        assert.equal(new URL(page.url()).searchParams.get('devstub'),'1');
        await page.locator('.adm__tab[data-tab="ai"]').click();
        await page.locator('[data-prep-brief]').waitFor();
        assert.equal(await page.locator('[data-act="prep-open"]').count(),5);
        await page.waitForLoadState('networkidle');
        await page.reload();
        await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
        assert.equal(await page.locator('.pass--lock').count(),0);
        assert.deepEqual(writes,[]);
      } else {
        await page.locator('.pass--lock').waitFor();
        assert.equal(await page.evaluate(() => !!window.__RK_DEV),false);
        assert.equal(await page.evaluate(() => typeof window.__rkDevStudio),'undefined');
        assert.equal(await page.locator('.adm.is-open').count(),0);
      }
      await page.waitForLoadState('networkidle');
      await context.unrouteAll({behavior:'wait'});
      await context.close();
    }
  } finally { await browser.close(); }
});

async function installPrepareReplies(page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.preparationCalls = [];
    window.preparationPlanningCalls = [];
    window.fetch = async (resource, options = {}) => {
      const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href);
      if (url.hostname === 'api.anthropic.com' && url.pathname.endsWith('/models') && window.interviewEffortCeilingTest) return Response.json({data:[{id:'claude-prepare-effort-fixture',input_modalities:['text'],output_modalities:['text'],max_input_tokens:200000,max_tokens:16000,pricing:{input:2,output:10},capabilities:{thinking:{supported:true},structured_outputs:{supported:true},effort:{supported:true,low:{supported:true},high:{supported:true}}}}],has_more:false});
      if (url.hostname !== 'api.anthropic.com' || !url.pathname.endsWith('/messages')) return original(resource, options);
      const request = JSON.parse(options.body), system = request.system;
      let text;
      if (system.startsWith("You are Studio's outcome coordinator.")) {
        const input = JSON.parse(request.messages[0].content);
        window.preparationPlanningCalls.push({maxTokens:request.max_tokens,effort:request.output_config?.effort,job:input.job,review:!!input.candidate});
        text = JSON.stringify({decision:input.candidate ? {action:'finish',summary:'Validated fixture result'} : {action:'draft',modelRef:input.draftModels[0],task:'writing',effort:window.interviewEffortCeilingTest ? 'high' : undefined,instruction:'',inputs:[],summary:'Use the selected evidence'}});
      } else {
        window.preparationCalls.push({system,user:JSON.stringify(request.messages),model:request.model,maxTokens:request.max_tokens,effort:request.output_config?.effort});
        if (system.includes('{"questions":[{"q":string,"category":string,"why":string}]}') && /Generate exactly \d+ questions/.test(JSON.stringify(request.messages))) {
          if (window.interviewOutputLimit) return Response.json({content:[],stop_reason:'max_tokens',usage:{input_tokens:10,output_tokens:request.max_tokens,output_tokens_details:{thinking_tokens:request.max_tokens}}});
          const count = Number(JSON.stringify(request.messages).match(/Generate exactly (\d+) questions/)?.[1] || 10);
          text = JSON.stringify(window.interviewReply || {questions:Array.from({length:count},(_,index)=>({q:index ? 'What evidence would you seek for alternative '+index+'?' : 'Which decision changed the outcome?',category:'Decisions',why:'Explain the evidence'}))});
        }
        else if (system.includes('{"themes":[{"title":string,"hook":string,"why":string,"beats":string}]}')) text = JSON.stringify(window.storyThemesReply || {themes:Array.from({length:4},(_,index)=>({title:'Evidence led decision '+index,hook:'A grounded angle '+index,beats:'Context decision outcome',why:'Shows supported reasoning'}))});
        else if (system.includes('Script EXACTLY')) { if (window.deferStoryReply) { await new Promise(resolve => { window.releaseStoryReply = resolve; }); window.storyReplyReturned = true; } text = JSON.stringify(window.storyScriptReply || {spine:'Evidence led the decision',opener:'Original source',beats:[{label:'Decision',mins:'5',say:'Explain the evidence',must:'Outcome'}],close:'Lessons',skip:'Details',tip:'Keep it clear'}); }
        else if (system.includes('cross-functional partners in a design-portfolio interview')) { const count = Number(JSON.stringify(request.messages).match(/Generate exactly (\d+) questions/)?.[1] || 10); text = JSON.stringify({questions:Array.from({length:count},(_,index)=>({q:'What informed decision '+index+'?',role:'Design',why:'Explain the reasoning'}))}); }
        else if (system.includes('Invent ONE crisp')) text = JSON.stringify({prompt:'A new synthetic exercise',context:'Explicit constraints',watchfor:['Clarity']});
        else if (system.includes('GAME PLAN')) text = JSON.stringify({clarifiers:['Who needs this?'],phases:[{label:'Frame',mins:'5',move:'Name the goal'}]});
        else if (system.includes('candidate has drafted')) text = JSON.stringify({verdict:'SAVED_COACHING_FEEDBACK',strong:['A clear user'],gaps:['Name the outcome']});
        else if (system.includes('panel debriefing')) text = JSON.stringify(window.whiteboardScore || {scores:[{dim:'Problem framing',score:3,note:'A stated user need',evidence:['turn-2']}],overall:'SAVED_MOCK_SCORE',topfix:'Name the success measure',improvements:[{action:'Name a measurable outcome',evidence:['turn-2'],retry:'Explain the success measure and its limitation.'},{action:'Compare an alternative',evidence:['turn-2'],retry:'Compare two possible approaches and choose one.'}]});
        else if (system.includes('You ARE the interviewer')) {
          if (window.whiteboardHttpFailure) return Response.json({error:{type:'invalid_request_error',message:'Unsupported temperature'}},{status:400});
          if (window.deferWhiteboardReply) { await new Promise(resolve => { window.releaseWhiteboardReply = resolve; }); window.whiteboardReplyReturned = true; }
          text = JSON.stringify({reply:system.includes('"readability"') ? 'The board is unreadable. Please zoom in or describe it.' : 'Which user and outcome will you focus on?',readability:'unreadable',action:'respond',roleAction:'keep',roleId:null,origin:null,assisted:false,memory:[],...window.whiteboardReply});
        }
        else if (system.includes('COMPLETE, personalised cover letter')) text = 'Dear Hiring Team,\n\nMy work connects user evidence with clear product decisions. I would bring that approach to your design team.\n\nThank you for considering my application.\n\nSample candidate';
        else if (system.includes('interview practice coach')) {
          if (window.deferPracticeReply) { await new Promise(resolve => { window.releasePracticeReply = resolve; }); window.practiceReplyReturned = true; }
          text = JSON.stringify({verdict:'SPECIFIC_PRACTICE_FEEDBACK',strong:['A clear decision'],gaps:['Explain the trade-off'],evidence:['ORIGINAL_PRACTICE_EVIDENCE','INVENTED_SOURCE_QUOTE'],nextTry:'Name the alternative you rejected.',followup:'What alternative did you reject, and why?'});
        }
        else if (system.includes('ATS-optimisation expert')) {
          if (window.deferAtsReply) { await new Promise(resolve => { window.releaseAtsReply = resolve; }); window.atsReplyReturned = true; }
          text = JSON.stringify({score:70,band:'Good',summary:'ATS_RECHECK_RESULT',checks:[],fixes:[],keywords:{present:[],missing:[]},...(system.includes('"responseVersion":1') ? {responseVersion:1} : {})});
        }
        else text = '<p><strong>Grounded answer.</strong> Keep the original evidence.</p>';
      }
      return Response.json({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5}});
    };
  });
}

for (const width of [1440,390,320]) test('Prepare Storyteller retains angle drafts, edits, versions and recovery at '+width+'px', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:width === 1440 ? 'no-preference' : 'reduce'});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    const original = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-tool="story"][data-act="prep-open"]').click();
    await page.setViewportSize({width,height:width === 320 ? 568 : 900});
    if (width === 1440) { const box = await page.locator('.story-modal > .pass__box').boundingBox(); assert.ok(box.width <= 880 && box.x > 0 && box.y > 0,JSON.stringify(box)); }
    await page.locator('[data-story-tone="leader"]').click();
    await page.getByRole('button',{name:'Advanced options',exact:true}).click();
    await page.locator('[data-story-audience]').selectOption('partners');
    await page.screenshot({path:join(tmpdir(),'rk-story-setup-'+width+'.png')});
    await page.locator('[data-story-run]').click(); await page.locator('[data-story-tell="0"]').waitFor();
    assert.equal(await page.locator('[data-story-tell]').count(),4);
    assert.equal(await page.evaluate(() => window.preparationCalls.length),1);
    await page.locator('[data-story-tell="0"]').click(); await page.locator('[data-story-copy]').waitFor();
    await page.locator('[data-story-edit]').click(); await page.locator('[data-story-field="opener"]').fill('MY_EDITED_OPENING'); await page.locator('[data-story-edit-done]').click();
    await page.locator('[data-story-view="questions"]').click(); await page.locator('[data-story-qgen]').click(); await page.locator('[data-story-qans="0"]').waitFor();
    assert.equal(await page.locator('.story__q').count(),10);
    await page.locator('[data-story-qans="0"]').click(); await page.locator('[data-story-qedit="0"]').click(); await page.locator('[data-story-answer="0"]').fill('MY_EDITED_ANSWER'); await page.locator('[data-story-answer-done]').click();
    await page.locator('[data-story-l2back]').click(); await page.locator('[data-story-tell="1"]').click(); await page.locator('[data-story-copy]').waitFor();
    await page.locator('[data-story-view="questions"]').click(); await page.locator('.story__qrole').selectOption('design'); await page.locator('[data-story-qgen]').click(); await page.locator('[data-story-qans="0"]').waitFor();
    assert.equal(await page.locator('.story__q').count(),5);
    const count = await page.evaluate(() => window.preparationCalls.length);
    await page.locator('[data-story-l2back]').click(); await page.locator('[data-story-tell="0"]').click();
    assert.equal(await page.evaluate(() => window.preparationCalls.length),count);
    assert.match(await page.locator('.story__open').innerText(),/MY_EDITED_OPENING/);
    await page.locator('[data-story-view="questions"]').click(); assert.match(await page.locator('.story__q-a').first().innerText(),/MY_EDITED_ANSWER/);
    await page.screenshot({path:join(tmpdir(),'rk-story-questions-'+width+'.png')});
    await page.locator('[data-story-view="script"]').click();
    await page.locator('[data-story-refinement] summary').click(); await page.locator('[data-story-request]').fill('Make the opening direct.'); await page.locator('[data-story-refine]').click(); await page.locator('[data-story-apply]').waitFor();
    assert.match(await page.locator('.story__open').innerText(),/MY_EDITED_OPENING/);
    await page.locator('[data-story-apply]').click(); assert.doesNotMatch(await page.locator('.story__open').innerText(),/MY_EDITED_OPENING/);
    await page.locator('[data-story-versions] summary').click(); await page.locator('[data-story-restore]').first().click(); assert.match(await page.locator('.story__open').innerText(),/MY_EDITED_OPENING/);
    const download = page.waitForEvent('download'); await page.locator('[data-story-download]').click(); assert.equal((await download).suggestedFilename(),'story-outline.txt');
    await page.screenshot({path:join(tmpdir(),'rk-story-script-'+width+'.png')});
    const geometry = await page.locator('.story-modal > .pass__box').evaluate(element => ({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,viewport:innerHeight,overflow:element.scrollWidth>element.clientWidth+1,undefinedText:element.textContent.includes('undefined')}));
    assert.equal(geometry.width,width); assert.equal(geometry.height,geometry.viewport); assert.equal(geometry.overflow,false); assert.equal(geometry.undefinedText,false);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).story[0]);
    assert.equal(saved.payload.tone,'leader'); assert.equal(saved.payload.audience,'partners'); assert.equal(Object.keys(saved.payload.drafts).length,2);
    assert.equal(saved.payload.drafts[0].script.opener,'MY_EDITED_OPENING'); assert.match(saved.payload.drafts[0].questions[0].answer,/MY_EDITED_ANSWER/);
    await page.locator('.story-modal [data-cancel]').click(); await page.locator('[data-tool="story"][data-act="prep-open"]').click();
    assert.equal(await page.locator('[data-prep-launch-view="existing"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-story-hist-open="'+saved.id+'"]').press('Enter'); assert.match(await page.locator('.story__open').innerText(),/MY_EDITED_OPENING/);
    if (!await page.locator('[data-story-hist-del="'+saved.id+'"]').isVisible()) await page.locator('.story__history > summary').click();
    page.once('dialog',dialog=>dialog.accept()); await page.locator('[data-story-hist-del="'+saved.id+'"]').click();
    assert.equal(await page.locator('[data-story-hist-open="'+saved.id+'"]').count(),0);
    await page.reload(); await page.waitForFunction(() => typeof window.__rkDevStudio === 'function' && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio()); await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll('.pass--lock').forEach(dialog=>dialog.remove()));
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-tool="story"][data-act="prep-open"]').click();
    assert.equal(await page.locator('[data-prep-launch-view="existing"]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-story-hist] details > summary').click(); await page.locator('[data-story-recover="'+saved.id+'"]').click();
    const recovered = await page.evaluate(id => JSON.parse(localStorage.getItem('rk:prep:hist')).story.find(entry=>entry.id===id),saved.id);
    assert.deepEqual(recovered.payload,saved.payload); assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())),original);
    await page.locator('[data-story-hist-open="'+saved.id+'"]').press('Enter'); assert.match(await page.locator('.story__open').innerText(),/MY_EDITED_OPENING/);
    await page.locator('[data-story-view="questions"]').click(); assert.match(await page.locator('.story__q-a').first().innerText(),/MY_EDITED_ANSWER/);
    await page.locator('[data-story-l2back]').click(); await page.locator('[data-story-tell="1"]').click(); await page.locator('[data-story-view="questions"]').click();
    assert.equal(await page.locator('.story__qrole').inputValue(),'design'); assert.equal(await page.locator('.story__q').count(),5);
    assert.equal(await page.evaluate(() => window.preparationCalls.length),0);
    const fonts = await page.evaluate(async () => { await document.fonts.ready; return Array.from(document.fonts).filter(font=>font.status==='loaded').map(font=>font.family.replaceAll('"','')); });
    for (const family of ['Hanken Grotesk','Schibsted Grotesk','Martian Mono']) assert.ok(fonts.includes(family),family+' loaded');
  } finally { await browser.close(); }
});

test('Prepare Storyteller rejects malformed generations and late replies without replacing saved work', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page); await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-tool="story"][data-act="prep-open"]').click();
    await page.locator('[data-story-run]').click(); await page.locator('[data-story-tell="0"]').click(); await page.locator('[data-story-copy]').waitFor();
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).story[0]);
    await page.evaluate(() => { window.deferStoryReply = true; }); await page.locator('[data-story-regen]').click(); await page.waitForFunction(() => typeof window.releaseStoryReply === 'function');
    await page.locator('[data-story-edit]').click(); await page.locator('[data-story-field="opener"]').fill('NEWER_MANUAL_EDIT'); await page.evaluate(() => { window.deferStoryReply = false; window.releaseStoryReply(); }); await page.waitForFunction(() => window.storyReplyReturned && window.__rkAiSession.state().active === 0);
    await page.locator('[data-story-edit-done]').click(); assert.match(await page.locator('.story__open').innerText(),/NEWER_MANUAL_EDIT/);
    await page.evaluate(() => { window.storyScriptReply = {opener:'BROKEN'}; }); await page.locator('[data-story-regen]').click(); await page.waitForFunction(() => document.querySelector('.story-modal .pass__err').textContent.includes('incomplete'));
    assert.match(await page.locator('.story__open').innerText(),/NEWER_MANUAL_EDIT/);
    await page.locator('[data-story-l2back]').click(); await page.locator('[data-story-back]').click(); await page.evaluate(() => { window.storyThemesReply = {themes:[{title:'BROKEN'}]}; }); await page.locator('[data-story-run]').click(); await page.waitForFunction(() => document.querySelector('.story-modal .pass__err').textContent.includes('four'));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).story);
    assert.equal(saved.length,1); assert.deepEqual(saved[0].payload.source,original.payload.source); assert.equal(saved[0].payload.drafts[0].script.opener,'NEWER_MANUAL_EDIT');
  } finally { await browser.close(); }
});

async function assertInsetFetchRow(row) {
  const layout = await row.evaluate(element => {
    const input = element.querySelector('input[type="url"]'), button = element.querySelector('button');
    const field = input.getBoundingClientRect(), action = button.getBoundingClientRect(), bounds = element.getBoundingClientRect(), style = getComputedStyle(input);
    const actionStyle = getComputedStyle(button);
    return {
      fullWidth:Math.abs(field.left-bounds.left)<=1 && Math.abs(field.width-bounds.width)<=1,
      inset:action.left>field.left && action.right<field.right && action.top>field.top && action.bottom<field.bottom,
      textReserved:field.right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth)<=action.left-4,
      ellipsis:style.textOverflow==='ellipsis',
      labelFits:button.scrollWidth<=button.clientWidth+1,
      quietAction:['borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','backgroundColor'].every(property=>['transparent','rgba(0, 0, 0, 0)'].includes(actionStyle[property])),
      rightAligned:actionStyle.justifyContent==='flex-end'
    };
  });
  assert.deepEqual(layout,{fullWidth:true,inset:true,textReserved:true,ellipsis:true,labelFits:true,quietAction:true,rightAligned:true},'Shared Fetch rows use a quiet in-field action without covering URL text');
}

test('Prepare launch dialogs retain setup, share desktop geometry and use independent history actions', {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    for (const width of [1024,1440,1920]) {
      const page = await browser.newPage({viewport:{width,height:900},reducedMotion:width === 1440 ? 'no-preference' : 'reduce'}), errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await installPrepareReplies(page); await openIntegratedFixture(page);
      await page.evaluate(() => {
        const history = {};
        for (const tool of ['ats','cl','iprep','story']) history[tool] = [0,1,2].map(index=>({id:tool+'-launch-'+index,tool,kind:tool === 'ats' ? 'review' : tool,at:1,title:'Saved preparation with a long title '+index,meta:{score:72,band:'Good',count:6,snippet:'Saved evidence and role-specific preparation'},payload:{questions:[],themes:[],dur:'5',tone:'staff'}}));
        localStorage.setItem('rk:prep:hist',JSON.stringify(history));
      });
      const original = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
      await page.locator('.adm__tab[data-tab="ai"]').click();
      for (const tool of ['ats','cl','iprep','story']) {
        const launcher = page.locator('[data-act="prep-open"][data-tool="'+tool+'"]'); await launcher.click();
        const modal = page.locator('.prep-launch'), box = modal.locator('.pass__box');
        await box.evaluate(async element => { await Promise.all(element.getAnimations().filter(animation=>Number.isFinite(animation.effect.getTiming().iterations)).map(animation=>animation.finished)); });
        assert.equal(await modal.locator('[data-prep-launch-view="existing"]').getAttribute('aria-pressed'),'true');
        const existing = await box.boundingBox();
        assert.ok(existing.width <= 880 && existing.x > 0 && existing.y > 0 && existing.y + existing.height < 900,tool+' '+JSON.stringify(existing));
        assert.equal(await box.evaluate(element=>getComputedStyle(element).borderRadius),'14px');
        assert.equal(await modal.getByRole('button',{name:'Close',exact:true}).count(),1);
        assert.equal(await page.locator('.adm__main').evaluate(element=>element.inert),true);
        assert.equal(await modal.locator('[data-prep-launch-primary]').isVisible(),false);
        const cards = modal.locator('[data-prep-launch-existing] .prep-h'); assert.equal(await cards.count(),3);
        assert.equal(await cards.first().evaluate(element=>getComputedStyle(element).borderRadius),'6px');
        const bounds = await Promise.all((await cards.all()).map(card=>card.boundingBox()));
        assert.ok(bounds.every(rect=>Math.abs(rect.y-bounds[0].y)<1),tool+' history uses three columns');
        assert.equal(await cards.locator('button.prep-h__x').count(),3);
        assert.equal(await cards.locator('button.prep-h__del').count(),3);
        await modal.locator('[data-prep-launch-view="new"]').click();
        assert.deepEqual(await box.boundingBox(),existing,tool+' keeps the same New/Existing frame');
        if (tool === 'ats') await modal.locator('[data-act="ats-mode"][data-mode="job"]').click();
        if (tool === 'ats' || tool === 'cl') { await modal.locator('.ats__lvl[data-lvl="senior"]').click(); assert.equal(await modal.locator('.ats__lvl[data-lvl="senior"]').getAttribute('aria-pressed'),'true'); }
        const field = modal.locator(tool === 'iprep' ? '#iprepJd' : tool === 'story' ? '.story__pick' : '.cl__company');
        if (tool === 'story') await field.selectOption('1'); else await field.fill('PRESERVED_SETUP_'+tool);
        const advanced = modal.locator('[data-prep-launch-options]');
        if (tool === 'ats') assert.equal(await advanced.isVisible(),false);
        else {
          await advanced.click();
          if (tool === 'iprep') await modal.locator('#iprepCount').selectOption('14');
          else if (tool === 'story') await modal.locator('[data-story-audience]').selectOption('partners');
          else await modal.locator('[data-act="cl-length"][data-len="short"]').click();
        }
        const expanded = await box.boundingBox();
        await modal.locator('[data-prep-launch-view="existing"]').click();
        assert.deepEqual(await box.boundingBox(),expanded,tool+' reserves expanded setup height');
        await modal.locator('[data-prep-launch-view="new"]').click();
        assert.equal(await field.inputValue(),tool === 'story' ? '1' : 'PRESERVED_SETUP_'+tool);
        if (tool !== 'ats') {
          assert.equal(await advanced.getAttribute('aria-expanded'),'true'); await advanced.click();
          if (tool === 'iprep') assert.equal(await modal.locator('#iprepCount').inputValue(),'14');
          if (tool === 'story') assert.equal(await modal.locator('[data-story-audience]').inputValue(),'partners');
          if (tool === 'cl') assert.equal(await modal.locator('[data-act="cl-length"].is-on').getAttribute('data-len'),'short');
        }
        for (const control of await modal.locator('[data-prep-launch-header],.pass__actions').all()) {
          const rect = await control.boundingBox(); assert.ok(rect.y >= 0 && rect.y+rect.height <= 900,tool+' reachable chrome');
        }
        assert.equal(await box.evaluate(element=>element.scrollWidth > element.clientWidth),false);
        await page.screenshot({path:join(tmpdir(),'rk-prepare-launch-'+tool+'-'+width+'.png')});
        await modal.locator('[data-prep-launch-view="existing"]').click();
        if (tool !== 'story') {
          for (let index=0;index<3;index++) await modal.locator('button.prep-h__del').first().press('Enter');
          assert.equal(await modal.locator('[data-prep-launch-view="existing"]').isVisible(),false);
          assert.equal(await modal.locator('[data-prep-launch-primary]').isVisible(),true);
          assert.equal(await modal.evaluate(element=>element.contains(document.activeElement)),true);
        }
        await modal.getByRole('button',{name:'Close',exact:true}).click();
        await page.waitForFunction(tool=>document.activeElement?.dataset.tool===tool,tool);
        assert.equal(await page.locator('.adm__main').evaluate(element=>element.inert),false);
      }
      assert.equal(await page.evaluate(()=>window.preparationCalls.length),0);
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),original);
      assert.deepEqual(errors,[]); await page.close();
    }
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await installPrepareReplies(page);
    await page.addInitScript(()=>localStorage.setItem('rk:prep:draft',JSON.stringify({cl:{letter:'LEGACY_DRAFT_WITHOUT_HISTORY',state:{company:'DraftCo'},level:'staff'}})));
    await openIntegratedFixture(page); await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="cl"]').click();
    await page.locator('[data-act="cl-draft-open"]').press('Enter');
    assert.equal(await page.locator('.cl__letter').innerText(),'LEGACY_DRAFT_WITHOUT_HISTORY');
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),0);
    await page.close();
  } finally { await browser.close(); }
});

for (const width of [1440,390]) test("Prepare shared brief connects tools with an explicit Whiteboard Existing view at " + width + "px", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => {
      window.__rkDevEdit('work.0.study.blocks',[{type:'text',body:'PERMITTED_PROJECT_EVIDENCE'},{type:'text',locked:true,body:'LOCKED_SECTION_EVIDENCE'}]);
      window.__rkDevEdit('work.1.hidden',true);
      window.__rkDevEdit('work.1.study.blocks',[{type:'text',body:'PRIVATE_PROJECT_EVIDENCE'}]);
    });
    const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.locator('[data-prep-brief] details').evaluate(element=>element.open),false);
    assert.equal(await page.locator('[data-act="prep-open"][data-tool="ats"]').evaluate(element=>element.getBoundingClientRect().bottom < innerHeight),true);
    await page.screenshot({path:join(tmpdir(),'rk-prep-home-'+width+'.png')});
    await page.locator('[data-prep-brief] summary').click();
    await page.getByLabel('Company',{exact:true}).fill('TargetCo');
    await page.getByLabel('Role',{exact:true}).fill('Product design lead');
    await page.getByLabel('Job description',{exact:true}).fill('SHARED_JOB_REQUIREMENTS');
    await page.getByLabel('Target level',{exact:true}).selectOption('leader');
    await page.getByLabel('Resume evidence',{exact:true}).selectOption('none');
    await page.getByLabel('Selected projects',{exact:true}).check();
    await page.locator('[data-prep-project="integrated-case"]').check();
    await page.locator('[data-prep-project="empty-case"]').check();
    await assertInsetFetchRow(page.locator('[data-prep-brief] .cl__row'));
    const brief = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:brief')));
    assert.ok(brief.id);
    assert.equal(brief.includePrivate,false);
    for (const field of ['company','role']) {
      const style = await page.locator('[data-prep-field="'+field+'"]').evaluate(element => { const computed = getComputedStyle(element), bounds = element.getBoundingClientRect(); return {height:bounds.height,radius:computed.borderRadius,background:computed.backgroundColor,contained:bounds.width <= element.parentElement.clientWidth + 1}; });
      assert.ok(style.height >= 34);
      assert.notEqual(style.radius,'0px');
      assert.notEqual(style.background,'rgb(255, 255, 255)');
      assert.equal(style.contained,true);
    }
    await page.screenshot({path:join(tmpdir(),'rk-prep-shared-brief-'+width+'.png')});
    for (const tool of ['ats','cl','iprep','story','wb']) {
      const launcher = page.locator('[data-act="prep-open"][data-tool="'+tool+'"]');
      await launcher.press('Enter');
      const modal = page.locator(['ats','cl'].includes(tool) ? '.prep-dialog' : '.'+tool+'-modal');
      await modal.waitFor();
      await page.waitForFunction(selector => document.querySelector(selector)?.contains(document.activeElement), ['ats','cl'].includes(tool) ? '.prep-dialog' : '.'+tool+'-modal');
      assert.equal(await modal.getAttribute('role'),'dialog');
      assert.equal(await modal.getAttribute('aria-modal'),'true');
      await modal.evaluate(element => { const controls = [...element.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(control=>control.getClientRects().length); controls.at(-1).focus(); });
      await page.keyboard.press('Tab');
      if (tool === 'wb') {
        assert.equal(await page.locator('.adm__main').evaluate(element=>element.inert),true);
        assert.equal(await page.locator('.adm__workbar').evaluate(element=>element.inert),true);
        assert.equal(await page.locator('.adm__bar').evaluate(element=>element.inert),true);
      }
      assert.equal(await modal.evaluate(element=>element.contains(document.activeElement)),true);
      if (tool !== 'wb') await modal.getByRole('button',{name:'Use brief',exact:true}).click();
      if (tool === 'ats' || tool === 'cl') {
        assert.equal(await page.evaluate(tool => JSON.parse(localStorage.getItem('rk:prep:draft'))[tool].state.preparationBrief.id,tool),brief.id);
        assert.equal(await modal.locator('.cl__company').inputValue(),'TargetCo / Product design lead');
        assert.equal(await modal.locator('.cl__jd').inputValue(),'SHARED_JOB_REQUIREMENTS');
        assert.equal(await modal.locator('.ats__lvl.is-on').getAttribute('data-lvl'),'leader');
      } else if (tool === 'iprep') {
        assert.equal(await modal.locator('#iprepJd').inputValue(),'SHARED_JOB_REQUIREMENTS');
        assert.equal(await modal.locator('[data-iprep-proj][value="0"]').isChecked(),true);
        assert.equal(await modal.locator('[data-iprep-proj][value="1"]').isChecked(),false);
        await modal.locator('[data-iprep-run]').click();
        await modal.locator('.iprep__q').first().waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
        assert.equal(saved.payload.source.brief.id,brief.id);
        assert.match(saved.payload.source.text,/PERMITTED_PROJECT_EVIDENCE/);
        assert.doesNotMatch(saved.payload.source.text,/PRIVATE_PROJECT_EVIDENCE|LOCKED_SECTION_EVIDENCE/);
      } else if (tool === 'story') {
        assert.equal(await modal.locator('[data-story-jd-text]').inputValue(),'SHARED_JOB_REQUIREMENTS');
        assert.equal(await modal.locator('[data-story-tone].is-on').getAttribute('data-story-tone'),'leader');
        await modal.locator('[data-story-run]').click(); await modal.locator('[data-story-tell="0"]').waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).story[0]);
        assert.equal(saved.payload.source.brief.id,brief.id);
        assert.doesNotMatch(saved.payload.source.text,/PRIVATE_PROJECT_EVIDENCE|LOCKED_SECTION_EVIDENCE/);
      } else {
        assert.equal(await modal.locator('[data-wb-view="existing"]').getAttribute('aria-pressed'),'true');
        assert.equal(await modal.locator('[data-wb-brief]').isVisible(),true);
        assert.equal(await modal.locator('[data-wb-hist]').isVisible(),false,'No empty saved-session section');
        assert.equal(await modal.locator('[data-wb-start]').isVisible(),false);
        await modal.locator('[data-wb-view="new"]').click();
        assert.equal(await modal.locator('[data-wb-brief]').isVisible(),false,'The brief belongs only to Existing');
        assert.equal(await modal.locator('.wb__company').inputValue(),'');
        assert.equal(await modal.locator('.wb__jd').inputValue(),'');
        assert.equal(await modal.locator('[data-wb-lvl].is-on').getAttribute('data-wb-lvl'),'staff');
        await modal.locator('[data-wb-deeper]').click();
        await modal.locator('.wb__own').fill('Whiteboard without a shared target');
        await modal.locator('[data-wb-start]').click();
        await modal.locator('.wb__draft').waitFor();
        assert.doesNotMatch(await page.evaluate(() => window.preparationCalls.at(-1).user),/SHARED_JOB_REQUIREMENTS|TargetCo/,'A blank Whiteboard JD must not inherit the Storyteller target');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].target.jd),'');
        await modal.locator('[data-wb-back]').click();
        await modal.locator('[data-wb-view="existing"]').click();
        assert.equal(await modal.locator('[data-wb-hist]').isVisible(),true);
        assert.equal(await modal.locator('[data-wb-brief]').evaluate(element => !!(element.compareDocumentPosition(document.querySelector('[data-wb-hist]')) & Node.DOCUMENT_POSITION_FOLLOWING)),true,'Brief precedes saved sessions');
        const callsBeforeBrief = await page.evaluate(() => window.preparationCalls.length);
        await modal.locator('[data-wb-use-brief]').click();
        assert.equal(await modal.locator('[data-wb-view="new"]').getAttribute('aria-pressed'),'true');
        assert.equal(await modal.locator('.wb__company').inputValue(),'TargetCo / Product design lead');
        assert.equal(await modal.locator('.wb__jd').inputValue(),'SHARED_JOB_REQUIREMENTS');
        assert.equal(await modal.locator('[data-wb-lvl].is-on').getAttribute('data-wb-lvl'),'leader');
        assert.equal(await page.evaluate(() => window.preparationCalls.length),callsBeforeBrief,'Using a brief does not start a session or call AI');
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:brief'))),brief,'Other tools retain their shared brief');
      }
      for (const row of await modal.locator('.cl__row:visible').all()) await assertInsetFetchRow(row);
      if (tool === 'cl') {
        await modal.locator('[data-act="cl-generate"]').click(); await modal.locator('.cl__letter').waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).cl[0]);
        assert.equal(saved.payload.source.brief.id,brief.id);
        assert.equal(saved.payload.source.resume,'');
        assert.match(saved.payload.source.text,/PERMITTED_PROJECT_EVIDENCE/);
        assert.doesNotMatch(saved.payload.source.text,/PRIVATE_PROJECT_EVIDENCE|LOCKED_SECTION_EVIDENCE/);
      }
      assert.equal(await modal.evaluate(element => element.querySelector('.pass__box').scrollWidth > element.querySelector('.pass__box').clientWidth),false);
      await page.screenshot({path:join(tmpdir(),'rk-prep-connected-'+tool+'-'+width+'.png')});
      await modal.getByRole('button',{name:tool === 'iprep' ? 'Back to Prepare' : 'Close',exact:true}).click();
      await page.waitForFunction(tool => document.activeElement?.dataset.tool === tool, tool);
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())),before);
  } finally { await browser.close(); }
});

for (const width of [1440,390]) test("Prepare optional Q&A retains responses, grounding and the default Questions view at " + width + "px", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"}), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.clock.install();
    await page.addInitScript(() => { window.SpeechRecognition = class { constructor() { window.practiceDictation = this; } start() {} stop() { this.onend?.(); } abort() { window.practiceMicAborted = true; } }; });
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => window.__rkDevEdit('work.0.study.blocks',[{type:'text',body:'ORIGINAL_PRACTICE_EVIDENCE'}]));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.setViewportSize({width,height:1000});
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('#iprepJd').fill('ORIGINAL_PRACTICE_ROLE');
    assert.equal(await page.locator('.iprep-modal').evaluate(element=>element.classList.contains('prep-launch')),true);
    assert.equal(await page.getByRole('button',{name:'Close',exact:true}).isVisible(),true);
    await page.locator('[data-iprep-run]').click();
    await page.locator('.iprep__q').first().waitFor();
    assert.deepEqual(await page.locator('.prep-workspace .pass__box').boundingBox(),{x:0,y:0,width,height:1000});
    assert.equal(await page.getByRole('button',{name:'Back to Prepare',exact:true}).isVisible(),true);
    assert.equal(await page.getByRole('tab',{name:'Questions',exact:true}).getAttribute('aria-selected'),'true');
    await page.locator('[data-iprep-ans="0"]').click();
    await page.locator('.iprep__a strong').waitFor();
    const suggested = await page.locator('.iprep__a').first().innerHTML();
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    assert.equal(await page.locator('.iprep__a').first().isVisible(),false);
    await page.locator('[data-practice-feedback]').click();
    assert.match(await page.locator('.iprep-modal .pass__err').innerText(),/response first/);
    assert.equal(await page.evaluate(() => window.preparationCalls.filter(call=>call.system.includes('interview practice coach')).length),0);
    await page.getByRole('button',{name:'Start timer',exact:true}).evaluate(button => { window.practiceTestStart = performance.now(); button.click(); });
    await page.clock.runFor(2200);
    const measured = await page.getByRole('button',{name:'Pause timer',exact:true}).evaluate(button => { const elapsed = performance.now() - window.practiceTestStart; button.click(); return elapsed / 1000; });
    const [minutes,seconds] = (await page.locator('[data-practice-elapsed]').innerText()).split(':').map(Number);
    assert.ok(measured >= 2 && Math.abs(minutes * 60 + seconds - measured) < 1);
    await page.getByRole('button',{name:'Dictate response',exact:true}).click();
    await page.evaluate(() => { const result = [{transcript:'A dictated decision and its outcome.'}]; result.isFinal = true; window.practiceDictation.onresult({resultIndex:0,results:[result]}); });
    assert.equal(await page.locator('[data-practice-answer]').inputValue(),'A dictated decision and its outcome.');
    await page.getByRole('button',{name:'Stop dictation',exact:true}).click();
    await page.locator('[data-practice-answer]').fill('FIRST_PRACTICE_RESPONSE: I changed the decision after considering the user evidence.');
    await page.evaluate(() => window.__rkDevEdit('work.0.study.blocks',[{type:'text',body:'CHANGED_PRACTICE_EVIDENCE'}]));
    await page.locator('[data-practice-feedback]').click();
    await page.locator('.prep-practice > .prep-practice-feedback h4').waitFor();
    const request = await page.evaluate(() => window.preparationCalls.at(-1).user);
    assert.match(request,/FIRST_PRACTICE_RESPONSE/);
    assert.match(request,/ORIGINAL_PRACTICE_EVIDENCE/);
    assert.match(request,/ORIGINAL_PRACTICE_ROLE/);
    assert.doesNotMatch(request,/CHANGED_PRACTICE_EVIDENCE/);
    assert.doesNotMatch(await page.locator('.prep-practice').innerHTML(),/INVENTED_SOURCE_QUOTE/);
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
    assert.equal(first.payload.practice.turns[0].attempts.length,1);
    assert.equal(first.payload.questions[0].answer,suggested);
    await page.locator('[data-practice-follow]').click();
    assert.equal(await page.locator('.prep-practice h3').innerText(),'What alternative did you reject, and why?');
    await page.locator('[data-practice-answer]').fill('An unfinished follow-up response that must survive reopening.');
    await page.getByRole('button',{name:'Previous question',exact:true}).click();
    await page.locator('[data-practice-retry]').click();
    await page.locator('[data-practice-answer]').fill('SECOND_PRACTICE_RESPONSE: I rejected the larger option because it did not fit the user need.');
    await page.locator('[data-practice-feedback]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0].payload.practice.turns[0].attempts.length === 2);
    assert.equal(await page.locator('.iprep-modal .pass__box').evaluate(element=>element.scrollWidth > element.clientWidth),false);
    await page.locator('.prep-practice h3').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(tmpdir(),'rk-prep-practice-'+width+'.png')});
    await page.locator('.iprep-modal [data-cancel]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    if (!await page.locator('[data-iprep-hist]').isVisible()) await page.getByRole('button',{name:'Saved sets',exact:true}).click();
    await page.locator('[data-iprep-hist-open="'+first.id+'"]').click();
    assert.equal(await page.getByRole('tab',{name:'Questions',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('.iprep__a').first().innerHTML(),suggested);
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    const paused = await page.locator('[data-practice-elapsed]').innerText();
    await page.clock.runFor(1500);
    assert.equal(await page.locator('[data-practice-elapsed]').innerText(),paused);
    await page.getByRole('button',{name:'Next question',exact:true}).click();
    assert.match(await page.locator('[data-practice-answer]').inputValue(),/unfinished follow-up/);
    await page.evaluate(() => { window.deferPracticeReply = true; });
    await page.locator('[data-practice-feedback]').click();
    await page.waitForFunction(() => typeof window.releasePracticeReply === 'function');
    await page.locator('.iprep-modal [data-cancel]').click();
    await page.evaluate(() => window.releasePracticeReply());
    await page.waitForFunction(() => window.practiceReplyReturned && window.__rkAiSession.state().active === 0);
    const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep.find(entry=>entry.id===id),first.id);
    assert.equal(saved.payload.practice.turns[0].attempts.length,2);
    assert.equal(saved.payload.practice.turns[1].attempts.length,0);
    assert.match(saved.payload.practice.turns[1].draft,/unfinished follow-up/);
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    if (!await page.locator('[data-iprep-hist]').isVisible()) await page.getByRole('button',{name:'Saved sets',exact:true}).click();
    await page.locator('[data-iprep-hist-open="'+first.id+'"]').click();
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    if (!await page.locator('[data-iprep-hist]').isVisible()) await page.getByRole('button',{name:'Saved sets',exact:true}).click();
    await page.locator('[data-iprep-hist-del="'+first.id+'"]').click();
    await page.locator('.iprep-modal [data-prep-launch-close]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep.length),0);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Prepare Interview workspace fits responsive screens and keeps VP sets through keyboard restore and reload", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:"reduce"});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    for (const width of [1440,1024,1920]) {
      await page.setViewportSize({width,height:900});
      const launcher = page.locator('[data-act="prep-open"][data-tool="iprep"]');
      await launcher.click();
      const launchBox = await page.locator('.iprep-modal .pass__box').boundingBox();
      assert.ok(launchBox.width <= 880 && launchBox.x > 0 && launchBox.y > 0 && launchBox.y + launchBox.height < 900,JSON.stringify(launchBox));
      assert.equal(await page.locator('[data-iprep-lvl]').count(),4);
      for (const selector of ['.prep-workspace__bar','.iprep__foot','[data-prep-launch-close]','[data-iprep-run]']) {
        const bounds = await page.locator('.iprep-modal').locator(selector).boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 901,selector);
      }
      assert.equal(await page.locator('.iprep-modal').evaluate(root => Array.from(root.querySelectorAll('.pass__box,.ats__main,.iprep__levels,.prep-workspace__bar')).every(element => element.scrollWidth <= element.clientWidth + 1)),true);
      assert.equal(await page.locator('[data-iprep-saved]').isVisible(),false);
      assert.equal(await page.locator('[data-prep-launch-view="existing"]').isVisible(),false);
      assert.equal(await page.locator('#iprepCount').isVisible(),false);
      await page.getByRole('button',{name:'Advanced options',exact:true}).click();
      await page.locator('#iprepCount').selectOption('14');
      await page.getByRole('button',{name:'Hide options',exact:true}).click();
      assert.equal(await page.locator('#iprepCount').inputValue(),'14');
      await page.screenshot({path:join(tmpdir(),'rk-prep-workspace-setup-'+width+'.png')});
      await page.getByRole('button',{name:'Close',exact:true}).click();
      await page.waitForFunction(() => document.activeElement?.matches('[data-act="prep-open"][data-tool="iprep"]'));
    }
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-iprep-lvl="vp"]').click();
    assert.equal(await page.locator('[data-iprep-lvl][aria-pressed="true"]').getAttribute('data-iprep-lvl'),'vp');
    await page.locator('[data-iprep-proj][value="0"]').check();
    await page.getByRole('button',{name:'Advanced options',exact:true}).click();
    await page.locator('#iprepCount').selectOption('14');
    await page.locator('#iprepJd').fill('Executive design role: evaluate investment and risk.');
    await page.locator('[data-iprep-run]').click();
    await page.locator('.iprep__q').first().waitFor();
    assert.deepEqual(await page.locator('.prep-workspace .pass__box').boundingBox(),{x:0,y:0,width:1920,height:900});
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
    assert.equal(first.payload.level,'vp');
    assert.equal(first.meta.level,'VP / Executive');
    assert.equal(first.payload.source.projects.length,1);
    const request = await page.evaluate(() => window.preparationCalls[0]);
    assert.match(request.system,/VP \/ EXECUTIVE/); assert.match(request.user,/Generate exactly 14 questions/);
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    await page.locator('[data-practice-answer]').fill('A saved executive practice response without an invented outcome.');
    await page.locator('[data-iprep-new]').click();
    await page.locator('[data-iprep-lvl="senior"]').click();
    await page.locator('[data-iprep-run]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep.length === 2);
    if (!await page.locator('[data-iprep-hist]').isVisible()) await page.getByRole('button',{name:'Saved sets',exact:true}).click();
    await page.locator('[data-iprep-hist-open="'+first.id+'"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('tab',{name:'Questions',exact:true}).evaluate(element=>element===document.activeElement),true);
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    assert.match(await page.locator('[data-practice-answer]').inputValue(),/saved executive practice/);
    await page.getByRole('button',{name:'Back to Prepare',exact:true}).click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())),before);
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === 'function' && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    assert.equal(await page.locator('[data-prep-launch-view="existing"]').getAttribute('aria-pressed'),'true');
    const savedBox = await page.locator('.iprep-modal .pass__box').boundingBox();
    await page.locator('[data-prep-launch-view="new"]').click();
    assert.deepEqual(await page.locator('.iprep-modal .pass__box').boundingBox(),savedBox);
    await page.locator('[data-prep-launch-view="existing"]').click();
    await page.screenshot({path:join(tmpdir(),'rk-prep-workspace-history-1920.png')});
    await page.locator('[data-iprep-hist-open="'+first.id+'"]').focus();
    await page.keyboard.press('Space');
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    assert.match(await page.locator('[data-practice-answer]').inputValue(),/saved executive practice/);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Prepare Interview quality keeps complete evidence and rejects bad sets without changing saved work", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const errors = []; page.on('pageerror',error=>errors.push(error.message));
  try {
    await installPrepareReplies(page);
    await page.addInitScript(()=>{window.interviewEffortCeilingTest=true;});
    await openIntegratedFixture(page,[
      {type:'text',body:'Earlier evidence. '.repeat(1800)},
      {type:'rows',items:[{cells:[{heading:'Reported design',body:'LATE_CELL_SEVEN_TO_FOUR'}]}]},
      {type:'text',body:'LATE_RESULTS_PENDING'},
      {type:'text',locked:true,body:'EXCLUDED_LOCKED_SOURCE'}
    ]);
    await page.evaluate(() => localStorage.setItem('rk:prep:brief',JSON.stringify({id:'quality-brief',projectMode:'selected',projectIds:['integrated-case'],includePrivate:false,level:'staff',jd:'BRIEF_ROLE_DATA'})));
    const before = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    for (const useBrief of [false,true]) {
      if (useBrief) { await page.locator('[data-iprep-new]').click(); await page.locator('[data-prep-launch-view="existing"]').click(); await page.getByRole('button',{name:'Use brief',exact:true}).click(); }
      else { await page.locator('[data-prep-launch-view="new"]').click(); await page.locator('[data-iprep-proj][value="0"]').check(); }
      if (!await page.locator('#iprepCount').isVisible()) await page.locator('[data-prep-launch-options]').click();
      await page.locator('#iprepCount').selectOption('6');
      await page.locator('[data-iprep-run]').click();
      await page.locator('.iprep__q').first().waitFor();
      assert.equal(await page.locator('.iprep__q').count(),6);
      const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
      assert.ok(saved.payload.source.text.length > 9000);
      for (const marker of ['LATE_CELL_SEVEN_TO_FOUR','LATE_RESULTS_PENDING']) assert.ok(saved.payload.source.text.includes(marker));
      assert.doesNotMatch(saved.payload.source.text,/EXCLUDED_LOCKED_SOURCE|Source excerpt/);
      assert.deepEqual(saved.payload.source.projects.map(project=>project.id),['integrated-case']);
      const request = await page.evaluate(()=>window.preparationCalls.at(-1));
      assert.match(request.user,/LATE_RESULTS_PENDING/);
      assert.match(request.system,/Target seniority and listening audience are separate/);
      assert.equal(request.maxTokens,16000);
      assert.equal(request.effort,'high');
      assert.ok(await page.evaluate(()=>window.preparationPlanningCalls.every(call=>call.maxTokens === 16000 && call.effort === 'low')));
      await page.locator('[data-iprep-ans="0"]').click();
      await page.locator('.iprep__a strong').waitFor();
      const answer = await page.evaluate(()=>window.preparationCalls.at(-1));
      assert.match(answer.user,/LATE_CELL_SEVEN_TO_FOUR/);
      assert.match(answer.system,/No bracketed placeholders/);
      assert.equal(answer.maxTokens,16000);
      assert.equal(answer.effort,'high');
      const planning = await page.evaluate(()=>window.preparationPlanningCalls.slice(-4));
      assert.deepEqual(planning.map(call=>call.review),[false,true,false,true]);
      for (const [index,call] of planning.entries()) {
        const draft = index < 2 ? request : answer;
        assert.equal(call.job.material.truncated,false);
        assert.ok(call.job.material.text.indexOf('LATE_RESULTS_PENDING') > 24000);
        assert.ok(call.job.material.text === JSON.parse(draft.user)[0].content);
        assert.ok(call.job.contract.text === draft.system);
        assert.doesNotMatch(call.job.material.text,/EXCLUDED_LOCKED_SOURCE/);
      }
    }
    for (const count of [10,14]) {
      await page.locator('[data-iprep-new]').click();
      await page.locator('#iprepCount').selectOption(String(count));
      await page.locator('[data-iprep-run]').click();
      await page.waitForFunction(expected=>document.querySelectorAll('.iprep__q').length === expected,count);
      assert.equal(await page.evaluate(()=>window.preparationCalls.at(-1).maxTokens),16000);
      assert.equal(await page.evaluate(()=>window.preparationCalls.at(-1).effort),'high');
    }
    await page.locator('[data-iprep-new]').click();
    await page.locator('#iprepCount').selectOption('6');
    const history = await page.evaluate(()=>localStorage.getItem('rk:prep:hist'));
    const beforeLimit = await page.evaluate(()=>({calls:window.preparationCalls.length,planning:window.preparationPlanningCalls.length}));
    await page.evaluate(()=>{window.interviewOutputLimit=true;});
    await page.locator('[data-iprep-run]').click();
    await page.waitForFunction(()=>document.querySelector('.iprep-modal .pass__err')?.textContent.includes('output limit before returning answer text'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:prep:hist')),history);
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),beforeLimit.calls+1);
    assert.equal(await page.evaluate(()=>window.preparationPlanningCalls.length),beforeLimit.planning+1);
    await page.evaluate(()=>{window.interviewOutputLimit=false;});
    for (const invalid of ['count','duplicate','empty']) {
      await page.evaluate(kind=>{ window.interviewReply = {questions:Array.from({length:kind === 'count' ? 5 : 6},(_,index)=>({q:kind === 'empty' && index === 0 ? ' ' : kind === 'duplicate' ? 'Same question?' : 'Question '+index+'?'}))}; },invalid);
      const calls = await page.evaluate(()=>window.preparationCalls.length);
      await page.locator('[data-iprep-run]').click();
      await page.waitForFunction(()=>document.querySelector('.iprep-modal .pass__err')?.textContent.includes('No new set was saved'));
      assert.equal(await page.evaluate(()=>window.preparationCalls.length),calls+1);
      assert.equal(await page.evaluate(()=>localStorage.getItem('rk:prep:hist')),history);
    }
    await page.locator('.iprep-modal [data-prep-launch-close]').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),before);
    await page.evaluate(()=>{ window.__rkDevEdit('work.0.study.blocks',[{type:'text',body:'Oversized evidence. '.repeat(7000)}]); delete window.interviewReply; });
    const oversizedDraft = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    const calls = await page.evaluate(()=>window.preparationCalls.length);
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-prep-launch-view="new"]').click();
    await page.locator('[data-iprep-proj][value="0"]').check();
    await page.locator('[data-iprep-run]').click();
    await page.waitForFunction(()=>document.querySelector('.iprep-modal .pass__err')?.textContent.includes('nothing was truncated or sent'));
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),calls);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:prep:hist')),history);
    await page.locator('.iprep-modal [data-prep-launch-close]').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),oversizedDraft);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Prepare Interview long sets use one reading scroller with persistent navigation", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  try {
    for (const width of [1440,800,390,320]) {
      const page = await browser.newPage({viewport:{width,height:844},reducedMotion:width > 800 ? 'no-preference' : 'reduce'});
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await installPrepareReplies(page);
      await page.addInitScript(() => {
        const questions = Array.from({length:14},(_,index) => ({q:'Question '+(index+1)+': What informed the onboarding decision, and what would change your approach?',category:'Decisions',why:'Separate a proposed design from measured outcomes.',answer:'<p>I proposed moving optional invitations after account setup while retaining required verification. The concept reduced seven steps to four. Testing is pending, so this is not a measured conversion gain.</p>'.repeat(3)}));
        localStorage.setItem('rk:prep:hist',JSON.stringify({iprep:[{id:'reading-set',tool:'iprep',title:'Fictional onboarding',at:1,payload:{level:'staff',fromAi:true,questions}}]}));
      });
      await openIntegratedFixture(page);
      const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
      await page.locator('.adm__tab[data-tab="ai"]').click();
      await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
      assert.equal(await page.locator('[data-prep-launch-view="existing"]').getAttribute('aria-pressed'),'true');
      await page.locator('[data-iprep-hist-open="reading-set"]').click();
      const scroller = page.locator(width > 800 ? '.prep-workspace .ats__main' : '.prep-workspace .iprep__cols');
      const list = page.locator('.iprep__list');
      assert.equal(await list.evaluate(element => getComputedStyle(element).maxHeight),'none');
      assert.equal(await list.evaluate(element => element.scrollHeight <= element.clientHeight + 1),true);
      assert.ok(await scroller.evaluate(element => element.scrollHeight > element.clientHeight * 2));
      const card = await page.locator('.iprep__card').first().boundingBox();
      assert.ok(card.width <= 720.01 && card.width >= Math.min(680,width-32),String(card.width));
      const navigation = ['.prep-workspace__bar','.iprep__foot'];
      const initialBounds = await Promise.all(navigation.map(selector => page.locator(selector).boundingBox()));
      await page.locator('.iprep__q').first().hover();
      await page.mouse.wheel(0,650);
      await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 200,width > 800 ? '.prep-workspace .ats__main' : '.prep-workspace .iprep__cols');
      assert.equal(await list.evaluate(element => element.scrollTop),0);
      assert.deepEqual(await Promise.all(navigation.map(selector => page.locator(selector).boundingBox())),initialBounds);
      const tabs = await page.locator('.prep-practice-modes').boundingBox();
      assert.ok(Math.abs(tabs.y - initialBounds[0].y - initialBounds[0].height) <= 1,JSON.stringify(tabs));
      await page.screenshot({path:join(tmpdir(),'rk-prep-reading-'+width+'.png')});
      await page.locator('.iprep__card').last().scrollIntoViewIfNeeded();
      const last = await page.locator('.iprep__card').last().boundingBox();
      assert.ok(last.y + last.height <= initialBounds[1].y + 1);
      await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
      await page.locator('[data-practice-answer]').fill('My response remains intact through view changes.');
      assert.ok((await page.locator('.prep-practice').boundingBox()).width <= 720.01);
      await page.getByRole('tab',{name:'Questions',exact:true}).click();
      assert.equal(await page.locator('.iprep__card').count(),14);
      await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
      assert.equal(await page.locator('[data-practice-answer]').inputValue(),'My response remains intact through view changes.');
      await page.locator('.iprep-modal [data-cancel]').click();
      assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())),before);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("Prepare storage status stays quiet during quick sync and reports sustained pending or failures", () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const start = source.indexOf('  function prepPaintStorage() {'), end = source.indexOf('  function prepMountStorage(',start);
  const makeHost = (dataset = {}) => {
    const span = {textContent:''}, button = {hidden:false,disabled:false};
    return {dataset,hidden:true,span,button,querySelector:selector => selector === 'span' ? span : button};
  };
  const host = makeHost(), ats = makeHost({prepTool:'ats',prepId:'resume'}), entry = {id:'resume'};
  let now = 1000, timer = null;
  const env = {document:{querySelectorAll:()=>[host,ats]},Date:{now:()=>now},prepPendingSince:null,prepPendingNotice:0,
    setTimeout:callback => { timer=callback; return 1; },clearTimeout:()=>{timer=null;},
    prepOutbox:{'wb/session':{acknowledged:false}},prepPendingWrites:new Map(),prepSyncError:'',prepSyncing:true,prepSess:()=> 'owner',
    prepGet:()=>entry,prepCloudSaved:new Map(),prepCloudErrors:new Map(),PREP_HIST_KEY:'history',
    navigator:{onLine:true},resumeSaveFailureFeedback};
  const paint = runInNewContext(source.slice(start,end)+';prepPaintStorage',env);
  paint(); assert.equal(host.hidden,true); assert.equal(host.button.hidden,true);
  assert.equal(ats.hidden,false); assert.equal(ats.span.textContent,"We couldn't confirm this review was saved. Keep this tab open and try again.");
  now += 4999; paint(); assert.equal(host.hidden,true);
  env.prepSyncError='Immediate cloud failure'; paint(); assert.equal(host.hidden,false); assert.equal(host.span.textContent,env.prepSyncError);
  env.prepSyncError=''; paint(); assert.equal(host.hidden,true);
  env.prepOutbox={}; paint(); assert.equal(timer,null); assert.equal(env.prepPendingSince,null);
  now += 1; env.prepOutbox={'wb/session':{acknowledged:false}}; paint();
  now += 5000; timer(); assert.equal(host.hidden,false); assert.match(host.span.textContent,/Cloud sync pending/); assert.equal(host.button.hidden,true);
  env.prepSyncError='Cloud sync failed. Retry save and sync.'; env.prepSyncing=false; paint();
  assert.equal(host.span.textContent,env.prepSyncError); assert.equal(host.button.hidden,false); assert.equal(host.button.disabled,false);
  env.prepOutbox={}; env.prepSyncError=''; paint(); assert.equal(host.hidden,true);
  env.prepPendingWrites.set('history',entry); paint();
  assert.match(host.span.textContent,/Not saved on this device/); assert.equal(host.hidden,false); assert.equal(host.button.hidden,false);
  env.prepPendingWrites.clear(); env.prepCloudSaved.set('ats/resume',{session:'owner',signature:JSON.stringify(entry)}); paint();
  assert.equal(ats.span.textContent,'Saved to your account.'); assert.equal(ats.button.hidden,true);
  env.prepPendingWrites.set('history',entry); paint();
  assert.equal(ats.span.textContent,'Saved to your account. A copy could not be saved on this device.');
  env.prepPendingWrites.clear(); env.prepOutbox={'ats/resume':{acknowledged:false}}; paint();
  assert.equal(ats.span.textContent,'Saving this review...'); assert.equal(ats.button.hidden,true);
  env.prepCloudErrors.set('ats/resume','Synthetic save failure'); paint();
  assert.equal(ats.span.textContent,'Save not confirmed. Try again.');
  assert.equal(ats.button.hidden,false); assert.equal(ats.button.disabled,false);
  env.prepSyncing=true; paint(); assert.equal(ats.button.disabled,true);
  env.prepSess=()=>''; paint();
  assert.equal(ats.span.textContent,'Sign in to save this review to your account. Keep this tab open.');
  assert.equal(ats.button.hidden,true);
  const htmlStart=source.indexOf('  function prepStorageHtml(');
  const storageHtml=runInNewContext(source.slice(htmlStart,start)+';prepStorageHtml',{escAttr:value=>value});
  assert.match(storageHtml('ats','resume'), />Retry<\/button>/);
  assert.match(storageHtml('iprep','interview'), />Retry save and sync<\/button>/);
  let feedback, retry;
  env.prepRetryStorage=()=>{};
  ats.__resumeFeedback={paint(value,action){feedback=value;retry=action;}};
  env.prepSess=()=>'owner'; env.prepSyncing=false; paint();
  assert.equal(ats.hidden,true); assert.equal(feedback.state,'error');
  assert.equal(feedback.message,'Save not confirmed. Try again.'); assert.equal(feedback.actionLabel,'Retry');
  assert.equal(retry,env.prepRetryStorage);
  env.navigator.onLine=false; paint();
  assert.equal(feedback.message,"You're offline. Reconnect to save.");
  env.navigator.onLine=true;
  env.prepCloudErrors.set('ats/resume',Object.assign(new Error('Service unavailable'),{status:503})); paint();
  assert.equal(feedback.message,"Changes weren't saved. Try again later.");
  env.prepCloudErrors.set('ats/resume',Object.assign(new Error('Unauthorized'),{status:401})); paint();
  assert.equal(feedback.message,'Sign in again to save your changes.'); assert.equal(feedback.actionLabel,'');
  env.prepCloudErrors.clear(); env.prepOutbox={}; paint();
  assert.equal(feedback.state,'saved'); assert.equal(feedback.text,'Saved'); assert.equal(feedback.message,'');
  env.prepSess=()=>''; paint();
  assert.equal(feedback.state,'auth'); assert.equal(feedback.actionLabel,'');
});

test("Prepare storage failures keep generated results in memory until retry succeeds", {timeout:30000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => { const write = Storage.prototype.setItem; window.prepStorageBlocked = true; Storage.prototype.setItem = function(key,value) { if (window.prepStorageBlocked && key.startsWith('rk:prep:')) throw new DOMException('Storage full','QuotaExceededError'); return write.call(this,key,value); }; });
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-iprep-run]').click();
    await page.locator('.iprep__q').first().waitFor();
    assert.match(await page.locator('[data-prep-storage]:visible').innerText(), /Not saved on this device/);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')), null);
    await page.locator('.iprep-modal [data-cancel]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-iprep-hist-open]').first().click();
    assert.match(await page.locator('.iprep__q').first().innerText(), /Which decision/);
    await page.evaluate(() => { window.prepStorageBlocked = false; });
    await page.getByRole('button',{name:'Retry save and sync',exact:true}).click();
    await page.locator('[data-prep-storage]').waitFor({state:'hidden'});
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
    assert.match(saved.payload.questions[0].q, /Which decision/);
    assert.ok(saved.payload.source.text);
  } finally { await browser.close(); }
});

test("Prepare legacy results reconnect to an explicit source copy without regeneration", {timeout:45000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    const legacy = {iprep:[{id:'legacy-questions',tool:'iprep',at:1,payload:{level:'staff',jd:'SAVED_LEGACY_ROLE',fromAi:true,questions:[{q:'A preserved question',answer:'<p>A preserved answer.</p>'}]}}],story:[{id:'legacy-story',tool:'story',at:1,payload:{tone:'staff',dur:'5',themes:[{title:'A preserved angle'}],cur:{ti:0,title:'A preserved angle',script:{opener:'A preserved opening',beats:[],close:'A preserved close'},questions:[]}}}]};
    await page.evaluate(legacy => { localStorage.setItem('rk:prep:hist',JSON.stringify(legacy)); window.__rkDevEdit('work.1.study.blocks',[{type:'text',body:'RECONNECTED_EXPLICIT_EVIDENCE'}]); },legacy);
    await page.locator('.adm__tab[data-tab="ai"]').click();
    for (const [tool,id] of [['iprep','legacy-questions'],['story','legacy-story']]) {
      await page.locator('[data-act="prep-open"][data-tool="'+tool+'"]').click();
      await page.locator('[data-'+tool+'-hist-open="'+id+'"]').click();
      const modal = page.locator('.'+tool+'-modal');
      await modal.getByRole('button',{name:'Reconnect sources',exact:true}).click();
      if (tool === 'iprep') { await modal.locator('[data-iprep-proj][value="1"]').check(); await modal.locator('#iprepJd').fill('EXPLICIT_RECONNECT_ROLE'); }
      else { await modal.locator('.story__pick').selectOption('1'); await modal.locator('[data-story-align]').check(); await modal.locator('[data-story-jd-text]').fill('EXPLICIT_RECONNECT_ROLE'); }
      await modal.locator('[data-'+tool+'-run]').click();
      await page.waitForFunction(tool => JSON.parse(localStorage.getItem('rk:prep:hist'))[tool].length === 2,tool);
      const saved = await page.evaluate(tool => JSON.parse(localStorage.getItem('rk:prep:hist'))[tool],tool);
      assert.deepEqual(saved.find(entry=>entry.id===id),legacy[tool][0]);
      assert.equal(saved[0].payload.source.projects[0].id,'empty-case');
      assert.match(saved[0].payload.source.text,/RECONNECTED_EXPLICIT_EVIDENCE/);
      assert.equal(saved[0].payload.source.jd,'EXPLICIT_RECONNECT_ROLE');
      if (tool === 'iprep') assert.deepEqual(saved[0].payload.questions,legacy.iprep[0].payload.questions);
      else assert.deepEqual(saved[0].payload.cur.script,legacy.story[0].payload.cur.script);
      await modal.locator('[data-cancel]').click();
    }
    assert.equal(await page.evaluate(() => window.preparationCalls.length),0);
  } finally { await browser.close(); }
});

test('Prepare ATS cloud saves survive failed local draft and history writes', async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function prepDrainSync() {');
  const code = source.slice(start, source.indexOf('  // Pull a tool', start));
  const entries = {
    review:{id:'review',tool:'ats',payload:{resumeDocument:{sha256:'original'},text:'Original resume'}},
    workspace:{id:'workspace',tool:'ats',kind:'workspace',payload:{reviewId:'review',rb:{summary:'Edited on canvas'},design:{font:'inter',layout:'single'}}}
  };
  const writes = [];
  const context = {prepSess:()=> 'synthetic', ADMIN_WORKER:'https://private.example.test', prepSyncing:false, prepSyncError:'',
    prepPendingWrites:new Map([['rk:prep:hist',entries],['rk:prep:draft',{}]]), PREP_SYNC_KEY:'rk:prep:sync',
    prepOutbox:Object.fromEntries(['review','workspace'].map(id=>['ats/'+id,{tool:'ats',id,action:'put',revision:id}])),
    prepGet:(tool,id)=>entries[id], prepWrite:()=>false, prepPaintStorage(){}, AbortSignal, prepCloudSaved:new Map(), prepCloudErrors:new Map(),
    resumeSourceForSync:async reference=>({...reference,data:'original-bytes'}),
    fetch:async (url,options)=>{writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};},
    queueMicrotask(){throw new Error('A failed local write must not create a retry loop');}
  };
  await runInNewContext(code+'; prepDrainSync()',context);
  assert.deepEqual(writes.map(entry=>entry.id),['review','workspace']);
  assert.equal(writes[0].payload.resumeDocument.data,'original-bytes');
  assert.deepEqual(writes[1],entries.workspace);
  assert.deepEqual(Object.keys(context.prepOutbox),[]);
  assert.equal(context.prepPendingWrites.size,2);
});

test('Prepare ATS cloud acknowledgements keep newer edits and isolate failed source saves', async () => {
  const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const start=source.indexOf('  async function prepDrainSync() {');
  const code=source.slice(start,source.indexOf('  // Pull a tool',start));
  const queued=[],writes=[];
  const entries={review:{id:'review',tool:'ats',payload:{resumeDocument:{sha256:'source'}}},workspace:{id:'workspace',tool:'ats',payload:{rb:{summary:'First edit'}}}};
  let first=true;
  const context={prepSess:()=> 'synthetic',ADMIN_WORKER:'https://private.example.test',prepSyncing:false,prepSyncError:'',
    prepPendingWrites:new Map(),PREP_SYNC_KEY:'rk:prep:sync',prepCloudSaved:new Map(),prepCloudErrors:new Map(),
    prepOutbox:Object.fromEntries(['review','workspace'].map(id=>['ats/'+id,{tool:'ats',id,action:'put',revision:id}])),
    prepGet:(tool,id)=>structuredClone(entries[id]),prepWrite:()=>true,prepPaintStorage(){},AbortSignal,
    resumeSourceForSync:async()=>{throw new Error('Original file not available locally');},queueMicrotask:callback=>queued.push(callback),
    fetch:async(url,options)=>{
      writes.push(JSON.parse(options.body));
      if(first){first=false;entries.workspace.payload.rb.summary='Newer edit';context.prepOutbox['ats/workspace']={tool:'ats',id:'workspace',action:'put',revision:'newer'};}
      return {ok:true,json:async()=>({ok:true})};
    }
  };
  await runInNewContext(code+'; prepDrainSync()',context);
  assert.equal(context.prepOutbox['ats/workspace'].revision,'newer');
  assert.notEqual(context.prepCloudSaved.get('ats/workspace').signature,JSON.stringify(entries.workspace));
  assert.equal(context.prepCloudSaved.has('ats/review'),false);
  assert.equal(queued.length,1);
  await queued.shift()();
  assert.deepEqual(writes.map(entry=>entry.payload.rb.summary),['First edit','Newer edit']);
  assert.equal(context.prepCloudSaved.get('ats/workspace').signature,JSON.stringify(entries.workspace));
  assert.deepEqual(Object.keys(context.prepOutbox),['ats/review']);
  assert.equal(queued.length,0);
  context.resumeSourceForSync=async reference=>({...reference,data:'source-bytes'});
  context.fetch=async()=>({ok:true,json:async()=>({ok:false})});
  await context.prepDrainSync();
  assert.equal(context.prepCloudSaved.has('ats/review'),false);
  assert.ok(context.prepOutbox['ats/review']);
});

test('Prepare ATS backfill preserves newer cloud entries and deletion markers', async () => {
  const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
  const start=source.indexOf('  function prepCloudPull(tool, done) {');
  const code=source.slice(start,source.indexOf('  // Prepare tab =',start));
  const local=new Map([
    ['local-only',{id:'local-only',tool:'ats',at:1,payload:{rb:{summary:'Only local'}}}],
    ['newer-cloud',{id:'newer-cloud',tool:'ats',at:1,payload:{rb:{summary:'Stale local'}}}],
    ['newer-local',{id:'newer-local',tool:'ats',at:3,payload:{rb:{summary:'Current local'}}}]
  ]);
  const remote=new Map([
    ['newer-cloud',{id:'newer-cloud',tool:'ats',at:2,payload:{rb:{summary:'Current cloud'}}}],
    ['newer-local',{id:'newer-local',tool:'ats',at:1,payload:{rb:{summary:'Stale cloud'}}}],
    ['deleted',{id:'deleted',tool:'ats',at:4,payload:{rb:{summary:'Deleted entry'}}}]
  ]);
  const uploads=[],reads=[];
  await new Promise((resolve,reject)=>{
    const context={prepSess:()=> 'synthetic',ADMIN_WORKER:'https://private.example.test',prepDrainSync(){},prepSyncError:'',prepPaintStorage(){},
      prepCloudSaved:new Map(),prepOutbox:{'ats/deleted':{tool:'ats',id:'deleted',action:'del',acknowledged:true}},
      prepList:()=>[...local.values()],prepGet:(tool,id)=>local.get(id),prepPutLocal:(tool,entry)=>local.set(entry.id,entry),
      prepCloudPut:(tool,entry)=>{uploads.push(structuredClone(entry));context.prepOutbox['ats/'+entry.id]={tool,id:entry.id,action:'put'};},
      fetch:async url=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/list'))return {ok:true,json:async()=>({items:[...remote.values()].map(({id,at})=>({id,at}))})};const id=parsed.searchParams.get('id');reads.push(id);return {ok:true,json:async()=>structuredClone(remote.get(id))};},
      done:resolve
    };
    try {runInNewContext(code+'; prepCloudPull("ats",done)',context);}catch(error){reject(error);}
  });
  assert.deepEqual(uploads.map(entry=>entry.id).sort(),['local-only','newer-local']);
  assert.deepEqual(reads,['newer-cloud']);
  assert.deepEqual(local.get('newer-cloud'),remote.get('newer-cloud'));
  assert.equal(local.has('deleted'),false);
});

test('Prepare reopening an ATS review retains only its own loaded original', async () => {
  const source = readFileSync(new URL('./src/js/admin-studio.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function atsHistRestore(id) {');
  const code = source.slice(start, source.indexOf('  /* ---------- Rebuild the', start));
  for (const sameReview of [true, false]) {
    const file = { name: 'original.pdf', originalBytes: 'unchanged' };
    const payload = { state: { jd: 'Saved role' }, text: 'Saved resume', res: { score: 72 } };
    const context = { atsLast: { file }, atsvSessId: sameReview ? 'review' : 'other', atsState: {}, atsLevel: 'staff',
      prepGet: () => ({ kind: 'review', payload }), prepReadSource: () => null,
      document: { querySelector: () => null }, prepDraftSet() {}, prepRerenderDialog() {}, atsOpenViewer() {} };
    await runInNewContext(code + '; atsHistRestore("review")', context);
    assert.equal(context.atsLast.file, sameReview ? file : null);
    assert.equal(context.atsLast.text, payload.text);
  }
});

test('Prepare resume sources reject damaged synced bytes before storage', async () => {
  const { restoreResumeSource } = await import('./src/js/prepare-resume.mjs');
  const original = Buffer.from('Original PDF bytes');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', original)), byte => byte.toString(16).padStart(2, '0')).join('');
  await assert.rejects(restoreResumeSource({ version: 1, sha256: hash, size: original.length, name: 'resume.pdf', type: 'application/pdf', data: Buffer.from('Different PDF bytes').toString('base64') }), /integrity check/);
  await assert.rejects(restoreResumeSource({ version: 1, sha256: 'invalid' }), /reference is invalid/);
});

function preparePdfFixture(text, { pages = 1, width = 640, height = 360 } = {}) {
  const stream = '0.1 0.5 0.4 rg 40 290 520 15 re f 0 g BT /F1 16 Tf 40 240 Td (' + text + ') Tj ET';
  const pageObject = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`;
  const kids = ['3 0 R', ...Array.from({length:pages-1},(_,i)=>`${i+6} 0 R`)];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`,pageObject,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream', ...Array(pages-1).fill(pageObject)];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object,index) => { offsets.push(Buffer.byteLength(pdf)); pdf += (index+1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10,'0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n` + xref + '\n%%EOF';
  return pdf;
}

test('Post-check ATS workspace keeps review left, original annotations and working zoom without changing setup', {timeout:90000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await openIntegratedFixture(page);
    await page.route('**/src/js/prepare-resume.mjs', route => route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./src/js/prepare-resume.mjs',import.meta.url),'utf8')}));
    await page.evaluate(async pdf => {
      const { retainResumeSource } = await import('/src/js/prepare-resume.mjs');
      const resumeDocument = await retainResumeSource(new File([pdf], 'Synthetic original.pdf', {type:'application/pdf'}));
      const entry = {id:'coherence-review',tool:'ats',kind:'review',at:100,payload:{resumeDocument,resumeDocumentOrigin:'original',text:'Original designer resume with research and measurable outcomes.',level:'staff',state:{mode:'general',source:'site'},res:{score:72,band:'Good',summary:'Recorded synthetic assessment.',fixes:[{point:'Clarify contribution',how:'Keep existing evidence.',priority:'high',anchor:{type:'quote',quote:'Original designer',replacement:'Original product designer'}},{point:'Check overall scope',priority:'low',anchor:{type:'none'}}],keywords:{present:['research'],missing:['accessibility']}}}};
      localStorage.setItem('rk:prep:hist', JSON.stringify({ats:[entry]}));
    }, preparePdfFixture('Original designer resume with research and measurable outcomes.', {pages:2,width:640,height:900}));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    const setupControls = () => page.locator('.prep-dialog .ats').evaluate(root => ({
      actions: [...root.querySelectorAll('[data-act]')].map(element => ({ action: element.dataset.act, text: element.textContent.trim(), level: element.dataset.lvl, source: element.dataset.source, mode: element.dataset.mode })),
      fields: [...root.querySelectorAll('input, textarea, select')].map(element => ({ tag: element.tagName, type: element.type, label: element.getAttribute('aria-label') || element.closest('.af')?.querySelector('label')?.textContent, accept: element.getAttribute('accept') }))
    }));
    const setup = await setupControls();
    const history = await page.evaluate(() => localStorage.getItem('rk:prep:hist'));
    await page.locator('[data-act="ats-hist-open"][data-id="coherence-review"]').click();
    await page.locator('.atsv__pin').waitFor();
    const checkStudioFrame = async () => {
      assert.equal(await page.locator('.atsv__header').count(), 0);
      assert.equal(await page.locator('.atsv').getAttribute('aria-modal'), 'false');
      assert.equal(await page.locator('.adm > .adm__bar').evaluate(element => element.inert), false);
      assert.equal(await page.locator('.adm > .adm__statusbar').evaluate(element => element.inert), false);
      assert.equal(await page.locator('.adm > .adm__statusbar').evaluate(element => {
        const style = getComputedStyle(element), workspace = getComputedStyle(document.querySelector('.atsv'));
        return Number(style.zIndex) > Number(workspace.zIndex) && style.borderTopStyle === 'solid' && parseFloat(style.borderTopWidth) > 0 && style.boxShadow === 'none';
      }), true);
      const header = await page.locator('.adm > .adm__bar').boundingBox(), footer = await page.locator('.adm > .adm__statusbar').boundingBox(), review = await page.locator('.atsv').boundingBox();
      assert.ok(Math.abs(review.y - header.y - header.height) <= 1);
      assert.ok(Math.abs(review.y + review.height - footer.y) <= 1);
      const surfaces = await page.evaluate(() => {
        const reference = document.createElement('div');
        reference.className = 'adm is-casestage';
        reference.style.visibility = 'hidden';
        reference.innerHTML = '<div class="adm__workbar"></div><div class="adm__editor"><div class="story__item"></div></div>';
        document.body.append(reference);
        try {
          const pairs = [
            ['.atsv__bar', '.adm__workbar', 'backgroundColor'],
            ['.atsv__tools', '.adm__workbar', 'backgroundColor'],
            ['.atsv__navigation', '.adm__editor', 'borderRightColor'],
            ['.atsv__navigation', null, 'backgroundColor'],
            ['.atsv .resume-finding', '.story__item', 'backgroundColor']
          ];
          return pairs.map(([selector, target, property]) => ({selector, property,
            actual:getComputedStyle(document.querySelector(selector))[property],
            expected:getComputedStyle(target ? reference.querySelector(target) : reference)[property]}));
        } finally { reference.remove(); }
      });
      for (const surface of surfaces) assert.equal(surface.actual, surface.expected, `${surface.selector} ${surface.property} matches Work`);
    };
    await checkStudioFrame();
    assert.equal(await page.locator('.atsv__document-bar,.atsv__bar .atsv__ttl').count(),0);
    assert.match(await page.locator('.atsv__navigation > h2').innerText(),/Résumé review\s+Principal\s*\/\s*Staff/);
    const checkFloatingControls = async () => {
      await assertResumeViewTools(page.locator('.atsv__tools'));
      const metrics = await page.locator('.atsv__document').evaluate(documentView => {
        const tools=documentView.querySelector('.atsv__tools'), box=tools.getBoundingClientRect(), canvas=documentView.getBoundingClientRect();
        return {right:canvas.right-box.right,bottom:canvas.bottom-box.bottom,
          topPadding:parseFloat(getComputedStyle(documentView.querySelector('.atsv__stage')).paddingTop),
          bottomPadding:parseFloat(getComputedStyle(documentView.querySelector('.atsv__stage')).paddingBottom),
          rem:parseFloat(getComputedStyle(document.documentElement).fontSize),
          width:box.width,canvasWidth:canvas.width,
          labels:[...tools.querySelectorAll('button')].map(button=>button.getAttribute('aria-label')),
          sizes:[...tools.querySelectorAll('button')].map(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))};
      });
      assert.ok(Math.abs(metrics.right-12)<1,'Floaty stays 12px from the canvas right edge');
      assert.ok(Math.abs(metrics.bottom-12)<1,'Floaty stays 12px above the canvas bottom/footer');
      assert.ok(Math.abs(metrics.topPadding-metrics.rem*1.4)<1,'PDF regains the normal top inset');
      assert.ok(Math.abs(metrics.bottomPadding-metrics.rem*1.4)<1,'Floaty reserves no extra row beneath the PDF');
      assert.ok(metrics.width<metrics.canvasWidth-20,'Compact controls stay inside the canvas');
      const mode = await page.locator('.atsv__tools').getAttribute('data-fit-mode');
      assert.deepEqual(metrics.labels,['Zoom out','Zoom in',mode === 'page' ? 'Fit width' : 'Fit page','Light canvas']);
      assert.ok(metrics.sizes.every(size=>size.width===34 && size.height===34));
    };
    const fitPage = async () => {
      if (await page.locator('[data-atsv-zoom="fit"]').getAttribute('aria-label') === 'Fit width') {
        await page.locator('[data-atsv-zoom="fit"]').click();
        await page.waitForFunction(()=>document.querySelector('.atsv__tools').getAttribute('aria-busy')!=='true');
      }
      await page.getByRole('button',{name:'Fit page',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.atsv__tools').getAttribute('aria-busy')!=='true');
      assert.equal(await page.locator('[data-atsv-zoom="fit"]').getAttribute('title'),'Fit width');
      const fit=await page.locator('.atsv__stage').evaluate(stage=>{
        const paper=stage.querySelector('.atsv__page').getBoundingClientRect(), area=stage.getBoundingClientRect();
        const style=getComputedStyle(stage), width=stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight), height=stage.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
        return {fits:paper.left>=area.left && paper.right<=area.right+1 && paper.top>=area.top && paper.bottom<=area.bottom+1,width:paper.width,height:paper.height,expectedHeight:Math.min(2.2,width/640,height/900)*900};
      });
      assert.equal(fit.fits,true,'Fit page uses the canvas height without reserving a row for overlay controls');
      assert.ok(Math.abs(fit.height-fit.expectedHeight)<1,'Fit page uses all available space, with no hidden floaty allowance');
      assert.ok(Math.abs(fit.width/fit.height-640/900)<.01,'Fit preserves the page aspect ratio');
      return fit.width;
    };
    const fitWidth = async () => {
      await page.getByRole('button',{name:'Fit width',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.atsv__tools').getAttribute('aria-busy')!=='true');
      assert.equal(await page.locator('[data-atsv-zoom="fit"]').getAttribute('title'),'Fit page');
      const metrics=await page.locator('.atsv__stage').evaluate(stage=>{
        const style=getComputedStyle(stage);
        return {width:stage.querySelector('.atsv__page').getBoundingClientRect().width,
          expected:Math.min(2.2*640,stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))};
      });
      assert.ok(Math.abs(metrics.width-metrics.expected)<1,'Fit width uses available width independently of height');
    };
    await checkFloatingControls();
    const checkCanvas = async mode => {
      const styles=await page.locator('.atsv__stage').evaluate((stage,mode)=>{
        const reference=document.createElement('div'), paper=document.createElement('div');
        reference.className='rbz__main'; reference.dataset.canvas=mode; reference.style.cssText='position:fixed;left:-10000px';
        paper.className='rbz__page'; reference.append(paper); stage.parentElement.append(reference);
        const actual=getComputedStyle(stage), expected=getComputedStyle(reference);
        const result={mode:stage.dataset.canvas,background:actual.backgroundImage,expectedBackground:expected.backgroundImage,
          color:actual.backgroundColor,expectedColor:expected.backgroundColor,
          shadow:getComputedStyle(stage.querySelector('.atsv__page')).boxShadow,expectedShadow:getComputedStyle(paper).boxShadow};
        reference.remove(); return result;
      },mode);
      assert.equal(styles.mode,mode);
      assert.equal(styles.background,styles.expectedBackground,'Same smooth canvas as editor, not a dot grid');
      assert.equal(styles.color,styles.expectedColor);
      assert.equal(styles.shadow,styles.expectedShadow,'Same page lighting as editor');
      const toggle=page.getByRole('button',{name:'Light canvas',exact:true});
      assert.equal(await toggle.getAttribute('aria-pressed'),String(mode==='light'));
      assert.equal(await toggle.getAttribute('title'),mode==='light'?'Switch to dark canvas':'Switch to light canvas');
      assert.equal(await page.evaluate(()=>localStorage.getItem('rk:resume-preview:canvas')),mode);
    };
    await page.getByRole('button',{name:'Light canvas',exact:true}).click(); await checkCanvas('light');
    await page.getByRole('button',{name:'Light canvas',exact:true}).focus(); await page.keyboard.press('Enter'); await checkCanvas('dark');
    const canvasPeer=await page.context().newPage(); await canvasPeer.goto(page.url());
    await canvasPeer.evaluate(()=>localStorage.setItem('rk:resume-preview:canvas','light'));
    await page.locator('.atsv__stage[data-canvas="light"]').waitFor(); await checkCanvas('light');
    await page.getByRole('button',{name:'Light canvas',exact:true}).click();
    assert.equal(await canvasPeer.evaluate(()=>localStorage.getItem('rk:resume-preview:canvas')),'dark');
    await canvasPeer.close();
    const left = await page.locator('.atsv__navigation').boundingBox(), original = await page.locator('.atsv__document').boundingBox();
    assert.equal(left.width, 340); assert.ok(left.x + left.width <= original.x + 1);
    const dial = page.getByRole('img', { name: 'ATS score 72 out of 100', exact: true });
    assert.equal(await dial.innerText(), '72');
    assert.equal(await dial.evaluate(element => element.style.getPropertyValue('--p')), '72');
    assert.equal(await page.locator('.resume-score-copy h2').innerText(), 'Good');
    const geometry = await page.locator('.resume-score-summary').evaluate(element => {
      const ring = element.querySelector('.resume-score-dial').getBoundingClientRect(), copy = element.querySelector('.resume-score-copy').getBoundingClientRect();
      return { diameter: ring.width, height: ring.height, gap: copy.left - ring.right };
    });
    assert.deepEqual(geometry, { diameter: 66, height: 66, gap: 14 });
    assert.deepEqual(await page.locator('.atsv__rail > .prep-storage').evaluate(element => {
      const status = getComputedStyle(element), score = getComputedStyle(element.parentElement.querySelector('.resume-score-summary'));
      return { scoreDivider: score.borderBottomWidth, statusDivider: status.borderTopWidth, margin: status.marginTop, padding: status.paddingTop, role: element.getAttribute('role') };
    }), { scoreDivider: '1px', statusDivider: '0px', margin: '0px', padding: '0px', role: 'status' });
    const checkFailureRow = async () => {
      const paddingBefore=await page.locator('.atsv__stage').evaluate(stage=>getComputedStyle(stage).padding);
      await assertStudioToolbar(page.locator('.atsv__bar'), {historyVisible:false});
      assert.equal(await page.locator('.atsv__bar .studio-worknav button').count(),1,'Read-only review has Back, not fake Undo/Redo');
      await page.locator('.atsv').evaluate(workspace => {
        window.reviewRetryCount=0;
        workspace.__resumeFeedback.paint({state:'error',text:'Not saved',message:"You're offline. Reconnect to save.",actionLabel:'Retry'},()=>{window.reviewRetryCount++;});
      });
      const banner=page.locator('.resume-save-banner:visible');
      assert.equal(await banner.getAttribute('role'),'alert');
      assert.equal(await page.locator('.atsv__rail [data-prep-storage]').isVisible(),false);
      assert.equal(await banner.getByRole('button').count(),1);
      assert.equal(await banner.locator('span').innerText(),"You're offline. Reconnect to save.");
      const actionGeometry=await banner.getByRole('button').evaluate(button=>{
        const width=button.getBoundingClientRect().width, className=button.className;
        const style=getComputedStyle(button), padding=style.padding, transform=style.textTransform;
        button.className='btn btn--ghost';
        const toolbarWidth=button.getBoundingClientRect().width;
        button.className=className;
        return {width,toolbarWidth,padding,transform,className};
      });
      assert.equal(actionGeometry.className,'rk-flash__action');
      assert.equal(actionGeometry.padding,'2px 6px');
      assert.equal(actionGeometry.transform,'none');
      assert.ok(actionGeometry.width<actionGeometry.toolbarWidth,'Use the compact shared banner action, not a toolbar button');
      assert.equal(await banner.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
      const box=await banner.boundingBox(),footer=await page.locator('.adm__statusbar').boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=page.viewportSize().width && box.y+box.height< footer.y);
      const tools=await page.locator('.atsv__tools').boundingBox();
      assert.ok(Math.abs(footer.y-box.y-box.height-12)<1,'Banner retains its shared 12px footer offset');
      assert.ok(Math.abs(box.x+box.width/2-page.viewportSize().width/2)<1,'Banner remains centred');
      const separated=tools.x>=box.x+box.width+10 || tools.x+tools.width+10<=box.x || tools.y+tools.height+10<=box.y;
      assert.ok(separated,'Only the floaty moves when it would overlap the banner');
      if (page.viewportSize().width>=1200) assert.ok(Math.abs(footer.y-tools.y-tools.height-12)<1,'Desktop floaty stays in its normal corner when there is room');
      else assert.ok(tools.y+tools.height+10<=box.y,'Narrow floaty clears the unchanged banner');
      assert.equal(await page.locator('.atsv__stage').evaluate(stage=>getComputedStyle(stage).padding),paddingBefore,'Banner and floaty do not change PDF layout padding');
      await page.screenshot({path:join(tmpdir(),`rk-review-overlay-banner-${page.viewportSize().width}.png`)});
      await banner.getByRole('button',{name:'Retry',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.reviewRetryCount),1);
      await page.locator('.atsv').evaluate(workspace=>workspace.__resumeFeedback.paint({state:'saving',text:'Saving...',message:''},()=>{}));
      assert.equal(await banner.locator('span').innerText(),"You're offline. Reconnect to save.");
      assert.equal(await banner.getByRole('button').isDisabled(),true);
      await page.locator('.atsv').evaluate(workspace=>workspace.__resumeFeedback.paint({state:'saved',text:'Saved',message:''}));
      assert.equal(await page.locator('.resume-save-banner:visible').count(),0);
      assert.equal(await page.locator('.adm__status[data-resume-state]').innerText(),'Saved');
      await checkFloatingControls();
    };
    await checkFailureRow();
    assert.equal(await page.locator('.atsv__item').count(), 2);
    const item = page.locator('.atsv__item[data-fi="0"]');
    assert.equal(await item.evaluate(element => element.classList.contains('resume-finding')), true);
    assert.equal(await item.locator('.atsv__point').innerText(), 'Clarify contribution');
    assert.equal(await item.locator('.atsv__how').innerText(), 'Keep existing evidence.');
    assert.equal(await item.locator('.atsv__num').innerText(), '1');
    assert.equal(await page.locator('.atsv__rail .resume-finding-wording, .atsv__rail .atsv__rep, [data-atsv-copy]').count(), 0);
    assert.equal(await item.getByRole('button', { name: 'Copy', exact: true }).count(), 0);
    assert.doesNotMatch(await item.innerText(), /Original product designer|Earlier suggested wording/);
    assert.deepEqual(await item.evaluate(element => ['.atsv__point', '.atsv__how', '.atsv__pri'].map(selector => getComputedStyle(element.querySelector(selector)).fontSize)), ['12px', '12px', '10px']);
    assert.deepEqual(await item.evaluate(element => {
      const style = getComputedStyle(element);
      return { border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], radius: style.borderRadius, padding: style.padding, gap: style.marginBottom, distinctSurface: style.backgroundColor !== getComputedStyle(element.closest('.atsv__navigation')).backgroundColor };
    }), { border: ['1px', '1px', '1px', '1px'], radius: '12px', padding: '12px', gap: '12px', distinctSurface: true });
    const titleLeft = (await item.locator('.atsv__point').boundingBox()).x;
    await item.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.atsv__pin.is-active').count(), 1);
    assert.equal((await item.locator('.atsv__point').boundingBox()).x, titleLeft);
    const width = await page.locator('.atsv__page').first().evaluate(element => element.clientWidth);
    await page.getByRole('button', {name:'Zoom in',exact:true}).click();
    await page.waitForFunction(width => document.querySelector('.atsv__page')?.clientWidth > width, width);
    await page.waitForFunction(()=>document.querySelector('.atsv__tools').getAttribute('aria-busy')!=='true');
    await page.locator('.atsv__pin').waitFor();
    const fittedWidth = await fitPage();
    await page.locator('.atsv__pin').waitFor();
    await page.getByRole('button', {name:'Zoom out',exact:true}).click();
    await page.waitForFunction(width => document.querySelector('.atsv__page')?.clientWidth < width, fittedWidth);
    await page.waitForFunction(()=>document.querySelector('.atsv__tools').getAttribute('aria-busy')!=='true');
    await page.locator('.atsv__pin').waitFor();
    await page.locator('.atsv__stage').evaluate(stage=>{stage.style.scrollBehavior='auto';stage.scrollTop=stage.scrollHeight;});
    await page.waitForFunction(()=>document.querySelector('[data-atsv-pageno]').textContent==='Page 2 / 2');
    await checkFloatingControls();
    assert.equal(await page.locator('.atsv__navigation .atsv__lvl').isVisible(),true);
    await fitPage();
    assert.equal(await page.locator('[data-atsv-pageno]').innerText(),'Page 1 / 2');
    await fitWidth();
    await fitPage();
    await page.screenshot({path:join(tmpdir(),'rk-review-floaty-1440.png')});
    for (const width of [390, 320]) {
      await page.setViewportSize({width,height:844});
      await checkFailureRow();
      await checkStudioFrame();
      await checkFloatingControls();
      await fitPage();
      await page.getByRole('button',{name:'Light canvas',exact:true}).click(); await checkCanvas('light');
      await page.getByRole('button',{name:'Light canvas',exact:true}).click(); await checkCanvas('dark');
      await fitWidth();
      await fitPage();
      const fitButton=page.locator('[data-atsv-zoom="fit"]');
      await fitButton.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.querySelector('.atsv__tools').getAttribute('aria-busy')!=='true');
      assert.equal(await fitButton.evaluate(button=>document.activeElement===button),true);
      assert.equal(await fitButton.getAttribute('aria-label'),'Fit page');
      const bounds = await page.locator('.atsv__bar button, .atsv__tools button, .atsv__rail button').evaluateAll(buttons => buttons.filter(button => button.offsetWidth).map(button => { const b=button.getBoundingClientRect(); return {left:b.left,right:b.right}; }));
      assert.ok(bounds.every(b => b.left >= 0 && b.right <= width), JSON.stringify(bounds));
      assert.equal(await page.locator('.atsv__navigation').isVisible(), true);
      assert.equal(await page.locator('.atsv__document').isVisible(), true);
      await page.screenshot({path:join(tmpdir(),`rk-review-floaty-${width}.png`)});
    }
    await page.getByRole('button', {name:'Back to ATS check',exact:true}).click();
    assert.deepEqual(await setupControls(), setup);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')), history);
    await page.setViewportSize({width:1440,height:1000});
    for (const score of [0, 100, null]) {
      await page.evaluate(score => {
        const history = JSON.parse(localStorage.getItem('rk:prep:hist'));
        history.ats[0].payload.res.score = score;
        history.ats[0].payload.res.band = '';
        localStorage.setItem('rk:prep:hist', JSON.stringify(history));
      }, score);
      await page.locator('[data-act="ats-hist-open"][data-id="coherence-review"]').click();
      const dial = page.getByRole('img', {name:score === null ? 'ATS score unavailable' : `ATS score ${score} out of 100`,exact:true});
      await dial.waitFor();
      assert.equal(await dial.innerText(), score === null ? '--' : String(score));
      assert.equal(await dial.evaluate(element => element.style.getPropertyValue('--p')), String(score ?? 0));
      if (score === null) assert.equal(await page.locator('.resume-score-copy h2').innerText(), 'Not assessed');
      await page.getByRole('button', {name:'Back to ATS check',exact:true}).click();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Candidate ATS intake and retained-original launcher share the assessment dialog without creating an editor', { timeout: 120000 }, async () => {
  const mime = execFileSync('python', ['-B', '-c', 'import serve; assert serve.NoCacheHandler.extensions_map[".mjs"] == "text/javascript"; assert serve.NoCacheHandler.extensions_map[".js"] == "text/javascript"; print("text/javascript")'], { encoding: 'utf8' }).trim();
  const { ASSESSMENT_DEVELOPMENT_CASES, createSampleAssessmentPilot } = await import('./src/js/resume-assessment-sample.mjs');
  const reference = ASSESSMENT_DEVELOPMENT_CASES[0], sample = await createSampleAssessmentPilot(reference.id);
  const inventory = await sample.pilot.inventory({ confirmed: true }); await sample.pilot.approveInventory({ confirmed: true });
  await sample.pilot.approveEvidence({ confirmed: true }); const result = await sample.pilot.evaluate({ confirmed: true });
  const quoteOnly = node => node.kind === 'atom' ? { kind: node.kind, id: node.id, segmentId: node.segmentId, quote: node.quote } : { ...node, children: node.children.map(quoteOnly) };
  const outputs = { requirements: { ...inventory.manifest, requirements: inventory.manifest.requirements.map(item => ({ ...item, condition: quoteOnly(item.condition) })) }, assessment: result.draft, challenge: result.challenge };
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), calls = [], storageCalls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await openIntegratedFixture(page);
    // Existing shared servers are not restarted by tests; mirror the checked-in handler mapping.
    await page.context().route('**/studio/resume-preview/assets/pdf.worker.mjs', route => route.fulfill({ contentType: mime, body: readFileSync(new URL('./studio/resume-preview/assets/pdf.worker.mjs', import.meta.url)) }));
    await page.route('**/admin/resume/**', route => { storageCalls.push(route.request().url()); return route.abort(); });
    await page.context().route('https://api.anthropic.com/v1/messages', async route => {
      const request = route.request().postDataJSON();
      const stage = request.system.includes('Inventory the job BEFORE') ? 'requirements' : request.system.includes('Independently challenge') ? 'challenge' : 'assessment';
      calls.push({ stage, request });
      const output = structuredClone(outputs[stage]);
      if (output.semantic) {
        const data = JSON.parse(request.messages.at(-1).content);
        output.semantic.excerpts = output.semantic.excerpts.filter(item => data.evidence.some(excerpt => excerpt.id === item.id));
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'synthetic-candidate-' + calls.length, type: 'message', role: 'assistant', model: request.model,
        stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 200 } }) });
    });
    await page.evaluate(() => window.__rkDevEdit('contact.resume', ''));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    assert.equal(await page.locator('[data-act="ats-candidate"]').count(), 0);
    await page.locator('[data-prep-launch-close]').click();
    await page.evaluate(() => history.replaceState(null, '', location.pathname + '?devstub&candidate=1'));
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-ats-file]').setInputFiles({ name: 'Fictional intake.txt', mimeType: 'text/plain', buffer: Buffer.from(reference.text) });
    await page.locator('[data-act="ats-mode"][data-mode="job"]').click();
    await page.locator('.prep-dialog .cl__jd').fill(reference.jd);
    await page.locator('.prep-dialog .cl__company').fill('Fictional target');
    const before = await page.evaluate(() => ({ draft: JSON.stringify(window.__RKStudio.getDraft()), history: localStorage.getItem('rk:prep:hist') }));
    const trigger = page.locator('[data-act="ats-candidate"]');
    await trigger.click();
    const frame = page.frameLocator('iframe[title="Candidate assessment"]'), dialog = frame.getByRole('dialog', { name: 'Candidate assessment', exact: true });
    await dialog.getByRole('button', { name: 'Prepare selected resume file' }).click();
    await dialog.locator('[data-candidate-artifact-hash]').waitFor();
    assert.equal(await frame.locator('.rws-status').count(), 0);
    assert.equal(calls.length, 0); assert.deepEqual(storageCalls, []);
    if (process.env.RESUME_CANDIDATE_SCREENSHOT_DIR) await dialog.locator('.pass__box').screenshot({ path: join(process.env.RESUME_CANDIDATE_SCREENSHOT_DIR, 'candidate-pre-editor-intake.png') });
    await dialog.getByLabel('Budget authority', { exact: true }).selectOption('browser-origin');
    await dialog.getByRole('button', { name: 'Load available models' }).click();
    await dialog.getByLabel('Pilot model', { exact: true }).selectOption('session-model');
    await dialog.getByLabel('Approved total budget (USD)', { exact: true }).fill('1');
    await dialog.getByRole('checkbox', { name: 'I approve this browser-local pilot budget' }).check();
    await dialog.getByRole('button', { name: 'Connect approved pilot' }).click();
    await dialog.locator('[data-candidate-phase="ready"]').waitFor();
    await dialog.getByRole('checkbox', { name: 'Allow this complete job description' }).check();
    await dialog.getByRole('button', { name: 'Build job inventory' }).click();
    await dialog.locator('[data-candidate-phase="inventory-review"]').waitFor();
    await dialog.getByRole('checkbox', { name: 'I reviewed all job requirements' }).check();
    await dialog.getByRole('button', { name: 'Approve job inventory' }).click();
    await dialog.getByRole('checkbox', { name: 'I reviewed the included evidence' }).check();
    await dialog.getByRole('button', { name: 'Approve included evidence' }).click();
    await dialog.getByRole('checkbox', { name: 'Allow the selected evidence to be sent' }).check();
    await dialog.getByRole('button', { name: 'Run assessment and challenge' }).click();
    await dialog.locator('[data-candidate-result]').waitFor();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:resume:assessment-pilot:candidate-review')).results[0]);
    assert.equal(saved.report.binding.documentId, null);
    assert.equal(saved.report.binding.artifactSha256, sample.snapshot.binding.artifactSha256);
    assert.equal(calls.length, 3); assert.deepEqual(storageCalls, []);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())), before.draft);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')), before.history);
    await page.keyboard.press('Escape');
    await page.locator('iframe[title="Candidate assessment"]').waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    await trigger.click();
    await dialog.getByRole('button', { name: 'Prepare selected resume file' }).click();
    await dialog.locator('[data-candidate-artifact-hash]').waitFor();
    await page.locator('.prep-dialog .cl__jd').evaluate(element => { element.value += '\nA newly changed target requirement.'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    await dialog.getByLabel('Budget authority', { exact: true }).selectOption('browser-origin');
    await dialog.getByRole('button', { name: 'Load available models' }).click();
    await dialog.getByLabel('Pilot model', { exact: true }).selectOption('session-model');
    await dialog.getByLabel('Approved total budget (USD)', { exact: true }).fill('1');
    await dialog.getByRole('checkbox', { name: 'I approve this browser-local pilot budget' }).check();
    await dialog.getByRole('button', { name: 'Connect approved pilot' }).click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').innerText(), /artifact or target changed/);
    assert.equal(calls.length, 3);
    await dialog.getByRole('button', { name: 'Start over', exact: true }).click();
    await dialog.getByRole('button', { name: 'Prepare selected resume file' }).click();
    await dialog.locator('[data-candidate-artifact-hash]').waitFor();
    assert.equal(await dialog.getByRole('alert').count(), 0);
    assert.equal(await dialog.getByRole('button', { name: 'Load available models' }).isEnabled(), true);
    await dialog.getByText('Target job and recovered file text', { exact: true }).click();
    assert.match(await dialog.innerText(), /A newly changed target requirement/);
    await page.keyboard.press('Escape');
    await page.locator('iframe[title="Candidate assessment"]').waitFor({ state: 'detached' });
    await page.route('**/src/js/prepare-resume.mjs', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL('./src/js/prepare-resume.mjs', import.meta.url), 'utf8') }));
    await page.evaluate(async pdf => {
      const { retainResumeSource } = await import('/src/js/prepare-resume.mjs');
      const resumeDocument = await retainResumeSource(new File([pdf], 'Retained fictional original.pdf', { type: 'application/pdf' }));
      localStorage.setItem('rk:prep:hist', JSON.stringify({ ats: [{ id: 'candidate-retained', tool: 'ats', kind: 'review', at: 100,
        payload: { resumeDocument, resumeDocumentOrigin: 'original', text: 'Deliberately stale cached text.', level: 'staff', state: { mode: 'general' }, res: { score: 72, band: 'Good', fixes: [] } } }] }));
    }, preparePdfFixture('Retained original evidence with research and measurable outcomes.'));
    await page.locator('[data-prep-launch-close]').click();
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-act="ats-hist-open"][data-id="candidate-retained"]').click();
    await page.locator('.atsv__page canvas').waitFor();
    const history = await page.evaluate(() => localStorage.getItem('rk:prep:hist'));
    await page.getByRole('button', { name: 'Candidate original recheck' }).click();
    await dialog.getByRole('button', { name: 'Prepare selected resume file' }).click();
    await Promise.race([dialog.locator('[data-candidate-artifact-hash]').waitFor(), dialog.getByRole('alert').waitFor()]);
    assert.equal(await dialog.getByRole('alert').count(), 0, await dialog.innerText());
    await dialog.getByText('Target job and recovered file text', { exact: true }).click();
    assert.match(await dialog.innerText(), /Retained original evidence/);
    assert.doesNotMatch(await dialog.innerText(), /Deliberately stale/);
    const blocked = await page.evaluate(async () => {
      const caller = document.querySelector('iframe[title="Candidate assessment"]').contentWindow;
      const attempt = async action => { try { await action(); return ''; } catch (error) { return error.message; } };
      const spoof = await attempt(() => window.__RKStudio.resume.candidateInput(window));
      const storage = await attempt(() => window.__RKStudio.resume.request('library', {}, caller));
      const controller = new AbortController(); controller.abort();
      const cancelled = await attempt(() => window.__RKStudio.resume.candidateInput(caller, controller.signal, true));
      const saved = localStorage.getItem('rk:prep:hist'), changed = JSON.parse(saved);
      changed.ats[0].payload.res.score = 99;
      let stale;
      try {
        localStorage.setItem('rk:prep:hist', JSON.stringify(changed));
        stale = await attempt(() => window.__RKStudio.resume.candidateInput(caller, undefined, true));
      } finally { localStorage.setItem('rk:prep:hist', saved); }
      window.__closedCandidate = caller;
      return { spoof, storage, cancelled, stale };
    });
    assert.match(blocked.spoof, /session is closed/); assert.match(blocked.storage, /cannot access editable/);
    assert.match(blocked.cancelled, /abort/i);
    assert.match(blocked.stale, /original review changed/);
    await page.keyboard.press('Escape');
    await page.locator('iframe[title="Candidate assessment"]').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('img', { name: 'ATS score 72 out of 100', exact: true }).innerText(), '72');
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')), history);
    assert.match(await page.evaluate(async () => {
      try { await window.__RKStudio.resume.candidateInput(window.__closedCandidate); return ''; } catch (error) { return error.message; }
    }), /session is closed/);
    await page.getByRole('button', { name: 'Back to ATS check', exact: true }).click();
    await page.locator('[data-prep-launch-close]').click();
    await page.evaluate(pdf => window.__rkDevEdit('contact.resume', 'data:application/pdf;base64,' + btoa(pdf)),
      preparePdfFixture('Fictional site resume with research and measurable outcomes.'));
    const siteDraft = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-prep-launch-view="new"]').click();
    await page.locator('[data-act="ats-source"][data-source="site"]').click();
    await page.locator('[data-act="ats-mode"][data-mode="general"]').click();
    await trigger.click();
    await dialog.getByRole('button', { name: 'Prepare selected resume file' }).click();
    await dialog.locator('[data-candidate-artifact-hash]').waitFor();
    await dialog.getByText('Target job and recovered file text', { exact: true }).click();
    assert.match(await dialog.innerText(), /Fictional site resume/);
    await page.keyboard.press('Escape');
    await page.locator('iframe[title="Candidate assessment"]').waitFor({ state: 'detached' });
    await page.locator('[data-act="ats-mode"][data-mode="job"]').click();
    await page.locator('.prep-dialog .cl__jd').fill('');
    await trigger.click();
    await dialog.getByRole('button', { name: 'Prepare selected resume file' }).click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').innerText(), /job-specific check needs the job description/);
    assert.equal(await dialog.getByRole('button', { name: 'Load available models' }).count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('iframe[title="Candidate assessment"]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())), siteDraft);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')), history);
    assert.equal(calls.length, 3); assert.deepEqual(storageCalls, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Prepare ATS retains the original before AI and preserves history on document-storage failure', {timeout:45000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const pdf = preparePdfFixture('Original designer resume with research, strategy and measurable product outcomes.');
    await installPrepareReplies(page);await openIntegratedFixture(page);
    await page.evaluate(pdf=>{
      window.__rkDevEdit('contact.resume','data:application/pdf;base64,'+btoa(pdf));
      localStorage.setItem('rk:prep:hist',JSON.stringify({ats:[{id:'preserve-me',tool:'ats',kind:'workspace',at:1,payload:{rb:{name:'Preserved draft'},design:{accent:'#167d83'}}}]}));
      window.resumeTransaction=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(names,mode,...rest){if(this.name==='rk-prepare-resume-sources-v1'&&mode==='readwrite')throw new DOMException('Synthetic document quota','QuotaExceededError');return window.resumeTransaction.call(this,names,mode,...rest);};
    },pdf);
    const before = await page.evaluate(()=>localStorage.getItem('rk:prep:hist'));
    await page.locator('.adm__tab[data-tab="ai"]').click();await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-prep-launch-view="new"]').click();
    await page.locator('[data-act="ats-check"]').click();
    await page.waitForFunction(()=>document.querySelector('.ats__err')?.textContent.includes('Synthetic document quota'));
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:prep:hist')),before);
    await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.resumeTransaction;});
    await page.locator('[data-act="ats-check"]').click();
    await page.locator('.atsv__page canvas').waitFor();
    const entry = await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.kind==='review'));
    assert.equal(entry.payload.resumeDocumentOrigin,'original');assert.equal(entry.payload.resumeDocument.data,undefined);
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),1);
    await page.evaluate(()=>window.__rkDevEdit('contact.resume','data:text/plain,Unrelated replacement'));
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.evaluate(()=>document.querySelectorAll('.pass--lock').forEach(dialog=>dialog.remove()));
    await page.locator('.adm__tab[data-tab="ai"]').click();await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-act="ats-hist-open"][data-id="'+entry.id+'"]').click();await page.locator('.atsv__page canvas').waitFor();
    assert.equal(await page.locator('[data-atsv-recovered]').count(),0);
    const stored = await page.evaluate(async hash=>{
      const database=await new Promise(resolve=>{const request=indexedDB.open('rk-prepare-resume-sources-v1',1);request.onsuccess=()=>resolve(request.result);});
      const blob=await new Promise(resolve=>{const request=database.transaction('documents').objectStore('documents').get(hash);request.onsuccess=()=>resolve(request.result);});database.close();return blob.text();
    },entry.payload.resumeDocument.sha256);
    assert.equal(stored,pdf);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='preserve-me')),JSON.parse(before).ats[0]);
    await page.locator('[data-atsv-close]').click();
    await page.evaluate(({entry,pdf})=>{
      const history=JSON.parse(localStorage.getItem('rk:prep:hist'));
      const legacy=structuredClone(entry);legacy.id='legacy-site-copy';delete legacy.payload.resumeDocument;delete legacy.payload.resumeDocumentOrigin;
      history.ats.push(legacy);localStorage.setItem('rk:prep:hist',JSON.stringify(history));
      window.__rkDevEdit('contact.resume','data:application/pdf;base64,'+btoa(pdf));
    },{entry,pdf});
    await page.locator('.prep-dialog [data-prep-launch-close]').click();
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-act="ats-hist-open"][data-id="legacy-site-copy"]').click();
    await page.locator('[data-atsv-recover="site"]').click();await page.locator('.atsv__page canvas').waitFor();
    const siteRecovered=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='legacy-site-copy').payload);
    assert.equal(siteRecovered.resumeDocument.sha256,entry.payload.resumeDocument.sha256);
    assert.equal(siteRecovered.resumeDocumentOrigin,'site-match');assert.deepEqual(siteRecovered.res,entry.payload.res);
  } finally { await browser.close(); }
});

test('Prepare ATS recovers its original PDF, exact source bytes and retains linked snapshots across reload and devices', {timeout:90000}, async () => {
  const text = 'Original designer resume with research, strategy and measurable product outcomes.';
  const pdf = preparePdfFixture(text);
  const review = {id:'source-review',tool:'ats',kind:'review',at:1,payload:{state:{mode:'job',jd:'Saved target role'},text,level:'staff',res:{score:72,fixes:[{point:'Keep this evidence',priority:'low',anchor:{type:'quote',quote:'Original designer'}}]},source:{version:1,text,jd:'Saved target role',projects:[],brief:null}}};
  const workspace = {id:'source-workspace',tool:'ats',kind:'workspace',at:2,payload:{reviewId:review.id,level:'staff',text,jd:'Saved target role',rb:{name:'Preserved Designer',title:'Staff Designer',contact:{email:'synthetic@example.test',links:[]},summary:'Preserved edited summary.',sections:[{heading:'Experience',kind:'experience',items:[{role:'Lead',org:'Original Org',dates:'2020 - Present',bullets:['Preserved authored achievement.']}]}]},design:{tpl:'classic',size:'a4',accent:'#167d83',font:'inter',density:'normal',layout:'single',canvas:'light',keepWhole:true,margin:'normal'}}};
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const remote = new Map(); let writes = 0, failWorkspaceSave = false;
  const open = async page => {
    await page.addInitScript(() => {
      window.__rkAdminAuth = { session: { token: 'synthetic-prepare-only', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
      localStorage.setItem('rk:autopub:on','0');
    });
    await page.route('**/admin/prep/**',async route => {
      const url = new URL(route.request().url());
      if(url.pathname.endsWith('/put')) { const entry=route.request().postDataJSON();if(failWorkspaceSave&&entry.kind==='workspace')return route.fulfill({status:503,json:{error:'Unavailable'}});remote.set(entry.id,entry);writes++;return route.fulfill({json:{ok:true}}); }
      if(url.pathname.endsWith('/list')) return route.fulfill({json:{items:[...remote.values()].map(entry=>({id:entry.id,at:entry.at}))}});
      if(url.pathname.endsWith('/get')) return route.fulfill({json:remote.get(url.searchParams.get('id')) || {}});
      return route.abort();
    });
    await openIntegratedFixture(page);
  };
  const showReview = async page => {
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-act="ats-hist-open"][data-id="source-review"]').click();
  };
  try {
    let context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page = await context.newPage();
    await open(page);
    await page.evaluate(({review,workspace,pdf}) => {
      localStorage.setItem('rk:prep:hist',JSON.stringify({ats:[review,workspace]}));
      window.__rkDevEdit('contact.resume','data:application/pdf;base64,'+btoa(pdf.replace('Original designer','Different person!')));
    },{review,workspace,pdf});
    await showReview(page);
    await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('rk:prep:sync'))).length===0);
    assert.deepEqual(await page.locator('[data-atsv-zoom]').evaluateAll(buttons=>buttons.map(button=>button.disabled)),[true,true,true]);
    await page.getByRole('button',{name:'Light canvas',exact:true}).click();
    assert.equal(await page.locator('.atsv__stage').getAttribute('data-canvas'),'light','Lighting works even when the original PDF is unavailable');
    assert.equal(await page.locator('.atsv__nopdf b').evaluate(element=>getComputedStyle(element).color),'rgb(28, 26, 23)');
    assert.deepEqual(remote.get(workspace.id),workspace);
    assert.deepEqual(remote.get(review.id),review);
    const writesBeforeRecovery = writes;
    await page.screenshot({path:join(tmpdir(),'rk-ats-recovery-desktop.png')});
    await page.locator('[data-atsv-recover="site"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-atsv-source-status]')?.textContent.includes('differs'));
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats),[review,workspace]);
    let releaseSource;
    const started = new Promise(resolve=>{
      page.route('**/delayed-resume.pdf',async route=>{resolve();await new Promise(release=>{releaseSource=release;});await route.fulfill({contentType:'application/pdf',body:Buffer.from(pdf)}).catch(()=>{});});
    });
    await page.evaluate(()=>window.__rkDevEdit('contact.resume','/delayed-resume.pdf'));
    await page.locator('[data-atsv-recover="site"]').click();await started;
    await page.locator('[data-atsv-close]').click();releaseSource();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats),[review,workspace]);
    await page.locator('[data-act="ats-hist-open"][data-id="source-review"]').click();
    assert.equal(await page.locator('.atsv__stage').getAttribute('data-canvas'),'light','Review reopens with the shared preference');
    await page.getByRole('button',{name:'Light canvas',exact:true}).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.atsv__nopdf [data-atsv-attach]').click()]);
    await chooser.setFiles({name:'original-layout.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});
    await page.locator('.atsv__page canvas').waitFor();
    await page.locator('.atsv__pin').waitFor();
    assert.deepEqual(await page.locator('[data-atsv-zoom]').evaluateAll(buttons=>buttons.map(button=>button.disabled)),[false,false,false]);
    await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('rk:prep:sync'))).length===0);
    assert.equal(writes,writesBeforeRecovery+1);
    const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='source-review'));
    assert.equal(saved.payload.resumeDocument.data,undefined);
    assert.equal(Buffer.from(remote.get(review.id).payload.resumeDocument.data,'base64').toString(),pdf);
    assert.deepEqual(saved.payload.res,review.payload.res);
    assert.deepEqual(saved.payload.source,review.payload.source);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='source-workspace')),workspace);
    const pixels = await page.locator('.atsv__page canvas').evaluate(canvas=>{
      const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let ink=0,green=0;
      for(let index=0;index<data.length;index+=4){if(data[index]<80&&data[index+1]<80&&data[index+2]<80)ink++;if(data[index+1]>data[index]*2&&data[index+1]>data[index+2])green++;}
      return {ink,green,width:canvas.width,height:canvas.height};
    });
    assert.ok(pixels.ink>100 && pixels.green>1000,JSON.stringify(pixels));
    await page.screenshot({path:join(tmpdir(),'rk-ats-restored-desktop.png')});
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.evaluate(()=>document.querySelectorAll('.pass--lock').forEach(dialog=>dialog.remove()));
    await showReview(page);await page.locator('.atsv__pin').waitFor();
    const reopened = await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='source-workspace').payload);
    assert.deepEqual(reopened.rb,workspace.payload.rb);assert.deepEqual(reopened.design,workspace.payload.design);
    await context.close();
    context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});page=await context.newPage();
    await open(page);await showReview(page);await page.locator('.atsv__pin').waitFor();
    assert.equal(await page.locator('.atsv__nopdf').count(),0);
    const restored = await page.evaluate(async()=>{
      const entry=JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='source-review');
      const database=await new Promise(resolve=>{const request=indexedDB.open('rk-prepare-resume-sources-v1',1);request.onsuccess=()=>resolve(request.result);});
      const blob=await new Promise(resolve=>{const request=database.transaction('documents').objectStore('documents').get(entry.payload.resumeDocument.sha256);request.onsuccess=()=>resolve(request.result);});database.close();
      return {text:await blob.text(),reference:entry.payload.resumeDocument,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(restored.text,pdf);assert.equal(restored.reference.data,undefined);assert.equal(restored.overflow,false);
    const controls = await page.locator('.atsv__bar button').evaluateAll(buttons=>buttons.map(button=>{const box=button.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom};}));
    assert.ok(controls.every(box=>box.left>=0&&box.right<=390));
    for(let first=0;first<controls.length;first++)for(let second=first+1;second<controls.length;second++){
      const left=controls[first],right=controls[second];assert.ok(left.right<=right.left||right.right<=left.left||left.bottom<=right.top||right.bottom<=left.top);
    }
    await page.screenshot({path:join(tmpdir(),'rk-ats-restored-mobile.png')});
    const recoveredWorkspace=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).ats.find(entry=>entry.id==='source-workspace').payload);
    assert.deepEqual(recoveredWorkspace.rb,workspace.payload.rb);assert.deepEqual(recoveredWorkspace.design,workspace.payload.design);
    await context.close();
  } finally { await browser.close(); }
});

test("Prepare saved ATS reviews retain their resume and role and cancel closed rechecks", {timeout:45000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"}), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => {
      const text = 'ORIGINAL_ATS_RESUME: Product designer with experience in user research and interaction design.';
      window.__rkDevEdit('contact.resume','data:text/plain,CHANGED_ATS_RESUME');
      localStorage.setItem('rk:prep:hist',JSON.stringify({ats:[{id:'saved-ats',tool:'ats',kind:'review',at:1,payload:{state:{mode:'job',jd:'ORIGINAL_ATS_ROLE',company:'OriginalCo'},text,company:'OriginalCo',level:'staff',res:{score:60,checks:[],fixes:[]},source:{version:1,text,jd:'ORIGINAL_ATS_ROLE',projects:[],brief:null}}}]}));
    });
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="ats"]').click();
    await page.locator('[data-act="ats-hist-open"][data-id="saved-ats"]').click();
    await page.locator('.atsv__nopdf summary').click();
    await page.locator('.atsv__savedtext').waitFor();
    assert.match(await page.locator('.atsv__savedtext').innerText(),/ORIGINAL_ATS_RESUME/);
    assert.doesNotMatch(await page.locator('.atsv').innerText(),/CHANGED_ATS_RESUME/);
    await page.locator('[data-atsv-regen]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('rk:prep:hist')).ats[0].payload.res.summary === 'ATS_RECHECK_RESULT');
    const request = await page.evaluate(() => window.preparationCalls.at(-1).user);
    assert.match(request,/ORIGINAL_ATS_RESUME/); assert.match(request,/ORIGINAL_ATS_ROLE/); assert.doesNotMatch(request,/CHANGED_ATS_RESUME/);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).ats[0]);
    assert.equal(saved.payload.source.jd,'ORIGINAL_ATS_ROLE');
    await page.evaluate(() => { window.deferAtsReply = true; });
    await page.locator('[data-atsv-regen]').click();
    await page.waitForFunction(() => typeof window.releaseAtsReply === 'function');
    await page.locator('[data-atsv-close]').click();
    await page.evaluate(() => window.releaseAtsReply());
    await page.waitForFunction(() => window.atsReplyReturned && window.__rkAiSession.state().active === 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).ats[0].at),saved.at);
    assert.equal(await page.locator('.prep-dialog').isVisible(),true);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Prepare restored letters regenerate from their saved resume and evidence", {timeout:45000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => {
      localStorage.setItem('rk:prep:hist',JSON.stringify({cl:[{id:'original-letter',tool:'cl',at:1,payload:{state:{jd:'ORIGINAL_LETTER_ROLE',company:'OriginalCo',length:'full'},level:'staff',letter:'A preserved original letter.',source:{version:1,text:'ORIGINAL_LETTER_EVIDENCE',jd:'ORIGINAL_LETTER_ROLE',company:'OriginalCo',resume:'ORIGINAL_LETTER_RESUME',projects:[],brief:null}}}]}));
      window.__rkDevEdit('work.0.study.blocks',[{type:'text',body:'CHANGED_LETTER_EVIDENCE'}]);
    });
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="cl"]').click();
    await page.locator('[data-act="cl-hist-open"][data-id="original-letter"]').click();
    await page.locator('[data-act="cl-regen"]').click();
    await page.waitForFunction(() => window.preparationCalls.some(call=>call.system.includes('COMPLETE, personalised cover letter')) && window.__rkAiSession.state().active === 0);
    const request = await page.evaluate(() => window.preparationCalls.at(-1).user);
    assert.match(request,/ORIGINAL_LETTER_EVIDENCE/);
    assert.match(request,/ORIGINAL_LETTER_RESUME/);
    assert.match(request,/ORIGINAL_LETTER_ROLE/);
    assert.doesNotMatch(request,/CHANGED_LETTER_EVIDENCE/);
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).cl);
    assert.equal(history.length,2);
    assert.equal(history.find(entry=>entry.id==='original-letter').payload.letter,'A preserved original letter.');
    await page.locator('[data-act="cl-length"][data-len="short"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:draft')).cl.source.resume),'ORIGINAL_LETTER_RESUME');
  } finally { await browser.close(); }
});

test("Prepare restored interviews and stories keep their original evidence and role", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page);
    await openIntegratedFixture(page);
    await page.evaluate(() => {
      window.__rkDevEdit('work.0.study.blocks',[{type:'text',body:'OTHER_PROJECT_EVIDENCE'}]);
      window.__rkDevEdit('work.1.study.blocks',[{type:'text',body:'ORIGINAL_PROJECT_EVIDENCE'}]);
    });
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-iprep-proj][value="1"]').check();
    await page.locator('#iprepJd').fill('ORIGINAL_TARGET_ROLE');
    await page.locator('[data-iprep-run]').click();
    await page.locator('.iprep__q').first().waitFor();
    const interview = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
    assert.deepEqual(interview.payload.source.projects.map(project => project.id), ['empty-case']);
    assert.match(interview.payload.source.text, /ORIGINAL_PROJECT_EVIDENCE/);
    assert.equal(interview.payload.source.jd, 'ORIGINAL_TARGET_ROLE');
    await page.locator('.iprep-modal [data-cancel]').click();
    await page.locator('[data-act="prep-open"][data-tool="story"]').click();
    await page.locator('.story__pick').selectOption('1');
    await page.locator('[data-story-align]').check();
    await page.locator('[data-story-jd-text]').fill('ORIGINAL_STORY_ROLE');
    await page.locator('[data-story-run]').click();
    await page.locator('[data-story-tell="0"]').click();
    await page.locator('[data-story-copy]').waitFor();
    const story = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).story[0]);
    assert.equal(story.payload.source.projects[0].id, 'empty-case');
    await page.locator('.story-modal [data-cancel]').click();
    await page.evaluate(() => {
      window.__rkDevEdit('work.1.study.blocks',[{type:'text',body:'CHANGED_PROJECT_EVIDENCE'}]);
      localStorage.setItem('rk:story:jd',JSON.stringify({on:true,text:'OTHER_TARGET_ROLE'}));
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === 'function' && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll('.pass--lock').forEach(dialog => dialog.remove()));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-iprep-hist-open="'+interview.id+'"]').click();
    assert.match(await page.locator('.iprep-modal [data-prep-source]').innerText(), /Current content has changed/);
    await page.locator('[data-iprep-ans="0"]').click();
    await page.locator('.iprep__a strong').waitFor();
    const answer = await page.evaluate(() => window.preparationCalls.at(-1).user);
    assert.match(answer, /ORIGINAL_PROJECT_EVIDENCE/);
    assert.match(answer, /ORIGINAL_TARGET_ROLE/);
    assert.doesNotMatch(answer, /CHANGED_PROJECT_EVIDENCE|OTHER_PROJECT_EVIDENCE|OTHER_TARGET_ROLE/);
    await page.locator('.iprep-modal [data-cancel]').click();
    await page.locator('[data-act="prep-open"][data-tool="story"]').click();
    await page.locator('[data-story-hist-open="'+story.id+'"]').click();
    await page.locator('[data-story-regen]').click();
    await page.waitForFunction(() => window.__rkAiSession.state().active === 0 && window.preparationCalls.some(call => call.system.includes('Script EXACTLY')));
    const script = await page.evaluate(() => window.preparationCalls.at(-1).user);
    assert.match(script, /ORIGINAL_PROJECT_EVIDENCE/);
    assert.match(script, /ORIGINAL_STORY_ROLE/);
    assert.doesNotMatch(script, /CHANGED_PROJECT_EVIDENCE|OTHER_PROJECT_EVIDENCE|OTHER_TARGET_ROLE/);
  } finally { await browser.close(); }
});

async function assertWhiteboardDesignSystem(page) {
  await page.locator('.wb__header h2').hover();
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity && animation.effect?.target?.closest('.wb-modal')));
  const differences = await page.evaluate(async () => {
    await document.fonts.ready;
    const reference = document.createElement('div');
    reference.className = 'pass pass--wide'; reference.inert = true;
    reference.style.cssText = 'position:fixed;left:-10000px;top:0;width:880px;height:auto;animation:none';
    reference.innerHTML = '<div class="pass__box"><div class="pass__title">Reference</div><div class="adm__hm-seg"><button>New</button><button class="is-on">Existing</button></div><button class="adm__hist-btn">Back</button><input type="text"><textarea></textarea><select><option>Screen</option></select><button class="story__opt is-on">Choice</button><button class="iprep__lvl is-on">Level</button><div class="prep-brief"><details><summary>Advanced</summary></details></div><div class="prep-workspace"><div class="prep-h"><button class="prep-h__x">Session</button><button class="prep-h__del">Delete</button></div></div><div class="pass__actions"><button class="btn btn--ghost">Close</button><button class="btn btn--auto">Start</button></div></div>';
    reference.querySelector('.pass__box').insertAdjacentHTML('beforeend','<div class="wb__turn--you"><div class="wb__bubble">Candidate response</div></div>');
    document.body.append(reference);
    try {
      const modal = document.querySelector('.wb-modal');
      const pairs = [
        ['.wb__header h2','.pass__title'],
        ['[data-wb-view-switch]','.adm__hm-seg'],
        ['[data-wb-view].is-on','.adm__hm-seg .is-on'],
        ['[data-wb-view]:not(.is-on)','.adm__hm-seg button:not(.is-on)'],
        ['[data-wb-min]','.adm__hist-btn'],
        ['.wb__company','input'],['.wb__jd','textarea'],['.wb__own','textarea'],['.wb__draft','textarea'],
        ['.wb__source-options select','select'],
        ['.wb__turn--you .wb__bubble','.wb__turn--you .wb__bubble'],
        ['[data-wb-mode].is-on','.story__opt'],['[data-wb-lvl].is-on','.iprep__lvl'],
        ['[data-wb-deeper]','.btn--ghost'],
        ['[data-wb-hist] .prep-h','.prep-h'],['[data-wb-hist-open]','.prep-h__x'],['[data-wb-hist-del]','.prep-h__del'],
        ['[data-cancel]','.btn--ghost'],['[data-wb-start]','.btn--auto']
      ];
      if (!modal.classList.contains('wb-modal--stage')) pairs.push(['.pass__box','.pass__box']);
      const properties = ['font-family','font-size','font-weight','line-height','color','background-color','background-image','border-top-color','border-top-style','border-radius','corner-shape','text-transform','letter-spacing'];
      return pairs.flatMap(([selector,peer]) => {
        const element = modal.querySelector(selector); if (!element) return [];
        const actual = getComputedStyle(element), expected = getComputedStyle(reference.querySelector(peer));
        return properties.filter(property => actual.getPropertyValue(property) !== expected.getPropertyValue(property)).map(property => ({selector,property,actual:actual.getPropertyValue(property),expected:expected.getPropertyValue(property)}));
      });
    } finally { reference.remove(); }
  });
  assert.deepEqual(differences,[],'Whiteboard must inherit the shared component appearance, including native squircle and capsule policies');
}

test('Prepare Whiteboard New and Existing follow availability without losing setup or sessions', {timeout:45000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    assert.equal(await page.locator('[data-wb-view-switch]').isVisible(),false,'Nothing to reuse means no switch');
    assert.equal(await page.locator('[data-wb-new]').isVisible(),true);
    assert.equal(await page.locator('[data-wb-existing]').isVisible(),false);
    assert.equal(await page.locator('[data-wb-start]').isVisible(),true);
    await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('An exercise to save and resume');
    await page.locator('[data-wb-start]').click();
    await page.locator('.wb__draft').fill('Saved coaching draft');
    assert.equal(await page.locator('[data-wb-deeper]').isVisible(),false,'Advanced setup options are not a session control');
    assert.equal(await page.locator('[data-wb-view-switch]').isVisible(),false,'The switch is setup navigation, not an in-session mode');
    await page.locator('.wb-modal [data-cancel]').click();
    await page.evaluate(() => {
      const history = JSON.parse(localStorage.getItem('rk:prep:hist'));
      const original = history.wb[0];
      for (let index = 0; index < 3; index++) history.wb.push({...original,id:'grid-extra-' + index,meta:{...original.meta,snippet:index === 0 ? 'Unbroken'.repeat(20) : 'A longer saved exercise title that wraps across two lines in a session tile'}});
      localStorage.setItem('rk:prep:hist',JSON.stringify(history));
    });
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    assert.equal(await page.locator('[data-wb-view="existing"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-wb-brief]').isVisible(),false,'Saved sessions do not create an empty brief section');
    assert.equal(await page.locator('[data-wb-hist-open]').count(),4);
    assert.equal(await page.locator('[data-wb-new]').isVisible(),false);
    const initialExistingBox = await page.locator('.wb-modal .pass__box').boundingBox();
    await page.locator('[data-wb-view="new"]').click();
    const initialNewBox = await page.locator('.wb-modal .pass__box').boundingBox();
    assert.ok(Math.abs(initialExistingBox.height-initialNewBox.height)<1 && Math.abs(initialExistingBox.width-initialNewBox.width)<1,'Collapsed New and Existing keep the same dialog size');
    await page.locator('[data-wb-view="existing"]').click();
    const history = await page.evaluate(() => localStorage.getItem('rk:prep:hist'));
    const calls = await page.evaluate(() => window.preparationCalls.length);
    await page.locator('[data-wb-view="new"]').press('Enter');
    await page.locator('.wb__company').fill('Direct company');
    await page.locator('.wb__jd').fill('Direct job requirements');
    await page.locator('[data-wb-jd-url]').fill('https://example.test/job');
    await page.locator('[data-wb-mode="mock"]').click();
    await page.locator('[data-wb-lvl="senior"]').click();
    await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__brief').fill('Direct flavour');
    await page.locator('.wb__own').fill('A new, unsent exercise');
    for (const name of ['Company','Job posting URL','Job description','Flavour','Your own prompt']) assert.equal(await page.getByRole('textbox',{name,exact:true}).count(),1,'Fields have distinct accessible names');
    for (const name of ['Exercise length','Mode','Conversation','Seniority','Challenge','Industry']) assert.equal(await page.getByRole('group',{name,exact:true}).locator('button[aria-pressed="true"]').count(),1,'Choice groups announce exactly one selection');
    assert.equal(await page.locator('[data-wb-deeper]').evaluate(element => element.tagName === 'BUTTON' && element.parentElement.classList.contains('wb__foot')),true,'Advanced options use a shared footer button');
    for (const width of [1024,1440,1920]) {
      await page.setViewportSize({width,height:1000});
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; },width === 1024 ? 'day' : 'night');
      await page.locator('[data-wb-view="existing"]').press('Enter');
      await assertWhiteboardDesignSystem(page);
      const existingBox = await page.locator('.wb-modal .pass__box').boundingBox();
      assert.equal(await page.getByRole('textbox',{name:'Company',exact:true}).count(),0,'The hidden New view exposes no form controls');
      assert.equal(await page.locator('[data-wb-deeper]').isVisible(),false,'Saved sessions do not expose New setup options');
      assert.equal(await page.locator('.wb__setup').evaluate(element=>element.scrollHeight<=element.clientHeight+1),true,'The hidden form does not add blank scrolling to a short saved list');
      const title = await page.locator('.wb__header h2').boundingBox(), toggle = await page.locator('[data-wb-view-switch]').boundingBox(), header = await page.locator('.wb__header').boundingBox();
      assert.ok(title.x + title.width <= toggle.x && toggle.x + toggle.width <= header.x + header.width,'The switch fits at the right of the header');
      const tiles = await page.locator('[data-wb-hist] .prep-h').evaluateAll(elements=>elements.map(element=>{const rect=element.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,bottom:rect.bottom};}));
      assert.equal(tiles.length,4);
      assert.ok(tiles.slice(0,3).every(tile=>Math.abs(tile.y-tiles[0].y)<1 && Math.abs(tile.width-tiles[0].width)<1),'Three equal tiles share the first row');
      assert.ok(tiles[0].x + tiles[0].width <= tiles[1].x && tiles[1].x + tiles[1].width <= tiles[2].x,'Session columns do not overlap');
      assert.ok(tiles[3].y >= tiles[0].bottom && Math.abs(tiles[3].x-tiles[0].x)<1,'The fourth session starts the next row');
      assert.equal(await page.locator('[data-wb-hist] .prep-h__x :is(b,i)').evaluateAll(elements=>elements.every(element=>element.scrollWidth<=element.clientWidth+1)),true,'Long titles and metadata fit the tiles');
      assert.equal(await page.locator('[data-wb-start]').isVisible(),false);
      assert.equal(await page.locator('[data-wb-new]').isVisible(),false);
      await page.screenshot({path:join(tmpdir(),'rk-whiteboard-existing-' + width + '.png')});
      await page.locator('[data-wb-view="new"]').press('Enter');
      const newBox = await page.locator('.wb-modal .pass__box').boundingBox();
      assert.ok(Math.abs(existingBox.height-newBox.height)<1 && Math.abs(existingBox.width-newBox.width)<1,'Expanded New and Existing keep the same dialog size');
      assert.equal(await page.locator('[data-wb-existing]').isVisible(),false);
    }
    for (const [selector,value] of [['.wb__company','Direct company'],['.wb__jd','Direct job requirements'],['[data-wb-jd-url]','https://example.test/job'],['.wb__brief','Direct flavour'],['.wb__own','A new, unsent exercise']]) assert.equal(await page.locator(selector).inputValue(),value);
    assert.equal(await page.locator('[data-wb-lvl="senior"]').getAttribute('class'),'iprep__lvl is-on');
    assert.equal(await page.locator('[data-wb-mode="mock"]').getAttribute('class'),'story__opt is-on');
    assert.equal(await page.getByRole('button',{name:'Start',exact:true}).locator('svg').count(),1,'The play icon survives session completion and setup view changes');
    assert.equal(await page.locator('[data-wb-deeper]').getAttribute('aria-expanded'),'true');
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')),history,'Switching never changes saved sessions');
    assert.equal(await page.evaluate(() => window.preparationCalls.length),calls,'Switching never calls AI');
    await page.locator('[data-wb-view="existing"]').click();
    for (let index = 0; index < 3; index++) await page.locator('[data-wb-hist-del="grid-extra-' + index + '"]').click();
    await page.locator('[data-wb-hist-open]').focus();
    assert.equal(await page.locator('[data-wb-hist-open]').evaluate(element => element.tagName), 'BUTTON');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.matches('[data-wb-hist-del]')),true,'Open and Delete are separate keyboard controls');
    assert.equal(await page.locator('[data-wb-hist-del]').evaluate(element => getComputedStyle(element).outlineStyle),'solid');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-wb-view-switch]').isVisible(),false,'Deleting the final existing item removes the switch');
    assert.equal(await page.locator('[data-wb-new]').isVisible(),true);
    assert.equal(await page.locator('[data-wb-start]').isVisible(),true);
    assert.equal(await page.locator('.wb__company').inputValue(),'Direct company');
    assert.equal(await page.evaluate(() => document.querySelector('[data-wb-new]').contains(document.activeElement)),true);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Prepare Whiteboard keeps feedback, scorecards and prior targets when setup changes", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => localStorage.setItem('rk:prep:brief',JSON.stringify({id:'original-role',company:'OriginalCo',role:'Staff designer',jd:'ORIGINAL_WB_ROLE',level:'staff',projectMode:'selected',projectIds:['integrated-case']})));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    assert.equal(await page.locator('.wb-modal .prep-brief-link').count(),0);
    await page.locator('[data-wb-view="new"]').click();
    await page.locator('.wb__company').fill('OriginalCo / Staff designer');
    await page.locator('.wb__jd').fill('ORIGINAL_WB_ROLE');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:wb')).preparationBrief),null);
    await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('Original synthetic exercise');
    await page.locator('[data-wb-start]').click();
    await page.locator('.wb__draft').fill('I would first clarify the user need and choose a measurable outcome.');
    await page.locator('[data-wb-critique]').click();
    await page.getByText('SAVED_COACHING_FEEDBACK',{exact:true}).waitFor();
    const coach = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(coach.target.jd,'ORIGINAL_WB_ROLE','Directly entered job details remain part of the saved session');
    await page.locator('[data-wb-newprompt]').click();
    await page.getByText('A new synthetic exercise',{exact:true}).waitFor();
    await page.locator('.wb__draft').waitFor();
    const next = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.notEqual(next.id,coach.id);
    await page.locator('.wb-modal [data-cancel]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-hist-open="'+coach.id+'"]').click();
    await page.getByText('SAVED_COACHING_FEEDBACK',{exact:true}).waitFor();
    await page.locator('[data-wb-back]').click();
    await page.locator('.wb__company').fill('NextCo');
    await page.locator('.wb__jd').fill('NEXT_WB_ROLE');
    await page.locator('[data-wb-mode="mock"]').click();
    await page.locator('.wb-modal [data-cancel]').click();
    const preserved = await page.evaluate(id => JSON.parse(localStorage.getItem('rk:prep:hist')).wb.find(entry=>entry.id===id),coach.id);
    assert.equal(preserved.target.company,'OriginalCo / Staff designer');
    assert.equal(preserved.target.jd,'ORIGINAL_WB_ROLE');
    assert.equal(preserved.mode,'coach');
    assert.equal(preserved.critique.verdict,'SAVED_COACHING_FEEDBACK');
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-view="new"]').click();
    await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('A mock synthetic exercise');
    await page.locator('[data-wb-start]').click();
    await page.locator('[data-wb-ready]').click();
    await page.locator('.wb__turn--int').waitFor({state:'attached'});
    await page.locator('.wb__msg').fill('I would start with the user need and the outcome.');
    await page.locator('[data-wb-send]').click();
    await page.waitForFunction(() => window.__rkAiSession.state().active === 0 && document.querySelectorAll('.wb__turn--int').length === 2);
    await page.locator('[data-wb-score]').click();
    await page.getByText('SAVED_MOCK_SCORE',{exact:true}).waitFor();
    const mock = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(mock.score.overall,'SAVED_MOCK_SCORE');
    await page.locator('[data-wb-pause]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-hist-open="'+mock.id+'"]').click();
    await page.getByText('SAVED_MOCK_SCORE',{exact:true}).waitFor();
    assert.equal(await page.locator('.wb__chat').isVisible(),true);
    assert.equal(await page.locator('.wb__composer').isVisible(),false);
    assert.match(await page.locator('.wb__chat').innerText(),/I would start with the user need/);
  } finally { await browser.close(); }
});

test("Prepare Whiteboard preserves sessions while stopping timers and late capture on exit", {timeout:45000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await page.clock.install();
    await openIntegratedFixture(page);
    await page.evaluate(() => localStorage.setItem('rk:prep:hist', JSON.stringify({wb:[{id:'saved-mock',tool:'wb',at:1,meta:{mode:'mock',mins:'30'},mode:'mock',mins:'30',level:'staff',convo:'text',prompt:{prompt:'Synthetic checkout exercise'},transcript:'CANDIDATE: Start with the goal.',turns:[{who:'you',text:'Start with the goal.'}],timer:900}]})));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-hist-open="saved-mock"]').click();
    await page.locator('[data-wb-timer-t]').waitFor();
    const briefingTime = await page.locator('[data-wb-timer-t]').textContent();
    await page.clock.runFor(2100);
    assert.equal(await page.locator('[data-wb-timer-t]').textContent(), briefingTime);
    await page.locator('[data-wb-ready]').click();
    await page.clock.runFor(1200);
    await page.locator('[data-wb-rail-back]').click();
    const stopped = await page.locator('[data-wb-timer-t]').textContent();
    await page.clock.runFor(2100);
    assert.equal(await page.locator('[data-wb-timer-t]').textContent(), stopped);
    assert.equal(await page.locator('[data-wb-view="new"]').getAttribute('aria-pressed'),'true','Change setup opens New');
    await page.locator('[data-wb-view="existing"]').click();
    for (const source of ['screen','camera']) {
      await page.locator('[data-wb-hist-open="saved-mock"]').click();
      await page.evaluate(source => { const method = source === 'screen' ? 'getDisplayMedia' : 'getUserMedia'; navigator.mediaDevices[method] = () => new Promise(resolve => { window.lateFeed = resolve; }); }, source);
      await page.locator('[data-wb-watch="'+source+'"]').click();
      await page.waitForFunction(() => typeof window.lateFeed === 'function');
      await page.locator('[data-wb-pause]').click();
      await page.locator('.wb-modal').waitFor({state:'detached'});
      await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width=160;canvas.height=90;canvas.getContext('2d').fillRect(0,0,160,90); window.lateStream=canvas.captureStream(1); window.lateFeed(window.lateStream); delete window.lateFeed; });
      await page.waitForFunction(() => window.lateStream.getTracks().every(track => track.readyState === 'ended'));
      assert.equal(await page.locator('.wb-modal,.wb__mini').count(), 0);
      await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    }
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(saved.transcript, 'CANDIDATE: Start with the goal.');
    assert.equal(saved.turns.length, 1);
    assert.ok(saved.timer < 900);
  } finally { await browser.close(); }
});

async function whiteboardReply(page, message, reply = {}, chance = 0.1) {
  const count = await page.locator('.wb__turn--int').count();
  if (reply.origin === 'surprise') {
    const turnId=await page.evaluate(()=> 'turn-' + (JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].turns.length + 1));
    reply={opportunity:{stage:reply.roleId==='pm'?'framing':reply.roleId==='leadership'?'strategy':'design',turnId,quote:message,reason:'A new topic makes this stakeholder perspective useful.'},fallbackReply:'Let us continue the current discussion.',...reply};
    await page.evaluate(chance=>{window.wbOriginalRandom=Math.random;Math.random=()=>chance;},chance);
  }
  try {
    await page.evaluate(reply => { window.whiteboardReply = reply; },reply);
    await page.locator('.wb__msg').fill(message);
    await page.locator('[data-wb-send]').click();
    await page.waitForFunction(count => document.querySelectorAll('.wb__turn--int').length === count + 1 && document.querySelector('[data-wb-send]').textContent === 'Send',count);
  } finally {
    await page.evaluate(() => { window.whiteboardReply = {}; if(window.wbOriginalRandom){Math.random=window.wbOriginalRandom;delete window.wbOriginalRandom;} });
  }
}

test('Prepare Whiteboard conversational intent controls timing and keeps grounded memory through recovery', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.clock.install(); await installPrepareReplies(page); await openIntegratedFixture(page);
    const original = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('Help customers track a delayed refund.'); await page.locator('[data-wb-start]').click();
    assert.equal(await page.locator('.wb__session-tools,.wb__memory,[data-wb-think],[data-wb-recap]').count(),0);
    await page.locator('[data-wb-ready]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===1&&!document.querySelector('[data-wb-send]').disabled);
    await whiteboardReply(page,'I assume a first-time customer.',{reply:'Understood as an assumption, not a confirmed fact.',memory:[{kind:'assumption',text:'First-time customer',turnId:'turn-2',quote:'I assume a first-time customer.',status:'open',replaces:null}]});
    await whiteboardReply(page,'Actually, returning customers.',{reply:'We will use your revised assumption.',memory:[{kind:'assumption',text:'Returning customers',turnId:'turn-4',quote:'Actually, returning customers.',status:'open',replaces:'memory-1'}]});
    await whiteboardReply(page,'Let me sit with this for a bit.',{reply:'Take your time. I will stay quiet.',action:'think'});
    const beforeThink = await page.locator('[data-wb-timer-t]').textContent(), turns = await page.locator('.wb__turn--int').count();
    await page.clock.fastForward(65000);
    assert.equal(await page.locator('.wb__turn--int').count(),turns);
    assert.notEqual(await page.locator('[data-wb-timer-t]').textContent(),beforeThink);
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Thinking time/);
    await whiteboardReply(page,'Pause the session clock please.',{reply:'The session is paused.',action:'pause'});
    assert.equal(await page.locator('[data-wb-phase]').textContent(),'paused');
    const paused = await page.locator('[data-wb-timer-t]').textContent();
    await page.clock.fastForward(45000); assert.equal(await page.locator('[data-wb-timer-t]').textContent(),paused);
    await page.locator('[data-wb-ready]').click();
    await whiteboardReply(page,'I would like to pull my thoughts together.',{reply:'Go ahead; I will listen to your summary.',action:'recap'});
    assert.equal(await page.locator('[data-wb-phase]').textContent(),'recap'); assert.equal(await page.locator('.wb__scorecard').count(),0);
    await whiteboardReply(page,'Actually, let us explore an alternative first.',{reply:'Go ahead with the alternative.',action:'resume'});
    assert.equal(await page.locator('[data-wb-phase]').textContent(),'working');
    await page.evaluate(()=>{window.whiteboardReply={action:'finish'};});
    await page.locator('.wb__msg').fill('A hypothetical ending, not a request to finish.'); await page.locator('[data-wb-send]').click();
    await page.locator('.pass__err').filter({hasText:/conversational reply was invalid/}).waitFor();
    assert.equal(await page.locator('.wb__scorecard').count(),0);
    const candidateCount=await page.locator('.wb__turn--you').count();
    await page.evaluate(()=>{window.whiteboardReply={};}); await page.locator('[data-wb-reply-retry]').click();
    await page.waitForFunction(()=>document.querySelector('[data-wb-reply-retry]').hidden&&!document.querySelector('[data-wb-send]').disabled);
    assert.equal(await page.locator('.wb__turn--you').count(),candidateCount); assert.equal(await page.locator('.pass__err').textContent(),'');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(saved.conversation.memory.length,1); assert.equal(saved.conversation.memory[0].text,'Returning customers');
    await page.locator('[data-wb-pause]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-hist-open="'+saved.id+'"]').click();
    assert.equal(await page.locator('[data-wb-phase]').textContent(),'paused');
    assert.equal(await page.locator('.wb__turn--you').count(),candidateCount);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),original);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard contextual role-play has timed notices persistent exits and late reply protection', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.clock.install(); await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="mock"]').click();
    assert.equal(await page.locator('[data-wb-surprises]').isVisible(),false);
    await page.locator('[data-wb-deeper]').click();
    assert.equal(await page.locator('[data-wb-surprises]').isChecked(),true);
    assert.equal(await page.locator('[data-wb-surprises]').evaluate(el=>!!el.closest('#wb-advanced-settings')),true);
    await page.locator('.wb__own').fill('Help customers track a delayed refund.'); await page.locator('[data-wb-start]').click();
    assert.equal(await page.locator('.wb__stage [data-wb-surprises]').count(),0);
    assert.equal(await page.locator('[data-wb-role][aria-pressed="true"]').count(),0);
    assert.equal(await page.locator('[data-wb-role="leadership"]').count(),1);
    await page.locator('[data-wb-ready]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===1&&!document.querySelector('[data-wb-send]').disabled);
    await whiteboardReply(page,'I would show the expected refund date.');
    await whiteboardReply(page,'The date depends on the payment provider.',{reply:'I will play the engineer. In this simulation, providers offer date ranges; what would you ask me?',roleAction:'start',roleId:'engineer',origin:'surprise'});
    const notice=page.locator('.wb__role-notice');
    assert.equal(await notice.isVisible(),true);
    assert.match(await page.locator('.wb__turn--int .wb__who').last().textContent(),/Engineer/);
    await page.mouse.move(1,1); await page.locator('.wb__msg').focus();
    await page.clock.fastForward(19000); assert.equal(await notice.isVisible(),true);
    await notice.hover(); await page.clock.fastForward(30000); assert.equal(await notice.isVisible(),true);
    await page.mouse.move(1,1); await page.locator('[data-wb-role-continue]').focus();
    await page.clock.fastForward(30000); assert.equal(await notice.isVisible(),true);
    await page.locator('.wb__msg').focus(); await page.clock.fastForward(1000);
    assert.equal(await notice.isVisible(),false); assert.equal(await page.locator('[data-wb-role-end]').isVisible(),true);
    await whiteboardReply(page,'Which provider constraints should I understand?',{reply:'For this simulation, provider timing is variable. What would you show while the date is uncertain?'});
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Engineer/);
    await whiteboardReply(page,'Let us go back to the interviewer.',{reply:'Back to the interview. Keep the provider uncertainty as a simulation assumption.',roleAction:'end'});
    assert.equal(await page.locator('[data-wb-role-end]').isVisible(),false);
    const surprise={reply:'I will play the PM for a simulated customer discussion.',roleAction:'start',roleId:'pm',origin:'surprise'};
    await whiteboardReply(page,'I would validate the uncertainty with customers.',surprise);
    await page.locator('[data-wb-role-skip]').click();
    assert.equal(await notice.isVisible(),false); assert.equal(await page.locator('[data-wb-role-end]').isVisible(),false);
    await whiteboardReply(page,'Let us discuss what we might learn.',surprise);
    await page.locator('[data-wb-role-continue]').click();
    assert.equal(await notice.isVisible(),false); assert.equal(await page.locator('[data-wb-role-end]').isVisible(),true);
    const beforeExit=await page.evaluate(()=>window.preparationCalls.length);
    await page.locator('[data-wb-role-end]').click();
    assert.equal(await page.locator('[data-wb-role-end]').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),beforeExit);
    await whiteboardReply(page,'Could we practise this with a client?',{reply:'I will play your client. What should our customers understand about the refund?',roleAction:'start',roleId:'client',origin:'requested'});
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Client/);
    await page.locator('[data-wb-role-end]').click();
    await page.locator('[data-wb-role="pm"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/PM/);
    await page.evaluate(()=>{window.deferWhiteboardReply=true;});
    await page.locator('.wb__msg').fill('Which outcome matters most?'); await page.locator('[data-wb-send]').click();
    await page.waitForFunction(()=>typeof window.releaseWhiteboardReply==='function');
    const before=await page.locator('.wb__turn--int').count();
    await page.locator('[data-wb-role-end]').click();
    await page.evaluate(()=>{window.deferWhiteboardReply=false;window.releaseWhiteboardReply();});
    await page.waitForFunction(()=>window.whiteboardReplyReturned&&window.__rkAiSession.state().active===0);
    assert.equal(await page.locator('.wb__turn--int').count(),before);
    assert.equal(await page.locator('[data-wb-role-end]').isVisible(),false);
    await page.locator('[data-wb-role="accessibility"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    for (const width of [1024,1440,1920]) {
      await page.setViewportSize({width,height:1000});
      await page.locator('[data-wb-role-end]').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('[data-wb-role-end]').evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;}));
      assert.equal(await page.locator('.wb__roles').evaluate(el=>el.scrollWidth>el.clientWidth),false);
      await page.screenshot({path:join(tmpdir(),'rk-whiteboard-conversation-'+width+'.png')});
    }
    await page.locator('[data-wb-pause]').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(saved.conversation.role.id,'accessibility'); assert.equal(saved.assisted,false);
    assert.equal(saved.conversation.surprises,true);
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-hist-open="'+saved.id+'"]').click();
    assert.equal(await page.locator('[data-wb-role-end]').isVisible(),true);
    const requests=await page.evaluate(()=>window.preparationCalls.length);
    await page.locator('[data-wb-role-end]').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-wb-role-end]').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),requests);
    await page.locator('[data-wb-rail-back]').click();
    assert.equal(await page.locator('[data-wb-surprises]').isChecked(),true);
    await page.locator('[data-wb-deeper]').click();
    await page.locator('[data-wb-surprises]').uncheck(); await page.locator('[data-wb-start]').click();
    await page.locator('.wb__stage').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].conversation.surprises),false);
    assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb.find(entry=>entry.id===id).conversation.surprises,saved.id),true);
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    await page.locator('[data-wb-role="leadership"]').click(); await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Leadership/);
    await page.locator('[data-wb-newprompt]').click(); await page.waitForFunction(()=>document.querySelector('[data-wb-phase]').textContent==='Briefing / clock stopped');
    const fresh=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(fresh.conversation.role,null); assert.deepEqual(fresh.conversation.memory,[]); assert.equal(fresh.conversation.surprises,false);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard evolving opportunities decline safely and transition PM to engineering and leadership', {timeout:45000}, async () => {
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-lvl="exec"]').click();
    assert.equal(await page.locator('[data-wb-surprises]').isVisible(),false);
    await page.locator('[data-wb-deeper]').click();
    assert.equal(await page.locator('[data-wb-surprises]').isChecked(),true);
    await page.locator('.wb__own').fill('Design a refund experience.'); await page.locator('[data-wb-start]').click();
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    await whiteboardReply(page,'I want to clarify which customer problem matters.');
    await whiteboardReply(page,'Let us consider customer priorities.',{reply:'I will play the PM. Which outcome matters?',roleAction:'start',roleId:'pm',origin:'surprise'},0.5);
    assert.equal(await page.locator('[data-wb-role-end]').isVisible(),false);
    assert.equal(await page.locator('.wb__turn--int .wb__bubble').last().textContent(),'Let us continue the current discussion.');
    assert.equal(await page.locator('.wb__role-notice').isVisible(),false);
    await whiteboardReply(page,'Our priority is reassuring customers about timing.',{reply:'I will play the PM to explore that priority.',roleAction:'start',roleId:'pm',origin:'surprise'});
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/PM/);
    await page.locator('[data-wb-role-continue]').click();
    await whiteboardReply(page,'My proposed flow needs a payment status integration.',{reply:'Switching from PM to engineer: let us examine that integration.',roleAction:'start',roleId:'engineer',origin:'surprise'});
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Engineer/);
    assert.equal(await page.locator('.wb__role-notice').isVisible(),true);
    await page.locator('[data-wb-role-continue]').click();
    await whiteboardReply(page,'Now consider funding and cross-team ownership.',{reply:'I will take the leadership perspective on that investment.',roleAction:'start',roleId:'leadership',origin:'surprise'});
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Leadership/);
    const request=await page.evaluate(()=>window.preparationCalls.at(-1));
    assert.match(request.user,/automaticRoles.*leadership/);
    await page.locator('[data-wb-pause]').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(saved.conversation.opportunity.roleId,'leadership');
    assert.equal(saved.conversation.opportunity.accepted,true);
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-hist-open="'+saved.id+'"]').click();
    assert.match(await page.locator('[data-wb-role-label]').textContent(),/Leadership/);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].conversation.opportunity),saved.conversation.opportunity);
    await page.locator('[data-wb-role-end]').click();
    assert.equal(await page.locator('[data-wb-role][aria-pressed="true"]').count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Prepare Whiteboard Coach conversation preserves the original plan draft and feedback', {timeout:45000}, async () => {
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="coach"]').click(); await page.locator('[data-wb-deeper]').click();
    await page.locator('[data-wb-surprises]').check();
    await page.locator('.wb__own').fill('A coach-led refund exercise.'); await page.locator('[data-wb-start]').click();
    await page.locator('.wb__draft').fill('I will first clarify the customer need and success measure.');
    await page.locator('[data-wb-critique]').click(); await page.getByText('SAVED_COACHING_FEEDBACK',{exact:true}).waitFor();
    const previous=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    await page.locator('[data-wb-conversation]').click();
    assert.equal(await page.locator('.wb__msg').inputValue(),'');
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    assert.match(await page.evaluate(()=>window.preparationCalls.at(-1).system),/COACH: teach and scaffold/);
    await whiteboardReply(page,'Can I have a small hint?',{reply:'Try choosing one customer moment first.',assisted:true});
    await page.locator('[data-wb-pause]').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.deepEqual(saved.plan,previous.plan); assert.deepEqual(saved.critique,previous.critique); assert.equal(saved.coachDraft,previous.draft);
    assert.equal(saved.assisted,true); assert.equal(saved.conversation.started,true); assert.equal(saved.conversation.surprises,true);
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-hist-open="'+saved.id+'"]').click();
    await page.locator('.wb__coaching-notes summary').click();
    assert.equal(await page.locator('.wb__saved-approach').textContent(),previous.draft);
    await page.getByText('SAVED_COACHING_FEEDBACK',{exact:true}).waitFor(); assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Prepare Whiteboard clock ownership interrupted turns evidence and independent retries', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await page.clock.install(); await installPrepareReplies(page); await openIntegratedFixture(page);
    const draft = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    assert.equal(await page.locator('[data-wb-lvl]').count(),4);
    await page.locator('[data-wb-lvl="leader"]').click(); await page.locator('[data-wb-mode="mock"]').click();
    await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('Keep the warehouse delay fixed at five days.'); await page.locator('[data-wb-start]').click();
    await page.clock.fastForward(65000); assert.equal(await page.locator('[data-wb-timer-t]').textContent(),'60:00');
    assert.equal(await page.evaluate(() => window.preparationCalls.length),0);
    assert.equal(await page.locator('.wb__prompt .wb__watch').count(),0);
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 1 && !document.querySelector('[data-wb-send]').disabled);
    await page.locator('[data-wb-pause]').click();
    const sessionId = await page.evaluate(() => { const history = JSON.parse(localStorage.getItem('rk:prep:hist')); history.wb[0].timer = 305; history.wb[0].notes={assumptions:'One first-time customer',questions:'Refund method unknown'}; history.wb[0].conversation.thinking=true; localStorage.setItem('rk:prep:hist',JSON.stringify(history)); return history.wb[0].id; });
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-hist-open="' + sessionId + '"]').click(); await page.locator('[data-wb-ready]').click();
    await page.locator('.wb__legacy-notes summary').click();
    assert.match(await page.locator('.wb__legacy-notes').textContent(),/One first-time customer/);
    await page.locator('.wb__msg').fill('Keep this unsent response');
    await page.clock.fastForward(6000); assert.equal(await page.locator('.wb__turn--int').count(),1);
    assert.equal(await page.locator('.wb__msg').inputValue(),'Keep this unsent response');
    await whiteboardReply(page,'I am ready to continue.'); await page.clock.runFor(1100); assert.equal(await page.locator('.wb__turn--int').count(),3);
    await page.locator('.wb__msg').fill('Keep this unsent response');
    await page.locator('[data-wb-ready]').click(); const paused = await page.locator('[data-wb-timer-t]').textContent();
    await page.clock.fastForward(60000); assert.equal(await page.locator('[data-wb-timer-t]').textContent(),paused);
    await page.locator('[data-wb-ready]').click(); await page.evaluate(() => { window.deferWhiteboardReply = true; });
    await page.locator('[data-wb-send]').click(); await page.waitForFunction(() => typeof window.releaseWhiteboardReply === 'function');
    assert.equal(await page.locator('.wb__turn--you').count(),2);
    await page.locator('[data-wb-interrupt]').click(); await page.evaluate(() => { window.deferWhiteboardReply = false; window.releaseWhiteboardReply(); });
    await page.waitForFunction(() => window.whiteboardReplyReturned && window.__rkAiSession.state().active === 0);
    assert.equal(await page.locator('.wb__turn--int').count(),3);
    await page.locator('[data-wb-reply-retry]').click();
    await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 4 && !document.querySelector('[data-wb-send]').disabled);
    assert.equal(await page.locator('.wb__turn--you').count(),2);
    await page.locator('.wb__msg').fill('I will measure whether customers understand the refund date.'); await page.locator('[data-wb-send]').click();
    await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 5 && !document.querySelector('[data-wb-send]').disabled);
    const request = await page.evaluate(() => window.preparationCalls.at(-1));
    assert.match(request.user,/remainingSeconds|first-time customer|Refund method unknown/); assert.match(request.user,/Head \/ Director/); assert.match(request.system,/Not every answer needs a challenge/);
    await whiteboardReply(page,'Let me summarise.',{reply:'Go ahead with your summary.',action:'recap'}); await page.locator('[data-wb-ready]').click(); await page.locator('[data-wb-ready]').click(); assert.equal(await page.locator('[data-wb-phase]').textContent(),'recap');
    await page.evaluate(() => { window.whiteboardScore = {scores:[{dim:'Framing',score:4,note:'Candidate named an outcome',evidence:['turn-5','invented']},{dim:'Flow',score:1,note:'No flow observed',evidence:['invented']}],overall:'Evidence review',topfix:'Compare alternatives',improvements:[{action:'State a decision',evidence:['turn-5'],retry:'Compare two approaches in five minutes.'},{action:'Name validation',evidence:['turn-5'],retry:'Choose a validation method.'}]}; });
    await page.locator('[data-wb-score]').click(); await page.getByText('Evidence review',{exact:true}).waitFor();
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
    assert.equal(original.score.scores[0].score,4); assert.deepEqual(original.score.scores[0].evidence,['turn-5']); assert.equal(original.score.scores[1].score,null);
    assert.equal(original.notes.assumptions,'One first-time customer'); assert.equal(original.phase,'debrief');
    await page.locator('[data-wb-evidence="turn-5"]').first().click(); assert.equal(await page.evaluate(() => document.activeElement.dataset.wbTurn),'turn-5');
    await page.locator('[data-wb-retry="0"]').click(); assert.equal(await page.locator('[data-wb-timer-t]').textContent(),'05:00');
    const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb);
    assert.equal(entries[0].parentId,original.id); assert.notEqual(entries[0].id,original.id); assert.deepEqual(entries.find(entry=>entry.id===original.id),original); assert.equal(entries[0].turns.length,0);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())),draft); assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

async function installWhiteboardVideoReview(page) {
  await page.route('https://generativelanguage.googleapis.com/**',route => {
    if (!new URL(route.request().url()).pathname.endsWith('/models')) return route.abort();
    return route.fulfill({contentType:'application/json',body:JSON.stringify({models:[{name:'models/video-review-fixture',input_modalities:['text','image','audio','video'],output_modalities:['text'],inputTokenLimit:1000000,outputTokenLimit:16000,supportedGenerationMethods:['generateContent'],pricing:{input:1,output:3}}]})});
  });
  await page.evaluate(() => {
    localStorage.setItem('rk:ai:img:provider','gemini'); localStorage.setItem('rk:ai:img:key','synthetic-video-key');
    const original = window.fetch; window.videoReviewCalls = []; window.videoUploads = [];
    window.fetch = async (resource,options = {}) => {
      const url = new URL(typeof resource === 'string' ? resource : resource.url,location.href);
      if (url.hostname !== 'generativelanguage.googleapis.com') return original(resource,options);
      window.videoReviewCalls.push({path:url.pathname,method:options.method || 'GET'});
      if (options.method === 'DELETE') return new Response(null,{status:200});
      if (url.pathname.endsWith('/models')) return Response.json({models:[{name:'models/video-review-fixture',input_modalities:['text','image','audio','video'],output_modalities:['text'],inputTokenLimit:1000000,outputTokenLimit:16000,supportedGenerationMethods:['generateContent'],pricing:{input:1,output:3}}]});
      if (url.pathname === '/upload/v1beta/files') { window.videoFileName=JSON.parse(options.body).file.name; return new Response(null,{headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload-session'}}); }
      if (url.pathname === '/upload-session') { window.videoUploads.push(options.body); if(window.videoReviewMode==='upload-error') return new Response(null,{status:503}); return Response.json({file:{name:window.videoFileName,uri:'https://generativelanguage.googleapis.com/v1beta/'+window.videoFileName,state:window.videoReviewMode==='processing'?'PROCESSING':'ACTIVE'}}); }
      if (url.pathname.startsWith('/v1beta/files/')) return Response.json({name:window.videoFileName,uri:'https://generativelanguage.googleapis.com/v1beta/'+window.videoFileName,state:'PROCESSING'});
      if (url.pathname.endsWith(':countTokens')) return Response.json({totalTokens:500});
      if (url.pathname.endsWith(':generateContent')) {
        window.videoReviewBody=JSON.parse(options.body);
        return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({scores:[{dim:'Communication',score:4,note:'Recorded explanation',evidence:['recording-evidence-1']}],overall:'SAVED_MOCK_SCORE',topfix:'Compare another option',improvements:[],recordingEvidence:[{id:'recording-evidence-1',recordingId:'recording-1',seconds:window.videoReviewMode==='bad-evidence'?999999:0,status:'audible',detail:'An explanation captured in the recording.'}]})}]}}],usageMetadata:{promptTokenCount:500,candidatesTokenCount:100}});
      }
      throw new Error('Unexpected synthetic video endpoint: '+url.pathname);
    };
  });
}

for (const width of [1440,390,320]) test('Prepare Whiteboard actual board recording and responsive views at ' + width, {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page); await installWhiteboardVideoReview(page);
    await page.evaluate(() => {
      window.mediaRequests = [];
      const NativeRecorder = window.MediaRecorder;
      window.MediaRecorder = class extends NativeRecorder { constructor(...args) { super(...args); this.addEventListener('dataavailable',event => { window.recordedBytes = (window.recordedBytes || 0) + event.data.size; }); } };
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 500;
      const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0,0,800,500); context.fillStyle = '#121212'; context.font = '32px sans-serif'; context.fillText('Actual shared canvas / fixture',40,80); context.fillStyle = '#d8a657'; context.fillRect(40,140,180,120); context.fillStyle = '#5bafa7'; context.fillRect(350,140,260,120); window.boardCanvas = canvas;
      navigator.mediaDevices.getDisplayMedia = async options => { window.mediaRequests.push({type:'screen',options}); window.boardStream = canvas.captureStream(10); window.boardFrames = setInterval(() => { context.fillStyle = '#ffffff'; context.fillRect(0,0,2,2); window.boardStream.getVideoTracks()[0].requestFrame?.(); },100); return window.boardStream; };
      navigator.mediaDevices.getUserMedia = async options => {
        if (!options.audio) throw new Error('No physical camera permitted');
        const audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start(); window.recordingAudio = audio; return destination.stream;
      };
    });
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    if (width === 1440) {
      const setupShell = await page.locator('.wb-modal .pass__box').boundingBox();
      const studioHeader = await page.locator('.adm__bar').boundingBox(), studioStatus = await page.locator('.adm__statusbar').boundingBox();
      assert.ok(setupShell.x > 0 && setupShell.width <= 880,'Setup is a contained window over Studio');
      assert.ok(setupShell.y > studioHeader.y + studioHeader.height,'Setup leaves space below the Studio navigation');
      assert.ok(setupShell.y + setupShell.height < studioStatus.y,'Setup leaves space above Studio status');
      assert.equal(await page.locator('.wb-modal').getAttribute('aria-modal'),'true');
      assert.equal(await page.locator('[data-wb-exit]').isVisible(),false,'Close is the single setup exit');
      assert.equal(await page.locator('.wb-modal [data-cancel]').isVisible(),true);
      assert.equal(await page.locator('.wb-modal .pass__sub').count(),0,'No introductory paragraph');
      assert.equal(await page.getByRole('button',{name:'Start',exact:true}).locator('svg').count(),1,'Start uses the shared play icon');
      assert.equal(await page.locator('.wb-modal .pass__note').count(),0,'The informational footer note is removed');
      assert.equal(await page.locator('.wb__foot > [data-wb-deeper]').textContent(),'Advanced options');
      assert.equal(await page.locator('.wb__deeper details,.wb__deeper summary').count(),0,'There is no separate Advanced drawer UI');
      assert.equal(await page.locator('.wb__chrome').isVisible(),false,'Setup needs no maximise action');
      assert.equal(await page.locator('.wb-modal .pass__err').isVisible(),false,'An empty error slot reserves no space');
      await page.locator('.wb-modal .pass__err').evaluate(element=>{element.textContent='Validation message';});
      assert.equal(await page.locator('.wb-modal .pass__err').isVisible(),true,'Actual validation errors remain visible');
      await page.locator('.wb-modal .pass__err').evaluate(element=>{element.textContent='';});
      assert.equal(await page.locator('.wb__deeper').evaluate(element=>getComputedStyle(element).borderBottomWidth),'0px','Advanced does not duplicate the footer divider');
    }
    assert.equal(await page.locator('[data-wb-history]').isVisible(),false,'History navigation is only needed in-session');
    assert.equal(await page.locator('[data-wb-hist]').isVisible(),false);
    assert.equal(await page.locator('[data-wb-view-switch]').isVisible(),false,'First use opens New without a switch');
    assert.equal(await page.locator('.wb-modal .prep-brief-link,[data-use-prep-brief]').count(),0,'There is no empty brief row on setup');
    assert.deepEqual(await page.locator('[data-wb-lvl]').evaluateAll(buttons=>buttons.map(button=>button.dataset.wbLvl)),['senior','staff','leader','exec'],'Seniority options ascend from Senior to VP / Exec');
    assert.equal(await page.locator('[data-wb-deeper]').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.wb__deeper').evaluate(element => element === element.parentElement.lastElementChild),true,'Advanced is the last setup section');
    assert.equal(await page.locator('.wb__deeper').evaluate(element => ['.wb__company','[data-wb-jd-url]','[data-wb-jd-fetch]','.wb__jd'].every(selector => element.previousElementSibling.contains(document.querySelector(selector)))),true,'The full Company and job description block precedes Advanced');
    assert.equal(await page.locator('.wb__brief').isVisible(),false);
    assert.equal(await page.locator('.wb__own').isVisible(),false);
    const optionsWidth = (await page.locator('[data-wb-deeper]').boundingBox()).width;
    await page.locator('[data-wb-deeper]').click();
    assert.equal(await page.getByRole('button',{name:'Hide options',exact:true}).getAttribute('aria-expanded'),'true');
    assert.ok(Math.abs((await page.locator('[data-wb-deeper]').boundingBox()).width-optionsWidth)<1,'The options toggle width is stable when its label changes');
    assert.equal(await page.locator('#wb-advanced-settings').isVisible(),true);
    const hintGaps = await page.locator('.wb__setup .af__hint').evaluateAll(hints=>hints.map(hint=>hint.getBoundingClientRect().top-hint.previousElementSibling.getBoundingClientRect().bottom));
    assert.equal(hintGaps.length,5);
    assert.ok(hintGaps.every(gap=>Math.abs(gap-hintGaps[0])<0.25),'All setup hints use the same control-to-help spacing, including Advanced');
    await page.locator('.wb__brief').fill('Refund onboarding');
    await page.locator('.wb__own').fill('Design a clear refund status.');
    await page.locator('[data-wb-deeper]').click();
    assert.equal(await page.getByRole('button',{name:'Advanced options',exact:true}).getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#wb-advanced-settings').isVisible(),false);
    assert.equal(await page.locator('.wb__brief').inputValue(),'Refund onboarding');
    assert.equal(await page.locator('.wb__own').inputValue(),'Design a clear refund status.');
    assert.equal(await page.locator('.wb__own').isVisible(),false);
    if (width === 1440) {
      for (const viewport of [{width:1024,height:768,theme:'day'},{width:1440,height:1000,theme:'night'},{width:1920,height:1080,theme:'night'}]) {
        await page.setViewportSize({width:viewport.width,height:viewport.height});
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; },viewport.theme);
        const box = await page.locator('.wb-modal .pass__box').boundingBox();
        const form = await page.locator('.wb__setup .ats__main').boundingBox();
        const footer = await page.locator('.wb__foot').boundingBox();
        const options = await page.locator('.wb__foot > [data-wb-deeper]').boundingBox();
        const close = await page.locator('.wb__foot [data-cancel]').boundingBox();
        const iconGap = await page.locator('[data-wb-start]').evaluate(button=>{
          const label = [...button.childNodes].find(node=>node.nodeType===Node.TEXT_NODE && node.textContent.trim());
          const range = document.createRange(); range.selectNodeContents(label);
          return {actual:range.getBoundingClientRect().left-button.querySelector('svg').getBoundingClientRect().right,expected:parseFloat(getComputedStyle(button).columnGap)};
        });
        assert.ok(iconGap.expected>0 && Math.abs(iconGap.actual-iconGap.expected)<=1,'Start has an explicit gap between the play icon and label');
        const url = page.locator('[data-wb-jd-url]'), fetch = page.locator('[data-wb-jd-fetch]');
        const originalUrl = await url.inputValue();
        const longUrl = 'https://example.test/jobs/' + 'long-role-'.repeat(50);
        await url.fill(longUrl); await url.press('End'); await url.press('x');
        assert.equal(await url.inputValue(),longUrl+'x','Clipping never truncates the editable URL value');
        const urlBox = await url.boundingBox(), companyBox = await page.locator('.wb__company').boundingBox(), fetchBox = await fetch.boundingBox();
        assert.ok(Math.abs(urlBox.x-companyBox.x)<=1 && Math.abs(urlBox.width-companyBox.width)<=1,'The URL field spans the same width as the company field');
        assert.ok(fetchBox.x>urlBox.x && fetchBox.x+fetchBox.width<urlBox.x+urlBox.width && fetchBox.y>urlBox.y && fetchBox.y+fetchBox.height<urlBox.y+urlBox.height,'Fetch sits entirely inside the URL field');
        const textBoundary = await url.evaluate(input=>{const style=getComputedStyle(input);return input.getBoundingClientRect().right-parseFloat(style.paddingRight)-parseFloat(style.borderRightWidth);});
        assert.ok(textBoundary<=fetchBox.x-4,'URL text stops before the Fetch control');
        assert.equal(await url.evaluate(input=>getComputedStyle(input).textOverflow),'ellipsis');
        await assertInsetFetchRow(url.locator('..'));
        await url.press('Tab');
        assert.equal(await fetch.evaluate(button=>button===document.activeElement),true,'Fetch remains a separate keyboard-accessible control');
        assert.equal(await fetch.evaluate(button=>getComputedStyle(button).outlineStyle),'solid','Fetch has a visible keyboard focus outline');
        await fetch.hover();
        const hoverBox = await fetch.boundingBox();
        const hoveredUrlBox = await url.boundingBox();
        assert.ok(Math.abs((hoverBox.y-hoveredUrlBox.y)-(fetchBox.y-urlBox.y))<0.25,'The in-field Fetch action does not lift on hover');
        const idleLabel = await fetch.innerHTML();
        await fetch.evaluate(button=>{button.disabled=true;button.classList.add('is-busy');button.textContent='Fetching\u2026';});
        const busyBox = await fetch.boundingBox();
        assert.ok(Math.abs(busyBox.width-fetchBox.width)<=1 && Math.abs(busyBox.height-fetchBox.height)<=1,'Fetching does not resize the inset button');
        assert.equal(await fetch.evaluate(button=>button.scrollWidth<=button.clientWidth+1),true,'The busy label and spinner fit inside Fetch');
        await fetch.evaluate((button,label)=>{button.innerHTML=label;button.disabled=false;button.classList.remove('is-busy');},idleLabel);
        await url.fill(originalUrl);
        assert.ok(box.x > 0 && box.width <= 880 && box.y > 0 && box.y + box.height < viewport.height);
        assert.ok(form.x >= box.x && form.x + form.width <= box.x + box.width,'The New form fits inside the setup window');
        assert.equal(await page.locator('[data-wb-existing]').isVisible(),false,'Saved sessions belong to Existing, not beside New');
        assert.ok(footer.y >= box.y && footer.y + footer.height <= box.y + box.height,'Footer actions stay inside the setup window');
        assert.ok(options.x + options.width <= close.x,'Advanced options do not overlap the actions');
        assert.ok(Math.abs(options.y + options.height / 2 - close.y - close.height / 2) <= 1,'Advanced options share the CTA row');
        assert.ok(footer.height <= close.height + 26,'Advanced options add no footer height');
        assert.equal(await page.locator('.wb-modal .pass__box').evaluate(element=>element.scrollWidth <= element.clientWidth),true);
        const studioHeader = await page.locator('.adm__bar').boundingBox(), studioStatus = await page.locator('.adm__statusbar').boundingBox();
        assert.ok(box.y > studioHeader.y + studioHeader.height && box.y + box.height < studioStatus.y,'The taller dialog still leaves Studio navigation and status visible');
        if (viewport.height >= 1080) {
          assert.equal(await page.locator('.wb__setup').evaluate(element=>element.scrollHeight<=element.clientHeight+1),true,'A tall window fits the collapsed setup without scrolling');
          assert.equal(await page.locator('.wb__deeper').isVisible(),false,'Advanced fields stay collapsed until requested');
          assert.equal(await page.locator('[data-wb-deeper]').isVisible(),true,'The Advanced options control stays visible in the footer');
        }
        await page.locator('.wb__setup').evaluate(element=>{element.scrollTop=element.scrollHeight;});
        const formEnd = await page.locator('.wb__deeper').evaluate(element=>{const field=element.hidden ? element.previousElementSibling : element;return field.getBoundingClientRect().bottom+parseFloat(getComputedStyle(field).marginBottom);});
        const formFooterGap = footer.y - formEnd;
        assert.ok(formFooterGap >= -1 && formFooterGap <= 26,'Only standard form padding follows the final visible field, allowing subpixel rounding: ' + formFooterGap + 'px at ' + viewport.width + 'px');
        await page.locator('.wb__setup').evaluate(element=>{element.scrollTop=0;});
        await page.screenshot({path:join(tmpdir(),'rk-whiteboard-compact-setup-' + viewport.width + '.png')});
      }
      await page.setViewportSize({width,height:1000});
    }
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-setup-' + width + '.png')});
    await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-start]').click();
    assert.equal(await page.locator('[data-wb-exit],[data-wb-history],[data-wb-max]').count(),0,'Only useful viewing controls remain in the header');
    assert.equal(await page.locator('.wb__header [data-wb-min]').isVisible(),true);
    assert.equal(await page.locator('.wb__header [data-wb-immersive]').isVisible(),true);
    assert.equal(await page.locator('.wb__main [data-wb-immersive],.wb__imm').count(),0);
    assert.equal(await page.locator('[data-wb-record]').isVisible(),false);
    assert.equal(await page.locator('[data-wb-pause]').textContent(),'Save & leave');
    assert.equal(await page.locator('[data-wb-record-notice]').isVisible(),false,'Recording notice waits until a feed is available');
    assert.equal(await page.getByRole('button',{name:'Saved sessions',exact:true}).count(),0,'Saved sessions belong in setup');
    if (width === 1440) {
      assert.equal(await page.getByRole('button',{name:'Start immersive session',exact:true}).isVisible(),true,'Immersive mode is an explicit option for the same interview');
      assert.equal(await page.locator('.wb__cols').evaluate(element => element.firstElementChild.classList.contains('wb__main')),true,'The conversation leads the restored layout');
      assert.equal(await page.locator('.wb__rail .wb__prompt').isVisible(),true,'The exercise stays beside the conversation');
      assert.equal(await page.locator('.wb__chat').isVisible(),true,'Conversation history is visible without opening a transcript');
      assert.equal(await page.locator('.wb__board-empty,.wb__sessionbar').count(),0,'No empty board column or session toolbar');
      const shell = await page.locator('.wb-modal .pass__box').boundingBox();
      const studioHeader = await page.locator('.adm__bar').boundingBox(), studioStatus = await page.locator('.adm__statusbar').boundingBox();
      assert.equal(shell.width,1440); assert.ok(shell.y >= studioHeader.y + studioHeader.height);
      assert.ok(shell.y + shell.height <= studioStatus.y);
      const conversation = await page.locator('.wb__main').boundingBox(), rail = await page.locator('.wb__rail').boundingBox();
      assert.ok(conversation.x + conversation.width <= rail.x,'The exercise rail is on the right');
    }
    assert.equal(await page.locator('.wb__board').isVisible(),false,'No capture area is reserved before a feed is connected');
    await page.locator('[data-wb-watch="screen"]').click();
    try { await page.waitForFunction(() => document.querySelector('.wb__feed-vid')?.videoWidth === 800,null,{timeout:8000}); }
    catch (error) { throw new Error(JSON.stringify({errors,state:await page.evaluate(() => ({message:document.querySelector('.wb-modal .pass__err')?.textContent,requests:window.mediaRequests,tracks:window.boardStream?.getTracks().map(track=>track.readyState),videos:[...document.querySelectorAll('video')].map(video=>({width:video.videoWidth,ready:video.readyState}))}))}),{cause:error}); }
    assert.equal(await page.locator('[data-wb-record]').getAttribute('aria-pressed'),'false'); assert.equal(await page.locator('.wb__watch-rec:visible').count(),0);
    assert.equal(await page.locator('[data-wb-record]').isVisible(),false,'Sharing alone does not expose recording');
    assert.equal(await page.locator('[data-wb-record-notice]').isVisible(),false);
    assert.equal(await page.locator('[data-wb-ai-source],[data-wb-record-source],.wb__watch-options').count(),0);
    assert.match(await page.locator('#wb-images-notice').textContent(),/focused feed goes to your configured AI/);
    const loadedFonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replace(/['"]/g,'')); });
    for (const family of ['Schibsted Grotesk','Hanken Grotesk','Martian Mono']) assert.ok(loadedFonts.includes(family), family + ' is actually loaded');
    assert.equal(await page.locator('.wb__feed-vid').evaluate(video=>getComputedStyle(video).objectFit),'contain');
    assert.equal(await page.evaluate(() => { const canvas=document.createElement('canvas'); canvas.width=800;canvas.height=500;canvas.getContext('2d').drawImage(document.querySelector('.wb__feed-vid'),0,0); return canvas.getContext('2d').getImageData(50,150,1,1).data[0]; }),216);
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-board-' + width + '.png')});
    assert.equal(await page.locator('.wb__stage').evaluate(element=>element.scrollWidth <= element.clientWidth),true);
    await page.locator('[data-wb-immersive]').click();
    await page.waitForFunction(() => document.querySelector('.wb__preview-video')?.videoWidth === 800);
    assert.equal(await page.locator('[data-wb-speech-cancel]').count(),0);
    assert.equal(await page.locator('.wb__header [data-wb-record]').isVisible(),true);
    assert.equal(await page.locator('[data-wb-record]').getAttribute('aria-pressed'),'false');
    await page.locator('[data-wb-record]').click(); await page.getByRole('button',{name:'Start recording',exact:true}).click(); await page.locator('.wb__watch-rec').waitFor();
    await page.evaluate(() => { window.boardCanvas.getContext('2d').fillRect(5,5,12,12); window.boardStream.getVideoTracks()[0].requestFrame?.(); });
    await page.waitForFunction(() => window.recordedBytes > 0);
    await page.locator('[data-wb-record]').click(); await page.locator('.wb__watch-dl').waitFor();
    assert.ok(await page.locator('.wb__watch-dl').evaluate(async link => (await (await fetch(link.href)).blob()).size > 0));
    assert.equal(await page.evaluate(() => window.boardStream.getVideoTracks()[0].readyState),'live');
    await page.locator('[data-wb-spk]').click();
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 1 && !document.querySelector('[data-wb-send]').disabled);
    await page.locator('.wb__msg').fill('I will clarify the user need. '.repeat(width === 1440 ? 80 : 1)); await page.locator('[data-wb-send]').click(); await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 2 && !document.querySelector('[data-wb-send]').disabled);
    if (width === 1440) {
      await page.locator('.wb__msg').fill('Keep my draft through view changes.');
      const before = await page.evaluate(() => ({session:JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0],calls:window.preparationCalls.length}));
      await page.evaluate(() => { window.originalBoardVideo = document.querySelector('[data-feed="screen"] video'); window.originalComposer = document.querySelector('.wb__msg'); });
      await page.waitForFunction(() => document.querySelector('.wb__preview-video')?.videoWidth === 800);
      assert.equal(await page.locator('[data-wb-immersive]').textContent(),'Exit immersive session');
      assert.equal(await page.locator('.wb__interviewer .ai-ribbon').count(),1,'Interviewer reuses the Studio AI ribbon');
      assert.equal(await page.locator('.wb__interviewer').getAttribute('data-ai-state'),'idle');
      assert.equal(await page.evaluate(() => document.querySelector('[data-feed="screen"] video') === window.originalBoardVideo),true);
      assert.equal(await page.evaluate(() => document.querySelector('.wb__msg') === window.originalComposer),true);
      assert.equal(await page.evaluate(() => window.preparationCalls.length),before.calls,'Entering a view must not send an AI request');
      assert.equal(await page.locator('[data-wb-record]').getAttribute('aria-pressed'),'false');
      assert.equal(await page.locator('.wb__msg').inputValue(),before.session.draft);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].id),before.session.id);
      await page.locator('.wb__immersive-prompt > summary').click();
      assert.equal(await page.locator('.wb__immersive-prompt .wb__prompt').isVisible(),true);
      await page.locator('.wb__immersive-prompt > summary').click();
      for (const viewport of [{width:1024,height:768,theme:'day'},{width:1440,height:1000,theme:'night'},{width:1920,height:1080,theme:'night'}]) {
        await page.setViewportSize({width:viewport.width,height:viewport.height});
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; },viewport.theme);
        const preview = await page.locator('.wb__preview').boundingBox(), conversation = await page.locator('.wb__main').boundingBox();
        assert.ok(preview.width > conversation.width,'The board is the primary immersive surface');
        assert.ok(preview.x + preview.width <= conversation.x);
        assert.ok(await page.locator('.wb__stage').evaluate(element => element.scrollWidth <= element.clientWidth));
        const composer = await page.locator('.wb__composer').boundingBox(), stage = await page.locator('.wb__stage').boundingBox();
        assert.ok(composer.y >= stage.y && composer.y + composer.height <= stage.y + stage.height,'Immersive composer stays visible');
        await page.screenshot({path:join(tmpdir(),'rk-whiteboard-concept-immersive-' + viewport.width + '.png')});
      }
      await page.setViewportSize({width,height:1000});
      await page.locator('[data-wb-immersive]').click();
      assert.equal(await page.locator('.wb__msg').inputValue(),before.session.draft);
      assert.equal(await page.locator('.wb__turn').count(),before.session.turns.length);
      assert.equal(await page.locator('[data-wb-phase]').textContent(),'working');
      assert.equal(await page.evaluate(() => window.boardStream.getTracks().every(track=>track.readyState==='ended')),true);
      assert.ok(await page.locator('.wb__watch-dl').evaluate(async link => (await (await fetch(link.href)).blob()).size > 0),'Exit keeps completed recordings available');
    }
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-room-' + width + '.png')});
    if (width === 1440) {
      for (const viewport of [{width:1024,height:768,theme:'day'},{width:1920,height:1080,theme:'night'}]) {
        await page.setViewportSize({width:viewport.width,height:viewport.height});
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; },viewport.theme);
        const conversation = await page.locator('.wb__main').boundingBox(), rail = await page.locator('.wb__rail').boundingBox();
        assert.ok(conversation.x + conversation.width <= rail.x);
        assert.ok(await page.locator('.wb__stage').evaluate(element => element.clientWidth <= 1920 && element.scrollWidth <= element.clientWidth));
        assert.ok(await page.locator('.wb-modal .pass__box').evaluate(element => element.getBoundingClientRect().bottom <= document.querySelector('.adm__statusbar').getBoundingClientRect().top));
        const composer = await page.locator('.wb__composer').boundingBox(), stage = await page.locator('.wb__stage').boundingBox();
        assert.ok(composer.y >= stage.y && composer.y + composer.height <= stage.y + stage.height,'Conversation composer stays visible');
        await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-room-' + viewport.width + '.png')});
      }
      await page.setViewportSize({width,height:1000});
    }
    if (width < 821) {
      await page.setViewportSize({width,height:568}); await page.locator('.wb__msg').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('.wb__msg').evaluate(element => { const bounds = element.getBoundingClientRect(); return document.elementFromPoint(bounds.x + bounds.width / 2,bounds.y + bounds.height / 2) === element; }),true);
      await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-short-' + width + '.png')});
      await page.setViewportSize({width,height:1000});
    }
    if (width === 1440) {
      const transcriptCalls = await page.evaluate(()=>window.preparationCalls.length);
      await page.evaluate(()=>localStorage.removeItem('rk:ai:img:key'));
      await page.locator('[data-wb-score]').click();
      await page.waitForFunction(()=>document.querySelector('.wb-modal .pass__err').textContent.includes('directly connected Gemini'));
      assert.equal(await page.locator('.wb__watch-dl').count(),1);
      assert.equal(await page.evaluate(()=>window.preparationCalls.length),transcriptCalls,'Unsupported providers must not silently generate a transcript-only review');
      await page.evaluate(()=>localStorage.setItem('rk:ai:img:key','synthetic-video-key'));
      await page.locator('[data-wb-score]').click(); await page.getByRole('button',{name:'Keep local',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[data-wb-score]').disabled);
      assert.equal(await page.evaluate(()=>window.videoUploads.length),0,'Cancelling upload sends no media');
      for (const mode of ['upload-error','processing','bad-evidence']) {
        await page.evaluate(mode=>{window.videoReviewMode=mode;},mode);
        await page.locator('[data-wb-score]').click(); await page.getByRole('button',{name:'Upload to Gemini',exact:true}).click();
        if(mode==='processing') { await page.waitForFunction(()=>document.querySelector('[data-wb-review-status]').textContent.includes('processing')); await page.locator('[data-wb-review-cancel]').click(); }
        if(mode==='bad-evidence') await page.getByRole('button',{name:'Analyse recordings',exact:true}).click();
        await page.waitForFunction(()=>!document.querySelector('[data-wb-score]').disabled && !!document.querySelector('.wb-modal .pass__err').textContent);
        assert.equal(await page.locator('.wb__scorewrap').count(),0,'Failures never appear as a completed scorecard');
        assert.equal(await page.evaluate(()=>window.videoReviewCalls.at(-1).method),'DELETE');
        assert.equal(await page.locator('.wb__watch-dl').count(),1);
      }
      assert.equal(await page.evaluate(()=>window.preparationCalls.length),transcriptCalls);
      await page.evaluate(()=>{window.videoReviewMode='';window.videoUploads=[];});
    }
    await page.locator('[data-wb-score]').click();
    try { await page.getByRole('button',{name:'Upload to Gemini',exact:true}).click({timeout:8000}); }
    catch (error) { throw new Error(JSON.stringify(await page.evaluate(()=>({message:document.querySelector('.wb-modal .pass__err')?.textContent,calls:window.videoReviewCalls}))),{cause:error}); }
    await page.getByRole('button',{name:'Analyse recordings',exact:true}).click();
    await page.getByText('SAVED_MOCK_SCORE',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.videoUploads.length),1);
    assert.ok(await page.evaluate(()=>window.videoUploads[0].size>0));
    assert.ok(await page.evaluate(()=>window.videoReviewBody.contents[0].parts.some(part=>part.fileData?.mimeType==='video/webm')));
    assert.equal(await page.getByRole('button',{name:'Play this moment',exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>window.videoReviewCalls.at(-1).method),'DELETE');
    assert.equal(await page.locator('.wb__main').evaluate(element => element.firstElementChild.classList.contains('wb__scorewrap')),true);
    assert.equal(await page.locator('.wb__composer').isVisible(),false);
    assert.equal(await page.locator('[data-wb-phase]').textContent(),'Review');
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-review-' + width + '.png')});
    if (width === 1440) await assertWhiteboardDesignSystem(page);
    assert.equal(await page.locator('.wb__stage').evaluate(element=>element.scrollWidth <= element.clientWidth),true);
    assert.equal(await page.evaluate(() => window.boardStream.getTracks().every(track=>track.readyState==='ended')),true);
    assert.equal(await page.evaluate(() => window.mediaRequests.length),1); assert.equal(await page.evaluate(() => window.mediaRequests[0].options.audio),false);
    const callsBeforeSetup = await page.evaluate(() => window.preparationCalls.length);
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('[data-wb-rail-back]').click();
    await page.locator('[data-wb-view="existing"]').click();
    assert.equal(await page.locator('.wb-modal').getAttribute('aria-modal'),'true');
    assert.equal(await page.locator('.wb-modal').evaluate(element=>element.classList.contains('wb-modal--stage')),false);
    assert.equal(await page.locator('[data-wb-history]').isVisible(),false);
    await page.locator('[data-wb-hist-open]').first().focus();
    assert.equal(await page.evaluate(()=>document.activeElement.matches('[data-wb-hist-open]')),true,'Saved sessions remain keyboard accessible in setup');
    assert.equal(await page.locator('.wb__brief').inputValue(),'Refund onboarding');
    assert.equal(await page.locator('.wb__own').inputValue(),'Design a clear refund status.');
    assert.equal(await page.locator('.wb__own').isVisible(),false);
    assert.equal(await page.evaluate(() => window.preparationCalls.length),callsBeforeSetup);
    if (width === 1440) assert.ok((await page.locator('.wb-modal .pass__box').boundingBox()).width <= 880);
    await page.locator('[data-wb-hist-open]').first().press('Enter');
    assert.equal(await page.getByRole('button',{name:'Saved sessions',exact:true}).count(),0);
    await page.getByText('SAVED_MOCK_SCORE',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.preparationCalls.length),callsBeforeSetup);
    assert.equal(await page.getByRole('button',{name:'Play this moment',exact:true}).count(),0,'Recorded media is not falsely restored from history');
    assert.match(await page.locator('.wb__scorewrap').textContent(),/Recorded media was not saved in history/);
    await page.locator('[data-wb-rail-back]').click();
    await page.locator('.wb-modal [data-cancel]').click();
    assert.equal(await page.locator('.adm__bar').evaluate(element=>element.inert),false);
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    assert.equal(await page.locator('[data-wb-history]').isVisible(),false,'Reopening Whiteboard starts with no redundant history button');
    assert.equal(await page.locator('[data-wb-view="existing"]').getAttribute('aria-pressed'),'true','Saved sessions make Existing the default on reopen');
    await page.locator('.wb-modal [data-cancel]').click();
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard immersive sources permissions and navigation preserve the same session', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      window.SpeechRecognition = class { start() { window.recognitionStarts = (window.recognitionStarts || 0) + 1; } stop() { this.onend?.(); } abort() {} };
    });
    await installPrepareReplies(page);
    await page.route('https://api.anthropic.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:'session-model',input_modalities:['text','image'],output_modalities:['text'],max_input_tokens:100000,max_tokens:32000,pricing:{input:1,output:3}}]})}));
    await openIntegratedFixture(page);
    await page.evaluate(() => {
      window.captureMode = 'both'; window.captureRequests = []; window.captureStreams = []; window.recorderStreams = []; window.recordingBytes = 0; window.segmentBytes = [];
      window.makeCapture = source => {
        if (source.endsWith('mic')) {
          const audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
          oscillator.connect(destination); oscillator.start(); const stream = destination.stream;
          window.captureStreams.push({source,stream}); return stream;
        }
        const canvas = document.createElement('canvas'); canvas.width = source === 'screen' ? 800 : 320; canvas.height = source === 'screen' ? 500 : 240;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = source === 'screen' ? '#d8a657' : '#5bafa7'; drawing.fillRect(0,0,canvas.width,canvas.height);
        const stream = canvas.captureStream(10); window.captureStreams.push({source,stream,canvas});
        const frames = setInterval(() => { if (stream.getTracks().every(track=>track.readyState==='ended')) { clearInterval(frames); return; } drawing.fillRect(0,0,2,2); stream.getVideoTracks()[0].requestFrame?.(); },100);
        return stream;
      };
      navigator.mediaDevices.getDisplayMedia = options => {
        window.captureRequests.push({source:'screen',options});
        if (window.captureMode === 'late') return new Promise(resolve => { window.releaseScreen = () => resolve(window.makeCapture('late-screen')); });
        if (window.captureMode !== 'both') return Promise.reject(new DOMException('Denied','NotAllowedError'));
        return Promise.resolve(window.makeCapture('screen'));
      };
      navigator.mediaDevices.getUserMedia = options => {
        window.captureRequests.push({source:options.audio ? 'mic' : 'camera',options});
        if (window.captureMode === 'late' && options.audio) return new Promise(resolve => { window.releaseMicrophone = () => resolve(window.makeCapture('late-mic')); });
        if (window.captureMode === 'none' || window.captureMode === 'late') return Promise.reject(new DOMException('Denied','NotAllowedError'));
        return Promise.resolve(window.makeCapture(options.audio ? 'mic' : 'camera'));
      };
      const NativeRecorder = window.MediaRecorder;
      window.MediaRecorder = class extends NativeRecorder {
        constructor(stream,...rest) { super(stream,...rest); window.lastRecorder=this; const index=window.recorderStreams.length; window.recorderStreams.push(stream); window.segmentBytes[index]=0; this.addEventListener('dataavailable',event => { window.recordingBytes += event.data.size; window.segmentBytes[index]+=event.data.size; }); }
      };
    });
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-deeper]').click(); await page.locator('.wb__own').fill('Keep the refund experience clear.'); await page.locator('[data-wb-start]').click();
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 1 && !document.querySelector('[data-wb-send]').disabled);
    await page.locator('.wb__msg').fill('My uninterrupted draft');
    const before = await page.evaluate(() => ({session:JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0],calls:window.preparationCalls.length}));
    await page.locator('[data-wb-immersive]').click();
    assert.equal(await page.locator('[data-wb-speech-allow]').count(),0);
    await page.waitForFunction(() => document.querySelectorAll('.wb__feed-vid').length === 2 && document.querySelector('.wb__preview-video')?.videoWidth === 800);
    assert.equal(await page.locator('.wb__watch-options,[data-wb-ai-source],[data-wb-record-source]').count(),0);
    assert.equal(await page.locator('[data-wb-preview="screen"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-wb-record]').getAttribute('aria-pressed'),'false');
    const row = await page.locator('.wb__media-row').evaluate(element => ['[data-feed="screen"]','[data-feed="camera"]','.wb__interviewer','[data-wb-timer]'].map(selector=>{const bounds=element.querySelector(selector).getBoundingClientRect();return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};}));
    assert.ok(row.every(bounds=>Math.abs(bounds.y-row[0].y)<1 && Math.abs(bounds.height-row[0].height)<1),'All four tiles share a row and height');
    assert.ok(row.every(bounds=>Math.abs(bounds.width-row[0].width)<1),'All four tiles share the reference width');
    assert.ok(row.slice(1).every((bounds,index)=>Math.abs(bounds.x-row[index].x-row[index].width-8)<1),'Tiles use the reference 8px spacing');
    assert.equal(await page.getByRole('button',{name:'Stop screen sharing',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Turn off camera',exact:true}).count(),1);
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-unified-immersive.png')});
    await page.evaluate(() => { window.retainedVideos = [...document.querySelectorAll('.wb__feed-vid')]; });
    await page.locator('[data-wb-preview="camera"]').click();
    await page.waitForFunction(() => document.querySelector('.wb__preview-video').videoWidth === 320);
    assert.equal(await page.locator('[data-wb-preview="camera"]').getAttribute('aria-pressed'),'true');
    await page.waitForFunction(()=>document.querySelector('.wb__watch-meta').textContent.includes('Camera images on each turn'));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.wb__feed-vid')].every((video,index) => video === window.retainedVideos[index])),true);
    assert.equal(await page.locator('.wb__preview-video').evaluate(video => { const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const drawing=canvas.getContext('2d');drawing.drawImage(video,0,0,1,1);return drawing.getImageData(0,0,1,1).data[0]; }),91);
    await page.locator('[data-ai-session-toggle]').click();
    await page.locator('[data-ai-session-panel]').waitFor();
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-immersive-ai-activity.png')});
    await page.locator('[data-wb-record]').click(); await page.getByRole('button',{name:'Start recording',exact:true}).click();
    await page.locator('[data-ai-close]').click();
    await page.waitForFunction(()=>document.querySelector('[data-wb-record]').getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('[data-wb-record-label]').textContent(),'Stop recording');
    const headerPositions = await page.locator('.wb__header').evaluate(header => {
      const box = selector => header.querySelector(selector).getBoundingClientRect();
      const pip=box('[data-wb-min]'), record=box('.wb__record'), immersive=box('[data-wb-immersive]');
      return {ordered:record.right <= immersive.left && immersive.right <= pip.left};
    });
    assert.equal(headerPositions.ordered,true,'Header order is Record, Exit immersive, PiP');
    assert.equal(await page.evaluate(() => window.recorderStreams[0].getAudioTracks().length),1,'Recording includes microphone audio');
    assert.equal(await page.evaluate(() => window.recorderStreams[0].getVideoTracks().length),1);
    await page.evaluate(async () => { const video=document.createElement('video');video.muted=true;video.srcObject=window.recorderStreams[0];document.body.append(video);await video.play();window.recordingPreview=video; });
    const recordedPixel = async () => page.evaluate(() => {const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const context=canvas.getContext('2d');context.drawImage(window.recordingPreview,640,360,1,1,0,0,1,1);return context.getImageData(0,0,1,1).data[0];});
    assert.ok(Math.abs(await recordedPixel()-91)<5,'The actual recorded video starts on focused camera');
    await page.waitForFunction(() => window.recordingBytes > 0);
    await page.locator('[data-wb-preview="screen"]').click();
    await page.waitForFunction(() => {const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const context=canvas.getContext('2d');context.drawImage(window.recordingPreview,640,360,1,1,0,0,1,1);return context.getImageData(0,0,1,1).data[0]>190;});
    assert.equal(await page.evaluate(()=>window.recorderStreams.length),1,'Focus switches do not split or restart the audio/video recording');
    await page.locator('[data-wb-record]').click();
    await page.waitForFunction(() => document.querySelectorAll('.wb__watch-dl').length === 1);
    await page.locator('[data-wb-record]').click(); await page.getByRole('button',{name:'Start recording',exact:true}).click();
    await page.waitForFunction(() => window.segmentBytes[1] > 0);
    await page.locator('[data-wb-preview="camera"]').click();
    assert.equal(await page.locator('[data-wb-preview="camera"]').getAttribute('aria-pressed'),'true');
    await page.evaluate(() => { const recorder=window.lastRecorder, finish=recorder.onstop; recorder.onstop=event=>{window.releaseRecordingStop=()=>finish(event);}; });
    await page.locator('[data-wb-immersive]').click();
    await page.waitForFunction(() => typeof window.releaseRecordingStop === 'function');
    assert.equal(await page.locator('[data-wb-record]').isVisible(),true,'Recording controls stay visible until finalisation completes');
    assert.equal(await page.locator('[data-wb-immersive]').isDisabled(),true);
    assert.equal(await page.locator('[data-wb-record-label]').textContent(),'Preparing recording...');
    assert.equal(await page.locator('.wb__watch-dl').count(),1);
    await page.evaluate(() => window.releaseRecordingStop());
    await page.waitForFunction(() => document.querySelectorAll('.wb__watch-dl').length === 2);
    assert.equal(await page.locator('[data-wb-record]').isVisible(),false);
    assert.equal(await page.locator('[data-wb-record]').getAttribute('aria-pressed'),'false');
    assert.equal(await page.evaluate(() => window.captureStreams.every(({stream})=>stream.getTracks().every(track=>track.readyState==='ended'))),true);
    assert.equal(await page.locator('.wb__msg').inputValue(),before.session.draft);
    const recordedSizes = await page.locator('.wb__watch-dl').evaluateAll(async links => Promise.all(links.map(async link => (await (await fetch(link.href)).blob()).size)));
    assert.ok(recordedSizes.every(size=>size>0));
    await page.evaluate(() => { window.captureMode = 'camera-only'; });
    await page.locator('[data-wb-immersive]').click();
    await page.waitForFunction(() => document.querySelector('.wb__preview-video')?.videoWidth === 320);
    assert.equal(await page.locator('[data-wb-preview="camera"]').getAttribute('aria-pressed'),'true','Camera-only entry focuses the camera');
    assert.equal(await page.locator('[data-wb-record]').getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>{window.captureMode='both';});
    await page.locator('[data-wb-watch="screen"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-wb-preview="screen"]')?.getAttribute('aria-pressed')==='true');
    await page.locator('[data-wb-preview="camera"]').click();
    await page.getByRole('button',{name:'Turn off camera',exact:true}).click();
    assert.equal(await page.locator('[data-wb-preview="screen"]').getAttribute('aria-pressed'),'true','Stopping focus falls back to the remaining feed');
    await page.locator('[data-wb-immersive]').click();
    await page.evaluate(() => { window.captureMode = 'none'; });
    await page.locator('[data-wb-immersive]').click();
    await page.waitForFunction(() => document.querySelector('.wb__stage').dataset.immersive === 'false');
    assert.match(await page.locator('.wb-modal .pass__err').textContent(),/No screen or camera/);
    assert.equal(await page.locator('[data-wb-send]').isEnabled(),true);
    await page.evaluate(() => { window.captureMode = 'late'; });
    await page.locator('[data-wb-immersive]').click();
    await page.waitForFunction(() => !!window.releaseScreen && !!window.releaseMicrophone);
    await page.locator('[data-wb-immersive]').click();
    await page.evaluate(() => { window.captureMode = 'camera-only'; });
    await page.locator('[data-wb-immersive]').click();
    await page.waitForFunction(() => document.querySelector('.wb__preview-video')?.videoWidth === 320);
    const recognitionStarts = await page.evaluate(() => window.recognitionStarts);
    await page.evaluate(() => { window.releaseScreen(); window.releaseMicrophone(); });
    await page.waitForFunction(() => window.captureStreams.filter(item=>item.source.startsWith('late-')).every(({stream})=>stream.getTracks().every(track=>track.readyState==='ended')));
    assert.equal(await page.locator('.wb__stage').getAttribute('data-immersive'),'true');
    assert.equal(await page.evaluate(() => window.recognitionStarts),recognitionStarts);
    assert.equal(await page.locator('.wb__feed-vid').count(),1);
    await page.locator('[data-wb-immersive]').click();
    const after = await page.evaluate(() => ({session:JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0],calls:window.preparationCalls.length}));
    assert.equal(after.session.id,before.session.id); assert.equal(after.session.draft,before.session.draft); assert.deepEqual(after.session.turns,before.session.turns); assert.equal(after.calls,before.calls);
    assert.ok(after.session.timer <= before.session.timer && after.session.timer > before.session.timer - 30);
    assert.equal(await page.locator('.adm__main').evaluate(element=>element.inert),true);
    await page.locator('.adm__tab[data-tab="ai"]').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.adm__main,.adm__workbar')),false);
    page.once('dialog',dialog=>dialog.dismiss()); await page.locator('.adm__tab[data-tab="work"]').click();
    assert.equal(await page.locator('.wb-modal').isVisible(),true,'Cancel navigation preserves recordings and session');
    page.once('dialog',dialog=>dialog.accept()); await page.locator('.adm__tab[data-tab="work"]').click();
    assert.equal(await page.locator('.wb-modal').count(),0);
    assert.equal(await page.locator('.adm__main').evaluate(element=>element.inert),false);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard recording refuses denied microphones and releases late grants and failed recorders', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage();
  try {
    await openIntegratedFixture(page);
    await page.route('**/src/js/whiteboard-media.mjs',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./src/js/whiteboard-media.mjs',import.meta.url),'utf8')}));
    const result = await page.evaluate(async () => {
      const {startWhiteboardRecording} = await import('/src/js/whiteboard-media.mjs');
      const errors = [];
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Microphone denied','NotAllowedError'); };
      let denied = false;
      try { await startWhiteboardRecording({video:()=>null,source:()=>'screen',onError:message=>errors.push(message)}); }
      catch(error) { denied = error.name === 'NotAllowedError'; }
      let resolvePermission;
      navigator.mediaDevices.getUserMedia = () => new Promise(resolve=>{resolvePermission=resolve;});
      const controller = new AbortController();
      const pending = startWhiteboardRecording({video:()=>null,source:()=>'screen',signal:controller.signal,onError:message=>errors.push(message)});
      controller.abort();
      const audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start(); resolvePermission(destination.stream);
      let cancelled = false;
      try { await pending; } catch(error) { cancelled = error.name === 'AbortError'; }
      const lateReleased = destination.stream.getTracks().every(track=>track.readyState==='ended');
      const live = audio.createMediaStreamDestination(); oscillator.connect(live);
      navigator.mediaDevices.getUserMedia = async()=>live.stream;
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;canvas.getContext('2d').fillRect(0,0,640,400);
      const feed=canvas.captureStream(10),video=document.createElement('video');video.muted=true;video.srcObject=feed;document.body.append(video);await video.play();
      const capture=await startWhiteboardRecording({video:()=>video,source:()=>'screen',onError:message=>errors.push(message)});
      await new Promise(resolve=>setTimeout(resolve,1200));
      capture.recorder.dispatchEvent(new Event('error'));
      const failed=await capture.finished;
      const recordingTracksStopped=live.stream.getTracks().every(track=>track.readyState==='ended');
      const sourcePreserved=feed.getTracks().every(track=>track.readyState==='live');
      const processor=window.MediaStreamTrackProcessor;window.MediaStreamTrackProcessor=undefined;
      const fallbackAudio=audio.createMediaStreamDestination();oscillator.connect(fallbackAudio);
      navigator.mediaDevices.getUserMedia=async()=>fallbackAudio.stream;
      const fallback=await startWhiteboardRecording({video:()=>video,source:()=>'screen',onError:message=>errors.push(message)});
      await new Promise(resolve=>setTimeout(resolve,1200));
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      document.dispatchEvent(new Event('visibilitychange'));
      const fallbackResult=await fallback.finished;
      delete document.hidden;window.MediaStreamTrackProcessor=processor;
      feed.getTracks().forEach(track=>track.stop());video.remove();await audio.close();
      return {denied,cancelled,lateReleased,recordingTracksStopped,sourcePreserved,incomplete:!!failed.error,bytes:failed.blob.size,fallbackError:fallbackResult.error,fallbackBytes:fallbackResult.blob.size,errors};
    });
    assert.equal(result.denied,true); assert.equal(result.cancelled,true); assert.equal(result.lateReleased,true);
    assert.equal(result.recordingTracksStopped,true); assert.equal(result.incomplete,true); assert.ok(result.bytes>0);
    assert.equal(result.sourcePreserved,true,'Stopping recording must not stop the shared source');
    assert.match(result.fallbackError,/cannot keep recording in the background/);assert.ok(result.fallbackBytes>0);
    assert.match(result.errors[0],/recording failed/);
  } finally { await browser.close(); }
});

test('Settings forms share bottom-pinned actions and one full-height content scroller', {timeout:90000}, async () => {
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await openIntegratedFixture(page);
    await page.locator('[data-opensettings]').click();
    for (const [category,action] of [['ai','open-ai'],['publish','open-publish'],['security','open-adminkey'],['security','open-passkeys'],['allow','allow-edit']]) {
      await page.locator(`[data-act="settings-cat"][data-cat="${category}"]`).click();
      await page.locator(`.adm__settings [data-act="${action}"]`).click();
      await page.locator('.adm__set-footer').waitFor();
      for (const [width,height] of [[1440,1000],[2560,1334],[1440,650],[390,844]]) {
        await page.setViewportSize({width,height});
        await page.locator('.adm__set-content').evaluate(element=>{element.scrollTop=0;});
        const measure=()=>page.evaluate(()=>{
          const sheet=document.querySelector('.adm__set-sheet'), panel=document.querySelector('.adm__set-panel');
          const content=document.querySelector('.adm__set-content'), footer=document.querySelector('.adm__set-footer'), actions=footer.querySelector('.pass__actions');
          return {sheet:sheet.getBoundingClientRect().toJSON(),content:content.getBoundingClientRect().toJSON(),footer:footer.getBoundingClientRect().toJSON(),actions:actions.getBoundingClientRect().toJSON(),panelOverflow:panel.scrollHeight-panel.clientHeight,horizontalOverflow:panel.scrollWidth-panel.clientWidth};
        });
        const before=await measure(), label=JSON.stringify({action,width,height,before});
        assert.ok(Math.abs(before.sheet.bottom-before.actions.bottom-24)<1,label);
        assert.ok(Math.abs(before.content.bottom-before.footer.top)<1,label);
        assert.ok(before.content.height>200,label);
        assert.ok(before.panelOverflow<=1&&before.horizontalOverflow<=1,label);
        await page.locator('.adm__set-content').evaluate(element=>{element.scrollTop=element.scrollHeight;});
        const after=await measure();
        assert.ok(Math.abs(after.actions.y-before.actions.y)<1,'Scrolling must not move the actions: '+label);
        if (action==='open-ai') {
          assert.equal(await page.locator('.aiset__body').evaluate(element=>getComputedStyle(element).maxHeight),'none');
          await page.locator('.adm__set-content').evaluate(element=>{element.scrollTop=0;});
          const spacing=await page.locator('.aiset__appearance').evaluate(element=>({
            padding:parseFloat(getComputedStyle(element).paddingLeft),
            gap:element.querySelector('.aiset__appearance-row').getBoundingClientRect().top-element.querySelector('.af__hint').getBoundingClientRect().bottom
          }));
          assert.equal(spacing.padding,24); assert.ok(spacing.gap>=23.9);
          if (width===2560||width===390) await page.screenshot({path:join(tmpdir(),'rk-settings-layout-'+width+'.png')});
        }
      }
      if (action==='open-adminkey') {
        await page.locator('.adm__set-footer [data-go]').click();
        assert.match(await page.locator('.adm__set-footer .pass__err').textContent(),/at least 4/);
        assert.equal(await page.locator('.adm__set-footer .pass__err').isVisible(),true);
      }
      await page.setViewportSize({width:1440,height:1000});
      await page.locator('[data-act="set-back"]').click();
      assert.equal(await page.locator('.adm__set-footer').count(),0);
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('AI appearance saves locally and updates Interviewer without changing compact icons or session drafts', {timeout:90000}, async () => {
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript(()=>{
      navigator.mediaDevices.getUserMedia=()=>{ throw new Error('Physical media is forbidden in this fixture'); };
      navigator.mediaDevices.getDisplayMedia=async()=>{
        const canvas=document.createElement('canvas'); canvas.width=800; canvas.height=500;
        const context=canvas.getContext('2d'); context.fillStyle='#d8a657'; context.fillRect(0,0,800,500);
        window.appearanceBoard=canvas;
        return canvas.captureStream(1);
      };
    });
    await installPrepareReplies(page); await openIntegratedFixture(page);
    const original=await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    const openAppearance=async()=>{
      await page.locator('[data-opensettings]').click();
      await page.locator('[data-act="settings-cat"][data-cat="ai"]').click();
      await page.getByRole('button',{name:'Open AI settings',exact:true}).click();
    };
    await openAppearance();
    const settings=page.locator('.adm__settings');
    assert.equal(await page.locator('[data-ai-appearance-style]').inputValue(),'2d');
    assert.equal(await page.locator('[data-ai-appearance-orb]').isChecked(),false);
    await page.locator('[data-ai-appearance-style]').selectOption('3d');
    await page.locator('[data-ai-appearance-orb]').check();
    await page.waitForFunction(()=>document.querySelector('[data-ai-appearance-preview]')?.dataset.aiOrb==='true');
    await page.locator('.pass--inpanel [data-cancel]').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:ai:appearance')),null,'Close must discard the appearance draft');
    await page.getByRole('button',{name:'Open AI settings',exact:true}).click();
    assert.equal(await page.locator('[data-ai-appearance-style]').inputValue(),'2d');
    await page.locator('[data-ai-appearance-style]').selectOption('3d');
    await page.locator('[data-ai-appearance-orb]').check();
    await page.waitForFunction(()=>document.querySelector('[data-ai-appearance-preview]')?.dataset.aiRenderer==='gpu');
    await page.locator('.adm__set-content').evaluate(element=>{element.scrollTop=0;});
    await page.screenshot({path:join(tmpdir(),'rk-ai-appearance-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.adm__set-content').evaluate(element=>{element.scrollTop=0;});
    assert.equal(await page.locator('[data-ai-appearance-style]').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(tmpdir(),'rk-ai-appearance-mobile.png')});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.pass--inpanel [data-go]').click();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:ai:appearance'))),{style:'3d',orb:true});
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),original);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:ai:txt:key')),'synthetic-session-key');
    await settings.locator('[data-act="settings-close"]').click();
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('Synthetic appearance interview');
    await page.locator('[data-wb-start]').click(); await page.locator('[data-wb-ready]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===1&&!document.querySelector('[data-wb-send]').disabled);
    await page.locator('[data-wb-immersive]').click();
    try { await page.waitForFunction(()=>document.querySelector('.wb__interviewer')?.dataset.aiRenderer==='gpu',null,{timeout:8000}); }
    catch (error) {
      throw new Error(JSON.stringify(await page.evaluate(()=>({
        interviewers:[...document.querySelectorAll('.wb__interviewer')].map(element=>({data:{...element.dataset},rect:element.getBoundingClientRect().toJSON(),canvases:element.querySelectorAll('canvas').length})),
        message:document.querySelector('.wb-modal .pass__err')?.textContent
      }))),{cause:error});
    }
    const interviewer=page.locator('.wb__interviewer');
    assert.equal(await interviewer.getAttribute('data-ai-style'),'3d'); assert.equal(await interviewer.getAttribute('data-ai-orb'),'true');
    await page.locator('.wb__msg').fill('Preserve this appearance review draft');
    await page.screenshot({path:join(tmpdir(),'rk-ai-appearance-interviewer.png')});
    await page.locator('[data-ai-session-toggle]').click(); await page.locator('[data-ai-settings]').click();
    await page.getByRole('button',{name:'Open AI settings',exact:true}).click();
    assert.equal(await page.locator('[data-ai-appearance-style]').inputValue(),'3d');
    assert.equal(await page.locator('[data-ai-appearance-orb]').isChecked(),true);
    await page.locator('[data-ai-appearance-style]').selectOption('2d'); await page.locator('[data-ai-appearance-orb]').uncheck();
    await page.locator('.pass--inpanel [data-go]').click();
    await settings.locator('[data-act="settings-close"]').click();
    await page.waitForFunction(()=>document.querySelector('.wb__interviewer')?.dataset.aiStyle==='2d');
    assert.equal(await interviewer.getAttribute('data-ai-orb'),'false');
    assert.equal(await page.locator('.wb__msg').inputValue(),'Preserve this appearance review draft');
    assert.equal(await page.locator('[data-ai-session-toggle]').getAttribute('data-ai-style'),'2d');
    assert.equal(await page.locator('[data-ai-session-toggle]').getAttribute('data-ai-orb'),'false');
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),1,'Appearance changes must not trigger model requests');
    await page.locator('[data-ai-session-toggle]').click(); await page.locator('[data-ai-settings]').click();
    await page.getByRole('button',{name:'Open AI settings',exact:true}).click();
    await page.locator('.pass--inpanel [data-clear]').click();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:ai:appearance'))),{style:'2d',orb:false},'Removing provider keys must retain appearance');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard activity stays interactive and live replies use one selected request', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('A synthetic single-request interview'); await page.locator('[data-wb-start]').click(); await page.locator('[data-wb-ready]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===1&&!document.querySelector('[data-wb-send]').disabled);
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[1,0]);
    await page.locator('.wb__msg').fill('A draft that must survive the activity panel');
    const toggle=page.locator('[data-ai-session-toggle]'), panel=page.locator('[data-ai-session-panel]');
    await toggle.click(); await page.waitForFunction(()=>document.querySelector('[data-ai-model]')?.options.length>1);
    assert.equal(await panel.evaluate(element=>!!element.closest('[inert]')),false);
    assert.equal(await panel.locator('[data-ai-close]').evaluate(element=>{const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true);
    assert.equal(await page.locator('.adm__main').evaluate(element=>element.inert),true);
    const selected=await panel.locator('[data-ai-model]').selectOption({index:1});
    const model=JSON.parse(selected[0])[2];
    await page.screenshot({path:join(tmpdir(),'rk-whiteboard-ai-activity.png')});
    await panel.locator('[data-ai-close]').press('Escape'); assert.equal(await panel.isVisible(),false);
    assert.equal(await toggle.evaluate(element=>element===document.activeElement),true);
    await toggle.click(); await panel.locator('[data-ai-settings]').click();
    const settings=page.locator('.adm__settings');
    await settings.locator('[data-act="settings-close"]').click(); await settings.waitFor({state:'hidden'});
    await toggle.click(); await panel.locator('[data-ai-settings]').click();
    await page.keyboard.press('Escape'); await settings.waitFor({state:'hidden'});
    assert.equal(await page.locator('.wb__msg').inputValue(),'A draft that must survive the activity panel');
    assert.equal(await page.locator('[data-wb-phase]').textContent(),'working');
    await page.locator('[data-wb-send]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===2&&!document.querySelector('[data-wb-send]').disabled);
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[2,0]);
    const request=await page.evaluate(()=>window.preparationCalls.at(-1));
    assert.equal(request.model,model); assert.match(request.user,/A draft that must survive/); assert.match(request.user,/Which user and outcome/);
    await page.evaluate(()=>{window.whiteboardReply={action:'invalid'};});
    await page.locator('.wb__msg').fill('Retain the candidate response after invalid output'); await page.locator('[data-wb-send]').click();
    await page.locator('[data-wb-reply-retry]').waitFor();
    assert.match(await page.locator('.wb-modal .pass__err').textContent(),/reply was invalid/);
    assert.equal(await page.locator('.wb__turn--int').count(),2);
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[3,0]);
    await toggle.click(); assert.match(await panel.locator('[data-ai-error]').last().textContent(),/reply was invalid/);
    assert.match(await panel.locator('[data-ai-total]').textContent(),/30.*15/);
    await panel.locator('[data-ai-close]').click();
    await page.evaluate(()=>{window.whiteboardReply={};}); await page.locator('[data-wb-reply-retry]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===3&&!document.querySelector('[data-wb-send]').disabled);
    assert.equal(await page.locator('.wb__turn--you').count(),2,'Retry must not duplicate the candidate response');
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[4,0]);
    await page.evaluate(()=>{window.deferWhiteboardReply=true;window.releaseWhiteboardReply=null;});
    await page.locator('.wb__msg').fill('Cancel this response from AI activity'); await page.locator('[data-wb-send]').click();
    await page.waitForFunction(()=>!!window.releaseWhiteboardReply);
    await toggle.click(); await panel.getByRole('button',{name:'Stop AI request',exact:true}).click();
    await page.evaluate(()=>{window.deferWhiteboardReply=false;window.releaseWhiteboardReply();});
    await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    assert.equal(await page.locator('.wb__turn--int').count(),3,'A late cancelled response cannot enter the conversation');
    assert.equal(await panel.locator('[data-job-id]').last().getAttribute('data-status'),'cancelled');
    await panel.locator('[data-ai-close]').click();
    await page.evaluate(()=>{window.whiteboardHttpFailure=true;});
    await page.locator('[data-wb-reply-retry]').click(); await page.locator('[data-wb-reply-retry]').waitFor();
    assert.match(await page.locator('.wb-modal .pass__err').textContent(),/Unsupported temperature/);
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[6,0],'An unsupported parameter must not trigger an implicit provider retry');
    assert.equal(await page.locator('.wb__turn--you').count(),3);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard floating companion shares draft pause and fallback without capture', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), page = await context.newPage(), errors = [];
  context.on('page',candidate=>candidate.on('pageerror',error=>errors.push(error.message)));
  try {
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = () => { throw new Error('Unexpected capture'); };
      navigator.mediaDevices.getUserMedia = async options => { if (!options.audio) throw new Error('Unexpected camera'); window.companionMicRequests=(window.companionMicRequests||0)+1; return {getTracks:()=>[{stop(){}}]}; };
      window.SpeechRecognition = class { start() { window.companionRecognitionStarts=(window.companionRecognitionStarts||0)+1; } abort() {} };
    });
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-mode="mock"]').click();
    await page.locator('[data-wb-deeper]').click();
    await page.locator('.wb__own').fill('A synthetic companion exercise'); await page.locator('[data-wb-start]').click(); await page.locator('[data-wb-ready]').click();
    await page.waitForFunction(() => document.querySelectorAll('.wb__turn--int').length === 1 && !document.querySelector('[data-wb-send]').disabled);
    await page.waitForLoadState('networkidle'); await context.unrouteAll({behavior:'wait'});
    const popup = context.waitForEvent('page'); await page.locator('[data-wb-min]').click(); const companion = await popup;
    await companion.setViewportSize({width:400,height:440});
    await companion.locator('[data-companion-draft]').waitFor({state:'attached'});
    await companion.waitForFunction(() => getComputedStyle(document.querySelector('.wb__companion')).padding === '16px');
    await companion.locator('summary').click(); await companion.locator('[data-companion-draft]').fill('A preserved companion response');
    assert.equal(await page.locator('.wb__msg').inputValue(),'A preserved companion response');
    await companion.locator('[data-companion-ready]').click(); assert.equal(await companion.locator('[data-companion-phase]').textContent(),'paused');
    await companion.locator('[data-companion-ready]').click(); await companion.locator('[data-companion-send]').click();
    await companion.waitForFunction(() => !document.querySelector('[data-companion-send]').disabled);
    assert.equal(await page.locator('.wb__turn--you').count(),1);
    assert.deepEqual(await companion.evaluate(() => ['--sans','--mono','--serif'].map(name=>getComputedStyle(document.documentElement).getPropertyValue(name))),await page.evaluate(() => ['--sans','--mono','--serif'].map(name=>getComputedStyle(document.querySelector('.wb-modal')).getPropertyValue(name))));
    await companion.screenshot({path:join(tmpdir(),'rk-whiteboard-companion.png')});
    await companion.locator('[data-companion-mic]').click();
    await page.waitForFunction(()=>window.companionRecognitionStarts===1);
    assert.equal(await page.evaluate(()=>window.companionMicRequests),1);
    assert.equal(companion.isClosed(),false,'Microphone activation must not dismiss the companion');
    assert.equal(await page.locator('[data-wb-speech-consent]').count(),0);
    const closed = companion.waitForEvent('close'); await companion.locator('[data-companion-back]').click(); await closed;
    await page.evaluate(() => { documentPictureInPicture.requestWindow = () => Promise.reject(new DOMException('Unavailable','NotAllowedError')); });
    await page.locator('[data-wb-min]').click(); await page.locator('.wb__mini-host').waitFor();
    await page.locator('.wb__mini-host [data-companion-ready]').click(); assert.equal(await page.locator('[data-wb-phase]').textContent(),'paused');
    await page.locator('.wb__mini-host').press('Escape'); assert.equal(await page.locator('.wb-modal').isVisible(),true); assert.equal(await page.locator('[data-wb-min]').evaluate(element=>element===document.activeElement),true);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard voice preparation is untimed and late recognition preserves the draft', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript(() => {
      window.SpeechRecognition = class { constructor() { window.testRecognition=this; } start() { window.recognitionStarts=(window.recognitionStarts||0)+1; } stop() { if (!window.speechEndMissing) this.onend?.(); } abort() { window.recognitionAborts=(window.recognitionAborts||0)+1; } };
      navigator.mediaDevices.getUserMedia = async () => { window.microphoneRequests=(window.microphoneRequests||0)+1; return {getTracks:()=>[{stop(){}}]}; };
      navigator.mediaDevices.getDisplayMedia = () => { throw new Error('Unexpected screen request'); };
    });
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-convo="voice"]').click(); await page.locator('[data-wb-deeper]').click(); await page.locator('.wb__own').fill('Voice test exercise'); await page.locator('[data-wb-start]').click();
    assert.equal(await page.locator('[data-wb-speech-consent],[data-wb-speech-allow],[data-wb-speech-cancel]').count(),0);
    await page.locator('[data-wb-mic]').click();
    await page.getByText('Microphone available. Session clock is stopped.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.microphoneRequests),1,'The first click directly requests browser permission');
    assert.match(await page.locator('#wb-speech-notice').textContent(),/may send audio/);
    assert.match(await page.locator('[data-wb-mic]').getAttribute('title'),/may send audio/);
    assert.equal(await page.evaluate(()=>window.recognitionStarts||0),0); assert.equal(await page.locator('[data-wb-timer-t]').textContent(),'60:00');
    await page.locator('[data-wb-spk]').click(); await page.locator('[data-wb-ready]').click(); await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===1&&!document.querySelector('[data-wb-send]').disabled);
    await page.locator('[data-wb-mic]').click(); await page.waitForFunction(()=>window.recognitionStarts===1);
    await page.evaluate(()=>{window.testRecognition.onresult({results:[Object.assign([{transcript:'Retain this spoken draft'}],{isFinal:true})]});window.testRecognition.onend();});
    assert.equal(await page.evaluate(()=>window.recognitionStarts),2); assert.equal(await page.locator('.wb__turn--you').count(),0);
    await page.evaluate(()=>{window.lateSpeechResult=window.testRecognition.onresult;});
    await page.locator('[data-wb-ready]').click(); await page.evaluate(()=>window.lateSpeechResult({results:[Object.assign([{transcript:'late unwanted result'}],{isFinal:true})]}));
    assert.equal(await page.locator('.wb__msg').inputValue(),'Retain this spoken draft');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].draft),'Retain this spoken draft');
    await page.locator('[data-wb-ready]').click(); await page.locator('[data-wb-mic]').click(); await page.locator('[data-wb-mic]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===2&&!document.querySelector('[data-wb-send]').disabled); assert.equal(await page.locator('.wb__turn--you').count(),1); assert.deepEqual(errors,[]);
    for (const finish of ['send','mic']) {
      await page.locator('[data-wb-mic]').click();
      await page.evaluate(()=>{
        window.speechEndMissing=true;window.deferWhiteboardReply=true;window.releaseWhiteboardReply=null;
        window.testRecognition.onresult({results:[Object.assign([{transcript:'Please clarify'}],{isFinal:true}),Object.assign([{transcript:'the question'}],{isFinal:false})]});
        window.lateSpeechResult=window.testRecognition.onresult;window.lateSpeechEnd=window.testRecognition.onend;
      });
      const before=await page.evaluate(()=>({turns:document.querySelectorAll('.wb__turn--you').length,calls:window.preparationCalls.length,starts:window.recognitionStarts}));
      await page.locator('[data-wb-'+finish+']').click();
      await page.waitForFunction(()=>!!window.releaseWhiteboardReply,null,{timeout:4000});
      assert.equal(await page.locator('[data-wb-mic].is-live').count(),0,'Recognition stops before waiting for the reply');
      assert.equal(await page.locator('.wb__turn--you').last().textContent().then(text=>text.includes('Please clarify the question')),true,'Final and latest interim words are submitted together');
      await page.evaluate(()=>{window.lateSpeechResult({results:[Object.assign([{transcript:'Unwanted late words'}],{isFinal:true})]});window.lateSpeechEnd();});
      assert.equal(await page.locator('.wb__msg').inputValue(),'');
      assert.equal(await page.locator('.wb__turn--you').count(),before.turns+1);
      assert.equal(await page.evaluate(()=>window.recognitionStarts),before.starts);
      assert.equal(await page.evaluate(()=>window.preparationCalls.length),before.calls+1);
      assert.match(await page.locator('[data-wb-send]').textContent(),/Replying/);
      assert.ok(await page.locator('.wb__composer-act').evaluate(element=>element.scrollWidth<=element.clientWidth));
      await page.screenshot({path:join(tmpdir(),'rk-whiteboard-restored-speech-handoff.png')});
      await page.evaluate(()=>{window.deferWhiteboardReply=false;window.releaseWhiteboardReply();});
      await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    }
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.releaseMicrophone=()=>resolve({getTracks:()=>[{stop(){}}]});});});
    await page.locator('[data-wb-mic]').click();
    await page.locator('.wb__msg').fill('Typed while microphone permission opens');
    await page.locator('[data-wb-send]').click();
    const starts=await page.evaluate(()=>window.recognitionStarts);
    await page.evaluate(()=>window.releaseMicrophone());
    await page.waitForFunction(()=>!document.querySelector('[data-wb-send]').disabled);
    assert.equal(await page.evaluate(()=>window.recognitionStarts),starts);
    assert.equal(await page.locator('[data-wb-mic].is-live').count(),0);
    await page.clock.install();
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]});});
    await page.locator('[data-wb-mic]').click();
    await page.evaluate(()=>window.testRecognition.onresult({results:[Object.assign([{transcript:'Retain this unfinished answer'}],{isFinal:true})]}));
    const paused=await page.evaluate(()=>({calls:window.preparationCalls.length,turns:document.querySelectorAll('.wb__turn--you').length}));
    await page.locator('[data-wb-mic]').click();
    await page.locator('[data-wb-ready]').click();
    await page.clock.runFor(1500);
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),paused.calls);
    assert.equal(await page.locator('.wb__turn--you').count(),paused.turns);
    assert.equal(await page.locator('.wb__msg').inputValue(),'Retain this unfinished answer');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('Prepare Whiteboard vision follows conversational turns without hidden automatic requests', {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.clock.install(); await installPrepareReplies(page);
    await page.route('https://api.anthropic.com/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:'session-model',input_modalities:['text','image'],output_modalities:['text'],max_input_tokens:100000,max_tokens:32000,capabilities:{thinking:{supported:true},structured_outputs:{supported:true}},pricing:{input:1,output:3}}]})}));
    await openIntegratedFixture(page);
    await page.evaluate(() => {
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const drawing=canvas.getContext('2d');drawing.fillStyle='#fff';drawing.fillRect(0,0,640,400);window.visionCanvas=canvas;
      navigator.mediaDevices.getDisplayMedia=async()=>{window.visionStream=canvas.captureStream(10);setInterval(()=>{drawing.fillRect(0,0,2,2);window.visionStream.getVideoTracks()[0].requestFrame?.();},100);return window.visionStream;};
      navigator.mediaDevices.getUserMedia=async options=>{
        if(options.audio)throw new Error('No physical audio in this synthetic vision test');
        const camera=document.createElement('canvas');camera.width=320;camera.height=180;const context=camera.getContext('2d');context.fillStyle='#00ff00';context.fillRect(0,0,320,180);
        const stream=camera.captureStream(10);setInterval(()=>{context.fillRect(0,0,2,2);stream.getVideoTracks()[0].requestFrame?.();},100);return stream;
      };
    });
    const outgoingImage=()=>page.evaluate(async()=>{
      const messages=JSON.parse(window.preparationCalls.at(-1).user);
      const part=messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(part=>part.type==='image');
      if(!part)throw new Error('No actual image bytes in the outgoing provider request');
      const image=new Image();image.src='data:'+part.source.media_type+';base64,'+part.source.data;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);
      return {width:image.naturalWidth,height:image.naturalHeight,pixel:[...context.getImageData(0,0,1,1).data]};
    });
    await page.locator('.adm__tab[data-tab="ai"]').click(); await page.locator('[data-act="prep-open"][data-tool="wb"]').click(); await page.locator('[data-wb-mode="mock"]').click(); await page.locator('[data-wb-deeper]').click(); await page.locator('.wb__own').fill('A synthetic board exercise'); await page.locator('[data-wb-start]').click();
    await page.locator('[data-wb-watch="screen"]').click(); await page.waitForFunction(()=>document.querySelector('.wb__feed-vid')?.videoWidth===640);
    await page.waitForFunction(()=>document.querySelector('.wb__watch-meta')?.textContent.includes('Screen images on each turn'));
    assert.equal(await page.locator('.wb__watch-options,[data-wb-glance],[data-wb-ai-source],[data-wb-record-source]').count(),0);
    assert.equal(await page.evaluate(()=>window.preparationCalls.length),0);
    await page.locator('[data-wb-ready]').click(); await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===1&&!document.querySelector('[data-wb-send]').disabled);
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[1,0]);
    const firstImage=await outgoingImage();assert.equal(firstImage.width,640);assert.ok(firstImage.pixel[0]>250);
    assert.match(await page.locator('[data-wb-latest]').textContent(),/unreadable/); assert.match(await page.locator('[data-wb-watch-bar]').textContent(),/Last analysis: unreadable/);
    await page.clock.fastForward(65000); assert.equal(await page.locator('.wb__turn--int').count(),1);
    const changeBoard=async color=>{await page.evaluate(color=>{const drawing=window.visionCanvas.getContext('2d');drawing.fillStyle=color;drawing.fillRect(0,0,640,400);window.visionStream.getVideoTracks()[0].requestFrame?.();},color);await page.locator('.wb__feed-vid').evaluate(video=>new Promise(resolve=>video.requestVideoFrameCallback(resolve)));};
    await whiteboardReply(page,'Please give me some quiet thinking time.',{reply:'Take your time.',action:'think'});
    await changeBoard('#000'); await page.clock.fastForward(65000); assert.equal(await page.locator('.wb__turn--int').count(),2);
    await whiteboardReply(page,'I am ready to discuss this board.');
    assert.ok((await outgoingImage()).pixel[0]<5,'The request contains the changed black board, not an earlier frame');
    await changeBoard('#fff'); await page.clock.fastForward(65000); assert.equal(await page.locator('.wb__turn--int').count(),3);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]); assert.equal(saved.autoLooks,0); assert.ok(saved.observations.every(observation=>observation.status==='unreadable')); assert.ok(saved.observations.every(observation=>!observation.b64&&!observation.image));
    await page.locator('[data-wb-watch="camera"]').click();await page.waitForFunction(()=>document.querySelector('[data-feed="camera"] video')?.videoWidth===320);
    assert.equal(await page.locator('[data-wb-preview="screen"]').getAttribute('aria-pressed'),'true','Starting a camera does not displace the screen');
    await page.evaluate(()=>{window.deferWhiteboardReply=true;window.releaseWhiteboardReply=null;});
    await page.locator('.wb__msg').fill('Discuss this screen snapshot.');await page.locator('[data-wb-send]').click();await page.waitForFunction(()=>!!window.releaseWhiteboardReply);
    assert.ok((await outgoingImage()).pixel[0]>250);
    await page.locator('[data-wb-preview="camera"]').click();
    assert.match(await page.locator('.wb__watch-meta').textContent(),/Camera images on each turn.*Not sent yet/);
    await page.evaluate(()=>{window.deferWhiteboardReply=false;window.releaseWhiteboardReply();});
    await page.waitForFunction(()=>document.querySelectorAll('.wb__turn--int').length===4&&!document.querySelector('[data-wb-send]').disabled);
    assert.doesNotMatch(await page.locator('.wb__watch-meta').textContent(),/Last analysis:/,'A late screen response is not attributed to the newly focused camera');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].observations.at(-1).source),'screen');
    await whiteboardReply(page,'Now discuss the camera.');
    const cameraImage=await outgoingImage();assert.equal(cameraImage.width,320);assert.ok(cameraImage.pixel[0]<5&&cameraImage.pixel[1]>250);
    await page.getByRole('button',{name:'Turn off camera',exact:true}).click();
    await whiteboardReply(page,'Return to the remaining screen.');
    assert.equal((await outgoingImage()).width,640);
    await page.evaluate(()=>{window.whiteboardReply={readability:'invalid'};});
    await page.locator('.wb__msg').fill('Do not silently replace a failed visual reply with text.'); await page.locator('[data-wb-send]').click();
    await page.locator('[data-wb-reply-retry]').waitFor();
    assert.match(await page.locator('.wb-modal .pass__err').textContent(),/omitted readability/);
    assert.deepEqual(await page.evaluate(()=>[window.preparationCalls.length,window.preparationPlanningCalls.length]),[7,0],'Failed vision must not trigger another paid text/coordinator call');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].observations.at(-1).status),'failed');
    await page.locator('[data-wb-ready]').click(); await page.clock.fastForward(65000); assert.equal(await page.locator('.wb__turn--int').count(),6);
    await page.evaluate(() => {
      const saved=JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0],id='board-'+(saved.observations.length+1);
      window.whiteboardScore={scores:[{dim:'Interaction / flow',score:5,note:'Unjustified visual rating',evidence:[id]}],overall:'Unreadable final board',topfix:'Zoom the board',improvements:[],boardReadability:'unreadable'};
    });
    await page.locator('[data-wb-score]').click();
    await page.getByText('Unreadable final board',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0].score.scores[0].score),null,'An unreadable final image cannot justify a numeric score');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test("Prepare saved answers preserve formatting without executable markup", {timeout:30000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await openIntegratedFixture(page);
    await page.evaluate(() => {
      const answer = '<p onclick=void(0)><strong>Supported answer</strong><br><em>Keep emphasis</em><img src="about:blank" onerror=void(0)></p><ul><li>Evidence</li></ul><a href="java&#x73;cript:void(0)">Link text</a><iframe srcdoc="sample"></iframe><svg onload=void(0)></svg>';
      localStorage.setItem('rk:prep:hist', JSON.stringify({iprep:[{id:'safe-interview',tool:'iprep',at:1,payload:{level:'staff',fromAi:true,questions:[{q:'A saved question',answer}]}}],story:[{id:'safe-story',tool:'story',at:1,payload:{tone:'staff',dur:'5',themes:[{title:'Saved angle'}],cur:{ti:0,title:'Saved angle',script:{opener:'Saved opening',beats:[]},questions:[{q:'A saved question',answer}]}}}]}));
    });
    await page.locator('.adm__tab[data-tab="ai"]').click();
    for (const [tool, history, selector] of [['iprep','safe-interview','.iprep__a'],['story','safe-story','.story__q-a']]) {
      await page.locator('[data-act="prep-open"][data-tool="'+tool+'"]').click();
      await page.locator('[data-'+tool+'-hist-open="'+history+'"]').click();
      if (tool === 'story') await page.locator('[data-story-view="questions"]').click();
      const answer = page.locator(selector).first();
      await answer.waitFor();
      assert.equal(await answer.locator('strong').innerText(), 'Supported answer');
      assert.equal(await answer.locator('em').innerText(), 'Keep emphasis');
      assert.equal(await answer.locator('li').innerText(), 'Evidence');
      assert.equal(await answer.locator('img,iframe,svg,script,style,a').count(), 0);
      assert.equal(await answer.locator('*').evaluateAll(elements => elements.some(element => [...element.attributes].some(attribute => /^on|href|src/i.test(attribute.name)))), false);
      await page.locator('.'+tool+'-modal [data-cancel]').click();
    }
  } finally { await browser.close(); }
});

for (const width of [1440, 390]) test("AI Options use case content and keep Back in the workbar at " + width + "px", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"}), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('api.anthropic.com')) requests.push(request.url()); });
  try {
    await openIntegratedFixture(page);
    await page.setViewportSize({width,height:1000});
    const original = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work));
    const rootToolbar = await assertStudioToolbar(page.locator('.adm > .adm__workbar'), {historyVisible:false});
    assert.equal(await page.locator('[data-l2-back]').isVisible(), false);
    await page.locator('[data-act="study-toggle"][data-index="1"]').click();
    await page.getByRole('tab',{name:'AI Options',exact:true}).click();
    const back = page.locator('[data-l2-back]');
    assert.equal(await page.locator('[data-l2-back]').count(), 1);
    assert.equal(await back.evaluate(element => !!element.closest('.adm__workbar')), true);
    const separator = await back.evaluate(element => { const style = getComputedStyle(element, '::after'); return {width:style.width,height:style.height,pointerEvents:style.pointerEvents,content:style.content}; });
    assert.deepEqual(separator, {width:'1px',height:'18px',pointerEvents:'none',content:'""'});
    assert.equal(await page.locator('.adm__l2-bar').isVisible(), false);
    const controls = page.locator('[data-case-ai-slides] button,[data-case-ai-prepare] button');
    assert.equal(await controls.count(), 4);
    assert.ok(await controls.evaluateAll(buttons => buttons.every(button => button.disabled)));
    await page.waitForFunction(()=>!document.querySelector('[data-act="csgen-run"]').disabled);
    assert.equal(await page.getByRole('button',{name:'Draft case study',exact:true}).isEnabled(), true);
    await page.screenshot({path:join(tmpdir(), `rk-ai-options-empty-${width}.png`)});
    await page.locator('[data-case-ai-prepare]').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(tmpdir(), `rk-ai-options-empty-actions-${width}.png`)});
    await back.click();
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.getByRole('tab',{name:'AI Options',exact:true}).click();
    assert.ok(await controls.evaluateAll(buttons => buttons.every(button => !button.disabled)));
    const geometry = await page.evaluate(() => {
      const back = document.querySelector('[data-l2-back]').getBoundingClientRect(), undo = document.querySelector('.adm__hist [data-undo]').getBoundingClientRect();
      return {back:back.toJSON(),undo:undo.toJSON(),overflow:document.documentElement.scrollWidth > innerWidth};
    });
    assert.equal(geometry.back.height, 34);
    assert.ok(geometry.back.right <= geometry.undo.left && Math.abs(geometry.back.y - geometry.undo.y) < 1);
    assert.equal(geometry.overflow, false);
    const caseToolbar = await assertStudioToolbar(page.locator('.adm > .adm__workbar'));
    assert.equal(caseToolbar.history.x,rootToolbar.history.x,'Opening a case must not move Undo/Redo');
    await page.screenshot({path:join(tmpdir(), `rk-ai-options-ready-${width}.png`)});
    await page.locator('[data-case-ai-prepare]').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(tmpdir(), `rk-ai-options-ready-actions-${width}.png`)});
    for (const [action, selector] of [['fbrev','.fbrev-modal'],['iprep','.iprep-modal'],['story','.story-modal']]) {
      await page.locator('[data-act="case-ai-prepare"][data-prepare="'+action+'"]').click();
      await page.locator(selector).waitFor();
      if (action === 'iprep') {
        assert.equal(await page.locator(selector+' .pass__title').innerText(),'Interview prep');
        const project = page.locator(selector+' .prep-workspace__project');
        assert.equal(await project.innerText(),'Integrated project');
        assert.equal(await project.isVisible(),true);
        const bounds = await project.boundingBox();
        assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.equal(await page.getByRole('button',{name:'Close',exact:true}).isVisible(),true);
      } else if (action === 'story') assert.match(await page.locator(selector+' .pass__title').innerText(), /Integrated project/);
      await page.locator(selector+' '+(action === 'fbrev' ? '[data-cancel]' : '[data-prep-launch-close]')).click();
      await page.locator(selector).waitFor({state:'detached'});
    }
    assert.equal(requests.length, 0, 'Opening preparation tools must not start generation');
    await page.locator('[data-l2tab="slides"]').click();
    await page.locator('.merge-empty-actions').waitFor();
    const slideGeometry = await page.evaluate(() => {
      const back = document.querySelector('[data-l2-back]').getBoundingClientRect(), history = document.querySelector('[data-native-slide-history]').getBoundingClientRect(), main = document.querySelector('.adm__main').getBoundingClientRect(), preview = document.querySelector('.adm__preview').getBoundingClientRect();
      return {ordered:back.right <= history.left, aligned:Math.abs(back.y-history.y)<2, fullCanvas:Math.abs(main.top-preview.top)<1};
    });
    assert.deepEqual(slideGeometry,{ordered:true,aligned:true,fullCanvas:true});
    await page.locator('[data-native-slide-history] button').first().waitFor();
    const slidesToolbar = await assertStudioToolbar(page.locator('.adm > .adm__workbar'));
    assert.equal(slidesToolbar.history.x,caseToolbar.history.x,'Native deck history stays in the shared history slot');
    assert.equal(await page.locator('[data-native-slide-toolbar] .merge-history-buttons').count(),0);
    assert.equal(await page.locator('[data-native-slide-history]').evaluate(element=>!!(element.compareDocumentPosition(document.querySelector('[data-l2tabs]'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'History precedes project tabs in keyboard order');
    assert.deepEqual(await back.evaluate(element => { const style = getComputedStyle(element, '::after'); return {width:style.width,height:style.height,pointerEvents:style.pointerEvents,content:style.content}; }), separator);
    await back.click();
    await page.locator('.merge-shell').waitFor({state:'detached'});
    assert.equal(await back.isVisible(), false);
    await assertStudioToolbar(page.locator('.adm > .adm__workbar'), {historyVisible:false});
    assert.equal(await page.locator('[data-native-slide-history] button').count(),0,'Disposed native controls must not remain active');
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work)), original);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

for (const width of [1440, 390]) test("shared status bar keeps independent case-study and slide locks at " + width + "px", { timeout:60000 }, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless:true});
  const page = await browser.newPage({viewport:{width:1440, height:1000}}), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const footerStyle = () => page.locator(".adm__statusbar").evaluate(element => {
    const style = getComputedStyle(element);
    return Object.fromEntries(["height", "padding", "gap", "backgroundColor", "borderTop", "fontFamily"].map(key => [key, style[key]]));
  });
  const lockStyle = selector => page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element), icon = getComputedStyle(element.querySelector("svg"));
    return {...Object.fromEntries(["width", "height", "padding", "borderRadius", "borderWidth", "backgroundColor", "color"].map(key => [key, style[key]])), iconWidth:icon.width, iconHeight:icon.height};
  });
  const sharedControlsIntact = async () => {
    assert.equal(await page.evaluate(() => window.footerControls.every(element => element.isConnected && element.getClientRects().length && getComputedStyle(element).display !== "none")), true);
    assert.equal(await page.locator('.adm__statusbar [data-act="logs-rec"]').count(), 1);
    assert.equal(await page.locator(".adm__statusbar .merge-slide-position,.adm__statusbar .merge-save-status,.adm__statusbar .merge-bar-record").count(), 0);
  };
  try {
    await openIntegratedFixture(page);
    await page.setViewportSize({width, height:1000});
    assert.equal(await page.locator('.workcard [data-act="work-hidden"]').count(), 0);
    assert.equal(await page.locator('.adm__statusbar summary').count(), 0);
    await page.evaluate(() => { window.footerControls = [".adm__statusbar .adm__status", "[data-draftmeter]", ".adm__logs-btn", "[data-ai-session-toggle]"].map(selector => document.querySelector(selector)); });
    const baseline = await footerStyle();
    assert.equal(baseline.height, "32px");
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    const caseLock = page.locator(".adm__case-visibility summary");
    await caseLock.waitFor();
    assert.equal(await caseLock.getAttribute("aria-label"), "Case study visibility: public draft");
    await assertOpenShackle(caseLock.locator('svg'));
    assert.deepEqual(await footerStyle(), baseline);
    await sharedControlsIntact();
    const caseStyle = await lockStyle(".adm__case-visibility summary");
    await page.screenshot({path:join(tmpdir(), `rk-case-status-${width}.png`)});
    await caseLock.click();
    const menu = page.locator(".adm__case-visibility [popover]");
    await menu.waitFor({state:"visible"});
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0);
    await page.screenshot({path:join(tmpdir(), `rk-case-visibility-${width}.png`)});
    await page.keyboard.press("Escape");
    assert.equal(await caseLock.evaluate(element => element === document.activeElement), true);
    await caseLock.click();
    await page.getByRole("checkbox", {name:"Private case study", exact:true}).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].hidden === true);
    assert.equal(await caseLock.getAttribute("aria-label"), "Case study visibility: private draft");
    await page.locator('[data-l2tab="details"]').click();
    assert.equal(await caseLock.getAttribute("aria-label"), "Case study visibility: private draft");
    await page.locator('[data-l2-back]').click();
    assert.equal(await page.locator('.adm__statusbar summary').count(), 0);
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    assert.equal(await caseLock.getAttribute("aria-label"), "Case study visibility: private draft");
    await page.locator('[data-act="logs-rec"]').click();
    assert.equal(await page.locator('[data-act="logs-rec"]').getAttribute("aria-pressed"), "true");
    await page.locator('[data-l2tab="slides"]').click();
    await page.locator('.merge-empty-actions').waitFor();
    const slideLock = page.locator('[data-native-slide-status] .merge-visibility summary');
    const assertSlideIcon = async locked => {
      const actual = await slideLock.evaluate(element => {
        const svg = element.querySelector('svg'), body = svg.querySelector('rect');
        return {color:getComputedStyle(svg).color, fill:getComputedStyle(body).fill, accent:getComputedStyle(element).getPropertyValue('--accent').trim(), neutral:getComputedStyle(element).color};
      });
      if (locked) {
        const accent = await page.evaluate(value => { const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, actual.accent);
        assert.equal(actual.color, accent);
        assert.equal(actual.fill, accent);
      } else {
        assert.equal(actual.color, actual.neutral);
        assert.equal(actual.fill, 'none');
        await assertOpenShackle(slideLock.locator('svg'));
      }
    };
    await slideLock.waitFor();
    await assertSlideIcon(true);
    assert.match(await slideLock.getAttribute("aria-label"), /owner-only draft/);
    assert.equal(await slideLock.locator(".lucide-lock").count(), 1);
    assert.deepEqual(await footerStyle(), baseline);
    assert.deepEqual(await lockStyle('[data-native-slide-status] .merge-visibility summary'), caseStyle);
    await sharedControlsIntact();
    assert.equal(await page.locator('[data-act="logs-rec"]').getAttribute("aria-pressed"), "true");
    await page.getByRole("button", {name:"Add blank", exact:true}).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount === 1 && document.querySelector('[data-native-slide-status] summary')?.getAttribute('aria-disabled') !== 'true');
    await slideLock.click();
    await page.getByRole("checkbox", {name:"Public slideshow", exact:true}).click();
    await page.getByRole("button", {name:"Cancel", exact:true}).click();
    assert.equal(await slideLock.locator(".lucide-lock").count(), 1);
    await assertSlideIcon(true);
    await slideLock.click();
    await page.getByRole("checkbox", {name:"Public slideshow", exact:true}).click();
    await page.getByRole("button", {name:"Set public draft", exact:true}).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === true);
    assert.equal(await slideLock.locator(".lucide-lock-open").count(), 1);
    await assertSlideIcon(false);
    await page.screenshot({path:join(tmpdir(), `rk-slides-unlocked-${width}.png`)});
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].hidden), true);
    await slideLock.click();
    await page.getByRole("checkbox", {name:"Public slideshow", exact:true}).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === false);
    await assertSlideIcon(true);
    await page.keyboard.press("Escape");
    await page.locator('[data-act="logs-rec"]').click();
    assert.equal(await page.locator('[data-act="logs-rec"]').getAttribute("aria-pressed"), "false");
    await page.locator('.pass:visible').last().getByRole("button", {name:"Close", exact:true}).click();
    await page.screenshot({path:join(tmpdir(), `rk-slides-status-${width}.png`)});
    await page.locator('[data-l2tab="story"]').click();
    assert.equal(await caseLock.getAttribute("aria-label"), "Case study visibility: private draft");
    await caseLock.click();
    await page.getByRole("checkbox", {name:"Private case study", exact:true}).click();
    assert.equal(await caseLock.getAttribute("aria-label"), "Case study visibility: public draft");
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.slidesPublic), false);
    assert.deepEqual(await footerStyle(), baseline);
    await sharedControlsIntact();
    await page.locator('[data-l2-back]').click();
    await page.locator('[data-act="feature"][data-index="0"]').click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].featured === true);
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('.merge-shell').waitFor();
    await page.locator('[data-l2tab="story"]').click();
    await caseLock.click();
    assert.equal(await page.getByRole("checkbox", {name:"Private case study", exact:true}).isDisabled(), true);
    assert.match(await menu.innerText(), /Remove from the homepage/);
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].hidden), false);
    await page.keyboard.press("Escape");
    await page.locator('[data-l2-back]').click();
    await page.locator('.adm__tab[data-tab="landing"]').click();
    assert.equal(await page.locator('.adm__statusbar summary').count(), 0);
    assert.deepEqual(await footerStyle(), baseline);
    await sharedControlsIntact();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

for (const width of [1440, 390]) test("integrated project tabs and draft visitor previews at " + width + "px", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, ignoreDefaultArgs:["--disable-popup-blocking"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const published = await openIntegratedFixture(page);
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator('[data-act="study-preview"][data-index="1"]').count(), 0);
    assert.equal(await page.locator('[data-act="study-slideshow-preview"]').count(), 0);
    await page.locator('[data-act="study-toggle"][data-index="1"]').click();
    assert.equal(await page.locator('[data-l2tab="details"]').getAttribute("aria-selected"), "true");
    await page.locator('[data-l2-back]').click();
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    assert.equal(await page.locator('[data-l2tab="story"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator('.adm__workbar [role="tab"]').count(), 5);
    assert.equal(await page.locator('.adm__l2-bar [data-l2tabs]').count(), 0);
    await page.locator('[data-l2tab="story"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('.merge-empty-actions').waitFor();
    const activeTab = await page.locator('[data-l2tab="slides"]').evaluate(element => { const rect = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect(); return { left: rect.left, right: rect.right, parentLeft: parent.left, parentRight: parent.right, focused: element === document.activeElement }; });
    assert.ok(activeTab.left >= activeTab.parentLeft - 1 && activeTab.right <= activeTab.parentRight + 1);
    assert.equal(activeTab.focused, true);
    await page.getByRole('button', { name: 'Add blank', exact: true }).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount === 1);
    await page.locator('.merge-shell canvas.excalidraw__canvas.interactive').dblclick();
    await page.keyboard.type('Draft audience heading');
    await page.keyboard.press('Escape');
    if (!await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).isVisible()) await page.getByRole('button', { name: 'Speaker notes panel', exact: true }).click();
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('PRIVATE VISITOR NOTES');
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).blur();
    assert.equal(await page.locator('[data-l2tab="slides"]').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Open slideshow in a new tab', exact: true }).isVisible(), true);
    const controlOrder = await page.locator('[data-native-slide-toolbar] .merge-bar-views').evaluate(element => [...element.children].map(control => control.getBoundingClientRect().x));
    assert.deepEqual(controlOrder, [...controlOrder].sort((first, second) => first - second));
    assert.equal(await page.locator('[data-native-slide-toolbar] .merge-bar-play .lucide-play').count(), 1);
    await page.locator('.merge-host-slideview summary').click();
    const menuStyle = await page.evaluate(() => {
      const styles = selector => { const element = document.querySelector(selector), style = getComputedStyle(element); return Object.fromEntries(['backgroundColor','borderColor','borderRadius','padding','boxShadow'].map(key => [key, style[key]])); };
      const bounds = document.querySelector('.merge-host-slideview .merge-tool-pop').getBoundingClientRect();
      return { shared:styles('[data-dev-wrap] .adm__dev-pop'), hosted:styles('.merge-host-slideview .merge-tool-pop'), fits:bounds.x >= 0 && bounds.right <= innerWidth && bounds.y >= 0 && bounds.bottom <= innerHeight };
    });
    assert.deepEqual(menuStyle.hosted, menuStyle.shared);
    assert.equal(menuStyle.fits, true);
    assert.equal(await page.getByRole('menuitemradio', {name:'Current slide', exact:true}).getAttribute('aria-checked'), 'true');
    await page.screenshot({path:join(tmpdir(), `rk-hosted-slide-menu-${width}.png`)});
    await page.getByRole('menuitemradio', { name: 'All slides', exact: true }).click();
    await page.locator('.merge-all-slides').waitFor();
    await page.locator('.merge-host-slideview summary').press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio' && document.activeElement.textContent === 'All slides');
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('menuitemradio', { name:'Current slide', exact:true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.locator('.merge-host-slideview summary').press('ArrowDown');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.merge-host-slideview summary').evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('.merge-host-slideview details').getAttribute('open'), null);
    await page.getByRole('button', { name: 'Editing on', exact: true }).click();
    assert.equal(await page.locator('.merge-shell').getAttribute('data-editing'), 'false');
    await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
    await page.locator('[data-l2tab="story"]').click();
    await page.locator('.merge-shell').waitFor({ state: 'detached' });
    await page.evaluate(() => window.__rkDevEdit('work.0.study.blocks.0.heading', 'Current private draft heading'));
    await page.locator('[data-l2-back]').click();
    assert.equal(await page.locator('[data-act="study-slideshow-preview"][data-index="0"]').count(), 1);
    assert.equal(await page.locator('[data-act="study-slideshow-preview"][data-index="0"]').evaluate(element => element.tagName), 'BUTTON');
    const previewOpened = context.waitForEvent('page');
    await page.locator('[data-act="study-preview"][data-index="0"]').click();
    const preview = await previewOpened;
    await preview.waitForURL(/draft=1/);
    await preview.waitForFunction(() => !!window.RK?.draftPreview && !!document.querySelector('.pj.is-open'));
    assert.equal(await preview.locator('.adm.is-open').count(), 0);
    await preview.locator('.pj.is-open').getByRole('heading', { name: /Current Private Draft Heading/i }).waitFor({ state: 'visible' });
    assert.match(await preview.locator('.pj.is-open').innerText(), /Current Private Draft Heading/i);
    await preview.close();
    const slideshowOpened = context.waitForEvent('page');
    await page.locator('[data-act="study-slideshow-preview"][data-index="0"]').click();
    const slideshow = await slideshowOpened;
    await slideshow.waitForURL(/slideshow=1/);
    await slideshow.locator('.pjp').waitFor({ state: 'visible' });
    assert.equal(await slideshow.locator('.merge-shell,.adm.is-open').count(), 0);
    assert.doesNotMatch(await slideshow.locator('.pjp').textContent(), /PRIVATE VISITOR NOTES/);
    await slideshow.waitForFunction(() => document.querySelector('.pjp--popped') || document.querySelector('[data-pjp="popout"]')?.title === 'Open floating DJ pad (P)');
    assert.match(slideshow.url(), /presenter=tab/);
    const cardToggle = slideshow.getByRole('button', {name:'Toggle DJ pad', exact:true});
    let cardPad = context.pages().find(candidate => candidate !== page && candidate !== slideshow);
    if (!cardPad) {
      const cardFloating = context.waitForEvent('page');
      await cardToggle.click();
      cardPad = await cardFloating;
    }
    await cardPad.locator('[data-pp-notes]').waitFor();
    assert.equal(await cardPad.locator('[data-pp-notes]').innerText(), 'PRIVATE VISITOR NOTES');
    assert.equal(await cardPad.locator('html').getAttribute('data-presenter-window'), 'always-on-top');
    assert.equal(await slideshow.evaluate(() => window.opener), null);
    const cardEnded = slideshow.waitForEvent('close');
    await cardPad.getByRole('button', {name:'End presentation', exact:true}).click().catch(error => {
      if (!cardPad.isClosed() || !/Target page, context or browser has been closed/.test(error.message)) throw error;
    });
    await cardEnded;
    await page.waitForFunction(() => document.activeElement?.matches('[data-act="study-slideshow-preview"]'));
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('.merge-shell').waitFor();
    assert.equal(await page.locator('[data-l2tab="slides"]').getAttribute('aria-selected'), 'true');
    const toolbarOpened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Open slideshow in a new tab', exact: true }).click();
    const toolbarPreview = await toolbarOpened;
    await toolbarPreview.setViewportSize({width, height:1000});
    await toolbarPreview.waitForURL(/slideshow=1/);
    await toolbarPreview.locator('.pjp').waitFor({ state: 'visible' });
    await toolbarPreview.waitForFunction(()=>document.querySelector('.pjp--popped') || document.querySelector('[data-pjp="popout"]')?.title === 'Open floating DJ pad (P)');
    await context.unrouteAll({behavior:'wait'});
    assert.equal(await page.locator('.pjp-tab').count(), 0);
    assert.equal(await page.locator('.merge-shell').isVisible(), true);
    const djToggle = toolbarPreview.getByRole('button',{name:'Toggle DJ pad',exact:true});
    let pad = context.pages().find(candidate=>candidate !== page && candidate !== toolbarPreview);
    if (!pad) {
      assert.equal(await djToggle.getAttribute('aria-pressed'),'false');
      const floatingOpened = context.waitForEvent('page');
      await djToggle.click();
      pad = await floatingOpened;
    }
    await pad.locator('[data-pp-notes]').waitFor();
    assert.equal(await pad.locator('html').getAttribute('data-presenter-window'),'always-on-top');
    assert.equal(await djToggle.getAttribute('aria-pressed'),'true');
    const floatingClosed = pad.waitForEvent('close');
    await djToggle.click();
    await floatingClosed;
    assert.equal(await toolbarPreview.locator('.pjp').isVisible(),true);
    const floatingReopened = context.waitForEvent('page');
    await djToggle.click();
    pad = await floatingReopened;
    await pad.locator('[data-pp-notes]').waitFor();
    const djBounds = await djToggle.boundingBox(), exitBounds = await toolbarPreview.getByRole('button',{name:'Exit presentation',exact:true}).boundingBox();
    assert.ok(djBounds.x < width/2 && exitBounds.x > width/2);
    assert.equal(await toolbarPreview.evaluate(() => window.opener), null);
    assert.equal(await toolbarPreview.locator('[data-pjp-notes]').textContent(), '');
    assert.doesNotMatch(await toolbarPreview.locator('body').innerText(), /PRIVATE VISITOR NOTES/);
    assert.equal(await pad.locator('[data-pp-notes]').innerText(), 'PRIVATE VISITOR NOTES');
    assert.equal(await page.locator('.merge-shell').count(), 1);
    await pad.locator('[data-pp-now] svg').first().waitFor({state:'attached'});
    await pad.locator('[data-pp-now] svg').getByText('Draft audience heading', {exact:true}).waitFor({state:'attached'});
    const background = await toolbarPreview.evaluate(() => ({appearance:document.documentElement.dataset.appearance, color:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()}));
    assert.equal(background.appearance, 'dark');
    assert.equal(background.color, await page.locator('.adm').evaluate(element => getComputedStyle(element).getPropertyValue('--bg').trim()));
    const padBounds = await pad.locator('.pp').evaluate(element => { const rect = element.getBoundingClientRect(); return {width:rect.width, viewport:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth}; });
    assert.equal(padBounds.overflow, false);
    assert.ok(Math.abs(padBounds.width - padBounds.viewport) < 1);
    await pad.setViewportSize({width:width === 390 ? 390 : 1060,height:800});
    await pad.waitForFunction(()=>{
      const host=document.querySelector('[data-pp-now] .merge-section-thumbnail');
      const scene=host?.querySelector('.merge-section-thumbnail-scene');
      return host?.clientWidth > 100 && Math.abs(scene.getBoundingClientRect().width-host.clientWidth) < 2;
    },null,{timeout:4000}).catch(async error=>{
      const geometry=await pad.evaluate(()=>Array.from(document.querySelectorAll('[data-pp-now], [data-pp-thumbnail], .merge-present-thumbnail, .merge-section-thumbnail, .merge-section-thumbnail-scene')).map(element=>({name:element.className,bounds:element.getBoundingClientRect().toJSON(),display:getComputedStyle(element).display,transform:getComputedStyle(element).transform,visibility:getComputedStyle(element).visibility})));
      const styles=await pad.evaluate(()=>Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(link=>({href:link.href,loaded:!!link.sheet,disabled:link.disabled})));
      throw new Error(JSON.stringify({geometry,styles}),{cause:error});
    });
    await pad.screenshot({path:join(tmpdir(), `rk-floating-dj-${width}.png`)});
    assert.ok(await toolbarPreview.locator('.pjp canvas').evaluateAll(canvases => canvases.some(canvas => { const context = canvas.getContext('2d'); return context && canvas.width && canvas.height && context.getImageData(0,0,canvas.width,canvas.height).data.some((value,index) => index % 4 === 3 && value); })));
    const audienceBounds = await toolbarPreview.locator('.merge-present-stage').boundingBox();
    assert.ok(audienceBounds.width > 250 && audienceBounds.x >= 0 && audienceBounds.x + audienceBounds.width <= width + 1);
    await toolbarPreview.screenshot({path:join(tmpdir(), `rk-new-tab-audience-${width}.png`)});
    await pad.locator('[data-pp-notes]').fill('PRIVATE DJ EDIT');
    await pad.locator('[data-pp-save]').getByText('Saved to deck', { exact:true }).waitFor();
    assert.equal(await toolbarPreview.locator('[data-pjp-notes]').textContent(), '');
    const ended = toolbarPreview.waitForEvent('close');
    await pad.getByRole('button', { name:'End presentation', exact:true }).click();
    await ended;
    await page.locator('.pjp-tab').waitFor({ state:'detached' });
    assert.equal(toolbarPreview.isClosed(), true);
    await page.waitForFunction(() => document.activeElement?.matches('.merge-bar-play'));
    assert.equal(await page.getByRole('button', { name:'Open slideshow in a new tab', exact:true }).evaluate(element => element === document.activeElement), true);
    if (!await page.getByRole('textbox', { name:'Speaker notes', exact:true }).isVisible()) await page.getByRole('button', { name:'Speaker notes panel', exact:true }).click();
    assert.equal(await page.getByRole('textbox', { name:'Speaker notes', exact:true }).innerText(), 'PRIVATE DJ EDIT');
    const reopened = context.waitForEvent('page');
    await page.getByRole('button', { name:'Open slideshow in a new tab', exact:true }).click();
    const closingAudience = await reopened;
    await closingAudience.locator('.pjp').waitFor();
    await closingAudience.close();
    await page.locator('.pjp-tab').waitFor({ state:'detached' });
    const state = await page.evaluate(() => ({ study: window.__RKStudio.getDraft().work[0].study, counter: document.querySelector('[data-ai-session-toggle]').getBoundingClientRect().toJSON(), width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(state.study.slidesPublic, false);
    assert.equal(state.study.nativeDeck.slideCount, 1);
    assert.equal(state.study.blocks[0].body, published.work[0].study.blocks[0].body);
    assert.ok(state.counter.width > 0 && state.counter.right <= state.width && state.counter.left >= 0);
    assert.equal(state.overflow, false);
    await page.screenshot({ path: join(tmpdir(), 'rk-integrated-tabs-' + width + '.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("AI session drawer streams across tabs, survives refresh and resets on explicit exit", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args:['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion:"no-preference" }), page = await context.newPage();
  const assertIdleSparkle = async () => {
    await page.waitForFunction(expected => {
      const path = document.querySelector('.adm__ai-spark path'), turn = document.querySelector('.adm__ai-spark g');
      return path.getAttribute('d') === expected && (!turn.getAttribute('transform') || turn.getAttribute('transform') === 'rotate(0.0000 12 12)');
    },HYBRID_REST_PATH);
    const rest = await page.locator('.adm__ai-spark svg').evaluate(svg => {
      const paths = [...svg.querySelectorAll('path')], style = getComputedStyle(paths[0]);
      const bounds=paths[0].getBBox();
      return {outline:style.d,width:bounds.width,height:bounds.height,visible:svg.getClientRects().length>0,visiblePaths:paths.filter(path => getComputedStyle(path).display !== 'none' && Number(getComputedStyle(path).opacity)>0).length,fill:style.fill,stroke:style.stroke,strokeWidth:style.strokeWidth,transform:style.transform,rotation:getComputedStyle(svg.querySelector('.adm__ai-ribbon-turn')).transform,animations:svg.getAnimations({subtree:true}).length};
    });
    assert.equal(rest.visible,true);
    assert.equal(rest.visiblePaths, 1);
    assert.ok(Math.abs(rest.width-16.4)<.001 && Math.abs(rest.height-8.2)<.001,'Rest is the approved horizontal infinity');
    assert.equal((rest.outline.match(/M/g) || []).length,1);
    assert.equal(rest.fill,'none');
    assert.notEqual(rest.stroke,'none');
    assert.equal(rest.strokeWidth,'1.7px');
    assert.equal(rest.transform, 'none');
    assert.ok(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(rest.rotation));
    assert.equal(rest.animations, 0);
    return rest.outline;
  };
  const assertRibbonColorFade = async () => {
    const fades = await page.locator('[data-ai-session-toggle]').evaluate(async trigger => {
      const icon = trigger.querySelector('.adm__ai-spark'), path = icon.querySelector('path'), initialExpanded = trigger.getAttribute('aria-expanded'), results = [];
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      for (const expanded of ['false','true']) {
        trigger.setAttribute('aria-expanded',expanded);
        getComputedStyle(icon).color;
        icon.getAnimations().forEach(animation => animation.finish());
        await frame();
        const neutral = getComputedStyle(path).stroke;
        for (const phase of ['working','idle']) {
          trigger.dataset.aiState = phase;
          getComputedStyle(icon).color;
          const fade = icon.getAnimations().find(animation => animation.transitionProperty === 'color');
          if (!fade) throw new Error('The ribbon must fade its color when entering ' + phase);
          const duration = fade.effect.getTiming().duration;
          fade.pause();
          const colors = [0,.25,.5,.75,1].map(progress => { fade.currentTime = progress * duration; return getComputedStyle(path).stroke; });
          results.push({expanded,phase,duration,colors,neutral,opacity:getComputedStyle(icon).opacity,easing:getComputedStyle(icon).transitionTimingFunction});
          fade.finish();
          await frame();
        }
      }
      trigger.setAttribute('aria-expanded',initialExpanded);
      getComputedStyle(icon).color;
      icon.getAnimations().forEach(animation => animation.finish());
      return results;
    });
    for (const fade of fades) {
      assert.equal(fade.duration,400);
      assert.equal(new Set(fade.colors).size,5,'Gold and neutral need intermediate stroke colors, not an abrupt switch');
      assert.equal(fade.opacity,'1','Color fading must not blink or fade out the ribbon itself');
      assert.equal(fade.easing,'cubic-bezier(0.4, 0, 0.6, 1)');
      assert.equal(fade.phase === 'working' ? fade.colors[0] : fade.colors.at(-1),fade.neutral);
    }
    for (const expanded of ['false','true']) {
      const pair = fades.filter(fade => fade.expanded === expanded);
      assert.equal(pair[0].colors.at(-1),pair[1].colors[0],'Fade-out must start at the same gold reached by fade-in');
    }
  };
  const waitForTrail = thought => page.waitForFunction(expected => {
    const canvas=document.querySelector('.adm__ai-spark canvas');
    if (!canvas || canvas.hidden) return false;
    const gl=canvas.getContext('webgl2'), program=gl?.getParameter(gl.CURRENT_PROGRAM);
    return !!program && gl.getUniform(program,gl.getUniformLocation(program,'uThought'))===expected;
  },thought);
  const sampleMorph = () => page.locator('.adm__ai-spark svg').evaluate(async svg => {
    const path = svg.querySelector('path'), turn = svg.querySelector('.adm__ai-ribbon-turn'), frames = [];
    for (let index = 0; index < 6; index++) {
      await new Promise(resolve => { const until = performance.now() + 200; const next = now => now >= until ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next); });
      const canvas=svg.parentElement.querySelector('canvas'), box=canvas.getBoundingClientRect(), counter=svg.closest('button').getBoundingClientRect(), style=getComputedStyle(path);
      const length=path.getTotalLength(), stroke=parseFloat(style.strokeWidth)*box.width/48;
      const angle=Number(turn.getAttribute('transform').match(/rotate\(([-\d.]+)/)[1])*Math.PI/180;
      const points=Array.from({length:193},(_,index)=>{
        const point=path.getPointAtLength(length*index/192),x=point.x-12,y=point.y-12;
        return {x:box.left+(12+x*Math.cos(angle)-y*Math.sin(angle))*box.width/24,y:box.top+(12+x*Math.sin(angle)+y*Math.cos(angle))*box.height/24};
      });
      const gl=canvas.getContext('webgl2'), program=gl.getParameter(gl.CURRENT_PROGRAM);
      const uniform=name=>gl.getUniform(program,gl.getUniformLocation(program,name));
      frames.push({outline:style.d,length,fill:style.fill,stroke:style.stroke,strokeWidth:style.strokeWidth,opacity:style.opacity,transform:style.transform,rotation:turn.getAttribute('transform'),thought:uniform('uThought'),span:uniform('uSpan'),blending:gl.isEnabled(gl.BLEND),renderer:svg.closest('button').dataset.aiRenderer,visibleSurfaces:[...svg.parentElement.querySelectorAll('svg,canvas')].filter(element=>element.getClientRects().length>0).length,icon:[box.width,box.height],counter:[counter.width,counter.height],contained:points.every(point=>point.x-stroke>=box.left&&point.x+stroke<=box.right&&point.y-stroke>=box.top&&point.y+stroke<=box.bottom)});
    }
    return {frames};
  });
  try {
    await page.addInitScript(() => {
      const fetchOriginal = window.fetch;
      window.fetch = async (resource, options = {}) => {
        const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href);
        if (url.hostname !== 'api.anthropic.com' || !url.pathname.endsWith('/messages')) return fetchOriginal(resource, options);
        const body = JSON.parse(options.body);
        if (body.system.startsWith("You are Studio's outcome coordinator.")) {
          const input = JSON.parse(body.messages[0].content), decision = input.candidate ? { action: 'finish', summary: 'Completed text improvement' } : { action: 'draft', modelRef: input.draftModels[0], task: 'writing', instruction: '', inputs: [], summary: 'Improving the selected text' };
          return Response.json({ content: [{ type: 'text', text: JSON.stringify({ decision }) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
        }
        return new Response(new ReadableStream({ start(controller) {
          const send = event => controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n'));
          send({ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 20 } } });
          window.__sessionStream = {
            answer() { send({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'PRIVATE REASONING' } }); send({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Refined private ' } }); },
            finish() { send({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer.' } }); send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }); send({ type: 'message_stop' }); controller.close(); }
          };
          options.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Cancelled', 'AbortError')); } catch {} }, { once: true });
        } }), { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    await openIntegratedFixture(page);
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await assertRibbonColorFade();
    const idleOutline = await assertIdleSparkle();
    const assertStaticAiIcons = async () => {
      const icons = await page.locator('.ai-ribbon').evaluateAll(icons => icons.filter(icon => !icon.closest('[data-ai-session-toggle]')).map(icon => ({path: getComputedStyle(icon.querySelector('path')).d, stroke: getComputedStyle(icon.querySelector('path')).strokeWidth, animations: icon.getAnimations({subtree:true}).length})));
      assert.ok(icons.length > 0, 'Studio AI actions use the shared rest mark');
      for (const icon of icons) { assert.equal(icon.path, idleOutline); assert.equal(icon.stroke, '1.7px'); assert.equal(icon.animations, 0); }
    };
    await assertStaticAiIcons();
    await page.locator('[data-ai-session-toggle]').click();
    await page.evaluate(() => { window.__sessionResult = null; window.__RKStudio.improveText('Private input copy', {}).then(text => { window.__sessionResult = text; }, error => { window.__sessionResult = error.message; }); });
    await page.waitForFunction(() => !!window.__sessionStream);
    await page.waitForFunction(() => document.querySelector('[data-ai-session-toggle]').dataset.aiState === 'working');
    await page.waitForFunction(() => document.querySelector('[data-ai-session-count]').textContent === '135 tokens');
    await waitForTrail(1);
    const workingMorph = await sampleMorph();
    await assertStaticAiIcons();
    assert.equal(new Set(workingMorph.frames.map(frame => frame.outline)).size, 6);
    assert.ok(workingMorph.frames.every(frame => frame.visibleSurfaces===1 && frame.renderer==='gpu' && !frame.blending && frame.stroke!=='none' && frame.fill==='none' && frame.strokeWidth==='1.7px' && frame.thought===1 && Math.abs(frame.span-.55)<1e-6),'Thinking uses one depth-resolved hybrid surface with the approved55%tail');
    assert.ok(workingMorph.frames.every(frame => frame.transform === 'none' && frame.rotation === 'rotate(0.0000 12 12)'),'Thinking morphs without spinning');
    assert.ok(new Set(workingMorph.frames.map(frame => frame.length.toFixed(2))).size > 3, 'The path geometry must change, not only its scale or opacity');
    assert.ok(workingMorph.frames.every(frame => frame.contained));
    assert.ok(workingMorph.frames.every(frame => JSON.stringify(frame.icon) === '[18,18]'));
    assert.ok(workingMorph.frames.every(frame => JSON.stringify(frame.counter) === JSON.stringify(workingMorph.frames[0].counter)));
    const runningJob = await page.evaluate(() => window.__rkAiSession.state().jobs.find(job => job.status === 'running').id);
    await page.getByRole('button', {name:'AI settings', exact:true}).click();
    await page.locator('.adm__settings.is-open [data-cat="ai"].is-on').waitFor();
    await assertStaticAiIcons();
    assert.equal(await page.locator('[data-ai-session-panel]').isVisible(), false);
    assert.equal(await page.locator('[data-ai-session-toggle]').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('[data-ai-routing]').count(), 0, 'The shortcut opens the existing AI L1 overview, not a duplicate full settings form');
    assert.equal(await page.locator('[data-aiuse-reset]').count(), 1);
    assert.equal(await page.getByRole('button', {name:'Open AI settings', exact:true}).isVisible(), true);
    assert.equal(await page.evaluate(id => window.__rkAiSession.state().jobs.find(job => job.id === id).status, runningJob), 'running');
    await page.locator('[data-act="settings-close"]').click();
    await page.locator('.adm__settings').waitFor({state:'hidden'});
    await page.locator('[data-ai-session-toggle]').click();
    await page.evaluate(() => { window.__ribbonPath = document.querySelector('.adm__ai-spark path'); window.__sessionStream.answer(); });
    await page.waitForFunction(() => document.querySelector('[data-ai-session-toggle]').dataset.aiState === 'answering');
    assert.equal(await page.evaluate(() => document.querySelector('.adm__ai-spark path') === window.__ribbonPath),true,'Streaming retains the same ribbon element');
    await waitForTrail(0);
    const answeringMorph = await sampleMorph();
    assert.ok(answeringMorph.frames.every(frame=>frame.thought===0&&frame.span===1&&frame.opacity==='1'&&frame.visibleSurfaces===1),'Answering becomes one solid complete ribbon');
    assert.ok(new Set(answeringMorph.frames.map(frame => frame.rotation)).size > 3);
    assert.ok(answeringMorph.frames.every(frame => frame.transform === 'none' && frame.contained));
    assert.equal(new Set(answeringMorph.frames.map(frame => frame.outline)).size, 6);
    await page.getByLabel('Generated output', { exact: true }).filter({ hasText: 'Refined private' }).waitFor();
    assert.doesNotMatch(await page.locator('[data-ai-session-panel]').innerText(), /PRIVATE REASONING/);
    await page.locator('[data-l2tab="highlights"]').click();
    assert.equal(await page.locator('[data-ai-session-panel]').isVisible(), true);
    await page.locator('[data-l2tab="slides"]').click();
    await page.locator('.merge-empty-actions').waitFor();
    await assertStaticAiIcons();
    assert.equal(await page.locator('[data-ai-session-toggle]').isVisible(), true);
    assert.equal(await page.locator('[data-ai-session-panel]').isVisible(), true);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.locator('[data-ai-session-panel]').evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: innerWidth, overflow: element.scrollWidth > element.clientWidth }; });
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && !geometry.overflow);
      const motion = await sampleMorph();
      assert.ok(motion.frames.every(frame => frame.contained));
      assert.ok(motion.frames.every(frame => JSON.stringify(frame.counter) === JSON.stringify(motion.frames[0].counter)));
      await page.screenshot({ path: join(tmpdir(), 'rk-ai-session-answering-' + width + '.png') });
      await page.getByRole('button', {name:'AI settings', exact:true}).click();
      await page.locator('.adm__settings.is-open [data-cat="ai"].is-on').waitFor();
      assert.equal(await page.locator('[data-ai-session-panel]').isVisible(), false);
      assert.equal(await page.locator('.merge-shell').count(), 1, 'Opening settings must keep the slide editor mounted');
      assert.equal(await page.locator('[data-ai-session-count]').innerText(), '135 tokens');
      await page.waitForFunction(() => { const button = document.querySelector('.adm__settings [data-act="open-ai"]'); if (!button) return false; const bounds = button.getBoundingClientRect(); return bounds.x >= 0 && bounds.right <= innerWidth; });
      const settingsButton = await page.getByRole('button', {name:'Open AI settings', exact:true}).boundingBox();
      assert.ok(settingsButton.x >= 0 && settingsButton.x + settingsButton.width <= width);
      await page.locator('.adm__settings').evaluate(async element => { await Promise.all(element.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {}))); });
      await page.screenshot({path:join(tmpdir(), 'rk-ai-activity-settings-' + width + '.png')});
      await page.locator('[data-act="settings-close"]').click();
      await page.locator('.adm__settings').waitFor({state:'hidden'});
      await page.locator('[data-ai-session-toggle]').click();
      await page.getByLabel('Generated output', {exact:true}).filter({hasText:'Refined private'}).waitFor();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.adm__ai-spark').evaluate(element => getComputedStyle(element).transitionDuration),'0s');
    assert.ok(await page.locator('.adm__ai-spark svg,.adm__ai-spark path,.adm__ai-ribbon-turn').evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === 'none')));
    assert.equal(await assertIdleSparkle(),idleOutline,'Reduced motion retains the static ribbon even during streaming');
    await page.evaluate(() => window.__sessionStream.finish());
    await page.waitForFunction(() => window.__sessionResult === 'Refined private answer.');
    await page.waitForFunction(() => document.querySelector('[data-ai-session-count]').textContent === '190 tokens');
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await assertIdleSparkle(), idleOutline);
    assert.equal(await page.evaluate(() => window.__rkAiSession.state().totalTokens), 190);
    assert.doesNotMatch(await page.evaluate(() => sessionStorage.getItem('rk:ai:admin-session')), /Private input|Refined private|PRIVATE REASONING/);
    await page.getByRole('button', { name: 'Close AI activity', exact: true }).click();
    assert.equal(await page.locator('[data-ai-session-toggle]').evaluate(element => element === document.activeElement), true);
    await page.locator('[data-l2tab="story"]').click();
    const after = await page.evaluate(() => window.__RKStudio.getDraft());
    assert.deepEqual(after.work[0].study.blocks, JSON.parse(before).work[0].study.blocks);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.waitForFunction(() => !!window.RK?.data && typeof window.__rkDevStudio === 'function');
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll('.pass--lock').forEach(dialog => dialog.remove()));
    assert.equal(await page.locator('[data-ai-session-count]').innerText(), '190 tokens');
    assert.deepEqual(await page.evaluate(() => window.__rkAiSession.state().jobs), []);
    await page.locator('[data-ai-session-toggle]').click();
    await page.evaluate(() => {
      window.__sessionStream = null; window.__sessionResult = null;
      window.__RKStudio.improveText('Cancellation fixture', {}).then(text => { window.__sessionResult = text; }, error => { window.__sessionResult = error.message; });
    });
    await page.waitForFunction(() => !!window.__sessionStream);
    await page.evaluate(() => window.__sessionStream.answer());
    await page.getByLabel('Generated output', { exact: true }).filter({ hasText: 'Refined private' }).waitFor();
    await page.getByRole('button', { name: 'Stop AI request', exact: true }).click();
    await page.waitForFunction(() => window.__rkAiSession.state().jobs.at(-1)?.status === 'cancelled' && window.__sessionResult !== null);
    assert.equal(await page.evaluate(() => window.__rkAiSession.state().active), 0);
    await page.waitForFunction(() => document.querySelector('[data-ai-session-count]').textContent === '325 tokens');
    assert.equal(await assertIdleSparkle(), idleOutline);
    assert.match(await page.locator('[data-ai-jobs]').innerText(), /Refined private/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-ai-session-panel]').isVisible(), false);
    assert.equal(await page.locator('[data-ai-session-toggle]').evaluate(element => element === document.activeElement), true);
    await page.locator('[data-exit]').click();
    await page.locator('[data-return-site]').click();
    await page.waitForFunction(() => !document.querySelector('.adm.is-open'));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('rk:ai:admin-session')), null);
    await page.waitForFunction(() => !document.querySelector('[data-ai-jobs]')?.textContent.includes('Refined private'));
  } finally { await browser.close(); }
});

async function waitForRoutingPolicy(page, key, value) {
  await page.evaluate(() => { window.__routingPolicyProbe = { pending: false, matches: false }; });
  await page.waitForFunction(({ key, value }) => {
    const probe = window.__routingPolicyProbe;
    if (!probe.pending) {
      probe.pending = true;
      window.__RKStudio.aiRouting.state().then(state => { probe.matches = state.policy[key] === value; probe.pending = false; }, () => { probe.pending = false; });
    }
    return probe.matches;
  }, { key, value });
  await page.evaluate(() => { delete window.__routingPolicyProbe; });
}

test("new production decks are empty and have no demonstration content", () => {
  assert.deepEqual(createStudioDeck("Case-study slides"), { version: 1, title: "Case-study slides", selected: null, slides: [] });
});

test("slideshow routing defaults to native while preserving unopened legacy protection", () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const start = source.indexOf("function nativeSlidesEnabled(work)"), end = source.indexOf("async function saveNativeWork", start);
  const usesNative = runInNewContext(`(${source.slice(start, end)})`);
  assert.equal(usesNative({ id: "new-case" }), true);
  assert.equal(usesNative({ study: { slides: [{ layout: "title" }] } }), true);
  assert.equal(usesNative({ study: { slidesEnc: { ct: "sealed" } } }), false);
  assert.equal(usesNative({ study: { slidesEnc: { ct: "sealed" }, slides: [] } }), false);
  for (const key of ["nativeDeck", "nativeDeckEnc", "nativeDeckPublic"]) assert.equal(usesNative({ study: { [key]: { id: "existing-native-deck" }, slidesEnc: { ct: "sealed-legacy" } } }), true);
  assert.equal(usesNative({ encWork: true, study: { nativeDeck: { id: "private" } } }), false);
  assert.equal(usesNative(null), false);
});

test("native pilot references and inline native scenes stop publishing without changing the draft", () => {
  for (const study of [
    { nativeDeck: { schema: STUDIO_DECK_SCHEMA, version: 1, id: "deck-one", revision: 2 } },
    { nativeDeck: null },
    { slidesPublic: true, slides: [{ scene: { elements: [] }, notes: "PRIVATE NOTES" }] }
  ]) {
    const data = { work: [{ id: "case-one", study }] }, original = structuredClone(data);
    assert.throws(() => assertStudioDeckPublishable(data), { name: "StudioDeckPublishError" });
    assert.deepEqual(data, original);
  }
});

test("legacy and unopened encrypted decks pass through the pilot guard unchanged", () => {
  const data = { work: [{ study: { slides: [{ layout: "title", slots: { title: "Legacy slide" } }] } }, { study: { slidesEnc: { ct: "sealed-deck", wraps: { owner: "sealed-key" } } } }, { encWork: "sealed-work" }] };
  const original = structuredClone(data);
  assert.doesNotThrow(() => assertStudioDeckPublishable(data));
  assert.deepEqual(data, original);
});

test("the shared publish builder validates native references before preparing owner and audience copies", () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  assert.match(source, /async function buildPublishJson\(token, publication = \{\}\) \{\s*assertStudioDeckPublishable\(data, \{ supportedNative: true \}\);/);
  for (const entry of ['publish', 'ghPublish', 'publishManual']) assert.match(source, new RegExp('function ' + entry + '\\([^)]*\\) \\{(?:\\s*if \\(publishing\\) return;)?\\s*if \\(!slidePublishReady\\(\\)\\) return;'));
  assert.throws(() => assertStudioDeckPublishable({}, { activeEditor: true }), { name: 'StudioDeckPublishError' });
  const supported = { work: [{ id: 'case', study: { nativeDeck: { schema: STUDIO_DECK_SCHEMA, version: 1, caseStudyId: 'case', id: 'deck', revision: 1 } } }] };
  assert.doesNotThrow(() => assertStudioDeckPublishable(supported, { supportedNative: true }));
  assert.match(source, /prepareStudioPublication\(snapshot/);
});

for (const { width, mode } of [{ width: 1440, mode: "complete" }, { width: 390, mode: "complete" }, { width: 1440, mode: "summary-fallback" }, { width: 390, mode: "summary-fallback" }, { width: 1440, mode: "exhausted" }, { width: 1440, mode: "invalid-body" }, { width: 1440, mode: "schema-error" }, { width: 1440, mode: "invalid-draft" }, { width: 1440, mode: "revision" }, { width: 390, mode: "revision" }, { width: 390, mode: "cancelled" }]) test("Draft entire deck with AI delegates, checks and streams progress at " + width + "px (" + mode + ")", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: width < 600, isMobile: width < 600 });
  const requests = [], errors = [];
  const needsRevision = mode === "revision" || mode === "invalid-draft";
  const expectedSlideCount = mode === "complete" ? 16 : 1;
  const finalBody = "Place the next action beside the relevant content.";
  const schemaFailure = "output_config.format.schema: Unsupported regex feature in pattern field: Cannot apply a range quantifier to this regex.";
  let exhaustResponse = mode === "exhausted", rejectBody = mode === "invalid-body", releaseSpecialist;
  const specialistGate = new Promise(resolve => { releaseSpecialist = resolve; });
  const capabilities = { thinking: { supported: true }, structured_outputs: { supported: true }, effort: { supported: true, low: { supported: true }, medium: { supported: true } } };
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [{ id: "temperature-case", title: "A clearer product flow", client: "Studio test", study: { blocks: [{ type: "text", heading: "A clearer next step", body: "The redesigned flow places the next action beside the relevant content." }] } }];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem("rk:dev:stub", "1");
      localStorage.setItem("rk:ai:mode", "local"); localStorage.setItem("rk:ai:same", "0");
      localStorage.setItem("rk:ai:txt:provider", "anthropic"); localStorage.setItem("rk:ai:txt:key", "synthetic-test-key");
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(published) });
      if (url.hostname === "models.dev") return route.fulfill({ contentType: "application/json", body: "{}" });
      if (url.hostname === "api.anthropic.com") {
        if (url.pathname.endsWith("/models")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [
          { id: "studio-creative-a", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 128000, capabilities, pricing: { input: 2, output: 8 } },
          { id: "studio-coordinator", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 8192, capabilities, pricing: { input: 0.1, output: 0.2 } },
          { id: "studio-evidence", output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 8192, capabilities, pricing: { input: 1, output: 2 } }
        ] }) });
        if (url.pathname.endsWith("/messages")) {
          const body = request.postDataJSON(); requests.push(body);
          if (Object.hasOwn(body, "temperature")) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid body" } }) });
          if (body.system === AI_AGENT_SYSTEM) {
            const input = JSON.parse(body.messages[0].content), evidence = input.work.find(item => item.kind === "delegate" && item.valid);
            assert.equal(body.output_config?.format?.type, "json_schema", "A capable coordinator must receive an enforced action schema");
            const schema = body.output_config.format.schema;
            assert.deepEqual(schema.required, ["decision"]);
            assert.equal(schema.additionalProperties, false);
            assert.deepEqual(schema.properties.decision.anyOf[0].properties.modelRef.enum, input.catalogue.map(item => item.ref));
            assert.deepEqual(schema.properties.decision.anyOf.find(branch => branch.properties.action.enum[0] === "draft")?.properties.modelRef.enum, input.draftModels.length ? input.draftModels : undefined);
            assert.equal(body.max_tokens, 2048, "The schema must keep coordination bounded without an arbitrary token increase");
            const action = input.candidate ? { action: "finish", summary: "The draft preserves the source and meets the presentation contract" }
              : input.revision ? { action: "revise", workId: input.revision.workId, modelRef: input.catalogue.find(item => item.id === "studio-creative-a").ref, task: "creative", effort: "medium", instruction: "", inputs: [], summary: "Revising only the rejected body" }
              : evidence ? { action: "draft", modelRef: input.catalogue.find(item => item.id === "studio-creative-a").ref, task: "creative", effort: "medium", instruction: "Use the checked source facts", inputs: [evidence.id], summary: "Writing the deck with the creative model" }
              : { action: "delegate", modelRef: input.catalogue.find(item => item.id === "studio-evidence").ref, task: "analysis", effort: "medium", purpose: "evidence", instruction: "Check the supplied source facts", inputs: [], summary: "Checking the case-study evidence" };
            if (mode === "summary-fallback") {
              if (action.action === "delegate") delete action.summary;
              else action.summary = action.action === "draft" ? "OVERLONG PROGRESS SUMMARY ".repeat(30) : null;
            }
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ decision: action }) }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 } }) });
          }
          if (body.model === "studio-evidence") {
            await specialistGate;
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: "PRIVATE SPECIALIST FINDINGS: The supplied case places the next action beside relevant content; do not invent results." }], stop_reason: "end_turn" }) });
          }
          if (rejectBody) return route.fulfill({ status: 400, contentType: "application/json", headers: { "request-id": "req-browser-check" }, body: JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid body" } }) });
          if (mode === "schema-error") return route.fulfill({ status: 400, contentType: "application/json", headers: { "request-id": "req-schema-check", "access-control-expose-headers": "request-id" }, body: JSON.stringify({ error: { type: "invalid_request_error", message: schemaFailure } }) });
          if (body.output_config?.format?.schema?.properties?.updates) {
            const revision = JSON.parse(body.messages[0].content);
            assert.deepEqual(revision.fields.map(({ ref, field, maxLength }) => ({ ref, field, maxLength })), [{ ref: "f0", field: "body", maxLength: 180 }]);
            assert.equal(body.max_tokens, 1024);
            assert.equal(body.output_config.effort, "medium");
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ updates: [{ fieldRef: "f0", text: mode === "invalid-draft" ? "A".repeat(181) : finalBody }] }) }], stop_reason: "end_turn", usage: { input_tokens: 200, output_tokens: 100 } }) });
          }
          const content = body.messages[0].content;
          const source = JSON.parse(Array.isArray(content) ? content[0].text : content).sources[0];
          assert.match(JSON.stringify(content), /PRIVATE SPECIALIST FINDINGS/);
          const proposal = { version: 2, title: "A grounded deck", slides: [{ id: "opening", kind: "authored", layout: "statement", sourceIds: [source.sourceId], headline: "A clearer next step", kicker: "DESIGN DECISION", body: "Place the next action beside the relevant content.", notes: "Discuss the redesigned flow.", components: [] }] };
          if (needsRevision) Object.assign(proposal.slides[0], { layout: "evidence", components: [source.sourceId], body: "A".repeat(200) });
          if (expectedSlideCount > 1) proposal.slides = Array.from({ length: expectedSlideCount }, (_, index) => ({ ...structuredClone(proposal.slides[0]), id: "slide-" + index, headline: "A clearer next step " + (index + 1) }));
          const events = [
            { type: "message_start", message: { usage: { input_tokens: 200 } } },
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "PRIVATE REASONING SIGNATURE" } },
            ...(exhaustResponse ? [] : [{ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: JSON.stringify(proposal) } }]),
            { type: "message_delta", delta: { stop_reason: exhaustResponse ? "max_tokens" : "end_turn" }, usage: { output_tokens: exhaustResponse ? 24000 : 12500, output_tokens_details: { thinking_tokens: exhaustResponse ? 24000 : 11000 } } },
            { type: "message_stop" }
          ];
          return route.fulfill({ contentType: "text/event-stream", body: events.map(event => "data: " + JSON.stringify(event)).join("\n\n") });
        }
        return route.abort();
      }
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(maxCost => {
      const draftSlides = window.__RKStudio.draftSlides;
      window.__RKStudio.draftSlides = (catalog, brief, options = {}) => draftSlides(catalog, brief, { ...options, maxCost: Math.min(maxCost, options.maxCost ?? Infinity) });
    }, needsRevision ? 0.3 : 0.5);
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.adm__tab[data-tab="work"]').click();
    if (mode === "complete") {
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.getByRole('tab', {name:'AI Options',exact:true}).click();
      await page.getByRole('button', {name:'Generate slides',exact:true}).click();
      await page.locator('.merge-shell').waitFor();
    } else {
      await openProjectSlides(page);
      await page.locator(".merge-empty-actions").waitFor();
      await page.getByRole("button", { name: "Draft entire deck with AI", exact: true }).click();
    }
    await page.getByRole("log", { name: "Agent activity", exact: true }).getByText(mode === "summary-fallback" ? "Delegating specialist work" : "Checking the case-study evidence", { exact: true }).waitFor();
    await page.getByRole("log", { name: "Agent activity", exact: true }).getByText(/studio-evidence/).waitFor();
    assert.equal(requests.filter(request => request.model === "studio-creative-a").length, 0);
    assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
    await page.screenshot({ path: join(tmpdir(), "rk-ai-agent-working-" + width + ".png") });
    if (mode === "cancelled") {
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      releaseSpecialist();
      await page.locator(".merge-ai").waitFor({ state: "detached" });
      assert.equal(requests.length, 2);
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount || 0), 0);
      return;
    }
    releaseSpecialist();
    if (mode === "schema-error") {
      await page.locator('.merge-ai [role="alert"]').filter({ hasText: schemaFailure }).waitFor();
      assert.equal(requests.length, 4, "An application schema rejection must stop before another coordinator or model request");
      assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
      const state = await page.evaluate(() => window.__RKStudio.aiRouting.state());
      assert.equal(state.decisions.at(-1).failure, "request-format");
      assert.equal(state.decisions.at(-1).failurePhase, "request");
      assert.equal(state.decisions.at(-1).httpStatus, 400);
      assert.equal(state.decisions.at(-1).requestId, "req-schema-check");
      assert.ok(state.decisions.reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.5);
      const study = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study);
      assert.deepEqual(study.blocks, published.work[0].study.blocks);
      assert.equal(study.nativeDeck?.slideCount || 0, 0);
      assert.deepEqual(errors, []);
      return;
    }
    if (mode === "invalid-draft") {
      await page.locator('.merge-ai [role="alert"]').filter({ hasText: /draft limit.*Last draft validation: Invalid body: 181 characters exceeds the 180-character limit/ }).waitFor();
      await page.getByRole("log", { name: "Agent activity", exact: true }).getByText("Draft validation: Invalid body: 200 characters exceeds the 180-character limit", { exact: true }).waitFor();
      assert.equal(requests.length, 6, "Do not call another model after the bounded revision fails the original contract");
      assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
      const state = await page.evaluate(() => window.__RKStudio.aiRouting.state());
      assert.equal(state.decisions.at(-1).failurePhase, "validation");
      assert.ok(state.decisions.reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.3);
      assert.doesNotMatch(JSON.stringify(state), /Invalid body: (200|181)|PRIVATE SPECIALIST FINDINGS/);
      const study = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study);
      assert.deepEqual(study.blocks, published.work[0].study.blocks);
      assert.equal(study.nativeDeck?.slideCount || 0, 0);
      assert.deepEqual(errors, []);
      return;
    }
    if (mode === "exhausted" || mode === "invalid-body") {
      await page.locator('.merge-ai [role="alert"]').filter({ hasText: mode === "exhausted" ? "output limit before returning answer text" : "rejected the request body (HTTP 400" }).waitFor();
      assert.equal(requests.length, 4, "Do not retry a charged or generically rejected response automatically");
      const failed = await page.evaluate(() => window.__RKStudio.aiRouting.state());
      if (mode === "exhausted") {
        assert.equal(failed.decisions.at(-1).failure, "output-limit");
        assert.equal(failed.decisions.at(-1).stopReason, "max_tokens");
        assert.equal(failed.decisions.at(-1).usedOutputTokens, 24000);
      } else {
        assert.equal(failed.decisions.at(-1).httpStatus, 400);
        assert.equal(failed.decisions.at(-1).errorType, "invalid_request_error");
        assert.equal(failed.decisions.at(-1).failurePhase, "request");
      }
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount || 0), 0);
      assert.equal(await page.getByRole("button", { name: "Append slides", exact: true }).count(), 0);
      exhaustResponse = false; rejectBody = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    await page.locator(".merge-ai h3").waitFor();
    assert.equal(await page.locator(".merge-ai h3").innerText(), "A grounded deck");
    assert.equal(await page.locator('.merge-ai [role="alert"]').count(), 0);
    assert.equal(requests.length, mode === "exhausted" || mode === "invalid-body" ? 9 : mode === "revision" ? 7 : 5);
    assert.deepEqual([...new Set(requests.map(request => request.model))], ["studio-coordinator", "studio-evidence", "studio-creative-a"]);
    const drafts = requests.filter(request => request.model === "studio-creative-a" && !request.output_config?.format?.schema?.properties?.updates);
    assert.ok(drafts.every(request => request.stream === true && request.max_tokens === 24000));
    if (mode === "revision") assert.equal(drafts.length, 1, "The bounded revision must not generate a second whole deck");
    assert.ok(requests.filter(request => request.model === "studio-creative-a").every(request => request.output_config?.effort === "medium"), "The agent's chosen effort must reach the final model");
    for (const request of drafts) assert.deepEqual(request.output_config?.format, { type: "json_schema", schema: COMPOSITION_RESPONSE_SCHEMA });
    assert.ok(requests.every(request => !Object.hasOwn(request, "temperature")));
    assert.ok(requests.filter(request => request.model === "studio-coordinator").every(request => request.output_config?.effort === "low"));
    await page.locator(".merge-ai-activity > summary").click();
    await page.getByRole("log", { name: "Agent activity", exact: true }).locator('li[data-status="complete"]').getByText(mode === "summary-fallback" ? "Producing the draft" : "Writing the deck with the creative model", { exact: true }).waitFor();
    if (mode === "summary-fallback") assert.doesNotMatch(await page.locator(".merge-ai").innerText(), /OVERLONG PROGRESS SUMMARY|HTTP 422|needs a short progress summary/);
    assert.match(await page.getByLabel("Model selection", { exact: true }).innerText(), /studio-creative-a.*provisional/);
    await page.getByRole("button", { name: "Draft needs work", exact: true }).click();
    await page.getByLabel("Feedback category", { exact: true }).selectOption("design");
    await page.getByText("Feedback saved", { exact: true }).waitFor();
    const overflow = await page.locator(".merge-ai").evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll("button,select,summary")].filter(control => control.getClientRects().length).map(control => ({ label: control.textContent, left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })).filter(control => control.left < bounds.left - 1 || control.right > bounds.right + 1);
    });
    assert.deepEqual(overflow, []);
    await page.screenshot({ path: join(tmpdir(), "rk-ai-proposal-" + width + ".png") });
    const routing = await page.evaluate(() => window.__RKStudio.aiRouting.state());
    for (const jobId of new Set(routing.decisions.map(decision => decision.agentJobId))) assert.ok(routing.decisions.filter(decision => decision.agentJobId === jobId).reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.5);
    if (mode === "summary-fallback") assert.ok(routing.decisions.every(decision => decision.status === "success"), "Cosmetic summaries must never trigger repair requests");
    const accepted = routing.decisions.find(decision => decision.agentRole === "result");
    assert.equal(accepted.task, "creative");
    assert.equal(accepted.stopReason, "end_turn");
    assert.equal(accepted.usedOutputTokens, mode === "revision" ? 100 : 12500);
    assert.equal(accepted.thinkingTokens, mode === "revision" ? undefined : 11000);
    if (mode === "revision") {
      assert.equal(accepted.agentOperation, "revision");
      assert.ok(routing.decisions.reduce((cost, decision) => cost + decision.estimatedCost, 0) <= 0.3);
      await page.getByRole("log", { name: "Agent activity", exact: true }).getByText("Revising only the rejected body", { exact: true }).waitFor();
    }
    assert.equal(routing.observations.find(item => item.feedbackFor)?.quality, 0.25);
    assert.doesNotMatch(JSON.stringify(routing), /synthetic-test-key|Place the next action|Discuss the redesigned flow|PRIVATE REASONING SIGNATURE|PRIVATE SPECIALIST FINDINGS/);
    await page.getByRole("button", { name: "Append slides", exact: true }).click();
    await page.waitForFunction(count => window.__RKStudio.getDraft().work[0].study.nativeDeck?.slideCount === count, expectedSlideCount);
    await page.waitForFunction(count => {
      const thumbnails = [...document.querySelectorAll('.merge-thumbnail')];
      return thumbnails.length === count && thumbnails.every(thumbnail => thumbnail.querySelector('.merge-section-thumbnail-svg > svg text'));
    }, expectedSlideCount, { timeout: 10000 });
    await page.locator("[data-l2-back]").click();
    await page.locator(".merge-shell").waitFor({ state: "detached" });
    const study = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study);
    assert.deepEqual(study.blocks, published.work[0].study.blocks);
    assert.notEqual(study.slidesPublic, true);
    assert.doesNotMatch(JSON.stringify(study), /aiRouting|modelId|feedbackFor|agentRole|agentJobId/);
    assert.deepEqual(errors, []);
  } finally { releaseSpecialist(); await browser.close(); }
});

test("AI routing settings discover models, require spending consent and keep evidence private", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const requests = [], discoveries = [], errors = [], created = new Date(Date.now() - 86400000).toISOString();
  let includeNewcomer = false;
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [];
  const metadata = id => ({ id, input_modalities: ["text", "image"], output_modalities: ["text"], max_input_tokens: 100000, max_tokens: 16000,
    created_at: created, capabilities: { thinking: { supported: true }, structured_outputs: { supported: true } }, pricing: { input: 2, output: 8 } });
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem("rk:dev:stub", "1"); localStorage.setItem("rk:ai:mode", "local"); localStorage.setItem("rk:ai:same", "0");
      for (const [scope, provider] of [["txt", "anthropic"], ["img", "openai"]]) {
        localStorage.setItem("rk:ai:" + scope + ":provider", provider); localStorage.setItem("rk:ai:" + scope + ":key", "synthetic-routing-key");
      }
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(published) });
      if (url.hostname === "models.dev") { assert.equal(request.headers().authorization, undefined); return route.fulfill({ contentType: "application/json", body: "{}" }); }
      if (["api.anthropic.com", "api.openai.com"].includes(url.hostname)) {
        if (url.pathname.endsWith("/models")) {
          discoveries.push(url.hostname);
          const models = url.hostname === "api.openai.com" ? [metadata("connected-model")] : [metadata("baseline-a"), metadata("baseline-b"), ...(includeNewcomer ? [metadata("fresh-catalogue-entry")] : [])];
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: models }) });
        }
        if (request.method() === "POST") {
          const body = request.postDataJSON(); requests.push({ provider: url.hostname, body });
          if (body.system === AI_AGENT_SYSTEM) {
            const input = JSON.parse(body.messages[0].content);
            const selected = input.catalogue.find(item => item.id === "fresh-catalogue-entry" && item.evidence.samples >= 3) || input.catalogue[0];
            const action = input.candidate ? { action: "finish", summary: "The copy meets the requested outcome" } : { action: "draft", modelRef: selected.ref, task: "writing", instruction: "", inputs: [], summary: "Improving the supplied copy" };
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(action) }], stop_reason: "end_turn" }) });
          }
          const text = String(body.system || "").startsWith("Complete this small evaluation") ? '{"headline":"Related settings belong together","body":"The team grouped related controls to make settings easier to find."}' : "Refined copy.";
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 15, output_tokens: 20 } }) });
        }
        return route.abort();
      }
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    const original = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator("[data-opensettings]").click();
    await page.locator('[data-act="settings-cat"][data-cat="ai"]').click();
    const panel = page.locator("[data-ai-routing]");
    assert.equal(await panel.count(), 0, "The AI overview must not duplicate routing settings");
    assert.equal(await page.locator("[data-aiuse-reset]").count(), 1, "Token usage stays on the overview");
    assert.equal(discoveries.length, 0, "The overview must not mount a hidden discovery panel");
    await page.getByRole("button", { name: "Open AI settings", exact: true }).click();
    await panel.getByText(/2 accessible models/).waitFor();
    assert.equal(await panel.count(), 1, "Routing has one home inside the full AI settings");
    assert.equal(await panel.getByText("Agent-led", { exact: true }).count(), 1);
    assert.equal(await panel.locator("[data-route-task], [data-route-choices], [data-route-evaluate]").count(), 0, "Model/task selection and manual evaluation are not the user workflow");
    assert.equal(await panel.locator(".airoute__advanced").getAttribute("open"), null);
    assert.equal(requests.length, 0);
    assert.ok(discoveries.every(provider => provider === "api.anthropic.com"));
    assert.equal(await panel.locator('[data-route-policy="autoEvaluate"]').isChecked(), false);
    assert.equal(await panel.locator('[data-route-policy="evaluationDailyBudget"]').inputValue(), "0");
    assert.equal(await panel.locator('[data-route-import] svg').count(), 1);
    includeNewcomer = true;
    await panel.getByRole("button", { name: "Refresh accessible models", exact: true }).click();
    await panel.getByText(/3 accessible models/).waitFor();
    await panel.locator('[data-route-policy="maxCost"]').fill("0.00001");
    await panel.locator('[data-route-policy="maxCost"]').press("Tab");
    await waitForRoutingPolicy(page, "maxCost", 0.00001);
    const blocked = await page.evaluate(async () => { try { await window.__RKStudio.improveText("PRIVATE ROUTING COPY", {}); return "unexpected success"; } catch (error) { return error.message; } });
    assert.match(blocked, /No available model/); assert.equal(requests.length, 0);
    await panel.locator('[data-route-policy="maxCost"]').fill("");
    await panel.locator('[data-route-policy="maxCost"]').press("Tab");
    await waitForRoutingPolicy(page, "maxCost", null);
    await panel.locator('[data-route-policy="providers"]').selectOption("connected");
    await page.getByRole("button", { name: "Keep selected", exact: true }).click();
    assert.equal((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy.providers, "selected");
    await panel.locator('[data-route-policy="providers"]').selectOption("connected");
    await page.getByRole("button", { name: "Allow", exact: true }).click();
    await panel.getByText(/4 accessible models/).waitFor();
    assert.ok(discoveries.includes("api.openai.com"));
    await panel.locator('[data-route-policy="providers"]').selectOption("selected");
    await panel.getByText("Diagnostics and evaluation limits", { exact: true }).click();
    await panel.locator('[data-route-policy="evaluationDailyBudget"]').fill("1");
    await panel.locator('[data-route-policy="evaluationDailyBudget"]').press("Tab");
    await waitForRoutingPolicy(page, "evaluationDailyBudget", 1);
    assert.equal(requests.length, 0);
    assert.equal(await page.evaluate(() => window.__RKStudio.improveText("PRIVATE ROUTING COPY", {})), "Refined copy.");
    assert.equal(requests.length, 3);
    const tested = await page.evaluate(() => window.__RKStudio.aiRouting.state());
    assert.equal(tested.decisions.length, 3); assert.ok(tested.observations.every(item => item.quality == null));
    assert.equal(tested.evaluationReserved, 0, "An agentic task does not silently enable background benchmarks");
    assert.deepEqual(tested.decisions.map(item => item.agentRole), ["coordinator", "result", "coordinator"]);
    const imported = [{ provider: "anthropic", modelId: "fresh-catalogue-entry", scope: tested.decisions[0].scope, task: "writing", at: Date.now(), quality: 0.98, samples: 6, rubric: "owner-reviewed-copy-v1", prompt: "NEVER STORE IMPORTED CONTENT" }];
    await panel.locator("[data-route-file]").setInputFiles({ name: "evaluations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
    await panel.getByText("1 evaluation records imported.", { exact: true }).waitFor();
    await panel.locator('[data-route-policy="autoEvaluate"]').check();
    const darkConfirmation = await page.getByRole("button", { name: "Cancel", exact: true }).evaluate(button => getComputedStyle(button.closest(".pass__box")).backgroundColor);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy.autoEvaluate, false);
    await page.evaluate(() => { document.documentElement.dataset.appearance = "light"; });
    await panel.locator('[data-route-policy="autoEvaluate"]').check();
    const lightConfirmation = await page.getByRole("button", { name: "Cancel", exact: true }).evaluate(button => getComputedStyle(button.closest(".pass__box")).backgroundColor);
    assert.notEqual(lightConfirmation, darkConfirmation);
    await page.screenshot({ path: join(tmpdir(), "rk-ai-confirmation-light.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => { document.documentElement.dataset.appearance = "dark"; });
    await panel.locator('[data-route-policy="autoEvaluate"]').check();
    await page.getByRole("button", { name: "Enable tests", exact: true }).click();
    await waitForRoutingPolicy(page, "autoEvaluate", true);
    assert.equal(await page.evaluate(async () => {
      const completed = new Promise(resolve => {
        const observe = async () => {
          const state = await window.__RKStudio.aiRouting.state();
          if (state.decisions.filter(item => item.evaluation && item.task === "writing" && item.status === "success").length === 3) {
            window.removeEventListener("rk:ai-evaluation", observe); resolve();
          }
        };
        window.addEventListener("rk:ai-evaluation", observe);
      });
      const result = await window.__RKStudio.improveText("PRIVATE ROUTING COPY", {});
      await completed;
      return result;
    }), "Refined copy.");
    await panel.locator('[data-route-policy="autoEvaluate"]').uncheck();
    await waitForRoutingPolicy(page, "autoEvaluate", false);
    assert.equal(requests.length, 9);
    const saved = await page.evaluate(() => window.__RKStudio.aiRouting.state());
    assert.equal(saved.decisions.filter(item => item.agentRole === "result").at(-1).modelId, "fresh-catalogue-entry", "The coordinator receives imported task evidence and can choose a new model without human model selection");
    assert.ok(saved.evaluationReserved > 0 && saved.evaluationReserved < 1);
    assert.doesNotMatch(JSON.stringify(saved), /synthetic-routing-key|PRIVATE ROUTING COPY|Related settings belong|NEVER STORE IMPORTED CONTENT/);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())), original);
    const routingBundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/ai-orchestrator.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "RoutingStoreTest", write: false });
    const other = await page.context().newPage();
    try {
      await openIsolatedBrowserHost(other, process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510");
      for (const target of [page, other]) await target.addScriptTag({ content: routingBundle.outputFiles[0].text });
      await page.evaluate(async budget => window.RoutingStoreTest.createAiOrchestrator().configure({ evaluationDailyBudget: budget }), saved.evaluationReserved + 0.03);
      const reservations = await Promise.allSettled([page.evaluate(() => window.RoutingStoreTest.createAiOrchestrator().reserveEvaluation(0.02)), other.evaluate(() => window.RoutingStoreTest.createAiOrchestrator().reserveEvaluation(0.02))]);
      assert.equal(reservations.filter(result => result.status === "fulfilled").length, 1);
      const accepted = reservations.find(result => result.status === "fulfilled").value;
      assert.equal(await page.evaluate(reservation => window.RoutingStoreTest.createAiOrchestrator().releaseEvaluation(reservation, 0.01), accepted), true);
      assert.equal(await other.evaluate(reservation => window.RoutingStoreTest.createAiOrchestrator().releaseEvaluation(reservation, 0.01), accepted), false);
      assert.ok(Math.abs((await page.evaluate(() => window.__RKStudio.aiRouting.state())).evaluationReserved - saved.evaluationReserved - 0.01) < 1e-9);
    } finally { await other.close(); }
    const expectedPolicy = (await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy;
    await page.locator('[data-act="set-back"]').click();
    assert.equal(await panel.count(), 0);
    assert.equal(await page.locator("[data-aiuse-reset]").count(), 1);
    assert.deepEqual((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy, expectedPolicy, "Back must not reset routing settings");
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    assert.deepEqual((await page.evaluate(() => window.__RKStudio.aiRouting.state())).policy, expectedPolicy);
    await page.locator("[data-opensettings]").click();
    await page.locator('[data-act="settings-cat"][data-cat="ai"]').click();
    assert.equal(await panel.count(), 0);
    await page.getByRole("button", { name: "Open AI settings", exact: true }).click();
    await panel.getByText(/3 accessible models/).waitFor();
    assert.equal(await panel.count(), 1);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await panel.evaluate(element => {
      const style = getComputedStyle(element), family = style.getPropertyValue("--sans").split(",")[0].replace(/["']/g, "").trim();
      return style.fontFamily.includes(family) && [...document.fonts].some(face => face.family.replace(/["']/g, "") === family && face.status === "loaded");
    }), true, "The routing panel must use the loaded Studio body font");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await panel.locator('[data-route-refresh]').scrollIntoViewIfNeeded();
      const bounds = await panel.evaluate(element => {
        const rectangle = element.getBoundingClientRect();
        return { panel: [rectangle.left, rectangle.right], viewport: innerWidth, overflow: [...element.querySelectorAll('input:not([hidden]),select,button:not([hidden])')].filter(control => control.getClientRects().length).map(control => ({ left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right, label: control.getAttribute('aria-label') || control.textContent })).filter(control => control.left < rectangle.left - 1 || control.right > rectangle.right + 1) };
      });
      assert.ok(bounds.panel[0] >= 0 && bounds.panel[1] <= bounds.viewport + 1, JSON.stringify(bounds));
      assert.deepEqual(bounds.overflow, []);
      await page.screenshot({ path: join(tmpdir(), "rk-ai-routing-" + width + ".png") });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("native deck storage commits original assets and rejects stale or misrouted saves", { timeout: 30000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/slide-studio-deck.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioDeckStorage", write: false });
  const recoveryBundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/studio-draft-recovery.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioRecovery", write: false });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  try {
    await openIsolatedBrowserHost(page, process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.addScriptTag({ content: recoveryBundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { createStudioDeck, studioDeckReference, saveStudioDeck, loadStudioDeck, studioDeckBackup, restoreStudioDeckBackup } = window.StudioDeckStorage;
      const first = studioDeckReference("case-one"), second = studioDeckReference("case-two");
      const document = createStudioDeck("Original deck");
      document.slides = [{ id: "slide-one", title: "Slide", notes: "Private notes", durationMinutes: 1.5, scene: { version: 1, elements: [{ id: "image", type: "image", fileId: "original" }], files: { original: { id: "original", mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,PHN2Zy8+", originalDataURL: "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+T3JpZ2luYWw8L3RpdGxlPjwvc3ZnPg==" } } } }];
      document.selected = "slide-one";
      const original = JSON.stringify(document);
      const saved = await saveStudioDeck(first, document);
      const restored = await loadStudioDeck(saved);
      const revision = await saveStudioDeck(saved, { ...document, title: "Updated deck" });
      const failures = {};
      for (const [key, operation] of Object.entries({ stale: () => saveStudioDeck(saved, document), wrongCase: () => loadStudioDeck({ ...saved, caseStudyId: "case-two" }), closed: () => saveStudioDeck(revision, document, { isCurrent: () => false }) })) {
        try { await operation(); } catch (error) { failures[key] = error.name + ": " + error.message; }
      }
      const other = await saveStudioDeck(second, createStudioDeck("Other case"));
      const backup = await studioDeckBackup({ work: [{ id: "case-one", title: "Case", study: { nativeDeck: saved } }, { id: "case-two", study: { nativeDeck: other } }] });
      const recovered = await restoreStudioDeckBackup(JSON.parse(JSON.stringify(backup)), ["case-one"]);
      const recoveredReference = recovered.work[0].study.nativeDeck;
      const archive = await window.StudioRecovery.archiveStudioDraft(backup, "previous-publish");
      await window.StudioRecovery.archiveStudioDraft(backup, "previous-publish");
      await window.StudioRecovery.saveStudioPublishedDraft("published-revision", recovered);
      const baseline = await window.StudioRecovery.studioPublishedDraft("published-revision");
      const archived = await window.StudioRecovery.studioDraftRecoveries(archive.id);
      const archives = await window.StudioRecovery.studioDraftRecoveries();
      const broken = structuredClone(backup); delete broken.nativeDecksBackup;
      try { await restoreStudioDeckBackup(broken, ["case-one"]); } catch (error) { failures.backup = error.message; }
      return { roundtrip: JSON.stringify(restored.document) === original, originalUnchanged: JSON.stringify(document) === original, firstTitle: (await loadStudioDeck(saved)).document.title, latestTitle: (await loadStudioDeck(saved, { latest: true })).document.title, otherTitle: (await loadStudioDeck(other)).document.title, failures, revision: revision.revision,
        recovery: { count: archives.length, cases: archives[0].cases, roundtrip: JSON.stringify(archived.backup) === JSON.stringify(backup), metadataOnly: !Object.hasOwn(archives[0], "backup"), baseline: JSON.stringify(baseline) === JSON.stringify(recovered), differentRevision: await window.StudioRecovery.studioPublishedDraft("unknown-revision") },
        backup: { documents: backup.nativeDecksBackup.documents.length, newIdentity: recoveredReference.id !== saved.id, title: (await loadStudioDeck(recoveredReference)).document.title, originalMedia: (await loadStudioDeck(recoveredReference)).document.slides[0].scene.files.original.originalDataURL, unchangedOther: recovered.work[1].study.nativeDeck.id === other.id, noEnvelope: !Object.hasOwn(recovered, "nativeDecksBackup") } };
    });
    assert.equal(result.roundtrip, true);
    assert.equal(result.originalUnchanged, true);
    assert.equal(result.firstTitle, "Original deck");
    assert.equal(result.latestTitle, "Updated deck");
    assert.equal(result.otherTitle, "Other case");
    assert.equal(result.revision, 2);
    assert.match(result.failures.stale, /StudioDeckConflictError/);
    assert.match(result.failures.wrongCase, /another case study/);
    assert.match(result.failures.closed, /session has changed/);
    assert.match(result.failures.backup, /missing the native deck/);
    assert.equal(result.backup.documents, 2);
    assert.equal(result.backup.newIdentity, true);
    assert.equal(result.backup.title, "Updated deck");
    assert.equal(result.backup.originalMedia, "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+T3JpZ2luYWw8L3RpdGxlPjwvc3ZnPg==");
    assert.equal(result.backup.unchangedOther, true);
    assert.equal(result.backup.noEnvelope, true);
    assert.deepEqual(result.recovery, { count: 1, cases: 2, roundtrip: true, metadataOnly: true, baseline: true, differentRevision: null });
  } finally { await browser.close(); }
});

test("Studio preserves an older draft through recovery failure, cancel and selective restore", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.addInitScript(() => localStorage.setItem("rk:dev:stub", "1"));
    await page.route("**/*", route => {
      const request = route.request();
      if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    const original = await page.evaluate(() => {
      const draft = structuredClone(window.RK.published || window.RK.data);
      draft.work = [{ id: "recovery-case", title: "Unfinished case study", study: { blocks: [{ type: "statement", body: "Keep this draft" }] } }];
      const serialized = JSON.stringify(draft);
      localStorage.setItem("rk:content:draft", serialized); localStorage.setItem("rk:content:draft:sig", "older-published-version");
      window.recoveryTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...options) {
        if (this.name === "rk-studio-draft-recovery-v1" && mode === "readwrite") throw new DOMException("Test recovery quota", "QuotaExceededError");
        return window.recoveryTransaction.call(this, stores, mode, ...options);
      };
      window.__rkDevStudio(); return serialized;
    });
    await page.getByRole("dialog", { name: "Draft recovery paused" }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft")), original);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.recoveryTransaction; document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()); });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator(".bkr [data-go]").waitFor();
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work.some(work => work.id === "recovery-case")), false);
    await page.locator(".bkr [data-cancel]").click();
    await page.locator("[data-opensettings]").click();
    await page.locator('[data-act="settings-cat"][data-cat="backup"]').click();
    await page.locator('[data-act="draft-recovery"]').click();
    await page.getByRole("button", { name: "Review draft", exact: true }).click();
    await page.locator(".bkr [data-go]").click();
    await page.waitForSelector(".bkr", { state: "detached" });
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work.find(work => work.id === "recovery-case")?.study.blocks[0].body), "Keep this draft");
    const archives = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("rk-studio-draft-recovery-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, count = database.transaction("drafts", "readonly").objectStore("drafts").count();
        count.onsuccess = () => { database.close(); resolve(count.result); };
        count.onerror = () => { database.close(); reject(count.error); };
      };
    }));
    assert.equal(archives, 1);
    const concurrent = await page.evaluate(async () => {
      const older = window.__RKStudio.getDraft();
      localStorage.setItem('rk:content:draft', JSON.stringify(older));
      localStorage.setItem('rk:content:draft:sig', 'older-again');
      const newer = structuredClone(older); newer.work[0].title = 'Newer work from another tab';
      const put = IDBObjectStore.prototype.put;
      let changed = false;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (!changed && this.transaction.db.name === 'rk-studio-draft-recovery-v1') {
          changed = true;
          localStorage.setItem('rk:content:draft', JSON.stringify(newer));
          localStorage.setItem('rk:content:draft:sig', window.RK.publishedSig);
        }
        return request;
      };
      try {
        await window.__RKStudio.open();
        return { changed, kept: window.__RKStudio.getDraft().work[0].title === newer.work[0].title, stored: localStorage.getItem('rk:content:draft') === JSON.stringify(newer) };
      } finally { IDBObjectStore.prototype.put = put; }
    });
    assert.deepEqual(concurrent, { changed: true, kept: true, stored: true }, 'Archiving an old draft must not erase a newer save from another tab');
  } finally { await browser.close(); }
});

test("Studio Publish shares private/public deck, case-section, retry and owner-reopen workflows", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors = [], uploads = new Map(), writes = [], publicUploads = [];
  const base = process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510", passphrase = "synthetic-publish-test-only";
  let failNext = false, latest, holdWrite = false, releaseWrite;
  const source = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  source.specialViews = []; source.work = [{ id: "publish-case", title: "Shared publishing", client: "Studio", featured: true, study: { blocks: [{ type: "statement", body: "Published section" }] } }];
  latest = structuredClone(source);
  const routes = async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/content.json")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(latest) });
    if (url.pathname.includes("/assets/protected/")) {
      const assetPath = "/assets/protected/" + url.pathname.split("/assets/protected/")[1];
      if (request.method() === "PUT") {
        uploads.set(assetPath, Buffer.from(request.postDataJSON().content, "base64"));
        return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
      }
      if (uploads.has(assetPath)) return route.fulfill({ contentType: "application/octet-stream", body: uploads.get(assetPath) });
    }
    if (url.pathname === "/admin/content") {
      if (request.method() === "GET") return route.fulfill({ json: { conditional: true, protocol: 1 } });
      assert.equal(request.headers()["x-content-base"], await contentRevision(latest));
      const value = request.postDataJSON(); writes.push(value);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic publish failure" }) }); }
      if (holdWrite) { holdWrite = false; await new Promise(resolve => { releaseWrite = resolve; }); }
      latest = value;
      return route.fulfill({ json: { ok: true, revision: await contentRevision(latest), git: { ok: true } } });
    }
    if (url.pathname === "/admin/media/put") {
      publicUploads.push(request.postDataBuffer());
      return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    }
    if (url.pathname === "/admin/presenter-metadata") return route.fulfill({ status: 503, json: { error: "Synthetic private sync offline" } });
    if (url.hostname === "rk-ai-proxy.riteshkumarhk.workers.dev") return route.fulfill({ contentType: "application/json", body: url.pathname.includes("publish") ? '{"enabled":false}' : "{}" });
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  };
  await context.route("**/*", routes);
  await context.addInitScript(() => {
    localStorage.setItem("rk:dev:stub", "1");
    window.__rkAdminAuth = { session: { token: 'synthetic-local-test', exp: Date.now() + 3600000 }, trust: { token: 'synthetic-local-test', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
    localStorage.setItem("rk:autopub:on", "0");
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException("Denied in test", "NotAllowedError"));
  });
  page.on("pageerror", error => errors.push(error.message));
  const reopenStudio = async target => {
    await target.goto(base + "/studio/?devstub&nativeSlides=1");
    await target.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await target.evaluate(() => window.__rkDevStudio());
    await target.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await target.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await target.locator('.adm__tab[data-tab="work"]').click();
  };
  try {
    await page.goto(base + "/studio/slide-merge-lab/");
    await waitForSlideEditor(page);
    const document = await page.evaluate(() => {
      const deck = window.__slideMerge.deck(); deck.slides = [deck.slides[0]]; deck.title = "Shared publishing"; deck.slidesPublic = false;
      deck.slides[0].notes = "PRIVATE INITIAL NOTES";
      const shape = deck.slides[0].scene.elements.find(element => element.type === "rectangle");
      const original = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#24ba98"/></svg>');
      deck.slides[0].scene.files = { original: { id: "original", mimeType: "image/svg+xml", dataURL: original, originalDataURL: original, created: 1 } };
      deck.slides[0].scene.elements.push({ ...shape, id: "original-image", type: "image", fileId: "original", status: "saved", scale: [1, 1], x: 920, y: 480, width: 200, height: 120, boundElements: null, groupIds: [] });
      const hidden = structuredClone(deck.slides[0]); hidden.id = "hidden-slide"; hidden.title = "HIDDEN SLIDE"; hidden.hidden = true; hidden.notes = "HIDDEN NOTES";
      deck.slides.push(hidden); return deck;
    });
    await reopenStudio(page);
    const bundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/slide-studio-deck.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioDeckStorage", write: false });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async document => {
      const storage = window.StudioDeckStorage;
      const reference = await storage.saveStudioDeck(storage.studioDeckReference("publish-case"), document);
      window.__rkDevEdit("work.0.study.nativeDeck", { ...reference, slideCount: document.slides.length });
      window.__rkDevEdit("work.0.study.blocks", [{ type: "statement", body: "Visible shared section" }, { type: "statement", body: "UNPUBLISHED CASE SECTION", off: true }]);
    }, document);
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "PRIVATE INITIAL NOTES");
    await page.locator('.merge-slide').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'HIDDEN NOTES');
    await page.locator('.merge-slide').first().click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'PRIVATE INITIAL NOTES');
    await page.locator(".merge-notes-input").fill("PRIVATE CURRENT NOTES");
    await page.locator("[data-publish]").click();
    await page.locator('.pass--lock input[type="password"]').first().fill(passphrase);
    const confirmation = page.locator(".pass--lock [data-confirm]"); if (await confirmation.count()) await confirmation.fill(passphrase);
    await page.locator(".pass--lock [data-go]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-done"));
    assert.equal(writes.length, 1); assert.equal(publicUploads.length, 0, "Private assets must never be uploaded to public hosting");
    assert.equal(latest.work[0].study.nativeDeckPublic, undefined);
    assert.doesNotMatch(JSON.stringify(latest), /PRIVATE CURRENT NOTES|UNPUBLISHED CASE SECTION|HIDDEN SLIDE|nativeDeck"/);
    const privateEnvelope = latest.work[0].study.nativeDeckEnc;
    const savedOwner = await rkDecWithSek(await rkUnwrapSek(passphrase, privateEnvelope.wraps.owner), privateEnvelope);
    assert.equal(savedOwner.document.slides[0].notes, "PRIVATE CURRENT NOTES");
    assert.equal(savedOwner.document.slides.length, 2);
    assert.match(savedOwner.document.slides[0].scene.files.original.originalDataURL, /^rkenc:/);
    await page.locator(".merge-visibility summary").click();
    assert.match(await page.locator(".merge-visibility-status").innerText(), /owner-only/);
    await page.getByRole("checkbox", { name: "Public slideshow", exact: true }).click();
    await page.getByRole("button", { name: "Set public draft", exact: true }).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === true);
    const previousPublished = JSON.stringify(latest);
    failNext = true;
    await page.locator("[data-publish]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-error"));
    assert.equal(JSON.stringify(latest), previousPublished, "A failed publish must keep the previously live version");
    assert.equal(await page.locator(".merge-notes-input").innerText(), "PRIVATE CURRENT NOTES");
    await page.locator("[data-publish]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-done"));
    assert.equal(latest.work[0].study.nativeDeckPublic.slides.length, 1);
    assert.ok(publicUploads.some(bytes => bytes.equals(Buffer.from(document.slides[0].scene.files.original.originalDataURL.split(',')[1], 'base64'))), "Public upload must preserve original SVG bytes");
    assert.doesNotMatch(JSON.stringify(latest.work[0].study.nativeDeckPublic), /PRIVATE|HIDDEN|notes|durationMinutes/);
    assert.equal(latest.work[0].study.blocks.length, 1);
    await page.locator('.merge-slide').nth(1).click();
    await page.waitForFunction(() => document.querySelector('[data-publish]')?.hidden === true, null, { timeout: 5000 }).catch(async error => {
      const changes = await page.evaluate(async () => {
        const current = window.__RKStudio.getDraft().work[0].study.nativeDeck, published = window.RK.studioPublished.work[0].study.nativeDeck;
        const before = await window.StudioDeckStorage.loadStudioDeck(published), after = await window.StudioDeckStorage.loadStudioDeck(current);
        const differences = [];
        const scan = (first, second, path = '') => {
          if (JSON.stringify(first) === JSON.stringify(second)) return;
          if (first && second && typeof first === 'object' && typeof second === 'object') for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) scan(first[key], second[key], path + '.' + key);
          else if (!/appState|versionNonce|updated|\.version$|\.selected$/.test(path)) differences.push({ path, before: first, after: second });
        };
        scan(before.document, after.document);
        return { current, published, differences };
      });
      throw new Error('Navigation changed published content: ' + JSON.stringify(changes), { cause: error });
    });
    assert.match(await page.locator('.adm__statusbar .adm__status').innerText(), /Published|All changes published/);
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await page.reload(); await page.waitForFunction(() => typeof window.__rkDevStudio === 'function' && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio()); await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    assert.match(await page.locator('.adm__status').innerText(), /Published|All changes published/);
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await fresh.route('**/*', routes);
    await fresh.addInitScript(() => localStorage.setItem('rk:dev:stub', '1'));
    const newDevice = await fresh.newPage();
    try {
      await reopenStudio(newDevice);
      await newDevice.locator('[data-act="study-toggle"][data-index="0"]').click();
      await newDevice.locator('.pass--lock input[type="password"]').fill(passphrase);
      assert.equal(await newDevice.locator('.pass--lock [data-confirm]').count(), 0, 'Existing deck protection must not create a new recovery passphrase');
      await newDevice.locator('.pass--lock [data-go]').click();
      await newDevice.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'PRIVATE CURRENT NOTES');
      assert.equal(await newDevice.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[1].body), 'UNPUBLISHED CASE SECTION');
      await newDevice.locator('.merge-notes-input').fill('Private change on new device');
      await newDevice.locator('[data-l2-back]').click();
      await newDevice.waitForSelector('.merge-shell', { state: 'detached' });
      assert.ok(await newDevice.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck?.revision > 0));
    } finally { await fresh.close(); }
    await page.evaluate(() => document.querySelectorAll('.pass--lock').forEach(dialog => dialog.remove()));
    await page.locator('.adm__tab[data-tab="work"]').click();
    await openProjectSlides(page);
    await page.waitForFunction(() => !!document.querySelector('.merge-visibility summary') && document.querySelector('.merge-layout-toggle')?.disabled === false);
    await page.locator('.merge-visibility summary').click();
    await page.getByRole('checkbox', { name: 'Public slideshow', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === false);
    const publishingNotes = page.locator('.merge-notes-input');
    await publishingNotes.fill('');
    await publishingNotes.evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', '\n  <p>Private sync notice</p>\n  <p>Continuous import</p>\n  <p><br></p>\n  <p>Google import</p>\n');
      element.dispatchEvent(new ClipboardEvent('paste', {clipboardData,bubbles:true,cancelable:true}));
    });
    await publishingNotes.press('Tab');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', {state:'detached'});
    await openProjectSlides(page);
    await page.waitForFunction(()=>document.querySelector('.merge-notes-input')?.textContent.includes('Private sync notice'));
    const publishedNotes = await page.evaluate(() => new Promise((resolve, reject) => {
      const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const request = indexedDB.open('rk-studio-slide-decks-v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result, record = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]);
        record.onsuccess = () => {
          database.close();
          const deck = record.result?.document, notes = deck?.slides.find(slide => slide.id === deck.selected)?.notes;
          resolve(notes);
        };
        record.onerror = () => { database.close(); reject(record.error); };
      };
    }));
    assert.match(publishedNotes, /Private sync notice/);
    assert.doesNotMatch(publishedNotes, />[\r\n\t ]+</);
    const publicUploadCount = publicUploads.length;
    holdWrite = true;
    await page.locator('[data-publish]').click();
    await page.locator('.pass--lock input[type="password"]').fill(passphrase);
    await page.locator('.pass--lock [data-go]').click();
    await page.waitForFunction(() => document.querySelector('.adm__status')?.textContent.includes('Publishing your content'));
    const newNotes = 'NEWER UNPUBLISHED PRIVATE NOTES';
    await page.locator('.merge-notes-input').fill(newNotes);
    await page.locator('.merge-notes-input').press('Tab');
    assert.ok(releaseWrite, 'The mocked service must be holding the current publication');
    releaseWrite();
    await page.waitForFunction(() => document.querySelector('.adm__statusbar')?.classList.contains('is-pub-done'));
    await page.waitForFunction(() => document.querySelector('.adm__statusbar .adm__status')?.textContent.includes('unpublished'));
    assert.equal(latest.work[0].study.slidesPublic, false);
    assert.equal(latest.work[0].study.nativeDeckPublic, undefined);
    assert.equal(publicUploads.length, publicUploadCount, 'Returning to owner-only must not upload any public deck assets');
    const privateAgain = latest.work[0].study.nativeDeckEnc;
    const publishedOwner = await rkDecWithSek(await rkUnwrapSek(passphrase, privateAgain.wraps.owner), privateAgain);
    assert.equal(publishedOwner.document.slides.find(slide => slide.id === publishedOwner.document.selected).notes, publishedNotes);
    assert.doesNotMatch(JSON.stringify(publishedOwner), /NEWER UNPUBLISHED PRIVATE NOTES/);
    assert.equal(await page.locator('.merge-notes-input').innerText(), newNotes);
    assert.equal(await page.locator('[data-publish]').isVisible(), true);
    await page.evaluate(() => Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }));
    for (const mounted of [true, false]) {
      if (!mounted) { await page.locator('[data-l2-back]').click(); await page.waitForSelector('.merge-shell', { state: 'detached' }); }
      await page.evaluate(async () => { window.hostPlayer = await window.RK.presentDeck(window.__RKStudio.getDraft().work[0], { autoStart: false }); });
      const waiting = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Open presenter window', exact: true }).click();
      const presenter = await waiting;
      const note = mounted ? 'Host presenter with editor' : 'Host presenter without editor';
      await presenter.locator('[data-pp-notes]').fill(note);
      await presenter.locator('[data-pp-notes]').press('Tab');
      await presenter.waitForFunction(() => document.querySelector('[data-pp-save]')?.textContent.includes('Saved on this device.'));
      await Promise.all([
        presenter.waitForEvent('close'),
        presenter.locator('[data-pp="exit"]').click().catch(error => {
          if (!presenter.isClosed() || !/Target page, context or browser has been closed/.test(error.message)) throw error;
        })
      ]);
      await page.waitForSelector('.pjp', { state: 'detached' });
      const savedNote = await page.evaluate(() => new Promise((resolve, reject) => {
        const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
        const request = indexedDB.open('rk-studio-slide-decks-v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result, document = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]);
          document.onsuccess = () => { database.close(); resolve(document.result.document.slides.find(slide => !slide.hidden).notes); };
          document.onerror = () => { database.close(); reject(document.error); };
        };
      }));
      assert.equal(savedNote, note);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("hosted editor loads empty, uses its save adapter and disposes without lab globals", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const host = await openIsolatedBrowserHost(page, process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510");
    await page.evaluate(async () => {
      const container = document.createElement("div"); container.id = "pilot";
      document.body.replaceChildren(container);
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/studio/slide-lab/assets/editor.css"; document.head.append(link);
      window.__RKStudio = { getDraft: () => ({ work: [{ id: "host-case", title: "Host case", study: { blocks: [{ type: "statement", body: "Host-owned section" }] } }] }) };
      window.hostSaves = [];
      const { mountSlideEditor } = await import("/studio/slide-lab/assets/editor.js");
      window.hostedEditor = mountSlideEditor(container, { caseStudyId: "host-case", title: "Host slides", load: async () => null, save: async document => { if (window.deferHostSave) await new Promise(resolve => { window.releaseHostSave = resolve; }); window.hostSaves.push(structuredClone(document)); } });
      await window.hostedEditor.ready;
    });
    assert.equal(page.url(), host);
    await page.locator(".merge-empty-actions button").first().click();
    await page.waitForFunction(() => window.hostSaves.at(-1)?.slides.length === 1);
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("Host notes, flushed before leaving");
    await page.evaluate(() => window.hostedEditor.flush());
    assert.equal(await page.evaluate(() => window.hostSaves.at(-1).slides[0].notes), "Host notes, flushed before leaving");
    assert.equal(await page.evaluate(() => typeof window.__slideMerge), "undefined");
    assert.equal(await page.locator(".merge-header").count(), 0);
    await page.getByRole("button", { name: "Sections", exact: true }).click();
    await page.locator(".merge-section-choices button").first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Host case", exact: true }).count(), 0, "The active case study must not need choosing again");
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.evaluate(() => { window.deferHostSave = true; });
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('A queued host write');
    await page.waitForFunction(() => typeof window.releaseHostSave === 'function');
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    await page.evaluate(() => { window.deferHostSave = false; window.releaseHostSave(); });
    await page.evaluate(() => window.hostedEditor.flush());
    await page.evaluate(() => window.hostedEditor.dispose());
    assert.equal(await page.locator(".merge-shell").count(), 0);
    const failure = await page.evaluate(async () => {
      const { mountSlideEditor } = await import("/studio/slide-lab/assets/editor.js");
      const editor = mountSlideEditor(document.querySelector("#pilot"), { caseStudyId: "failed", load: async () => { throw new Error("Missing deck revision"); }, save: async () => {} });
      try { await editor.ready; return "unexpected success"; } catch (error) { return error.message; } finally { editor.dispose(); }
    });
    assert.equal(failure, "Missing deck revision");
  } finally { await browser.close(); }
});

test("Content Studio opens native slides without a preview flag and preserves case drafts", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem("rk:dev:stub", "1"));
    await page.route("**/*", route => {
      const request = route.request();
      if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__rkDevEdit && document.querySelector(".adm.is-open"));
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.evaluate(() => window.__rkDevEdit("work", [
      { id: "native-first", title: "Native first case", study: { blocks: [{ type: "statement", body: "First case section" }], slides: [{ layout: "title", slots: { title: "Disposable v0 slide" } }] } },
      { id: "native-second", title: "Native second case", study: { blocks: [{ type: "statement", body: "Second case section" }] } }
    ]));
    await page.locator('.adm__tab[data-tab="work"]').click();
    const hostStyle = await page.locator('.adm__tab[data-tab="work"]').evaluate(element => {
      const style = getComputedStyle(element); return { font: style.fontFamily, fontSize: style.fontSize, radius: style.borderRadius, height: element.getBoundingClientRect().height };
    });
    await openProjectSlides(page);
    await page.locator(".merge-empty-actions button").first().waitFor();
    assert.equal(await page.locator(".merge-header").count(), 0);
    assert.equal(await page.locator("[data-native-slide-toolbar] .merge-editor-bar:visible").count(), 1);
    assert.equal(await page.locator(".adm__statusbar .adm__status:visible").count(), 1);
    assert.equal(await page.locator("[data-native-slide-status] .merge-visibility:visible").count(), 1);
    assert.equal(await page.getByRole('contentinfo', { name: 'Document status', exact: true }).count(), 1);
    assert.equal(await page.locator(".slides__nav:visible,.slides__props:visible").count(), 0);
    await page.locator(".merge-empty-actions button").first().click();
    await page.getByRole('button', { name: 'Text (T)', exact: true }).click();
    await page.locator('.excalidraw__canvas.interactive').click({ position: { x: 600, y: 230 } });
    await page.keyboard.type('Native canvas content');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector('.merge-slide-list')?.textContent.includes('Untitled slide'));
    const savedText = await page.evaluate(async () => {
      const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('rk-studio-slide-decks-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]); request.onsuccess = () => resolve(request.result.document.slides[0].scene.elements.filter(element => element.type === 'text').map(element => element.text)); request.onerror = () => reject(request.error); }); } finally { database.close(); }
    });
    assert.deepEqual(savedText, ['Native canvas content'], 'Leaving flushes an active native text editor');
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("FIRST PRIVATE NOTE");
    await page.locator('[data-native-slide-history]').getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.merge-notes-input')?.textContent==='');
    await page.locator('[data-native-slide-history]').getByRole('button',{name:'Redo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.merge-notes-input')?.textContent==='FIRST PRIVATE NOTE');
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work.map(work=>work.study.blocks[0].body)),['First case section','Second case section'],'Native history must not step Content Studio history');
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator("[data-l2-back]").click();
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "FIRST PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    await openProjectSlides(page, 1);
    await page.locator(".merge-empty-actions button").first().waitFor();
    await page.locator(".merge-empty-actions button").first().click();
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("SECOND PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    const references = await page.evaluate(() => window.__RKStudio.getDraft().work.map(work => work.study.nativeDeck));
    assert.notEqual(references[0].id, references[1].id);
    assert.equal(references[0].caseStudyId, "native-first");
    assert.equal(references[1].caseStudyId, "native-second");
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft").includes("PRIVATE NOTE")), false);
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.locator('.adm__tab[data-tab="work"]').click();
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "FIRST PRIVATE NOTE");
    assert.equal(await page.evaluate(() => typeof window.__slideMerge), "undefined");
    await page.locator('.merge-notes-input').press('Tab');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.merge-notes-input').innerText(), 'FIRST PRIVATE NOTE', 'Empty native Undo must not step host history');
    for (const width of [1440, 1060, 1024, 1023, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => {
        const shell = document.querySelector('.merge-shell').getBoundingClientRect(), main = document.querySelector('.adm__main').getBoundingClientRect(), bar = document.querySelector('.adm__workbar').getBoundingClientRect(), footer = document.querySelector('.adm__statusbar').getBoundingClientRect();
        const brand = document.querySelector('.adm__brand').getBoundingClientRect(), tabs = document.querySelector('.adm__tabswrap').getBoundingClientRect(), actions = document.querySelector('.adm__actions').getBoundingClientRect(), nav = document.querySelector('.adm__tabs');
        return { shell: shell.toJSON(), main: main.toJSON(), bar: bar.toJSON(), footer: footer.toJSON(), overflow: document.documentElement.scrollWidth > innerWidth, brand: brand.toJSON(), tabs: tabs.toJSON(), actions: actions.toJSON(), tabOverflow: nav.scrollWidth - nav.clientWidth > 2, flippers: [...document.querySelectorAll('[data-tabflip]')].map(button => !button.hidden) };
      });
      if (width >= 1024) {
        assert.ok(Math.abs((geometry.brand.top + geometry.brand.bottom - geometry.actions.top - geometry.actions.bottom) / 2) < 1, 'Brand and actions must share one row');
        assert.ok(Math.abs((geometry.tabs.top + geometry.tabs.bottom - geometry.actions.top - geometry.actions.bottom) / 2) < 1, 'Tabs must remain beside the actions');
        assert.ok(geometry.brand.right <= geometry.tabs.left && geometry.tabs.right <= geometry.actions.left, 'The nav groups must not overlap');
      } else assert.ok(geometry.tabs.top >= Math.max(geometry.brand.bottom, geometry.actions.bottom), 'Narrow screens keep a separate tabs row');
      assert.deepEqual(geometry.flippers, [geometry.tabOverflow, geometry.tabOverflow]);
      assert.ok(geometry.shell.height > 400 && geometry.shell.width > width - 50, JSON.stringify(geometry));
      assert.ok(geometry.shell.top >= geometry.bar.bottom && geometry.shell.bottom <= geometry.footer.top + 1, JSON.stringify(geometry));
      assert.ok(geometry.shell.top - geometry.bar.bottom < 80, 'The host title row must not retain the old inspector padding');
      assert.equal(geometry.overflow, false);
      await assertStudioToolbar(page.locator('.adm > .adm__workbar'));
      await page.screenshot({ path: join(tmpdir(), `rk-studio-native-pilot-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      window.originalDeckTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, mode, ...options) {
        if (this.name === 'rk-studio-slide-decks-v1' && mode === 'readwrite') throw new DOMException('Test storage quota', 'QuotaExceededError');
        return window.originalDeckTransaction.call(this, names, mode, ...options);
      };
    });
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('Pending notes must stay open');
    await page.locator('[data-l2-back]').click();
    await page.waitForFunction(() => document.querySelector('.adm__statusbar .adm__status')?.textContent.includes('Not saved'));
    assert.equal(await page.locator('.merge-notes-input').innerText(), 'Pending notes must stay open');
    assert.equal(await page.locator('.merge-shell').count(), 1);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalDeckTransaction; delete window.originalDeckTransaction; });
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'Pending notes must stay open');
    await page.locator('.merge-visibility summary').click();
    assert.equal(await page.getByRole('checkbox', { name: 'Public slideshow', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: 'Public slideshow', exact: true }).isEnabled(), true);
    assert.match(await page.locator('.merge-visibility-status').innerText(), /not published/);
    await page.keyboard.press('Escape');
    await page.locator('[data-opensettings]').click();
    await page.locator('[data-act="settings-cat"][data-cat="backup"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-act="backup-dl"]').click();
    const download = await downloading.catch(async error => {
      error.message += '\nBackup status: ' + await page.locator('.adm__statusbar .adm__status').innerText();
      throw error;
    });
    const downloadPath = await download.path();
    const downloaded = JSON.parse(readFileSync(downloadPath, 'utf8'));
    assert.equal(downloaded.nativeDecksBackup.documents.length, 2);
    assert.ok(downloaded.nativeDecksBackup.documents.some(record => record.document.slides[0].notes === 'Pending notes must stay open'));
    const choosingFile = page.waitForEvent('filechooser');
    await page.locator('[data-act="backup-restore"]').click();
    await (await choosingFile).setFiles(downloadPath);
    await page.locator('[data-bkr-work="native-second"]').uncheck();
    await page.locator('.bkr [data-go]').click();
    await page.waitForSelector('.bkr', { state: 'detached' });
    const recoveredReferences = await page.evaluate(() => window.__RKStudio.getDraft().work.map(work => work.study.nativeDeck));
    assert.notEqual(recoveredReferences[0].id, references[0].id);
    assert.equal(recoveredReferences[1].id, references[1].id);
    await page.locator('.adm__tab[data-tab="work"]').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), references[0].id, 'Undo recovery must restore the previous native deck identity');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), recoveredReferences[0].id, 'Redo recovery must reinstate the recovered native deck');
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'Pending notes must stay open');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    assert.equal(await page.locator('link[href*="assets/editor.css"]').count(), 0, 'Editor styles must unload when the workspace closes');
    assert.deepEqual(await page.locator('.adm__tab[data-tab="work"]').evaluate(element => {
      const style = getComputedStyle(element); return { font: style.fontFamily, fontSize: style.fontSize, radius: style.borderRadius, height: element.getBoundingClientRect().height };
    }), hostStyle, 'The native editor must not alter the host navigation after unmount');
    await page.locator('[data-act="work-dup"][data-index="0"]').click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work.length === 3);
    const duplicate = await page.evaluate(() => { const [original, copied] = window.__RKStudio.getDraft().work; return { original: original.study.nativeDeck.id, copied: copied.study.nativeDeck.id, caseId: copied.id, owner: copied.study.nativeDeck.caseStudyId, hidden: copied.hidden }; });
    assert.notEqual(duplicate.copied, duplicate.original);
    assert.equal(duplicate.owner, duplicate.caseId);
    assert.equal(duplicate.hidden, true);
    await page.evaluate(() => window.__rkDevEdit('work.0.study.nativeDeck', { schema: 'rk-studio-native-deck', version: 1, caseStudyId: 'native-first', id: 'missing-native-deck', revision: 3 }));
    await openProjectSlides(page);
    await page.waitForFunction(() => document.querySelector('.adm__statusbar .adm__status')?.textContent.includes('not available on this device'));
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached', timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), 'missing-native-deck');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

for (const publicationRoute of ['live-content', 'direct-git']) test('section lock publishes ciphertext and returns the owner editor to sealed rows: ' + publicationRoute, {timeout:90000}, async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),pass='synthetic-section-publish-only';
    await page.addInitScript(route=>{
      if (route === 'live-content') {
        window.__rkAdminAuth = { session: { token: 'synthetic-local-test', exp: Date.now() + 3600000 }, trust: { token: 'synthetic-local-test', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
      } else localStorage.setItem('rk:gh:token','synthetic-direct-git-token');
      localStorage.setItem('rk:autopub:on','0');
    },publicationRoute);
    let latest,pending,fail=true,writes=0,holdWrite,releaseWrite;
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname.endsWith('/content.json') && latest)return route.fulfill({contentType:'application/json',body:JSON.stringify(latest)});
      if(url.pathname==='/admin/content'){
        assert.equal(publicationRoute,'live-content');
        if(request.method()==='GET')return route.fulfill({json:{conditional:true,protocol:1}});
        assert.equal(request.headers()['x-content-base'],await contentRevision(latest));
        writes++;
        if(fail)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic publish failure"}'});
        if(holdWrite)await new Promise(resolve=>{releaseWrite=resolve;holdWrite();holdWrite=null;});
        latest=request.postDataJSON();return route.fulfill({json:{ok:true,revision:await contentRevision(latest),git:{ok:true}}});
      }
      if(url.hostname==='api.github.com'){
        assert.equal(publicationRoute,'direct-git');
        let response={sha:'synthetic-object'};
        if(url.pathname.endsWith('/git/ref/heads/main'))response={object:{sha:'synthetic-head'}};
        else if(url.pathname.endsWith('/git/commits/synthetic-head'))response={tree:{sha:'synthetic-tree'}};
        else if(url.pathname.endsWith('/git/trees/synthetic-tree'))response={tree:[{path:'content.json',type:'blob',sha:'synthetic-content'}]};
        else if(url.pathname.endsWith('/git/blobs/synthetic-content'))response={encoding:'base64',content:Buffer.from(JSON.stringify(latest)).toString('base64')};
        else if(url.pathname.endsWith('/git/blobs'))pending=JSON.parse(Buffer.from(request.postDataJSON().content,'base64').toString('utf8'));
        else if(url.pathname.endsWith('/git/refs/heads/main')){
          writes++;
          if(fail)return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic publish failure"}'});
          if(holdWrite)await new Promise(resolve=>{releaseWrite=resolve;holdWrite();holdWrite=null;});
          latest=pending;
        }
        return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
      }
      if(url.pathname.includes('/assets/protected/'))return route.abort();
      if(url.hostname==='rk-ai-proxy.riteshkumarhk.workers.dev')return route.fulfill({status:url.pathname.includes('/vault/')?503:200,contentType:'application/json',body:url.pathname.includes('publish')?'{"enabled":false}':'{}'});
      if(!['127.0.0.1','localhost'].includes(url.hostname)&&!['GET','HEAD'].includes(request.method()))return route.abort();
      return route.fallback();
    });
    latest=await openIntegratedFixture(page,[{type:'text',heading:'PRIVATE HEADING',body:'PRIVATE SECTION CONTENT',nav:'Section'}]);
    await page.evaluate(()=>window.__rkDevEdit('specialViews',[]));
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('[data-act="study-blocktoggle"][data-bindex="0"]').click();
    await page.locator('[data-rtfield="body"]').first().waitFor({state:'visible'});
    await page.locator('[data-act="study-blocklock"][data-bindex="0"]:visible').first().click();
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].locked),true);
    const lockedDraft=await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('[data-publish]').click();
    const recovery=page.locator('.pass--lock').filter({has:page.getByText('Set a recovery passphrase',{exact:true})});
    await recovery.locator('input[type="password"]').first().fill(pass);
    await recovery.locator('[data-confirm]').fill(pass);
    assert.deepEqual(await recovery.locator('input[type="password"]').evaluateAll(inputs=>inputs.map(input=>input.value)),[pass,pass]);
    await recovery.locator('[data-go]').click();
    await page.waitForFunction(()=>document.querySelector('.adm__statusbar')?.classList.contains('is-pub-error')).catch(async error=>{
      const state=await page.evaluate(()=>({status:document.querySelector('.adm__statusbar')?.innerText,dialogs:[...document.querySelectorAll('.pass__title,.pass__err')].map(element=>element.textContent)}));
      throw new Error(JSON.stringify({route:publicationRoute,writes,...state}),{cause:error});
    });
    assert.equal(writes,1);assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].body),'PRIVATE SECTION CONTENT');
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),lockedDraft);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:content:draft')),lockedDraft);
    fail=false;
    await page.locator('[data-publish]').click();
    await page.waitForFunction(()=>document.querySelector('.adm__statusbar')?.classList.contains('is-pub-done'));
    assert.doesNotMatch(JSON.stringify(latest),/PRIVATE HEADING|PRIVATE SECTION CONTENT/);
    const sealed=latest.work[0].study.blocks[0];assert.equal(sealed.encStub,true);
    const original=await rkDecWithSek(await rkUnwrapSek(pass,latest.work[0].study.enc.wraps.owner),sealed);
    assert.equal(original.body,'PRIVATE SECTION CONTENT');
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),sealed);
    assert.deepEqual(await page.evaluate(()=>window.RK.studioPublished.work[0].study.blocks[0]),sealed);
    assert.equal(await page.locator('[data-publish]').isHidden(),true);
    assert.equal(await page.locator('[data-rtfield="body"]').count(),0);
    assert.match(await page.locator('.study__block').first().innerText(),/protected|encrypted|Unlock to edit/i);
    await page.locator('[data-act="study-decrypt"]').first().click();
    await page.waitForFunction(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].body==='PRIVATE SECTION CONTENT');
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].locked),true);
    const body=page.locator('[data-rtfield="body"]').first();
    await body.waitFor({state:'attached'});
    if(!await body.isVisible())await page.locator('[data-act="study-blocktoggle"][data-bindex="0"]').click();
    await body.waitFor({state:'visible'});
    await body.fill('PRIVATE UPDATED CONTENT');await body.blur();
    const editedBlock=await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]);
    assert.match(editedBlock.body,/PRIVATE UPDATED CONTENT/);
    const writeStarted=new Promise(resolve=>{holdWrite=resolve;});
    await page.locator('[data-publish]').click();
    await writeStarted;
    await body.fill('PRIVATE CONCURRENT CONTENT');await body.blur();
    const concurrentBlock=await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]);
    releaseWrite();
    await page.waitForFunction(()=>document.querySelector('.adm__statusbar')?.classList.contains('is-pub-done'));
    assert.doesNotMatch(JSON.stringify(latest),/PRIVATE UPDATED CONTENT|PRIVATE CONCURRENT CONTENT/);
    const committed=latest.work[0].study.blocks[0];
    assert.deepEqual(await rkDecWithSek(await rkUnwrapSek(pass,latest.work[0].study.enc.wraps.owner),committed),editedBlock);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),concurrentBlock);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:content:draft')).work[0].study.blocks[0]),concurrentBlock);
    assert.deepEqual(await page.evaluate(()=>window.RK.studioPublished.work[0].study.blocks[0]),committed);
    assert.equal(await page.locator('[data-publish]').isVisible(),true);
    await page.locator('[data-publish]').click();
    await page.waitForFunction(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].encStub===true&&document.querySelector('.adm__statusbar')?.classList.contains('is-pub-done'));
    assert.doesNotMatch(JSON.stringify(latest),/PRIVATE CONCURRENT CONTENT/);
    const resealed=latest.work[0].study.blocks[0];
    const updated=await rkDecWithSek(await rkUnwrapSek(pass,latest.work[0].study.enc.wraps.owner),resealed);
    assert.deepEqual(updated,concurrentBlock);assert.equal(updated.locked,true);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),resealed);
    await page.reload();await page.waitForFunction(()=>typeof window.__rkDevStudio==='function'&&!!window.RK?.data);
    await page.evaluate(()=>window.__rkDevStudio());await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),resealed);
    assert.equal(await page.locator('[data-publish]').isHidden(),true);
    assert.equal(writes,4);
  } finally {await browser.close();}
});

test("live fallback resume PDF retains all twelve achievements at every density", { timeout: 60000 }, async () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const functions = ["ensureJsPdf", "ensurePdfJs", "atsRbBuild", "rpdfPlain"].map(name => {
    const start = source.indexOf("  function " + name + "("), end = source.indexOf("\n  }", start) + 4;
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Synthetic PDF retention check</title>");
    await page.evaluate(() => Object.assign(window, {
      atsRbSize: () => ({ fmt: "a4", w: 210, h: 297 }), atsRbTpl: () => ({ head: "plain" }),
      RB_FONTS: { sans: { pdf: "helvetica" } }, atsRbFont: "sans", syntheticMargin: 14, atsRbMarginCfg: () => ({ mm: window.syntheticMargin }),
      atsRbAccentRgb: () => [100, 100, 100], atsRbLayout: "single", atsRbKeepWhole: true,
      RB_ICON_CACHE: {}, rbHex: () => "#000000", RPDF_NL: "\n"
    }));
    await page.addScriptTag({ content: functions.join("\n") });
    const results = await page.evaluate(async () => {
      const Pdf = await ensureJsPdf(), reader = await ensurePdfJs(), results = [];
      const bullets = Array.from({ length: 12 }, (_, index) => "Retained achievement " + String(index + 1).padStart(2, "0") + ": " + "Original authored detail remains intact. ".repeat(45) + "End of achievement " + (index + 1) + ".");
      for (const margin of [8,14,20]) for (const density of [1.08, 1, 0.9, 0.72]) {
        window.syntheticMargin = margin;
        const output = atsRbBuild(Pdf, { name: "Synthetic validation", sections: [{ kind: "experience", heading: "Experience", items: [{ role: "Designer", bullets }] }] }, { k: density });
        const pdf = await reader.getDocument({ data: new Uint8Array(output.doc.output("arraybuffer")), isEvalSupported: false }).promise;
        const text = [], outside = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const sheet = await pdf.getPage(pageNumber), viewport = sheet.getViewport({ scale: 1 }), content = await sheet.getTextContent();
          for (const item of content.items) {
            text.push(item.str);
            if (item.str.trim() && (item.transform[5] < 0 || item.transform[5] > viewport.height)) outside.push(item.str);
          }
        }
        const extracted = text.join(" ").replace(/\s+/g, " ");
        const firstPage = await pdf.getPage(1), firstText = await firstPage.getTextContent();
        results.push({ margin, density, pages: pdf.numPages, retained: bullets.filter(bullet => extracted.includes(bullet)).length, outside, firstTextX: firstText.items.find(item => item.str === 'Synthetic validation').transform[4] });
        await pdf.destroy();
      }
      return results;
    });
    for (const result of results) {
      assert.equal(result.retained, 12, JSON.stringify(result));
      assert.deepEqual(result.outside, [], "Text must stay on a PDF page");
      assert.ok(result.pages > 1, "The fixture must exercise pagination");
      assert.ok(Math.abs(result.firstTextX-result.margin*72/25.4)<0.1,'The exported PDF must use the selected margin');
    }
  } finally { await browser.close(); }
});

test("Studio stale-tab publication keeps the local draft and newer remote document", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let latest, rejected = 0;
    await page.addInitScript(() => {
      window.__rkAdminAuth = { session: { token: 'synthetic-session', exp: Date.now() + 60000 }, trust: { token: 'synthetic-trust', exp: Date.now() + 60000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
      localStorage.setItem("rk:autopub:on", "0");
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.endsWith("/content.json") && latest) return route.fulfill({ json: latest });
      if (url.pathname === "/admin/content") {
        if (request.method() === "GET") return route.fulfill({ json: { conditional: true, protocol: 1 } });
        assert.notEqual(request.headers()["x-content-base"], await contentRevision(latest));
        rejected++;
        return route.fulfill({ status: 412, json: { conflict: true, error: "Published content changed since this draft was opened. Your draft is kept." } });
      }
      if (url.hostname === "rk-ai-proxy.riteshkumarhk.workers.dev") return route.fulfill({ json: url.pathname.includes("publish") ? { enabled: false } : {} });
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.fallback();
    });
    latest = structuredClone(await openIntegratedFixture(page));
    const originalRevision = await page.evaluate(() => window.RK.publishedRevision);
    await page.evaluate(() => { window.__rkDevEdit("specialViews", []); window.__rkDevEdit("work.0.title", "Local unsaved revision"); });
    const draft = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft()));
    latest.work[0].title = "Newer remote revision";
    const remote = JSON.stringify(latest);
    await page.locator("[data-publish]").click();
    await page.waitForFunction(() => document.querySelector(".adm__statusbar")?.classList.contains("is-pub-error"));
    assert.equal(rejected, 1);
    assert.match(await page.locator(".adm__statusbar").innerText(), /changed since|draft is kept/i);
    assert.equal(JSON.stringify(latest), remote);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft())), draft);
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft")), draft);
    assert.equal(await page.evaluate(() => window.RK.publishedRevision), originalRevision);
  } finally { await browser.close(); }
});

test('published section resealing preserves slides, disabled blocks and concurrent edits', async()=>{
  const {resealPublishedSections}=await import('./src/js/slide-studio-publication.mjs');
  const snapshot={work:[{id:'case',study:{blocks:[{type:'text',body:'Public'},{type:'text',off:true,locked:true,body:'Disabled secret'},{type:'media',locked:true,heading:'Secret',items:[{src:'original.png'}]}],nativeDeck:{id:'keep-deck'},slides:[{notes:'Keep notes'}]}}]};
  const published={work:[{id:'case',study:{blocks:[{type:'text',body:'Public'},{type:'media',locked:true,encStub:true,iv:'iv',ct:'cipher'}],enc:{wraps:{owner:'owner'}}}}]};
  const current=structuredClone(snapshot);
  current.work[0].title='Newer metadata';
  current.work[0].study.nativeDeck.revision=2;
  current.work[0].study.slides[0].notes='Newer notes';
  const preserved=structuredClone(current.work[0]);
  assert.deepEqual(resealPublishedSections(current,snapshot,published),['case']);
  assert.deepEqual(current.work[0].study.blocks[2],published.work[0].study.blocks[1]);
  assert.equal(current.work[0].title,preserved.title);
  assert.deepEqual(current.work[0].study.nativeDeck,preserved.study.nativeDeck);
  assert.deepEqual(current.work[0].study.slides,preserved.study.slides);
  assert.deepEqual(current.work[0].study.blocks[1],snapshot.work[0].study.blocks[1]);
  assert.deepEqual(current.work[0].study.enc,published.work[0].study.enc);
  const edited=structuredClone(snapshot);edited.work[0].study.blocks[2].heading='Edited during publish';
  assert.deepEqual(resealPublishedSections(edited,snapshot,published),[]);assert.equal(edited.work[0].study.blocks[2].heading,'Edited during publish');
  for (const mutate of [
    study=>study.blocks.reverse(),
    study=>study.blocks.push({type:'text',body:'New section'}),
    study=>{study.blocks[2].locked=false;},
    study=>{study.enc={wraps:{owner:'newer-recovery'}};}
  ]) {
    const concurrent=structuredClone(snapshot);mutate(concurrent.work[0].study);
    const before=structuredClone(concurrent);
    assert.deepEqual(resealPublishedSections(concurrent,snapshot,published),[]);
    assert.deepEqual(concurrent,before);
  }
  const failed=structuredClone(snapshot);assert.deepEqual(resealPublishedSections(failed,snapshot,snapshot),[]);assert.deepEqual(failed,snapshot);
  const vaulted=structuredClone(published);vaulted.work[0].study.blocks[1]={type:'media',locked:true,vaultBlock:'private-key'};
  const vaultDraft=structuredClone(snapshot);assert.deepEqual(resealPublishedSections(vaultDraft,snapshot,vaulted),['case']);assert.equal(vaultDraft.work[0].study.blocks[2].vaultBlock,'private-key');
});

test('case authoring imports original source files without AI and generates a grounded proposal', {timeout:60000}, async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    await page.addInitScript(()=>{
      const original=window.fetch;window.caseModelCalls=0;
      window.fetch=async(resource,options={})=>{
        const url=new URL(typeof resource==='string'?resource:resource.url,location.href);
        if(url.hostname!=='api.anthropic.com'||!url.pathname.endsWith('/messages'))return original(resource,options);
        window.caseModelCalls++;
        const request=JSON.parse(options.body);let text;
        if(request.system.startsWith("You are Studio's outcome coordinator.")){
          const input=JSON.parse(request.messages[0].content);
          text=JSON.stringify({decision:input.candidate?{action:'finish',summary:'Validated proposal'}:{action:'draft',modelRef:input.draftModels[0],task:'creative',instruction:'',inputs:[],summary:'Draft from evidence'}});
        }else {
          if(!request.system.includes('"excerptId":string')||!JSON.stringify(request.messages).includes('excerpts'))throw new Error('Missing excerpt citation contract');
          text=JSON.stringify({summary:'Grounded draft',outline:['Research'],questions:['What shipped?'],blocks:[{block:{type:'text',heading:'Research',body:'We interviewed 12 people.'},evidence:[{sourceId:'notes',excerptId:'e1'}]}]});
        }
        return Response.json({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5}});
      };
    });
    await openIntegratedFixture(page);await page.locator('[data-act="study-toggle"][data-index="0"]').click();await page.locator('[data-l2tab="gen"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-act="csgen-run"]').disabled);
    const original=await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    const filePromise=page.waitForEvent('filechooser');await page.locator('[data-act="csgen-pdf"]').click();
    await (await filePromise).setFiles({name:'evidence.txt',mimeType:'text/plain',buffer:Buffer.from('Original research source bytes.')});
    await page.locator('.csgen-source').waitFor();
    assert.equal(await page.evaluate(()=>window.caseModelCalls),0);
    const saved=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('rk-case-authoring-v1',1);request.onsuccess=()=>resolve(request.result);});const state=await new Promise(resolve=>{const request=db.transaction('projects').objectStore('projects').get('integrated-case');request.onsuccess=()=>resolve(request.result);});db.close();return {text:state.sources[0].text,original:await state.files[0].blob.text()};});
    assert.deepEqual(saved,{text:'Original research source bytes.',original:'Original research source bytes.'});
    const pdfStream='BT /F1 18 Tf 40 200 Td (We interviewed 12 people.) Tj ET';
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+pdfStream.length+' >>\nstream\n'+pdfStream+'\nendstream'];
    let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(index+1)+' 0 obj\n'+object+'\nendobj\n';});const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    const pdfChooser=page.waitForEvent('filechooser');await page.locator('[data-act="csgen-pdf"]').click();await (await pdfChooser).setFiles({name:'Figma-export.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});
    await page.waitForFunction(()=>document.querySelectorAll('.csgen-source').length===2);
    const pdfSaved=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('rk-case-authoring-v1',1);request.onsuccess=()=>resolve(request.result);});const state=await new Promise(resolve=>{const request=db.transaction('projects').objectStore('projects').get('integrated-case');request.onsuccess=()=>resolve(request.result);});db.close();return {text:state.sources[1].text,label:state.sources[1].label,image:state.sources[1].images[0].src.slice(0,23),original:await state.files[1].blob.text()};});
    assert.match(pdfSaved.text,/We interviewed 12 people/);assert.equal(pdfSaved.label,'Figma-export.pdf / Page 1');assert.equal(pdfSaved.image,'data:image/jpeg;base64,/' .slice(0,23));assert.equal(pdfSaved.original,pdf);assert.equal(await page.evaluate(()=>window.caseModelCalls),0);
    const sourceCode=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
    const extract=sourceCode.slice(sourceCode.indexOf('  async function pptxExtract('),sourceCode.indexOf('  function csgenAddPdf('));
    const slides=await page.evaluate(async extract=>{
      const xml={
        'ppt/presentation.xml':'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
        'ppt/slides/slide1.xml':'<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Second presented</a:t></root>',
        'ppt/slides/slide2.xml':'<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>First presented</a:t></root>',
        'ppt/slides/_rels/slide2.xml.rels':'<Relationships><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>',
        'ppt/notesSlides/notesSlide7.xml':'<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Correct first-slide notes</a:t></root>'
      };
      const ensureUnzip=async()=>({unzipSync:(_bytes,options)=>Object.fromEntries(Object.entries(xml).filter(([name,text])=>options.filter({name,originalSize:text.length})).map(([name,text])=>[name,new TextEncoder().encode(text)]))});
      const CASE_LIMITS={sources:80};
      return await eval('('+extract+')')(new ArrayBuffer(0));
    },extract);
    assert.match(slides[0].text,/First presented\nSPEAKER NOTES:\nCorrect first-slide notes/);assert.equal(slides[1].text,'Second presented');assert.equal(slides[0].images.length,0);assert.match(slides[0].warning,/not rendered/);
    await page.locator('[data-act="csgen-source"]').nth(1).uncheck();
    await page.locator('[data-csgen="material"]').fill('We interviewed 12 people.');
    await page.locator('[data-act="csgen-run"]').click();assert.equal(await page.evaluate(()=>window.caseModelCalls),0);
    await page.locator('[data-csgen="consent"]').check();await page.locator('[data-act="csgen-run"]').click();
    await page.locator('.csgen-review').waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),original);
    assert.match(await page.locator('.csgen-review__preview').innerText(),/12 people/);
    await page.locator('.csgen-review summary').filter({hasText:'Source evidence (1)'}).click();
    assert.equal(await page.locator('.csgen-review blockquote p').innerText(),'We interviewed 12 people.');
    assert.equal(await page.evaluate(()=>window.caseModelCalls),3);
    await page.locator('.csgen-review [data-cancel]').click();
    await page.locator('[data-act="csgen-review"]').click();assert.match(await page.locator('.csgen-review__preview').innerText(),/12 people/);
  }finally{await browser.close();}
});