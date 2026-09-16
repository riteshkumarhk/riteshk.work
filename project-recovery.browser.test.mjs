import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { flowNode, flowEdge } from './src/js/workflow-core.mjs';

const source = readFileSync(new URL("./src/js/project.js", import.meta.url), "utf8");
const baseURL = process.env.SLIDE_LAB_URL;
const launchOptions = { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true };

const statcounterSnippet = '<div id="desktop-browser-ww-monthly-202508-202608" width="600" height="400" style="width:600px; height: 400px;"></div><!-- You may change the values of width and height above to resize the chart --><p>Source: <a href="https://gs.statcounter.com/browser-market-share/desktop/worldwide">StatCounter Global Stats - Browser Market Share</a></p><script type="text/javascript" src="https://www.statcounter.com/js/fusioncharts.js"></script><script type="text/javascript" src="https://gs.statcounter.com/chart.php?desktop-browser-ww-monthly-202508-202608&chartWidth=600"></script>';

test("shared HTML embeds run widgets in an opaque sandbox without parent access", async () => {
  const bundle = await build({ entryPoints: ["src/js/project.js"], bundle: true, write: false, format: "iife" });
  const received = [];
  const server = createServer((request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type','text/html'); response.end('<div id="fixture"></div>'); return; }
    if (request.url === '/favicon.ico') { response.statusCode=204; response.end(); return; }
    received.push(request.url);
    response.setHeader('Content-Type', 'text/javascript');
    if (request.url === '/library.js') response.end('window.providerLibrary = true;');
    else if (request.url === '/chart.js') response.end('document.querySelector("div").textContent=window.providerLibrary?"Chart fixture rendered":"Missing library";try{parent.document.body.dataset.compromised="true"}catch(error){document.body.dataset.isolated="true"}');
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const requested = [], messages = [];
    page.on('console', message => messages.push(message.text()));
    await page.context().route('**/*', route => {
      requested.push(route.request().url());
      if (route.request().url().startsWith(fixtureOrigin + '/')) return route.continue();
      return route.abort();
    });
    await page.goto(fixtureOrigin);
    await page.evaluate(() => { window.RK = {}; window.__siteRendered = true; });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const srcDoc = await page.evaluate(snippet => {
      const template = document.createElement('template');
      template.innerHTML = window.RK.renderStudyBlock({type:'figure',heading:'Growth metrics',src:snippet+'<script>try{parent.compromised=true}catch(error){document.body.dataset.scriptIsolated="true"}</script><img src="javascript:alert(1)" onerror="parent.compromised=true">'});
      const iframe = template.content.querySelector('iframe');
      const result = iframe.getAttribute('srcdoc');
      iframe.removeAttribute('srcdoc');
      document.querySelector('#fixture').append(template.content);
      return result;
    }, statcounterSnippet.replace('https://www.statcounter.com/js/fusioncharts.js','https://example.test/library.js'));
    const frame = page.frameLocator('[data-general-embed] iframe');
    await frame.locator('body').evaluate(() => true);
    await page.locator('[data-general-embed] iframe').evaluate((element, {value,origin}) => {
      const documentCopy = new DOMParser().parseFromString(value,'text/html');
      documentCopy.querySelector('meta[http-equiv]').content = documentCopy.querySelector('meta[http-equiv]').content.replace('script-src https:', 'script-src https: ' + origin);
      const scripts = documentCopy.querySelectorAll('script[src]');
      scripts[0].src = origin + '/library.js'; scripts[1].src = origin + '/chart.js';
      element.srcdoc = '<!doctype html>' + documentCopy.documentElement.outerHTML;
    }, {value:srcDoc,origin:fixtureOrigin});
    await frame.getByText('Chart fixture rendered', { exact: true }).waitFor({ timeout: 5000 }).catch(async error => {
      throw new Error(error.message + '\n' + JSON.stringify({requested,messages,html:await page.locator('#fixture').innerHTML(),frames:await Promise.all(page.frames().map(async child=>({url:child.url(),text:await child.locator('body').innerText()})))}));
    });
    assert.equal(await frame.locator('body').getAttribute('data-isolated'), 'true');
    assert.equal(await page.locator('body').getAttribute('data-compromised'), null);
    assert.equal(await frame.locator('body').getAttribute('data-script-isolated'), 'true');
    assert.equal(await page.locator('[data-general-embed] iframe').getAttribute('sandbox'), 'allow-scripts allow-presentation');
    assert.equal(await page.locator('[data-general-embed] iframe').getAttribute('credentialless'), '');
    assert.equal(await frame.locator('script').count(), 3);
    assert.equal(await frame.locator('[src^="javascript:"],[onerror]').count(), 0);
    assert.equal(await page.locator('[data-general-embed] a').getAttribute('href'), 'https://gs.statcounter.com/#desktop-browser-ww-monthly-202508-202608');
    assert.deepEqual(received,['/library.js','/chart.js']);
    assert.equal(await page.evaluate(value => window.RK.renderStudyBlock({type:'figure',src:value}).includes('srcdoc='),statcounterSnippet.replace('id="desktop-browser', 'id="other-browser')), false);
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
});

test("shared embeds preserve source, sandbox, sizing, retry and public export boundaries", async () => {
  const bundle = await build({ stdin: { contents: 'import React from "react";import{createRoot}from"react-dom/client";import{EmbeddedMedia,EmbedComposer}from"./src/js/slide-merge-embeds.jsx";import{embedDescriptor}from"./src/js/slide-merge-embeds.mjs";import{publicEmbedSource,audienceComponent}from"./src/js/slide-merge-visibility.mjs";window.embedTest={embedDescriptor,publicEmbedSource,audienceComponent};const root=createRoot(document.querySelector("#react"));window.renderEmbed=value=>root.render(<EmbeddedMedia value={value}/>);window.composeEmbed=()=>{const element={id:"embed",width:640,height:360,x:0,y:0,customData:{pendingEmbed:true}};const state={width:900,height:650,scrollX:0,scrollY:0,zoom:{value:1},selectedElementIds:{embed:true}};const api={getSceneElements:()=>[element],getAppState:()=>state,onChange:()=>()=>{}};root.render(<EmbedComposer api={api} onCommit={(...value)=>window.committed=value}/>);};', resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife' });
  const projectBundle = await build({ entryPoints: ['src/js/project.js'], bundle: true, write: false, format: 'iife' });
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    await page.route('**/*', route => route.abort());
    await page.setContent('<style>:root{--sans:sans-serif;--bg-2:#111;--text:#eee;--line:#555}body{margin:0}#react{width:100%;max-width:600px;height:400px}#case{max-width:900px}</style><div id="react"></div><div id="case"></div>');
    await page.addStyleTag({content:readFileSync(new URL('./css/slide-studio-renderer.css',import.meta.url),'utf8') + readFileSync(new URL('./css/slide-merge-notes.css',import.meta.url),'utf8') + readFileSync(new URL('./css/project.css',import.meta.url),'utf8')});
    await page.evaluate(()=>{window.RK={};window.__siteRendered=true;});
    await page.addScriptTag({content:projectBundle.outputFiles[0].text});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const widget = '<div id="widget">Widget ready</div><a href="https://example.com/source">Source</a><script>window.count=0;try{parent.localStorage.getItem("owner")}catch(error){document.querySelector("#widget").dataset.isolated="true"}</script>';
    const validation = await page.evaluate(({widget,statcounterSnippet})=>{
      const {embedDescriptor,publicEmbedSource,audienceComponent}=window.embedTest;
      const rejected=['<iframe src="https://example.com/a?&#116;oken=private"></iframe>','<iframe src="https://example.com/view?url=https%3A%2F%2Fexample.com%2Fa%3Fsig%3Dprivate"></iframe>','<script>const apiKey="private"</script>','<iframe src="https://example.com/vault/private"></iframe>'].map(value=>{try{publicEmbedSource(value);return false}catch{return true}});
      const chart=embedDescriptor(statcounterSnippet), ordinary=embedDescriptor(widget);
      return {rejected,source:publicEmbedSource(widget),component:audienceComponent({type:'figure',src:widget}).src,chartEval:chart.srcDoc.includes("'unsafe-eval'"),ordinaryEval:ordinary.srcDoc.includes("'unsafe-eval'"),social:embedDescriptor('<blockquote class="twitter-tweet"><a href="https://x.com/example/status/12345">Post</a></blockquote><script src="https://platform.twitter.com/widgets.js"></script>').src};
    },{widget,statcounterSnippet});
    assert.deepEqual(validation,{rejected:[true,true,true,true],source:widget,component:widget,chartEval:true,ordinaryEval:false,social:'https://platform.twitter.com/embed/Tweet.html?id=12345'});
    const nativeMedia = await page.evaluate(()=>['image','video'].map(kind=>{
      const src='https://example.com/original.'+(kind==='image'?'png':'mp4'),template=document.createElement('template');
      template.innerHTML=RK.renderStudyBlock({type:'figure',src:'<iframe src="'+src+'"></iframe>',controls:true});
      const media=template.content.querySelector(kind==='image'?'img':'video');
      return {kind,src:media?.getAttribute('src'),controls:kind==='video'?media?.hasAttribute('controls'):true};
    }));
    assert.deepEqual(nativeMedia,[{kind:'image',src:'https://example.com/original.png',controls:true},{kind:'video',src:'https://example.com/original.mp4#t=0.1',controls:true}]);
    await page.evaluate(value=>window.renderEmbed(value),widget);
    await page.frameLocator('#react iframe').locator('#widget[data-isolated="true"]').waitFor();
    await page.frameLocator('#react iframe').locator('#widget').evaluate(element=>element.textContent='Changed');
    await page.getByRole('button',{name:'Reload embedded content',exact:true}).click();
    await page.frameLocator('#react iframe').getByText('Widget ready',{exact:true}).waitFor();
    assert.equal(await page.locator('#react a').getAttribute('href'),'https://example.com/source');
    await page.evaluate(value=>{document.querySelector('#case').innerHTML=RK.renderStudyBlock({type:'mediacolumns',heading:'Original nearby text',items:[{cells:[{src:value,embedRatio:'9/16'}]}]});RK.enhanceBlocks(document.querySelector('#case'));},widget);
    await page.evaluate(code=>{window.morphEmbedFixture=new Function('container','html','var RUNTIME_CLASS=/^is-/;'+code+';morphInto(container,html);');},['morphInto','morphChildren','morphNode','morphAttrs','mergeClass','disposeEmbedRecovery'].map(sourceFunction).join('\n'));
    await page.frameLocator('#case iframe').locator('#widget').evaluate(element=>element.textContent='Running widget state');
    await page.evaluate(value=>{window.originalWidgetFrame=document.querySelector('#case iframe');window.morphEmbedFixture(document.querySelector('#case'),RK.renderStudyBlock({type:'mediacolumns',heading:'Edited nearby text',items:[{cells:[{src:value,embedRatio:'9/16'}]}]}));},widget);
    assert.equal(await page.evaluate(()=>window.originalWidgetFrame===document.querySelector('#case iframe')),true);
    assert.equal(await page.frameLocator('#case iframe').locator('#widget').innerText(),'Running widget state');
    await page.evaluate(value=>window.morphEmbedFixture(document.querySelector('#case'),RK.renderStudyBlock({type:'mediacolumns',heading:'Edited nearby text',items:[{cells:[{src:value,embedRatio:'9/16'}]}]})),widget.replace('Widget ready','Updated source'));
    await page.frameLocator('#case iframe').getByText('Updated source',{exact:true}).waitFor();
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      const bounds=await page.locator('#case [data-general-embed]').evaluate(element=>{const rect=element.getBoundingClientRect();return {ratio:rect.width/rect.height,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert.ok(Math.abs(bounds.ratio-9/16)<0.02);assert.equal(bounds.overflow,false);
    }
    await page.evaluate(()=>window.renderEmbed('https://example.com/audio.mp3'));
    await page.locator('#react audio[controls]').waitFor();
    await page.evaluate(()=>window.renderEmbed('javascript:alert(1)'));
    await page.getByText('Use an HTTPS link without credentials.',{exact:true}).waitFor();
    await page.evaluate(()=>window.composeEmbed());
    await page.getByRole('textbox',{name:'Embed media link or code'}).fill(widget);
    await page.getByRole('combobox',{name:'Embed aspect ratio'}).selectOption('9/16');
    await page.getByRole('button',{name:'Embed',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.committed),['embed',widget,'9/16']);
  } finally {await browser.close();}
});

test("Media columns preserves nested cells, sketch hierarchy and responsive media", async () => {
  const bundle = await build({ entryPoints: ["src/js/project.js"], bundle: true, write: false, format: "iife" });
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<div id="fixture" class="pj__body"></div>');
    await page.addStyleTag({ content: ':root{--mono:monospace;--serif:serif;--sans:sans-serif;--accent:#d8a657}*{box-sizing:border-box}body{margin:0}#fixture{width:100%;max-width:1120px;padding:24px}' });
    await page.addStyleTag({ content: readFileSync(new URL("./css/project.css", import.meta.url), "utf8") });
    await page.evaluate(() => { window.RK = {}; window.__siteRendered = true; });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const block = { type: "mediacolumns", nav: "Visual process", kicker: "The process", heading: "A compact visual story", items: [1, 2, 3, 4].map(number => ({ label: "0" + number, cells: [{ src: "/assets/original-" + number + ".png", heading: "Column " + number, body: '<p><strong>Editable prose</strong><img src="/safe.png" onerror="window.unsafe=1"></p>' }, { heading: "More detail", body: "A second independent cell" }] })) };
    const result = await page.evaluate(value => { const before = JSON.stringify(value); document.querySelector('#fixture').innerHTML = window.RK.renderStudyBlock(value); return before === JSON.stringify(value); }, block);
    assert.equal(result, true);
    assert.equal(await page.locator('.pjb__kicker').textContent(), block.kicker);
    assert.equal(await page.locator('.pjb__h').textContent(), block.heading);
    assert.equal(await page.locator('.pjb__mediacol').count(), 4);
    assert.equal(await page.locator('.pjb__mediacol-cell').count(), 8);
    assert.deepEqual(await page.locator('.pjb__mediacol').first().evaluate(element => [...element.children].map(child => child.className)), ['pjb__mediacol-label', 'pjb__mediacol-cell', 'pjb__mediacol-cell']);
    assert.deepEqual(await page.locator('.pjb__mediacol-cell').first().evaluate(element => [...element.children].map(child => child.className)), ['pjb__mediacol-media', 'pjb__mediacol-heading', 'pjb__prose']);
    assert.equal(await page.locator('.pjb__mediacol-media img').first().getAttribute('src'), block.items[0].cells[0].src);
    assert.equal(await page.locator('.pjb__prose [onerror]').count(), 0);
    for (const [width, columns] of [[1440, 3], [800, 2], [390, 1]]) {
      await page.setViewportSize({ width, height: 1000 });
      const state = await page.locator('.pjb__mediacols').evaluate(element => ({ columns: getComputedStyle(element).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth, color: getComputedStyle(element.querySelector('.pjb__mediacol-label')).color, fit: getComputedStyle(element.querySelector('.pjb__mediacol-media img')).objectFit }));
      assert.deepEqual(state, { columns, overflow: false, color: 'rgb(216, 166, 87)', fit: 'contain' });
    }
    await page.evaluate(() => { document.querySelector('#fixture').innerHTML = window.RK.renderStudyBlock({ type: 'mediacolumns', items: [{ label: '<script>bad</script>', cells: [{ src: 'vault:kept-private', kind: 'video', controls: true }] }, { cells: [] }] }); });
    assert.equal(await page.locator('video[data-vault="kept-private"][controls]').count(), 1);
    assert.equal(await page.locator('.pjb__mediacol-label').textContent(), '<script>bad</script>');
    assert.equal(await page.locator('.pjb__mediacol').count(), 2);
  } finally { await browser.close(); }
});

test("browser test guard blocks live services but permits explicit mocks", { skip: !process.execArgv.some(argument => argument.includes("browser-test-guard")) }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    for (const host of ["rk-ai-proxy.riteshkumarhk.workers.dev", "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com"]) {
      await assert.rejects(page.goto("https://" + host + "/synthetic-network-guard", { timeout: 10000 }), /ERR_NAME_NOT_RESOLVED/);
    }
    await page.route("https://api.anthropic.com/synthetic-mock", route => route.fulfill({ contentType: "application/json", body: '{"fixture":true}' }));
    const response = await page.goto("https://api.anthropic.com/synthetic-mock");
    assert.deepEqual(await response.json(), { fixture: true });
  } finally { await browser.close(); }
});

test("Studio and Journey reject executable rich text while preserving prose and images", async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<div id="fixture"></div>');
    const cleaner = await build({ entryPoints: ["src/js/rich-html.mjs"], bundle: true, write: false, format: "iife", globalName: "AuditRichHtml" });
    await page.addScriptTag({ content: cleaner.outputFiles[0].text });
    const studio = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
    const start = studio.indexOf("  function rtClean(html) {"), end = studio.indexOf("  function richArea(", start);
    await page.addScriptTag({ content: "const sanitizeRichHtml = AuditRichHtml.sanitizeRichHtml;" + studio.slice(start, end) });
    const markup = '<p style="text-align:center"><strong>Keep formatting</strong></p><figure class="rt__fig"><img src="/assets/uploads/fixture.png" onerror=window.auditMarker=1></figure><svg onload=window.auditMarker=1></svg><a href="jav&#97;script:window.auditMarker=1">Unsafe link</a>';
    const result = await page.evaluate(html => {
      window.auditMarker = 0;
      const host = document.querySelector("#fixture"); host.innerHTML = rtClean(html);
      return { handlers: host.querySelectorAll("[onerror], [onload], svg, script").length, title: host.querySelector("strong").textContent, align: host.querySelector("p").style.textAlign, image: host.querySelector("img").getAttribute("src"), link: host.querySelector("a").getAttribute("href") };
    }, markup);
    assert.deepEqual(result, { handlers: 0, title: "Keep formatting", align: "center", image: "/assets/uploads/fixture.png", link: null });
    const journey = await build({ entryPoints: ["src/js/journey.js"], bundle: true, write: false, format: "iife" });
    await page.evaluate(html => { window.RK = { data: { journey: { enabled: true, chapters: [{ name: "Fixture", entries: [{ title: "Entry", body: html }] }] }, work: [] } }; }, markup);
    await page.addScriptTag({ content: journey.outputFiles[0].text });
    await page.evaluate(() => window.RK.openJourney());
    assert.equal(await page.locator(".jrn__prose strong").textContent(), "Keep formatting");
    assert.equal(await page.locator(".jrn__prose img").count(), 1);
    assert.equal(await page.locator(".jrn__prose [onerror], .jrn__prose [onload]").count(), 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.auditMarker), 0);
  } finally { await browser.close(); }
});

test("Studio preview messages require the expected frame and origin", async () => {
  const { runInNewContext } = await import("node:vm");
  const studio = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  const start = studio.indexOf('    window.addEventListener("message", function (e) {');
  const end = studio.indexOf("\n    });", start) + 8;
  const preview = {}, calls = [];
  let handler, opened = true;
  runInNewContext(studio.slice(start, end), { window: { addEventListener: (type, callback) => { handler = callback; } }, location: { origin: "https://synthetic.test" }, frame: { contentWindow: preview }, root: { classList: { contains: () => opened } }, previewBlockAct: (...args) => calls.push(args) });
  const data = { __rk: "blockAct", act: "del", index: 0 };
  handler({ origin: "https://untrusted.test", source: preview, data });
  handler({ origin: "https://synthetic.test", source: {}, data });
  assert.equal(calls.length, 0);
  handler({ origin: "https://synthetic.test", source: preview, data });
  assert.deepEqual(calls, [["del", 0]]);
  opened = false;
  handler({ origin: "https://synthetic.test", source: preview, data });
  assert.equal(calls.length, 1);
});

async function siteFixture(page, routeRequest) {
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [
    { id: "recovery-fixture", client: "Synthetic validation", title: "Protected prototype", study: { blocks: [
      { type: "media", heading: "Public prototype", items: [{ src: "https://www.figma.com/proto/synthetic-public", kind: "figma" }] },
      { type: "media", heading: "Protected prototype", locked: true, vaultBlock: "synthetic-section" }
    ] } },
    { id: "second-fixture", client: "Synthetic validation", title: "Second project", study: { blocks: [{ type: "text", body: "Unchanged second project" }] } }
  ];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/content.json")) return route.fulfill({ json: published });
    if (await routeRequest(route, url)) return;
    if (request.url().startsWith(baseURL + "/")) return route.continue();
    if (request.resourceType() === "font" || url.hostname === "fonts.googleapis.com" || url.hostname === "api.fontshare.com") return route.continue();
    return route.abort();
  });
  return published;
}

test('Studio automatic refresh reduces list requests without suppressing explicit refresh or expiry', {skip:!baseURL,timeout:60000}, async()=>{
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}}), counts = {requests:0,access:0,bookings:0};
    await siteFixture(page, async (route, url) => {
      if (!url.pathname.startsWith('/admin/')) return false;
      const kind = url.pathname.slice('/admin/'.length);
      if (Object.hasOwn(counts, kind)) counts[kind]++;
      await route.fulfill({json:kind==='requests'?{requests:[]}:kind==='access'?{grants:[]}:kind==='bookings'?{bookings:[]}:{}});
      return true;
    });
    await page.addInitScript(() => {
      localStorage.setItem('rk:dev:stub','1');
      localStorage.setItem('rk:admin:sess',JSON.stringify({token:'synthetic-list-test',exp:Date.now()+3600000}));
      window.refreshClock = Date.now(); Date.now = () => window.refreshClock;
    });
    const initialBookings = page.waitForResponse(response=>response.url().endsWith('/admin/bookings'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await initialBookings;
    const settle = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await settle();
    assert.deepEqual(counts,{requests:1,access:0,bookings:1});
    const before = await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    await page.evaluate(()=>{for(let index=0;index<10;index++)document.dispatchEvent(new Event('visibilitychange'));});
    await settle();
    assert.deepEqual(counts,{requests:1,access:0,bookings:1});
    const grants = page.waitForResponse(response=>response.url().endsWith('/admin/access'));
    await page.locator('.adm__tab[data-tab="special"]').click(); await grants; await settle();
    assert.deepEqual(counts,{requests:1,access:1,bookings:1});
    await page.locator('.adm__tab[data-tab="autofill"]').click();
    const manual = page.waitForResponse(response=>response.url().endsWith('/admin/bookings'));
    await page.locator('[data-act="book-refresh"]').click(); await manual; await settle();
    assert.deepEqual(counts,{requests:1,access:1,bookings:2});
    const expired = page.waitForResponse(response=>response.url().endsWith('/admin/bookings'));
    await page.evaluate(()=>{window.refreshClock+=60001;document.dispatchEvent(new Event('visibilitychange'));});
    await expired; await settle();
    assert.deepEqual(counts,{requests:2,access:1,bookings:3});
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),before);
  } finally { await browser.close(); }
});

test('Workflow visitor keeps complete graphs inline on phones and preserves the React view during preview updates', {skip:!baseURL,timeout:90000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960},hasTouch:true,reducedMotion:'no-preference'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await siteFixture(page,async()=>false);
    await page.goto(baseURL+'/');
    await page.waitForFunction(()=>window.__siteRendered&&window.RK?.renderStudyBlock);
    const graph={version:1,nodes:Array.from({length:12},(_,index)=>flowNode(`step-${index}`,`Step ${index+1}`,Math.floor(index/3)*480-240,(index%3)*170-90,String(index+1),'Original note')),edges:[]};
    for(let index=0;index<11;index++)graph.edges.push(flowEdge(`step-${index}`,`step-${index+1}`));
    graph.edges.push(flowEdge('step-0','step-3','r','l','alternative','Branch'),flowEdge('step-2','step-4','r','l','alternative','Merge'),flowEdge('step-8','step-1','b','b','return','Repeat'),flowEdge('step-11','step-11','r','t','return','Retry'));
    graph.nodes[0].data.title='<img src=x onerror=alert(1)>Plain text';
    graph.nodes[2].data.outcome=true;
    const block={type:'workflow',heading:'Connected process',caption:'Original caption',graph};
    await page.evaluate(value=>{document.body.innerHTML='<main id="workflow-fixture" style="max-width:1120px;margin:auto;padding:16px"></main>';window.flowBlock=value;const host=document.querySelector('#workflow-fixture');host.innerHTML=RK.renderStudyBlock(value);RK.enhanceBlocks(host);},block);
    await page.waitForFunction(()=>document.querySelectorAll('rk-workflow .react-flow__edge').length===15);
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>{
      const host=document.querySelector('.wf-diagram-web'),box=host.getBoundingClientRect();
      return [...host.querySelectorAll('.react-flow__node,.react-flow__edge-path')].every(element=>{const rect=element.getBoundingClientRect();return rect.left>=box.left-1&&rect.right<=box.right+1&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1;});
    });
    assert.equal(await page.locator('rk-workflow img').count(),0);
    assert.equal(await page.locator('rk-workflow .react-flow__node.draggable').count(),0);
    const palette=await page.locator('rk-workflow').evaluate(host=>{
      const color=selector=>getComputedStyle(host.querySelector(selector));
      return {gold:color('.wf-number').color,grey:color('.wf-footer').color,main:color('[data-id="step-0:r-step-1:l"] .react-flow__edge-path').stroke,alternative:color('[data-id="step-0:r-step-3:l"] .react-flow__edge-path').stroke,return:color('[data-id="step-8:b-step-1:b"] .react-flow__edge-path').stroke,legend:[...host.querySelectorAll('.wf-legend i')].map(element=>getComputedStyle(element).borderTopColor)};
    });
    assert.equal(palette.main,palette.gold);assert.equal(palette.alternative,palette.grey);assert.equal(palette.return,palette.gold);assert.deepEqual(palette.legend,[palette.gold,palette.grey,palette.gold]);
    const outcome=await page.locator('.wf-step.is-outcome').evaluate(element=>{
      const before=element.getBoundingClientRect(),border=getComputedStyle(element).borderTopWidth;
      element.classList.remove('is-outcome');const after=element.getBoundingClientRect();element.classList.add('is-outcome');
      return {border,widthDifference:before.width-after.width,heightDifference:before.height-after.height};
    });
    assert.deepEqual(outcome,{border:'2px',widthDifference:0,heightDifference:0});
    await page.evaluate(code=>{window.morphFlowFixture=new Function('container','html','var RUNTIME_CLASS=/^is-/;'+code+';morphInto(container,html);');},['morphInto','morphChildren','morphNode','morphAttrs','mergeClass','disposeEmbedRecovery'].map(sourceFunction).join('\n'));
    await page.evaluate(()=>{window.originalFlowNode=document.querySelector('rk-workflow .react-flow__node');window.flowBlock.heading='Updated nearby heading';window.morphFlowFixture(document.querySelector('#workflow-fixture'),RK.renderStudyBlock(window.flowBlock));});
    await page.waitForFunction(()=>document.querySelectorAll('rk-workflow .react-flow__edge').length===15);
    assert.equal(await page.evaluate(()=>window.originalFlowNode===document.querySelector('rk-workflow .react-flow__node')),true);
    await page.screenshot({path:join(tmpdir(),'rk-workflow-web-1440.png')});
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      await page.locator('.wf-inline-scroll').waitFor();
      const nextPosition=await page.locator('.wf-inline-scroll').evaluate(element=>Math.min(element.scrollLeft+285,element.scrollWidth-element.clientWidth));
      await page.getByRole('button',{name:'Next part of diagram',exact:true}).click();
      await page.waitForFunction(expected=>document.querySelector('.wf-inline-scroll').scrollLeft===expected,nextPosition);
      const scroll=await page.locator('.wf-inline-scroll').evaluate(element=>element.scrollLeft);
      await page.getByRole('button',{name:'Fit diagram',exact:true}).click();
      await page.waitForFunction(()=>{
        const host=document.querySelector('.wf-inline-scroll'),box=host.getBoundingClientRect();
        return host.scrollWidth<=host.clientWidth+1&&[...host.querySelectorAll('.react-flow__node,.react-flow__edge-path')].every(element=>{const rect=element.getBoundingClientRect();return rect.left>=box.left-1&&rect.right<=box.right+1&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1;});
      });
      assert.equal(await page.locator('dialog[open]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(await page.evaluate(()=>window.flowBlock.graph),graph);
      await page.screenshot({path:join(tmpdir(),`rk-workflow-mobile-fit-${width}.png`)});
      await page.getByRole('button',{name:'Readable size',exact:true}).click();
      await page.waitForFunction(previous=>Math.abs(document.querySelector('.wf-inline-scroll').scrollLeft-previous)<2,scroll);
      await page.getByRole('button',{name:'Expand diagram',exact:true}).click();
      const expanded=page.getByRole('dialog',{name:'Expanded flow diagram'});
      await expanded.getByRole('button',{name:'Fit diagram',exact:true}).click();
      await page.keyboard.press('Escape');
      await expanded.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Expand diagram');
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Expand diagram');
    }
    assert.equal(await page.getByText('Flow outline',{exact:true}).count(),0);
    const described=page.getByRole('group',{name:'Workflow diagram',exact:true});
    await described.focus();
    assert.ok(await described.evaluate(element=>document.getElementById(element.getAttribute('aria-describedby')).textContent.includes('Return to Step 2')));
    assert.equal(await page.locator('.wf-outline').evaluate(element=>element.getBoundingClientRect().width),1);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{document.querySelector('#workflow-fixture').style.paddingBottom='800px';window.scrollTo(0,0);document.querySelector('.wf-inline-scroll').scrollLeft=0;});
    const touch=await page.context().newCDPSession(page),bounds=await page.locator('.wf-inline-scroll').boundingBox();
    await page.mouse.move(270,bounds.y+270);await page.mouse.down();await page.mouse.move(140,bounds.y+270,{steps:8});await page.mouse.up();
    assert.ok(await page.locator('.wf-inline-scroll').evaluate(element=>element.scrollLeft)>100);
    assert.deepEqual(await page.evaluate(()=>window.flowBlock.graph),graph);
    for(const surface of ['canvas','node']){
      await page.locator('.wf-inline-scroll').evaluate(element=>element.scrollLeft=0);
      const node=await page.locator('.wf-diagram-inline .react-flow__node').first().boundingBox();
      const point=surface==='node'?{x:node.x+node.width-16,y:node.y+30}:{x:270,y:bounds.y+270};
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-step*15,y:point.y}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForFunction(()=>document.querySelector('.wf-inline-scroll').scrollLeft>35);
    }
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:bounds.y+200}]});
    for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:bounds.y+200-step*20}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>window.scrollY>30);
    await page.evaluate(()=>{document.querySelector('#workflow-fixture').style.paddingBottom='16px';window.scrollTo(0,0);});
    await touch.detach();
    assert.ok((await page.locator('.wf-outline').innerText()).includes('Repeat: Return to Step 2'));
    await page.evaluate(()=>document.documentElement.setAttribute('data-theme','day'));
    await page.screenshot({path:join(tmpdir(),'rk-workflow-mobile-light.png')});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('Workflow Studio edits branches with history, Cancel, Apply and reload while retaining protected sections', {skip:!baseURL,timeout:90000},async()=>{
  const browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.setDefaultTimeout(12000);
    const published=await siteFixture(page,async()=>false);
    const legacy={type:'workflow',heading:'Review process',flow:'cycle',loopFrom:'1',loopTo:'3',caption:'Keep caption',editorName:'My process',items:[{label:'Start',note:'Keep note'},{label:'Review // Refine'},{label:'Ship'}]};
    published.work[0].study.blocks[0]=legacy;
    const protectedBlock=structuredClone(published.work[0].study.blocks[1]);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const open=async()=>{await page.locator('.adm__tab[data-tab="work"]').click();await page.locator('[data-act="study-toggle"][data-index="0"]').click();await page.locator('[data-l2tab="story"]').click();await page.locator('[data-act="study-blocktoggle"][data-bindex="0"]').click();};
    await open();
    const edit=page.getByRole('button',{name:'Edit flow',exact:true});
    await edit.click();
    const dialog=page.getByRole('dialog',{name:'Flow editor',exact:true});
    await dialog.locator('.wf-inspector .wf-row').first().click();
    await dialog.getByRole('textbox',{name:'Step title',exact:true}).fill('Discard this change');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),legacy);
    await edit.click();
    await dialog.locator('.wf-inspector .wf-row').first().click();
    await dialog.getByRole('textbox',{name:'Step title',exact:true}).fill('Reviewed start');
    await dialog.getByRole('textbox',{name:'Step title',exact:true}).blur();
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await dialog.locator('[data-id="step-1-1"] .wf-title').innerText(),'Start');
    await dialog.getByRole('button',{name:'Redo',exact:true}).click();
    await dialog.locator('.wf-inspector .wf-row').first().click();
    const handle=await dialog.locator('[data-id="step-1-1"] [data-handleid="r"]').boundingBox(),canvas=await dialog.locator('.wf-diagram').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.7,canvas.y+canvas.height*.85,{steps:12});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelectorAll('.wf-editor-dialog .react-flow__node').length===5);
    await dialog.getByRole('textbox',{name:'Step title',exact:true}).fill('New branch');
    await dialog.getByRole('combobox',{name:'Connect to step',exact:true}).selectOption('step-1-1');
    await dialog.getByRole('button',{name:'Connect',exact:true}).click();
    await dialog.getByRole('combobox',{name:'Connection path',exact:true}).selectOption('return');
    await dialog.getByRole('textbox',{name:'Connection label',exact:true}).fill('Repeat review');
    await dialog.getByRole('tab',{name:'Web',exact:true}).click();
    await dialog.locator('.wf-title').filter({hasText:'New branch'}).waitFor();
    assert.equal(await dialog.locator('.react-flow__node.draggable').count(),0);
    await page.setViewportSize({width:390,height:844});
    await dialog.getByRole('tab',{name:'Mobile',exact:true}).click();
    await dialog.getByRole('button',{name:'Fit diagram',exact:true}).click();
    await page.screenshot({path:join(tmpdir(),'rk-workflow-studio-mobile.png')});
    await dialog.getByRole('button',{name:'Apply flow',exact:true}).click();
    await page.waitForFunction(()=>window.__RKStudio.getDraft().work[0].study.blocks[0].graph?.nodes.length===5);
    const saved=await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]);
    assert.equal(saved.graph.edges.length,7);assert.equal(saved.graph.nodes[0].data.title,'Reviewed start');assert.equal(saved.graph.nodes[0].data.note,'Keep note');assert.equal(saved.caption,legacy.caption);assert.equal(saved.editorName,legacy.editorName);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1]),protectedBlock);
    assert.equal(await page.locator('[data-act="workflow-edit"][data-bindex="1"]').count(),0);
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),saved);
  }finally{await browser.close();}
});

test('Workflow snapping and Bezier handles preserve history, cancellation and saved visitor geometry', {skip:!baseURL,timeout:90000},async()=>{
  const browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
    const published=await siteFixture(page,async()=>false);
    const {flowNode,flowEdge}=await import('./src/js/workflow-core.mjs');
    const original={type:'workflow',heading:'Alignment review',caption:'Keep caption',graph:{version:1,nodes:[flowNode('start','Start',0,0),flowNode('finish','Finish',300,130)],edges:[flowEdge('start','finish','r','l','main','Continue','curved')]}};
    published.work[0].study.blocks[0]=original;
    const protectedBlock=structuredClone(published.work[0].study.blocks[1]);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="work"]').click();await page.locator('[data-act="study-toggle"][data-index="0"]').click();await page.locator('[data-l2tab="story"]').click();await page.locator('[data-act="study-blocktoggle"][data-bindex="0"]').click();
    const edit=page.getByRole('button',{name:'Edit flow',exact:true});await edit.click();
    const dialog=page.getByRole('dialog',{name:'Flow editor',exact:true});
    const point=async id=>dialog.locator(`.react-flow__node[data-id="${id}"]`).evaluate(node=>{const matrix=new DOMMatrix(getComputedStyle(node).transform);return {x:matrix.m41,y:matrix.m42};});
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await dialog.getByRole('button',{name:'Readable size',exact:true}).click();await settle();
    const start=await dialog.locator('.react-flow__node[data-id="start"]').boundingBox(),finish=await dialog.locator('.react-flow__node[data-id="finish"]').boundingBox();
    await page.mouse.move(finish.x+finish.width/2,finish.y+finish.height/2);await page.mouse.down();await page.mouse.move(finish.x+finish.width/2,start.y+finish.height/2+4,{steps:12});
    const moving=await dialog.locator('.react-flow__node[data-id="finish"]').boundingBox();
    await page.mouse.move(finish.x+finish.width/2,start.y+finish.height/2+4+start.y+4-moving.y);
    await dialog.locator('.wf-snap-guides line').first().waitFor({state:'attached'});await page.mouse.up();await settle();
    assert.equal((await point('finish')).y,(await point('start')).y,'Snap survives pointer release');
    assert.equal(await dialog.locator('.wf-snap-guides').count(),0);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await point('finish')).y,130);
    await dialog.getByRole('button',{name:'Redo',exact:true}).click();assert.equal((await point('finish')).y,0);
    await dialog.getByRole('button',{name:'Snap to steps',exact:true}).click();
    const free=await dialog.locator('.react-flow__node[data-id="finish"]').boundingBox();
    await page.mouse.move(free.x+free.width/2,free.y+free.height/2);await page.mouse.down();await page.mouse.move(free.x+free.width/2,free.y+free.height/2+4);await page.mouse.move(free.x+free.width/2,free.y+free.height/2+9);await page.mouse.up();await settle();
    assert.ok((await point('finish')).y>3,'Toggle permits free placement');
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();
    await dialog.getByRole('button',{name:'Snap to steps',exact:true}).click();
    await page.keyboard.down('Alt');await page.mouse.move(free.x+free.width/2,free.y+free.height/2);await page.mouse.down();await page.mouse.move(free.x+free.width/2,free.y+free.height/2+4);await page.mouse.move(free.x+free.width/2,free.y+free.height/2+9);await page.mouse.up();await page.keyboard.up('Alt');await settle();
    assert.ok((await point('finish')).y>3,'Alt temporarily bypasses snapping');
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();
    await dialog.locator('.react-flow__node[data-id="start"]').click();await dialog.locator('.wf-inspector .wf-row').first().click();
    const path=dialog.locator('.react-flow__edge-path'),initialPath=await path.getAttribute('d');
    const handle=dialog.getByRole('button',{name:'Curve start handle',exact:true}),endHandle=dialog.getByRole('button',{name:'Curve end handle',exact:true});
    const handleBox=await handle.boundingBox();assert.equal(Math.round(handleBox.width),28);
    await page.mouse.move(handleBox.x+14,handleBox.y+14);await page.mouse.down();await page.mouse.move(handleBox.x+64,handleBox.y+94,{steps:10});await page.mouse.up();
    const curvedPath=await path.getAttribute('d');assert.notEqual(curvedPath,initialPath);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await path.getAttribute('d'),initialPath);
    await dialog.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await path.getAttribute('d'),curvedPath);
    await dialog.locator('.react-flow__node[data-id="start"]').click();await dialog.locator('.wf-inspector .wf-row').first().click();
    await endHandle.focus();await page.keyboard.press('Shift+ArrowDown');assert.notEqual(await path.getAttribute('d'),curvedPath);
    await dialog.getByRole('button',{name:'Zoom out',exact:true}).click();await settle();assert.equal(Math.round((await handle.boundingBox()).width),28);
    const beforeCancel=await path.getAttribute('d'),cancelBox=await handle.boundingBox();
    await page.mouse.move(cancelBox.x+14,cancelBox.y+14);await page.mouse.down();await page.mouse.move(cancelBox.x+54,cancelBox.y+54,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await path.getAttribute('d'),beforeCancel);assert.equal(await dialog.isVisible(),true);
    await dialog.getByRole('button',{name:'Reset curve',exact:true}).click();assert.equal(await path.getAttribute('d'),initialPath);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await path.getAttribute('d'),beforeCancel);
    await dialog.locator('.react-flow__node[data-id="start"]').click();await dialog.locator('.wf-inspector .wf-row').first().click();
    await page.screenshot({path:join(tmpdir(),'rk-workflow-bezier-desktop.png')});
    await dialog.getByRole('tab',{name:'Web',exact:true}).click();await settle();assert.equal(await dialog.locator('.wf-curve-handle').count(),0);assert.equal(await dialog.locator('.react-flow__edge-path').getAttribute('d'),beforeCancel);
    await page.setViewportSize({width:390,height:844});await dialog.getByRole('tab',{name:'Editor',exact:true}).click();await settle();
    await dialog.locator('.react-flow__node[data-id="start"]').click();await dialog.locator('.wf-inspector .wf-row').first().click();
    await handle.focus();await page.keyboard.press('ArrowRight');
    assert.equal(await handle.evaluate(element=>getComputedStyle(element).touchAction),'none');
    const touch=await page.context().newCDPSession(page),touchBox=await endHandle.boundingBox(),beforeTouch=await path.getAttribute('d');
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchBox.x+14,y:touchBox.y+14}]});
    for(let step=1;step<=5;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchBox.x+14+step*4,y:touchBox.y+14+step*6}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
    assert.notEqual(await path.getAttribute('d'),beforeTouch,'Touch drags the curve without scrolling the editor');
    await page.screenshot({path:join(tmpdir(),'rk-workflow-bezier-mobile.png')});
    assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
    await dialog.getByRole('button',{name:'Apply flow',exact:true}).click();
    const saved=await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]);
    assert.ok(saved.graph.edges[0].data.curve);assert.equal(saved.graph.nodes[1].position.y,0);assert.equal(saved.caption,original.caption);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1]),protectedBlock);
    await edit.click();await dialog.locator('.wf-inspector .wf-row').first().click();await dialog.getByRole('textbox',{name:'Step title',exact:true}).fill('Cancel this');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),saved);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rk:content:draft')||'null')?.work?.[0]?.study?.blocks?.[0]?.graph?.edges?.[0]?.data?.curve);
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),saved);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('Workflow marquee groups, Space pan and unified snapping preserve graph history', {skip:!baseURL,timeout:90000},async()=>{
  const browser=await chromium.launch(launchOptions);
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce',hasTouch:true}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
    const published=await siteFixture(page,async()=>false);
    const original={type:'workflow',heading:'Group review',caption:'Keep caption',graph:{version:1,nodes:[flowNode('first','First',0,0),flowNode('second','Second',300,0),flowNode('third','Third',650,150)],edges:[flowEdge('first','second'),flowEdge('second','third')]}};
    published.work[0].study.blocks[0]=original;
    const protectedBlock=structuredClone(published.work[0].study.blocks[1]);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="work"]').click();await page.locator('[data-act="study-toggle"][data-index="0"]').click();await page.locator('[data-l2tab="story"]').click();await page.locator('[data-act="study-blocktoggle"][data-bindex="0"]').click();
    const edit=page.getByRole('button',{name:'Edit flow',exact:true});await edit.click();
    const dialog=page.getByRole('dialog',{name:'Flow editor',exact:true}),canvas=dialog.getByRole('group',{name:'Workflow canvas',exact:true}),snap=dialog.getByRole('button',{name:'Snap to steps',exact:true});
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const positions=()=>dialog.locator('.react-flow__node').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>{const matrix=new DOMMatrix(getComputedStyle(node).transform);return [node.dataset.id,{x:matrix.m41,y:matrix.m42}];})));
    const node=id=>dialog.locator(`.react-flow__node[data-id="${id}"]`);
    const marquee=async()=>{const first=await node('first').boundingBox(),second=await node('second').boundingBox();await page.mouse.move(first.x-12,first.y-12);await page.mouse.down();await page.mouse.move(second.x+second.width+12,second.y+second.height+12,{steps:15});await page.mouse.up();await settle();};
    await dialog.getByRole('button',{name:'Readable size',exact:true}).click();await settle();
    const before=await positions();await marquee();
    assert.equal(await dialog.locator('.react-flow__node.selected').count(),2);
    assert.deepEqual(await positions(),before,'Marquee does not pan or move steps');
    const selected=await dialog.locator('.react-flow__nodesselection-rect').boundingBox();
    await page.mouse.move(selected.x+selected.width/2,selected.y+selected.height/2);await page.mouse.down();await page.mouse.move(selected.x+selected.width/2+57,selected.y+selected.height/2+45,{steps:12});await page.mouse.up();await settle();
    const moved=await positions();assert.notDeepEqual(moved.first,before.first);
    assert.equal(moved.second.x-moved.first.x,300);assert.equal(moved.second.y-moved.first.y,0);assert.deepEqual(moved.third,before.third);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await positions(),before);
    await dialog.getByRole('button',{name:'Redo',exact:true}).click();assert.deepEqual(await positions(),moved);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();await marquee();
    await dialog.getByRole('button',{name:'Delete selection',exact:true}).click();assert.deepEqual(Object.keys(await positions()),['third']);assert.equal(await dialog.locator('.react-flow__edge').count(),0);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await positions(),before);await dialog.locator('.react-flow__edge').nth(1).waitFor({state:'attached'});assert.equal(await dialog.locator('.react-flow__edge').count(),2);
    await canvas.focus();const viewport=dialog.locator('.react-flow__viewport'),beforePan=await viewport.getAttribute('style');
    await page.keyboard.down('Space');await page.waitForFunction(()=>!!document.querySelector('.wf-diagram-editor[data-panning]'));
    assert.equal(await dialog.locator('.react-flow__pane').evaluate(element=>getComputedStyle(element).cursor),'grab');
    const first=await node('first').boundingBox();await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(first.x+first.width/2+85,first.y+first.height/2+65,{steps:12});await page.mouse.up();
    assert.notEqual(await viewport.getAttribute('style'),beforePan);assert.deepEqual(await positions(),before,'Space pans over a step without moving it');
    await page.keyboard.up('Space');assert.equal(await canvas.getAttribute('data-panning'),null);
    await canvas.focus();await page.keyboard.down('Space');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await canvas.getAttribute('data-panning'),null);await page.keyboard.up('Space');
    await dialog.getByRole('button',{name:'Readable size',exact:true}).click();await settle();
    await node('first').click();const title=dialog.getByRole('textbox',{name:'Step title',exact:true});await title.fill('First');await title.press('End');await title.press('Space');assert.equal(await title.inputValue(),'First ');assert.equal(await canvas.getAttribute('data-panning'),null);await title.fill('First');await canvas.focus();
    const dragTo=async(id,target)=>{const box=await node(id).boundingBox(),point=(await positions())[id],zoom=await viewport.evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).a);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+4,box.y+box.height/2);await page.mouse.move(box.x+box.width/2+(target.x-point.x)*zoom+4,box.y+box.height/2+(target.y-point.y)*zoom,{steps:15});await settle();};
    await dragTo('third',{x:600,y:0});await dialog.locator('.wf-spacing-guide').waitFor({state:'attached'});
    assert.deepEqual(await dialog.locator('.wf-spacing-guide text').allTextContents(),['150','150']);
    await page.screenshot({path:join(tmpdir(),'rk-workflow-equal-spacing-1440.png')});await page.mouse.up();await settle();
    assert.equal((await positions()).third.x,600);assert.equal((await positions()).third.y,0);
    await dragTo('third',{x:700,y:200});await page.mouse.up();await settle();const gridded=(await positions()).third;assert.equal(gridded.x%22,0);assert.equal(gridded.y%22,0);
    await snap.click();await dragTo('third',{x:705,y:205});await page.mouse.up();await settle();assert.ok((await positions()).third.x%22!==0);assert.equal(await dialog.locator('.wf-snap-guides').count(),0);
    await snap.click();await page.keyboard.down('Alt');await dragTo('third',{x:713,y:213});await page.mouse.up();await page.keyboard.up('Alt');await settle();assert.ok((await positions()).third.x%22!==0);
    const retained=await positions();await page.setViewportSize({width:390,height:844});await settle();await dialog.getByRole('button',{name:'Fit diagram',exact:true}).click();await settle();await marquee();assert.equal(await dialog.locator('.react-flow__node.selected').count(),2);
    const touch=await page.context().newCDPSession(page),touchBox=await dialog.locator('.react-flow__nodesselection-rect').boundingBox(),touchX=touchBox.x+touchBox.width/2,touchY=touchBox.y+touchBox.height/2;
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY}]});
    for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX+step*4,y:touchY+step*3}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();await settle();const touched=await positions();assert.notDeepEqual(touched.first,retained.first);assert.equal(touched.second.x-touched.first.x,300);assert.equal(touched.second.y-touched.first.y,0);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await positions(),retained);assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));await marquee();await page.screenshot({path:join(tmpdir(),'rk-workflow-selection-390.png')});
    await dialog.getByRole('button',{name:'Apply flow',exact:true}).click();const saved=await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]);for(const item of saved.graph.nodes)for(const axis of ['x','y'])assert.ok(Math.abs(item.position[axis]-retained[item.id][axis])<.001,'Saved coordinates retain full precision beyond CSS serialization');assert.equal(saved.caption,original.caption);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[1]),protectedBlock);
    await edit.click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),saved);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rk:content:draft')||'null')?.work?.[0]?.study?.blocks?.[0]?.graph?.nodes?.[2]?.position?.y>200);
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work[0].study.blocks[0]),saved);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test("Media columns Studio adds, reorders and persists nested cells", { skip: !baseURL, timeout: 90000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(15000);
      const published = await siteFixture(page, async () => false);
      published.work[0].study.blocks = [];
      await page.addInitScript(() => localStorage.setItem('rk:dev:stub', '1'));
      await page.goto(baseURL + '/studio/?devstub=1');
      await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
      const open = async () => {
        await page.locator('.adm__tab[data-tab="work"]').click();
        await page.locator('[data-act="study-toggle"][data-index="0"]').click();
        await page.locator('[data-l2tab="story"]').click();
      };
      await open();
      await page.locator('[data-act="study-pick"]').last().click();
      await page.locator('[data-pick="mediacolumns"]').click();
      const action = (name, column = null, cell = null) => page.locator('[data-act="' + name + '"][data-bindex="0"]' + (column === null ? '' : '[data-iindex="' + column + '"]') + (cell === null ? '' : '[data-cindex="' + cell + '"]'));
      for (const column of [0, 1, 2]) {
        await action('item-add').click();
        await page.locator('[data-sitem="0"][data-iindex="' + column + '"][data-ifield="label"]').fill('0' + (column + 1));
        await page.locator('[data-cell="0"][data-citem="' + column + '"][data-ccell="0"][data-cfield="heading"]').fill('Column ' + (column + 1));
        await page.locator('[data-cell="0"][data-citem="' + column + '"][data-ccell="0"][data-cfield="src"]').fill('/assets/uploads/original-' + column + '.png');
      }
      assert.deepEqual(await page.locator('.cellrow').first().locator('[data-cfield]').evaluateAll(inputs => inputs.map(input => input.dataset.cfield)), ['src', 'embedRatio', 'heading']);
      const embedSource = '<div>Saved widget</div>\n<script>document.body.dataset.ready="true"</script>';
      await page.locator('[data-cell="0"][data-citem="2"][data-ccell="0"][data-cfield="src"]').fill(embedSource);
      await page.locator('[data-cell="0"][data-citem="2"][data-ccell="0"][data-cfield="embedRatio"]').selectOption('9/16');
      await action('cell-add', 0).click();
      await page.locator('[data-cell="0"][data-citem="0"][data-ccell="1"][data-cfield="heading"]').fill('Second cell');
      await action('cell-up', 0, 1).click();
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[0].items[0].cells[0].heading), 'Second cell');
      await action('item-down', 0).click();
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[0].items[1].cells.length), 2);
      await action('cell-add', 1).click();
      await action('cell-remove', 1, 2).click();
      const draft = await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[0]);
      assert.equal(draft.type, 'mediacolumns');
      assert.equal(draft.items.length, 3);
      assert.equal(draft.items[1].cells[1].src, '/assets/uploads/original-0.png');
      assert.equal(draft.items[2].cells[0].src, embedSource);
      assert.equal(draft.items[2].cells[0].embedRatio, '9/16');
      await page.screenshot({ path: join(tmpdir(), 'rk-media-columns-editor-' + width + '.png') });
      await page.reload();
      await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
      assert.deepEqual(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[0]), draft);
      await open();
      await page.locator('[data-act="study-pick"]').last().click();
      await page.locator('[data-pick="columns"]').click();
      await page.locator('[data-act="item-add"][data-bindex="1"]').click();
      assert.deepEqual(await page.locator('[data-cell="0"][data-cbindex="1"][data-cfield]').evaluateAll(inputs => inputs.map(input => input.dataset.cfield)), ['heading', 'src', 'embedRatio']);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("built Studio refuses foreign draft commands and preserves trusted preview actions", { skip: !baseURL, timeout: 60000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  const studio = await build({ entryPoints: ["src/js/admin-studio.js"], bundle: true, write: false, format: "iife" });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const published = await siteFixture(page, async (route, url) => {
        if (url.pathname === "/js/admin-studio.js") { await route.fulfill({ contentType: "text/javascript", body: studio.outputFiles[0].text }); return true; }
        if (url.hostname === "untrusted.test") { await route.fulfill({ contentType: "text/html", body: '<!doctype html><script>parent.postMessage({__rk:"blockAct",act:"del",index:0},"*");parent.postMessage({fixtureDone:true},"*");</script>' }); return true; }
        return false;
      });
      published.work[0].study.blocks = [{ type: "text", heading: "Keep", body: '<p><strong>Safe prose</strong><img src="/fixture-missing.png" onerror=window.securityMarker=1></p>' }, { type: "text", heading: "Second", body: "Unchanged" }, { type: "text", heading: "Sealed", locked: true, vaultBlock: "fixture-protected" }];
      await page.addInitScript(() => { localStorage.setItem("rk:dev:stub", "1"); window.securityMarker = 0; });
      await page.goto(baseURL + "/studio/?devstub=1");
      await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
      await page.locator('.adm__tab[data-tab="work"]').click();
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      const before = await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks));
      await page.evaluate(() => new Promise(resolve => {
        const onMessage = event => { if (event.origin === "https://untrusted.test" && event.data.fixtureDone) { removeEventListener("message", onMessage); resolve(); } };
        addEventListener("message", onMessage);
        const frame = document.createElement("iframe"); frame.src = "https://untrusted.test/"; document.body.append(frame);
      }));
      assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks)), before);
      assert.equal(await page.evaluate(() => window.securityMarker), 0);
      await page.waitForFunction(() => !!document.querySelector(".adm__frame")?.contentWindow?.RK);
      const trusted = async data => {
        const preview = await page.locator(".adm__frame").elementHandle();
        const frame = await preview.contentFrame();
        await frame.evaluate(message => parent.postMessage(message, location.origin), data);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      };
      await trusted({ __rk: "blockAct", act: "del", index: 2 });
      assert.equal(await page.evaluate(() => JSON.stringify(window.__RKStudio.getDraft().work[0].study.blocks)), before);
      await trusted({ __rk: "blockAct", act: "dup", index: 0 });
      await page.waitForFunction(() => window.__RKStudio.getDraft().work[0].study.blocks.length === 4);
      assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.blocks[1].heading), "Keep");
      await page.screenshot({ path: join(tmpdir(), "rk-security-studio-" + width + ".png") });
      await page.close();
    }
  } finally { await browser.close(); }
});

test("built sign-in gate retains control after provider failure and cancellation", { skip: !baseURL, timeout: 45000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let finishes = 0, releaseStatus;
    const statusReady = new Promise(resolve => { releaseStatus = resolve; });
    await siteFixture(page, async (route, url) => {
      if (url.pathname === "/admin/auth/status") { await statusReady; await route.fulfill({ json: { passwordless: true, passkeys: 1, hasRecovery: true, hasAdminPass: true } }); return true; }
      if (url.pathname === "/admin/webauthn/auth/begin") { await route.fulfill({ json: { challenge: "YQ".repeat(22), rpId: "127.0.0.1", timeout: 120000, allowCredentials: [] } }); return true; }
      if (url.pathname === "/admin/webauthn/auth/finish") { finishes++; await route.fulfill({ json: { token: "synthetic-session", exp: Date.now() + 60000 } }); return true; }
      return false;
    });
    await page.addInitScript(() => {
      localStorage.setItem("rk:content:draft", '{"synthetic":"keep this draft"}');
      localStorage.setItem("rk:theme", "night");
      window.providerCalls = 0;
      Object.defineProperty(navigator.credentials, "get", { value: options => {
        window.providerCalls++;
        window.providerSignal = options.signal;
        if (window.providerCalls === 1) return Promise.reject(new DOMException("Synthetic provider unavailable", "NotAllowedError"));
        return new Promise(resolve => { window.finishProvider = () => resolve({ id: "synthetic", rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([1]).buffer, authenticatorData: new Uint8Array([1]).buffer, signature: new Uint8Array([1]).buffer, userHandle: null } }); });
      } });
    });
    await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__siteRendered && !!window.RK?.openProject).catch(async error => {
      const state = await page.evaluate(() => ({ rendered: !!window.__siteRendered, projectReady: !!window.RK?.openProject, readyState: document.readyState }));
      throw new Error("Built sign-in bootstrap failed: " + JSON.stringify({ errors, state }), { cause: error });
    });
    await page.locator("#moreBtn").click();
    await page.locator('[data-open="admin"]').click();
    await page.locator("[data-passkey]").click();
    await page.waitForFunction(() => /provider|cancel/i.test(document.querySelector(".pass__err").textContent));
    assert.equal(await page.locator("[data-passkey]").isEnabled(), true);
    await page.locator("[data-passkey]").dblclick();
    await page.waitForFunction(() => window.providerCalls === 2);
    releaseStatus();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("rk:authmode") || "null")?.hasRecovery);
    assert.equal(await page.locator("[data-reclink]").count(), 0);
    assert.equal(await page.locator('.pass input[type="password"]').isVisible(), false);
    assert.equal(await page.locator("[data-passkey]").isDisabled(), true);
    await page.locator(".pass [data-cancel]").click();
    await page.evaluate(async () => { window.finishProvider(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.equal(await page.evaluate(() => window.providerSignal.aborted), true);
    assert.equal(finishes, 0);
    assert.equal(await page.locator(".pass, .adm.is-open").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:admin:sess")), null);
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft")), '{"synthetic":"keep this draft"}');
    await page.locator("#moreBtn").click();
    await page.locator('[data-open="admin"]').click();
    await page.locator("[data-passkey]").click();
    await page.waitForFunction(() => window.providerCalls === 3);
    await page.evaluate(() => window.finishProvider());
    await page.locator(".adm.is-open").waitFor();
    assert.equal(finishes, 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rk:admin:sess")).token), "synthetic-session");
    assert.equal(await page.locator(".pass--lock").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("built case study retries protected sections without restarting Figma and removes them on relock", { skip: !baseURL, timeout: 60000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      let loads = 0, protectedReads = 0;
      await siteFixture(page, async (route, url) => {
        if (url.hostname === "embed.figma.com" || (url.hostname === "www.figma.com" && url.pathname === "/embed")) { loads++; await route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="background:#f5f5f5;color:#171717;padding:24px;font:16px sans-serif"><button onclick="this.textContent=\'Prototype step 2\'">Prototype step 1</button></body>' }); return true; }
        if (url.pathname === "/vault/sign") { await route.fulfill({ json: { url: "/vault/file/synthetic-section" } }); return true; }
        if (url.pathname === "/vault/file/synthetic-section") {
          protectedReads++;
          await route.fulfill(protectedReads === 1 ? { status: 503, body: "Synthetic temporary failure" } : { json: { type: "media", locked: true, heading: "Protected prototype", items: [{ src: "https://www.figma.com/proto/synthetic-protected", kind: "figma" }] } });
          return true;
        }
        return false;
      });
      await page.addInitScript(() => {
        sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: "synthetic-grant", exp: Date.now() + 60000 }));
        localStorage.setItem("rk:theme", "night");
      });
      await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!window.RK?.openProject && !!window.RK?.vaultSignedUrl);
      await page.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
      const publicFrame = page.locator('iframe[src*="synthetic-public"]');
      await publicFrame.scrollIntoViewIfNeeded();
      await page.locator('.pj').evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));});
      await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").click();
      await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button",{name:"Prototype step 2",exact:true}).waitFor();
      await page.evaluate(() => { window.keptFrame = document.querySelector('iframe[src*="synthetic-public"]'); });
      await page.locator("[data-vault-retry]").click();
      const protectedFrame = page.locator('iframe[src*="synthetic-protected"]');
      await protectedFrame.scrollIntoViewIfNeeded();
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button").waitFor();
      assert.equal(await page.evaluate(() => window.keptFrame === document.querySelector('iframe[src*="synthetic-public"]')), true);
      assert.equal(await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").innerText(), "Prototype step 2");
      assert.equal(loads, 2);
      assert.equal(protectedReads, 2);
      const protectedTools = protectedFrame.locator("..").locator(".pjb__frame-tools");
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button").click();
      await page.context().setOffline(true);
      await page.waitForFunction(() => document.querySelector('iframe[src*="synthetic-protected"]').parentElement.querySelector("[data-embed-state]").textContent === "Offline");
      await page.context().setOffline(false);
      assert.equal(loads, 2, "Reconnection must not reload either prototype");
      await protectedTools.locator("[data-embed-retry]").click();
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button", { name: "Prototype step 1" }).waitFor();
      assert.equal(loads, 3);
      assert.equal(await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").innerText(), "Prototype step 2");
      assert.equal(await page.evaluate(() => window.keptFrame === document.querySelector('iframe[src*="synthetic-public"]')), true);
      await page.context().route("https://www.figma.com/proto/synthetic-protected", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic original</title><p>Original prototype fixture</p>" }));
      const opening = page.waitForEvent("popup");
      await protectedTools.getByRole("link", { name: "Open original", exact: true }).click();
      const original = await opening;
      await original.waitForLoadState("domcontentloaded");
      assert.equal(original.url(), "https://www.figma.com/proto/synthetic-protected");
      assert.equal(await original.evaluate(() => window.opener), null);
      await original.close();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator(".pjb__frame-tools").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1)), true);
      await page.screenshot({ path: join(tmpdir(), "rk-built-recovery-" + width + ".png") });
      await page.evaluate(() => { sessionStorage.removeItem("rk:vault:grant"); window.RK.setStudyLocked("recovery-fixture"); window.RK.openProject("recovery-fixture", { push: false, keepScroll: true }); });
      assert.equal(await protectedFrame.count(), 0);
      assert.equal(await page.locator('a[href*="synthetic-protected"]').count(), 0);
      await page.locator('.pj [data-pj="close"]').click();
      assert.equal(await page.locator(".pj iframe").count(), 0);
      await page.close();
      const visitor = await browser.newPage({ viewport: { width, height: 1000 } });
      const privateRequests = [];
      await siteFixture(visitor, async (route, url) => {
        if (url.pathname.startsWith("/vault/")) { privateRequests.push(url.pathname); await route.abort(); return true; }
        if (url.hostname === "embed.figma.com" || url.hostname === "www.figma.com") { await route.fulfill({ contentType: "text/html", body: "<!doctype html><button>Public prototype</button>" }); return true; }
        return false;
      });
      await visitor.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
      await visitor.waitForFunction(() => !!window.RK?.openProject);
      await visitor.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
      await visitor.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").waitFor();
      assert.equal(await visitor.locator('iframe[src*="synthetic-protected"], a[href*="synthetic-protected"]').count(), 0);
      assert.equal(await visitor.evaluate(() => window.RK.sectionAccess("recovery-fixture").unlocked), false);
      assert.deepEqual(privateRequests, []);
      await visitor.close();
    }
  } finally { await browser.close(); }
});
test("built case navigation rejects late protected recovery and allows a fresh retry", { skip: !baseURL, timeout: 45000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    for (const width of [1440,390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.addInitScript(() => {
        sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: "synthetic-navigation-grant", exp: Date.now() + 60000 }));
        const originalFetch = window.fetch;
        window.fetch = function(resource, options) {
          const address = typeof resource === "string" ? resource : resource.url;
          if (!address.includes("/vault/file/synthetic-section")) return originalFetch.call(this, resource, options);
          window.navigationReadStarted = true;
          return new Promise(resolve => { window.releaseNavigationRead = () => resolve(new Response(JSON.stringify({ type: "text", locked: true, heading: "Late private content", body: "Recovered only in its own case" }), { headers: { "Content-Type": "application/json" } })); });
        };
      });
      await siteFixture(page, async (route, url) => {
        if (url.pathname === "/vault/sign") { await route.fulfill({ json: { url: "/vault/file/synthetic-section" } }); return true; }
        if (url.hostname === "embed.figma.com") { await route.fulfill({ contentType: "text/html", body: "<!doctype html><button>Public prototype</button>" }); return true; }
        return false;
      });
      await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!window.RK?.openProject);
      await page.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
      await page.waitForFunction(() => window.navigationReadStarted);
      await page.locator('.pj [data-pj="close"]').click();
      await page.evaluate(() => window.RK.openProject("second-fixture", { push: false }));
      await page.getByText("Unchanged second project", { exact: true }).waitFor();
      const before = await page.evaluate(() => JSON.stringify(window.RK.data.work));
      await page.evaluate(async () => { window.releaseNavigationRead(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await page.evaluate(() => JSON.stringify(window.RK.data.work)), before);
      assert.equal(await page.getByText("Late private content", { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.RK.sectionAccess("second-fixture").unlocked), false);
      await page.locator('.pj [data-pj="close"]').click();
      await page.evaluate(() => { window.navigationReadStarted = false; window.RK.openProject("recovery-fixture", { push: false }); });
      await page.waitForFunction(() => window.navigationReadStarted);
      await page.evaluate(() => window.releaseNavigationRead());
      await page.getByText("Late private content", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.RK.data.work[0].study.blocks[1].locked), true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("built protected loading times out visibly and recovers without restarting another embed", { skip: !baseURL, timeout: 45000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => {
      sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: "synthetic-timeout-grant", exp: Date.now() + 3600000 }));
      const originalFetch = window.fetch;
      window.fetch = function(resource, options) {
        const address = typeof resource === "string" ? resource : resource.url;
        if (!address.includes("/vault/file/synthetic-section")) return originalFetch.call(this, resource, options);
        window.timeoutReadStarted = true;
        if (!window.recoverTimeoutRead) return new Promise(() => {});
        return Promise.resolve(new Response(JSON.stringify({ type: "text", locked: true, heading: "Recovered after timeout", body: "Original content retained" }), { headers: { "Content-Type": "application/json" } }));
      };
    });
    let frameLoads = 0;
    await siteFixture(page, async (route, url) => {
      if (url.pathname === "/vault/sign") { await route.fulfill({ json: { url: "/vault/file/synthetic-section" } }); return true; }
      if (url.hostname === "embed.figma.com" || (url.hostname === "www.figma.com" && url.pathname === "/embed")) { frameLoads++; await route.fulfill({ contentType: "text/html", body: '<!doctype html><button onclick="this.textContent=\'Prototype step 2\'">Prototype step 1</button>' }); return true; }
      return false;
    });
    await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.RK?.openProject);
    await page.clock.install();
    await page.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
    await page.waitForFunction(() => window.timeoutReadStarted);
    await page.locator('iframe[src*="synthetic-public"]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe[src*="synthetic-public"]'), bounds = frame.getBoundingClientRect();
      const position = [bounds.x, bounds.y, bounds.width, bounds.height].join(':');
      const settled = window.timeoutFramePosition === position;
      window.timeoutFramePosition = position;
      return settled && bounds.top >= 0 && bounds.left >= 0 && document.elementFromPoint(bounds.left + 20, bounds.top + 20) === frame;
    });
    const prototype = page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button");
    await prototype.click();
    await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button",{name:"Prototype step 2",exact:true}).waitFor({timeout:5000}).catch(async error => {
      await page.screenshot({path:join(tmpdir(),'rk-protected-timeout-click-failure.png')});
      throw new Error(error.message + '\n' + JSON.stringify(await page.locator('iframe[src*="synthetic-public"]').evaluate(frame => {
        const bounds = frame.getBoundingClientRect();
        return {bounds:bounds.toJSON(),topmost:document.elementFromPoint(bounds.left + 20,bounds.top + 20)?.outerHTML,scroll:document.querySelector('.pj')?.scrollTop};
      })));
    });
    await page.clock.runFor(16000);
    await page.locator("[data-vault-retry]").waitFor();
    assert.equal(await page.locator("[data-vault-retry]").isEnabled(), true);
    assert.equal(await page.evaluate(() => window.RK.data.work[0].study.blocks[1].vaultBlock), "synthetic-section");
    await page.evaluate(() => { window.recoverTimeoutRead = true; });
    await page.locator("[data-vault-retry]").click();
    await page.getByText("Recovered after timeout", { exact: true }).waitFor();
    assert.equal(frameLoads, 1);
    assert.equal(await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").innerText(), "Prototype step 2");
  } finally { await browser.close(); }
});

function sourceFunction(name) {
  const start = source.indexOf("  function " + name + "("), firstLine = source.indexOf("\n", start);
  assert.ok(start >= 0);
  const end = source.slice(start, firstLine).trimEnd().endsWith("}") ? firstLine : source.indexOf("\n  }", firstLine) + 4;
  return source.slice(start, end);
}

test("rich HTML keeps authored formatting and media while removing executable content", { timeout: 30000 }, async () => {
  const bundle = await build({ entryPoints: ["src/js/rich-html.mjs"], bundle: true, write: false, format: "iife", globalName: "rkRichHtml" });
  const browser = await chromium.launch({ ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://media.synthetic.test/**", route => route.fulfill({ status: 404 }));
    await page.setContent("<!doctype html><div id='result'></div>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => {
      window.executed = 0;
      const markup = '<p style="text-align:center;color:rgb(255, 0, 0);position:fixed;background-image:url(https://bad.test/x)"><strong>Preserved</strong> <em>text</em></p><ul><li>Every item</li></ul><figure><img src=assets/uploads/original.png onerror=window.executed++><figcaption>Original image</figcaption></figure><a target=_blank href="https://example.test">Safe link</a><a href="java&#x73;cript:window.executed++">Bad link</a><svg onload=window.executed++><a xlink:href="javascript:window.executed++">Bad SVG</a></svg><math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.executed++>"><script>window.executed++</script><iframe srcdoc="<script>parent.executed++</script>"></iframe><form><input autofocus onfocus=window.executed++></form>';
      const clean = window.rkRichHtml.sanitizeRichHtml(markup, value => "https://media.synthetic.test/" + value);
      const host = document.getElementById("result"); host.innerHTML = clean;
      return { clean, align: host.querySelector("p").style.textAlign, position: host.querySelector("p").style.position, background: host.querySelector("p").style.backgroundImage, image: host.querySelector("figure img").getAttribute("src"), rel: host.querySelector('a[href="https://example.test"]').rel, active: host.querySelectorAll("script,iframe,svg,math,form,input").length, handlers: [...host.querySelectorAll("*")].flatMap(element => [...element.attributes]).filter(attribute => /^on/i.test(attribute.name)).length };
    });
    assert.equal(result.active, 0);
    assert.equal(result.handlers, 0);
    assert.equal(result.position, "");
    assert.equal(result.background, "");
    assert.equal(result.align, "center");
    assert.equal(result.image, "https://media.synthetic.test/assets/uploads/original.png");
    assert.equal(result.rel, "noopener noreferrer");
    assert.match(result.clean, /<strong>Preserved<\/strong> <em>text<\/em>/);
    assert.match(result.clean, /<li>Every item<\/li>/);
    assert.doesNotMatch(result.clean, /href="javascript:/i);
    assert.equal(await page.evaluate(() => window.executed), 0);
  } finally { await browser.close(); }
});

test("case refresh preserves live Figma frames and provides honest authorized recovery", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let frameLoads = 0;
  await page.route("https://embed.figma.com/**", route => { frameLoads++; return route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="background:#fafafa;color:#171717;font:16px sans-serif"><button id="step" onclick="this.textContent=\'Prototype step 2\'">Prototype step 1</button></body>' }); });
  try {
    await page.setContent('<style>:root{--bg-2:#111116;--text:#ece7e1;--text-dim:#8f8a84;--line:rgba(236,231,225,.12);--line-soft:rgba(236,231,225,.06);--sans:sans-serif}body{margin:16px;background:#08080a;color:var(--text)}#overlay{max-width:900px;margin:auto}</style><div id="overlay"><div data-crumb></div><div data-content></div></div>');
    await page.addStyleTag({ content: readFileSync(new URL("./css/project.css", import.meta.url), "utf8") });
    await page.evaluate(code => {
      const setup = new Function("code", `
        var overlay=document.querySelector('#overlay'),activeId='first',PREVIEW=false,lastSpyId=null,stageCtl=null;
        document.documentElement.classList.add('lite');
        var applyNav=()=>{},pjIsOwner=()=>false,pjHasSavedDeck=()=>false,pjDeckPublic=()=>false,esc=value=>value,attr=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        var updateSpy=()=>{},coverParallax=()=>{},isoParallax=()=>{},normalizeGalleries=()=>{},isoEnhance=()=>{},focusEnhance=()=>{},graphWire=()=>{},galleryNav=()=>{},resolveVaultMedia=()=>{},autoResolveVaultBlocks=()=>{};
        var RUNTIME_CLASS=/^(is-|pjb__gallery-nav--ondark$|pjb--flash$|pjb--droptarget$)/,FS_SVG='',unlocked=false;
        function contentHtml(){return '<div data-stage data-count="2"><div data-stage-main><span class="pj__stage-slide is-active" data-kind="image">First</span><span class="pj__stage-slide" data-kind="image">Second</span></div><div data-stage-strip><button class="pj__stage-thumb is-active" data-thumb="0">First</button><button class="pj__stage-thumb" data-thumb="1">Second</button></div></div><div class="pj__body"><section data-block="0" id="public">'+frameEl('https://embed.figma.com/proto/public','fixture','prototype',false,'https://www.figma.com/proto/public')+'</section><section data-block="1" id="protected">'+(unlocked?frameEl('https://embed.figma.com/proto/protected','fixture','prototype',false,'https://www.figma.com/proto/protected'):'<p>Protected section</p>')+'</section></div>';}
        eval(code);
        overlay.addEventListener('click',onOverlayClick);
        return {fill:()=>fillContent({id:activeId}),unlock:()=>{unlocked=true;fillContent({id:activeId});},lock:()=>{unlocked=false;fillContent({id:activeId});},original:figmaOriginalUrl};
      `);
      window.fixture = setup(code);
      window.fixture.fill();
      window.originalFrame = document.querySelector("iframe");
    }, ["figmaOriginalUrl", "frameEl", "fillContent", "hydrateEmbedRecovery", "disposeEmbedRecovery", "destroyStage", "initStage", "morphInto", "morphChildren", "morphNode", "mergeClass", "morphAttrs", "onOverlayClick"].map(sourceFunction).join("\n"));
    await page.frameLocator("#public iframe").getByRole("button").click();
    await page.locator('[data-thumb="1"]').click();
    await page.evaluate(() => window.fixture.unlock());
    await page.frameLocator("#protected iframe").getByRole("button").waitFor();
    assert.equal(await page.evaluate(() => window.originalFrame === document.querySelector("#public iframe")), true);
    assert.equal(await page.frameLocator("#public iframe").getByRole("button").innerText(), "Prototype step 2");
    assert.equal(frameLoads, 2);
    assert.equal(await page.locator(".pj__stage-slide.is-active").count(), 1);
    assert.equal(await page.locator(".pj__stage-slide.is-active").innerText(), "Second");
    await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.fixture.fill(); });
    await page.waitForFunction(() => document.querySelector("#public [data-embed-state]").textContent === "Offline");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator("#public [data-embed-retry]").click();
    await page.frameLocator("#public iframe").getByRole("button", { name: "Prototype step 1" }).waitFor();
    assert.equal(frameLoads, 3);
    assert.equal(await page.locator("#public a").getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.evaluate(() => window.fixture.original("https://www.figma.com/embed?url=javascript%3Aalert(1)")), "");
    await page.evaluate(() => window.fixture.lock());
    assert.equal(await page.locator("#protected iframe, #protected a").count(), 0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator("#public .pjb__frame-tools").evaluate(element => {
        const frame = element.getBoundingClientRect();
        return [...element.children].every(child => { const rect = child.getBoundingClientRect(); return rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom; });
      });
      assert.equal(bounds, true);
      await page.screenshot({ path: join(tmpdir(), "rk-protected-recovery-" + width + ".png") });
    }
  } finally { await browser.close(); }
});