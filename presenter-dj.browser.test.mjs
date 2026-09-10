import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = process.env.SLIDE_LAB_URL || 'http://127.0.0.1:5510';
const executablePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
test('Rehearse budgets and DJ-pad notes, timing, overview and end persist safely', { timeout:90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const context = await browser.newContext({ viewport:{width:1280,height:800} });
  await context.addInitScript(() => Object.defineProperty(window,'documentPictureInPicture',{value:undefined,configurable:true}));
  await context.addInitScript(() => { navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError')); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/studio/slide-merge-lab/');
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector('.merge-layout-toggle').disabled);
    await page.locator('.merge-layout-toggle').click();
    assert.equal(await page.locator('.merge-layout-toggle').textContent(),'Rehearse');
    await page.getByRole('spinbutton',{name:'Slide time budget',exact:true}).fill('02:00');
    await page.getByRole('spinbutton',{name:'Slide time budget',exact:true}).press('Tab');
    const first = await page.evaluate(() => window.__slideMerge.deck().selected);
    const waiting = page.waitForEvent('popup');
    await page.getByRole('button',{name:'Slide Show',exact:true}).click();
    const popup = await waiting;
    popup.on('pageerror',error => errors.push(error.message));
    await popup.waitForSelector('[data-pp-notes]');
    assert.equal(await popup.title(),'Presenter DJ pad');
    assert.equal(await popup.locator('[data-pp-minutes]').inputValue(),'2');
    await popup.getByRole('button',{name:'Pause timer',exact:true}).click();
    await popup.waitForFunction(() => document.querySelector('[data-pp-elapsed]').textContent === 'paused');
    const elapsed = await popup.locator('[data-pp-timer]').textContent();
    await page.clock.install();
    await page.clock.fastForward(5000);
    assert.equal(await popup.locator('[data-pp-timer]').textContent(),elapsed);
    await popup.getByRole('button',{name:'Reset timer',exact:true}).click();
    assert.equal(await popup.locator('[data-pp-timer]').textContent(),'0:00');
    await popup.locator('[data-pp-notes]').fill('Notes edited privately during rehearsal');
    await popup.locator('[data-pp-minutes]').fill('3.5');
    await popup.waitForFunction(() => document.querySelector('[data-pp-save]').textContent === 'Saved to deck');
    await popup.getByRole('button',{name:'Slide overview',exact:true}).click();
    await popup.locator('[data-pp-jump="1"]').click();
    await popup.waitForFunction(() => document.querySelector('[data-pp-count]').textContent === '2 / 2');
    await popup.locator('[data-pp-notes]').fill('Second slide private note');
    await popup.locator('[data-pp="prev"]').click();
    assert.equal(await popup.locator('[data-pp-notes]').innerText(),'Notes edited privately during rehearsal');
    await popup.getByRole('button',{name:'Larger notes',exact:true}).click();
    await popup.locator('[data-pp-divider]').focus(); await popup.keyboard.press('ArrowLeft');
    await popup.screenshot({path:join(tmpdir(),'rk-dj-desktop.png')});
    for (const width of [390,320]) {
      await popup.setViewportSize({width,height:844});
      assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      await popup.screenshot({path:join(tmpdir(),`rk-dj-${width}.png`)});
    }
    await popup.getByRole('button',{name:'End presentation',exact:true}).click();
    await page.waitForSelector('.pjp',{state:'detached'});
    assert.equal(popup.isClosed(),true);
    const saved = await page.evaluate(id => window.__slideMerge.deck().slides.find(slide=>slide.id===id),first);
    assert.equal(saved.notes,'Notes edited privately during rehearsal'); assert.equal(saved.durationMinutes,3.5);
    await page.reload();
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector('.merge-layout-toggle').disabled);
    assert.equal(await page.evaluate(id=>window.__slideMerge.deck().slides.find(slide=>slide.id===id).durationMinutes,first),3.5);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('bottom-right Notes and time controls replace slide-list timing and preserve per-slide budgets', { timeout:60000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const context = await browser.newContext({ viewport:{width:1440,height:900} });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const budget = () => page.getByRole('spinbutton', {name:'Slide time budget',exact:true});
  const notes = () => page.getByRole('button', {name:'Speaker notes panel',exact:true});
  try {
    await page.goto(base + '/studio/slide-merge-lab/');
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector('.merge-layout-toggle').disabled);
    const originalNotes = await page.evaluate(() => window.__slideMerge.deck().slides.map(slide => slide.notes));
    assert.equal(await page.locator('.merge-slide-timing').count(),0);
    assert.equal(await page.getByRole('button',{name:/Time budget for slide/}).count(),0);
    assert.equal(await page.locator('.merge-notes-heading input').count(),0);
    assert.equal(await budget().inputValue(),'00:00');
    await budget().fill('01:30'); await budget().press('Tab');
    assert.equal(await page.evaluate(() => window.__slideMerge.deck().slides[0].durationMinutes),1.5);
    await page.getByRole('button',{name:'Increase slide time',exact:true}).click();
    assert.equal(await budget().inputValue(),'02:00');
    await budget().press('ArrowDown');
    assert.equal(await budget().inputValue(),'01:30');
    await budget().fill('01:99');
    assert.equal(await budget().getAttribute('aria-invalid'),'true');
    await budget().press('Tab');
    assert.equal(await budget().inputValue(),'01:30');
    await budget().focus(); await budget().fill('02:15'); await budget().press('Escape');
    assert.equal(await budget().inputValue(),'01:30');
    await budget().fill('240:00'); await budget().press('Tab');
    assert.equal(await page.getByRole('button',{name:'Increase slide time',exact:true}).isDisabled(),true);
    await budget().fill('01:30'); await budget().press('Tab');
    await notes().click();
    assert.equal(await page.locator('#merge-speaker-notes').isHidden(),true);
    assert.equal(await budget().isVisible(),true);
    assert.equal(await notes().getAttribute('aria-expanded'),'false');
    const closed = await notes().locator('.merge-notes-chevron').evaluate(element => getComputedStyle(element).transform);
    await notes().click();
    assert.equal(await page.locator('#merge-speaker-notes').isVisible(),true);
    assert.equal(await notes().getAttribute('aria-expanded'),'true');
    assert.equal(await page.getByRole('button',{name:'Close notes',exact:true}).count(),0);
    await notes().click();
    assert.equal(await page.locator('#merge-speaker-notes').isHidden(),true);
    assert.ok(closed !== 'none');
    await page.locator('.merge-slide').nth(1).click();
    assert.equal(await budget().inputValue(),'00:00');
    await budget().fill('02:05'); await budget().press('Tab');
    await page.locator('.merge-slide').nth(0).click();
    assert.equal(await budget().inputValue(),'01:30');
    await page.evaluate(() => window.__slideMerge.save());
    await page.reload();
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector('.merge-layout-toggle').disabled);
    assert.equal(await budget().inputValue(),'01:30');
    for (const width of [1440,901,880,760,390,320]) {
      await page.setViewportSize({width,height:900});
      const noteBox = await notes().boundingBox(), timeBox = await page.locator('.merge-time-budget:visible').boundingBox(), helpBox = await page.getByRole('button',{name:'Help',exact:true}).boundingBox();
      assert.ok(noteBox.x + noteBox.width <= timeBox.x, `Notes precedes time at ${width}`);
      assert.ok(timeBox.x + timeBox.width <= helpBox.x + 1, `Time precedes Help at ${width}`);
      assert.ok(Math.abs(noteBox.y - timeBox.y) < 1 && Math.abs(timeBox.y - helpBox.y) < 1, `One aligned group at ${width}`);
      assert.equal(noteBox.height,36); assert.equal(timeBox.height,36);
      assert.ok(helpBox.x + helpBox.width <= width, `Footer stays inside ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      const visibleText = await notes().locator('.merge-notes-label').isVisible();
      assert.equal(visibleText,true, `Notes label remains visible at ${width}`);
      if (width === 880 || width === 760) {
        const zoomIn = page.getByRole('button',{name:'Zoom in',exact:true});
        const zoomOut = page.getByRole('button',{name:'Zoom out',exact:true});
        const tools = await page.getByRole('button',{name:'Fit slide',exact:true}).boundingBox();
        const zoomBox = await zoomOut.boundingBox();
        assert.ok(tools.x + tools.width + 8 <= zoomBox.x, `Zoom must follow the slide tools at ${width}`);
        for (const control of [zoomOut,zoomIn,page.getByRole('button',{name:'Reset zoom',exact:true})]) {
          assert.equal(await control.evaluate(element => { const rect=element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)); }),true, `Zoom must be unobstructed at ${width}`);
        }
        const beforeZoom = await page.evaluate(() => window.__slideMerge.api.getAppState().zoom.value);
        await zoomIn.click();
        assert.ok(await page.evaluate(() => window.__slideMerge.api.getAppState().zoom.value) > beforeZoom);
        await zoomOut.click();
        assert.ok(Math.abs(await page.evaluate(() => window.__slideMerge.api.getAppState().zoom.value)-beforeZoom) < 0.01);
      }
      await page.screenshot({path:join(tmpdir(),`rk-notes-time-${width}.png`)});
      if (width <= 390) {
        await notes().click();
        assert.equal(await page.locator('#merge-speaker-notes').isVisible(),true);
        await notes().focus(); await notes().press('Tab');
        assert.equal(await budget().evaluate(element => element === document.activeElement),true);
        const original = await budget().inputValue();
        await budget().fill('03:15'); await budget().press('Escape');
        assert.equal(await budget().inputValue(),original);
        assert.equal(await page.locator('#merge-speaker-notes').isVisible(),true);
        await page.getByRole('button',{name:'Help',exact:true}).click();
        await page.locator('.HelpDialog').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.HelpDialog').waitFor({state:'detached'});
        assert.equal(await page.locator('#merge-speaker-notes').isVisible(),true, 'Closing Help must not close notes');
        await budget().fill('01:45'); await budget().press('ArrowUp');
        assert.equal(await budget().inputValue(),'02:15');
        await notes().click();
        assert.equal(await page.locator('#merge-speaker-notes').isHidden(),true);
        const editor = await page.locator('.merge-editor').boundingBox(), workspace = await page.locator('.merge-workspace').boundingBox();
        assert.ok(Math.abs(editor.height - workspace.height) < 1, 'Closed notes must not leave a blank row');
      }
    }
    assert.deepEqual(await page.evaluate(() => window.__slideMerge.deck().slides.map(slide => slide.notes)),originalNotes);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('rich notes and full deck history preserve formatting, reordering and slide additions', { timeout:60000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:900} });
  try {
    await page.addInitScript(() => { window.__RKStudio = { draftSlides() {}, improveText: async (text, options) => options.rich ? '<p><strong>Improved</strong> notes.</p><script>window.compromised=true</script>' : 'Improved selected text' }; });
    await page.goto(base + '/studio/slide-merge-lab/');
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector('.merge-layout-toggle').disabled);
    const order = () => page.evaluate(() => window.__slideMerge.deck().slides.map(slide => slide.id));
    const original = await order();
    await page.locator('.merge-slide-card').first().getByRole('button',{name:'Move slide down',exact:true}).click();
    await page.waitForFunction(id => window.__slideMerge.deck().slides[0].id === id,original[1]);
    assert.deepEqual(await order(),[...original].reverse());
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(id => window.__slideMerge.deck().slides[0].id === id,original[0]);
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await page.waitForFunction(id => window.__slideMerge.deck().slides[0].id === id,original[1]);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('.merge-layout-toggle').disabled);
    const notes = page.locator('.merge-notes-input');
    await notes.fill('One important decision');
    await notes.evaluate(element => { const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range); });
    await page.getByRole('button',{name:'Bold',exact:true}).click();
    await page.evaluate(() => window.__slideMerge.save());
    assert.match(await page.evaluate(() => window.__slideMerge.deck().slides[0].notes),/<(?:b|strong)>/);
    await page.getByRole('button',{name:'Italic',exact:true}).click();
    await page.getByRole('button',{name:'Bulleted list',exact:true}).click();
    assert.equal(await notes.locator('ul li').count(),1);
    await page.getByRole('button',{name:'Increase indent',exact:true}).click();
    assert.ok(await notes.locator('ul ul,blockquote').count()>0);
    await page.getByRole('button',{name:'Decrease indent',exact:true}).click();
    assert.equal(await notes.locator('b i,strong em,b em,strong i').count(),1);
    assert.equal(await page.locator('.merge-notes-heading').count(),0);
    await page.getByRole('button',{name:'Improve speaker notes with AI',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input strong')?.textContent==='Improved');
    await page.evaluate(() => window.__slideMerge.save());
    assert.equal(await page.evaluate(() => !!window.compromised),false);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input').textContent==='One important decision');
    assert.equal(await notes.locator('b,strong').count(),1);
    await page.locator('.merge-slide-card').first().getByRole('button',{name:'Duplicate slide',exact:true}).click();
    await page.waitForFunction(() => window.__slideMerge.deck().slides.length===3);
    assert.equal((await order()).length,3);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(() => window.__slideMerge.deck().slides.length===2);
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await page.waitForFunction(() => window.__slideMerge.deck().slides.length===3);
    await page.reload();
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector('.merge-layout-toggle').disabled);
    assert.equal((await order()).length,3);
    assert.match(await page.evaluate(() => window.__slideMerge.deck().slides[0].notes),/<(?:b|strong)>/);
  } finally { await browser.close(); }
});

test('embed links, text improvement and generated draft icons integrate with slides and thumbnails', { timeout:90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('rk:content:draft',JSON.stringify({work:[],customIcons:{'draft-only':'<circle cx="12" cy="12" r="8"/>'},slideLayouts:[{id:'saved-studio',name:'Studio saved title',blocks:[{kind:'text',ph:'Legacy title',x:10,y:20,w:80,size:'lg'}]}],typography:{active:'draft',systems:[{id:'draft',display:{stack:'"Hanken Grotesk", sans-serif'},text:{stack:'"Hanken Grotesk", sans-serif'},mono:{stack:'"Martian Mono", monospace'}}]}}));
      window.__RKStudio = { draftSlides() {}, improveText: async () => 'Improved selected copy', generateIcon: async () => ({name:'generated-mark',svg:'<path d="M4 4h16v16H4Z"/>',keywords:['generated','mark']}) };
    });
    await page.route('https://www.youtube-nocookie.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<html><body style="margin:0;background:#32bc9a">Embedded video fixture</body></html>'}));
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.typographySource),'draft');
    await page.getByRole('button',{name:'Media',exact:true}).click();
    await page.getByRole('button',{name:'Embed link',exact:true}).click();
    await page.getByRole('textbox',{name:'Embed media link',exact:true}).fill('https://youtu.be/dQw4w9WgXcQ');
    await page.getByRole('button',{name:'Embed',exact:true}).click();
    await page.waitForFunction(()=>window.__slideMerge.api.getSceneElements().some(element=>element.customData?.slideEmbed));
    await page.locator('.merge-slide-card.is-active iframe[title="YouTube video"]').waitFor({state:'attached'});
    assert.equal(await page.locator('.merge-workspace iframe[title="YouTube video"]').count(),1);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.getByRole('textbox',{name:'Embed media link',exact:true}).waitFor();
    await page.getByRole('textbox',{name:'Embed media link',exact:true}).fill('https://youtu.be/dQw4w9WgXcQ');
    await page.locator('.merge-brand').click();
    await page.waitForFunction(()=>window.__slideMerge.api.getSceneElements().some(element=>element.customData?.slideEmbed));
    await page.getByRole('button',{name:'Icons',exact:true}).click();
    await page.getByRole('button',{name:'Insert draft-only icon',exact:true}).waitFor();
    await page.getByRole('button',{name:'Generate an icon',exact:true}).click();
    await page.getByRole('textbox',{name:'Icon description',exact:true}).fill('A clear square mark');
    const count=await page.evaluate(()=>window.__slideMerge.api.getSceneElements().filter(element=>element.type==='image').length);
    await page.getByRole('button',{name:'Generate and add',exact:true}).click();
    await page.waitForFunction(count=>window.__slideMerge.api.getSceneElements().filter(element=>element.type==='image').length===count+1,count);
    await page.getByRole('button',{name:'Insert generated-mark icon',exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:content:draft')).customIcons['generated-mark']));
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    const position=await page.evaluate(()=>{const api=window.__slideMerge.api,element=api.getSceneElements().find(element=>element.id==='title'),state=api.getAppState(),box=document.querySelector('.lab-canvas').getBoundingClientRect();return {x:box.left+(element.x+element.width/2+state.scrollX)*state.zoom.value,y:box.top+(element.y+element.height/2+state.scrollY)*state.zoom.value};});
    await page.mouse.click(position.x,position.y); await page.mouse.click(position.x,position.y,{button:'right'});
    await page.getByRole('button',{name:'Improve with AI',exact:true}).click();
    await page.waitForFunction(()=>window.__slideMerge.api.getSceneElements().find(element=>element.id==='title').text==='Improved selected copy');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(()=>window.__slideMerge.api.getSceneElements().find(element=>element.id==='title').text!=='Improved selected copy');
    await page.mouse.click(800,900);
    await page.getByRole('tab',{name:'My layouts',exact:true}).click();
    await page.getByRole('button',{name:'Studio saved title',exact:true}).click();
    await page.getByRole('button',{name:'Apply layout',exact:true}).click();
    await page.waitForFunction(()=>window.__slideMerge.api.getSceneElements().some(element=>element.text==='Legacy title'));
    await page.reload(); await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    assert.ok(await page.evaluate(()=>window.__slideMerge.api.getSceneElements().some(element=>element.text==='Legacy title')));
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('before-after sections render inside picker cards, navigator and slideshow', { timeout:60000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:1000} });
  try {
    await page.addInitScript(() => {
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');context.fillStyle='#bf2042';context.fillRect(0,0,640,360);const beforeSrc=canvas.toDataURL();context.fillStyle='#20ba98';context.fillRect(0,0,640,360);
      localStorage.setItem('rk:content:draft',JSON.stringify({work:[{id:'comparison',title:'Comparison sample',study:{blocks:[{type:'compare',heading:'Before and after',beforeSrc,afterSrc:canvas.toDataURL()}]}}]}));
      navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));
    });
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    await page.getByRole('button',{name:'Sections',exact:true}).click();
    await page.getByRole('button',{name:'Comparison sample',exact:true}).click();
    const picker=page.frameLocator('.merge-section-choices iframe[title="Case-study section"]').first();
    await picker.locator('.pjb__cmp-base').waitFor({state:'attached'});
    assert.ok(await picker.locator('.pjb__cmp-base').evaluate(image=>image.complete&&image.naturalWidth>0));
    await page.locator('.merge-section-choices button[title="Before and after"]').click();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.frameLocator('.merge-slide-card.is-active iframe[title="Case-study section"]').locator('.pjb__cmp-base').waitFor({state:'attached'});
    await page.getByRole('button',{name:'Slide Show',exact:true}).click();
    const audience=page.frameLocator('.pjp iframe[title="Case-study section"]');
    await audience.locator('.pjb__cmp-base').waitFor();
    await audience.locator('.pjb__cmp').click({position:{x:220,y:100}});
    assert.notEqual(await audience.locator('.pjb__cmp').evaluate(element=>element.style.getPropertyValue('--pos')),'50%');
    await page.keyboard.press('Escape');
  } finally { await browser.close(); }
});

test('unpublished font faces are authored choices and rich notes survive the web presenter', { timeout:60000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless:true });
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await page.addInitScript(() => {
      localStorage.setItem('rk:content:draft',JSON.stringify({work:[],typography:{active:'custom',systems:[{id:'custom',display:{family:'Draft Display',stack:'"Draft Display", sans-serif'},text:{family:'Hanken Grotesk',stack:'"Hanken Grotesk", sans-serif'},mono:{family:'Martian Mono',stack:'"Martian Mono", monospace'},faces:[{family:'Draft Display',url:'/fonts/inter-normal-400-latin.woff2',weight:'400'}]}]}}));
      navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));
      Object.defineProperty(window,'documentPictureInPicture',{value:undefined,configurable:true});
    });
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    await page.waitForFunction(()=>[...document.fonts].some(font=>font.family==='Draft Display'&&font.status==='loaded'));
    const point=await page.evaluate(()=>{const api=window.__slideMerge.api,state=api.getAppState(),text=api.getSceneElements().find(element=>element.id==='title'),box=document.querySelector('.lab-canvas').getBoundingClientRect();return {x:box.left+(text.x+text.width/2+state.scrollX)*state.zoom.value,y:box.top+(text.y+text.height/2+state.scrollY)*state.zoom.value};});
    await page.mouse.click(point.x,point.y);
    await page.getByRole('button',{name:'Show font picker',exact:true}).click();
    await page.getByRole('tab',{name:'Display',exact:true}).click();
    await page.getByRole('button',{name:'Draft Display',exact:true}).click();
    await page.evaluate(()=>window.__slideMerge.save());
    assert.equal(await page.evaluate(()=>window.__slideMerge.deck().fonts[0].family),'Draft Display');
    const notes=page.locator('.merge-notes-input');await notes.fill('Rich note for presenter');
    await notes.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);getSelection().removeAllRanges();getSelection().addRange(range);});
    await page.getByRole('button',{name:'Bold',exact:true}).click();
    await page.evaluate(()=>window.__slideMerge.save());
    const waiting=page.waitForEvent('popup');await page.getByRole('button',{name:'Slide Show',exact:true}).click();const popup=await waiting;
    await popup.locator('[data-pp-notes] b,[data-pp-notes] strong').waitFor();
    assert.equal(await popup.locator('[data-pp-notes]').innerText(),'Rich note for presenter');
    await popup.getByRole('button',{name:'End presentation',exact:true}).click();
    await page.waitForSelector('.pjp',{state:'detached'});
    await page.reload();await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    assert.equal(await page.evaluate(()=>window.__slideMerge.deck().fonts[0].family),'Draft Display');
    assert.equal(await page.locator('.merge-notes-input b,.merge-notes-input strong').count(),1);
  } finally {await browser.close();}
});

test('video navigator previews decode actual frames and compact notes and embed fields stay usable', {timeout:60000}, async () => {
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    await page.locator('input[type=file]').setInputFiles(join(process.cwd(),'studio','slide-lab','motion.webm'));
    await page.waitForFunction(()=>{const video=document.querySelector('.merge-slide-card.is-active video');return video?.readyState>=2;});
    const video=page.locator('.merge-slide-card.is-active video');
    const pixels=await video.evaluate(video=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;const context=canvas.getContext('2d');context.drawImage(video,0,0,64,36);const colors=new Set();const pixels=context.getImageData(0,0,64,36).data;for(let index=0;index<pixels.length;index+=4)colors.add(`${pixels[index]},${pixels[index+1]},${pixels[index+2]}`);return {colors:colors.size,muted:video.muted,paused:video.paused};});
    assert.ok(pixels.colors>3);assert.equal(pixels.muted,true);assert.equal(pixels.paused,true);
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      const toggle=page.getByRole('button',{name:'Speaker notes panel',exact:true});if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
      for(const control of await page.locator('.merge-rich-toolbar button').all()){const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`notes control at ${width}`);}
      await page.getByRole('button',{name:'Media',exact:true}).click();await page.getByRole('button',{name:'Embed link',exact:true}).click();
      const field=page.getByRole('textbox',{name:'Embed media link',exact:true});await field.fill('https://example.com/embed');
      const box=await page.locator('.merge-embed-composer').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`embed control at ${width}`);
      await page.screenshot({path:join(tmpdir(),`rk-authoring-mobile-${width}.png`)});
      await field.fill('');await page.locator('.merge-brand').click();await page.getByRole('button',{name:'Undo',exact:true}).click();
      await page.waitForFunction(()=>!window.__slideMerge.api.getSceneElements().some(element=>element.customData?.pendingEmbed));
    }
  }finally{await browser.close();}
});

test('real Studio AI service improves notes and sanitizes generated icons without an alternate provider path', {timeout:60000}, async () => {
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), requests=[];
  try {
    await page.addInitScript(()=>{
      localStorage.setItem('rk:content:draft',JSON.stringify({work:[],customIcons:{}}));
      localStorage.setItem('rk:ai:mode','local');localStorage.setItem('rk:ai:same','0');
      for(const [key,value] of Object.entries({provider:'custom',key:'test-fixture-not-a-secret',model:'fixture-model',base:'https://studio-ai.test/v1'}))localStorage.setItem('rk:ai:txt:'+key,value);
    });
    await page.route('https://studio-ai.test/**',route=>{
      const body=route.request().postDataJSON();requests.push(body);
      const icon=body.messages[0].content.includes('line-icon');
      const content=icon?JSON.stringify({name:'service-mark',svg:'<svg><script>alert(1)</script><image href="https://invalid.test"/><path d="M4 4h16v16H4Z" onclick="alert(1)"/></svg>',keywords:['service','mark']}):'<p><strong>Sharper</strong> notes.</p>';
      return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:10,completion_tokens:10}})});
    });
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    await page.getByRole('button',{name:'Improve speaker notes with AI',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.merge-notes-input strong')?.textContent==='Sharper');
    await page.getByRole('button',{name:'Icons',exact:true}).click();
    await page.getByRole('button',{name:'Generate an icon',exact:true}).click();
    await page.getByRole('textbox',{name:'Icon description',exact:true}).fill('A simple square mark');
    await page.getByRole('button',{name:'Generate and add',exact:true}).click();
    await page.getByRole('button',{name:'Insert service-mark icon',exact:true}).waitFor();
    const icon=await page.evaluate(()=>JSON.parse(localStorage.getItem('rk:content:draft')).customIcons['service-mark']);
    assert.match(icon,/<path/);assert.doesNotMatch(icon,/script|image|onclick|href/);
    assert.equal(requests.length,2);assert.ok(requests.every(request=>request.model==='fixture-model'));
    assert.equal(await page.evaluate(()=>window.__slideMerge.api.getSceneElements().filter(element=>element.type==='image').length),1);
  }finally{await browser.close();}
});

test('canvas drag stays one deck-history step through autosave and slide navigation', {timeout:45000}, async () => {
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  try{
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    const original=await page.evaluate(()=>{const api=window.__slideMerge.api,element=api.getSceneElements().find(element=>element.id==='step-0'),state=api.getAppState(),box=document.querySelector('.lab-canvas').getBoundingClientRect();return {id:element.id,x:element.x,y:element.y,screen:{x:box.left+(element.x+element.width*.4+state.scrollX)*state.zoom.value,y:box.top+(element.y+element.height*.2+state.scrollY)*state.zoom.value}};});
    await page.clock.install();
    await page.mouse.move(original.screen.x,original.screen.y);await page.mouse.down();
    await page.mouse.move(original.screen.x+60,original.screen.y+20,{steps:5});
    await page.clock.runFor(650);
    await page.mouse.move(original.screen.x+110,original.screen.y+40,{steps:5});await page.mouse.up();
    await page.clock.runFor(650);
    const moved=await page.evaluate(id=>{const element=window.__slideMerge.api.getSceneElements().find(element=>element.id===id);return {x:element.x,y:element.y};},original.id);
    assert.notEqual(moved.x,original.x);
    await page.locator('.merge-slide').nth(1).click();
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(id=>window.__slideMerge.deck().selected==='opening'&&window.__slideMerge.api.getSceneElements().some(element=>element.id===id),original.id);
    const restored=await page.evaluate(id=>{const element=window.__slideMerge.api.getSceneElements().find(element=>element.id===id);return {x:element.x,y:element.y};},original.id);
    assert.deepEqual(restored,{x:original.x,y:original.y});
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    await page.waitForFunction(position=>window.__slideMerge.api.getSceneElements().find(element=>element.id===position.id)?.x===position.x,{id:original.id,...moved});
  }finally{await browser.close();}
});

test('Slide Show automatically connects and supports fullscreen retry when browser activation is consumed', {timeout:45000}, async () => {
  const browser=await chromium.launch({executablePath,headless:true,ignoreDefaultArgs:['--disable-popup-blocking'],args:['--auto-select-tab-capture-source-by-title=DJ launch integration','--auto-accept-this-tab-capture']});
  const page=await browser.newPage();
  try {
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    await page.evaluate(()=>{document.title='DJ launch integration';});
    await page.getByRole('button',{name:'Slide Show',exact:true}).click();
    await page.waitForFunction(()=>window.documentPictureInPicture.window?.document.querySelector('[data-pp-status]')?.dataset.state==='live',null,{timeout:12000}).catch(async error=>{
      const diagnostic=await page.evaluate(()=>({title:document.title,pip:!!window.documentPictureInPicture.window,status:window.documentPictureInPicture.window?.document.querySelector('[data-pp-status]')?.outerHTML,notice:window.documentPictureInPicture.window?.document.querySelector('[data-pp-save]')?.textContent,fullscreen:!!document.fullscreenElement,activation:navigator.userActivation.isActive}));
      throw new Error(JSON.stringify(diagnostic),{cause:error});
    });
    if (!await page.evaluate(()=>!!document.fullscreenElement)) {
      const popup=page.context().pages().find(candidate=>candidate!==page);
      await popup.getByRole('button',{name:'Fullscreen audience',exact:true}).click();
      await page.waitForFunction(()=>!!document.fullscreenElement);
    }
    assert.equal(await page.evaluate(()=>document.fullscreenElement?.classList.contains('pjp')),true);
    await page.evaluate(()=>window.documentPictureInPicture.window.document.querySelector('[data-pp=exit]').click());
    await page.waitForSelector('.pjp',{state:'detached'});
    assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);
  } finally { await browser.close(); }
});

test('Single-click launch requires both fullscreen and the floating DJ pad', {timeout:30000,todo:'Chromium consumes the same user activation for fullscreen and Document PiP; neither request order satisfies this requirement.'}, async () => {
  const browser=await chromium.launch({executablePath,headless:true,ignoreDefaultArgs:['--disable-popup-blocking']});
  const page=await browser.newPage();
  try {
    await page.addInitScript(()=>{navigator.mediaDevices.getDisplayMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
    await page.goto(base+'/studio/slide-merge-lab/');
    await page.waitForFunction(()=>window.__slideMerge?.api&&!document.querySelector('.merge-layout-toggle').disabled);
    await page.getByRole('button',{name:'Slide Show',exact:true}).click();
    await page.waitForFunction(()=>!!window.documentPictureInPicture.window?.document.querySelector('[data-pp-notes]'));
    assert.equal(await page.evaluate(()=>document.fullscreenElement?.classList.contains('pjp')),true);
  } finally { await browser.close(); }
});