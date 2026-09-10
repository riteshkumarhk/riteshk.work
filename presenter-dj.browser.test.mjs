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
    assert.equal(await popup.locator('[data-pp-notes]').inputValue(),'Notes edited privately during rehearsal');
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