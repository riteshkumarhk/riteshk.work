import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHex, hexToRgb, rgbToHex, customColorList } from "./src/js/slide-lab-color.mjs";

test("hex and RGB roundtrip, shorthand and channel limits", () => {
  assert.equal(normalizeHex("AbC"), "#aabbcc");
  assert.deepEqual(hexToRgb("#e03131"), [224, 49, 49]);
  assert.equal(rgbToHex([224, 49, 49]), "#e03131");
  assert.equal(rgbToHex([-12, 256, 12.6]), "#00ff0d");
  assert.equal(rgbToHex(["", 0, 1]), null);
  assert.equal(rgbToHex([NaN, 0, 1]), null);
  assert.equal(normalizeHex("transparent"), null);
  assert.equal(normalizeHex({}), null);
});

test("custom swatches normalize, deduplicate, exclude presets and cap at five", () => {
  assert.deepEqual(customColorList(["#ABC", "#aabbcc", "transparent", "#123456", "#000000"], ["#000"]), ["#aabbcc", "#123456"]);
  assert.equal(customColorList(["#111", "#222", "#333", "#444", "#555", "#666"]).length, 5);
});