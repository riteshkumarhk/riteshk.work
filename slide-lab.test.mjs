import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAME_ID, fixtureSkeleton, frameReport, packScene } from "./src/js/slide-lab-core.mjs";

test("fixtures keep stable IDs and one 1280 by 720 slide boundary", () => {
  for (const scenario of ["flow", "compatibility", "dense", "stress"]) {
    const elements = fixtureSkeleton(scenario);
    assert.equal(new Set(elements.map(element => element.id)).size, elements.length);
    const frame = elements.at(-1);
    assert.equal(frame.id, FRAME_ID);
    assert.equal(frame.width, 1280); assert.equal(frame.height, 720);
    assert.deepEqual(frame.children, elements.slice(0, -1).map(element => element.id));
  }
});
test("stress fixtures contain their advertised object counts", () => {
  assert.equal(fixtureSkeleton("dense").length - 1, 200);
  assert.equal(fixtureSkeleton("stress").length - 1, 1000);
});
test("flow arrows refer to existing nodes", () => {
  const elements = fixtureSkeleton("flow");
  const ids = new Set(elements.map(element => element.id));
  for (const arrow of elements.filter(element => element.type === "arrow")) {
    assert.ok(ids.has(arrow.start.id)); assert.ok(ids.has(arrow.end.id));
  }
});
test("draft envelope keeps file bytes and excludes transient collaboration and selection", () => {
  const files = { original: { dataURL: "data:image/png;base64,AABB" } };
  const packed = packScene([], files, { zoom: { value: 1 }, scrollX: 0, selectedElementIds: { private: true }, collaborators: new Map() });
  assert.equal(packed.files, files);
  assert.equal(packed.appState.selectedElementIds, undefined);
  assert.equal(packed.appState.collaborators, undefined);
  assert.equal(JSON.parse(JSON.stringify(packed)).files.original.dataURL, files.original.dataURL);
});
test("performance report exposes frame tails without pretending to measure input latency", () => {
  assert.deepEqual(frameReport([]), { samples: 0, medianMs: null, p95Ms: null, over34Ms: 0, longTasks: 0, longestTaskMs: 0 });
  const report = frameReport([16, 17, 80, 16], [55]);
  assert.equal(report.p95Ms, 80); assert.equal(report.over34Ms, 1); assert.equal(report.longTasks, 1);
});