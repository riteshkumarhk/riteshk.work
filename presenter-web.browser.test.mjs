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
  const bounds = await (typeof selector === "string" ? page.locator(selector) : selector).boundingBox();
  const frame = await page.locator("[data-pjp-frame]").evaluate(frame => (document.fullscreenElement && frame.contains(document.fullscreenElement) ? document.fullscreenElement : frame).getBoundingClientRect().toJSON());
  const relative = { x: (bounds.x + bounds.width / 2 - frame.x) / frame.width, y: (bounds.y + bounds.height / 2 - frame.y) / frame.height };
  const canvas = await popup.locator("[data-pp-now] canvas").boundingBox();
  return { x: canvas.x + canvas.width * relative.x, y: canvas.y + canvas.height * relative.y };
}

test("real audience tab capture mirrors live pixels and forwards web controls", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--auto-select-tab-capture-source-by-title=Presenter integration fixture", "--auto-accept-this-tab-capture"] });
  try {
    const { page, popup } = await openFixture(browser);
    await popup.locator("[data-pp-live]").click();
    await popup.waitForSelector("[data-pp-now] canvas", { timeout: 15000 });
    assert.equal(await popup.locator("[data-pp-status]").getAttribute("data-state"), "live");
    assert.equal(await popup.locator("[data-pp-live]").textContent(), "");
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
    assert.equal(await popup.locator(".pjp__pointer").isHidden(), true, "live pixels must not get a second laser overlay");
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
    assert.match(await popup.locator("[data-pp-now]").textContent(), /Second slide/, "The fallback thumbnail must track slide changes even while capture is live");
    await popup.evaluate(() => Object.defineProperty(document.querySelector("video").srcObject.getVideoTracks()[0], "muted", { value: true, configurable: true }));
    await popup.waitForFunction(() => document.querySelector("[data-pp-now] canvas").style.visibility === "hidden");
    assert.equal(await popup.locator("[data-pp-now] [data-pp-thumbnail]").isVisible(), true, "Interrupted capture must expose the complete current thumbnail");
    await popup.evaluate(() => { delete document.querySelector("video").srcObject.getVideoTracks()[0].muted; });
    await popup.waitForFunction(() => document.querySelector("[data-pp-now] canvas").style.visibility === "visible");
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

test("laser glides without overshoot, leaves a bounded fading trail and respects reduced motion", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  async function pointAt(selector, fraction = 0.5) {
    const position = await page.locator(selector).evaluate((element, fraction) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.left + bounds.width * fraction, y: bounds.top + bounds.height / 2 };
    }, fraction);
    await page.evaluate(position => document.querySelector(".pjp").dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: position.x, clientY: position.y })), position);
    return position;
  }
  async function laserState() {
    return page.evaluate(() => {
      const pointer = document.querySelector(".pjp__pointer"), canvas = pointer.querySelector("canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0, left = canvas.width, right = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] > 20) {
        painted++; const column = ((offset - 3) / 4) % canvas.width;
        left = Math.min(left, column); right = Math.max(right, column);
      }
      return { x: parseFloat(pointer.style.left), y: parseFloat(pointer.style.top), hidden: pointer.hidden, painted, trailWidth: painted ? (right - left) / (canvas.width / 160) : 0 };
    });
  }
  try {
    await page.goto(baseURL + "/tools/studio-presenter/fixture.html");
    await page.click("#start");
    await page.locator("#swatch").click({ trial: true });
    await page.clock.install({ time: new Date("2026-09-10T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-09-10T12:00:01Z"));
    await page.evaluate(() => document.querySelector(".pjp").dispatchEvent(new PointerEvent("pointerleave")));
    const start = await pointAt("#swatch", 0.1);
    assert.ok(Math.abs((await laserState()).x - start.x) < 0.01, "entry must be immediate");
    const target = await pointAt("#swatch", 0.9);
    assert.ok(Math.abs((await laserState()).x - start.x) < 0.01, "movement should be frame-timed");
    await page.clock.runFor(32);
    const moving = await laserState();
    assert.ok(moving.x > start.x && moving.x < target.x, "easing must approach the target without overshooting");
    assert.ok(moving.painted > 0 && moving.trailWidth <= 70, "the trail must be visible and short");
    await page.screenshot({ path: join(tmpdir(), "rk-laser-moving.png") });
    await page.clock.runFor(400);
    const settled = await laserState();
    assert.ok(Math.abs(settled.x - target.x) < 0.1);
    assert.equal(settled.painted, 0, "the tail must completely disappear at rest");
    await pointAt("#action");
    assert.equal((await laserState()).hidden, true, "local controls must retain their native cursor");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await pointAt("#swatch", 0.2);
    await pointAt("#swatch", 0.8);
    assert.ok((await laserState()).x > reduced.x);
    assert.equal((await laserState()).painted, 0);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.clock.runFor(300);
    assert.equal((await laserState()).hidden, true);
    await page.keyboard.press("Escape");
    await page.clock.runFor(300);
    assert.equal(await page.locator(".pjp__pointer").count(), 0);
  } finally { await browser.close(); }
});

test("DJ thumbnail shares the laser and clears it on navigation without capture", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, ignoreDefaultArgs: ["--disable-popup-blocking"] });
  try {
    const { page, popup } = await openFixture(browser);
    const relative = await page.locator("#swatch").evaluate(element => {
      const bounds = element.getBoundingClientRect(), frame = document.querySelector("[data-pjp-frame]").getBoundingClientRect();
      return { x: (bounds.left + bounds.width / 2 - frame.left) / frame.width, y: (bounds.top + bounds.height / 2 - frame.top) / frame.height };
    });
    const preview = await popup.locator("[data-pp-now]").boundingBox();
    await popup.mouse.move(preview.x + preview.width * relative.x, preview.y + preview.height * relative.y);
    await page.waitForFunction(() => document.querySelector(".pjp")?.dataset.pointer === "laser");
    assert.equal(await popup.locator(".pjp__pointer").isVisible(), true);
    assert.equal(await popup.locator(".pjp__pointer-trail").count(), 1);
    assert.match(await popup.locator(".pjp__pointer").evaluate(element => getComputedStyle(element, "::after").backgroundImage), /radial-gradient/);
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 0);
    await popup.evaluate(() => document.querySelector('[data-pp="next"]').click());
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "2 / 2");
    assert.equal(await popup.locator(".pjp__pointer").isHidden(), true);
    assert.equal(await page.locator(".pjp__pointer").isHidden(), true);
  } finally { await browser.close(); }
});

test("DJ input reaches native section controls while ordinary section content keeps the laser", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, ignoreDefaultArgs: ["--disable-popup-blocking"], args: ["--auto-select-tab-capture-source-by-title=Presenter integration fixture", "--auto-accept-this-tab-capture"] });
  try {
    const { page, popup } = await openFixture(browser);
    await page.evaluate(() => {
      const image = document.createElement("canvas"); image.width = 640; image.height = 360;
      const context = image.getContext("2d"); context.fillStyle = "#ba284a"; context.fillRect(0, 0, 640, 360);
      const beforeSrc = image.toDataURL(); context.fillStyle = "#21b69a"; context.fillRect(0, 0, 640, 360);
      const block = { type: "compare", heading: "A section heading", beforeSrc, afterSrc: image.toDataURL() };
      const embedded = document.createElement("iframe"); embedded.dataset.section = "compare";
      embedded.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
      embedded.onload = () => embedded.contentWindow.postMessage({ type: "rk-section-component", block, appearance: "dark" }, location.origin);
      embedded.src = "/studio/slide-lab/native.html?fixture=component";
      document.querySelector("[data-pjp-frame]").replaceChildren(embedded);
    });
    const section = page.frameLocator('iframe[data-section="compare"]');
    await section.locator(".pjb__cmp-base").evaluate(image => image.decode());
    await popup.locator("[data-pp-live]").click();
    await popup.locator("[data-pp-now] canvas").waitFor();
    const audience = await page.locator("[data-pjp-frame]").boundingBox();
    const preview = await popup.locator("[data-pp-now]").boundingBox();
    const previewPoint = bounds => ({ x: preview.x + (bounds.x + bounds.width / 2 - audience.x) / audience.width * preview.width, y: preview.y + (bounds.y + bounds.height / 2 - audience.y) / audience.height * preview.height });
    const heading = previewPoint(await section.locator(".pjb__h").boundingBox());
    await popup.mouse.move(heading.x, heading.y);
    assert.equal(await page.locator(".pjp").getAttribute("data-pointer"), "laser", "An iframe's noninteractive text is still laser content");
    const grip = previewPoint(await section.locator("[data-cmp]").boundingBox());
    await popup.mouse.move(grip.x, grip.y);
    assert.equal(await page.locator(".pjp").getAttribute("data-pointer"), "control");
    await popup.mouse.down(); await popup.mouse.move(grip.x + preview.width * 0.15, grip.y, { steps: 8 }); await popup.mouse.up();
    assert.ok(await section.locator(".pjb__cmp").evaluate(element => parseFloat(element.style.getPropertyValue("--pos"))) > 60, "DJ drag must change the actual audience comparison");
    await popup.mouse.move(heading.x, heading.y);
    assert.equal(await page.locator(".pjp").getAttribute("data-pointer"), "laser");
    assert.doesNotMatch(await popup.locator("[data-pp-status]").textContent(), /use its controls directly/);
    await section.locator(".pjb__h").hover();
    assert.equal(await page.locator(".pjp").getAttribute("data-pointer"), "laser", "Direct audience pointing must also descend into section documents");
    assert.equal(await section.locator(".pjb__h").evaluate(element => getComputedStyle(element).cursor), "none");
    await popup.mouse.move(grip.x, grip.y); await popup.mouse.down();
    await popup.mouse.move(grip.x + 25, grip.y, { steps: 4 });
    await popup.locator("[data-pp-now] canvas").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
    const cancelled = await section.locator(".pjb__cmp").evaluate(element => element.style.getPropertyValue("--pos"));
    await popup.mouse.move(grip.x - 60, grip.y, { steps: 4 });
    assert.equal(await section.locator(".pjb__cmp").evaluate(element => element.style.getPropertyValue("--pos")), cancelled, "Cancelled gestures must release the section's document-level drag handler");
    await popup.mouse.up();
    await page.locator('iframe[data-section="compare"]').evaluate(frame => { frame.style.inset = "15%"; frame.style.width = "70%"; frame.style.height = "70%"; frame.style.transform = "rotate(17deg) scale(0.85)"; });
    const rotatedGrip = previewPoint(await section.locator("[data-cmp]").boundingBox());
    await popup.mouse.move(rotatedGrip.x, rotatedGrip.y); await popup.mouse.down();
    await popup.mouse.move(rotatedGrip.x + 40, rotatedGrip.y + 12, { steps: 6 }); await popup.mouse.up();
    assert.ok(await section.locator(".pjb__cmp").evaluate(element => parseFloat(element.style.getPropertyValue("--pos"))) > parseFloat(cancelled) + 5, "Rotated and scaled sections must receive coordinates in their own viewport");
  } finally { await browser.close(); }
});

test("DJ forwards native gallery, annotation, generated gestures and nested media controls", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--auto-select-tab-capture-source-by-title=Presenter integration fixture", "--auto-accept-this-tab-capture"] });
  try {
    const { page, popup } = await openFixture(browser);
    await page.evaluate(() => {
      const embedded = document.createElement("iframe"); embedded.id = "section-controls";
      embedded.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
      embedded.src = "/studio/slide-lab/native.html?fixture=component";
      document.querySelector("[data-pjp-frame]").replaceChildren(embedded);
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext("2d"); context.fillStyle = "#25bba0"; context.fillRect(0, 0, 640, 360);
      window.sectionImage = canvas.toDataURL();
    });
    await page.waitForFunction(() => !!document.querySelector("#section-controls").contentWindow.RK?.renderSectionComponent);
    const section = page.frameLocator("#section-controls");
    async function render(block) {
      await page.evaluate(block => {
        const replace = value => Array.isArray(value) ? value.map(replace) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)])) : value === "$image" ? window.sectionImage : value;
        document.querySelector("#section-controls").contentWindow.RK.renderSectionComponent({ block: replace(block), appearance: "dark" });
      }, block);
      await section.locator(`#stage[data-component-type="${block.type}"]`).waitFor();
    }
    async function position(locator) {
      return pointFor(page, popup, locator);
    }
    async function click(locator) { const point = await position(locator); await popup.mouse.click(point.x, point.y); }
    await render({ type: "gallery", heading: "Gallery content", items: Array.from({ length: 4 }, (_, index) => ({ src: "$image", caption: "Image " + index })) });
    await popup.locator("[data-pp-live]").click(); await popup.locator("[data-pp-now] canvas").waitFor();
    await section.locator(".pjb__gallery img").first().evaluate(image => image.decode());
    await section.locator(".pjb__gallery img").first().click({ trial: true });
    await click(section.locator(".pjb__gallery img").first());
    await section.locator(".pjx.is-open").waitFor();
    await page.waitForFunction(() => !!document.fullscreenElement);
    const lightboxPoint = await position(section.locator('[data-lz="in"]')), lightboxPreview = await popup.locator("[data-pp-now]").boundingBox();
    assert.ok(lightboxPoint.x >= lightboxPreview.x && lightboxPoint.x <= lightboxPreview.x + lightboxPreview.width && lightboxPoint.y >= lightboxPreview.y && lightboxPoint.y <= lightboxPreview.y + lightboxPreview.height, JSON.stringify({ point: lightboxPoint, preview: lightboxPreview, audience: await page.evaluate(() => ({ fullscreen: document.fullscreenElement?.tagName, frame: document.querySelector("[data-pjp-frame]").getBoundingClientRect().toJSON() })) }));
    await click(section.locator('[data-lz="in"]'));
    await popup.keyboard.press("Escape");
    assert.equal(await section.locator(".pjx.is-open").count(), 0, "Escape must close the section lightbox without ending the deck");
    await section.locator(".pjx").waitFor({ state: "hidden" });
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator(".pjp").count(), 1);
    await click(section.locator(".pjb__gallery-nav--next"));
    await page.waitForFunction(() => document.querySelector("#section-controls").contentDocument.querySelector("[data-gallery]").scrollLeft > 10, null, { timeout: 4000 });
    assert.ok(await section.locator("[data-gallery]").evaluate(gallery => gallery.scrollLeft) > 10);
    await render({ type: "focus", heading: "Annotation content", src: "$image", sticky: true, annotations: [{ x: 50, y: 50, title: "Actual annotation", body: "The audience's note" }] });
    await click(section.locator('[data-focus-mark="0"]'));
    assert.equal(await section.locator('[data-focus-card="0"]').isVisible(), true);
    await click(section.locator("[data-focus-close]"));
    assert.equal(await section.locator('[data-focus-card="0"]').isVisible(), false);
    await click(section.locator('[data-focus-note="0"]'));
    await popup.keyboard.press("Enter");
    assert.equal(await section.locator('[data-focus-card="0"]').isVisible(), false, "Native keyboard handlers must receive their own events without duplicate activation");
    await render({ type: "faq", heading: "Static questions", items: [{ q: "A static question", a: "A static answer" }] });
    const question = await position(section.locator(".pjb__q")); await popup.mouse.move(question.x, question.y);
    assert.equal(await page.locator(".pjp").getAttribute("data-pointer"), "laser");
    await render({ type: "gen", heading: "Interactive generated section", spec: { version: 2, root: { type: "showpiece", children: [{ type: "card", fx: "orbit", style: "width:500px;height:280px;background:#248c79", children: [{ type: "text", text: "Drag, zoom and reset" }] }] } } });
    const orbit = section.locator('[data-rk-fx="orbit"]'), orbitPosition = await position(orbit), rest = await orbit.evaluate(element => element.style.transform);
    await popup.mouse.move(orbitPosition.x, orbitPosition.y);
    assert.equal(await page.locator(".pjp").getAttribute("data-pointer"), "control");
    await popup.mouse.down(); await popup.mouse.move(orbitPosition.x + 35, orbitPosition.y + 10, { steps: 6 }); await popup.mouse.up();
    assert.notEqual(await orbit.evaluate(element => element.style.transform), rest);
    const beforeZoom = await orbit.evaluate(element => element.style.transform);
    await popup.mouse.wheel(0, -90);
    await page.waitForFunction(before => document.querySelector("#section-controls").contentDocument.querySelector('[data-rk-fx="orbit"]').style.transform !== before, beforeZoom, { timeout: 4000 });
    assert.notEqual(await orbit.evaluate(element => element.style.transform), beforeZoom);
    const reset = await position(orbit); await popup.mouse.dblclick(reset.x, reset.y);
    assert.equal(await orbit.evaluate(element => element.style.transform), rest);
    await render({ type: "gen", heading: "Hover effect", spec: { version: 2, root: { type: "showpiece", children: [{ type: "card", fx: "tilt", style: "width:500px;height:280px;background:#248c79", children: [{ type: "text", text: "A hover response" }] }] } } });
    const tilt = section.locator('[data-rk-fx="tilt"]'), tiltRest = await tilt.evaluate(element => element.style.transform), tiltPoint = await position(tilt);
    await popup.mouse.move(tiltPoint.x + 25, tiltPoint.y + 10);
    assert.notEqual(await tilt.evaluate(element => element.style.transform), tiltRest);
    const away = await position(section.locator(".pjb__h")); await popup.mouse.move(away.x, away.y);
    assert.equal(await tilt.evaluate(element => element.style.transform), tiltRest, "Hover leave must reach the actual generated effect");
    await page.route("https://section-media.test/sample.webm", route => route.fulfill({ path: fileURLToPath(new URL("./studio/slide-lab/motion.webm", import.meta.url)), contentType: "video/webm" }));
    await render({ type: "media", heading: "Native video", items: [{ kind: "video", controls: true, src: "https://section-media.test/sample.webm" }] });
    await section.locator("video").evaluate(video => { video.muted = true; });
    await popup.getByRole("button", { name: "Play slide media", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#section-controls").contentDocument.querySelector("video").paused, null, { timeout: 4000 });
    assert.equal(await section.locator("video").evaluate(video => video.paused), false);
    await popup.getByRole("button", { name: "Pause slide media", exact: true }).click();
    assert.equal(await section.locator("video").evaluate(video => video.paused), true);
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "1 / 2");
  } finally { await browser.close(); }
});

test("nested section documents retain control semantics, event realms and scrolling", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--auto-select-tab-capture-source-by-title=Presenter integration fixture", "--auto-accept-this-tab-capture"] });
  try {
    const { page, popup } = await openFixture(browser);
    await page.evaluate(() => {
      const outer = document.createElement("iframe"); outer.id = "outer"; outer.style.cssText = "position:absolute;left:100px;top:40px;width:800px;height:450px;border:3px solid;transform:rotate(-12deg) scale(.9)";
      outer.srcdoc = '<!doctype html><body style="margin:0;background:#ddd"><iframe id="inner" style="position:absolute;left:70px;top:55px;width:600px;height:320px;border:5px solid;transform:scale(.9)"></iframe></body>';
      outer.onload = () => { outer.contentDocument.querySelector("#inner").srcdoc = '<!doctype html><style>body{margin:15px;background:#eee}button,summary{padding:15px}#scroll{width:260px;height:65px;overflow:auto}#scroll>div{width:700px;height:500px;background:#25b598}</style><button id="disabled" disabled>Unavailable</button><button id="action">Nested action</button><details><summary>Details</summary>Expanded</details><input type="range" min="0" max="100" value="20" aria-label="Nested range"><div id="scroll"><div>Scroll this content</div></div>'; };
      document.querySelector("[data-pjp-frame]").replaceChildren(outer);
    });
    const inner = page.frameLocator("#outer").frameLocator("#inner");
    await inner.locator("#action").evaluate(element => {
      const view = element.ownerDocument.defaultView;
      view.actionClicks = 0; view.disabledClicks = 0; view.realmCorrect = true;
      element.addEventListener("click", event => { view.actionClicks++; view.realmCorrect &&= event instanceof view.MouseEvent; });
      element.ownerDocument.querySelector("#disabled").addEventListener("click", () => view.disabledClicks++);
      element.ownerDocument.addEventListener("pointerdown", event => { view.realmCorrect &&= event instanceof view.PointerEvent; });
      element.ownerDocument.addEventListener("keydown", event => { view.realmCorrect &&= event instanceof view.KeyboardEvent; });
    });
    await popup.locator("[data-pp-live]").click(); await popup.locator("[data-pp-now] canvas").waitFor();
    for (const selector of ["#disabled", "#action", "summary", 'input[type="range"]']) {
      const point = await pointFor(page, popup, inner.locator(selector)); await popup.mouse.click(point.x, point.y);
    }
    const state = await inner.locator("body").evaluate(element => ({ clicks: element.ownerDocument.defaultView.actionClicks, disabled: element.ownerDocument.defaultView.disabledClicks, open: element.querySelector("details").open }));
    assert.deepEqual(state, { clicks: 1, disabled: 0, open: true });
    const range = Number(await inner.locator("input").inputValue());
    await popup.keyboard.press("ArrowRight");
    assert.equal(Number(await inner.locator("input").inputValue()), range + 1);
    assert.equal(await inner.locator("body").evaluate(element => element.ownerDocument.defaultView.realmCorrect), true);
    const scroll = await pointFor(page, popup, inner.locator("#scroll")); await popup.mouse.move(scroll.x, scroll.y); await popup.mouse.wheel(45, 90);
    await page.waitForFunction(() => document.querySelector("#outer").contentDocument.querySelector("#inner").contentDocument.querySelector("#scroll").scrollTop > 0, null, { timeout: 4000 });
    assert.ok(await inner.locator("#scroll").evaluate(element => element.scrollLeft > 0 && element.scrollTop > 0));
    assert.equal(await page.locator("[data-pjp-count]").textContent(), "1 / 2");
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
      const configure = navigator.mediaDevices.setCaptureHandleConfig.bind(navigator.mediaDevices);
      navigator.mediaDevices.setCaptureHandleConfig = value => { window.captureConfiguration = value; configure(value); };
      navigator.mediaDevices.getDisplayMedia = async () => {
        const stream = document.createElement("canvas").captureStream(1), track = stream.getVideoTracks()[0];
        track.getSettings = () => ({ displaySurface: "browser" });
        track.getCaptureHandle = () => ({ origin: location.origin, handle: window.captureConfiguration.handle });
        track.stop(); return stream;
      };
    });
    await popup.locator("[data-pp-live]").click();
    await popup.waitForFunction(() => document.querySelector("[data-pp-status]").dataset.state === "disconnected");
    assert.equal(await popup.locator("[data-pp-now] canvas").count(), 0, "An ended track with the correct capture identity must never be accepted");
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