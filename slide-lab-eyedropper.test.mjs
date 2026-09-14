import test from "node:test";
import assert from "node:assert/strict";
import { openScreenEyeDropper, sampleCanvasColor, screenColorForCanvas } from "./src/js/slide-lab-eyedropper.mjs";

test("screen colours preserve visible slide backgrounds and account for dark canvas filters", context => {
  context.mock.method(globalThis, "getComputedStyle", element => element.style);
  const canvas = { style: { filter: "none" } };
  assert.equal(screenColorForCanvas("#a1b2c3", canvas), "#a1b2c3");
  canvas.style.filter = "invert(0.93) hue-rotate(180deg)";
  assert.equal(screenColorForCanvas("#ededed", canvas), "#000000");
  assert.equal(screenColorForCanvas("#ededed", canvas, true), "#ededed");
});

test("screen eyedropper opens immediately and applies only a valid selected screen pixel", async () => {
  const selected = [];
  let opened = false;
  const cancel = openScreenEyeDropper({ onSelect: color => selected.push(color), onCancel: () => assert.fail("unexpected cancel") }, {
    EyeDropper: class { open({ signal }) { opened = true; assert.equal(signal.aborted, false); return Promise.resolve({ sRGBHex: "#A1B2C3" }); } }
  });
  assert.equal(opened, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(selected, ["#a1b2c3"]);
  cancel();
});

test("screen eyedropper ignores late completion after cleanup and preserves unsupported fallback", async () => {
  let resolvePick, signal;
  const callbacks = { onSelect: () => assert.fail("late colour applied"), onCancel: () => assert.fail("late cancel") };
  assert.equal(openScreenEyeDropper(callbacks, {}), null);
  const cancel = openScreenEyeDropper(callbacks, {
    EyeDropper: class { open(options) { signal = options.signal; return new Promise(resolve => { resolvePick = resolve; }); } }
  });
  cancel();
  assert.equal(signal.aborted, true);
  resolvePick({ sRGBHex: "#112233" });
  await new Promise(resolve => setImmediate(resolve));
});

test("screen eyedropper cancellation and denial never change colour", async () => {
  for (const name of ["AbortError", "NotAllowedError", "InvalidStateError", "InvalidResult"]) {
    let cancelled = 0, errors = 0;
    openScreenEyeDropper({ onSelect: () => assert.fail("failed pick applied"), onCancel: () => cancelled++, onError: () => errors++ }, {
      EyeDropper: class { open() {
        if (name === "InvalidResult") return Promise.resolve({ sRGBHex: "transparent" });
        if (name === "InvalidStateError") throw new DOMException("Unavailable", name);
        return Promise.reject(new DOMException("Cancelled", name));
      } }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1);
    assert.equal(errors, name === "AbortError" ? 0 : 1);
  }
});

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