import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { selectStudioDraft, studioDraftContent } from "./src/js/studio-draft-recovery.mjs";
import { completeStudioBackup } from "./src/js/studio-content-backup.mjs";

const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
const styles = postcss.parse(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"));
function declarations(selector) {
  const result = {};
  styles.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

test("draft recovery keeps older work available without replacing newer published content", () => {
  const published = { work: [{ id: "case", title: "New published version" }] };
  const draft = { work: [{ id: "case", title: "Unfinished local work", study: { nativeDeck: { id: "original-deck" } } }] };
  for (const signature of ["older-version", ""]) {
    const selection = selectStudioDraft(published, draft, "published-version", signature);
    assert.deepEqual(selection.data, published);
    assert.deepEqual(selection.recovery, draft);
    selection.recovery.work[0].title = "Reviewed copy";
    assert.equal(draft.work[0].title, "Unfinished local work");
  }
  assert.deepEqual(selectStudioDraft(published, draft, "same", "same"), { data: draft, recovery: null });
  assert.deepEqual(selectStudioDraft(published, null, "same", ""), { data: published, recovery: null });
});

test("Studio navigation reserves action space and keeps narrow tabs on a separate row", () => {
  const desktopTabs = styles.nodes.find(node => node.type === "rule" && node.selector === ".adm__tabswrap");
  assert.equal(desktopTabs.nodes.find(node => node.prop === "flex").value, "1 1 0");
  assert.equal(declarations(".adm__actions").flex, "0 0 auto");
  assert.equal(declarations(".adm__tabs")["overflow-x"], "auto");
  const narrow = styles.nodes.find(node => node.type === "atrule" && node.params === "(max-width: 1023px)");
  const narrowTabs = narrow.nodes.find(node => node.selector === ".adm__tabswrap");
  assert.equal(narrowTabs.nodes.find(node => node.prop === "flex").value, "1 1 100%");
  assert.equal(narrowTabs.nodes.find(node => node.prop === "order").value, "3");
});

test("shared Studio shell separates working controls from bottom document status", () => {
  const shell = source.slice(source.indexOf("function buildShell()"));
  const workbar = shell.slice(shell.indexOf('<div class="adm__workbar">'), shell.indexOf('<div class="adm__main">'));
  const footer = shell.slice(shell.indexOf('<footer class="adm__statusbar"'), shell.indexOf("'</footer>'"));
  for (const marker of ["data-hist", "data-prevtoggle", "data-dev-wrap", "data-newtab"]) assert.ok(workbar.includes(marker));
  for (const marker of ["adm__status\"", "data-draftmeter", 'data-act="logs-rec"']) {
    assert.ok(footer.includes(marker));
    assert.ok(!workbar.includes(marker));
  }
  assert.ok(shell.indexOf('<footer class="adm__statusbar"') > shell.indexOf('data-casestage'));
  assert.match(source, /function pubBar\(\) \{ return root && root.querySelector\("\.adm__statusbar"\)/);
  assert.match(source, /s\.title = msg/);
  assert.match(source, /s\.title = s\.textContent/);
  assert.match(source, /s\.title = label/);
});

test("draft storage is a plain status item in normal and warning states", () => {
  const meter = declarations(".adm__dmeter");
  assert.equal(meter.border, "0");
  assert.equal(meter["border-radius"], "0");
  assert.equal(meter.background, "transparent");
  for (const level of ["mid", "hi"]) {
    const warning = declarations(`.adm__dmeter[data-lvl="${level}"]`);
    assert.ok(warning.color);
    assert.equal(warning.background, undefined);
    assert.equal(warning["border-color"], undefined);
  }
});

test("Studio footer is compact and preview controls align right without absolute centering", () => {
  assert.equal(declarations(".adm__statusbar").height, "32px");
  assert.equal(declarations(".adm__statusbar :is(.adm__logs-btn,.adm__dmeter)").height, "24px");
  assert.equal(declarations(".adm__statusbar .adm__status").flex, "1");
  assert.equal(declarations(".adm__statusbar .adm__status").display, "block");
  assert.doesNotMatch(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"), /\.adm\.is-(?:prevoff|noprev) \.adm__logs-btn/);
  assert.equal(declarations(".adm__statusbar .adm__status")["max-width"], "none");
  assert.equal(declarations(".adm__prevgroup")["margin-left"], "auto");
  assert.equal(declarations(".adm__prevgroup").position, undefined);
  assert.equal(declarations(".adm__prevgroup").transform, undefined);
});

test("saving a different slide selection does not create unpublished content", () => {
  const published = { work: [{ study: { nativeDeck: { id: "deck", revision: 1, documentHash: "same-content" } } }] };
  const selection = structuredClone(published); selection.work[0].study.nativeDeck.revision = 2;
  assert.deepEqual(studioDraftContent(selection), studioDraftContent(published));
  selection.work[0].study.nativeDeck.documentHash = "changed-notes";
  assert.notDeepEqual(studioDraftContent(selection), studioDraftContent(published));
  assert.equal(published.work[0].study.nativeDeck.revision, 1);
});

test("shared backup retains original hosted media and owner content without altering the draft", async () => {
  const image = new Blob([new Uint8Array([0, 12, 255, 64])], { type: "image/png" });
  const draft = { work: [{ id: "case", image: "https://media.riteshk.work/original.png", study: { blocks: [{ type: "gallery", items: [{ src: "https://media.riteshk.work/original.png" }] }], authorSectionsEnc: { ct: "owner-content" } } }] };
  const before = structuredClone(draft), reads = [];
  const backup = await completeStudioBackup(draft, {
    decryptOwner: async () => ({ version: 1, caseStudyId: "case", blocks: [{ type: "gallery", off: true, items: [{ src: "https://media.riteshk.work/original.png" }] }, { type: "embed", src: "https://www.youtube-nocookie.com/embed/example" }] }),
    readAsset: async reference => { reads.push(reference); return image; }
  });
  assert.equal(backup.work[0].image, "data:image/png;base64,AAz/QA==");
  assert.equal(backup.work[0].study.blocks[0].items[0].src, backup.work[0].image);
  assert.equal(backup.work[0].study.blocks[0].off, true);
  assert.equal(backup.work[0].study.blocks[1].src, "https://www.youtube-nocookie.com/embed/example");
  assert.equal(reads.length, 1);
  assert.deepEqual(draft, before);
  await assert.rejects(completeStudioBackup({ work: [{ image: "https://media.riteshk.work/missing.png" }] }, { readAsset: async () => { throw new Error("Media missing"); } }), /Media missing/);
});