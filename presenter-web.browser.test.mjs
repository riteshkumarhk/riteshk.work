import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

await build({ entryPoints: [fileURLToPath(new URL("./tools/studio-presenter/fixture-entry.mjs", import.meta.url))], outfile: fileURLToPath(new URL("./tools/studio-presenter/fixture.bundle.js", import.meta.url)), bundle: true, format: "iife" });
const baseURL = process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

async function openFixture(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await page.addInitScript(() => Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }));
  await page.goto(baseURL + "/tools/studio-presenter/fixture.html");
  await page.click("#start");
  const waiting = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open presenter window", exact: true }).click();
  const popup = await waiting;
  await popup.waitForSelector("[data-pp-live]");
  return { page, popup };
}

async function pointFor(page, popup, selector) {
  const relative = await page.locator(selector).evaluate(element => {
    const bounds = element.getBoundingClientRect(), frame = document.querySelector("[data-pjp-frame]").getBoundingClientRect();
    return { x: (bounds.left + bounds.width / 2 - frame.left) / frame.width, y: (bounds.top + bounds.height / 2 - frame.top) / frame.height };
  });
  const canvas = await popup.locator("[data-pp-now] canvas").boundingBox();
  return { x: canvas.x + canvas.width * relative.x, y: canvas.y + canvas.height * relative.y };
}

test("real audience tab capture mirrors live pixels and forwards web controls", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--auto-select-tab-capture-source-by-title=Presenter integration fixture", "--auto-accept-this-tab-capture"] });
  try {
    const { page, popup } = await openFixture(browser);
    await popup.locator("[data-pp-live]").click();
    await popup.waitForSelector("[data-pp-now] canvas", { timeout: 15000 });
    assert.match(await popup.locator("[data-pp-status]").textContent(), /Live audience tab connected/);
    await page.evaluate(() => document.querySelector("#swatch").style.background = "rgb(20, 220, 60)");
    await popup.waitForFunction(() => {
      const canvas = document.querySelector("[data-pp-now] canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 80 && pixels[offset + 1] > 150 && pixels[offset + 2] < 120) return true;
      return false;
    }, null, { timeout: 10000 }).catch(async error => {
      await popup.screenshot({ path: join(tmpdir(), "rk-web-capture-failure.png") });
      const diagnostic = await popup.evaluate(() => {
        const video = document.querySelector("video"), canvas = document.querySelector("[data-pp-now] canvas");
        const track = video?.srcObject?.getVideoTracks()[0];
        return { visibility: document.visibilityState, video: video && { width: video.videoWidth, height: video.videoHeight, ready: video.readyState, time: video.currentTime, paused: video.paused }, track: track && { settings: track.getSettings(), muted: track.muted, identity: track.getCaptureHandle() }, canvas: canvas && { width: canvas.width, height: canvas.height, bounds: canvas.getBoundingClientRect().toJSON() } };
      });
      throw new Error(JSON.stringify(diagnostic), { cause: error });
    });
    const swatch = await pointFor(page, popup, "#swatch");
    await popup.mouse.move(swatch.x, swatch.y);
    await page.waitForFunction(() => document.querySelector(".pjp")?.dataset.pointer === "laser");
    for (const selector of ["#action", "#section", "#play"]) {
      const position = await pointFor(page, popup, selector);
      await popup.mouse.click(position.x, position.y);
    }
    assert.equal(await page.evaluate(() => window.fixture.clicks), 1);
    assert.equal(await page.locator("details").evaluate(element => element.open), true);
    await page.waitForFunction(() => !document.querySelector("video").paused);
    await popup.getByRole("button", { name: "Pause slide media", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video").paused);
    const range = await pointFor(page, popup, "#seek");
    await popup.mouse.click(range.x, range.y);
    const before = await page.locator("#seek").inputValue();
    await popup.keyboard.press("ArrowRight");
    assert.equal(Number(await page.locator("#seek").inputValue()), Number(before) + 1);
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "1 / 2");
    const embedded = await pointFor(page, popup, "iframe");
    await popup.mouse.click(embedded.x, embedded.y);
    assert.match(await popup.locator("[data-pp-status]").textContent(), /Embedded player/);
    await popup.locator('[data-pp="next"]').click();
    assert.equal(await popup.locator("[data-pp-notes]").textContent(), "Private second note");
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 1);
    await page.keyboard.press("p");
    assert.equal(await page.locator(".pjp--presenting").count(), 0);
    await popup.setViewportSize({ width: 1060, height: 720 });
    await popup.screenshot({ path: join(tmpdir(), "rk-web-presenter-live.png") });
    await popup.setViewportSize({ width: 390, height: 844 });
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await popup.screenshot({ path: join(tmpdir(), "rk-web-presenter-mobile.png") });
    await popup.locator("[data-pp-live]").click();
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 0);
    assert.match(await popup.locator("[data-pp-now]").textContent(), /Second slide/);
    await popup.locator('[data-pp="exit"]').click();
    await page.waitForSelector(".pjp", { state: "detached" });
  } finally { await browser.close(); }
});

test("capture denial preserves notes and thumbnail fallback", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page, popup } = await openFixture(browser);
    await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
    await popup.locator("[data-pp-live]").click();
    await popup.waitForFunction(() => document.querySelector("[data-pp-status]").textContent.includes("cancelled or denied"));
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 0);
    assert.equal(await popup.locator("[data-pp-notes]").textContent(), "Private first note");
    assert.equal(await popup.locator("[data-pp-live]").isEnabled(), true);
    await popup.locator('[data-pp="next"]').click();
    assert.match(await popup.locator("[data-pp-now]").textContent(), /Second slide/);
    await popup.close();
    await page.waitForFunction(() => !document.querySelector(".pjp").classList.contains("pjp--popped"));
  } finally { await browser.close(); }
});

test("wrong capture source and late permission result never enter the preview", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const { page, popup } = await openFixture(browser);
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        window.rejectedStream = canvas.captureStream(1);
        const track = window.rejectedStream.getVideoTracks()[0];
        track.getSettings = () => ({ displaySurface: "browser" });
        track.getCaptureHandle = () => ({ origin: location.origin, handle: "another-tab" });
        return window.rejectedStream;
      };
    });
    await popup.locator("[data-pp-live]").click();
    await popup.waitForFunction(() => document.querySelector("[data-pp-status]").textContent.includes("not another tab"));
    assert.equal(await page.evaluate(() => window.rejectedStream.getVideoTracks()[0].readyState), "ended");
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 0);
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => { window.resolveCapture = resolve; });
    });
    await popup.locator("[data-pp-live]").click();
    await page.waitForFunction(() => !!window.resolveCapture);
    await popup.close();
    await page.waitForFunction(() => !document.querySelector(".pjp").classList.contains("pjp--popped"));
    await page.evaluate(() => {
      window.lateStream = document.createElement("canvas").captureStream(1);
      window.resolveCapture(window.lateStream);
    });
    await page.waitForFunction(() => window.lateStream.getVideoTracks()[0].readyState === "ended");
  } finally { await browser.close(); }
});

test("always-on-top web presenter supports real live capture and stops on close", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--auto-select-tab-capture-source-by-title=Presenter integration fixture", "--auto-accept-this-tab-capture"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(baseURL + "/tools/studio-presenter/fixture.html");
    await page.click("#start");
    await page.getByRole("button", { name: "Open presenter window", exact: true }).click();
    await page.waitForFunction(() => window.documentPictureInPicture.window?.document.querySelector("[data-pp-live]"), null, { timeout: 6000 });
    const pointing = await page.evaluate(() => {
      const presenter = window.documentPictureInPicture.window;
      const surface = presenter.document.querySelector("[data-pp-now]");
      const preview = surface.getBoundingClientRect();
      const frame = document.querySelector("[data-pjp-frame]").getBoundingClientRect();
      const target = document.querySelector("#swatch").getBoundingClientRect();
      const x = target.left + target.width / 2, y = target.top + target.height / 2;
      surface.dispatchEvent(new presenter.PointerEvent("pointermove", { bubbles: true, clientX: preview.left + (x - frame.left) / frame.width * preview.width, clientY: preview.top + (y - frame.top) / frame.height * preview.height }));
      const pointer = document.querySelector(".pjp__pointer");
      return { expected: { x, y }, actual: { x: parseFloat(pointer.style.left), y: parseFloat(pointer.style.top) }, hidden: pointer.hidden, capturing: !!presenter.document.querySelector("[data-pp-now] canvas") };
    });
    assert.equal(pointing.hidden, false, "PiP pointing must work before connecting capture");
    assert.equal(pointing.capturing, false);
    assert.ok(Math.abs(pointing.actual.x - pointing.expected.x) < 1 && Math.abs(pointing.actual.y - pointing.expected.y) < 1);
    await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector("[data-pp-live]").click());
    await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector("[data-pp-now] canvas"), null, { timeout: 6000 }).catch(async error => {
      throw new Error(await page.evaluate(() => window.documentPictureInPicture.window.document.querySelector("[data-pp-status]").textContent), { cause: error });
    });
    assert.equal(await page.evaluate(() => window.documentPictureInPicture.window.matchMedia("(display-mode: picture-in-picture)").matches), true);
    await page.evaluate(() => { window.webCapture = window.documentPictureInPicture.window.document.querySelector("video").srcObject; });
    await page.evaluate(() => window.documentPictureInPicture.window.close());
    await page.waitForFunction(() => window.webCapture.getVideoTracks()[0].readyState === "ended", null, { timeout: 6000 });
  } finally { await browser.close(); }
});