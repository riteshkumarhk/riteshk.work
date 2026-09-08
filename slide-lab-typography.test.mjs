import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patchTypography } from "./slide-lab-typography.mjs";

const source = readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/index.js", import.meta.url), "utf8");

test("typography adapter preserves native mutation, bound-text and mixed-selection resolution", () => {
  const patched = patchTypography(source);
  const action = patched.slice(patched.indexOf("var actionChangeFontSize"), patched.indexOf("var actionDecreaseFontSize"));
  assert.ok(action.includes("return changeFontSize(elements, appState, app, () => value, value);"));
  assert.ok(action.includes("jsx34(LabFontSizePicker"));
  assert.ok(action.includes("useContainer: useExcalidrawContainer"));
  assert.ok(action.includes("const boundTextElement = getBoundTextElement("));
  assert.ok(action.includes("(hasSelection) => hasSelection ? null"));
  assert.ok(patched.includes("icon: jsx31(LabFontLibraryIcon, {})"));
  assert.ok(patched.includes('className: "lab-type-value"'));
});

test("typography adapter fails closed when native boundaries or triggers change", () => {
  assert.throws(() => patchTypography(source.replace("var actionChangeFontSize =", "var renamedAction =")), /boundary/);
  assert.throws(() => patchTypography(source.replace('title: t("labels.showFonts"),', 'title: "Changed",')), /anchor/);
});