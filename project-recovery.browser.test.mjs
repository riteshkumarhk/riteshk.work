import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { flowNode, flowEdge } from './src/js/workflow-core.mjs';
import postcss from 'postcss';
import { applyUiCorners } from './tools/ui-corners.mjs';
import { presenterPanelStyles } from './src/js/presenter-panel.mjs';

const source = readFileSync(new URL("./src/js/project.js", import.meta.url), "utf8");
const baseURL = process.env.SLIDE_LAB_URL;
const launchOptions = { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true };

test('platform squircle corners preserve radii geometry circles pills and authored content', async () => {
  const browser = await chromium.launch(launchOptions);
  const css = ['styles','admin','project','journey','resume-preview','slide-merge-theme','slide-merge-properties','workflow'].map(name => readFileSync(new URL('./css/' + name + '.css', import.meta.url), 'utf8')).join('\n') + presenterPanelStyles + applyUiCorners(readFileSync('node_modules/@excalidraw/excalidraw/dist/prod/index.css', 'utf8'));
  const baseline = postcss.parse(css);
  baseline.walkDecls(/^corner-/, declaration => declaration.remove());
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<style id="surface"></style><style>body{margin:16px!important;overflow:auto!important}section{margin:16px 0;max-width:100%}.audit-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:16px}.audit-grid>div{min-width:0}#dialog{position:static;transform:none;width:min(360px,100%);margin:0}#native{position:relative;min-height:120px}#circle{width:40px;height:40px}#card{padding:12px}.pp__nowwrap{max-width:280px}</style><main><section class="audit-grid"><div class="pjb__card" id="card" data-corner="squircle">Case study card</div><button class="btn" id="pill" data-corner="round">Primary action</button><button class="pjx__btn" id="circle" data-corner="round" aria-label="Close">X</button><div class="pass__box" id="dialog" data-corner="squircle">Dialog surface</div></section><section class="adm"><button class="adm__hist-btn" id="history" data-corner="squircle" aria-label="Undo">Undo</button><div class="af"><input type="text" id="field" value="Studio field" data-corner="squircle"></div></section><section class="excalidraw" id="native"><div class="Island" id="island" data-corner="squircle">Native properties</div><div class="OverwriteConfirm__Description__icon" id="native-circle" data-corner="round">!</div></section><section class="pp__ctrls"><button class="pp__btn" id="presenter-circle" data-corner="round">Next</button></section><section><div class="pp__nowwrap" id="presenter-preview" data-corner="squircle"></div><button class="pp__btn" id="presenter-tool" data-corner="squircle">Tool</button></section><section><div class="wf-step" id="authored-workflow" data-corner="round">Authored workflow</div><div class="gs-card" id="authored-card" style="border-radius:18px;width:100px;height:60px" data-corner="round">Authored card</div><iframe id="art-frame" title="Authored resume" srcdoc="<div id=art style=\'border-radius:12px;width:100px;height:60px\'>Resume artwork</div>"></iframe></section></main>');
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}.adm{position:relative!important;display:block!important;height:auto!important;min-height:0!important;opacity:1!important;visibility:visible!important;transform:none!important}.excalidraw{height:auto!important;min-height:100px}#island{width:180px;min-height:80px}.audit-grid{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}'});
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const appearance of ['light','dark']) {
        await page.evaluate(({css,appearance}) => { document.documentElement.dataset.appearance=appearance; document.querySelector('#surface').textContent=css; }, { css:baseline.toString(), appearance });
        const measure = () => page.locator('[data-corner]').evaluateAll(elements => elements.map(element => {
          const style=getComputedStyle(element),rect=element.getBoundingClientRect();
          return { id:element.id, rect:[rect.x,rect.y,rect.width,rect.height], radii:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius] };
        }));
        const before=await measure();
        assert.ok(before.every(element=>element.rect[2]>0&&element.rect[3]>0), 'Every measured sample must be visible');
        await page.evaluate(css => { document.querySelector('#surface').textContent=css; }, css);
        assert.deepEqual(await measure(), before);
        const failures = await page.locator('[data-corner]').evaluateAll(elements => elements.flatMap(element => {
          if (!CSS.supports('corner-shape','squircle')) return [];
          const reference=document.createElement('div'); reference.style.cornerShape=element.dataset.corner; document.body.append(reference);
          const expected=getComputedStyle(reference).cornerShape; reference.remove();
          return getComputedStyle(element).cornerShape===expected ? [] : [{id:element.id,expected,actual:getComputedStyle(element).cornerShape}];
        }));
        assert.deepEqual(failures, []);
        assert.equal(await page.frameLocator('#art-frame').locator('#art').evaluate(element=>getComputedStyle(element).cornerShape===getComputedStyle(document.body).cornerShape), true);
        await page.screenshot({path:join(tmpdir(),'rk-platform-corners-'+width+'-'+appearance+'.png'),fullPage:true});
      }
    }
  } finally { await browser.close(); }
});

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
    await page.addStyleTag({ content: readFileSync(new URL("./css/journey.css", import.meta.url), "utf8") });
    await page.evaluate(html => { document.querySelector('#fixture').innerHTML = '<ol id="timeline"></ol>'; window.RK = { data: { journey: { enabled: true, chapters: [{ name: "Fixture", entries: [{ title: "Entry", body: html, visibility: "public" }] }] }, work: [] } }; }, markup);
    await page.addScriptTag({ content: journey.outputFiles[0].text });
    await page.evaluate(() => window.RK.openJourney());
    await page.locator('[data-jstory]').click();
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
      window.__rkAdminAuth = { session: { token: 'synthetic-list-test', exp: Date.now() + 3600000 }, generation: 0, lastActivity: Date.now(), activitySent: 0 };
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

test('Studio preview navigation waits for saved slides and ignores stale requests', async()=>{
    const {runInNewContext}=await import('node:vm');
    const source=readFileSync(new URL('./src/js/admin-studio.js',import.meta.url),'utf8');
    const start=source.indexOf('  async function navigateFromPreview(destination) {');
    const end=source.indexOf('  function revealEditorSelection',start);
    const pending=[],rendered=[],errors=[];
    const scope={previewNavigation:0,nativeSlideSession:{editor:{flush:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}},root:{classList:{contains:()=>true}},clearTimeout,l2PreviewTimer:null,jrnPreviewTimer:null,blockRenameTimer:null,openStudy:-1,journeyOpen:false,activeTab:'work',renderBody:()=>rendered.push(scope.activeTab),status:message=>errors.push(message)};
    runInNewContext(source.slice(start,end),scope);
    const first=scope.navigateFromPreview({page:'about'}),second=scope.navigateFromPreview({page:'contact'});
    assert.deepEqual(rendered,[]);
    pending[1].resolve(); await second;
    pending[0].resolve(); await first;
    assert.deepEqual(rendered,['contact']);
    const failed=scope.navigateFromPreview({page:'about'});
    pending[2].reject(new Error('offline')); await failed;
    assert.deepEqual(rendered,['contact']);
    assert.deepEqual(errors,['Not saved: offline']);
  });

test('Studio editor and preview synchronize case sections and navigation without changing drafts', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    page.setDefaultTimeout(12000);
    const published=await journeyFixture(page);
    published.caseNav='rail'; published.caseNavM='rail';
    published.aboutSections=['about','recognition','path','capabilities','education','photos'].map(key=>({key,on:true}));
    published.aboutGallery=structuredClone(published.journey.chapters[0].entries[0].images);
    published.work.push({id:'second-fixture',client:'Second client',title:'Second project',featured:true,study:{blocks:[{type:'text',body:'Unchanged second project'}]}});
    published.work[0].study.blocks=Array.from({length:8},(_,index)=>({type:'text',heading:'Section '+index,body:'<p>'+('Section content '+index+' ').repeat(150)+'</p>'}));
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="work"]').click();
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator('[data-l2tab="story"]').click();
    const preview=page.frameLocator('.adm__frame');
    const previewLink=async selector=>{
      await preview.locator('body').evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await preview.locator('#nav:not(.is-hidden)').waitFor();
      assert.equal(await page.evaluate(()=>document.querySelector('.adm__frame').getBoundingClientRect().top>=document.querySelector('.adm__workbar').getBoundingClientRect().bottom-1),true);
      const toggle=preview.locator('#navToggle');
      if (await toggle.isVisible()) {
        if (await toggle.getAttribute('aria-expanded')!=='true') await toggle.click();
        await preview.locator('#menu').locator(selector).first().click();
      } else await preview.locator('#nav').locator(selector).first().click();
    };
    await preview.locator('[data-block="7"]').waitFor();
    await preview.locator('[data-block="7"]').evaluate(section=>{window.__syncPreviewSection=section;});
    const before=await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft()));
    await page.locator('[data-act="study-blocktoggle"][data-bindex="7"]').click();
    await page.waitForFunction(()=>{const frame=document.querySelector('.adm__frame'),section=frame.contentDocument.querySelector('[data-block="7"]'),rect=section.getBoundingClientRect();return rect.top<frame.contentWindow.innerHeight && rect.bottom>0;});
    assert.equal(await preview.locator('[data-block="7"]').evaluate(section=>section===window.__syncPreviewSection),true);
    await preview.locator('[data-block="1"] .pjb__h').click();
    await page.waitForFunction(()=>document.querySelector('.study__block.is-open [data-act="study-blocktoggle"]')?.dataset.bindex==='1');
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__RKStudio.getDraft())),before);
    await page.locator('[data-l2tab="details"]').click();
    await preview.locator('[data-block="2"] .pjb__h').click();
    await page.locator('[data-l2tab="story"][aria-selected="true"]').waitFor();
    await page.locator('.study__block.is-open [data-act="study-blocktoggle"][data-bindex="2"]').waitFor();
    assert.equal(await page.evaluate(()=>!!document.querySelector('.adm__frame').contentDocument.__rkStudioNavigation),true);
    await preview.locator('[data-pj="close"]').click();
    await page.waitForFunction(()=>document.querySelector('.adm__l2').hidden);
    await preview.locator('a[data-work="second-fixture"]').click();
    await preview.locator('[data-block="0"]').waitFor();
    assert.match(await preview.locator('[data-block="0"]').innerText(),/Unchanged second project/);
    assert.equal(await page.locator('.adm__l2-title').textContent(),'Second client');
    await preview.locator('[data-pj="prev"]').click();
    await page.waitForFunction(()=>document.querySelector('.adm__l2-title')?.textContent==='Synthetic');
    await preview.locator('[data-block="7"]').waitFor();
    await preview.locator('[data-pj="next"]').click();
    await page.waitForFunction(()=>document.querySelector('.adm__l2-title')?.textContent==='Second client');
    assert.match(page.frames().find(frame=>frame.url().includes('preview=1')).url(),/preview=1/);
    await preview.locator('[data-pj="close"]').click();
    await previewLink('[data-page-link="about"]');
    await page.locator('.adm__tab[data-tab="aboutpage"].is-active').waitFor();
    await preview.locator('[data-page="about"].is-active').waitFor();
    await previewLink('a[aria-label="Open r\u00e9sum\u00e9"],#menuResume');
    await page.locator('.adm__tab[data-tab="contact"].is-active').waitFor();
    await page.locator('.adm__tab[data-tab="aboutpage"]').click();
    await preview.locator('[data-page="about"].is-active').waitFor();
    await preview.locator('#timeline > .tl').nth(1).locator('h3').click();
    await page.locator('[data-act="jrole-toggle"][data-index="1"][aria-expanded="true"]').first().waitFor();
    await preview.locator('#timeline > .tl[data-studio-selected]').waitFor();
    await page.locator('[data-act="jrole-toggle"][data-index="0"]').first().click();
    await preview.locator('#timeline > .tl[data-studio-selected]').filter({hasText:'Senior Designer - Edge Growth'}).waitFor();
    await preview.locator('[data-jstory]').filter({hasText:'second chapter'}).click();
    await page.locator('[data-act="jstory-toggle"][data-je="1"][aria-expanded="true"]').first().waitFor();
    await preview.locator('#journey-detail').waitFor();
    await page.locator('[data-journey-tab="more"]').click();
    await page.locator('[data-list="recognition"][data-index="0"][data-field="title"]').click();
    await preview.locator('#recognitionList > [data-studio-selected]').waitFor();
    await preview.locator('#educationList').click();
    await page.locator('[data-about-editor="education"]').waitFor();
    await preview.locator('#aboutGallery .gallery__cap').nth(1).click();
    await page.locator('[data-journey-tab="photos"][aria-selected="true"]').waitFor();
    await page.locator('[data-galedit="2"]').click();
    await preview.locator('#aboutGallery > [data-studio-selected]').filter({hasText:'Original image 3'}).waitFor();
    await page.screenshot({path:join(tmpdir(),'rk-preview-sync-1440.png')});
    await previewLink('[data-page-link="work"]');
    await page.locator('.adm__tab[data-tab="work"].is-active').waitFor();
    await page.setViewportSize({width:390,height:844});
    while (!await page.locator('.adm.is-prevfull').count()) await page.locator('[data-prevtoggle]').click();
    await previewLink('[data-page-link="about"]');
    await preview.locator('#timeline > .tl').nth(1).locator('h3').click();
    assert.equal(await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().getAttribute('aria-expanded'),'true');
    await page.screenshot({path:join(tmpdir(),'rk-preview-sync-390.png')});
    await page.locator('[data-prevtoggle]').click();
    await page.locator('[data-act="jrole-toggle"][data-index="1"][aria-expanded="true"]').first().waitFor();
    const after=await page.evaluate(()=>window.__RKStudio.getDraft());
    const baseline=JSON.parse(before);
    for (const key of ['path','journey','aboutSections','aboutGallery']) assert.deepEqual(after[key],baseline[key],key+' unchanged');
    assert.deepEqual(after.work.map(work=>work.study.blocks),baseline.work.map(work=>work.study.blocks));
    assert.doesNotMatch(await page.locator('.adm__status').textContent(),/Not saved|not defined/);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
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
    assert.equal(await page.evaluate(() => window.__rkAdminAuth.session.token), "synthetic-session");
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:admin:sess")), null);
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
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button", { name: "Prototype step 2", exact: true }).waitFor();
      await page.context().setOffline(true);
      await page.waitForFunction(() => document.querySelector('iframe[src*="synthetic-protected"]').parentElement.querySelector("[data-embed-state]").textContent === "Offline");
      await page.context().setOffline(false);
      assert.equal(loads, 2, "Reconnection must not reload either prototype");
      const reloaded = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.searchParams.get("url")?.includes("synthetic-protected") && response.request().isNavigationRequest();
      });
      await protectedTools.locator("[data-embed-retry]").click();
      await reloaded;
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

async function journeyFixture(page) {
  const published = await siteFixture(page, async (route, url) => {
    if (url.pathname === '/about') { await route.fulfill({ contentType: 'text/html', body: readFileSync(new URL('./index.html', import.meta.url), 'utf8') }); return true; }
    if (url.pathname.startsWith('/admin/')) { await route.fulfill({ json: {} }); return true; }
    return false;
  });
  const images = await page.evaluate(() => ['#d4a557', '#249782', '#c75061'].map((color, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 640, 400);
    context.fillStyle = '#fafafa'; context.font = '48px sans-serif'; context.fillText('Original ' + (index + 1), 40, 210);
    return { src: canvas.toDataURL(), caption: 'Original image ' + (index + 1) };
  }));
  published.path = [{ id: 'edge', years: '2024 - Now', role: 'Senior Designer - Edge Growth', org: 'Microsoft AI', desc: 'Role summary stays intact.' }, { years: '2014 - 2018', role: 'Designer - Automotive HMI', org: 'Jaguar Land Rover' }];
  published.aboutLayout = [{key:'path',on:true}];
  published.journey = { enabled: true, chapters: [{ id: 'stories', name: 'Microsoft', entries: [
    { id: 'first', title: 'Edge onboarding', period: '2025 - Present', body: '<p><strong>Original story</strong> with a useful outcome.</p>', images, workId: 'journey-case', visibility: 'public' },
    ...['second', 'third', 'fourth'].map(id => ({ id, title: id + ' chapter', body: 'Independent chapter ' + id, images: [images[1]], pathId: 'edge', visibility: 'public' })),
    { id: 'presenter', title: 'Presentation-only story', body: 'Presenter detail retained', images: [images[2]], pathId: 'edge' }
  ] }, { id: 'origin', name: 'Origins', entries: [{ id: 'early', title: 'Early explorations', body: 'No-image story', visibility: 'public' }] }] };
  published.work = [{ id: 'journey-case', title: 'Journey evidence', client: 'Synthetic', featured: true, study: { blocks: [{type:'text',body:'Linked case content'}] } }];
  return published;
}

test('Journey L2 preserves About tiles, original media and return position across desktop and mobile', {skip:!baseURL,timeout:90000}, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' });
    page.setDefaultTimeout(12000);
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    const published = await journeyFixture(page);
    published.work[0].image=published.journey.chapters[0].entries[0].images[2].src;
    const original = structuredClone(published);
    const { rkNewSek, rkEncWithSek, rkWrapSek } = await import('./src/js/admin-core.js');
    const key = rkNewSek(), recovery = 'synthetic journey owner proof';
    published.work[0].study.slidesEnc = { ...await rkEncWithSek(key, []), wraps:{owner:await rkWrapSek(recovery,key)} };
    await page.goto(baseURL+'/?view=about');
    await page.waitForFunction(()=>!!window.RK?.renderJourney && !!window.RK?.openLbx);
    assert.equal(await page.locator('[data-jstory]').count(),5);
    assert.equal(await page.locator('[data-journey-open],.jrn[role="dialog"]').count(),0);
    await page.evaluate(()=>{sessionStorage.setItem('rk:present:active','1');RK.openJourney({preview:true,silent:true});});
    assert.equal(await page.getByRole('button',{name:'Presentation-only story',exact:true}).count(),0);
    for (const width of [1440,800,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.emulateMedia({reducedMotion:width===800?'no-preference':'reduce'});
      const first=page.getByRole('button',{name:'Edge onboarding',exact:true,includeHidden:true});
      await first.scrollIntoViewIfNeeded();
      await first.hover();
      const ctaProperties=['paddingTop','paddingRight','borderTopWidth','borderRadius','cornerShape','color','fontFamily','fontSize','gap'];
      const hoverStyle=await page.locator('[data-jpeek-work]').evaluate((element,properties)=>Object.fromEntries(properties.map(property=>[property,getComputedStyle(element)[property]])),ctaProperties);
      const returnY=await page.evaluate(()=>scrollY);
      await first.click();
      assert.equal(await first.getAttribute('aria-expanded'),'true');
      assert.equal(await page.locator('#journey-detail').count(),1);
      assert.equal(await page.locator('#journey-detail').getAttribute('role'),'dialog');
      assert.equal(await page.locator('#journey-detail').getAttribute('aria-modal'),'true');
      assert.equal(await page.locator('#timeline #journey-detail').count(),0);
      assert.equal(await page.locator('.jrn-timeline [data-jchapter]').count(),5);
      assert.equal(await page.locator('#journey-detail h4').evaluate(element=>element===document.activeElement),true);
      assert.equal(await page.locator('.jrn-timeline__item').evaluateAll(elements=>elements.every(element=>getComputedStyle(element,'::before').content==='none')),true);
      const viewerCta=page.locator('[data-jwork]');
      assert.deepEqual(await viewerCta.evaluate((element,properties)=>Object.fromEntries(properties.map(property=>[property,getComputedStyle(element)[property]])),ctaProperties),hoverStyle);
      const caseCover=viewerCta.locator('img');
      await caseCover.evaluate(image=>image.decode());
      assert.equal(await caseCover.getAttribute('src'),original.work[0].image);
      assert.deepEqual(await caseCover.evaluate(image=>({width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,radius:getComputedStyle(image).borderRadius,fit:getComputedStyle(image).objectFit})),{width:28,height:28,radius:'7px',fit:'cover'});
      assert.equal(await viewerCta.evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.left>=16 && bounds.right<=innerWidth-16 && [...element.children].every(child=>{const rect=child.getBoundingClientRect();return rect.left>=bounds.left && rect.right<=bounds.right;});}),true);
      assert.equal(await page.getByRole('button',{name:'Previous story',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Media 3',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Next story',exact:true}).isEnabled(),true);
      await page.getByRole('button',{name:'Next story',exact:true}).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#journey-detail h4').textContent(),'second chapter');
      assert.equal(await page.locator('.jrn-gallery__stage img').getAttribute('src'),original.journey.chapters[0].entries[1].images[0].src);
      assert.equal(await page.locator('[data-jstep="1"]').evaluate(element=>element===document.activeElement),true);
      await page.getByRole('button',{name:'Previous story',exact:true}).click();
      assert.equal(await page.locator('#journey-detail h4').textContent(),'Edge onboarding');
      assert.equal(await page.locator('.jrn-gallery__caption').textContent(),'Original image 3');
      assert.equal(await page.locator('.jrn-gallery__bar span').textContent(),'3 / 3');
      await page.getByRole('button',{name:'Media 1',exact:true}).click();
      assert.equal(await page.locator('.jrn__prose strong').textContent(),'Original story');
      await page.locator('.jrn-gallery__stage img').evaluate(image=>image.decode());
      assert.equal(await page.locator('.jrn-gallery__stage img').getAttribute('src'),original.journey.chapters[0].entries[0].images[0].src);
      await page.getByRole('button',{name:'Next image',exact:true}).click();
      assert.equal(await page.locator('.jrn-gallery__caption').textContent(),'Original image 2');
      await page.getByRole('button',{name:'Enlarge image',exact:true}).click();
      await page.locator('.pjx.is-open').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.pjx.is-open').waitFor({state:'hidden'});
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pjx')).opacity==='0');
      assert.equal(await page.locator('#journey-detail').count(),1);
      if (width===1440) {
        await page.getByRole('button',{name:'View case study',exact:false}).click();
        await page.locator('.pj.is-open').waitFor();
        await page.locator('.pj.is-open [data-pj="close"]').click();
        await page.locator('.pj.is-open').waitFor({state:'hidden'});
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pj')).visibility==='hidden');
        assert.equal(new URL(page.url()).pathname,'/about');
        assert.equal(await page.locator('#top').evaluate(element=>element.inert),true);
        assert.equal(await first.getAttribute('aria-expanded'),'true');
        assert.equal(await page.locator('.jrn-gallery__caption').textContent(),'Original image 2');
        await page.getByRole('button',{name:'View case study',exact:false}).click();
        await page.locator('.pj.is-open').waitFor();
        await page.goBack();
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pj')).visibility==='hidden');
        assert.equal(new URL(page.url()).pathname,'/about');
        assert.equal(await page.locator('#journey-detail').isVisible(),true);
        assert.equal(await page.locator('.jrn-gallery__caption').textContent(),'Original image 2');
      }
      await page.locator('.jrn__scroll').evaluate(element=>element.scrollTop=0);
      const layout = await page.locator('#journey-detail').evaluate(panel=>({overflow:document.documentElement.scrollWidth>innerWidth,rect:panel.getBoundingClientRect().toJSON(),media:panel.querySelector('.jrn-gallery__stage').getBoundingClientRect().toJSON(),timeline:panel.querySelector('.jrn-timeline').getBoundingClientRect().toJSON(),details:panel.querySelector('.jrn-detail__body').getBoundingClientRect().toJSON(),inert:document.querySelector('main').inert}));
      assert.equal(layout.overflow,false); assert.ok(layout.media.width>100); assert.ok(layout.media.height>=200);
      assert.equal(layout.rect.width,width); assert.equal(layout.rect.height,1000); assert.equal(layout.inert,true);
      assert.ok(layout.timeline.bottom<=layout.media.top); assert.ok(layout.details.top>=layout.media.bottom);
      const regions=await page.locator('#journey-detail').evaluate(panel=>{
        const gallery=panel.querySelector('.jrn-gallery').getBoundingClientRect();
        const footer=panel.querySelector('.jrn__scroll').getBoundingClientRect();
        const top=panel.querySelector('.jrn__top').getBoundingClientRect();
        const image=panel.querySelector('.jrn-gallery__stage img');
        return {top:top.toJSON(),gallery:gallery.toJSON(),footer:footer.toJSON(),bar:panel.querySelector('.jrn-gallery__bar').getBoundingClientRect().toJSON(),position:getComputedStyle(image).objectPosition,cursors:[getComputedStyle(panel).cursor,getComputedStyle(panel.querySelector('.jrn__scroll')).cursor,getComputedStyle(document.elementFromPoint(4,(gallery.top+gallery.bottom)/2)).cursor],zoom:getComputedStyle(image.closest('button')).cursor};
      });
      assert.equal(regions.top.top,0);
      assert.equal(regions.gallery.top,regions.top.bottom);
      assert.equal(regions.gallery.bottom,regions.footer.top);
      assert.equal(regions.footer.bottom,1000);
      assert.ok(regions.bar.top>=regions.footer.top && regions.bar.bottom<regions.footer.bottom);
      assert.equal(regions.position,'50% 50%');
      assert.ok(regions.cursors.every(cursor=>cursor==='auto'),JSON.stringify({width,regions}));
      assert.equal(regions.zoom,'zoom-in');
      assert.equal(await page.locator('.jrn-gallery__stage').evaluate(stage=>{const image=stage.querySelector('img'),imageBox=image.getBoundingClientRect(),stageBox=stage.getBoundingClientRect();return imageBox.height<=stageBox.height+1 && imageBox.width<=stageBox.width+1 && getComputedStyle(image).objectFit==='contain';}),true);
      await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),width===390?'day':'night');
      await page.screenshot({path:join(tmpdir(),'rk-journey-l2-'+width+'.png')});
      await page.getByRole('button',{name:'Close chapter',exact:true}).click();
      assert.equal(await first.evaluate(element=>document.activeElement===element),true);
      assert.ok(Math.abs(await page.evaluate(()=>scrollY)-returnY)<2);
      assert.equal(await page.locator('#top').evaluate(element=>element.inert),false);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#journey-detail').count(),0);
    }
    await page.evaluate(()=>{
      const data=structuredClone(RK.data);
      data.journey.chapters[0].entries[0].body='<p>'+('Long original story description. '.repeat(160))+'</p>';
      RK.renderJourney(data);
    });
    for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390},{width:320,height:568}]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button',{name:'Edge onboarding',exact:true}).click();
      const gallery=await page.locator('.jrn-gallery').boundingBox();
      const footer=await page.locator('.jrn__scroll').evaluate(element=>({rect:element.getBoundingClientRect().toJSON(),scrollHeight:element.scrollHeight,clientHeight:element.clientHeight}));
      assert.ok(gallery.height>40 && gallery.width>100);
      assert.equal(footer.rect.bottom,viewport.height);
      assert.ok(footer.rect.height<=viewport.height*.42+1);
      assert.ok(footer.scrollHeight>footer.clientHeight);
      await page.locator('.jrn__scroll').evaluate(element=>element.scrollTop=element.scrollHeight);
      assert.deepEqual(await page.locator('.jrn-gallery').boundingBox(),gallery);
      assert.equal(await page.locator('#journey-detail').evaluate(panel=>panel.scrollHeight===panel.clientHeight),true);
      await page.screenshot({path:join(tmpdir(),'rk-journey-l2-long-'+viewport.width+'x'+viewport.height+'.png')});
      await page.getByRole('button',{name:'Close chapter',exact:true}).click();
    }
    await page.evaluate(()=>RK.renderJourney(RK.data));
    await page.getByRole('button',{name:'fourth chapter',exact:true}).click();
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Open story: second chapter',exact:true}).click();
    assert.equal(await page.locator('#journey-detail').count(),1);
    await page.locator('.jrn-gallery__stage img').evaluate(image=>image.dispatchEvent(new Event('error')));
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.locator('.jrn-gallery__stage img').evaluate(image=>image.decode());
    assert.equal(await page.locator('.jrn-gallery__stage img').getAttribute('src'),original.journey.chapters[0].entries[1].images[0].src);
    await page.locator('.jrn-timeline [aria-current]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.jrn-timeline [aria-current]').getAttribute('aria-label'),'Open story: third chapter');
    await page.keyboard.press('End');
    assert.equal(await page.locator('.jrn-gallery').isVisible(),false);
    assert.equal(await page.locator('.jrn__prose').textContent(),'No-image story');
    assert.equal(await page.getByRole('button',{name:'Next story',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Previous story',exact:true}).click();
    assert.equal(await page.locator('#journey-detail h4').textContent(),'fourth chapter');
    await page.getByRole('button',{name:'Next story',exact:true}).click();
    assert.equal(await page.locator('#journey-detail h4').textContent(),'Early explorations');
    await page.getByRole('button',{name:'Close chapter',exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button',{name:'Previous story',exact:true}).evaluate(element=>element===document.activeElement),true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.jrn-timeline button').first().evaluate(element=>element===document.activeElement),true);
    await page.keyboard.press('Escape');
    assert.equal((await page.evaluate(value=>RK.presentAll(value),'wrong synthetic phrase')).ok,false);
    assert.equal((await page.evaluate(value=>RK.presentAll(value),recovery)).ok,true);
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      const banner=page.locator('.present-banner');
      await page.waitForFunction(()=>{const surface=document.querySelector('.sv-surface').getBoundingClientRect();return document.querySelector('.dock').getBoundingClientRect().bottom<=surface.top-12 && parseFloat(document.body.style.getPropertyValue('--sv-surface-height'))===surface.height;});
      assert.equal(await banner.locator('.sv-banner__txt').textContent(),'Present mode on - every case study is unlocked. Click any project to present.');
      assert.equal(await banner.evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.left>=16 && bounds.right<=innerWidth-16 && Array.from(element.children).every(child=>{const rect=child.getBoundingClientRect();return rect.left>=bounds.left && rect.right<=bounds.right && rect.top>=bounds.top && rect.bottom<=bounds.bottom;});}),true);
      assert.equal(await page.locator('.rk-flash.is-on').count(),0);
      await banner.screenshot({path:join(tmpdir(),'rk-mobile-present-banner-'+width+'.png')});
      await page.screenshot({path:join(tmpdir(),'rk-mobile-present-surface-'+width+'.png')});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Presentation-only story',exact:true}).click();
    assert.equal(await page.locator('.jrn__prose').textContent(),'Presenter detail retained');
    assert.deepEqual(await page.evaluate(()=>({path:RK.data.path,journey:RK.data.journey})),{path:original.path,journey:original.journey});
    await page.getByRole('button',{name:'Close chapter',exact:true}).click();
    await page.locator('.present-banner .sv-banner__exit').click();
    await page.waitForFunction(()=>!!window.RK?.renderJourney && typeof window.RK.isOwnerPresentation==='function' && !window.RK.isOwnerPresentation());
    assert.equal(await page.locator('.sv-surface').count(),0);
    assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--sv-surface-height')),'');
    assert.equal(await page.getByRole('button',{name:'Presentation-only story',exact:true}).count(),0);
    assert.equal(await page.locator('#journey-detail').count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Journey thumbnails expand into solo cards or bounded story strips without layout shifts', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    const published=await journeyFixture(page);
    published.journey.chapters[1].entries[0].images=[published.journey.chapters[0].entries[0].images[0]];
    const original=structuredClone(published);
    await page.goto(baseURL+'/?view=about');
    await page.waitForFunction(()=>!!window.RK?.renderJourney);
    const first=page.getByRole('button',{name:'Edge onboarding',exact:true});
    const firstTile=page.locator('.jrn-tile').filter({has:first});
    const row=page.locator('.jrn-stories').first();
    const geometry=()=>page.locator('#timeline > .tl').evaluateAll(roles=>roles.map(role=>{const rect=role.getBoundingClientRect();return {top:rect.top+scrollY,height:rect.height};}));
    for(const width of [1440,800,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.emulateMedia({reducedMotion:width===800?'no-preference':'reduce'});
      await page.mouse.move(0,0);
      await first.scrollIntoViewIfNeeded();
      const resting=await first.boundingBox();
      assert.ok(resting.width<=112 && resting.height<=84,JSON.stringify(resting));
      assert.equal(await firstTile.locator('.jrn-tile__preview').evaluate(element=>getComputedStyle(element).borderRadius),'20px');
      assert.equal(await first.locator('.jrn-tile__image').evaluate(element=>getComputedStyle(element).borderRadius),'20px');
      assert.equal(await first.locator('.jrn-tile__image').evaluate(element=>{if(!CSS.supports('corner-shape','squircle'))return true;const reference=document.createElement('div');reference.style.cornerShape='squircle';document.body.append(reference);const expected=getComputedStyle(reference).cornerShape;reference.remove();return getComputedStyle(element).cornerShape===expected;}),true);
      assert.equal(await first.locator('.jrn-tile__details').isVisible(),false);
      assert.equal(await first.locator('img').getAttribute('src'),original.journey.chapters[0].entries[0].images[0].src);
      const baseline=await geometry();
      await page.screenshot({path:join(tmpdir(),'rk-journey-compact-'+width+'.png')});
      for(const tile of [firstTile,row.locator('.jrn-tile').last()]) {
        await tile.hover();
        await page.waitForFunction(()=>{const preview=document.querySelector('.is-peeking .jrn-stories__preview');return preview && preview.getAnimations().every(animation=>animation.playState==='finished');});
        const peek=row.locator('.jrn-stories__preview');
        const bounds=await peek.boundingBox();
        const host=await row.boundingBox();
        const columns=width>1000?3:width>600?2:1;
        const cardWidth=(host.width-(columns-1)*20)/columns;
        assert.ok(Math.abs((await tile.boundingBox()).width-cardWidth)<1);
        assert.ok(Math.abs(bounds.width-host.width)<1);
        assert.ok(bounds.width>resting.width && bounds.x>=15);
        assert.ok(bounds.x+bounds.width<=width-15 && bounds.y>=15 && bounds.y+bounds.height<=985,JSON.stringify({bounds,layout:await row.evaluate(element=>({style:element.getAttribute('style'),top:element.getBoundingClientRect().top,scrollHeight:element.querySelector('.jrn-stories__preview').scrollHeight,trackHeight:element.querySelector('.jrn-stories__track').getBoundingClientRect().height}))}));
        assert.equal(await tile.locator('.jrn-tile__title').isVisible(),true);
        assert.equal(await tile.locator('img').evaluate(image=>{const box=image.getBoundingClientRect(),host=image.parentElement.getBoundingClientRect();return getComputedStyle(image).objectFit==='contain' && box.width<=host.width+1 && box.height<=host.height+1;}),true);
        assert.deepEqual(await geometry(),baseline);
        await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height-10);
        assert.equal(await row.evaluate(element=>element.classList.contains('is-peeking')),true);
        assert.equal(await row.locator('.jrn-tile__details').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).display==='grid')),true);
        assert.equal(await row.locator('.jrn-tile').nth(1).evaluate(element=>getComputedStyle(element).borderLeftWidth),'1px');
        assert.equal(await tile.locator('.jrn-tile__preview').evaluate(element=>getComputedStyle(element).borderRadius),'0px');
        assert.equal(await tile.locator('.jrn-tile__image').evaluate(element=>getComputedStyle(element).borderRadius),'8px');
        assert.equal(await tile.locator('.jrn-tile__image').evaluate(element=>{if(!CSS.supports('corner-shape','squircle'))return true;return getComputedStyle(element).cornerShape===getComputedStyle(element.closest('.jrn-stories__preview')).cornerShape;}),true);
        await page.screenshot({path:join(tmpdir(),'rk-journey-hover-'+width+'.png')});
        await page.keyboard.press('Escape');
        assert.equal(await tile.locator('.jrn-tile__details').isVisible(),false);
        await page.mouse.move(0,0);
      }
      await first.hover();
      const track=row.locator('.jrn-stories__track');
      assert.equal(await row.getByRole('button',{name:'Previous stories',includeHidden:true}).isDisabled(),true);
      await row.getByRole('button',{name:'Next stories',exact:true}).click();
      await page.waitForFunction(()=>{const track=document.querySelector('.is-peeking .jrn-stories__track');return track && Math.abs(track.scrollLeft-Math.min(track.firstElementChild.getBoundingClientRect().width,track.scrollWidth-track.clientWidth))<2;});
      await row.getByRole('button',{name:'Previous stories',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.is-peeking .jrn-stories__track').scrollLeft<1);
      await first.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(()=>document.querySelector('.is-peeking .jrn-stories__track').scrollLeft>20);
      await track.evaluate(element=>element.scrollLeft=element.scrollWidth);
      await page.waitForFunction(()=>document.querySelector('.is-peeking [data-jpeek-step="1"]').disabled);
      await page.keyboard.press('Escape');
      assert.equal(await first.evaluate(element=>element===document.activeElement),true);
      await page.evaluate(()=>document.activeElement.blur());
      await page.mouse.move(0,0);
      await page.keyboard.press('Tab');
      await first.focus();
      assert.equal(await first.locator('.jrn-tile__details').isVisible(),true);
      await page.keyboard.press('Escape');
      assert.equal(await first.locator('.jrn-tile__details').isVisible(),false);
      await page.keyboard.press('Enter');
      await page.locator('#journey-detail').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await first.evaluate(element=>document.activeElement===element),true);
      await page.keyboard.press('Escape');
      await page.evaluate(()=>document.activeElement?.blur());
      assert.deepEqual(await geometry(),baseline);
      const solo=page.getByRole('button',{name:'Early explorations',exact:true});
      await solo.scrollIntoViewIfNeeded();
      await solo.hover();
      const soloRow=page.locator('.jrn-stories').filter({has:solo});
      await page.waitForFunction(()=>{const preview=document.querySelector('.is-peeking .jrn-stories__preview');return preview && preview.getAnimations().every(animation=>animation.playState==='finished');});
      assert.equal(await soloRow.locator('[data-jpeek-step]').count(),0);
      const soloBounds=await soloRow.locator('.jrn-stories__preview').boundingBox();
      assert.ok(Math.abs(soloBounds.width-(await solo.boundingBox()).width)<1);
      assert.ok(soloBounds.x>=15 && soloBounds.x+soloBounds.width<=width-15);
      assert.equal(await soloRow.locator('[data-jpeek-work]').count(),0);
      assert.equal(await solo.locator('img').getAttribute('src'),original.journey.chapters[1].entries[0].images[0].src);
      await page.screenshot({path:join(tmpdir(),'rk-journey-solo-'+width+'.png')});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.jrn-stories__preview:popover-open').count(),0);
      await page.evaluate(()=>document.activeElement.blur());
      await page.mouse.move(0,0);
      await solo.hover();
      await page.mouse.move(0,0);
      assert.equal(await page.locator('.is-peeking').count(),0);
      assert.deepEqual(await geometry(),baseline);
    }
    const touch=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    await journeyFixture(touch);
    await touch.goto(baseURL+'/?view=about');
    await touch.waitForFunction(()=>!!window.RK?.renderJourney);
    const touchTile=touch.getByRole('button',{name:'Edge onboarding',exact:true});
    await touchTile.tap();
    await touch.locator('#journey-detail').waitFor();
    assert.equal(await touch.locator('.is-peeking').count(),0);
    await touch.getByRole('button',{name:'Close chapter',exact:true}).tap();
    assert.equal(await touch.locator('#journey-detail').count(),0);
    assert.equal(await touch.locator('.is-peeking').count(),0);
    assert.deepEqual(published,original);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Journey unseen case outlines transfer on hover and persist after opening with scroll parallax', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page=await context.newPage();
    const published=await journeyFixture(page);
    published.journey.chapters[0].entries[1].workId='journey-case';
    const original=structuredClone(published);
    await page.goto(baseURL+'/?view=about');
    await page.waitForFunction(()=>!!window.RK?.renderJourney);
    const first=page.getByRole('button',{name:'Edge onboarding',exact:true});
    const tile=page.locator('.jrn-tile').filter({has:first});
    const image=first.locator('.jrn-tile__image');
    const link=tile.locator('[data-jpeek-work]');
    const ring=tile.locator('.jrn-tile__preview');
    assert.equal(await page.locator('.is-case-unseen').count(),2);
    await first.scrollIntoViewIfNeeded();
    assert.match(await ring.evaluate(element=>getComputedStyle(element,'::before').backgroundImage),/conic-gradient/);
    assert.equal(await ring.evaluate(element=>getComputedStyle(element,'::before').animationName),'none');
    await first.hover();
    assert.equal(await image.evaluate(element=>getComputedStyle(element).outlineStyle),'none');
    assert.equal(await ring.evaluate(element=>getComputedStyle(element,'::before').content),'none');
    assert.match(await link.evaluate(element=>getComputedStyle(element,'::before').backgroundImage),/conic-gradient/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:journey:seen-cases:v1')),null);
    await page.keyboard.press('Escape');
    await page.mouse.move(0,0);
    assert.match(await ring.evaluate(element=>getComputedStyle(element,'::before').backgroundImage),/conic-gradient/);
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      await first.scrollIntoViewIfNeeded();
      await page.mouse.move(0,0);
      await page.screenshot({path:join(tmpdir(),'rk-journey-unseen-rest-'+width+'.png')});
      await first.hover();
      const outline=await link.evaluate(element=>{const style=getComputedStyle(element),pseudo=getComputedStyle(element,'::before'),rect=element.getBoundingClientRect();return {width:pseudo.paddingTop,offset:pseudo.top,gradient:pseudo.backgroundImage,border:style.borderRadius,left:rect.left-5,right:rect.right+5};});
      assert.equal(outline.width,'2px');
      assert.equal(outline.offset,'-5px');
      assert.match(outline.gradient,/conic-gradient/);
      assert.equal(outline.border,'8px');
      assert.ok(outline.left>=16 && outline.right<=width-16,JSON.stringify(outline));
      await page.screenshot({path:join(tmpdir(),'rk-journey-unseen-cta-'+width+'.png')});
      await page.keyboard.press('Escape');
      await page.mouse.move(0,0);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.keyboard.press('Tab');
    await first.focus();
    await page.keyboard.press('Tab');
    assert.equal(await link.evaluate(element=>document.activeElement===element),true);
    assert.match(await link.evaluate(element=>getComputedStyle(element,'::before').backgroundImage),/conic-gradient/);
    await page.evaluate(()=>{window.__journeyOpen=RK.openProject;RK.openProject=()=>{};});
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:journey:seen-cases:v1')),null);
    assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),2);
    await page.evaluate(()=>{RK.openProject=window.__journeyOpen;delete window.__journeyOpen;});
    await page.mouse.move(0,0);
    await page.evaluate(()=>{window.__nativeRingRandom=Math.random;const values=[.5,.2,.3,.5,.9,.7,.1,.4];let index=0;Math.random=()=>values[index++%values.length];});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await first.scrollIntoViewIfNeeded();
    await page.evaluate(()=>{document.activeElement.blur();window.scrollTo({top:document.querySelector('.jrn-tile').getBoundingClientRect().top+scrollY-400,behavior:'instant'});});
    await page.waitForFunction(()=>!!document.querySelector('.jrn-tile.is-case-unseen').style.getPropertyValue('--jrn-ring-angle'));
    await page.waitForFunction(()=>{
      const tile=document.querySelector('.jrn-tile.is-case-unseen');
      if(tile.closest('.is-peeking'))return false;
      const anchor=tile.getBoundingClientRect();
      const drift=Math.max(-16,Math.min(16,(anchor.top+anchor.height/2-innerHeight/2)/innerHeight*48));
      return tile.style.getPropertyValue('--jrn-par-y')===drift.toFixed(1)+'px';
    });
    const ringStyle=await ring.evaluate(element=>{const style=getComputedStyle(element,'::before');return {animation:style.animationName,mask:style.maskComposite,angle:parseFloat(style.getPropertyValue('--jrn-ring-angle'))};});
    assert.equal(ringStyle.animation,'none');
    assert.ok(ringStyle.mask.split(',').every(value=>value.trim()==='exclude'));
    const rect=await ring.boundingBox();
    const clip={x:rect.x-6,y:rect.y-6,width:rect.width+12,height:rect.height+12};
    const beforeMotion=await page.screenshot({clip});
    await page.waitForFunction(angle=>{const element=document.querySelector('.jrn-tile.is-case-unseen .jrn-tile__preview');const current=parseFloat(getComputedStyle(element,'::before').getPropertyValue('--jrn-ring-angle'));return (current-angle+360)%360>30;},ringStyle.angle);
    const afterMotion=await page.screenshot({clip,path:join(tmpdir(),'rk-journey-gradient-moving.png')});
    assert.notDeepEqual(afterMotion,beforeMotion,'Gradient must visibly move without rotating the card');
    assert.deepEqual(await ring.boundingBox(),rect);
    const speeds=await page.evaluate(()=>new Promise(resolve=>{
      const host=document.querySelector('.jrn-tile.is-case-unseen'),started=performance.now(),values=[];
      let previous=null,angle=null;
      function sample(now){
        const current=parseFloat(host.style.getPropertyValue('--jrn-ring-angle')),delta=now-previous;
        if(previous!==null && delta>0)values.push((current-angle+360)%360/Math.min(50,delta)*1000);
        previous=now;angle=current;
        if(now-started<7400)requestAnimationFrame(sample);else resolve(values);
      }
      requestAnimationFrame(sample);
    }));
    assert.ok(Math.max(...speeds)-Math.min(...speeds)>20,'Rotation must ease between noticeably different speeds');
    assert.ok(speeds.every(speed=>speed>=0 && speed<80),'Rotation stays clockwise and bounded without jumps');
    const independent=await page.evaluate(()=>new Promise(resolve=>{
      const tiles=[...document.querySelectorAll('.jrn-tile.is-case-unseen')];
      const initial=tiles.map(tile=>parseFloat(tile.style.getPropertyValue('--jrn-ring-angle')));
      const started=performance.now();
      function sample(now){
        if(now-started<900){requestAnimationFrame(sample);return;}
        resolve(tiles.map((tile,index)=>({start:initial[index],delta:(parseFloat(tile.style.getPropertyValue('--jrn-ring-angle'))-initial[index]+360)%360})));
      }
      requestAnimationFrame(sample);
    }));
    assert.notEqual(independent[0].start,independent[1].start);
    assert.ok(Math.abs(independent[0].delta-independent[1].delta)>1,'Each ring must have its own changing speed, not only a phase offset');
    await page.evaluate(()=>{Math.random=window.__nativeRingRandom;delete window.__nativeRingRandom;});
    await page.evaluate(()=>window.scrollTo({top:document.querySelector('[data-jstory]').getBoundingClientRect().top+scrollY-400,behavior:'instant'}));
    await page.waitForFunction(()=>{const tile=document.querySelector('.jrn-tile'),rect=tile.getBoundingClientRect();return tile.style.getPropertyValue('--jrn-par-y')===Math.max(-16,Math.min(16,(rect.top+rect.height/2-innerHeight/2)/innerHeight*48)).toFixed(1)+'px';});
    const drift=await tile.evaluate(element=>element.style.getPropertyValue('--jrn-par-y'));
    const parallaxGeometry=()=>tile.evaluate(element=>{
      const anchor=element.getBoundingClientRect(),frame=element.querySelector('.jrn-tile__image').getBoundingClientRect(),image=element.querySelector('.jrn-tile__image img').getBoundingClientRect();
      return {frame:[frame.x-anchor.x,frame.y-anchor.y,frame.width,frame.height],imageY:image.y-frame.y,filled:image.top<=frame.top+1 && image.bottom>=frame.bottom-1 && image.left<=frame.left+1 && image.right>=frame.right-1,previewTransform:getComputedStyle(element.querySelector('.jrn-tile__preview')).transform,overflow:getComputedStyle(element.querySelector('.jrn-tile__image')).overflow};
    });
    const beforeParallax=await parallaxGeometry();
    await page.evaluate(()=>window.scrollBy({top:140,behavior:'instant'}));
    await page.waitForFunction(()=>{const tile=document.querySelector('.jrn-tile'),rect=tile.getBoundingClientRect();return tile.style.getPropertyValue('--jrn-par-y')===Math.max(-16,Math.min(16,(rect.top+rect.height/2-innerHeight/2)/innerHeight*48)).toFixed(1)+'px';});
    assert.ok(Math.abs(parseFloat(await tile.evaluate(element=>element.style.getPropertyValue('--jrn-par-y')))-parseFloat(drift))>5,'A 140px scroll must produce visible thumbnail parallax');
    const afterParallax=await parallaxGeometry();
    assert.deepEqual(afterParallax.frame,beforeParallax.frame,'The frame and its ring must stay anchored to the tile');
    assert.ok(Math.abs(afterParallax.imageY-beforeParallax.imageY)>5,'Only the artwork moves within the frame');
    assert.equal(afterParallax.previewTransform,'none');
    assert.equal(afterParallax.overflow,'hidden');
    assert.equal(afterParallax.filled,true,'The moving media must cover the entire clipped frame');
    await tile.screenshot({path:join(tmpdir(),'rk-journey-inner-parallax.png')});
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.evaluate(()=>window.scrollTo({top:document.querySelector('.jrn-tile').getBoundingClientRect().top+scrollY-400,behavior:'instant'}));
      await page.waitForFunction(()=>{const tile=document.querySelector('.jrn-tile'),rect=tile.getBoundingClientRect();return tile.style.getPropertyValue('--jrn-par-y')===Math.max(-16,Math.min(16,(rect.top+rect.height/2-innerHeight/2)/innerHeight*48)).toFixed(1)+'px';});
      const before=await parallaxGeometry();
      await page.evaluate(()=>window.scrollBy({top:140,behavior:'instant'}));
      await page.waitForFunction(()=>{const tile=document.querySelector('.jrn-tile'),rect=tile.getBoundingClientRect();return tile.style.getPropertyValue('--jrn-par-y')===Math.max(-16,Math.min(16,(rect.top+rect.height/2-innerHeight/2)/innerHeight*48)).toFixed(1)+'px';});
      const after=await parallaxGeometry();
      assert.deepEqual(after.frame,before.frame);assert.equal(after.filled,true);assert.equal(after.previewTransform,'none');
      assert.ok(Math.abs(after.imageY-before.imageY)>5);
      await tile.screenshot({path:join(tmpdir(),'rk-journey-inner-parallax-'+width+'.png')});
    }
    await page.setViewportSize({width:1440,height:1000});
    await first.hover();
    assert.equal(await tile.locator('.jrn-tile__preview').evaluate(element=>getComputedStyle(element).transform),'none');
    assert.equal(await tile.locator('.jrn-tile__image img').evaluate(element=>getComputedStyle(element).transform),'none');
    assert.equal(await link.evaluate(element=>getComputedStyle(element,'::before').getPropertyValue('--jrn-ring-angle')===element.closest('.jrn-tile').style.getPropertyValue('--jrn-ring-angle')),true);
    await page.keyboard.press('Escape');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await tile.locator('.jrn-tile__preview').evaluate(element=>getComputedStyle(element).transform),'none');
    assert.equal(await tile.locator('.jrn-tile__image img').evaluate(element=>getComputedStyle(element).transform),'none');
    assert.equal(await ring.evaluate(element=>getComputedStyle(element,'::before').animationName),'none');
    const frozen=await tile.evaluate(element=>element.style.getPropertyValue('--jrn-ring-angle'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await tile.evaluate(element=>element.style.getPropertyValue('--jrn-ring-angle')),frozen);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.waitForFunction(()=>document.querySelector('#timeline').getBoundingClientRect().top>innerHeight);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const offscreen=await tile.evaluate(element=>element.style.getPropertyValue('--jrn-ring-angle'));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await tile.evaluate(element=>element.style.getPropertyValue('--jrn-ring-angle')),offscreen);
    await page.emulateMedia({reducedMotion:'reduce'});
    await first.click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('rk:journey:seen-cases:v1')),null);
    await page.getByRole('button',{name:'View case study',exact:false}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rk:journey:seen-cases:v1')||'[]').includes('journey-case'));
    assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),0);
    assert.equal(await page.locator('.jrn-tile__preview').first().evaluate(element=>getComputedStyle(element,'::before').content),'none');
    await page.locator('.pj.is-open [data-pj="close"]').click();
    await page.locator('#journey-detail:not([hidden])').waitFor();
    await page.getByRole('button',{name:'Close chapter',exact:true}).click();
    await page.reload();
    await first.waitFor();
    assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),0);
    const second=await page.context().newPage();
    await journeyFixture(second);
    await second.goto(baseURL+'/?view=about');
    await second.waitForFunction(()=>!!window.RK?.renderJourney);
    assert.equal(await second.locator('.jrn-tile.is-case-unseen').count(),0);
    await second.evaluate(()=>localStorage.removeItem('rk:journey:seen-cases:v1'));
    await page.waitForFunction(()=>document.querySelectorAll('.jrn-tile.is-case-unseen').length===2);
    await second.close();
    assert.deepEqual(published,original);
  } finally {await browser.close();}
});

test('Journey unseen indicators tolerate blocked storage without changing original content', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const published=await journeyFixture(page),original=structuredClone(published);
    await page.addInitScript(()=>{
      for(const method of ['getItem','setItem']) {
        const native=Storage.prototype[method];
        Storage.prototype[method]=function(key,...args){if(key==='rk:journey:seen-cases:v1')throw new DOMException('Storage disabled','SecurityError');return native.call(this,key,...args);};
      }
    });
    await page.goto(baseURL+'/?view=about');
    const first=page.getByRole('button',{name:'Edge onboarding',exact:true});
    await first.waitFor();
    assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),1);
    await first.tap();
    assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),1);
    await page.getByRole('button',{name:'View case study',exact:false}).tap();
    await page.waitForFunction(()=>document.querySelectorAll('.jrn-tile.is-case-unseen').length===0);
    assert.deepEqual(published,original);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Journey expanded thumbnail links open available cases directly and return to About', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    const published=await journeyFixture(page);
    published.work[0].image=published.journey.chapters[0].entries[0].images[2].src;
    const original=structuredClone(published);
    await page.goto(baseURL+'/?view=about');
    await page.waitForFunction(()=>!!window.RK?.renderJourney);
    const first=page.getByRole('button',{name:'Edge onboarding',exact:true});
    const tile=page.locator('.jrn-tile').filter({has:first});
    const link=tile.getByRole('link',{name:'Case study available',exact:false});
    assert.equal(await page.locator('.jrn-tile button a,.jrn-tile a button').count(),0);
    assert.equal(await page.locator('[data-jpeek-work]').count(),1);
    assert.equal(await link.isVisible(),false);
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      await first.scrollIntoViewIfNeeded();
      await first.hover();
      await link.waitFor({state:'visible'});
      const bounds=await link.boundingBox();
      assert.ok(bounds.x>=16 && bounds.x+bounds.width<=width-16);
      assert.equal(await link.getAttribute('href'),'/work/journey-case');
      const craft=await tile.evaluate(element=>{
        const preview=element.querySelector('.jrn-tile__preview'), image=element.querySelector('.jrn-tile__image'), details=element.querySelector('.jrn-tile__details'), link=element.querySelector('.jrn-tile__case');
        return {imageBorder:getComputedStyle(image).borderTopWidth,detailsInset:getComputedStyle(details).paddingLeft,linkInset:getComputedStyle(link).paddingLeft,linkDivider:getComputedStyle(link).borderTopWidth,linkWidth:link.getBoundingClientRect().width,previewWidth:preview.getBoundingClientRect().width};
      });
      assert.equal(craft.imageBorder,'0px');
      assert.equal(craft.detailsInset,'16px');
      assert.equal(craft.linkInset,'12px');
      assert.equal(craft.linkDivider,'1px');
      assert.ok(craft.linkWidth<=craft.previewWidth-31);
      const cover=link.locator('.jrn-tile__case-image');
      assert.equal(await cover.getAttribute('src'),original.work[0].image);
      assert.equal(await cover.getAttribute('alt'),'');
      await cover.evaluate(image=>image.decode());
      const thumbnail=await cover.boundingBox();
      assert.equal(thumbnail.width,28);
      assert.equal(thumbnail.height,28);
      assert.equal(await cover.evaluate(image=>getComputedStyle(image).borderRadius),'7px');
      assert.equal(await cover.evaluate(image=>{if(!CSS.supports('corner-shape','squircle'))return true;const reference=document.createElement('div');reference.style.cornerShape='squircle';document.body.append(reference);const expected=getComputedStyle(reference).cornerShape;reference.remove();return getComputedStyle(image).cornerShape===expected;}),true);
      assert.equal(await cover.evaluate(image=>getComputedStyle(image).objectFit),'cover');
      assert.equal(await link.evaluate(element=>getComputedStyle(element).borderRadius),'8px');
      assert.equal(await link.evaluate(element=>{if(!CSS.supports('corner-shape','squircle'))return true;return getComputedStyle(element).cornerShape===getComputedStyle(element.querySelector('img')).cornerShape;}),true);
      const thumbnailPixels=await page.evaluate(async data=>{
        const image=new Image(); image.src=data; await image.decode();
        const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
        const context=canvas.getContext('2d'); context.drawImage(image,0,0);
        return [2,image.height-3].map(top=>[...context.getImageData(Math.floor(image.width/2),top,1,1).data]);
      },'data:image/png;base64,'+(await cover.screenshot()).toString('base64'));
      assert.deepEqual(thumbnailPixels,[[199,80,97,255],[199,80,97,255]],'Cover artwork must reach both square edges without letterboxing');
      assert.equal(await link.evaluate(element=>{const bounds=element.getBoundingClientRect();return [...element.children].every(child=>{const rect=child.getBoundingClientRect();return rect.x>=bounds.x && rect.right<=bounds.right && rect.y>=bounds.y && rect.bottom<=bounds.bottom;});}),true);
      await page.screenshot({path:join(tmpdir(),'rk-journey-case-link-'+width+'.png')});
      const returnY=await page.evaluate(()=>scrollY);
      await link.click();
      await page.locator('.pj.is-open').waitFor();
      assert.equal(await page.locator('#journey-detail').count(),0);
      await page.getByText('Linked case content',{exact:true}).waitFor();
      await page.locator('.pj.is-open [data-pj="close"]').click();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pj')).opacity==='0');
      assert.equal(new URL(page.url()).pathname,'/about');
      assert.equal(await first.evaluate(element=>document.activeElement===element),true);
      await page.waitForFunction(expected=>Math.abs(scrollY-expected)<2,returnY);
      const returnedY=await page.evaluate(()=>scrollY);
      assert.ok(Math.abs(returnedY-returnY)<2,JSON.stringify({width,returnY,returnedY}));
    }
    await page.keyboard.press('Tab');
    await first.focus();
    await page.keyboard.press('Tab');
    assert.equal(await link.evaluate(element=>element===document.activeElement),true);
    await page.mouse.move(0,0);
    assert.equal(await link.isVisible(),true);
    await page.keyboard.press('Enter');
    await page.locator('.pj.is-open').waitFor();
    await page.goBack();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pj')).opacity==='0');
    assert.equal(new URL(page.url()).pathname,'/about');
    assert.equal(await first.evaluate(element=>document.activeElement===element),true);
    for(const image of ['', 'javascript:window.journeyUnsafeCover=true']) {
      await page.evaluate(image=>{const copy=structuredClone(RK.data);copy.work[0].image=image;RK.renderJourney(copy);},image);
      assert.equal(await page.locator('[data-jpeek-work]').count(),1);
      assert.equal(await page.locator('.jrn-tile__case-image').count(),0);
      await first.click();
      assert.equal(await page.locator('[data-jwork]').isVisible(),true);
      assert.equal(await page.locator('[data-jwork] img').count(),0);
      await page.getByRole('button',{name:'Close chapter',exact:true}).click();
    }
    await page.route('**/journey-missing-cover.png',route=>route.fulfill({status:404,body:''}));
    await page.evaluate(()=>{const copy=structuredClone(RK.data);copy.work[0].image='/journey-missing-cover.png';RK.renderJourney(copy);});
    await first.hover();
    await page.waitForFunction(()=>!document.querySelector('.jrn-tile__case-image'));
    assert.equal(await link.isVisible(),true);
    assert.equal(await link.getAttribute('href'),'/work/journey-case');
    assert.equal(await page.evaluate(()=>!!window.journeyUnsafeCover),false);
    await page.evaluate(()=>{localStorage.removeItem('rk:journey:seen-cases:v1');window.dispatchEvent(new StorageEvent('storage',{key:'rk:journey:seen-cases:v1'}));});
    assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),1);
    for(const patch of [{hidden:true},{encWork:'synthetic'},{id:'unmatched'}]) {
      await page.evaluate(patch=>{const copy=structuredClone(RK.data);Object.assign(copy.work[0],patch);RK.renderJourney(copy);},patch);
      assert.equal(await page.locator('[data-jpeek-work]').count(),0);
      assert.equal(await page.locator('.jrn-tile.is-case-unseen').count(),0);
      await first.click();
      assert.equal(await page.locator('[data-jwork]').count(),0);
      await page.getByRole('button',{name:'Close chapter',exact:true}).click();
    }
    await page.evaluate(()=>RK.renderJourney(RK.data));
    assert.equal(await page.locator('[data-jpeek-work]').count(),1);
    assert.deepEqual(published,original);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('About editor rows reuse case-study styling and autosave without Done', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await journeyFixture(page);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const before=await page.evaluate(()=>window.__RKStudio.getDraft());
    const appearance=element=>{
      const style=getComputedStyle(element),head=getComputedStyle(element.querySelector('.study__block-head')),chevron=getComputedStyle(element.querySelector('.study__block-chev'));
      return {background:style.backgroundColor,border:style.borderColor,radius:style.borderRadius,corner:style.cornerShape,shadow:style.boxShadow,minHeight:head.minHeight,padding:head.padding,chevronBorder:chevron.borderColor};
    };
    const tabs=page.getByRole('tablist',{name:'About editor',exact:true});
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.locator('.adm__tab[data-tab="work"]').click();
      await page.locator('[data-act="study-toggle"][data-index="0"]').click();
      await page.locator('[data-l2tab="story"]').click();
      await page.mouse.move(0,0);
      const reference=page.locator('.study-sections .study__block').first();
      const native=await reference.evaluate(appearance);
      assert.equal(await reference.evaluate(element=>{if(!CSS.supports('corner-shape','squircle'))return true;const probe=document.createElement('div');probe.style.cornerShape='squircle';document.body.append(probe);const expected=getComputedStyle(probe).cornerShape;probe.remove();return getComputedStyle(element).cornerShape===expected;}),true);
      await reference.screenshot({path:join(tmpdir(),'rk-native-row-'+width+'.png')});
      await page.locator('[data-l2-back]').click();
      await page.locator('.adm__tab[data-tab="aboutpage"]').click();
      for(const name of ['About','Journey','Stories','Photos','More']) {
        await tabs.getByRole('tab',{name,exact:true}).click();
        assert.equal(await page.locator('[data-act="journey-close"]').count(),0);
        assert.equal(await page.getByRole('button',{name:'Back to Studio',exact:true}).isVisible(),true);
        if(!['About','Journey','Stories'].includes(name)) continue;
        const panel=page.getByRole('tabpanel',{name,exact:true});
        const row=panel.locator('.study__block').first();
        assert.deepEqual(await row.evaluate(appearance),native,name+' '+width);
        await row.scrollIntoViewIfNeeded();
        assert.equal(await row.locator('.study__block-head').first().evaluate(head=>Array.from(head.children).every(child=>{const bounds=child.getBoundingClientRect();return bounds.width>0 && bounds.left>=0 && bounds.right<=innerWidth;})),true,name+' controls '+width);
        const grip=row.locator('[data-grip]').first(),bounds=await grip.boundingBox();
        const expectedLabel=await row.locator('.adm__lsec-title,.jedit__select strong,[data-jname]').first().evaluate(element=>element.value||element.textContent);
        await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
        const held=page.locator('.adm__sort-preview');
        assert.equal(await held.textContent(),expectedLabel,name+' held label '+width);
        const heldBounds=await held.boundingBox();
        assert.ok(heldBounds.width>0 && heldBounds.x>=8 && heldBounds.x+heldBounds.width<=width-8);
        assert.equal(await held.evaluate(element=>getComputedStyle(element).fontFamily),await row.evaluate(element=>getComputedStyle(element).fontFamily));
        if(name==='About')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
        else if(name==='Stories')await grip.dispatchEvent('pointercancel',{pointerId:1});
        else await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.equal(await held.count(),0);
        assert.equal(await page.locator('.is-sortdrag,.is-drop-above,.is-drop-below').count(),0);
        assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),before);
        await page.screenshot({path:join(tmpdir(),'rk-editor-rows-'+name.toLowerCase()+'-'+width+'.png')});
      }
      await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
      await page.locator('button[data-act="journey-chaptoggle"][data-jc="0"]').click();
      const nested=page.locator('.jentry').first();
      assert.deepEqual(await nested.evaluate(appearance),native,'closed story in open chapter '+width);
      assert.equal(await nested.locator('.study__block-chev').evaluate(element=>getComputedStyle(element).transform),'none');
      assert.equal(await page.locator('.jchap').first().evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)');
      await page.locator('button[data-act="journey-chaptoggle"][data-jc="0"]').click();
      await page.getByRole('button',{name:'Back to Studio',exact:true}).click();
    }
    await page.locator('.adm__tab[data-tab="aboutpage"]').click();
    await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
    await page.locator('button[data-act="journey-chaptoggle"][data-jc="0"]').click();
    await page.locator('button[data-act="jstory-toggle"][data-jc="0"][data-je="0"]').first().click();
    const mediaRow=page.locator('.jimg').first();
    await mediaRow.locator('img').evaluate(image=>image.decode());
    await mediaRow.locator('[data-grip]').scrollIntoViewIfNeeded();
    const mediaSource=await mediaRow.locator('img').getAttribute('src'),mediaGrip=await mediaRow.locator('[data-grip]').boundingBox();
    await page.mouse.move(mediaGrip.x+mediaGrip.width/2,mediaGrip.y+mediaGrip.height/2);await page.mouse.down();
    const mediaHeld=page.locator('.adm__sort-preview');
    assert.equal(await mediaHeld.locator('img').getAttribute('src'),mediaSource);
    assert.equal(await mediaHeld.locator('img').evaluate(image=>getComputedStyle(image).objectFit),'contain');
    assert.doesNotMatch(await mediaHeld.textContent(),/data:image|https?:/);
    await page.mouse.move(318,998);
    const mediaBounds=await mediaHeld.boundingBox();
    assert.ok(mediaBounds.x>=8 && mediaBounds.x+mediaBounds.width<=312 && mediaBounds.y+mediaBounds.height<=992);
    await page.screenshot({path:join(tmpdir(),'rk-held-media-320.png')});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await mediaHeld.count(),0);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),before);
    await page.locator('button[data-act="journey-chaptoggle"][data-jc="0"]').click();
    const chapter=()=>page.locator('.jchap').filter({has:page.locator('[data-jname][value="Microsoft"]')});
    await chapter().getByLabel('Chapter actions',{exact:true}).click();
    assert.equal(await chapter().getByRole('button',{name:'Move up',exact:true}).isDisabled(),true);
    await chapter().getByRole('button',{name:'Move down',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters.map(chapter=>chapter.id)),['origin','stories']);
    await chapter().getByLabel('Chapter actions',{exact:true}).click();
    await chapter().getByRole('button',{name:'Move up',exact:true}).click();
    await chapter().getByLabel('Chapter actions',{exact:true}).click();
    await chapter().getByRole('button',{name:'Remove',exact:true}).click();
    await page.locator('.pass').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),before);
    await chapter().getByLabel('Chapter actions',{exact:true}).click();
    await chapter().getByRole('button',{name:'Rename',exact:true}).click();
    assert.equal(await chapter().locator('[data-jname]').evaluate(element=>element===document.activeElement),true);
    await chapter().locator('[data-jname]').fill('Microsoft renamed');
    await page.getByRole('button',{name:'Back to Studio',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rk:content:draft'))?.journey?.chapters[0]?.name==='Microsoft renamed');
    await page.reload();
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const after=await page.evaluate(()=>window.__RKStudio.getDraft());
    const expected=structuredClone(before); expected.journey.chapters[0].name='Microsoft renamed';
    assert.deepEqual(after,expected);
  } finally {await browser.close();}
});

test('Journey chronology supports independent story and experience overrides, drag, reset and reload', {skip:!baseURL,timeout:90000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
      const published=await journeyFixture(page);
      published.path.reverse();
      const entries=published.journey.chapters[0].entries;
      entries[1].period='2019 - 2020';entries[2].period='2023 - 2024';entries[3].period='2021 - 2022';
      const original=structuredClone(published);
      await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
      await page.goto(baseURL+'/studio/?devstub=1');
      await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
      const openJourney=async()=>{
        await page.locator('.adm__tab[data-tab="aboutpage"]').click();
        await page.locator('[data-act="aboutsec-edit"][data-key="path"]').click();
      };
      await openJourney();
      const titles=()=>page.locator('[data-journey-section="journey"] .jedit__select strong').allTextContents();
      assert.deepEqual(await titles(),['Senior Designer - Edge Growth','Designer - Automotive HMI']);
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().path),original.path);
      const automotive=page.locator('[data-act="jrole-toggle"][data-index="0"]').first().locator('..');
      await automotive.getByLabel('Role actions',{exact:true}).click();
      await automotive.getByRole('button',{name:'Move up',exact:true}).click();
      assert.deepEqual(await titles(),['Designer - Automotive HMI','Senior Designer - Edge Growth']);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().journey.roleOrder),'manual');
      await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().click();
      const linked=page.locator('[data-jrole="1"]');
      const names=()=>linked.locator('[data-jmap-title]').evaluateAll(elements=>elements.map(element=>element.firstChild.textContent));
      const dateOrder=['Edge onboarding','third chapter','fourth chapter','second chapter','Presentation-only story'];
      assert.deepEqual(await names(),dateOrder);
      await linked.locator('.jlinks__row').first().getByLabel('Linked story actions',{exact:true}).click();
      await linked.locator('.jlinks__row').first().getByRole('button',{name:'Move down',exact:true}).click();
      assert.deepEqual(await names(),['third chapter','Edge onboarding','fourth chapter','second chapter','Presentation-only story']);
      await page.locator('.adm__tab[data-tab="work"]').click();
      await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
      await openJourney();
      assert.deepEqual(await titles(),['Designer - Automotive HMI','Senior Designer - Edge Growth']);
      await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().click();
      assert.deepEqual(await names(),['third chapter','Edge onboarding','fourth chapter','second chapter','Presentation-only story']);
      await linked.getByRole('button',{name:'Reset stories to timeline order',exact:true}).click();
      assert.deepEqual(await names(),dateOrder);
      assert.equal(await page.locator('[data-act="jroles-reset"]').isEnabled(),true);
      const first=linked.locator('.jlinks__row').first(),last=linked.locator('.jlinks__row').last();
      await last.scrollIntoViewIfNeeded();
      const grip=await first.locator('[data-grip]').boundingBox(),end=await last.boundingBox();
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
      await page.mouse.down();await page.mouse.move(end.x+12,end.y+end.height-2,{steps:12});
      const held=page.locator('.adm__sort-preview');
      assert.equal(await held.textContent(),'Edge onboarding');
      assert.equal(await held.locator('input,button,iframe,video,[id],[data-grip]').count(),0);
      assert.equal(await last.evaluate(element=>element.classList.contains('is-drop-below')),true);
      assert.match(await last.evaluate(element=>getComputedStyle(element).boxShadow),/inset/);
      const heldBox=await held.boundingBox();
      assert.ok(heldBox.width<=240 && heldBox.height<=60 && heldBox.x>=8 && heldBox.x+heldBox.width<=width-8);
      await page.screenshot({path:join(tmpdir(),'rk-held-story-'+width+'.png')});
      await page.mouse.up();
      assert.equal(await held.count(),0);
      assert.deepEqual(await names(),['third chapter','fourth chapter','second chapter','Presentation-only story','Edge onboarding']);
      await linked.getByRole('button',{name:'Reset stories to timeline order',exact:true}).click();
      await page.locator('[data-act="jroles-reset"]').click();
      assert.deepEqual(await titles(),['Senior Designer - Edge Growth','Designer - Automotive HMI']);
      assert.equal(await page.locator('[data-act="jroles-reset"]').isDisabled(),true);
      assert.deepEqual(await names(),dateOrder);
      const saved=await page.evaluate(()=>window.__RKStudio.getDraft());
      assert.deepEqual(saved.path,original.path);
      assert.deepEqual(saved.journey,original.journey);
      assert.deepEqual(saved.work,original.work);
      assert.equal(await page.locator('[data-act="jroles-reset"] svg').count(),1);
      assert.equal(await linked.locator('[data-act="jstories-reset"] svg').count(),1);
      await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().click();
      const roleRows=page.locator('[data-journey-section="journey"] > .study__blocks > .jedit');
      await roleRows.last().scrollIntoViewIfNeeded();
      const roleGrip=await roleRows.first().locator('[data-grip]').first().boundingBox(),roleEnd=await roleRows.last().boundingBox();
      await page.mouse.move(roleGrip.x+roleGrip.width/2,roleGrip.y+roleGrip.height/2);
      await page.mouse.down();await page.mouse.move(roleEnd.x+12,roleEnd.y+roleEnd.height-2,{steps:12});
      assert.equal(await held.textContent(),'Senior Designer - Edge Growth');
      await page.keyboard.press('Escape');
      assert.equal(await held.count(),0);
      assert.deepEqual(await titles(),['Senior Designer - Edge Growth','Designer - Automotive HMI']);
      await page.mouse.up();
      await page.mouse.move(roleGrip.x+roleGrip.width/2,roleGrip.y+roleGrip.height/2);
      await page.mouse.down();await page.mouse.move(roleEnd.x+12,roleEnd.y+roleEnd.height-2,{steps:12});
      await page.screenshot({path:join(tmpdir(),'rk-held-experience-'+width+'.png')});
      await page.mouse.up();
      assert.equal(await held.count(),0);
      assert.deepEqual(await titles(),['Designer - Automotive HMI','Senior Designer - Edge Growth']);
      await page.locator('[data-act="jroles-reset"]').click();
      await page.locator('[data-act="jrole-toggle"][data-index="0"]').first().click();
      await page.locator('[data-list="path"][data-field="years"][data-index="0"]').fill('2026 - Present');
      await page.locator('[data-act="jrole-toggle"][data-index="0"]').first().click();
      assert.deepEqual(await titles(),['Designer - Automotive HMI','Senior Designer - Edge Growth']);
      await page.screenshot({path:join(tmpdir(),'rk-journey-order-'+width+'.png')});
      await page.close();
    }
  } finally {await browser.close();}
});

test('Journey experience logos upload original bytes, fetch safely and fit the organisation line', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page=await context.newPage();
    const published=await journeyFixture(page),original=structuredClone(published);
    const source=published.journey.chapters[0].entries[0].images[0].src;
    const bytes=Buffer.from(source.split(',')[1],'base64');
    await page.route('https://logos.example/company.png',route=>route.fulfill({contentType:'image/png',body:bytes}));
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="aboutpage"]').click();
    await page.locator('[data-act="aboutsec-edit"][data-key="path"]').click();
    await page.locator('[data-act="jrole-toggle"][data-index="0"]').first().click();
    const chooser=page.waitForEvent('filechooser');
    await page.locator('[data-act="role-logo-upload"][data-index="0"]').click();
    await (await chooser).setFiles({name:'company.png',mimeType:'image/png',buffer:bytes});
    await page.waitForFunction(expected=>window.__RKStudio.getDraft().path[0].logo===expected,source);
    const preview=page.frames().find(frame=>frame.url().includes('preview'));
    await preview.locator('.tl__logo').first().evaluate(image=>image.decode());
    const reader=await page.context().newPage();
    const readerData=await journeyFixture(reader);
    readerData.path=await page.evaluate(()=>window.__RKStudio.getDraft().path);
    await reader.goto(baseURL+'/?view=about');
    for(const width of [1440,390,320]) {
      await reader.setViewportSize({width,height:1000});
      const logo=reader.locator('.tl__logo').first();
      await logo.scrollIntoViewIfNeeded();
      await logo.evaluate(image=>image.decode());
      const geometry=await logo.evaluate(image=>({width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,line:parseFloat(getComputedStyle(image.parentElement).lineHeight),fit:getComputedStyle(image).objectFit}));
      assert.ok(geometry.width>0 && geometry.width<=24 && geometry.height<=geometry.line+.1,JSON.stringify(geometry));
      assert.equal(geometry.fit,'contain');assert.equal(await logo.getAttribute('src'),source);
      await reader.screenshot({path:join(tmpdir(),'rk-journey-logo-'+width+'.png')});
    }
    await reader.close();
    await page.bringToFront();
    await page.locator('[data-role-logo-url="0"]').fill('javascript:alert(1)');
    await page.locator('[data-act="role-logo-fetch"][data-index="0"]').click();
    assert.match(await page.locator('[data-role-logo-error="0"]').textContent(),/direct HTTPS/);
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().path[0].logo),source);
    await page.locator('[data-act="role-logo-remove"][data-index="0"]').click();
    await page.locator('[data-role-logo-url="0"]').fill('https://logos.example/company.png');
    await page.locator('[data-act="role-logo-fetch"][data-index="0"]').click();
    await page.waitForFunction(expected=>window.__RKStudio.getDraft().path[0].logo===expected,source);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#f25022" d="M0 0h24v24H0z"/></svg>';
    const svgSource='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
    let resolvedTitle='',metadataResult={query:{pages:[{imageinfo:[{url:'https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg'}]}]}};
    await page.route('https://commons.wikimedia.org/w/api.php?**',route=>{
      const request=new URL(route.request().url());resolvedTitle=request.searchParams.get('titles');
      assert.equal(request.searchParams.get('origin'),'*');assert.equal(request.searchParams.get('redirects'),'1');assert.equal(request.searchParams.get('iiprop'),'url');
      return route.fulfill({contentType:'application/json',body:JSON.stringify(metadataResult)});
    });
    await page.route('https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:svg}));
    await page.locator('[data-role-logo-url="0"]').fill('https://commons.wikimedia.org/wiki/File:Microsoft_logo.svg');
    await page.locator('[data-act="role-logo-fetch"][data-index="0"]').click();
    await page.waitForFunction(expected=>window.__RKStudio.getDraft().path[0].logo===expected,svgSource);
    assert.equal(resolvedTitle,'File:Microsoft_logo.svg');
    await page.locator('.adm__brand-logo').evaluate(image=>image.decode());
    for(const [result,message] of [[{query:{pages:[{missing:true}]}},'No original image'],[{query:{pages:[{imageinfo:[{url:'https://untrusted.example/logo.svg'}]}]}},'valid original image URL']]) {
      metadataResult=result;
      await page.locator('[data-role-logo-url="0"]').fill('https://commons.wikimedia.org/w/index.php?title=File%3AMicrosoft_logo.svg');
      await page.locator('[data-act="role-logo-fetch"][data-index="0"]').click();
      await page.waitForFunction(message=>document.querySelector('[data-role-logo-error="0"]').textContent.includes(message),message);
      assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().path[0].logo),svgSource);
    }
    await page.route('https://logos.example/page',route=>route.fulfill({contentType:'text/html',body:'<html>File page</html>'}));
    await page.locator('[data-role-logo-url="0"]').fill('https://logos.example/page');
    await page.locator('[data-act="role-logo-fetch"][data-index="0"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-role-logo-error="0"]').textContent.includes('webpage'));
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().path[0].logo),svgSource);
    await page.route('https://logos.example/blocked.svg',route=>route.abort('failed'));
    await page.locator('[data-role-logo-url="0"]').fill('https://logos.example/blocked.svg');
    await page.locator('[data-act="role-logo-fetch"][data-index="0"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-role-logo-error="0"]').textContent.includes('host blocks downloads'));
    assert.equal(await page.locator('[data-act="role-logo-fetch"][data-index="0"]').isEnabled(),true);
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().path[0].logo),svgSource);
    await page.locator('.adm__tab[data-tab="work"]').click();
    await page.reload();
    await page.waitForFunction(expected=>window.__RKStudio?.getDraft?.()?.path[0].logo===expected,svgSource);
    const saved=await page.evaluate(()=>window.__RKStudio.getDraft());
    assert.deepEqual(saved.path.map(({logo,...role})=>role),original.path);
    assert.deepEqual(saved.journey,original.journey);
    assert.deepEqual(saved.work,original.work);
  } finally {await browser.close();}
});

test('Journey editor tabs preserve the draft and support keyboard navigation', {skip:!baseURL,timeout:30000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await journeyFixture(page);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="aboutpage"]').click();
    await page.locator('[data-act="aboutsec-edit"][data-key="path"]').click();
    const before=await page.evaluate(()=>window.__RKStudio.getDraft());
    const tabs=page.getByRole('tablist',{name:'About editor',exact:true});
    assert.deepEqual(await tabs.getByRole('tab').allTextContents(),['About','Journey','Stories','Photos','More']);
    assert.equal(await page.locator('[data-jpreview]').count(),0);
    assert.equal(await page.locator('[data-journey-section="journey"] .jedit__body:visible').count(),0);
    await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().click();
    assert.equal(await page.locator('[data-journey-section="journey"] .jedit__body:visible').count(),1);
    const preview=page.frames().find(frame=>frame.url().includes('preview'));
    await preview.locator('#timeline').waitFor();
    assert.equal(await preview.locator('#journey-detail').count(),0);
    assert.equal(await page.getByRole('tabpanel',{name:'Journey',exact:true}).isVisible(),true);
    await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
    assert.equal(await page.getByRole('tabpanel',{name:'Stories',exact:true}).isVisible(),true);
    assert.equal(await page.locator('[data-journey-section="journey"]').isVisible(),false);
    await page.locator('.jchap__head[data-jc="0"] .study__block-chev').click();
    assert.equal(await page.locator('.jentry .jedit__body:visible').count(),0);
    await page.locator('[data-act="jstory-toggle"][data-jc="0"][data-je="0"]').first().click();
    assert.equal(await page.locator('.jentry .jedit__body:visible').count(),1);
    await preview.waitForFunction(()=>document.querySelector('#journey-detail [aria-current]')?.getAttribute('aria-label')==='Open story: Edge onboarding');
    await tabs.getByRole('tab',{name:'About',exact:true}).click();
    await preview.waitForFunction(()=>!document.querySelector('#journey-detail'));
    await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
    await preview.locator('#journey-detail').waitFor();
    await tabs.getByRole('tab',{name:'Stories',exact:true}).focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(()=>document.querySelector('[data-journey-tab="journey"]')?.getAttribute('aria-selected')==='true');
    await preview.waitForFunction(()=>!document.querySelector('#journey-detail'));
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),before);
    for (const destination of ['work','landing','contact']) {
      await page.locator('.adm__tab[data-tab="' + destination + '"]').click();
      assert.equal(await page.locator('[data-l2tabs]').isVisible(),false);
      assert.equal(await page.locator('[data-journey-tab]').count(),0);
      assert.equal(await page.locator('[data-l2-back]').isVisible(),false);
      assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),before);
      await page.locator('.adm__tab[data-tab="aboutpage"]').click();
      await page.locator('[data-act="aboutsec-edit"][data-key="path"]').click();
    }
    await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
    assert.equal(await page.locator('.jentry .jedit__body:visible').count(),1);
    await page.locator('[data-act="jentry-add"][data-jc="0"]').click();
    const newTitle=page.locator('[data-jfield="title"][data-jc="0"][data-je="5"]');
    await newTitle.fill('Unassigned preview');
    await preview.waitForFunction(()=>document.querySelector('#journey-detail [aria-current]')?.getAttribute('aria-label')==='Open story: Unassigned preview');
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[5].pathId),'unassigned');
    await tabs.getByRole('tab',{name:'About',exact:true}).click();
    await preview.waitForFunction(()=>!document.querySelector('#journey-detail'));
    assert.equal(await preview.getByRole('button',{name:'Unassigned preview',exact:true}).count(),0);
    await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
    const storyHead=index=>page.locator('[data-act="jstory-toggle"][data-jc="0"][data-je="'+index+'"]').first().locator('..');
    await storyHead(0).getByLabel('Story actions',{exact:true}).click();
    assert.equal(await storyHead(0).getByRole('button',{name:'Move up',exact:true}).isDisabled(),true);
    await storyHead(0).getByRole('button',{name:'Duplicate',exact:true}).click();
    let duplicate=await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[1]);
    assert.equal(duplicate.pathId,'unassigned');
    assert.equal(duplicate.workId,'journey-case');
    assert.deepEqual(duplicate.images,before.journey.chapters[0].entries[0].images);
    assert.notEqual(duplicate.id,before.journey.chapters[0].entries[0].id);
    await storyHead(1).getByLabel('Story actions',{exact:true}).click();
    await storyHead(1).getByRole('button',{name:'Move down',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[2].id),duplicate.id);
    await storyHead(2).getByLabel('Story actions',{exact:true}).click();
    await storyHead(2).getByRole('button',{name:'Rename',exact:true}).click();
    assert.equal(await page.locator('[data-jfield="title"][data-jc="0"][data-je="2"]').evaluate(input=>document.activeElement===input),true);
    await preview.waitForFunction(()=>document.querySelector('#journey-detail [aria-current]')?.getAttribute('aria-label')==='Open story: Edge onboarding (copy)');
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      await page.locator('[data-act="jstory-toggle"][data-jc="0"][data-je="2"]').first().scrollIntoViewIfNeeded();
      await tabs.getByRole('tab',{name:'Stories',exact:true}).click();
      await page.waitForFunction(()=>{const tabs=document.querySelector('[data-l2tabs]'),selected=tabs.querySelector('[aria-selected="true"]');const bounds=tabs.getBoundingClientRect(),active=selected.getBoundingClientRect();return active.left>=bounds.left-1 && active.right<=bounds.right+1;});
      assert.equal(await storyHead(2).evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.width>0 && bounds.left>=0 && bounds.right<=innerWidth;}),true);
      assert.equal(await storyHead(2).locator('.jedit__select').evaluate(element=>element.getBoundingClientRect().width>=120),true);
      await storyHead(2).getByLabel('Story actions',{exact:true}).click();
      await storyHead(2).locator('[popover]').waitFor({state:'visible'});
      assert.equal(await storyHead(2).locator('[popover]').evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.width>0 && bounds.left>=0 && bounds.right<=innerWidth && bounds.bottom<=innerHeight;}),true);
      await page.screenshot({path:join(tmpdir(),'rk-journey-focused-'+width+'.png')});
      await page.keyboard.press('Escape');
      const mediaRow=page.locator('.jentry .jedit__body:visible .jimg').first();
      await mediaRow.scrollIntoViewIfNeeded();
      const mediaLayout=await mediaRow.evaluate(element=>{
        const source=element.querySelector('[data-jimg="src"]'),replace=element.querySelector('[data-act="jimg-upload"]'),caption=element.querySelector('[data-jimg="caption"]');
        const sourceBounds=source.getBoundingClientRect(),replaceBounds=replace.getBoundingClientRect(),captionLabel=caption.labels[0].getBoundingClientRect(),bounds=element.getBoundingClientRect();
        return {labelled:source.labels[0].textContent==='Source' && caption.labels[0].textContent.includes('Caption'),aligned:Math.abs(sourceBounds.top-replaceBounds.top)<1 && sourceBounds.height===replaceBounds.height,replaceWidth:replaceBounds.width,gap:captionLabel.top-sourceBounds.bottom,width:sourceBounds.width,contained:bounds.left>=0 && bounds.right<=innerWidth,framed:getComputedStyle(element).borderTopWidth,fit:getComputedStyle(element.querySelector('.jimg__preview img')).objectFit};
      });
      assert.deepEqual({...mediaLayout,gap:undefined,width:undefined},{labelled:true,aligned:true,replaceWidth:38,gap:undefined,width:undefined,contained:true,framed:'0px',fit:'contain'});
      assert.ok(mediaLayout.gap>=12 && mediaLayout.width>=120,JSON.stringify(mediaLayout));
      await mediaRow.getByLabel('Source',{exact:true}).focus();
      await page.keyboard.press('Tab');
      assert.equal(await mediaRow.getByRole('button',{name:'Replace image 1',exact:true}).evaluate(element=>document.activeElement===element),true);
      await page.keyboard.press('Tab');
      assert.equal(await mediaRow.getByLabel('Caption (optional)',{exact:true}).evaluate(element=>document.activeElement===element),true);
      await mediaRow.locator('.af__msize').evaluate(element=>{element.textContent='';});
      assert.equal(await mediaRow.locator('.af__msize').isVisible(),false);
      await mediaRow.screenshot({path:join(tmpdir(),'rk-journey-media-'+width+'.png')});
    }
    await page.locator('.jentry .jedit__body:visible .jimg').first().getByLabel('Caption (optional)',{exact:true}).fill('Updated copied caption');
    await preview.waitForFunction(()=>document.querySelector('.jrn-gallery__caption')?.textContent==='Updated copied caption');
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[2].images[0].caption),'Updated copied caption');
    const beforeCancel=await page.evaluate(()=>window.__RKStudio.getDraft());
    await storyHead(2).getByLabel('Story actions',{exact:true}).click();
    await storyHead(2).getByRole('button',{name:'Remove',exact:true}).click();
    await page.locator('.pass').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),beforeCancel);
    await storyHead(2).getByLabel('Story actions',{exact:true}).click();
    await storyHead(2).getByRole('button',{name:'Remove',exact:true}).click();
    await page.locator('.pass').getByRole('button',{name:'Remove story',exact:true}).click();
    assert.equal(await page.evaluate(id=>window.__RKStudio.getDraft().journey.chapters[0].entries.some(entry=>entry.id===id),duplicate.id),false);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[0]),before.journey.chapters[0].entries[0]);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().work),before.work);
  } finally {await browser.close();}
});

test('Mobile banners wrap text and keep actions and expiry inside one surface', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await journeyFixture(page);
    await page.goto(baseURL+'/about');
    await page.waitForFunction(()=>!!window.RK?.data);
    const dockBottom=await page.locator('.dock').evaluate(element=>getComputedStyle(element).bottom);
    await page.goto(baseURL+'/?preview=1');
    await page.locator('.preview-banner').waitFor();
    for(const width of [390,320,600,1440,390]) {
      await page.setViewportSize({width,height:844});
      await page.waitForFunction(()=>{const surface=document.querySelector('.sv-surface').getBoundingClientRect();return parseFloat(document.body.style.getPropertyValue('--sv-surface-height'))===surface.height;});
      if(width>600) {assert.equal(await page.locator('.sv-surface').evaluate(element=>getComputedStyle(element).display),'contents');continue;}
      const surface=await page.locator('.sv-surface').boundingBox(),dock=await page.locator('.dock').boundingBox();
      assert.equal(surface.x,0);assert.equal(surface.width,width);assert.equal(surface.y+surface.height,844);
      assert.ok(dock.y+dock.height<=surface.y-12);
      assert.ok(Math.abs(await page.evaluate(()=>parseFloat(getComputedStyle(document.body).paddingBottom))-surface.height)<.01);
      assert.equal(await page.locator('.sv-surface').evaluate(element=>getComputedStyle(element).backgroundColor===getComputedStyle(document.body).backgroundColor),true);
      assert.deepEqual(await page.locator('.sv-surface').evaluate(element=>{const curve=getComputedStyle(element,'::before'),banner=getComputedStyle(element.firstElementChild);return {top:curve.top,height:curve.height,pointer:curve.pointerEvents,radius:banner.borderRadius,round:banner.cornerShape===getComputedStyle(element.querySelector('.sv-banner__exit')).cornerShape};}),{top:'-40px',height:'40px',pointer:'none',radius:'16px',round:true});
      await page.screenshot({path:join(tmpdir(),'rk-mobile-preview-surface-'+width+'.png')});
    }
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      for(const appearance of ['dark','light']) {
        await page.evaluate(appearance=>document.documentElement.dataset.appearance=appearance,appearance);
        await page.waitForFunction(()=>parseFloat(document.body.style.getPropertyValue('--sv-surface-height'))===document.querySelector('.sv-surface').getBoundingClientRect().height);
        const surface=await page.locator('.sv-surface').boundingBox();
        await page.screenshot({path:join(tmpdir(),'rk-mobile-curved-backing-'+width+'-'+appearance+'.png')});
        await page.evaluate(()=>{const surface=document.querySelector('.sv-surface').getBoundingClientRect(),band=document.createElement('div');band.id='curve-pixel-fixture';Object.assign(band.style,{position:'fixed',left:'0',right:'0',top:surface.top-40+'px',height:'40px',background:'rgb(199,80,97)',zIndex:'839',pointerEvents:'none'});document.body.append(band);document.querySelector('.sv-banner').style.boxShadow='none';});
        const pixels=await page.evaluate(async({imageURL,surfaceTop})=>{
          const image=new Image();image.src=imageURL;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
          const context=canvas.getContext('2d');context.drawImage(image,0,0);
          const sample=(left,top)=>[...context.getImageData(left,Math.floor(top),1,1).data];
          const edges=[sample(2,surfaceTop-2),sample(image.width-3,surfaceTop-2)];
          const open=[sample(2,surfaceTop-38),sample(image.width-3,surfaceTop-38),sample(Math.floor(image.width/2),surfaceTop-2)];
          context.fillStyle=getComputedStyle(document.querySelector('.sv-surface')).backgroundColor;context.fillRect(0,0,1,1);
          return {edges,open,backing:sample(0,0)};
        },{imageURL:'data:image/png;base64,'+(await page.screenshot()).toString('base64'),surfaceTop:surface.y});
        assert.deepEqual(pixels.edges,[pixels.backing,pixels.backing]);
        assert.deepEqual(pixels.open,Array.from({length:3},()=>[199,80,97,255]));
        await page.evaluate(()=>{document.querySelector('#curve-pixel-fixture').remove();document.querySelector('.sv-banner').style.removeProperty('box-shadow');});
        assert.equal(await page.locator('.dock').evaluate(element=>{const button=element.lastElementChild,rect=button.getBoundingClientRect();return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true);
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.preview-banner .sv-banner__txt').evaluate(element=>element.textContent+=' Long feedback updates must resize the reserved surface without covering the contact controls.'.repeat(2));
    await page.waitForFunction(()=>{const surface=document.querySelector('.sv-surface').getBoundingClientRect();return parseFloat(document.body.style.getPropertyValue('--sv-surface-height'))===surface.height && document.querySelector('.dock').getBoundingClientRect().bottom<=surface.top-12;});
    await page.getByRole('button',{name:'Dismiss preview banner',exact:true}).click();
    assert.equal(await page.locator('.sv-surface').count(),0);
    assert.equal(await page.locator('.dock').evaluate(element=>getComputedStyle(element).bottom),dockBottom);
    assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--sv-surface-height')),'');
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      for(const appearance of ['dark','light']) {
        await page.evaluate(appearance=>document.documentElement.dataset.appearance=appearance,appearance);
        for(const variant of ['curated','preview','loading','toast']) {
          await page.evaluate(variant=>{
            document.querySelectorAll('[data-banner-fixture]').forEach(element=>element.remove());
            const banner=document.createElement('div');banner.dataset.bannerFixture='';
            banner.className=variant==='toast'?'rk-flash is-on':'sv-banner '+(variant==='preview'?'preview-banner':'');
            if(variant==='toast') banner.textContent='Changes could not be saved. Your draft is still available; try again when your connection returns.';
            else {
              const indicator=document.createElement('span');indicator.className=variant==='loading'?'sv-banner__spin':'sv-banner__dot';banner.append(indicator);
              const text=document.createElement('span');text.className='sv-banner__txt';text.textContent=variant==='preview'?'Preview - unpublished draft - how your site looks once you publish':variant==='loading'?'Unlocking your protected projects and original media...':'Curated view - ALongUnbrokenAudienceNameThatMustNeverPushTheExitButtonOutsideTheBanner';banner.append(text);
              if(variant==='curated') {const expiry=document.createElement('span');expiry.className='sv-banner__exp';expiry.textContent='Expires in 14 days';banner.append(expiry);}
              if(variant!=='loading') {const exit=document.createElement('button');exit.className='sv-banner__exit';exit.textContent=variant==='preview'?'Dismiss':'Exit';exit.onclick=()=>banner.remove();banner.append(exit);}
            }
            document.body.append(banner);
          },variant);
          const banner=page.locator('[data-banner-fixture]');
          assert.equal(await banner.evaluate(element=>{const bounds=element.getBoundingClientRect(),text=element.querySelector('.sv-banner__txt'),exit=element.querySelector('button');return bounds.left>=16 && bounds.right<=innerWidth-16 && bounds.bottom<=innerHeight-16 && element.scrollWidth<=element.clientWidth && (!text || text.scrollWidth<=text.clientWidth) && (!exit || text.getBoundingClientRect().right<=exit.getBoundingClientRect().left) && Array.from(element.children).every(child=>{const rect=child.getBoundingClientRect();return rect.width>0 && rect.left>=bounds.left && rect.right<=bounds.right && rect.bottom<=bounds.bottom;});}),true,variant+' '+width+' '+appearance);
          await banner.screenshot({path:join(tmpdir(),'rk-mobile-'+variant+'-'+width+'-'+appearance+'.png')});
          if(await banner.locator('button').count()) {await banner.locator('button').click();assert.equal(await banner.count(),0);}
        }
      }
    }
    assert.doesNotMatch(readFileSync(new URL('./src/js/admin.js',import.meta.url),'utf8').match(/function presentArrived\(res\) \{[\s\S]*?\n  \}/)[0],/flash\(/);
  } finally {await browser.close();}
});

test('Skills use pipe separated editing and recognition metadata shares an adaptive row', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const published=await journeyFixture(page);
    published.recognition=[{title:'Design award',meta:'2025',icon:'award'}];
    published.education=[{title:'Design degree',meta:'2010 - 2014',icon:''}];
    published.capabilities=['Product strategy','Design systems','Research'];
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const open=async()=>{await page.locator('.adm__tab[data-tab="aboutpage"]').click();await page.getByRole('tab',{name:'More',exact:true}).click();};
    await open();
    const before=await page.evaluate(()=>window.__RKStudio.getDraft());
    const skills=page.getByRole('textbox',{name:'Skills separated by |',exact:true});
    assert.equal(await skills.inputValue(),published.capabilities.join(' | '));
    assert.equal(await page.locator('[data-about-editor="capabilities"] .card').count(),0);
    await skills.fill('  Research | Product design || AI & UX | ');
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().capabilities),['Research','Product design','AI & UX']);
    assert.equal(await skills.inputValue(),'  Research | Product design || AI & UX | ');
    await skills.fill(' |  | ');
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().capabilities),[]);
    await skills.fill('Research | AI & UX | Product design');
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      for(const list of ['recognition','education']) {
        const row=page.locator('[data-about-editor="'+list+'"] .adm__meta-row').first();
        await row.scrollIntoViewIfNeeded();
        const boxes=await row.locator(':scope > .af').evaluateAll(fields=>fields.map(field=>field.getBoundingClientRect().toJSON()));
        assert.ok(boxes.every(box=>box.width>0 && box.x>=0 && box.right<=width));
        if(width===1440) {assert.equal(boxes[0].top,boxes[1].top);assert.ok(boxes[0].right<=boxes[1].left);}
        else assert.ok(boxes[0].bottom<=boxes[1].top);
        assert.equal(await row.locator('.adm__iconf-row').evaluate(element=>Array.from(element.children).every(child=>{const rect=child.getBoundingClientRect();return rect.width>0 && rect.left>=0 && rect.right<=innerWidth;})),true);
      }
      await page.locator('[data-about-editor="education"]').screenshot({path:join(tmpdir(),'rk-compact-education-'+width+'.png')});
      await skills.scrollIntoViewIfNeeded();
      assert.ok((await skills.boundingBox()).height<150);
      await page.locator('[data-about-editor="capabilities"]').screenshot({path:join(tmpdir(),'rk-compact-skills-'+width+'.png')});
    }
    await page.locator('[data-list="recognition"][data-field="meta"]').fill('2026');
    await page.locator('[data-iconpick="education"]').selectOption('award');
    await page.waitForFunction(()=>{const saved=JSON.parse(localStorage.getItem('rk:content:draft'));return saved?.education[0].icon==='award' && saved?.recognition[0].meta==='2026' && saved?.capabilities.join('|')==='Research|AI & UX|Product design';});
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());await open();
    assert.equal(await skills.inputValue(),'Research | AI & UX | Product design');
    const after=await page.evaluate(()=>window.__RKStudio.getDraft());
    assert.equal(after.education[0].icon,'award');assert.equal(after.recognition[0].meta,'2026');
    assert.deepEqual(after.work,before.work);assert.deepEqual(after.journey,before.journey);assert.deepEqual(after.path,before.path);
    assert.equal(after.recognition[0].title,before.recognition[0].title);assert.equal(after.recognition[0].icon,before.recognition[0].icon);
  } finally {await browser.close();}
});

test('About overview preserves section order and visibility and routes Edit to the matching tab', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await journeyFixture(page);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="aboutpage"]').click();
    const tabs=page.getByRole('tablist',{name:'About editor',exact:true});
    const preview=page.frames().find(frame=>frame.url().includes('preview'));
    await preview.locator('#timeline').waitFor();
    const before=await page.evaluate(()=>window.__RKStudio.getDraft());
    const overview=page.getByRole('tabpanel',{name:'About',exact:true});
    const row=key=>overview.locator('[data-about-section="'+key+'"]');
    const order=()=>overview.locator('[data-about-section]').evaluateAll(rows=>rows.map(element=>element.dataset.aboutSection));
    const originalOrder=await order();
    assert.equal(originalOrder.length,6);
    await row('photos').locator('summary').click();
    await row('photos').getByTitle('Move up',{exact:true}).click();
    const movedOrder=await order();
    assert.equal(movedOrder.indexOf('photos'),originalOrder.indexOf('photos')-1);
    const grip=await row('photos').locator('[data-grip]').boundingBox();
    const next=await row(originalOrder[originalOrder.indexOf('photos')-1]).boundingBox();
    await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
    await page.mouse.down();
    await page.mouse.move(grip.x+grip.width/2,next.y+next.height-4,{steps:12});
    await page.mouse.up();
    assert.deepEqual(await order(),originalOrder);
    await row('photos').locator('summary').click();
    await row('photos').getByTitle('Move up',{exact:true}).click();
    await row('recognition').locator('[data-act="aboutsec-toggle"]').uncheck();
    assert.equal(await row('recognition').evaluate(element=>element.classList.contains('is-off')),true);
    for(const [key,tab] of [['path','Journey'],['photos','Photos'],['recognition','More'],['education','More'],['about','More'],['capabilities','More']]) {
      await row(key).locator('[data-act="aboutsec-edit"]').click();
      assert.equal(await tabs.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true');
      const section=page.locator('[data-about-editor="'+key+'"]');
      await page.waitForFunction(key=>document.activeElement?.dataset.aboutEditor===key,key);
      assert.equal(await section.isVisible(),true);
      const destination=await section.evaluate(element=>{const rect=element.getBoundingClientRect(),bar=document.querySelector('.adm__workbar').getBoundingClientRect();return {top:rect.top,barBottom:bar.bottom,height:innerHeight};});
      assert.ok(destination.top>=destination.barBottom && destination.top<destination.height,key+': '+JSON.stringify(destination));
      assert.equal(await page.locator('.mlib').count(),0);
      await tabs.getByRole('tab',{name:'About',exact:true}).click();
    }
    assert.deepEqual(await order(),movedOrder);
    assert.equal(await row('recognition').locator('[data-act="aboutsec-toggle"]').isChecked(),false);
    await row('recognition').locator('[data-act="aboutsec-toggle"]').check();
    await row('about').locator('[data-act="aboutsec-edit"]').click();
    await page.locator('[data-path="landing.aboutSign"]').fill('Overview routing checked');
    await page.waitForFunction(()=>window.__RKStudio.getDraft().landing.aboutSign==='Overview routing checked');
    await tabs.getByRole('tab',{name:'About',exact:true}).click();
    const after=await page.evaluate(()=>window.__RKStudio.getDraft());
    assert.deepEqual(after.path,before.path);
    assert.deepEqual(after.journey,before.journey);
    assert.deepEqual(after.work,before.work);
    assert.deepEqual(after.aboutGallery,before.aboutGallery);
    await tabs.getByRole('tab',{name:'Photos',exact:true}).click();
    if(!before.aboutGallery.length) await page.locator('[data-act="gal-add"]').click();
    const caption=page.locator('[data-galedit="0"][data-galfield="caption"]');
    const originalCaption=await caption.inputValue();
    await caption.fill('Photo tab edit');
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().aboutGallery[0].caption),'Photo tab edit');
    if(!before.aboutGallery.length) await page.locator('[data-act="gal-remove"][data-gindex="0"]').click();
    else await caption.fill(originalCaption);
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft().aboutGallery),before.aboutGallery);
    await tabs.getByRole('tab',{name:'About',exact:true}).click();
    for(const [key,field] of [['recognition','title'],['education','title'],['capabilities',null]]) {
      await row(key).locator('[data-act="aboutsec-edit"]').click();
      const input=page.locator('[data-about-editor="'+key+'"] '+(field?'[data-list="'+key+'"][data-index="0"][data-field="'+field+'"]':'[data-skills]'));
      await input.fill('Edited '+key);
      assert.equal(await page.evaluate(({key,field})=>field?window.__RKStudio.getDraft()[key][0][field]:window.__RKStudio.getDraft()[key][0],{key,field}),'Edited '+key);
      await tabs.getByRole('tab',{name:'About',exact:true}).click();
    }
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:1000});
      for(const name of ['About','Journey','Stories','Photos','More']) {
        await tabs.getByRole('tab',{name,exact:true}).click();
        await page.waitForFunction(()=>{const host=document.querySelector('[data-l2tabs]'),active=host.querySelector('[aria-selected="true"]');const rect=active.getBoundingClientRect(),bounds=host.getBoundingClientRect();return rect.width>0 && rect.left>=bounds.left-1 && rect.right<=bounds.right+1;});
      }
      await tabs.getByRole('tab',{name:'About',exact:true}).click();
      assert.equal(await overview.evaluate(element=>Array.from(element.querySelectorAll('.adm__lsec-head')).every(head=>{const title=head.querySelector('.adm__lsec-titles').getBoundingClientRect(),ops=head.querySelector('.adm__lsec-ops').getBoundingClientRect();return title.width>=100 && ops.width>0 && ops.left>=0 && ops.right<=innerWidth && (title.right<=ops.left || title.bottom<=ops.top);})),true);
      await overview.locator('[data-about-section]').first().scrollIntoViewIfNeeded();
      await page.screenshot({path:join(tmpdir(),'rk-about-overview-'+width+'.png')});
      await row('education').locator('[data-act="aboutsec-edit"]').click();
      await page.waitForFunction(()=>document.activeElement?.dataset.aboutEditor==='education');
      await page.screenshot({path:join(tmpdir(),'rk-about-more-'+width+'.png')});
      await tabs.getByRole('tab',{name:'About',exact:true}).click();
    }
    await row('recognition').locator('[data-act="aboutsec-toggle"]').uncheck();
    await page.waitForFunction(()=>{const draft=JSON.parse(localStorage.getItem('rk:content:draft'));return draft?.landing?.aboutSign==='Overview routing checked' && draft?.aboutSections?.some(section=>section.key==='recognition' && !section.on);});
    await page.reload();
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    await page.locator('.adm__tab[data-tab="aboutpage"]').click();
    assert.deepEqual(await order(),movedOrder);
    assert.equal(await row('recognition').locator('[data-act="aboutsec-toggle"]').isChecked(),false);
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().landing.aboutSign),'Overview routing checked');
    await page.getByRole('button',{name:'Back to Studio',exact:true}).click();
    assert.equal(await page.locator('.adm__tab[data-tab="work"]').evaluate(element=>element.classList.contains('is-active')),true);
  } finally {await browser.close();}
});

test('Journey Studio picks configured stories and preserves case links through edits and reload', {skip:!baseURL,timeout:60000}, async()=>{
  const browser=await chromium.launch(launchOptions);
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.setDefaultTimeout(12000);
    const published=await journeyFixture(page), original=structuredClone(published);
    await page.addInitScript(()=>localStorage.setItem('rk:dev:stub','1'));
    await page.goto(baseURL+'/studio/?devstub=1');
    await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const open=async()=>{await page.locator('.adm__tab[data-tab="aboutpage"]').click();await page.locator('[data-act="aboutsec-edit"][data-key="path"]').click();};
    await open();
    assert.deepEqual(await page.locator('[data-journey-section] > .l2grp__head').allTextContents(),['Journey','Stories']);
    assert.equal(await page.locator('.jmap,[data-jsel="pathId"]').count(),0);
    assert.equal(await page.locator('.adm__l2 [data-list="path"][data-field="role"]').count(),2);
    await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().click();
    const add=page.locator('[data-act="jstories-add"][data-index="1"]');
    const dialog=page.getByRole('dialog',{name:'Add stories',exact:true});
    const before=await page.evaluate(()=>window.__RKStudio.getDraft());
    await add.click();
    assert.equal(await dialog.getByRole('button',{name:'Add stories',exact:true}).isDisabled(),true);
    await dialog.getByRole('textbox',{name:'Search stories'}).fill('not a configured story');
    assert.equal(await dialog.locator('[data-jstory-empty]').isVisible(),true);
    await dialog.getByRole('textbox',{name:'Search stories'}).fill('Edge');
    await dialog.locator('[data-jstory-choice="0"]').check();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.__RKStudio.getDraft()),before);
    assert.equal(await add.evaluate(button=>document.activeElement===button),true);
    await add.click();
    assert.match(await dialog.locator('[data-jstory-choice="0"]').locator('..').textContent(),/Move from.*Edge/);
    await dialog.locator('[data-jstory-choice="0"]').check();
    await dialog.locator('[data-jstory-choice="4"]').check();
    await dialog.getByRole('button',{name:'Add stories',exact:true}).click();
    await page.waitForFunction(()=>window.__RKStudio.getDraft().path[1].id?.startsWith('jr-'));
    const after=await page.evaluate(()=>window.__RKStudio.getDraft());
    assert.equal(after.journey.chapters[0].entries[0].pathId,after.path[1].id);
    assert.equal(after.journey.chapters[0].entries[4].pathId,after.path[1].id);
    assert.equal(after.journey.chapters[0].entries[4].visibility,undefined);
    assert.equal(after.journey.chapters[0].entries[0].workId,'journey-case');
    assert.deepEqual(after.journey.chapters[0].entries[0].images,original.journey.chapters[0].entries[0].images);
    assert.deepEqual(after.work,original.work);
    assert.equal(await add.evaluate(button=>document.activeElement===button),true);
    await page.locator('[data-act="jstory-unlink"][data-jc="0"][data-je="0"]').click();
    const unlinked=await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[0]);
    assert.equal(unlinked.pathId,'unassigned');
    assert.equal(unlinked.workId,'journey-case');
    assert.deepEqual(unlinked.images,original.journey.chapters[0].entries[0].images);
    assert.equal(await page.locator('[data-journey-section="stories"] .jentry').count(),6);
    await add.click();
    assert.equal(await dialog.locator('[data-jstory-choice="4"]').isDisabled(),true);
    await dialog.locator('[data-jstory-choice="0"]').check();
    await dialog.getByRole('button',{name:'Add stories',exact:true}).click();
    await page.locator('[data-act="jentry-edit"][data-jc="0"][data-je="0"]').click();
    const storyTitle=page.locator('[data-jfield="title"][data-jc="0"][data-je="0"]');
    assert.equal(await storyTitle.evaluate(input=>document.activeElement===input),true);
    const editingPreview=page.frames().find(frame=>frame.url().includes('preview'));
    await editingPreview.waitForFunction(()=>document.querySelector('#journey-detail [aria-current]')?.getAttribute('aria-label')==='Open story: Edge onboarding');
    assert.equal(await editingPreview.locator('#journey-detail .jrn-case').getAttribute('data-jwork'),'journey-case');
    const caseLink=page.locator('[data-jsel="workId"][data-jc="0"][data-je="0"]');
    assert.equal(await caseLink.inputValue(),'journey-case');
    await caseLink.selectOption('');
    await editingPreview.waitForFunction(()=>!document.querySelector('.jrn-case'));
    await caseLink.selectOption('journey-case');
    await editingPreview.locator('#journey-detail .jrn-case').waitFor();
    await storyTitle.fill('Configured story');
    await page.locator('[data-jfield="period"][data-jc="0"][data-je="0"]').fill('2015 - 2018');
    await page.locator('[data-act="jstory-toggle"][data-jc="0"][data-je="4"]').first().click();
    await page.locator('[data-jsel="visibility"][data-jc="0"][data-je="4"]').selectOption('public');
    await page.getByRole('tab',{name:'Journey',exact:true}).click();
    await page.locator('.adm__l2 [data-list="path"][data-field="role"][data-index="1"]').fill('Automotive experience');
    await page.locator('[data-act="jrole-toggle"][data-index="1"]').first().locator('..').getByLabel('Role actions',{exact:true}).click();
    await page.locator('.adm__l2 [data-act="up"][data-list="path"][data-index="1"]').click();
    await page.waitForFunction(()=>window.__RKStudio.getDraft().path[0].role.includes('Automotive'));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rk:content:draft')||'null')?.journey?.chapters?.[0]?.entries?.[4]?.visibility==='public');
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const restored=await page.evaluate(()=>window.__RKStudio.getDraft());
    assert.equal(restored.journey.chapters[0].entries[0].pathId,restored.path[0].id);
    assert.equal(restored.journey.chapters[0].entries[4].pathId,restored.path[0].id);
    assert.equal(restored.journey.chapters[0].entries[4].visibility,'public');
    assert.equal(restored.journey.chapters[0].entries[0].title,'Configured story');
    assert.equal(restored.journey.chapters[0].entries[0].period,'2015 - 2018');
    assert.equal(restored.journey.chapters[0].entries[0].workId,'journey-case');
    assert.equal(restored.path[0].role,'Automotive experience');
    assert.deepEqual(restored.journey.chapters[0].entries[0].images,original.journey.chapters[0].entries[0].images);
    assert.deepEqual(restored.work,original.work);
    await open();
    await page.locator('[data-act="jrole-toggle"][data-index="0"]').first().click();
    const preview=page.frames().find(frame=>frame.url().includes('preview'));
    assert.ok(preview);
    await preview.locator('[data-jstory]').first().waitFor();
    assert.equal(await preview.locator('.jrn[role="dialog"]').count(),0);
    assert.equal(await preview.locator('[data-jstory]').count(),6);
    await page.locator('[data-act="jentry-edit"][data-jc="0"][data-je="0"]').click();
    await preview.locator('#journey-detail .jrn-case').click();
    await preview.getByText('Linked case content',{exact:true}).waitFor();
    await page.locator('[data-l2tab="story"][aria-selected="true"]').waitFor();
    assert.equal(await page.locator('.adm__l2-title').textContent(),'Synthetic');
    await open();
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      const trigger=page.locator('[data-act="jstories-add"][data-index="0"]');
      await trigger.click();
      assert.equal(await dialog.evaluate(element=>{const bounds=element.getBoundingClientRect();return bounds.width>0 && bounds.left>=0 && bounds.right<=innerWidth && bounds.bottom<=innerHeight;}),true);
      assert.equal(await dialog.locator('input,button').evaluateAll(controls=>controls.every(control=>{const bounds=control.getBoundingClientRect();return bounds.width>0 && bounds.left>=0 && bounds.right<=innerWidth;})),true);
      assert.equal(await dialog.getByRole('textbox',{name:'Search stories'}).evaluate(control=>document.activeElement===control),true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(control=>document.activeElement===control),true);
      await page.screenshot({path:join(tmpdir(),'rk-journey-picker-'+width+'.png')});
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(control=>document.activeElement===control),true);
      await page.screenshot({path:join(tmpdir(),'rk-journey-studio-'+width+'.png')});
    }
    await page.getByRole('tab',{name:'Stories',exact:true}).click();
    await page.locator('[data-act="jentry-add"][data-jc="0"]').click();
    await page.locator('[data-jfield="title"][data-jc="0"][data-je="5"]').fill('New library story');
    await page.locator('[data-jsel="workId"][data-jc="0"][data-je="5"]').selectOption('journey-case');
    assert.equal(await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[5].pathId),'unassigned');
    await page.getByRole('tab',{name:'Journey',exact:true}).click();
    await page.locator('[data-act="jstories-add"][data-index="0"]').click();
    await dialog.getByRole('textbox',{name:'Search stories'}).fill('New library story');
    assert.equal(await dialog.locator('[data-jstory-option]:not([hidden])').count(),1);
    await dialog.locator('[data-jstory-choice="5"]').check();
    await dialog.getByRole('button',{name:'Add stories',exact:true}).click();
    await page.waitForFunction(()=>{const draft=JSON.parse(localStorage.getItem('rk:content:draft')||'null');return draft?.journey?.chapters?.[0]?.entries?.[5]?.pathId===draft?.path?.[0]?.id;});
    await page.reload();await page.waitForFunction(()=>!!window.__RKStudio?.getDraft?.());
    const newStory=await page.evaluate(()=>window.__RKStudio.getDraft().journey.chapters[0].entries[5]);
    assert.equal(newStory.title,'New library story');
    assert.equal(newStory.workId,'journey-case');
    assert.equal(newStory.pathId,restored.path[0].id);
  } finally {await browser.close();}
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