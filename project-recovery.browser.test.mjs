import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build } from "esbuild";

const source = readFileSync(new URL("./src/js/project.js", import.meta.url), "utf8");
const baseURL = process.env.SLIDE_LAB_URL;
const launchOptions = { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true };

async function siteFixture(page, routeRequest) {
  const published = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  published.work = [
    { id: "recovery-fixture", client: "Synthetic validation", title: "Protected prototype", study: { blocks: [
      { type: "media", heading: "Public prototype", items: [{ src: "https://www.figma.com/proto/synthetic-public", kind: "figma" }] },
      { type: "media", heading: "Protected prototype", locked: true, vaultBlock: "synthetic-section" }
    ] } },
    { id: "second-fixture", client: "Synthetic validation", title: "Second project", study: { blocks: [{ type: "text", body: "Unchanged second project" }] } }
  ];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/content.json")) return route.fulfill({ json: published });
    if (await routeRequest(route, url)) return;
    if (request.url().startsWith(baseURL + "/")) return route.continue();
    if (request.resourceType() === "font" || url.hostname === "fonts.googleapis.com" || url.hostname === "api.fontshare.com") return route.continue();
    return route.abort();
  });
  return published;
}

test("built sign-in gate retains control after provider failure and cancellation", { skip: !baseURL, timeout: 45000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let finishes = 0, releaseStatus;
    const statusReady = new Promise(resolve => { releaseStatus = resolve; });
    await siteFixture(page, async (route, url) => {
      if (url.pathname === "/admin/auth/status") { await statusReady; await route.fulfill({ json: { passwordless: true, passkeys: 1, hasRecovery: true, hasAdminPass: true } }); return true; }
      if (url.pathname === "/admin/webauthn/auth/begin") { await route.fulfill({ json: { challenge: "YQ".repeat(22), rpId: "127.0.0.1", timeout: 120000, allowCredentials: [] } }); return true; }
      if (url.pathname === "/admin/webauthn/auth/finish") { finishes++; await route.fulfill({ json: { token: "synthetic-session", exp: Date.now() + 60000 } }); return true; }
      return false;
    });
    await page.addInitScript(() => {
      localStorage.setItem("rk:content:draft", '{"synthetic":"keep this draft"}');
      localStorage.setItem("rk:theme", "night");
      window.providerCalls = 0;
      Object.defineProperty(navigator.credentials, "get", { value: options => {
        window.providerCalls++;
        window.providerSignal = options.signal;
        if (window.providerCalls === 1) return Promise.reject(new DOMException("Synthetic provider unavailable", "NotAllowedError"));
        return new Promise(resolve => { window.finishProvider = () => resolve({ id: "synthetic", rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([1]).buffer, authenticatorData: new Uint8Array([1]).buffer, signature: new Uint8Array([1]).buffer, userHandle: null } }); });
      } });
    });
    await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__siteRendered && !!window.RK?.openProject).catch(async error => {
      const state = await page.evaluate(() => ({ rendered: !!window.__siteRendered, projectReady: !!window.RK?.openProject, readyState: document.readyState }));
      throw new Error("Built sign-in bootstrap failed: " + JSON.stringify({ errors, state }), { cause: error });
    });
    await page.locator("#moreBtn").click();
    await page.locator('[data-open="admin"]').click();
    await page.locator("[data-passkey]").click();
    await page.waitForFunction(() => /provider|cancel/i.test(document.querySelector(".pass__err").textContent));
    assert.equal(await page.locator("[data-passkey]").isEnabled(), true);
    await page.locator("[data-passkey]").dblclick();
    await page.waitForFunction(() => window.providerCalls === 2);
    releaseStatus();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("rk:authmode") || "null")?.hasRecovery);
    assert.equal(await page.locator("[data-reclink]").count(), 0);
    assert.equal(await page.locator('.pass input[type="password"]').isVisible(), false);
    assert.equal(await page.locator("[data-passkey]").isDisabled(), true);
    await page.locator(".pass [data-cancel]").click();
    await page.evaluate(async () => { window.finishProvider(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.equal(await page.evaluate(() => window.providerSignal.aborted), true);
    assert.equal(finishes, 0);
    assert.equal(await page.locator(".pass, .adm.is-open").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:admin:sess")), null);
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft")), '{"synthetic":"keep this draft"}');
    await page.locator("#moreBtn").click();
    await page.locator('[data-open="admin"]').click();
    await page.locator("[data-passkey]").click();
    await page.waitForFunction(() => window.providerCalls === 3);
    await page.evaluate(() => window.finishProvider());
    await page.locator(".adm.is-open").waitFor();
    assert.equal(finishes, 1);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("rk:admin:sess")).token), "synthetic-session");
    assert.equal(await page.locator(".pass--lock").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("built case study retries protected sections without restarting Figma and removes them on relock", { skip: !baseURL, timeout: 60000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      let loads = 0, protectedReads = 0;
      await siteFixture(page, async (route, url) => {
        if (url.hostname === "embed.figma.com" || (url.hostname === "www.figma.com" && url.pathname === "/embed")) { loads++; await route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="background:#f5f5f5;color:#171717;padding:24px;font:16px sans-serif"><button onclick="this.textContent=\'Prototype step 2\'">Prototype step 1</button></body>' }); return true; }
        if (url.pathname === "/vault/sign") { await route.fulfill({ json: { url: "/vault/file/synthetic-section" } }); return true; }
        if (url.pathname === "/vault/file/synthetic-section") {
          protectedReads++;
          await route.fulfill(protectedReads === 1 ? { status: 503, body: "Synthetic temporary failure" } : { json: { type: "media", locked: true, heading: "Protected prototype", items: [{ src: "https://www.figma.com/proto/synthetic-protected", kind: "figma" }] } });
          return true;
        }
        return false;
      });
      await page.addInitScript(() => {
        sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: "synthetic-grant", exp: Date.now() + 60000 }));
        localStorage.setItem("rk:theme", "night");
      });
      await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!window.RK?.openProject && !!window.RK?.vaultSignedUrl);
      await page.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
      const publicFrame = page.locator('iframe[src*="synthetic-public"]');
      await publicFrame.scrollIntoViewIfNeeded();
      await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").click();
      await page.evaluate(() => { window.keptFrame = document.querySelector('iframe[src*="synthetic-public"]'); });
      await page.locator("[data-vault-retry]").click();
      const protectedFrame = page.locator('iframe[src*="synthetic-protected"]');
      await protectedFrame.scrollIntoViewIfNeeded();
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button").waitFor();
      assert.equal(await page.evaluate(() => window.keptFrame === document.querySelector('iframe[src*="synthetic-public"]')), true);
      assert.equal(await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").innerText(), "Prototype step 2");
      assert.equal(loads, 2);
      assert.equal(protectedReads, 2);
      const protectedTools = protectedFrame.locator("..").locator(".pjb__frame-tools");
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button").click();
      await page.context().setOffline(true);
      await page.waitForFunction(() => document.querySelector('iframe[src*="synthetic-protected"]').parentElement.querySelector("[data-embed-state]").textContent === "Offline");
      await page.context().setOffline(false);
      assert.equal(loads, 2, "Reconnection must not reload either prototype");
      await protectedTools.locator("[data-embed-retry]").click();
      await page.frameLocator('iframe[src*="synthetic-protected"]').getByRole("button", { name: "Prototype step 1" }).waitFor();
      assert.equal(loads, 3);
      assert.equal(await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").innerText(), "Prototype step 2");
      assert.equal(await page.evaluate(() => window.keptFrame === document.querySelector('iframe[src*="synthetic-public"]')), true);
      await page.context().route("https://www.figma.com/proto/synthetic-protected", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic original</title><p>Original prototype fixture</p>" }));
      const opening = page.waitForEvent("popup");
      await protectedTools.getByRole("link", { name: "Open original", exact: true }).click();
      const original = await opening;
      await original.waitForLoadState("domcontentloaded");
      assert.equal(original.url(), "https://www.figma.com/proto/synthetic-protected");
      assert.equal(await original.evaluate(() => window.opener), null);
      await original.close();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator(".pjb__frame-tools").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1)), true);
      await page.screenshot({ path: join(tmpdir(), "rk-built-recovery-" + width + ".png") });
      await page.evaluate(() => { sessionStorage.removeItem("rk:vault:grant"); window.RK.setStudyLocked("recovery-fixture"); window.RK.openProject("recovery-fixture", { push: false, keepScroll: true }); });
      assert.equal(await protectedFrame.count(), 0);
      assert.equal(await page.locator('a[href*="synthetic-protected"]').count(), 0);
      await page.locator('.pj [data-pj="close"]').click();
      assert.equal(await page.locator(".pj iframe").count(), 0);
      await page.close();
      const visitor = await browser.newPage({ viewport: { width, height: 1000 } });
      const privateRequests = [];
      await siteFixture(visitor, async (route, url) => {
        if (url.pathname.startsWith("/vault/")) { privateRequests.push(url.pathname); await route.abort(); return true; }
        if (url.hostname === "embed.figma.com" || url.hostname === "www.figma.com") { await route.fulfill({ contentType: "text/html", body: "<!doctype html><button>Public prototype</button>" }); return true; }
        return false;
      });
      await visitor.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
      await visitor.waitForFunction(() => !!window.RK?.openProject);
      await visitor.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
      await visitor.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").waitFor();
      assert.equal(await visitor.locator('iframe[src*="synthetic-protected"], a[href*="synthetic-protected"]').count(), 0);
      assert.equal(await visitor.evaluate(() => window.RK.sectionAccess("recovery-fixture").unlocked), false);
      assert.deepEqual(privateRequests, []);
      await visitor.close();
    }
  } finally { await browser.close(); }
});
test("built case navigation rejects late protected recovery and allows a fresh retry", { skip: !baseURL, timeout: 45000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    for (const width of [1440,390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.addInitScript(() => {
        sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: "synthetic-navigation-grant", exp: Date.now() + 60000 }));
        const originalFetch = window.fetch;
        window.fetch = function(resource, options) {
          const address = typeof resource === "string" ? resource : resource.url;
          if (!address.includes("/vault/file/synthetic-section")) return originalFetch.call(this, resource, options);
          window.navigationReadStarted = true;
          return new Promise(resolve => { window.releaseNavigationRead = () => resolve(new Response(JSON.stringify({ type: "text", locked: true, heading: "Late private content", body: "Recovered only in its own case" }), { headers: { "Content-Type": "application/json" } })); });
        };
      });
      await siteFixture(page, async (route, url) => {
        if (url.pathname === "/vault/sign") { await route.fulfill({ json: { url: "/vault/file/synthetic-section" } }); return true; }
        if (url.hostname === "embed.figma.com") { await route.fulfill({ contentType: "text/html", body: "<!doctype html><button>Public prototype</button>" }); return true; }
        return false;
      });
      await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!window.RK?.openProject);
      await page.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
      await page.waitForFunction(() => window.navigationReadStarted);
      await page.locator('.pj [data-pj="close"]').click();
      await page.evaluate(() => window.RK.openProject("second-fixture", { push: false }));
      await page.getByText("Unchanged second project", { exact: true }).waitFor();
      const before = await page.evaluate(() => JSON.stringify(window.RK.data.work));
      await page.evaluate(async () => { window.releaseNavigationRead(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await page.evaluate(() => JSON.stringify(window.RK.data.work)), before);
      assert.equal(await page.getByText("Late private content", { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.RK.sectionAccess("second-fixture").unlocked), false);
      await page.locator('.pj [data-pj="close"]').click();
      await page.evaluate(() => { window.navigationReadStarted = false; window.RK.openProject("recovery-fixture", { push: false }); });
      await page.waitForFunction(() => window.navigationReadStarted);
      await page.evaluate(() => window.releaseNavigationRead());
      await page.getByText("Late private content", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.RK.data.work[0].study.blocks[1].locked), true);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("built protected loading times out visibly and recovers without restarting another embed", { skip: !baseURL, timeout: 45000 }, async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.addInitScript(() => {
      sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: "synthetic-timeout-grant", exp: Date.now() + 3600000 }));
      const originalFetch = window.fetch;
      window.fetch = function(resource, options) {
        const address = typeof resource === "string" ? resource : resource.url;
        if (!address.includes("/vault/file/synthetic-section")) return originalFetch.call(this, resource, options);
        window.timeoutReadStarted = true;
        if (!window.recoverTimeoutRead) return new Promise(() => {});
        return Promise.resolve(new Response(JSON.stringify({ type: "text", locked: true, heading: "Recovered after timeout", body: "Original content retained" }), { headers: { "Content-Type": "application/json" } }));
      };
    });
    let frameLoads = 0;
    await siteFixture(page, async (route, url) => {
      if (url.pathname === "/vault/sign") { await route.fulfill({ json: { url: "/vault/file/synthetic-section" } }); return true; }
      if (url.hostname === "embed.figma.com" || (url.hostname === "www.figma.com" && url.pathname === "/embed")) { frameLoads++; await route.fulfill({ contentType: "text/html", body: '<!doctype html><button onclick="this.textContent=\'Prototype step 2\'">Prototype step 1</button>' }); return true; }
      return false;
    });
    await page.goto(baseURL + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.RK?.openProject);
    await page.clock.install();
    await page.evaluate(() => window.RK.openProject("recovery-fixture", { push: false }));
    await page.waitForFunction(() => window.timeoutReadStarted);
    await page.locator('iframe[src*="synthetic-public"]').scrollIntoViewIfNeeded();
    await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").click();
    await page.clock.runFor(16000);
    await page.locator("[data-vault-retry]").waitFor();
    assert.equal(await page.locator("[data-vault-retry]").isEnabled(), true);
    assert.equal(await page.evaluate(() => window.RK.data.work[0].study.blocks[1].vaultBlock), "synthetic-section");
    await page.evaluate(() => { window.recoverTimeoutRead = true; });
    await page.locator("[data-vault-retry]").click();
    await page.getByText("Recovered after timeout", { exact: true }).waitFor();
    assert.equal(frameLoads, 1);
    assert.equal(await page.frameLocator('iframe[src*="synthetic-public"]').getByRole("button").innerText(), "Prototype step 2");
  } finally { await browser.close(); }
});

function sourceFunction(name) {
  const start = source.indexOf("  function " + name + "("), firstLine = source.indexOf("\n", start);
  assert.ok(start >= 0);
  const end = source.slice(start, firstLine).trimEnd().endsWith("}") ? firstLine : source.indexOf("\n  }", firstLine) + 4;
  return source.slice(start, end);
}

test("rich HTML keeps authored formatting and media while removing executable content", { timeout: 30000 }, async () => {
  const bundle = await build({ entryPoints: ["src/js/rich-html.mjs"], bundle: true, write: false, format: "iife", globalName: "rkRichHtml" });
  const browser = await chromium.launch({ ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://media.synthetic.test/**", route => route.fulfill({ status: 404 }));
    await page.setContent("<!doctype html><div id='result'></div>");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => {
      window.executed = 0;
      const markup = '<p style="text-align:center;color:rgb(255, 0, 0);position:fixed;background-image:url(https://bad.test/x)"><strong>Preserved</strong> <em>text</em></p><ul><li>Every item</li></ul><figure><img src=assets/uploads/original.png onerror=window.executed++><figcaption>Original image</figcaption></figure><a target=_blank href="https://example.test">Safe link</a><a href="java&#x73;cript:window.executed++">Bad link</a><svg onload=window.executed++><a xlink:href="javascript:window.executed++">Bad SVG</a></svg><math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=window.executed++>"><script>window.executed++</script><iframe srcdoc="<script>parent.executed++</script>"></iframe><form><input autofocus onfocus=window.executed++></form>';
      const clean = window.rkRichHtml.sanitizeRichHtml(markup, value => "https://media.synthetic.test/" + value);
      const host = document.getElementById("result"); host.innerHTML = clean;
      return { clean, align: host.querySelector("p").style.textAlign, position: host.querySelector("p").style.position, background: host.querySelector("p").style.backgroundImage, image: host.querySelector("figure img").getAttribute("src"), rel: host.querySelector('a[href="https://example.test"]').rel, active: host.querySelectorAll("script,iframe,svg,math,form,input").length, handlers: [...host.querySelectorAll("*")].flatMap(element => [...element.attributes]).filter(attribute => /^on/i.test(attribute.name)).length };
    });
    assert.equal(result.active, 0);
    assert.equal(result.handlers, 0);
    assert.equal(result.position, "");
    assert.equal(result.background, "");
    assert.equal(result.align, "center");
    assert.equal(result.image, "https://media.synthetic.test/assets/uploads/original.png");
    assert.equal(result.rel, "noopener noreferrer");
    assert.match(result.clean, /<strong>Preserved<\/strong> <em>text<\/em>/);
    assert.match(result.clean, /<li>Every item<\/li>/);
    assert.doesNotMatch(result.clean, /href="javascript:/i);
    assert.equal(await page.evaluate(() => window.executed), 0);
  } finally { await browser.close(); }
});

test("case refresh preserves live Figma frames and provides honest authorized recovery", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let frameLoads = 0;
  await page.route("https://embed.figma.com/**", route => { frameLoads++; return route.fulfill({ contentType: "text/html", body: '<!doctype html><body style="background:#fafafa;color:#171717;font:16px sans-serif"><button id="step" onclick="this.textContent=\'Prototype step 2\'">Prototype step 1</button></body>' }); });
  try {
    await page.setContent('<style>:root{--bg-2:#111116;--text:#ece7e1;--text-dim:#8f8a84;--line:rgba(236,231,225,.12);--line-soft:rgba(236,231,225,.06);--sans:sans-serif}body{margin:16px;background:#08080a;color:var(--text)}#overlay{max-width:900px;margin:auto}</style><div id="overlay"><div data-crumb></div><div data-content></div></div>');
    await page.addStyleTag({ content: readFileSync(new URL("./css/project.css", import.meta.url), "utf8") });
    await page.evaluate(code => {
      const setup = new Function("code", `
        var overlay=document.querySelector('#overlay'),activeId='first',PREVIEW=false,lastSpyId=null,stageCtl=null;
        document.documentElement.classList.add('lite');
        var applyNav=()=>{},pjIsOwner=()=>false,pjHasSavedDeck=()=>false,pjDeckPublic=()=>false,esc=value=>value,attr=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        var updateSpy=()=>{},coverParallax=()=>{},isoParallax=()=>{},normalizeGalleries=()=>{},isoEnhance=()=>{},focusEnhance=()=>{},graphWire=()=>{},galleryNav=()=>{},resolveVaultMedia=()=>{},autoResolveVaultBlocks=()=>{};
        var RUNTIME_CLASS=/^(is-|pjb__gallery-nav--ondark$|pjb--flash$|pjb--droptarget$)/,FS_SVG='',unlocked=false;
        function contentHtml(){return '<div data-stage data-count="2"><div data-stage-main><span class="pj__stage-slide is-active" data-kind="image">First</span><span class="pj__stage-slide" data-kind="image">Second</span></div><div data-stage-strip><button class="pj__stage-thumb is-active" data-thumb="0">First</button><button class="pj__stage-thumb" data-thumb="1">Second</button></div></div><div class="pj__body"><section data-block="0" id="public">'+frameEl('https://embed.figma.com/proto/public','fixture','prototype',false,'https://www.figma.com/proto/public')+'</section><section data-block="1" id="protected">'+(unlocked?frameEl('https://embed.figma.com/proto/protected','fixture','prototype',false,'https://www.figma.com/proto/protected'):'<p>Protected section</p>')+'</section></div>';}
        eval(code);
        overlay.addEventListener('click',onOverlayClick);
        return {fill:()=>fillContent({id:activeId}),unlock:()=>{unlocked=true;fillContent({id:activeId});},lock:()=>{unlocked=false;fillContent({id:activeId});},original:figmaOriginalUrl};
      `);
      window.fixture = setup(code);
      window.fixture.fill();
      window.originalFrame = document.querySelector("iframe");
    }, ["figmaOriginalUrl", "frameEl", "fillContent", "hydrateEmbedRecovery", "disposeEmbedRecovery", "destroyStage", "initStage", "morphInto", "morphChildren", "morphNode", "mergeClass", "morphAttrs", "onOverlayClick"].map(sourceFunction).join("\n"));
    await page.frameLocator("#public iframe").getByRole("button").click();
    await page.locator('[data-thumb="1"]').click();
    await page.evaluate(() => window.fixture.unlock());
    await page.frameLocator("#protected iframe").getByRole("button").waitFor();
    assert.equal(await page.evaluate(() => window.originalFrame === document.querySelector("#public iframe")), true);
    assert.equal(await page.frameLocator("#public iframe").getByRole("button").innerText(), "Prototype step 2");
    assert.equal(frameLoads, 2);
    assert.equal(await page.locator(".pj__stage-slide.is-active").count(), 1);
    assert.equal(await page.locator(".pj__stage-slide.is-active").innerText(), "Second");
    await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.fixture.fill(); });
    await page.waitForFunction(() => document.querySelector("#public [data-embed-state]").textContent === "Offline");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.locator("#public [data-embed-retry]").click();
    await page.frameLocator("#public iframe").getByRole("button", { name: "Prototype step 1" }).waitFor();
    assert.equal(frameLoads, 3);
    assert.equal(await page.locator("#public a").getAttribute("rel"), "noopener noreferrer");
    assert.equal(await page.evaluate(() => window.fixture.original("https://www.figma.com/embed?url=javascript%3Aalert(1)")), "");
    await page.evaluate(() => window.fixture.lock());
    assert.equal(await page.locator("#protected iframe, #protected a").count(), 0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator("#public .pjb__frame-tools").evaluate(element => {
        const frame = element.getBoundingClientRect();
        return [...element.children].every(child => { const rect = child.getBoundingClientRect(); return rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom; });
      });
      assert.equal(bounds, true);
      await page.screenshot({ path: join(tmpdir(), "rk-protected-recovery-" + width + ".png") });
    }
  } finally { await browser.close(); }
});