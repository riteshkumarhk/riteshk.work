import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { availableStudies } from "./src/js/slide-merge-sections.mjs";
import { sectionComponentPlan } from "./src/js/slide-merge-section-component.mjs";

const baseURL = process.env.SLIDE_LAB_URL;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const enabled = !!baseURL && existsSync(executablePath);
const deckDigest = async page => createHash("sha256").update(await page.evaluate(() => JSON.stringify(window.__slideMerge.deck()))).digest("hex");
const denyCapture = () => { navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); };

test("native section renderer displays both before/after images and wires comparison", { skip: !enabled, timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(baseURL + "/404.html");
    await page.evaluate(() => {
      const image = document.createElement("canvas"); image.width = 640; image.height = 360;
      const context = image.getContext("2d"); context.fillStyle = "#bc294b"; context.fillRect(0, 0, 640, 360);
      const beforeSrc = image.toDataURL(); context.fillStyle = "#24b597"; context.fillRect(0, 0, 640, 360);
      window.comparisonSection = { type: "compare", heading: "Before and after", beforeSrc, afterSrc: image.toDataURL(), beforeLabel: "Before", afterLabel: "After" };
      const frame = document.createElement("iframe"); frame.id = "section-check"; frame.style.cssText = "width:1000px;height:700px;border:0";
      frame.src = "/studio/slide-lab/native.html?fixture=component";
      frame.onload = () => frame.contentWindow.postMessage({ type: "rk-section-component", block: window.comparisonSection, appearance: "dark" }, location.origin);
      document.body.replaceChildren(frame);
    });
    const frame = page.frameLocator("#section-check");
    await frame.locator(".pjb__cmp-base").waitFor();
    const media = await frame.locator(".pjb__cmp img").evaluateAll(images => images.map(image => ({ loaded: image.complete && image.naturalWidth > 0, height: image.getBoundingClientRect().height, src: image.getAttribute("src") })));
    assert.equal(media.length, 2);
    assert.ok(media.every(image => image.loaded && image.height > 20), JSON.stringify(media));
    await frame.locator(".pjb__cmp").click({ position: { x: 220, y: 100 } });
    assert.notEqual(await frame.locator(".pjb__cmp").evaluate(element => element.style.getPropertyValue("--pos")), "50%");
  } finally { await browser.close(); }
});

test("every section family renders as a complete native component", { skip: !enabled, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const types = ["text", "statement", "metrics", "steps", "media", "split", "faq", "cards", "cloud", "gallery", "figure", "columns", "rows", "compare", "stickies", "voices", "workflow", "mediagrid", "device", "isolayers", "focus", "gen"];
  const source = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  const representatives = new Map();
  for (const study of availableStudies(source)) for (const block of study.blocks) {
    try { sectionComponentPlan(block, String, "check", { customIcons: source.customIcons }); if (!representatives.has(block.type)) representatives.set(block.type, block); } catch {}
  }
  try {
    await page.goto(baseURL + "/404.html");
    const image = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360; const context = canvas.getContext("2d"); context.fillStyle = "#23a787"; context.fillRect(0, 0, 640, 360); return canvas.toDataURL(); });
    await page.evaluate(() => { const frame = document.createElement("iframe"); frame.id = "families"; frame.style.cssText = "width:1120px;height:720px;border:0"; frame.src = "/studio/slide-lab/native.html?fixture=component"; document.body.replaceChildren(frame); });
    const native = page.frameLocator("#families");
    await native.locator("#stage").waitFor({ state: "attached" });
    await page.waitForFunction(() => !!document.querySelector("#families").contentWindow.RK?.enhanceBlocks);
    for (const type of types) {
      const block = representatives.get(type) || { type, heading: `Sample ${type}`, body: "Complete section content", src: image, beforeSrc: image, afterSrc: image, left: "Before", right: "After", items: [{ title: "Item", heading: "Heading", label: "Label", text: "Content", body: "Details", value: "42%", src: image, q: "Question", a: "Answer", cells: [{ heading: "Cell", body: "Cell content", src: image }] }] };
      await page.evaluate(({ block, icons }) => document.querySelector("#families").contentWindow.postMessage({ type: "rk-section-component", block, icons, appearance: "dark" }, location.origin), { block, icons: source.customIcons });
      await native.locator(`#stage[data-component-type="${type}"] .pjb`).waitFor({ state: "attached", timeout: 8000 });
      const result = await native.locator("#stage").evaluate(stage => ({ type: stage.dataset.componentType, children: stage.querySelector(".pjb").childElementCount, height: stage.getBoundingClientRect().height, text: stage.textContent.slice(0, 100), images: stage.querySelectorAll("img").length }));
      assert.ok(result.children > 0 && result.height > 0 && Number.isFinite(result.height), JSON.stringify(result));
      if (type === "compare") {
        await native.locator(".pjb__cmp-base").evaluate(image => image.decode());
        assert.ok(await native.locator(".pjb__cmp-base").evaluate(image => image.naturalWidth > 0));
      }
    }
  } finally { await browser.close(); }
});

async function audienceOnly(page) {
  await page.waitForSelector('.pjp--popped');
  const windows = [];
  for (const candidate of page.context().pages()) if (candidate !== page && !candidate.isClosed() && await candidate.title() === 'Presenter DJ pad') windows.push(candidate);
  await page.evaluate(() => window.documentPictureInPicture?.window?.close());
  for (const candidate of windows) if (!candidate.isClosed()) await candidate.close();
  await page.waitForFunction(() => !document.querySelector('.pjp')?.classList.contains('pjp--popped'));
  await page.bringToFront();
  await page.evaluate(async () => { if(document.fullscreenElement)await document.exitFullscreen();document.querySelector('.pjp').focus(); });
}

test("shared presentation preserves canvas, navigation, private presenter window and cleanup", { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await context.addInitScript(() => Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }));
    await context.addInitScript(denyCapture);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(baseURL + "/studio/slide-merge-lab/");
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await page.evaluate(() => window.__slideMerge.choose("fidelity"));
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]")?.textContent === "2 / 2");
    await audienceOnly(page);
    const before = await deckDigest(page);
    assert.equal(await page.locator("#root").evaluate(element => element.inert), true);
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]")?.textContent === "1 / 2");
    await page.waitForFunction(() => [...document.querySelectorAll(".pjp canvas")].some(canvas => {
      const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) return false;
      const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 160) if (pixels[offset + 3]) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
      return colors.size > 10;
    }));
    await page.keyboard.press("p");
    await page.waitForSelector(".pjp--presenting");
    assert.match(await page.locator("[data-pjp-notes]").textContent(), /decision/);
    await page.waitForSelector("[data-pjp-nextthumb] svg", { state: "attached" });
    await page.waitForFunction(() => document.querySelector("[data-pjp-timer]")?.textContent !== "0:00");
    await page.locator('[data-pjp="timer-reset"]').click();
    assert.equal(await page.locator("[data-pjp-timer]").textContent(), "0:00");
    await page.screenshot({ path: join(tmpdir(), "rk-presenter-desktop.png") });
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Open presenter window", exact: true }).click();
    const popup = await popupPromise;
    popup.on("pageerror", error => errors.push(error.message));
    await popup.waitForSelector("[data-pp-now] svg", { state: "attached" });
    assert.equal(await popup.locator("[data-pp-count]").textContent(), "1 / 2");
    assert.equal(await page.locator(".pjp__present").evaluate(element => getComputedStyle(element).display), "none");
    assert.match(await popup.locator("[data-pp-notes]").textContent(), /decision/);
    await popup.locator('[data-pp="next"]').click();
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]")?.textContent === "2 / 2");
    assert.equal(await popup.locator("[data-pp-nexttitle]").textContent(), "End of deck");
    assert.equal(await popup.locator("[data-pp-next]").evaluate(element => getComputedStyle(element).display), "none");
    await page.keyboard.press("PageUp");
    await page.evaluate(() => document.querySelector('.pjp').focus());
    await page.keyboard.press("PageUp");
    await popup.waitForFunction(() => document.querySelector("[data-pp-count]")?.textContent === "1 / 2");
    await popup.locator('[data-pp="timer-reset"]').click();
    assert.equal(await page.locator("[data-pjp-timer]").textContent(), "0:00");
    await popup.screenshot({ path: join(tmpdir(), "rk-presenter-popup.png") });
    await popup.close();
    await page.waitForFunction(() => !document.querySelector(".pjp")?.classList.contains("pjp--popped"));
    await page.locator('[data-pjp-dot="1"]').click();
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "2 / 2");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".pjp", { state: "detached" });
    assert.equal(await page.locator("#root").evaluate(element => element.inert), false);
    assert.equal(await deckDigest(page), before, "Presenting must not modify the saved draft");
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    await page.waitForSelector(".pjp");
    await audienceOnly(page);
    const secondPopupPromise = page.waitForEvent("popup");
    await page.locator('[data-pjp="popout"]').click();
    const secondPopup = await secondPopupPromise;
    await secondPopup.locator('[data-pp="exit"]').click();
    await page.waitForSelector(".pjp", { state: "detached" });
    assert.equal(secondPopup.isClosed(), true);
    assert.equal(await page.locator("#root").evaluate(element => element.inert), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("production and experimental players share responsive presentation chrome", { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const lab = await context.newPage();
    await context.addInitScript(denyCapture);
  const production = await context.newPage();
  const chrome = page => page.evaluate(() => {
    const properties = ["width", "height", "padding", "borderRadius", "backgroundColor", "fontFamily", "fontSize", "display"];
    return Object.fromEntries([".pjp__frame", ".pjp__bar", ".pjp__x", ".pjp__progress", ".pjp__count", ".pjp__notesbtn", ".pjp__popbtn", ".pjp__present"].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, Object.fromEntries(properties.map(property => [property, style[property]]))];
    }));
  });
  try {
    await lab.goto(baseURL + "/studio/slide-merge-lab/");
    await lab.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await lab.getByRole("button", { name: "Slide Show", exact: true }).click();
    await lab.waitForSelector(".pjp");
    await audienceOnly(lab);
    await production.goto(baseURL + "/studio/?devstub");
    await production.waitForFunction(() => !!window.RK?.presentDeck);
    const sample = await lab.evaluate(() => window.__slideMerge.deck().slides.map(slide => ({ layout: "title", slots: { title: slide.title }, notes: slide.notes })));
    await production.evaluate(slides => {
      document.documentElement.dataset.appearance = "light";
      window.RK.presentDeck({}, { slides });
    }, sample);
    for (const width of [1280, 390, 320]) {
      await lab.setViewportSize({ width, height: 800 });
      await production.setViewportSize({ width, height: 800 });
      assert.deepEqual(await chrome(lab), await chrome(production), `Chrome parity at ${width}px`);
      await lab.keyboard.press("p");
      await production.keyboard.press("p");
      assert.deepEqual(await chrome(lab), await chrome(production), `Notes layout parity at ${width}px`);
      await lab.keyboard.press("p");
      await production.keyboard.press("p");
      assert.equal(await lab.locator(".pjp .App-toolbar-container:visible, .pjp .App-bottom-bar:visible, .pjp .App-menu_top:visible").count(), 0, `No editing controls at ${width}px`);
    }
    await lab.setViewportSize({ width: 390, height: 844 });
    await lab.screenshot({ path: join(tmpdir(), "rk-presenter-mobile.png") });
    await production.keyboard.press("End");
    assert.equal(await production.locator("[data-pjp-count]").textContent(), "2 / 2");
    await production.keyboard.press("Home");
    assert.equal(await production.locator("[data-pjp-count]").textContent(), "1 / 2");
    await production.locator('[data-pjp="popout"]').click();
    await production.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector("[data-pp-count]")?.textContent === "1 / 2");
    assert.equal(await production.evaluate(() => window.documentPictureInPicture.window.matchMedia("(display-mode: picture-in-picture)").matches), true);
    await production.evaluate(() => window.documentPictureInPicture.window.close());
    await production.evaluate(() => document.querySelectorAll(".pass").forEach(dialog => dialog.remove()));
    await production.keyboard.press("Escape");
    await production.waitForSelector(".pjp", { state: "detached" });
  } finally {
    await browser.close();
  }
});

test("canvas presentation retains media and all transition modes while skipping hidden slides", { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
    await page.addInitScript(denyCapture);
  try {
    await page.goto(baseURL + "/studio/slide-merge-lab/");
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await page.evaluate(async () => {
      await window.__slideMerge.save();
      const deck = window.__slideMerge.deck();
      const original = deck.slides[0];
      original.hidden = true;
      deck.slides = [original, ...["none", "fade", "push", "magic"].map((transition, index) => {
        const slide = structuredClone(original);
        slide.id = transition; slide.hidden = false;
        const frame = slide.scene.elements.find(element => element.id === "lab-slide");
        frame.customData = { ...frame.customData, slideSettings: { transition } };
        slide.scene.elements.find(element => element.id === "title").x += index * 60;
        return slide;
      }), deck.slides[1]];
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("rk-slide-merge-lab-v1", 1);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("decks", "readwrite");
          transaction.objectStore("decks").put(deck, "draft");
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    });
    await page.reload();
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]")?.textContent === "1 / 5");
    await audienceOnly(page);
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".pjp canvas.excalidraw__canvas.static");
      if (!canvas?.width) return false;
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 160) if (pixels[offset + 3]) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
      return colors.size > 10;
    });
    const before = await deckDigest(page);
    for (const property of ["opacity", "transform"]) {
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(key => document.querySelector(".merge-present-engine")?.getAnimations().some(animation => animation.effect.getKeyframes().some(frame => key in frame)), property);
      await page.locator(".merge-present-engine").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    }
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]")?.textContent === "4 / 5");
    await page.evaluate(() => new Promise(resolve => {
      const start = performance.now();
      const settle = now => now - start > 600 ? resolve() : requestAnimationFrame(settle);
      requestAnimationFrame(settle);
    }));
    const pixels = () => page.locator(".pjp canvas.excalidraw__canvas.static").evaluate(canvas => canvas.toDataURL());
    const frameBefore = createHash("sha256").update(await pixels()).digest("hex");
    await page.locator(".merge-present-stage").hover();
    await page.mouse.wheel(200, 350);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(createHash("sha256").update(await pixels()).digest("hex"), frameBefore, "Wheel must not pan the presentation");
    await page.keyboard.press("End");
    await page.waitForSelector('.pjp iframe[title="Native video"]');
    const video = page.frameLocator('.pjp iframe[title="Native video"]').locator("video");
    await video.evaluate(element => element.play());
    await video.evaluate(element => new Promise(resolve => {
      if (element.currentTime > 0) resolve();
      else element.addEventListener("timeupdate", resolve, { once: true });
    }));
    assert.equal(await video.evaluate(element => element.paused), false);
    await page.screenshot({ path: join(tmpdir(), "rk-presenter-media.png") });
    await page.locator('[data-pjp="exit"]').click();
    await page.waitForSelector(".pjp", { state: "detached" });
    assert.equal(await deckDigest(page), before);
  } finally {
    await browser.close();
  }
});

test("native always-on-top presenter survives audience focus and synchronizes controls", { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.addInitScript(denyCapture);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(baseURL + "/studio/slide-merge-lab/");
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    assert.equal(await page.evaluate(() => typeof window.documentPictureInPicture?.requestWindow), "function");
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    await page.locator('[data-pjp="popout"]').click();
    await page.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector("[data-pp-now] svg"));
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window.document.documentElement.dataset.presenterWindow), "always-on-top");
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window.matchMedia("(display-mode: picture-in-picture)").matches), true);
    const layout = await page.evaluate(() => {
      const floating = window.documentPictureInPicture.window;
      return { width: floating.innerWidth, height: floating.innerHeight, controls: ["[data-pp-notes]", "[data-pp-timer]", '[data-pp="next"]', '[data-pp="exit"]'].map(selector => {
        const rect = floating.document.querySelector(selector).getBoundingClientRect();
        return { selector, fits: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= floating.innerHeight && rect.right <= floating.innerWidth };
      }) };
    });
    assert.equal(layout.controls.every(control => control.fits), true, JSON.stringify(layout));
    const floatingPage = page.context().pages().find(candidate => candidate !== page);
    if (floatingPage) await floatingPage.screenshot({ path: join(tmpdir(), "rk-presenter-always-on-top.png") });
    await page.bringToFront();
    await page.evaluate(() => document.querySelector('[data-pjp="next"]').click());
    await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector("[data-pp-count]").textContent === "2 / 2");
    await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[data-pp="prev"]').click());
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]").textContent === "1 / 2");
    await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[data-pp="timer-reset"]').click());
    assert.equal(await page.locator("[data-pjp-timer]").textContent(), "0:00");
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window.closed), false);
    await page.evaluate(() => window.documentPictureInPicture.window.close());
    await page.waitForFunction(() => !document.querySelector(".pjp").classList.contains("pjp--popped"));
    await page.locator('[data-pjp="popout"]').click();
    await page.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector('[data-pp="exit"]'));
    await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('[data-pp="exit"]').click());
    await page.waitForSelector(".pjp", { state: "detached" });
    assert.equal(await page.evaluate(() => !window.documentPictureInPicture.window || window.documentPictureInPicture.window.closed), true);
    assert.equal(await page.locator("#root").evaluate(element => element.inert), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("denied and pending floating-window requests recover safely", { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.addInitScript(denyCapture);
  try {
    await page.goto(baseURL + "/studio/slide-merge-lab/");
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await page.evaluate(() => Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: { requestWindow: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) } }));
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForSelector("[data-pp-count]");
    assert.equal(await popup.evaluate(() => document.documentElement.dataset.presenterWindow), "popup");
    await popup.locator('[data-pp="exit"]').click();
    await page.waitForSelector(".pjp", { state: "detached" });
    await page.evaluate(() => {
      window.__pipAttempts = 0;
      window.documentPictureInPicture.requestWindow = () => { window.__pipAttempts++; return new Promise(resolve => { window.__resolvePip = resolve; }); };
    });
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    await page.locator('[data-pjp="popout"]').click();
    await page.locator('[data-pjp="popout"]').click();
    assert.equal(await page.evaluate(() => window.__pipAttempts), 1);
    await page.locator('[data-pjp="exit"]').click();
    await page.waitForSelector(".pjp", { state: "detached" });
    await page.evaluate(() => window.__resolvePip({ close: () => { window.__latePipClosed = true; } }));
    await page.waitForFunction(() => window.__latePipClosed);
    assert.equal(await page.locator(".pjp").count(), 0);
    assert.equal(await page.locator("#root").evaluate(element => element.inert), false);
  } finally { await browser.close(); }
});