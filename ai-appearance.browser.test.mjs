import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';
import { AI_APPEARANCE_KEY, readAiAppearance, saveAiAppearance } from './src/js/ai-appearance.mjs';
import { HYBRID_REST_PATH, aiRibbonIcon } from './src/js/ai-ribbon.mjs';

test('Appearance persists only the independent style/orb fields and reports invalid or unavailable storage',()=>{
  const values=new Map(), events=[], warnings=[];
  const view={localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};
  assert.deepEqual(readAiAppearance(view),{style:'2d',orb:false});
  for (const style of ['2d','3d']) for (const orb of [false,true]) {
    saveAiAppearance(view,{style,orb,unexpected:'not persisted'});
    assert.deepEqual(readAiAppearance(view),{style,orb});
  }
  assert.equal(values.size,1); assert.equal(events.length,4);
  assert.throws(()=>saveAiAppearance(view,{style:'4d',orb:false}),/valid/);
  values.set(AI_APPEARANCE_KEY,'broken');
  assert.deepEqual(readAiAppearance(view,error=>warnings.push(error)),{style:'2d',orb:false}); assert.equal(warnings.length,1);
  view.localStorage.setItem=()=>{throw new Error('Storage blocked');};
  assert.throws(()=>saveAiAppearance(view,{style:'2d',orb:true}),/Storage blocked/);
  assert.equal(events.length,4,'A failed save must not broadcast success');
  view.localStorage.getItem=()=>{throw new Error('Read blocked');};
  assert.deepEqual(readAiAppearance(view,error=>warnings.push(error)),{style:'2d',orb:false});
  assert.match(warnings.at(-1).message,/Read blocked/);
});

test('React action icons render the same static currentColor infinity',async()=>{
  const output=await build({entryPoints:['src/js/ai-ribbon.jsx'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});
  const module={exports:{}};
  runInNewContext(output.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url)});
  const html=renderToStaticMarkup(createElement(module.exports.AiRibbonIcon,{size:18}));
  assert.ok(html.includes(`d="${HYBRID_REST_PATH}"`));
  assert.match(html,/stroke="currentColor"/); assert.doesNotMatch(html,/canvas/);
});

const bundle=await build({stdin:{contents:"export * from './src/js/ai-ribbon.mjs'; export * from './src/js/ai-appearance.mjs';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Appearance'});
const css=readFileSync(new URL('./css/styles.css',import.meta.url),'utf8')+readFileSync(new URL('./css/admin.css',import.meta.url),'utf8');
const launch={executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']};
async function fixture(browser,failGraphics=false) {
  const context=await browser.newContext({viewport:{width:1000,height:700}});
  const page=await context.newPage();
  await page.route('**/*',route=>route.request().url()==='http://appearance.test/' ? route.fulfill({contentType:'text/html',body:`<!doctype html><style>${css}.examples{display:flex;gap:24px;padding:32px;align-items:center}.large{color:var(--accent)}</style><body class="adm is-open"><div class="examples"><div id="large" class="large" data-ai-state="idle">${aiRibbonIcon({size:64})}</div><button id="compact" class="adm__ai-counter" data-ai-state="idle">${aiRibbonIcon()}</button><button id="primary" class="btn btn--primary" data-ai-state="idle">${aiRibbonIcon()}Generate</button><button id="auto" class="btn btn--auto">${aiRibbonIcon()}Improve</button></div></body>`}) : route.abort());
  await page.addInitScript(()=>{
    window.graphicsContexts=new Set();
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const context=original.call(this,type,...args);
      if (context&&type.startsWith('webgl')) graphicsContexts.add(context);
      return context;
    };
  });
  if (failGraphics) await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){ return type.startsWith('webgl') ? null : original.call(this,type,...args); };
  });
  await page.goto('http://appearance.test/');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
    window.visualErrors=[];
    window.visuals=[
      Appearance.mountAiRibbon(document.querySelector('#large'),{large:true,onError:message=>visualErrors.push(message)}),
      Appearance.mountAiRibbon(document.querySelector('#compact')),
      Appearance.mountAiRibbon(document.querySelector('#primary'))
    ];
  });
  return page;
}

test('Large visuals support all four choices while compact icons and gold CTAs remain contrasting 2D', {timeout:60000},async()=>{
  const browser=await chromium.launch(launch);
  try {
    const page=await fixture(browser), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.querySelector('#large').dataset.aiRenderer==='gpu');
    for (const style of ['2d','3d']) for (const orb of [false,true]) {
      await page.evaluate(value=>Appearance.saveAiAppearance(window,value),{style,orb});
      await page.waitForFunction(value=>{
        const element=document.querySelector('#large');
        return element.dataset.aiStyle===value.style && element.dataset.aiOrb===String(value.orb) && element.dataset.aiRenderer==='gpu';
      },{style,orb});
      assert.deepEqual(await page.locator('#compact,#primary').evaluateAll(elements=>elements.map(element=>[element.dataset.aiStyle,element.dataset.aiOrb])),[['2d','false'],['2d','false']]);
      const visiblePixels=await page.evaluate(()=>new Promise(resolve=>{
        window.dispatchEvent(new Event('resize'));
        requestAnimationFrame(()=>{
          const canvas=document.querySelector('#large canvas'), gl=canvas.getContext(document.querySelector('#large').dataset.aiStyle==='2d'&&document.querySelector('#large').dataset.aiOrb==='false'?'webgl2':'webgl');
          const pixels=new Uint8Array(canvas.width*canvas.height*4); gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          resolve(pixels.filter((value,index)=>index%4===3&&value>20).length);
        });
      }));
      assert.ok(visiblePixels>30,'Every choice must draw actual pixels');
    }
    for (const theme of ['night','day']) for (const hovered of ['#primary','#auto','body']) {
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await page.locator(hovered).hover();
      const contrast=await page.locator('#primary,#auto').evaluateAll(elements=>elements.map(button=>{
        const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=values=>values.map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
        const style=getComputedStyle(button), foreground=rgb(style.color), stroke=getComputedStyle(button.querySelector('path')).stroke;
        const backgrounds=style.backgroundImage.match(/rgb\([^)]+\)/g).map(rgb);
        return {same:stroke===style.color,minimum:Math.min(...backgrounds.map(background=>(luminance(background)+.05)/(luminance(foreground)+.05)))};
      }));
      assert.ok(contrast.every(value=>value.same&&value.minimum>=4.5),JSON.stringify(contrast));
    }
    assert.equal(await page.locator('#auto path').getAttribute('d'),HYBRID_REST_PATH);
    await page.evaluate(()=>{ document.querySelector('#primary').dataset.aiState='working'; });
    await page.waitForFunction(()=>document.querySelector('#primary').dataset.aiRenderer==='gpu');
    const palette=await page.locator('#primary canvas').evaluate(canvas=>{
      const gl=canvas.getContext('webgl2'), program=gl.getParameter(gl.CURRENT_PROGRAM);
      return ['uAccent','uText'].map(name=>[...gl.getUniform(program,gl.getUniformLocation(program,name))]);
    });
    for (const colour of palette) for (const [index,value] of [36,26,9].entries()) assert.ok(Math.abs(colour[index]-value/255)<1e-6,'Animated primary CTA ink must stay dark, including the head');
    await page.evaluate(()=>window.visuals.forEach(visual=>visual.dispose()));
    assert.equal(await page.locator('canvas.ai-ribbon-canvas').count(),0);
    assert.equal(await page.evaluate(()=>[...graphicsContexts].every(context=>context.isContextLost())),true,'All owned GPU contexts must be released');
    assert.deepEqual(await page.evaluate(()=>visualErrors),[]); assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Cross-tab preferences and outer or inner context loss update large visuals without hiding the fallback', {timeout:60000},async()=>{
  const browser=await chromium.launch(launch);
  try {
    const page=await fixture(browser);
    const other=await page.context().newPage();
    await other.route('http://appearance.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Preference peer</title>'}));
    await other.goto('http://appearance.test/');
    for (const [style,orb] of [['2d',true],['3d',false],['3d',true],['2d',false]]) {
      await other.evaluate(value=>localStorage.setItem('rk:ai:appearance',JSON.stringify(value)),{style,orb});
      await page.waitForFunction(value=>{
        const data=document.querySelector('#large').dataset;
        return data.aiStyle===value.style&&data.aiOrb===String(value.orb)&&data.aiRenderer==='gpu';
      },{style,orb});
      await page.locator('#large canvas').evaluate(canvas=>{
        const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
        gl.getExtension('WEBGL_lose_context').loseContext();
      });
      await page.waitForFunction(()=>document.querySelector('#large').dataset.aiAppearanceFallback==='true');
      assert.equal(await page.locator('#large svg').isVisible(),true);
      assert.equal(await page.locator('#large canvas').isVisible(),false);
    }
    await other.evaluate(()=>localStorage.setItem('rk:ai:appearance',JSON.stringify({style:'2d',orb:true})));
    await page.waitForFunction(()=>document.querySelector('#large').dataset.aiRenderer==='gpu');
    await page.evaluate(()=>{
      const inner=[...graphicsContexts].find(context=>!context.isContextLost()&&context instanceof WebGL2RenderingContext&&!context.canvas.isConnected);
      inner.getExtension('WEBGL_lose_context').loseContext();
    });
    await page.waitForFunction(()=>document.querySelector('#large').dataset.aiAppearanceFallback==='true');
    assert.equal(await page.locator('#large svg').isVisible(),true);
    assert.equal(await page.evaluate(()=>visualErrors.length),5);
    assert.equal(await page.locator('#compact').getAttribute('data-ai-style'),'2d');
    await page.evaluate(()=>window.visuals.forEach(visual=>{visual.dispose();visual.dispose();}));
    assert.equal(await page.evaluate(()=>[...graphicsContexts].every(context=>context.isContextLost())),true);
  } finally {await browser.close();}
});

test('Active large visuals pause offscreen and under reduced motion, and resize while static',async()=>{
  const browser=await chromium.launch(launch);
  try {
    const page=await fixture(browser);
    await page.waitForFunction(()=>document.querySelector('#large').dataset.aiRenderer==='gpu');
    await page.evaluate(()=>{
      const gl=document.querySelector('#large canvas').getContext('webgl2'), original=gl.drawElements;
      window.draws=0; gl.drawElements=function(...args){window.draws++;return original.apply(this,args);};
      document.querySelector('#large').dataset.aiState='working';
    });
    await page.waitForFunction(()=>draws>3);
    await page.locator('#large').evaluate(element=>{element.style.transform='translateY(2000px)';});
    await page.waitForTimeout(100);
    const offscreen=await page.evaluate(()=>draws);
    await page.waitForTimeout(100); assert.equal(await page.evaluate(()=>draws),offscreen);
    await page.locator('#large').evaluate(element=>{element.style.transform='';});
    await page.waitForFunction(previous=>draws>previous+2,offscreen);
    await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForTimeout(100);
    const reduced=await page.evaluate(()=>draws);
    await page.waitForTimeout(100); assert.equal(await page.evaluate(()=>draws),reduced);
    assert.equal(await page.locator('#large [data-ai-line]').getAttribute('d'),HYBRID_REST_PATH);
    await page.locator('#large canvas').evaluate(canvas=>{canvas.style.width='96px';window.dispatchEvent(new Event('resize'));});
    await page.waitForFunction(()=>document.querySelector('#large canvas').width===288);
    assert.equal(await page.evaluate(()=>visualErrors.length),0);
  } finally {await browser.close();}
});

test('Unavailable graphics explicitly degrades and removed visuals dispose themselves',async()=>{
  const browser=await chromium.launch(launch);
  try {
    const page=await fixture(browser,true);
    await page.waitForFunction(()=>document.querySelector('#large').dataset.aiAppearanceFallback==='true');
    assert.match(await page.evaluate(()=>visualErrors[0]),/simplified 2D/);
    assert.equal(await page.locator('#large svg').isVisible(),true);
    await page.evaluate(()=>{ window.removed=document.querySelector('#large'); removed.remove(); });
    await page.waitForFunction(()=>!window.removed.querySelector('canvas'));
    assert.equal(await page.evaluate(()=>removed.querySelectorAll('[data-ai-tail]').length),0);
  } finally {await browser.close();}
});
