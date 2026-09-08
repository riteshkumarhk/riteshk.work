import test from "node:test";
import assert from "node:assert/strict";
import { sampleCanvasColor } from "./src/js/slide-lab-eyedropper.mjs";

test("eyedropper uses bitmap scale, visible filter and opaque backdrop", context => {
  const draws = [];
  const surface = { fillRect() {}, drawImage(...args) { draws.push(args); }, getImageData() { return { data: [30, 44, 58, 255] }; } };
  context.mock.method(globalThis, "getComputedStyle", element => element.style);
  context.mock.method(globalThis.document, "createElement", () => ({ getContext: () => surface }));
  const canvas = { width: 400, height: 200, style: { filter: "invert(0.93) hue-rotate(180deg)" }, parentElement: { style: { backgroundColor: "rgb(8, 8, 10)" } }, getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 }) };
  assert.equal(sampleCanvasColor(canvas, 125, 60, true), "#1e2c3a");
  assert.deepEqual(draws[0].slice(1), [50, 20, 1, 1, 0, 0, 1, 1]);
  assert.equal(surface.filter, canvas.style.filter);
  assert.equal(surface.fillStyle, "rgb(8, 8, 10)");
  assert.equal(sampleCanvasColor(canvas, 99, 60), null);
  assert.equal(sampleCanvasColor(canvas, 300, 60), null);
  surface.getImageData = () => { throw new Error("SecurityError"); };
  assert.equal(sampleCanvasColor(canvas, 125, 60), null);
});

globalThis.getComputedStyle = () => ({});
globalThis.document = { createElement() {} };