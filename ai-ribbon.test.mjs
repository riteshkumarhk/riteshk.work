import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { AI_REST_PATH, aiRibbonIcon, createMotion, liquidPoint, ribbonPath } from './src/js/ai-ribbon.mjs';

test('ribbon preserves the approved rest, varying counts, asynchronous depths and bounded continuity', () => {
  const radius = point => Math.hypot(point.horizontal - 12, point.vertical - 12);
  assert.ok(Math.abs(radius(liquidPoint(Math.PI / 4)) - 3.5) < 1e-10);
  for (const count of [3, 4, 5, 6]) {
    const foldWeights = [0, 0, 0, 0]; foldWeights[count - 3] = 1;
    const radii = Array.from({length: 960}, (_, index) => radius(liquidPoint(index * Math.PI / 480, {foldWeights})));
    const peaks = radii.filter((value, index) => value > radii[(index + 959) % 960] && value > radii[(index + 1) % 960]).length;
    assert.equal(peaks, count);
  }
  const motion = createMotion(), counts = new Set(), maxima = [];
  let prior, previousDepth = 0, beforeDepth = 0, opposed = 0;
  for (let frame = 0; frame < 3600; frame++) {
    const state = motion.step(1 / 60, 'answering');
    state.foldWeights.forEach((weight, index) => { if (weight > .999) counts.add(index + 3); });
    if (prior) {
      const changes = state.petalFolds.map((value, index) => value - prior.petalFolds[index]);
      assert.ok(changes.every(value => Math.abs(value) < .06));
      if (changes.some(value => value > .005) && changes.some(value => value < -.005)) opposed++;
    }
    if (frame > 120 && previousDepth > beforeDepth && previousDepth > state.fold) maxima.push(previousDepth);
    beforeDepth = previousDepth; previousDepth = state.fold;
    for (let index = 0; index < 96; index++) assert.ok(radius(liquidPoint(index * Math.PI / 48, state)) + .75 < 12);
    prior = state;
  }
  assert.deepEqual([...counts].sort(), [3, 4, 5, 6]);
  assert.ok(opposed > 100);
  assert.ok(Math.max(...maxima) - Math.min(...maxima) > .5);
  let rest;
  for (let frame = 0; frame < 300; frame++) rest = motion.step(1 / 60, 'idle');
  assert.equal(rest.angle, 0);
  assert.equal(ribbonPath(rest), AI_REST_PATH);
  assert.equal(ribbonPath(motion.step(1 / 60, 'answering', true)), AI_REST_PATH);
});

test('counter lifecycle keeps static actions still and stops on rest, hide, reduced motion and disposal', async () => {
  const source = await readFile(new URL('./src/js/ai-ribbon.mjs', import.meta.url), 'utf8');
  const css = await readFile(new URL('./css/admin.css', import.meta.url), 'utf8');
  const browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
  try {
    const page = await browser.newPage({reducedMotion: 'no-preference'});
    await page.setContent(`<style>${css}</style><button class="adm__ai-counter" data-ai-state="idle"><span class="adm__ai-spark">${aiRibbonIcon()}</span></button><button id="action">${aiRibbonIcon()}</button>`);
    await page.evaluate(() => {
      let identifier = 0;
      window.pending = new Map();
      window.requestAnimationFrame = callback => { const next = ++identifier; window.pending.set(next, callback); return next; };
      window.cancelAnimationFrame = identifier => window.pending.delete(identifier);
      window.advance = async (frames, repeat = false) => {
        for (let index = 0; index < frames; index++) {
          if (repeat) { document.querySelector('.adm__ai-counter').dataset.aiState = 'answering'; await Promise.resolve(); }
          const callbacks = [...window.pending.values()]; window.pending.clear();
          window.time = (window.time || 0) + 1000 / 60;
          callbacks.forEach(callback => callback(window.time));
        }
      };
    });
    await page.addScriptTag({type: 'module', content: source + '\nwindow.mountRibbon = mountAiRibbon; window.ribbon = mountAiRibbon(document.querySelector(".adm__ai-counter"));'});
    await page.waitForFunction(() => !!window.ribbon);
    const result = await page.evaluate(async () => {
      const counter = document.querySelector('.adm__ai-counter'), path = counter.querySelector('path'), group = counter.querySelector('g');
      await window.advance(2);
      const resting = path.getAttribute('d'), idleFrames = window.pending.size;
      counter.dataset.aiState = 'answering'; await Promise.resolve();
      await window.advance(180, true);
      const moving = path.getAttribute('d'), rotated = group.getAttribute('transform');
      const staticAction = document.querySelector('#action path').getAttribute('d');
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
      const hiddenFrames = window.pending.size;
      Object.defineProperty(document, 'hidden', {configurable: true, value: false});
      document.dispatchEvent(new Event('visibilitychange'));
      counter.dataset.aiState = 'idle'; await Promise.resolve();
      await window.advance(310);
      const settled = path.getAttribute('d'), restTurn = group.getAttribute('transform'), settledFrames = window.pending.size;
      counter.dataset.aiState = 'working'; await Promise.resolve(); await window.advance(30);
      window.ribbon.dispose();
      const disposedPath = path.getAttribute('d');
      counter.dataset.aiState = 'answering'; await Promise.resolve(); await window.advance(60);
      return {resting, moving, rotated, staticAction, idleFrames, hiddenFrames, settled, restTurn, settledFrames, disposedFrames: window.pending.size, unchangedAfterDispose: disposedPath === path.getAttribute('d')};
    });
    assert.equal(result.resting, AI_REST_PATH);
    assert.equal(result.staticAction, AI_REST_PATH);
    assert.notEqual(result.moving, AI_REST_PATH);
    assert.notEqual(result.rotated, 'rotate(0.0000 12 12)');
    assert.equal(result.settled, AI_REST_PATH);
    assert.equal(result.restTurn, 'rotate(0.0000 12 12)');
    for (const key of ['idleFrames', 'hiddenFrames', 'settledFrames', 'disposedFrames']) assert.equal(result[key], 0, key);
    assert.ok(result.unchangedAfterDispose);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(async () => { window.ribbon = window.mountRibbon(document.querySelector('.adm__ai-counter')); await window.advance(3); });
    assert.equal(await page.locator('.adm__ai-counter path').getAttribute('d'), AI_REST_PATH);
    assert.equal(await page.evaluate(() => window.pending.size), 0);
  } finally { await browser.close(); }
});