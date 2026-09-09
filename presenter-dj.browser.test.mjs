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
    await page.getByRole('button',{name:'Time budget for slide 1',exact:true}).click();
    await page.getByRole('spinbutton',{name:'Slide time budget in minutes'}).fill('2');
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

test('Slide Show automatically connects and supports fullscreen retry when browser activation is consumed', {timeout:45000}, async () => {
  const browser=await chromium.launch({executablePath,headless:true,args:['--auto-select-tab-capture-source-by-title=DJ launch integration','--auto-accept-this-tab-capture']});
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