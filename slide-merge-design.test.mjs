import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const studio = postcss.parse(read("./css/admin.css"));
const dialogs = postcss.parse(read("./css/slide-merge-navigator.css"));
const controls = postcss.parse(read("./css/slide-merge-controls.css"));
function declarations(sheet, selector) {
  const rule = sheet.nodes.find(node => node.type === "rule" && node.selector === selector);
  assert.ok(rule, `Missing design rule: ${selector}`);
  return Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value.replace(/\s+/g, "")]));
}
function parity(target, targetSelector, sourceSelector, properties) {
  const expected = declarations(studio, sourceSelector), actual = declarations(target, targetSelector);
  for (const property of properties) assert.equal(actual[property], expected[property], `${targetSelector}: ${property} must match ${sourceSelector}`);
}

test("shared dialogs use the actual Studio surface and title contract", () => {
  parity(dialogs, ".merge-deck-dialog", ".pass__box", ["background", "border", "border-radius", "padding", "text-align", "box-shadow"]);
  parity(dialogs, ".merge-deck-dialog h2", ".pass__title", ["font-family", "font-weight", "font-size", "color"]);
  parity(dialogs, ".merge-deck-dialog footer button", ".btn", ["font-family", "font-size", "text-transform", "border-radius", "padding", "border", "transition"]);
  parity(dialogs, ".merge-deck-dialog footer .merge-dialog-primary", ".btn--primary", ["background", "border-color", "color", "font-weight", "box-shadow"]);
  parity(dialogs, ".merge-deck-dialog footer .merge-dialog-primary:hover:not(:disabled)", ".btn--primary:hover", ["background", "border-color", "color", "box-shadow"]);
  parity(dialogs, ".merge-deck-dialog>header>button", ".prep-dialog__x", ["top", "right", "background", "border", "color", "border-radius"]);
  parity(dialogs, ".merge-deck-dialog>header>button:hover", ".prep-dialog__x:hover", ["color", "background"]);
});

test("native engine dialogs are themed, not just recolored", () => {
  parity(controls, "html:has(.merge-shell) .excalidraw .Dialog__title", ".pass__title", ["font-family", "font-weight", "font-size", "color"]);
  parity(controls, "html:has(.merge-shell) .excalidraw .Modal__content", ".pass__box", ["background", "border", "border-radius", "padding", "box-shadow"]);
  parity(controls, "html:has(.merge-shell) .excalidraw .Dialog__close", ".prep-dialog__x", ["top", "right", "background", "border", "color", "border-radius"]);
});

test("labelled commands share Studio button anatomy without converting icon tools", () => {
  const command = controls.nodes.find(node => node.type === "rule").selector;
  parity(controls, command, ".btn", ["font-family", "font-size", "text-transform", "border-radius", "padding", "border", "background", "color", "transition"]);
  assert.doesNotMatch(command, /merge-tool-pop|merge-layer-panel|merge-layout-pick|input|slider/);
});

test("slide delete uses shared dialog, bin icon and safe default focus", () => {
  const editor = read("./src/js/slide-merge.jsx"), navigator = read("./src/js/slide-merge-navigator.jsx");
  assert.doesNotMatch(editor, /<dialog/);
  assert.match(editor, /<DeckDialog wide=\{false\} title="Delete this slide\?"/);
  assert.match(editor, /<ToolIcon name="trash" \/>Delete slide/);
  assert.match(navigator, /input:not\(:disabled\), footer button:not\(:disabled\)/);
});

test("narrow dialogs and wide tools retain their distinct Studio anatomy", () => {
  parity(dialogs, ".merge-deck-dialog", ".pass__box", ["width"]);
  parity(dialogs, ".merge-deck-dialog--wide", ".pass--wide .pass__box", ["width", "max-height", "text-align"]);
  parity(dialogs, ".merge-deck-dialog--wide footer button", ".pass--wide .pass__actions .btn", ["flex", "min-width"]);
  const navigator = read("./src/js/slide-merge-navigator.jsx");
  assert.match(navigator, /wide && <Action icon="close"/);
  assert.match(navigator, /<DeckDialog wide=\{false\} title=\{value/);
});

test("opacity uses the secondary slider token while primary sliders retain gold", () => {
  const tokens = declarations(controls, ".merge-shell");
  assert.equal(tokens["--ui-slider-primary"], "var(--accent)");
  assert.equal(tokens["--ui-slider-secondary"], "var(--text-dim)");
  assert.equal(declarations(controls, ".merge-shell .excalidraw .range-input")["--color-slider-track"], "var(--ui-slider-primary)");
  const secondary = controls.nodes.find(node => node.type === "rule" && node.selector.includes('[data-testid="opacity"]'));
  assert.equal(declarations(controls, secondary.selector)["--color-slider-track"], "var(--ui-slider-secondary)");
});