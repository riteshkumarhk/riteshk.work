import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import './tools/studio-presenter/build.mjs';

await build({
  entryPoints: [fileURLToPath(new URL("./tools/studio-presenter/fixture-entry.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("./tools/studio-presenter/fixture.bundle.js", import.meta.url)),
  bundle: true,
  format: "iife"
});

const baseURL = process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test("built production and canvas players deliver native notes without exposing audience notes", async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await context.addInitScript(() => {
    window.__RK_NATIVE_PRESENTER = true;
    const bridge = new EventTarget();
    window.nativeMessages = [];
    bridge.postMessage = message => window.nativeMessages.push(message);
    window.chrome.webview = bridge;
    window.nativeCommand = command => bridge.dispatchEvent(new MessageEvent("message", { data: { channel: "rk-presenter", command } }));
  });
  try {
    const lab = await context.newPage();
    await lab.goto(baseURL + "/studio/slide-merge-lab/");
    await lab.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await lab.evaluate(() => window.__slideMerge.choose("fidelity"));
    await lab.waitForFunction(() => window.__slideMerge?.api?.getSceneElements().some(element=>element.type!=='frame'));
    await lab.evaluate(() => {
      const api = window.__slideMerge.api, elements = api.getSceneElements();
      api.updateScene({elements:[...elements,{...elements.find(element=>element.type!=='frame'),id:'native-preview-section',type:'rectangle',x:100,y:180,width:1080,height:400,angle:0,opacity:100,strokeColor:'transparent',backgroundColor:'transparent',customData:{sectionComponent:{type:'text',heading:'Native preview section',body:'Visible original section content'}}}]});
    });
    await lab.waitForFunction(() => !!window.__slideMerge?.deck());
    const slides = await lab.evaluate(() => window.__slideMerge.deck().slides.map(slide => ({ layout: "title", slots: { title: slide.title }, notes: slide.notes })));
    await lab.getByRole("button", { name: "Slide Show", exact: true }).click();
    await lab.waitForFunction(() => window.nativeMessages.at(-1)?.slides[1]?.document?.includes('Visible original section content'));
    const previewDocument = await lab.evaluate(() => window.nativeMessages.at(-1).slides[1].document);
    assert.equal(previewDocument.includes('<script'),false);
    const pad = await context.newPage();
    await pad.goto(baseURL+'/tools/studio-presenter/companion.html');
    await pad.evaluate(state => window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:state})), await lab.evaluate(() => ({...window.nativeMessages.at(-1),index:0,slides:[{title:'Current'},window.nativeMessages.at(-1).slides[1]],total:2})));
    await pad.frameLocator('[data-pp-next] > iframe').getByText('Visible original section content').waitFor();
    await pad.screenshot({path:join(tmpdir(),'rk-native-next-preview.png')});
    await pad.close();
    const production = await context.newPage();
    await production.goto(baseURL + "/studio/?devstub");
    await production.waitForFunction(() => !!window.RK?.presentDeck);
    await production.evaluate(slides => window.RK.presentDeck({}, { slides }), slides);
    for (const page of [lab, production]) {
      await page.waitForSelector(".pjp--native");
      await page.evaluate(() => window.nativeCommand("prev"));
      await page.waitForFunction(() => window.nativeMessages.at(-1)?.index === 0);
      assert.match(await page.evaluate(() => window.nativeMessages.at(-1).notes), /decision/);
      assert.equal(await page.locator("[data-pjp-notes]").textContent(), "");
      assert.equal(await page.locator(".pjp__popbtn").isVisible(), false);
      const bounds = await page.evaluate(() => window.nativeMessages.at(-1));
      assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.top >= 0);
      await page.evaluate(() => window.nativeCommand("next"));
      await page.waitForFunction(() => window.nativeMessages.at(-1)?.index === 1);
    }
    await lab.waitForFunction(() => [...document.querySelectorAll(".pjp canvas")].some(canvas => {
      const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) return false;
      const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 160) if (pixels[offset + 3]) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
      return colors.size > 10;
    }));
    for (const page of [lab, production]) {
      await page.evaluate(() => window.nativeCommand("exit"));
      await page.waitForSelector(".pjp", { state: "detached" });
      assert.equal(await page.evaluate(() => window.nativeMessages.at(-1).type), "end");
    }
  } finally { await browser.close(); }
});

test("native bridge keeps notes off audience and laser yields to interactive controls", async () => {
  const browser = await chromium.launch({executablePath, headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:800},reducedMotion:"no-preference"});
  try {
    await page.addInitScript(() => {
      window.__RK_NATIVE_PRESENTER=true;
      const bridge=new EventTarget(); bridge.postMessage=message=>window.nativeMessages.push(message);
      window.nativeMessages=[]; window.chrome.webview=bridge;
      window.nativeCommand=message=>bridge.dispatchEvent(new MessageEvent("message",{data:{channel:"rk-presenter",...message}}));
    });
    await page.goto(baseURL+"/tools/studio-presenter/fixture.html");
    assert.equal(await page.evaluate(()=>typeof window.fixture?.start),"function","Fixture must load before input tests");
    await page.click("#start");
    await page.waitForSelector(".pjp--native");
    assert.equal(await page.locator("[data-pjp-notes]").textContent(), "");
    assert.equal(await page.locator(".pjp__notesbtn").isVisible(), false);
    await page.keyboard.press("p");
    assert.equal(await page.locator(".pjp--presenting").count(),0);
    assert.equal(await page.evaluate(()=>window.nativeMessages.at(-1).notes),"Private first note");
    await page.locator("#swatch").hover();
    await page.waitForFunction(()=>document.querySelector(".pjp")?.dataset.pointer==="laser");
    assert.equal(await page.locator("#swatch").evaluate(element=>getComputedStyle(element).cursor),"none");
    assert.equal(await page.locator(".pjp__pointer").isVisible(),true);
    await page.evaluate(() => {
      const surfaces = document.createElement('div');
      surfaces.id = 'cursor-surfaces';
      surfaces.style.cssText = 'position:absolute;left:200px;top:150px;display:flex;z-index:5';
      surfaces.innerHTML = '<video style="width:80px;height:80px"></video><div data-cmp style="width:80px;height:80px">Comparison</div><div data-zoom style="width:80px;height:80px">Gallery</div><iframe src="https://example.invalid/cursor-fixture" style="width:80px;height:80px"></iframe>';
      document.querySelector('[data-pjp-frame]').append(surfaces);
    });
    for (const selector of ['video','[data-cmp]','[data-zoom]','iframe']) {
      await page.locator('#cursor-surfaces ' + selector).hover({position:{x:10,y:65}});
      assert.equal(await page.locator('.pjp').getAttribute('data-pointer'), 'laser', selector);
      assert.equal(await page.locator('.pjp__pointer').isVisible(), true, selector);
      assert.equal(await page.locator('.pjp__pointer.is-control').count(), 0, selector);
    }
    await page.locator('#cursor-surfaces').evaluate(element => element.remove());
    await page.evaluate(() => window.RK.expandSlideMedia(document.querySelector('#media')));
    await page.locator('.pjp__expanded').waitFor();
    await page.locator('#media').hover({position:{x:100,y:100}});
    assert.equal(await page.locator('.pjp__pointer:popover-open').count(), 1);
    assert.equal(await page.locator('.pjp').getAttribute('data-pointer'), 'laser');
    await page.evaluate(() => window.RK.dismissSlideMedia());
    await page.evaluate(() => {
      const dialog = document.createElement('dialog'); dialog.className = 'wf-explorer';
      dialog.innerHTML = '<div style="height:300px;width:400px" class="react-flow__pane">Workflow</div>';
      document.querySelector('[data-pjp-frame]').append(dialog); dialog.showModal();
    });
    await page.locator('dialog.wf-explorer .react-flow__pane').hover();
    assert.equal(await page.locator('dialog.wf-explorer .pjp__pointer:popover-open').count(), 1);
    assert.equal(await page.locator('.pjp').getAttribute('data-pointer'), 'laser');
    await page.screenshot({path:join(tmpdir(),'rk-native-workflow-laser.png')});
    await page.mouse.down();
    assert.equal(await page.locator('.pjp').getAttribute('data-pointer'), 'grabbing');
    await page.mouse.up();
    assert.equal(await page.locator('.pjp').getAttribute('data-pointer'), 'laser');
    await page.locator('dialog.wf-explorer').evaluate(element => { element.close(); element.remove(); });
    await page.locator("#action").hover();
    assert.equal(await page.locator(".pjp__pointer.is-control").isVisible(),true);
    await page.click("#action");
    assert.equal(await page.evaluate(()=>window.fixture.clicks),1);
    await page.click("#section");
    assert.equal(await page.locator("details").evaluate(element=>element.open),true);
    await page.click("#play");
    await page.waitForFunction(()=>!document.querySelector("video").paused);
    await page.click("#play");
    assert.equal(await page.locator("video").evaluate(element=>element.paused),true);
    await page.frameLocator("iframe").locator("#embedded").click();
    assert.equal(await page.frameLocator("iframe").locator("#embedded").textContent(),"Embedded clicked");
    await page.evaluate(()=>window.nativeCommand({command:"next"}));
    await page.waitForFunction(()=>window.nativeMessages.at(-1).notes==="Private second note");
    assert.equal(await page.locator(".pjp__pointer").isVisible(),false);
    await page.locator("#swatch").hover();
    await page.screenshot({path:join(tmpdir(),"rk-native-audience-laser.png")});
    await page.evaluate(()=>window.nativeCommand({command:"pointer-leave"}));
    assert.equal(await page.locator(".pjp__pointer").isVisible(),false);
    await page.evaluate(()=>window.nativeCommand({command:"exit"}));
    await page.waitForSelector(".pjp",{state:"detached"});
    assert.equal(await page.evaluate(()=>window.nativeMessages.at(-1).type),"end");
    assert.equal(await page.locator(".pjp__pointer").count(),0);
  } finally { await browser.close(); }
});

test("native section keyboard navigation respects controls and expansion lifecycle", async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.addInitScript(() => {
      window.__RK_NATIVE_PRESENTER = true;
      window.chrome.webview = new EventTarget();
      window.chrome.webview.postMessage = () => {};
    });
    await page.goto(baseURL + "/tools/studio-presenter/fixture.html");
    await page.click("#start");
    await page.evaluate(() => {
      const section = document.createElement("iframe");
      section.id = "keyboard-section";
      section.srcdoc = '<button id="navigate">Slide navigation</button><input id="range" type="range" value="50"><button id="consume">Local action</button>';
      document.querySelector("[data-pjp-frame]").append(section);
    });
    const section = page.frameLocator("#keyboard-section");
    await section.locator("#consume").evaluate(element => element.addEventListener("keydown", event => event.preventDefault()));
    await section.locator("#consume").press("ArrowRight");
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "1 / 2");
    await section.locator("#range").press("ArrowRight");
    assert.equal(await section.locator("#range").inputValue(), "51");
    await section.locator("#navigate").press("Control+ArrowRight");
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "1 / 2");
    await section.locator("#navigate").press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]").textContent === "2 / 2");
    await page.locator("#action").press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]").textContent === "1 / 2");
    await page.evaluate(() => window.RK.expandSlideMedia(document.querySelector("#media")));
    await page.locator(".pjp__expanded").waitFor();
    assert.equal(await page.evaluate(() => window.RK.dismissSlideMedia()), true);
    assert.equal(await page.locator(".pjp__expanded").count(), 0);
    assert.equal(await page.locator(".pjp").count(), 1);
    assert.equal(await page.evaluate(() => window.RK.dismissSlideMedia()), false);
    await page.getByRole("button", { name: "Exit presentation", exact: true }).click();
    await page.locator(".pjp").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => typeof window.RK.dismissSlideMedia), "undefined");
  } finally { await browser.close(); }
});

test("ordinary presenter uses laser over slide and system cursor over controls", async () => {
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:"reduce"});
  try {
    await page.goto(baseURL+"/tools/studio-presenter/fixture.html");
    await page.click("#start");
    await page.locator("#swatch").hover();
    assert.equal(await page.locator(".pjp__pointer").isVisible(),true);
    await page.locator("#action").hover();
    assert.equal(await page.locator(".pjp__pointer").isVisible(),false);
    assert.notEqual(await page.locator("#action").evaluate(element=>getComputedStyle(element).cursor),"none");
    await page.keyboard.press("p");
    assert.equal(await page.locator("[data-pjp-notes]").textContent(),"Private first note");
  } finally { await browser.close(); }
});

test('Windows DJ edits names and notes with overview inside the notes pane', async () => {
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:920,height:740}});
  try {
    await page.addInitScript(()=>{const bridge=new EventTarget();window.messages=[];bridge.postMessage=message=>window.messages.push(message);window.chrome.webview=bridge;});
    await page.goto(baseURL+'/tools/studio-presenter/companion.html');
    const state={type:'state',index:0,total:3,notes:'Private editable notes',editable:true,durationMinutes:2,elapsed:0,remaining:120000,budget:120000,totalBudget:180000,paused:true,width:1280,height:720,slides:[{title:'First'},{title:'Second',document:'<body style="background:#16809c;color:white"><h1>Second slide</h1></body>'},{title:'Third'}]};
    await page.evaluate(state=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:state})),state);
    assert.equal(await page.getByRole('button',{name:'Sync private notes and names',exact:true}).isVisible(),false);
    await page.getByLabel('Speaker notes',{exact:true}).fill('Edited Windows note');
    await page.getByLabel('Next slide name').fill('Renamed next');
    await page.getByLabel('Next slide name').press('Enter');
    await page.getByRole('button',{name:'Show all slides',exact:true}).click();
    assert.equal(await page.locator('.pp__notesarea > [data-pp-overview][open]').count(),1);
    assert.equal(await page.locator('[data-pp-grid]').getByText('Preparing preview',{exact:true}).count(),2);
    assert.equal(await page.locator('[data-pp-overview]').evaluate(element=>element.matches(':modal')),false);
    await page.getByLabel('Slide 3 name').fill('Renamed third');
    await page.getByLabel('Slide 3 name').press('Enter');
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.key==='title' && message.index===1 && message.value==='Renamed next')));
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.key==='title' && message.index===2 && message.value==='Renamed third')));
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.key==='notes' && message.value==='Edited Windows note')));
    assert.ok(await page.evaluate(()=>window.messages.filter(message=>message.type==='rect').every(message=>message.visible)));
    await page.screenshot({path:join(tmpdir(),'rk-native-overview-920.png')});
    await page.locator('[data-pp-jump="2"]').click();
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.command==='jump' && message.index===2)));
    const conflict={slideId:'first',key:'notes',local:'Local <img src=x onerror=alert(1)> note',remote:'Cloud note',revision:3};
    await page.evaluate(({state,conflict})=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{...state,syncEnabled:true,conflicts:[conflict],saveStatus:'Private sync conflict. Review both versions.'}})),{state,conflict});
    await page.getByRole('button',{name:'Review conflict',exact:true}).click();
    const comparison=page.getByRole('dialog',{name:'Private sync conflict',exact:true});
    assert.equal(await comparison.locator('img').count(),0);
    assert.match(await comparison.locator('[data-pp-local]').textContent(),/Local/);
    assert.equal(await comparison.locator('[data-pp-remote]').textContent(),'Cloud note');
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.command==='metadata-busy' && message.value===true)));
    await page.screenshot({path:join(tmpdir(),'rk-native-sync-conflict-920.png')});
    await page.setViewportSize({width:390,height:844});
    const comparisonBounds=await comparison.boundingBox();
    assert.ok(comparisonBounds.x>=0 && comparisonBounds.x+comparisonBounds.width<=390);
    await page.screenshot({path:join(tmpdir(),'rk-native-sync-conflict-390.png')});
    await comparison.getByRole('button',{name:'Use cloud version',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.messages.find(message=>message.command==='metadata-resolve').value),{...conflict,choice:'remote'});
    await page.getByRole('button',{name:'Sync private notes and names',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.messages.some(message=>message.command==='metadata-sync')));
    await page.evaluate(state=>window.chrome.webview.dispatchEvent(new MessageEvent('message',{data:{...state,editable:false}})),state);
    assert.equal(await page.getByRole('button',{name:'Sync private notes and names',exact:true}).isVisible(),false);
    assert.equal(await page.getByLabel('Next slide name').getAttribute('readonly'),'');
    assert.equal(await page.getByLabel('Speaker notes',{exact:true}).getAttribute('readonly'),'');
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Show all slides',exact:true}).click();
    const bounds=await page.locator('[data-pp-overview]').boundingBox();
    assert.ok(bounds.width>100 && bounds.x>=0 && bounds.x+bounds.width<=390);
    await page.screenshot({path:join(tmpdir(),'rk-native-overview-390.png')});
  } finally {await browser.close();}
});