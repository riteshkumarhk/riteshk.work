import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const baseURL = process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test("slideshow content cannot be selected or edited directly or through the live preview", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--auto-select-tab-capture-source-by-title=Slide Merger Lab", "--auto-accept-this-tab-capture"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }));
    await page.addInitScript(() => { const capture=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);let first=true;navigator.mediaDevices.getDisplayMedia=(...args)=>{if(first){first=false;return Promise.reject(new DOMException('Denied','NotAllowedError'));}return capture(...args);}; });
    await page.goto(baseURL + "/studio/slide-merge-lab/");
    await page.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    const draft = await page.evaluate(() => JSON.stringify(window.__slideMerge.deck()));
    await page.evaluate(() => {
      window.readPresentation = () => {
        const canvas = document.querySelector(".pjp canvas.excalidraw__canvas.interactive");
        let fiber = canvas?.[Object.keys(canvas).find(key => key.startsWith("__reactFiber$"))];
        while (fiber) {
          const instance = fiber.stateNode;
          if (instance?.state?.selectedElementIds && instance.scene) return { state: instance.state, elements: instance.scene.getElementsIncludingDeleted() };
          fiber = fiber.return;
        }
        return null;
      };
    });
    const waiting = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Slide Show", exact: true }).click();
    await page.waitForFunction(() => window.readPresentation()?.elements.length > 0);
    const popup = await waiting;
    await popup.waitForSelector("[data-pp-live]");
    const snapshot = async () => {
      const result = await page.evaluate(() => {
      const { state, elements } = window.readPresentation();
      return { viewMode: state.viewModeEnabled, selected: state.selectedElementIds, groups: state.selectedGroupIds, editing: !!state.editingTextElement, elements: JSON.stringify(elements) };
      });
      result.elements = createHash("sha256").update(result.elements).digest("hex");
      return result;
    };
    const before = await snapshot();
    assert.equal(before.viewMode, true, "Scene restoration must not reset the slideshow to editor mode");
    const positions = await page.evaluate(() => {
      const { state, elements } = window.readPresentation();
      const bounds = document.querySelector(".merge-present-stage").getBoundingClientRect();
      return ["rectangle", "text"].map(type => {
        const element = elements.find(item => !item.locked && item.type === type);
        if (!element) throw new Error("Missing fixture " + type);
        return { x: bounds.left + (element.x + element.width / 3 + state.scrollX) * state.zoom.value, y: bounds.top + (element.y + element.height / 3 + state.scrollY) * state.zoom.value };
      });
    });
    async function attemptEditing(targetPage, position) {
      await targetPage.mouse.click(position.x, position.y);
      await targetPage.mouse.down();
      await targetPage.mouse.move(position.x + 100, position.y + 60, { steps: 8 });
      await targetPage.mouse.up();
      await targetPage.mouse.dblclick(position.x, position.y);
      await targetPage.keyboard.press("Delete");
      await targetPage.keyboard.type("readonly");
    }
    const initialFrame = await page.locator("[data-pjp-frame]").boundingBox();
    const initialPreview = await popup.locator("[data-pp-now]").boundingBox();
    const previewPoint = {
      x: initialPreview.x + (positions[0].x - initialFrame.x) / initialFrame.width * initialPreview.width,
      y: initialPreview.y + (positions[0].y - initialFrame.y) / initialFrame.height * initialPreview.height
    };
    await popup.mouse.move(previewPoint.x, previewPoint.y);
    await page.waitForFunction(() => document.querySelector(".pjp")?.dataset.pointer === "laser");
    const laser = await page.locator(".pjp__pointer").evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top), hidden: element.hidden }));
    assert.equal(laser.hidden, false);
    assert.ok(Math.abs(laser.x - positions[0].x) < 2 && Math.abs(laser.y - positions[0].y) < 2, "Unconnected thumbnail pointing must map to the audience shape");
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 0, "Pointing must not require capture permission");
    await popup.locator("[data-pp-notes]").hover();
    assert.equal(await page.locator(".pjp__pointer").isVisible(), false, "Moving onto notes must hide the audience pointer");
    for (const position of positions) await attemptEditing(page, position);
    assert.deepEqual(await snapshot(), before, "Direct slideshow input must not select, edit, delete or move content");
    await popup.locator("[data-pp-live]").click();
    await popup.waitForSelector("[data-pp-now] canvas");
    const frame = await page.locator("[data-pjp-frame]").boundingBox();
    const preview = await popup.locator("[data-pp-now] canvas").boundingBox();
    for (const position of positions) await attemptEditing(popup, { x: preview.x + (position.x - frame.x) / frame.width * preview.width, y: preview.y + (position.y - frame.y) / frame.height * preview.height });
    assert.deepEqual(await snapshot(), before, "Live-preview input must not alter content or selection");
    await page.screenshot({ path: join(tmpdir(), "rk-presenter-readonly.png") });
    await popup.locator('[data-pp="next"]').click();
    await page.waitForSelector('.pjp iframe[title="Native video"]');
    assert.equal((await snapshot()).viewMode, true, "Every slide stays in view mode");
    assert.deepEqual((await snapshot()).selected, {});
    const video = page.frameLocator('.pjp iframe[title="Native video"]').locator("video");
    await video.evaluate(element => element.play());
    await video.evaluate(element => new Promise(resolve => element.currentTime > 0 ? resolve() : element.addEventListener("timeupdate", resolve, { once: true })));
    assert.equal(await video.evaluate(element => element.paused), false);
    await video.evaluate(element => element.pause());
    assert.equal(await video.evaluate(element => element.paused), true);
    await popup.locator('[data-pp="prev"]').click();
    await page.waitForFunction(() => document.querySelector("[data-pjp-count]")?.textContent === "1 / 2");
    assert.equal((await snapshot()).viewMode, true);
    assert.deepEqual((await snapshot()).selected, {});
    await popup.locator("[data-pp-live]").click();
    await popup.locator('[data-pp="exit"]').click();
    await page.waitForSelector(".pjp", { state: "detached", timeout: 6000 }).catch(error => { throw new Error(JSON.stringify(errors), { cause: error }); });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__slideMerge.deck())), draft, "Rehearsal must leave the editable draft intact");
  } finally { await browser.close(); }
});