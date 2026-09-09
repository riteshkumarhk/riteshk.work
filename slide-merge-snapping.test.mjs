import test from "node:test";
import assert from "node:assert/strict";
import { configureSlideSnapping, slideSnapTargets, slideReferencePoints } from "./src/js/slide-merge-snapping.mjs";
import { patchSlideSnapping } from "./slide-lab-snapping.mjs";
import { readFile } from "node:fs/promises";

test("slide edges and centers are always available", () => {
  assert.deepEqual(slideSnapTargets(), { x: [0, 640, 1280], y: [0, 360, 720] });
});
test("layout grid, ruler ticks and guide presets contribute targets", () => {
  const targets = slideSnapTargets({ grid: true, rulers: true, margins: true, thirds: true, guides: [{ axis: "x", position: 225.5 }] });
  for (const position of [20, 100, 1200, 64, 1216, 1280 / 3, 225.5]) assert.ok(targets.x.some(value => Math.abs(value - position) < 1e-8));
  for (const position of [20, 100, 700, 36, 684, 240, 480]) assert.ok(targets.y.some(value => Math.abs(value - position) < 1e-8));
  assert.ok(!targets.x.includes(76.8) && !targets.x.includes(128));
});
test("guide switch excludes guides and presets without disabling slide or grid", () => {
  const targets = slideSnapTargets({ guidesEnabled: false, margins: true, thirds: true, guides: [{ axis: "x", position: 225.5 }] });
  assert.deepEqual(targets, slideSnapTargets());
});
test("native adapter is scoped to registered frames without document metadata", () => {
  const frame = { id: "lab-slide", x: 0, y: 0 };
  const original = JSON.stringify(frame);
  assert.deepEqual(slideReferencePoints([frame]), []);
  configureSlideSnapping(frame, { guides: [{ axis: "y", position: 225.5 }] });
  assert.ok(slideReferencePoints([frame]).some(point => point[1] === 225.5));
  assert.equal(JSON.stringify(frame), original);
  assert.deepEqual(slideReferencePoints([{ ...frame }]), []);
  assert.ok(slideReferencePoints([frame]).flat().every(Number.isFinite));
});

test("engine adapter extends native move, resize and creation targets and fails closed on drift", async () => {
  const source = await readFile(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js", import.meta.url), "utf8");
  const patched = patchSlideSnapping(source);
  assert.match(patched, /concat\(slidePoints\)/);
  assert.match(patched, /labSlideSnappingEnabled/);
  assert.throws(() => patchSlideSnapping("changed engine"), /anchor changed/);
});