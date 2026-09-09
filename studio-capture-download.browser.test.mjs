import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.SLIDE_LAB_URL;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

test("More offers the versioned capture probe and safe test instructions", { skip: !baseURL || !existsSync(executablePath), timeout: 90000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    await page.route("**/*", route => {
      const request = route.request();
      if (!request.url().startsWith(baseURL) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto(baseURL + "/studio/?devstub");
    await page.waitForFunction(() => !!window.__rkDevStudio && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForSelector('.adm [data-tab="autofill"]', { state: "attached" });
    await page.evaluate(() => {
      document.querySelectorAll(".pass").forEach(dialog => dialog.remove());
      const studio = document.querySelector(".adm");
      studio.style.visibility = "visible";
      studio.style.opacity = "1";
      document.querySelector('.adm [data-tab="autofill"]').click();
    });
    const card = page.locator("[data-presenter-capture-test]");
    await card.waitFor();
    const link = card.getByRole("link", { name: /Download app/ });
    assert.equal(await link.getAttribute("href"), "https://github.com/riteshkumarhk/riteshk.work/releases/download/studio-presenter-v0.2.0/StudioPresenter.exe");
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await card.locator("ol li").count(), 5);
    assert.match(await card.textContent(), /app has its own local profile/);
    assert.match(await card.textContent(), /Do not disable Windows security/);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      await card.scrollIntoViewIfNeeded();
      assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `Card overflow at ${width}px`);
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await card.screenshot({ path: join(tmpdir(), "rk-capture-download-card.png") });
  } finally { await browser.close(); }
});