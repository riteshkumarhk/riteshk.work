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