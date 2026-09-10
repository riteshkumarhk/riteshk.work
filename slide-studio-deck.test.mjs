import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { assertStudioDeckPublishable, createStudioDeck, STUDIO_DECK_SCHEMA } from "./src/js/slide-studio-deck.mjs";

test("new production decks are empty and have no demonstration content", () => {
  assert.deepEqual(createStudioDeck("Case-study slides"), { version: 1, title: "Case-study slides", selected: null, slides: [] });
});

test("native pilot references and inline native scenes stop publishing without changing the draft", () => {
  for (const study of [
    { nativeDeck: { schema: STUDIO_DECK_SCHEMA, version: 1, id: "deck-one", revision: 2 } },
    { nativeDeck: null },
    { slidesPublic: true, slides: [{ scene: { elements: [] }, notes: "PRIVATE NOTES" }] }
  ]) {
    const data = { work: [{ id: "case-one", study }] }, original = structuredClone(data);
    assert.throws(() => assertStudioDeckPublishable(data), { name: "StudioDeckPublishError" });
    assert.deepEqual(data, original);
  }
});

test("legacy and unopened encrypted decks pass through the pilot guard unchanged", () => {
  const data = { work: [{ study: { slides: [{ layout: "title", slots: { title: "Legacy slide" } }] } }, { study: { slidesEnc: { ct: "sealed-deck", wraps: { owner: "sealed-key" } } } }, { encWork: "sealed-work" }] };
  const original = structuredClone(data);
  assert.doesNotThrow(() => assertStudioDeckPublishable(data));
  assert.deepEqual(data, original);
});

test("the shared publish builder rejects native pilots before uploads or encryption", () => {
  const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
  assert.match(source, /async function buildPublishJson\(token\) \{\s*assertStudioDeckPublishable\(data\);/);
  for (const entry of ['publish', 'ghPublish', 'publishManual']) assert.match(source, new RegExp('function ' + entry + '\\([^)]*\\) \\{(?:\\s*if \\(publishing\\) return;)?\\s*if \\(!slidePublishReady\\(\\)\\) return;'));
  assert.throws(() => assertStudioDeckPublishable({}, { activeEditor: true }), { name: 'StudioDeckPublishError' });
});

test("native deck storage commits original assets and rejects stale or misrouted saves", { timeout: 30000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("./src/js/slide-studio-deck.mjs", import.meta.url))], bundle: true, format: "iife", globalName: "StudioDeckStorage", write: false });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  try {
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { createStudioDeck, studioDeckReference, saveStudioDeck, loadStudioDeck, studioDeckBackup, restoreStudioDeckBackup } = window.StudioDeckStorage;
      const first = studioDeckReference("case-one"), second = studioDeckReference("case-two");
      const document = createStudioDeck("Original deck");
      document.slides = [{ id: "slide-one", title: "Slide", notes: "Private notes", durationMinutes: 1.5, scene: { version: 1, elements: [{ id: "image", type: "image", fileId: "original" }], files: { original: { id: "original", mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64,PHN2Zy8+", originalDataURL: "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+T3JpZ2luYWw8L3RpdGxlPjwvc3ZnPg==" } } } }];
      document.selected = "slide-one";
      const original = JSON.stringify(document);
      const saved = await saveStudioDeck(first, document);
      const restored = await loadStudioDeck(saved);
      const revision = await saveStudioDeck(saved, { ...document, title: "Updated deck" });
      const failures = {};
      for (const [key, operation] of Object.entries({ stale: () => saveStudioDeck(saved, document), wrongCase: () => loadStudioDeck({ ...saved, caseStudyId: "case-two" }), closed: () => saveStudioDeck(revision, document, { isCurrent: () => false }) })) {
        try { await operation(); } catch (error) { failures[key] = error.name + ": " + error.message; }
      }
      const other = await saveStudioDeck(second, createStudioDeck("Other case"));
      const backup = await studioDeckBackup({ work: [{ id: "case-one", title: "Case", study: { nativeDeck: saved } }, { id: "case-two", study: { nativeDeck: other } }] });
      const recovered = await restoreStudioDeckBackup(JSON.parse(JSON.stringify(backup)), ["case-one"]);
      const recoveredReference = recovered.work[0].study.nativeDeck;
      const broken = structuredClone(backup); delete broken.nativeDecksBackup;
      try { await restoreStudioDeckBackup(broken, ["case-one"]); } catch (error) { failures.backup = error.message; }
      return { roundtrip: JSON.stringify(restored.document) === original, originalUnchanged: JSON.stringify(document) === original, firstTitle: (await loadStudioDeck(saved)).document.title, latestTitle: (await loadStudioDeck(saved, { latest: true })).document.title, otherTitle: (await loadStudioDeck(other)).document.title, failures, revision: revision.revision,
        backup: { documents: backup.nativeDecksBackup.documents.length, newIdentity: recoveredReference.id !== saved.id, title: (await loadStudioDeck(recoveredReference)).document.title, originalMedia: (await loadStudioDeck(recoveredReference)).document.slides[0].scene.files.original.originalDataURL, unchangedOther: recovered.work[1].study.nativeDeck.id === other.id, noEnvelope: !Object.hasOwn(recovered, "nativeDecksBackup") } };
    });
    assert.equal(result.roundtrip, true);
    assert.equal(result.originalUnchanged, true);
    assert.equal(result.firstTitle, "Original deck");
    assert.equal(result.latestTitle, "Updated deck");
    assert.equal(result.otherTitle, "Other case");
    assert.equal(result.revision, 2);
    assert.match(result.failures.stale, /StudioDeckConflictError/);
    assert.match(result.failures.wrongCase, /another case study/);
    assert.match(result.failures.closed, /session has changed/);
    assert.match(result.failures.backup, /missing the native deck/);
    assert.equal(result.backup.documents, 2);
    assert.equal(result.backup.newIdentity, true);
    assert.equal(result.backup.title, "Updated deck");
    assert.equal(result.backup.originalMedia, "data:image/svg+xml;base64,PHN2Zz48dGl0bGU+T3JpZ2luYWw8L3RpdGxlPjwvc3ZnPg==");
    assert.equal(result.backup.unchangedOther, true);
    assert.equal(result.backup.noEnvelope, true);
  } finally { await browser.close(); }
});

test("hosted editor loads empty, uses its save adapter and disposes without lab globals", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/404.html");
    await page.evaluate(async () => {
      const container = document.createElement("div"); container.id = "pilot";
      document.body.replaceChildren(container);
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/studio/slide-lab/assets/editor.css"; document.head.append(link);
      window.__RKStudio = { getDraft: () => ({ work: [{ id: "host-case", title: "Host case", study: { blocks: [{ type: "statement", body: "Host-owned section" }] } }] }) };
      window.hostSaves = [];
      const { mountSlideEditor } = await import("/studio/slide-lab/assets/editor.js");
      window.hostedEditor = mountSlideEditor(container, { caseStudyId: "host-case", title: "Host slides", load: async () => null, save: async document => { if (window.deferHostSave) await new Promise(resolve => { window.releaseHostSave = resolve; }); window.hostSaves.push(structuredClone(document)); } });
      await window.hostedEditor.ready;
    });
    await page.locator(".merge-empty-actions button").first().click();
    await page.waitForFunction(() => window.hostSaves.at(-1)?.slides.length === 1);
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("Host notes, flushed before leaving");
    await page.evaluate(() => window.hostedEditor.flush());
    assert.equal(await page.evaluate(() => window.hostSaves.at(-1).slides[0].notes), "Host notes, flushed before leaving");
    assert.equal(await page.evaluate(() => typeof window.__slideMerge), "undefined");
    assert.equal(await page.locator(".merge-header").count(), 0);
    await page.getByRole("button", { name: "Sections", exact: true }).click();
    await page.locator(".merge-section-choices button").first().waitFor();
    assert.equal(await page.getByRole("button", { name: "Host case", exact: true }).count(), 0, "The active case study must not need choosing again");
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.evaluate(() => { window.deferHostSave = true; });
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('A queued host write');
    await page.waitForFunction(() => typeof window.releaseHostSave === 'function');
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    await page.evaluate(() => { window.deferHostSave = false; window.releaseHostSave(); });
    await page.evaluate(() => window.hostedEditor.flush());
    await page.evaluate(() => window.hostedEditor.dispose());
    assert.equal(await page.locator(".merge-shell").count(), 0);
    const failure = await page.evaluate(async () => {
      const { mountSlideEditor } = await import("/studio/slide-lab/assets/editor.js");
      const editor = mountSlideEditor(document.querySelector("#pilot"), { caseStudyId: "failed", load: async () => { throw new Error("Missing deck revision"); }, save: async () => {} });
      try { await editor.ready; return "unexpected success"; } catch (error) { return error.message; } finally { editor.dispose(); }
    });
    assert.equal(failure, "Missing deck revision");
  } finally { await browser.close(); }
});

test("Content Studio pilot keeps native drafts isolated across case switches and reload", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(() => localStorage.setItem("rk:dev:stub", "1"));
    await page.route("**/*", route => {
      const request = route.request();
      if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname) && !["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto((process.env.SLIDE_LAB_URL || "http://127.0.0.1:5510") + "/studio/?devstub&nativeSlides=1");
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__rkDevEdit && document.querySelector(".adm.is-open"));
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.evaluate(() => window.__rkDevEdit("work", [
      { id: "native-first", title: "Native first case", study: { blocks: [{ type: "statement", body: "First case section" }], slides: [{ layout: "title", slots: { title: "Disposable v0 slide" } }] } },
      { id: "native-second", title: "Native second case", study: { blocks: [{ type: "statement", body: "Second case section" }] } }
    ]));
    await page.locator('.adm__tab[data-tab="work"]').click();
    const hostStyle = await page.locator('.adm__tab[data-tab="work"]').evaluate(element => {
      const style = getComputedStyle(element); return { font: style.fontFamily, fontSize: style.fontSize, radius: style.borderRadius, height: element.getBoundingClientRect().height };
    });
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.locator(".merge-empty-actions button").first().waitFor();
    assert.equal(await page.locator(".merge-header").count(), 0);
    assert.equal(await page.locator("[data-native-slide-toolbar] .merge-editor-bar:visible").count(), 1);
    assert.equal(await page.locator("[data-native-slide-status] .merge-status:visible").count(), 1);
    assert.equal(await page.getByRole('contentinfo', { name: 'Document status', exact: true }).count(), 1);
    assert.equal(await page.locator(".slides__nav:visible,.slides__props:visible").count(), 0);
    await page.locator(".merge-empty-actions button").first().click();
    await page.getByRole('button', { name: 'Text (T)', exact: true }).click();
    await page.locator('.excalidraw__canvas.interactive').click({ position: { x: 600, y: 230 } });
    await page.keyboard.type('Native canvas content');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('.merge-slide-list')?.textContent.includes('Untitled slide'));
    const savedText = await page.evaluate(async () => {
      const reference = window.__RKStudio.getDraft().work[0].study.nativeDeck;
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('rk-studio-slide-decks-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => { const request = database.transaction('documents').objectStore('documents').get([reference.id, reference.revision]); request.onsuccess = () => resolve(request.result.document.slides[0].scene.elements.filter(element => element.type === 'text').map(element => element.text)); request.onerror = () => reject(request.error); }); } finally { database.close(); }
    });
    assert.deepEqual(savedText, ['Native canvas content'], 'Leaving flushes an active native text editor');
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("FIRST PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    await page.locator('[data-act="study-toggle"][data-index="0"]').click();
    await page.locator("[data-l2-back]").click();
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "FIRST PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    await page.locator('[data-act="study-slides"][data-index="1"]').click();
    await page.locator(".merge-empty-actions button").first().waitFor();
    await page.locator(".merge-empty-actions button").first().click();
    await page.getByRole("textbox", { name: "Speaker notes", exact: true }).fill("SECOND PRIVATE NOTE");
    await page.locator("[data-l2-back]").click();
    await page.waitForSelector(".merge-shell", { state: "detached" });
    const references = await page.evaluate(() => window.__RKStudio.getDraft().work.map(work => work.study.nativeDeck));
    assert.notEqual(references[0].id, references[1].id);
    assert.equal(references[0].caseStudyId, "native-first");
    assert.equal(references[1].caseStudyId, "native-second");
    assert.equal(await page.evaluate(() => localStorage.getItem("rk:content:draft").includes("PRIVATE NOTE")), false);
    await page.reload();
    await page.waitForFunction(() => typeof window.__rkDevStudio === "function" && !!window.RK?.data);
    await page.evaluate(() => window.__rkDevStudio());
    await page.waitForFunction(() => !!window.__RKStudio?.getDraft?.());
    await page.evaluate(() => document.querySelectorAll(".pass--lock").forEach(dialog => dialog.remove()));
    await page.locator('.adm__tab[data-tab="work"]').click();
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector(".merge-notes-input")?.textContent === "FIRST PRIVATE NOTE");
    assert.equal(await page.evaluate(() => typeof window.__slideMerge), "undefined");
    await page.locator('.merge-notes-input').press('Tab');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.merge-notes-input').innerText(), 'FIRST PRIVATE NOTE', 'Empty native Undo must not step host history');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.evaluate(() => {
        const shell = document.querySelector('.merge-shell').getBoundingClientRect(), main = document.querySelector('.adm__main').getBoundingClientRect(), bar = document.querySelector('.adm__workbar').getBoundingClientRect(), footer = document.querySelector('.adm__statusbar').getBoundingClientRect();
        return { shell: shell.toJSON(), main: main.toJSON(), bar: bar.toJSON(), footer: footer.toJSON(), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(geometry.shell.height > 400 && geometry.shell.width > width - 50, JSON.stringify(geometry));
      assert.ok(geometry.shell.top >= geometry.bar.bottom && geometry.shell.bottom <= geometry.footer.top + 1, JSON.stringify(geometry));
      assert.ok(geometry.shell.top - geometry.bar.bottom < 80, 'The host title row must not retain the old inspector padding');
      assert.equal(geometry.overflow, false);
      await page.screenshot({ path: join(tmpdir(), `rk-studio-native-pilot-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      window.originalDeckTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, mode, ...options) {
        if (this.name === 'rk-studio-slide-decks-v1' && mode === 'readwrite') throw new DOMException('Test storage quota', 'QuotaExceededError');
        return window.originalDeckTransaction.call(this, names, mode, ...options);
      };
    });
    await page.getByRole('textbox', { name: 'Speaker notes', exact: true }).fill('Pending notes must stay open');
    await page.locator('[data-l2-back]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-slide-status]')?.textContent.includes('Not saved'));
    assert.equal(await page.locator('.merge-notes-input').innerText(), 'Pending notes must stay open');
    assert.equal(await page.locator('.merge-shell').count(), 1);
    await page.evaluate(() => { IDBDatabase.prototype.transaction = window.originalDeckTransaction; delete window.originalDeckTransaction; });
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'Pending notes must stay open');
    await page.locator('[data-publish]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-slide-status]')?.textContent.includes('Publishing is paused'));
    assert.equal(await page.locator('.pass').count(), 0, 'Native pilot publishing stops before credential or upload workflows');
    await page.locator('[data-opensettings]').click();
    await page.locator('[data-act="settings-cat"][data-cat="backup"]').click();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-act="backup-dl"]').click();
    const download = await downloading;
    const downloaded = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(downloaded.nativeDecksBackup.documents.length, 2);
    assert.ok(downloaded.nativeDecksBackup.documents.some(record => record.document.slides[0].notes === 'Pending notes must stay open'));
    const choosingFile = page.waitForEvent('filechooser');
    await page.locator('[data-act="backup-restore"]').click();
    await (await choosingFile).setFiles({ name: 'private-native-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(downloaded)) });
    await page.locator('[data-bkr-work="native-second"]').uncheck();
    await page.locator('.bkr [data-go]').click();
    await page.waitForSelector('.bkr', { state: 'detached' });
    const recoveredReferences = await page.evaluate(() => window.__RKStudio.getDraft().work.map(work => work.study.nativeDeck));
    assert.notEqual(recoveredReferences[0].id, references[0].id);
    assert.equal(recoveredReferences[1].id, references[1].id);
    await page.locator('.adm__tab[data-tab="work"]').focus();
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), references[0].id, 'Undo recovery must restore the previous native deck identity');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), recoveredReferences[0].id, 'Redo recovery must reinstate the recovered native deck');
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('.merge-notes-input')?.textContent === 'Pending notes must stay open');
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached' });
    assert.equal(await page.locator('link[href*="assets/editor.css"]').count(), 0, 'Editor styles must unload when the workspace closes');
    assert.deepEqual(await page.locator('.adm__tab[data-tab="work"]').evaluate(element => {
      const style = getComputedStyle(element); return { font: style.fontFamily, fontSize: style.fontSize, radius: style.borderRadius, height: element.getBoundingClientRect().height };
    }), hostStyle, 'The native editor must not alter the host navigation after unmount');
    await page.locator('[data-act="work-dup"][data-index="0"]').click();
    await page.waitForFunction(() => window.__RKStudio.getDraft().work.length === 3);
    const duplicate = await page.evaluate(() => { const [original, copied] = window.__RKStudio.getDraft().work; return { original: original.study.nativeDeck.id, copied: copied.study.nativeDeck.id, caseId: copied.id, owner: copied.study.nativeDeck.caseStudyId, hidden: copied.hidden }; });
    assert.notEqual(duplicate.copied, duplicate.original);
    assert.equal(duplicate.owner, duplicate.caseId);
    assert.equal(duplicate.hidden, true);
    await page.evaluate(() => window.__rkDevEdit('work.0.study.nativeDeck', { schema: 'rk-studio-native-deck', version: 1, caseStudyId: 'native-first', id: 'missing-native-deck', revision: 3 }));
    await page.locator('[data-act="study-slides"][data-index="0"]').click();
    await page.waitForFunction(() => document.querySelector('[data-native-slide-status]')?.textContent.includes('not available on this device'));
    await page.locator('[data-l2-back]').click();
    await page.waitForSelector('.merge-shell', { state: 'detached', timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__RKStudio.getDraft().work[0].study.nativeDeck.id), 'missing-native-deck');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});