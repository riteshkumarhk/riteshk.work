export async function openIsolatedBrowserHost(page, base) {
  const host = new URL("/__browser-test-host", base).href;
  await page.route(host, route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><meta charset="utf-8"><title>Isolated browser host</title></head><body></body></html>'
  }));
  await page.goto(host);
  if (page.url() !== host) throw new Error("The isolated browser host navigated unexpectedly.");
  return host;
}

export async function waitForSlideEditor(page, { timeout = 30000 } = {}) {
  let timer, pageError;
  const failed = new Promise((_, reject) => {
    pageError = error => reject(error);
    page.on("pageerror", pageError);
  });
  try {
    await Promise.race([
      page.evaluate(async () => {
        const script = [...document.scripts].find(element => /\/assets\/merge\.js(?:\?|$)/.test(element.src));
        if (!script) throw new Error("The slide editor entry module is missing.");
        const { editor } = await import(script.src);
        if (typeof editor?.ready?.then !== "function") throw new Error("The slide editor entry did not expose its readiness promise.");
        await editor.ready;
      }),
      failed,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Slide editor startup exceeded ${timeout}ms`)), timeout); })
    ]);
  } catch (error) {
    let diagnostic, diagnosticTimer;
    try {
      diagnostic = await Promise.race([
        page.evaluate(() => ({
          document: document.readyState,
          apiReady: !!window.__slideMerge?.api,
          busy: !!document.querySelector(".lab-busy"),
          status: [...document.querySelectorAll('[role="status"]')].map(element => element.textContent.trim()).filter(Boolean)
        })),
        new Promise(resolve => { diagnosticTimer = setTimeout(() => resolve({ unavailable: "Startup snapshot did not respond within 1000ms" }), 1000); })
      ]);
    } catch (failure) { diagnostic = { unavailable: failure.message }; }
    finally { clearTimeout(diagnosticTimer); }
    throw new Error(`Slide editor readiness failed: ${error.message}\nStartup: ${JSON.stringify(diagnostic)}`, { cause: error });
  } finally {
    clearTimeout(timer);
    page.off("pageerror", pageError);
  }
}
