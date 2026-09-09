import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("./tools/studio-presenter/fixture-entry.mjs", import.meta.url))],
  outfile: fileURLToPath(new URL("./tools/studio-presenter/fixture.bundle.js", import.meta.url)),
  bundle: true,
  format: "iife"
});

const baseURL = process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test("built production and canvas players deliver native notes without exposing audience notes", async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  await context.addInitScript(() => {
    window.__RK_NATIVE_PRESENTER = true;
    const bridge = new EventTarget();
    window.nativeMessages = [];
    bridge.postMessage = message => window.nativeMessages.push(message);
    window.chrome.webview = bridge;
    window.nativeCommand = command => bridge.dispatchEvent(new MessageEvent("message", { data: { channel: "rk-presenter", command } }));
  });
  try {
    const lab = await context.newPage();
    await lab.goto(baseURL + "/studio/slide-merge-lab/");
    await lab.waitForFunction(() => window.__slideMerge?.api && !document.querySelector(".merge-layout-toggle")?.disabled);
    await lab.evaluate(() => window.__slideMerge.choose("fidelity"));
    const slides = await lab.evaluate(() => window.__slideMerge.deck().slides.map(slide => ({ layout: "title", slots: { title: slide.title }, notes: slide.notes })));
    await lab.getByRole("button", { name: "Rehearse", exact: true }).click();
    const production = await context.newPage();
    await production.goto(baseURL + "/studio/?devstub");
    await production.waitForFunction(() => !!window.RK?.presentDeck);
    await production.evaluate(slides => window.RK.presentDeck({}, { slides }), slides);
    for (const page of [lab, production]) {
      await page.waitForSelector(".pjp--native");
      await page.evaluate(() => window.nativeCommand("prev"));
      await page.waitForFunction(() => window.nativeMessages.at(-1)?.index === 0);
      assert.match(await page.evaluate(() => window.nativeMessages.at(-1).notes), /decision/);
      assert.equal(await page.locator("[data-pjp-notes]").textContent(), "");
      assert.equal(await page.locator(".pjp__popbtn").isVisible(), false);
      const bounds = await page.evaluate(() => window.nativeMessages.at(-1));
      assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.top >= 0);
      await page.evaluate(() => window.nativeCommand("next"));
      await page.waitForFunction(() => window.nativeMessages.at(-1)?.index === 1);
    }
    await lab.waitForFunction(() => [...document.querySelectorAll(".pjp canvas")].some(canvas => {
      const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) return false;
      const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 160) if (pixels[offset + 3]) colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
      return colors.size > 10;
    }));
    for (const page of [lab, production]) {
      await page.evaluate(() => window.nativeCommand("exit"));
      await page.waitForSelector(".pjp", { state: "detached" });
      assert.equal(await page.evaluate(() => window.nativeMessages.at(-1).type), "end");
    }
  } finally { await browser.close(); }
});

test("native bridge keeps notes off audience and laser yields to interactive controls", async () => {
  const browser = await chromium.launch({executablePath, headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:800},reducedMotion:"no-preference"});
  try {
    await page.addInitScript(() => {
      window.__RK_NATIVE_PRESENTER=true;
      const bridge=new EventTarget(); bridge.postMessage=message=>window.nativeMessages.push(message);
      window.nativeMessages=[]; window.chrome.webview=bridge;
      window.nativeCommand=message=>bridge.dispatchEvent(new MessageEvent("message",{data:{channel:"rk-presenter",...message}}));
    });
    await page.goto(baseURL+"/tools/studio-presenter/fixture.html");
    assert.equal(await page.evaluate(()=>typeof window.fixture?.start),"function","Fixture must load before input tests");
    await page.click("#start");
    await page.waitForSelector(".pjp--native");
    assert.equal(await page.locator("[data-pjp-notes]").textContent(), "");
    assert.equal(await page.locator(".pjp__notesbtn").isVisible(), false);
    await page.keyboard.press("p");
    assert.equal(await page.locator(".pjp--presenting").count(),0);
    assert.equal(await page.evaluate(()=>window.nativeMessages.at(-1).notes),"Private first note");
    await page.locator("#swatch").hover();
    await page.waitForFunction(()=>document.querySelector(".pjp")?.dataset.pointer==="laser");
    assert.equal(await page.locator("#swatch").evaluate(element=>getComputedStyle(element).cursor),"none");
    assert.equal(await page.locator(".pjp__pointer").isVisible(),true);
    await page.locator("#action").hover();
    assert.equal(await page.locator(".pjp__pointer.is-control").isVisible(),true);
    await page.click("#action");
    assert.equal(await page.evaluate(()=>window.fixture.clicks),1);
    await page.click("#section");
    assert.equal(await page.locator("details").evaluate(element=>element.open),true);
    await page.click("#play");
    await page.waitForFunction(()=>!document.querySelector("video").paused);
    await page.click("#play");
    assert.equal(await page.locator("video").evaluate(element=>element.paused),true);
    await page.frameLocator("iframe").locator("#embedded").click();
    assert.equal(await page.frameLocator("iframe").locator("#embedded").textContent(),"Embedded clicked");
    await page.evaluate(()=>window.nativeCommand({command:"next"}));
    await page.waitForFunction(()=>window.nativeMessages.at(-1).notes==="Private second note");
    assert.equal(await page.locator(".pjp__pointer").isVisible(),false);
    await page.locator("#swatch").hover();
    await page.screenshot({path:join(tmpdir(),"rk-native-audience-laser.png")});
    await page.evaluate(()=>window.nativeCommand({command:"pointer-leave"}));
    assert.equal(await page.locator(".pjp__pointer").isVisible(),false);
    await page.evaluate(()=>window.nativeCommand({command:"exit"}));
    await page.waitForSelector(".pjp",{state:"detached"});
    assert.equal(await page.evaluate(()=>window.nativeMessages.at(-1).type),"end");
    assert.equal(await page.locator(".pjp__pointer").count(),0);
  } finally { await browser.close(); }
});

test("ordinary presenter uses laser over slide and system cursor over controls", async () => {
  const browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:"reduce"});
  try {
    await page.goto(baseURL+"/tools/studio-presenter/fixture.html");
    await page.click("#start");
    await page.locator("#swatch").hover();
    assert.equal(await page.locator(".pjp__pointer").isVisible(),true);
    await page.locator("#action").hover();
    assert.equal(await page.locator(".pjp__pointer").isVisible(),false);
    assert.notEqual(await page.locator("#action").evaluate(element=>getComputedStyle(element).cursor),"none");
    await page.keyboard.press("p");
    assert.equal(await page.locator("[data-pjp-notes]").textContent(),"Private first note");
  } finally { await browser.close(); }
});