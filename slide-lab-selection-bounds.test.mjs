import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patchSelectionBounds } from "./slide-lab-selection-bounds.mjs";

const renderer = patchSelectionBounds(readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/index.js", import.meta.url), "utf8"), "renderer");
const geometry = patchSelectionBounds(readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js", import.meta.url), "utf8"), "handles");
const renderSource = renderer.slice(renderer.indexOf("var renderSelectionBorder ="), renderer.indexOf("var renderBindingHighlight ="));
const handleSource = geometry.slice(geometry.indexOf("var getTransformHandlesFromCoords ="), geometry.indexOf("var getTransformHandles ="));

test("selection outline matches true bounds at every zoom", () => {
  const calls = [];
  const render = new Function("strokeRectWithRotation", `${renderSource}; return renderSelectionBorder;`)((...args) => calls.push(args.slice(1)));
  const context = { save() {}, restore() {}, translate() {}, setLineDash() {} };
  for (const zoom of [.25, .5, 1, 2]) {
    render(context, { zoom: { value: zoom }, scrollX: 13, scrollY: -7 }, { x1: 100, y1: 80, x2: 500, y2: 180, cx: 300, cy: 130, angle: .3, selectionColors: ["#abc"], dashed: false });
    assert.deepEqual(calls.at(-1), [100, 80, 400, 100, 300, 130, .3]);
  }
  assert.ok(renderer.includes("const dashedLinePadding = 0;"));
});

test("mouse and touch handle centers sit on the same bounds without shrinking hit targets", () => {
  const sizes = { mouse: 8, touch: 28 };
  const handles = new Function("transformHandleSizes", "generateTransformHandle", "ROTATION_RESIZE_HANDLE_GAP", `${handleSource}; return getTransformHandlesFromCoords;`)(sizes, (...args) => args.slice(0, 4), 16);
  for (const zoom of [.25, .5, 1, 2]) {
    for (const pointer of ["mouse", "touch"]) {
      const result = handles([100, 80, 500, 380, 300, 230], 0, { value: zoom }, pointer);
      for (const [key, expected] of [["nw", [100, 80]], ["ne", [500, 80]], ["sw", [100, 380]], ["se", [500, 380]]]) {
        const [left, top, width, height] = result[key];
        assert.deepEqual([left + width / 2, top + height / 2], expected);
        assert.equal(width * zoom, sizes[pointer]);
        assert.equal(height * zoom, sizes[pointer]);
      }
    }
  }
  assert.ok(geometry.includes("const margin = 0;"));
});

test("upstream changes fail closed instead of applying a partial geometry patch", () => {
  assert.throws(() => patchSelectionBounds("changed upstream", "renderer"), /anchor changed/);
  assert.throws(() => patchSelectionBounds("changed upstream", "handles"), /anchor changed/);
});