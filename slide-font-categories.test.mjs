import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FONT_TABS, FONT_GROUPS, filterFontCategory } from "./src/js/slide-font-categories.mjs";
import { patchFontPicker } from "./slide-lab-font-picker.mjs";

const catalogue = JSON.parse(readFileSync(new URL("./src/generated/slide-fonts.json", import.meta.url)));
const fonts = catalogue.map(font => ({ value: font.id, text: font.family }));
test("all hosted fonts have exactly one category and requested tab order", () => {
  const names = Object.values(FONT_GROUPS).flat();
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.toSorted(), fonts.map(font => font.text).toSorted());
  assert.deepEqual(FONT_TABS.map(tab => tab[0]), ["scene", "serif", "sans", "display", "mono", "handwritten"]);
});
test("scene membership, category and search intersect without hiding used category fonts", () => {
  const inter = fonts.find(font => font.text === "Inter");
  const scene = new Set([inter.value]);
  assert.deepEqual(filterFontCategory(fonts, scene, "scene"), [inter]);
  assert.deepEqual(filterFontCategory(fonts, scene, "sans", " INTER ").map(font => font.text), ["Inter", "Inter Tight"]);
  assert.equal(filterFontCategory(fonts, scene, "serif", "Inter").length, 0);
  assert.equal(filterFontCategory(fonts, new Set(), "scene").length, 0);
  for (const [category, names] of Object.entries(FONT_GROUPS)) assert.deepEqual(filterFontCategory(fonts, scene, category).map(font => font.text).toSorted(), names.toSorted());
});
test("font adapter patches the pinned native picker and fails on changed anchors", () => {
  const source = readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/index.js", import.meta.url), "utf8");
  const result = patchFontPicker(source);
  assert.ok(result.includes("labFilterFontCategory(allFonts, sceneFamilies, fontCategory, searchTerm)"));
  assert.ok(result.includes('role: "tabpanel"'));
  assert.throws(() => patchFontPicker(source.replace('const groups = [];', 'const groups = null;')), /anchor changed/);
});