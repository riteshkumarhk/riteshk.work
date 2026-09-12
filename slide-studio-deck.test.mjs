import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { rkDecWithSek, rkUnwrapSek } from "./src/js/admin-core.js";
import { assertStudioDeckPublishable, createStudioDeck, STUDIO_DECK_SCHEMA } from "./src/js/slide-studio-deck.mjs";
import { AI_AGENT_SYSTEM } from "./src/js/ai-task-agent.mjs";
import { COMPOSITION_RESPONSE_SCHEMA } from "./src/js/slide-merge-ai.mjs";

async function openProjectSlides(page, index = 0) {
  await page.locator('[data-act="study-toggle"][data-index="' + index + '"]').click();
  const tab = page.locator('[data-l2tab="slides"]');
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
}

async function openIntegratedFixture(page) {
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [
    { id: "integrated-case", client: "Studio fixture", title: "Integrated project", study: { blocks: [{ type: "text", heading: "Published heading", body: "Supported source content." }] } },
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
        if (url.origin === scenario.origin) return route.fulfill({response:await route.fetch({url:server + url.pathname + url.search})});
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
      await context.unrouteAll({behavior:'wait'});
      await context.close();
    }
  } finally { await browser.close(); }
});

async function installPrepareReplies(page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.preparationCalls = [];
    window.fetch = async (resource, options = {}) => {
      const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href);
      if (url.hostname !== 'api.anthropic.com' || !url.pathname.endsWith('/messages')) return original(resource, options);
      const request = JSON.parse(options.body), system = request.system;
      let text;
      if (system.startsWith("You are Studio's outcome coordinator.")) {
        const input = JSON.parse(request.messages[0].content);
        text = JSON.stringify({decision:input.candidate ? {action:'finish',summary:'Validated fixture result'} : {action:'draft',modelRef:input.draftModels[0],task:'writing',instruction:'',inputs:[],summary:'Use the selected evidence'}});
      } else {
        window.preparationCalls.push({system,user:JSON.stringify(request.messages)});
        if (system.includes('generate the questions a sharp interviewer')) text = JSON.stringify({questions:[{q:'Which decision changed the outcome?',category:'Decisions',why:'Explain the evidence'}]});
        else if (system.includes('propose a few DISTINCT')) text = JSON.stringify({themes:[{title:'Evidence led the decision',hook:'A grounded angle',beats:'Context decision outcome'}]});
        else if (system.includes('Script EXACTLY')) text = JSON.stringify({spine:'Evidence led the decision',opener:'Original source',beats:[{label:'Decision',mins:'5',say:'Explain the evidence',must:'Outcome'}],close:'Lessons',skip:'Details',tip:'Keep it clear'});
        else if (system.includes('Invent ONE crisp')) text = JSON.stringify({prompt:'A new synthetic exercise',context:'Explicit constraints',watchfor:['Clarity']});
        else if (system.includes('GAME PLAN')) text = JSON.stringify({clarifiers:['Who needs this?'],phases:[{label:'Frame',mins:'5',move:'Name the goal'}]});
        else if (system.includes('candidate has drafted')) text = JSON.stringify({verdict:'SAVED_COACHING_FEEDBACK',strong:['A clear user'],gaps:['Name the outcome']});
        else if (system.includes('panel debriefing')) text = JSON.stringify({scores:[{dim:'Problem framing',score:3,note:'A stated user need'}],overall:'SAVED_MOCK_SCORE',topfix:'Name the success measure'});
        else if (system.includes('COMPLETE, personalised cover letter')) text = 'Dear Hiring Team,\n\nMy work connects user evidence with clear product decisions. I would bring that approach to your design team.\n\nThank you for considering my application.\n\nSample candidate';
        else if (system.includes('interview practice coach')) {
          if (window.deferPracticeReply) { await new Promise(resolve => { window.releasePracticeReply = resolve; }); window.practiceReplyReturned = true; }
          text = JSON.stringify({verdict:'SPECIFIC_PRACTICE_FEEDBACK',strong:['A clear decision'],gaps:['Explain the trade-off'],evidence:['ORIGINAL_PRACTICE_EVIDENCE','INVENTED_SOURCE_QUOTE'],nextTry:'Name the alternative you rejected.',followup:'What alternative did you reject, and why?'});
        }
        else if (system.includes('ATS-optimisation expert')) {
          if (window.deferAtsReply) { await new Promise(resolve => { window.releaseAtsReply = resolve; }); window.atsReplyReturned = true; }
          text = JSON.stringify({score:70,band:'Good',summary:'ATS_RECHECK_RESULT',checks:[],fixes:[],keywords:{present:[],missing:[]}});
        }
        else text = '<p><strong>Grounded answer.</strong> Keep the original evidence.</p>';
      }
      return Response.json({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5}});
    };
  });
}

for (const width of [1440,390]) test("Prepare shared brief connects all five tools without replacing their flows at " + width + "px", {timeout:60000}, async () => {
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
      assert.equal(await modal.evaluate(element=>element.contains(document.activeElement)),true);
      await modal.getByRole('button',{name:'Use brief',exact:true}).click();
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
        await modal.locator('.iprep__q').waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep[0]);
        assert.equal(saved.payload.source.brief.id,brief.id);
        assert.match(saved.payload.source.text,/PERMITTED_PROJECT_EVIDENCE/);
        assert.doesNotMatch(saved.payload.source.text,/PRIVATE_PROJECT_EVIDENCE|LOCKED_SECTION_EVIDENCE/);
      } else if (tool === 'story') {
        assert.equal(await modal.locator('[data-story-jd-text]').inputValue(),'SHARED_JOB_REQUIREMENTS');
        assert.equal(await modal.locator('[data-story-tone].is-on').getAttribute('data-story-tone'),'vp');
        await modal.locator('[data-story-run]').click(); await modal.locator('[data-story-tell="0"]').waitFor();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).story[0]);
        assert.equal(saved.payload.source.brief.id,brief.id);
        assert.doesNotMatch(saved.payload.source.text,/PRIVATE_PROJECT_EVIDENCE|LOCKED_SECTION_EVIDENCE/);
      } else {
        assert.equal(await modal.locator('.wb__company').inputValue(),'TargetCo / Product design lead');
        assert.equal(await modal.locator('.wb__jd').inputValue(),'SHARED_JOB_REQUIREMENTS');
        assert.equal(await modal.locator('[data-wb-lvl].is-on').getAttribute('data-wb-lvl'),'exec');
      }
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
      await modal.locator(['ats','cl'].includes(tool) ? '[data-prep-close]' : '[data-cancel]').click();
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
    await page.locator('[data-iprep-run]').click();
    await page.locator('.iprep__q').waitFor();
    assert.equal(await page.getByRole('tab',{name:'Questions',exact:true}).getAttribute('aria-selected'),'true');
    await page.locator('[data-iprep-ans="0"]').click();
    await page.locator('.iprep__a strong').waitFor();
    const suggested = await page.locator('.iprep__a').innerHTML();
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    assert.equal(await page.locator('.iprep__a').isVisible(),false);
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
    await page.locator('[data-iprep-hist-open="'+first.id+'"]').click();
    assert.equal(await page.getByRole('tab',{name:'Questions',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('.iprep__a').innerHTML(),suggested);
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
    await page.locator('[data-iprep-hist-open="'+first.id+'"]').click();
    await page.getByRole('tab',{name:'Practice Q&A',exact:true}).click();
    await page.locator('[data-iprep-hist-del="'+first.id+'"]').click();
    await page.locator('.iprep-modal [data-cancel]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).iprep.length),0);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
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
    await page.locator('.iprep__q').waitFor();
    assert.match(await page.locator('[data-prep-storage]:visible').innerText(), /Not saved on this device/);
    assert.equal(await page.evaluate(() => localStorage.getItem('rk:prep:hist')), null);
    await page.locator('.iprep-modal [data-cancel]').click();
    await page.locator('[data-act="prep-open"][data-tool="iprep"]').click();
    await page.locator('[data-iprep-hist-open]').first().click();
    assert.match(await page.locator('.iprep__q').innerText(), /Which decision/);
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
    await page.locator('.iprep__q').waitFor();
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

test("Prepare Whiteboard keeps feedback, scorecards and prior targets when setup changes", {timeout:60000}, async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  try {
    await installPrepareReplies(page); await openIntegratedFixture(page);
    await page.evaluate(() => localStorage.setItem('rk:prep:brief',JSON.stringify({id:'original-role',company:'OriginalCo',role:'Staff designer',jd:'ORIGINAL_WB_ROLE',level:'staff',projectMode:'selected',projectIds:['integrated-case']})));
    await page.locator('.adm__tab[data-tab="ai"]').click();
    await page.locator('[data-act="prep-open"][data-tool="wb"]').click();
    await page.locator('.wb-modal [data-use-prep-brief]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:wb')).preparationBrief.id),'original-role');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('rk:wb')).fixedRole),true);
    await page.locator('.wb__own').fill('Original synthetic exercise');
    await page.locator('[data-wb-start]').click();
    await page.locator('.wb__draft').fill('I would first clarify the user need and choose a measurable outcome.');
    await page.locator('[data-wb-critique]').click();
    await page.getByText('SAVED_COACHING_FEEDBACK',{exact:true}).waitFor();
    const coach = await page.evaluate(() => JSON.parse(localStorage.getItem('rk:prep:hist')).wb[0]);
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
    await page.locator('.wb__own').fill('A mock synthetic exercise');
    await page.locator('[data-wb-start]').click();
    await page.locator('.wb__turn--int').waitFor();
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
    await page.clock.runFor(1200);
    await page.locator('[data-wb-rail-back]').click();
    const stopped = await page.locator('[data-wb-timer-t]').textContent();
    await page.clock.runFor(2100);
    assert.equal(await page.locator('[data-wb-timer-t]').textContent(), stopped);
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
    assert.equal(await page.getByRole('button',{name:'Generate case study',exact:true}).isEnabled(), true);
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
    await page.screenshot({path:join(tmpdir(), `rk-ai-options-ready-${width}.png`)});
    await page.locator('[data-case-ai-prepare]').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(tmpdir(), `rk-ai-options-ready-actions-${width}.png`)});
    for (const [action, selector] of [['fbrev','.fbrev-modal'],['iprep','.iprep-modal'],['story','.story-modal']]) {
      await page.locator('[data-act="case-ai-prepare"][data-prepare="'+action+'"]').click();
      await page.locator(selector).waitFor();
      if (action !== 'fbrev') assert.match(await page.locator(selector+' .pass__title').innerText(), /Integrated project/);
      await page.locator(selector+' [data-cancel]').click();
      await page.locator(selector).waitFor({state:'detached'});
    }
    assert.equal(requests.length, 0, 'Opening preparation tools must not start generation');
    await page.locator('[data-l2tab="slides"]').click();
    await page.locator('.merge-empty-actions').waitFor();
    const slideGeometry = await page.evaluate(() => {
      const back = document.querySelector('[data-l2-back]').getBoundingClientRect(), history = document.querySelector('[data-native-slide-toolbar] .merge-bar-state').getBoundingClientRect(), main = document.querySelector('.adm__main').getBoundingClientRect(), preview = document.querySelector('.adm__preview').getBoundingClientRect();
      return {ordered:back.right <= history.left, aligned:Math.abs(back.y-history.y)<2, fullCanvas:Math.abs(main.top-preview.top)<1};
    });
    assert.deepEqual(slideGeometry,{ordered:true,aligned:true,fullCanvas:true});
    assert.deepEqual(await back.evaluate(element => { const style = getComputedStyle(element, '::after'); return {width:style.width,height:style.height,pointerEvents:style.pointerEvents,content:style.content}; }), separator);
    await back.click();
    await page.locator('.merge-shell').waitFor({state:'detached'});
    assert.equal(await back.isVisible(), false);
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
    await slideLock.waitFor();
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
    await slideLock.click();
    await page.getByRole("checkbox", {name:"Public slideshow", exact:true}).click();
    await page.getByRole("button", {name:"Set public draft", exact:true}).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === true);
    assert.equal(await slideLock.locator(".lucide-lock-open").count(), 1);
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].hidden), true);
    await slideLock.click();
    await page.getByRole("checkbox", {name:"Public slideshow", exact:true}).click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.slidesPublic === false);
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
    assert.equal(await slideshow.getByRole('button', { name: 'Open presenter window', exact: true }).count(), 0);
    await slideshow.keyboard.press('p');
    assert.equal(await slideshow.locator('.pjp--presenting').count(), 0);
    await slideshow.close();
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('.merge-shell').waitFor();
    assert.equal(await page.locator('[data-l2tab="slides"]').getAttribute('aria-selected'), 'true');
    const toolbarOpened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Open slideshow in a new tab', exact: true }).click();
    const toolbarPreview = await toolbarOpened;
    await toolbarPreview.setViewportSize({width, height:1000});
    await toolbarPreview.waitForURL(/slideshow=1/);
    await toolbarPreview.locator('.pjp').waitFor({ state: 'visible' });
    const pad = page.frameLocator('[data-presenter-host]');
    await pad.locator('[data-pp-notes]').waitFor();
    await page.locator('.pjp-tab[data-ready="true"]').waitFor();
    assert.equal(context.pages().length, 2);
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
    await page.screenshot({path:join(tmpdir(), `rk-original-tab-dj-${width}.png`)});
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
    await page.locator('.pjp-tab[data-ready="true"]').waitFor();
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
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion:"no-preference" }), page = await context.newPage();
  const assertIdleSparkle = async () => {
    await page.waitForFunction(() => {
      const path = document.querySelector('.adm__ai-spark path'), turn = document.querySelector('.adm__ai-spark g');
      const values = path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
      return Math.abs(Math.hypot(values[72] - 12, values[73] - 12) - 3.5) < .001 && (!turn.getAttribute('transform') || turn.getAttribute('transform') === 'rotate(0.0000 12 12)');
    });
    const rest = await page.locator('.adm__ai-spark svg').evaluate(svg => {
      const paths = [...svg.querySelectorAll('path')], style = getComputedStyle(paths[0]);
      const length = paths[0].getTotalLength(), points = Array.from({length:384},(_,index) => paths[0].getPointAtLength(length * index / 384));
      const radii = points.map(point => Math.hypot(point.x - 12,point.y - 12)), topPetal = points.filter(point => point.y < 7);
      const petalWidth = Math.max(...topPetal.map(point => point.x)) - Math.min(...topPetal.map(point => point.x));
      const crossing = points.findIndex((point,index) => index > 0 && points[index - 1].x < 12 && point.x >= 12);
      const beforeCrossing = points[crossing - 1], afterCrossing = points[crossing];
      const neck = beforeCrossing.y + (afterCrossing.y - beforeCrossing.y) * (12 - beforeCrossing.x) / (afterCrossing.x - beforeCrossing.x);
      const petalAspect = petalWidth / (neck - Math.min(...topPetal.map(point => point.y)));
      const folds = radii.filter((radius,index) => radius > radii[(index + 383) % 384] && radius > radii[(index + 1) % 384]).length;
      return {outline:style.d,folds,petalWidth,petalAspect,visiblePaths:paths.filter(path => getComputedStyle(path).display !== 'none').length,fill:style.fill,stroke:style.stroke,strokeWidth:style.strokeWidth,transform:style.transform,rotation:getComputedStyle(svg.querySelector('.adm__ai-ribbon-turn')).transform,animations:svg.getAnimations({subtree:true}).length};
    });
    assert.equal(rest.visiblePaths, 1);
    assert.equal(rest.folds,4);
    assert.equal((rest.outline.match(/M/g) || []).length,1);
    assert.equal(rest.fill,'none');
    assert.notEqual(rest.stroke,'none');
    assert.equal(rest.strokeWidth,'1.5px');
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
          results.push({expanded,phase,duration,colors,neutral,opacity:getComputedStyle(path).opacity,easing:getComputedStyle(icon).transitionTimingFunction});
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
  const sampleMorph = () => page.locator('.adm__ai-spark svg').evaluate(async svg => {
    const path = svg.querySelector('path'), turn = svg.querySelector('.adm__ai-ribbon-turn'), frames = [];
    for (let index = 0; index < 6; index++) {
      await new Promise(resolve => { const until = performance.now() + 200; const next = now => now >= until ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next); });
      const box = svg.getBoundingClientRect(), counter = svg.closest('button').getBoundingClientRect(), style = getComputedStyle(path);
      const matrix = path.getScreenCTM(), length = path.getTotalLength(), stroke = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) * Math.hypot(matrix.a, matrix.b) / 2;
      const points = Array.from({length:193}, (_, index) => path.getPointAtLength(length * index / 192).matrixTransform(matrix));
      frames.push({outline:style.d,length,fill:style.fill,stroke:style.stroke,strokeWidth:style.strokeWidth,opacity:style.opacity,transform:style.transform,rotation:turn.getAttribute('transform'),visiblePaths:[...svg.querySelectorAll('path')].filter(element => getComputedStyle(element).display !== 'none').length,icon:[box.width,box.height],counter:[counter.width,counter.height],contained:points.every(point => point.x - stroke >= box.left && point.x + stroke <= box.right && point.y - stroke >= box.top && point.y + stroke <= box.bottom)});
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
      for (const icon of icons) { assert.equal(icon.path, idleOutline); assert.equal(icon.stroke, '1.5px'); assert.equal(icon.animations, 0); }
    };
    await assertStaticAiIcons();
    await page.locator('[data-ai-session-toggle]').click();
    await page.evaluate(() => { window.__sessionResult = null; window.__RKStudio.improveText('Private input copy', {}).then(text => { window.__sessionResult = text; }, error => { window.__sessionResult = error.message; }); });
    await page.waitForFunction(() => !!window.__sessionStream);
    await page.waitForFunction(() => document.querySelector('[data-ai-session-toggle]').dataset.aiState === 'working');
    await page.waitForFunction(() => document.querySelector('[data-ai-session-count]').textContent === '135 tokens');
    const workingMorph = await sampleMorph();
    await assertStaticAiIcons();
    assert.equal(new Set(workingMorph.frames.map(frame => frame.outline)).size, 6);
    assert.ok(workingMorph.frames.every(frame => frame.visiblePaths === 1 && frame.stroke !== 'none' && frame.fill === 'none' && frame.strokeWidth === '1.5px' && frame.opacity === '1'),'Use one unfilled ribbon with constant stroke and opacity');
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
    const answeringMorph = await sampleMorph();
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
    if (await page.locator('[data-exit-save]').isVisible()) await page.locator('[data-exit-save]').click();
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
      await other.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
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
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
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
      const value = request.postDataJSON(); writes.push(value);
      if (failNext) { failNext = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic publish failure" }) }); }
      if (holdWrite) { holdWrite = false; await new Promise(resolve => { releaseWrite = resolve; }); }
      latest = value;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, git: { ok: true } }) });
    }
    if (url.pathname === "/admin/media/put") {
      publicUploads.push(request.postDataBuffer());
      return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    }
    if (url.hostname === "rk-ai-proxy.riteshkumarhk.workers.dev") return route.fulfill({ contentType: "application/json", body: url.pathname.includes("publish") ? '{"enabled":false}' : "{}" });
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  };
  await context.route("**/*", routes);
  await context.addInitScript(() => {
    localStorage.setItem("rk:dev:stub", "1");
    localStorage.setItem("rk:admin:sess", JSON.stringify({ token: "synthetic-local-test", exp: Date.now() + 3600000 }));
    localStorage.setItem("rk:trust", JSON.stringify({ token: "synthetic-local-test", exp: Date.now() + 3600000 }));
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
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
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
    const publishedNotes = await page.locator('.merge-notes-input').innerText();
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
      await presenter.waitForFunction(() => document.querySelector('[data-pp-save]')?.textContent.includes('Saved to deck'));
      await presenter.locator('[data-pp="exit"]').click();
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
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
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
    for (const width of [1440, 1060, 1024, 1023, 390]) {
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
    const download = await downloading;
    const downloaded = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(downloaded.nativeDecksBackup.documents.length, 2);
    assert.ok(downloaded.nativeDecksBackup.documents.some(record => record.document.slides[0].notes === 'Pending notes must stay open'));
    const choosingFile = page.waitForEvent('filechooser');
    await page.locator('[data-act="backup-restore"]').click();
    await (await choosingFile).setFiles({ name: 'private-native-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(downloaded)) });
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