const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const editor = fs.readFileSync(path.join(__dirname, "src/js/admin-studio.js"), "utf8");
const player = fs.readFileSync(path.join(__dirname, "src/js/project.js"), "utf8");

function loadFunction(context, name, source = editor, indent = "  ") {
  const start = source.indexOf(indent + "function " + name + "(");
  assert.notEqual(start, -1, name + " exists");
  const lineEnd = source.indexOf("\n", start);
  const firstLine = source.slice(start, lineEnd).trimEnd();
  const end = firstLine.endsWith("}") ? lineEnd : source.indexOf("\n" + indent + "}", lineEnd) + indent.length + 2;
  assert.ok(end > start, name + " has a function boundary");
  vm.runInContext(source.slice(start, end), context);
}

test("project unlock applies only to its original current view", async () => {
  for (const change of ["none", "navigate", "close", "relock", "replace", "blocks", "edit"]) {
    const original = { id: "first", title: "Synthetic project", study: { unlockHash: "verified", blocks: [] } };
    let work = original, release, options;
    const unlocked = [], rendered = [];
    const context = vm.createContext({
      AbortController, activeId: work.id, projectGeneration: 1, projectUnlock: null, vaultResolving: {}, vaultTried: {},
      workById: () => work, plain: value => value, passModal: value => { options = value; },
      sha256: () => new Promise(resolve => { release = resolve; }),
      setUnlocked: id => unlocked.push(id), fillContent: value => rendered.push(value.id)
    });
    loadFunction(context, "cancelProjectRequests", player);
    loadFunction(context, "unlockFlow", player);
    context.unlockFlow();
    const result = options.onSubmit("synthetic", { textContent: "" });
    if (change === "navigate") context.activeId = "second";
    if (change === "close" || change === "relock") context.cancelProjectRequests();
    if (change === "replace") work = { ...original, study: { ...original.study } };
    if (change === "blocks") work.study.blocks = [{ heading: "New content" }];
    if (change === "edit") work.study.blocks.push({ heading: "New content" });
    release("verified");
    assert.equal(await result, change === "none");
    assert.deepEqual(unlocked, change === "none" ? ["first"] : []);
    assert.deepEqual(rendered, change === "none" ? ["first"] : []);
  }
});

test("cancelled vault unlock does not mutate original protected blocks", async () => {
  const work = { id: "first", title: "Synthetic project", study: { blocks: [{ locked: true, vaultBlock: "private-pointer" }] } };
  const original = JSON.stringify(work);
  let options, release, requested;
  const context = vm.createContext({
    AbortController, activeId: work.id, projectGeneration: 1, projectUnlock: null, vaultResolving: {}, vaultTried: {},
    workById: () => work, plain: value => value, passModal: value => { options = value; },
    window: { RK: { vaultRedeem: async () => true } },
    resolveVaultBlocks: async pending => { requested = pending; await new Promise(resolve => { release = resolve; }); pending.study.blocks = [{ locked: true, body: "Private text" }]; return 1; },
    setUnlocked: () => assert.fail("Cancelled unlock must not update access"), fillContent: () => assert.fail("Cancelled unlock must not render")
  });
  loadFunction(context, "cancelProjectRequests", player);
  loadFunction(context, "unlockFlow", player);
  context.unlockFlow();
  const completion = options.onSubmit("synthetic", { textContent: "" });
  await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(requested.study, work.study);
  context.cancelProjectRequests();
  release();
  assert.equal(await completion, false);
  assert.equal(JSON.stringify(work), original);
});

test("protected block loading bounds concurrency and preserves partial success for retry", async () => {
  const { loadProtectedBlocks } = await import("./src/js/project-recovery.mjs");
  const blocks = Array.from({ length: 6 }, (_, index) => ({ locked: true, vaultBlock: String(index) }));
  const before = JSON.stringify(blocks), pending = [];
  let active = 0, peak = 0;
  const completion = loadProtectedBlocks(blocks, {
    sign: async key => "https://synthetic.test/" + key,
    fetch: async url => { active++; peak = Math.max(peak, active); await new Promise(resolve => pending.push(resolve)); active--; return url.endsWith("/2") ? new Response("", { status: 503 }) : Response.json({ type: "text", body: url.slice(-1) }); }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 3);
  pending.splice(0).forEach(resolve => resolve());
  await new Promise(resolve => setImmediate(resolve));
  pending.splice(0).forEach(resolve => resolve());
  const result = await completion;
  assert.equal(peak, 3);
  assert.equal(result.resolved, 5);
  assert.deepEqual(result.failures, [{ index: 2, kind: "server", status: 503 }]);
  assert.equal(JSON.stringify(blocks), before);
  let retryCalls = 0;
  const retried = await loadProtectedBlocks(result.blocks, { sign: async () => "https://synthetic.test/retry", fetch: async () => { retryCalls++; return Response.json({ type: "text", body: "Recovered" }); } });
  assert.equal(retryCalls, 1);
  assert.equal(retried.resolved, 1);
  assert.equal(retried.blocks[2].body, "Recovered");
  assert.equal(retried.blocks[1], result.blocks[1]);
});

test("protected loading times out stuck signing and rejects cancelled results", async () => {
  const { loadProtectedBlocks } = await import("./src/js/project-recovery.mjs");
  const blocks = [{ locked: true, vaultBlock: "synthetic" }];
  const timeout = await loadProtectedBlocks(blocks, { sign: () => new Promise(() => {}), timeout: 5 });
  assert.equal(timeout.failures[0].kind, "timeout");
  const controller = new AbortController();
  const cancelled = loadProtectedBlocks(blocks, { signal: controller.signal, sign: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
});

test("automatic protected loading supports explicit retry and rejects revoked access", async () => {
  const work = { id: "first", study: { blocks: [{ locked: true, vaultBlock: "pointer" }] } };
  let finish, attempts = 0, authorized = true;
  const context = vm.createContext({
    AbortController, activeId: work.id, projectGeneration: 1, projectUnlock: null, workById: () => work,
    vaultResolving: {}, vaultTried: {}, vaultErrors: {}, viewerAccessKey: () => "synthetic-access", viewerAuthorized: () => authorized,
    fillContent() {}, setUnlocked() {},
    resolveVaultBlocks: async pending => { attempts++; await new Promise(resolve => { finish = resolve; }); if (attempts > 1) pending.study.blocks = [{ body: "Protected", locked: true }]; return attempts > 1 ? 1 : 0; }
  });
  loadFunction(context, "autoResolveVaultBlocks", player);
  context.projectUnlock = new AbortController();
  assert.equal(context.autoResolveVaultBlocks(work), undefined);
  assert.equal(attempts, 0);
  context.projectUnlock = null;
  const first = context.autoResolveVaultBlocks(work); finish(); await first;
  assert.equal(context.autoResolveVaultBlocks(work), undefined);
  const retry = context.autoResolveVaultBlocks(work, true);
  authorized = false;
  finish(); await retry;
  assert.equal(attempts, 2);
  assert.equal(work.study.blocks[0].vaultBlock, "pointer");
  authorized = true;
  const changed = context.autoResolveVaultBlocks(work, true);
  work.study.blocks[0].heading = "Newer edit";
  finish(); await changed;
  assert.equal(work.study.blocks[0].vaultBlock, "pointer");
  assert.equal(work.study.blocks[0].heading, "Newer edit");
  loadFunction(context, "cancelProjectRequests", player);
  const navigating = context.autoResolveVaultBlocks(work, true), finishObsolete = finish;
  context.activeId = "second";
  context.cancelProjectRequests();
  assert.equal(context.vaultTried.first, undefined);
  context.activeId = "first";
  const reopened = context.autoResolveVaultBlocks(work);
  assert.ok(reopened);
  finish(); await reopened;
  work.study.blocks[0].heading = "Current loaded section";
  finishObsolete(); await navigating;
  assert.equal(work.study.blocks[0].heading, "Current loaded section");
});

test("case-study playback requires saved slides and never generates a deck", () => {
  const context = vm.createContext({
    hasNativeDeck: work => !!(work?.study?.nativeDeck || work?.study?.nativeDeckEnc || work?.study?.nativeDeckPublic || work?.study?.nativeDeckDocument),
    nativePublicDeck: work => work.study?.slidesPublic ? work.study.nativeDeckPublic : null,
    PREVIEW: false,
    pjAutoSlides: () => { throw new Error("Playback must not generate slides"); }
  });
  loadFunction(context, "pjHasSavedDeck", player);
  loadFunction(context, "pjDeckPublic", player);
  loadFunction(context, "pjDeckSlides", player, "    ");
  const sections = [{ type: "text", heading: "Not a saved slide" }];
  for (const study of [{ blocks: sections }, { blocks: sections, slides: [] }, { slides: [{ hidden: true }] }, { nativeDeck: { slideCount: 0 } }]) {
    assert.equal(context.pjHasSavedDeck({ study }), false);
    assert.equal(context.pjDeckSlides({ study }, study).length, 0);
  }
  for (const deck of [
    { slides: [{ layout: "text", slots: { title: "Approved" } }] },
    { nativeDeck: { slideCount: 2 } },
    { nativeDeckDocument: { slides: [{ id: "approved" }] } },
    { slidesEnc: { ct: "sealed" } }, { slidesOwnerEnc: { ct: "sealed" } }, { nativeDeckEnc: { ct: "sealed" } }
  ]) {
    const work = { study: { ...deck, slidesPublic: false } };
    assert.equal(context.pjHasSavedDeck(work), true);
    assert.equal(context.pjDeckPublic(work), false);
  }
  const publicWork = { study: { slidesPublic: true, slides: [{ layout: "text" }, { hidden: true }] } };
  assert.equal(context.pjDeckPublic(publicWork), true);
  assert.equal(context.pjDeckSlides(publicWork, publicWork.study).length, 1);
  const nativeWork = { study: { slidesPublic: true, nativeDeckPublic: { slides: [{ id: "published" }] } } };
  assert.equal(context.pjHasSavedDeck(nativeWork), true);
  assert.equal(context.pjDeckPublic(nativeWork), true);
  assert.match(player, /classList\.toggle\("pj--canpresent", pjIsOwner\(\) && pjHasSavedDeck\(w\)\)/);
});

function fixture() {
  const state = {
    openStudy: 0, openSlide: 0, l2Tab: "slides", slideView: "current",
    freeSel: null, freeDrag: null, freeCheatEl: null, freeLastDown: null,
    freeClipboard: null, freeEditing: null, blocked: false, saves: [], renders: 0,
    data: { work: [{ study: { slides: [
      { layout: "free", blocks: [{ kind: "shape", x: 10, y: 20 }, { kind: "shape", x: 50, y: 40, lock: true }] },
      { layout: "free", blocks: [{ kind: "text", text: "Second slide", x: 8, y: 8 }] }
    ] } }] },
    document: { querySelector: () => state.blocked },
    window: { removeEventListener() {} },
    root: {}, cancelAnimationFrame() {}, onFreeMove() {},
    histPush() {}, status() {}, freeCleanGroups() {}, freeCtxClose() {},
    saveDraft: immediate => state.saves.push(immediate),
    renderL2: () => state.renders++,
    freeExpandToGroups: (blocks, ids) => ids,
    freeCheatToggle: () => { state.freeCheatEl = null; }
  };
  const context = vm.createContext(state);
  for (const name of ["fnum", "slideBlocks", "freeSelOn", "freeSelSet", "freeBlk", "onFreeKey", "freeCtxRun", "freeCancelDrag", "onFreeUp", "onFreeFieldEdit"]) loadFunction(context, name);
  return context;
}

function key(keyName, options = {}) {
  return {
    key: keyName, prevented: false,
    target: { tagName: "DIV", closest: () => true },
    preventDefault() { this.prevented = true; }, ...options
  };
}

test("selection belongs to the visible slide and its current blocks", () => {
  const context = fixture();
  context.freeSelSet(0, 0, [0]);
  context.openSlide = 1;
  context.onFreeKey(key("Delete"));
  assert.equal(context.slideBlocks(0, 0).length, 2);
  context.data.work[0].study.slides.reverse();
  assert.equal(context.freeSelOn(0, 0), false);
});

test("presentation and modal ownership block editor shortcuts", () => {
  const context = fixture();
  context.freeSelSet(0, 0, [0]);
  context.blocked = true;
  for (const command of [key("ArrowRight"), key("Delete"), key("v", { ctrlKey: true })]) context.onFreeKey(command);
  assert.equal(context.slideBlocks(0, 0)[0].x, 10);
  assert.equal(context.slideBlocks(0, 0).length, 2);
  assert.equal(context.saves.length, 0);
});

test("toolbar Tab and deselected canvas Tab retain native navigation", () => {
  const context = fixture();
  context.freeSelSet(0, 0, [0]);
  const toolbar = key("Tab", { target: { tagName: "BUTTON", closest: () => null } });
  context.onFreeKey(toolbar);
  assert.equal(toolbar.prevented, false);
  context.freeSel = null;
  const canvas = key("Tab");
  context.onFreeKey(canvas);
  assert.equal(canvas.prevented, false);
});

test("nudges use slide pixels and immediately commit and refresh", () => {
  const context = fixture();
  context.freeSelSet(0, 0, [0, 1]);
  context.onFreeKey(key("ArrowRight"));
  context.onFreeKey(key("ArrowDown", { shiftKey: true }));
  assert.equal(context.slideBlocks(0, 0)[0].x, 10 + 100 / 1280);
  assert.equal(context.slideBlocks(0, 0)[0].y, 20 + 1000 / 720);
  assert.equal(context.slideBlocks(0, 0)[1].x, 50);
  assert.deepEqual(context.saves, [true, true]);
  assert.equal(context.renders, 2);
});

test("cut and inspector delete preserve locked blocks", () => {
  for (const action of ["cut", "del"]) {
    const context = fixture();
    context.freeSelSet(0, 0, [0, 1]);
    context.freeCtxRun(action, 0, 0, 0);
    assert.equal(context.slideBlocks(0, 0).length, 1);
    assert.equal(context.slideBlocks(0, 0)[0].lock, true);
  }
});

test("locked geometry rejects field edits even without disabled markup", () => {
  const context = fixture();
  const field = { dataset: { fi: "0", fk: "0", fbi: "1", freefield: "x" }, value: "70" };
  context.onFreeFieldEdit(field);
  assert.equal(context.slideBlocks(0, 0)[1].x, 50);
  assert.equal(field.value, 50);
  assert.equal(context.saves.length, 0);
});

test("Escape restores resize state without recording a change", () => {
  const context = fixture();
  const original = JSON.parse(JSON.stringify(context.slideBlocks(0, 0)));
  context.slideBlocks(0, 0)[0].h = 80;
  context.freeDrag = { i: 0, k: 0, mode: "resize", original, raf: 1 };
  context.onFreeKey(key("Escape"));
  assert.equal(context.slideBlocks(0, 0)[0].h, undefined);
  assert.equal(context.freeDrag, null);
  assert.equal(context.saves.length, 0);
});

test("pointer release flushes the final pending animation frame", () => {
  const context = fixture();
  let flushed = false;
  context.freeFrame = () => { flushed = true; };
  context.freeDrag = { mode: "rotate", moved: true, raf: 1 };
  context.onFreeUp();
  assert.equal(flushed, true);
  assert.equal(context.freeDrag, null);
  assert.deepEqual(context.saves, [true]);
});

test("Undo captures a pending edit before stepping backward", () => {
  const context = fixture();
  const calls = [];
  context.histIndex = 1;
  context.histPush = () => { calls.push("capture"); context.histIndex++; };
  context.histRestore = index => calls.push(index);
  loadFunction(context, "histUndo");
  context.histUndo();
  assert.deepEqual(calls, ["capture", 1]);
});

test("freeform presenter titles use content, not the layout identifier", () => {
  const context = vm.createContext({ pjPlain: value => String(value || "") });
  loadFunction(context, "pjSlideTitle", player, "    ");
  assert.equal(context.pjSlideTitle({ layout: "free", blocks: [{ kind: "shape" }, { kind: "text", text: "Decision and impact" }] }), "Decision and impact");
  assert.equal(context.pjSlideTitle({ layout: "free", blocks: [] }), "Untitled slide");
});