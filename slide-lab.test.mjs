import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAME_ID, fixtureSkeleton, frameReport, packScene, selectedLabels, labelColorUpdate, preserveLabelColors } from "./src/js/slide-lab-core.mjs";

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

const colorScene = () => [
  { id: "shape", type: "rectangle", strokeColor: "#e03131", version: 1 },
  { id: "label", type: "text", containerId: "shape", strokeColor: "#27343a", version: 1, customData: { fixture: "keep" } },
  { id: "plain", type: "text", strokeColor: "#000000", version: 1 }
];
test("bound-label selection excludes plain text and locked or deleted containers", () => {
  const scene = colorScene();
  assert.deepEqual(selectedLabels(scene, { shape: true, plain: true }).map(element => element.id), ["label"]);
  assert.equal(selectedLabels(scene, { label: true }).length, 1);
  assert.equal(selectedLabels([{ ...scene[0], locked: true }, ...scene.slice(1)], { shape: true }).length, 0);
  assert.equal(selectedLabels([{ ...scene[0], isDeleted: true }, ...scene.slice(1)], { label: true }).length, 0);
});
test("unlink preserves current text colour; relink adopts the current outline", () => {
  const scene = colorScene();
  const unlinked = labelColorUpdate(scene, ["label"], "unlink");
  assert.equal(unlinked[1].strokeColor, "#27343a");
  assert.equal(unlinked[1].customData.labTextColor, "#27343a");
  assert.equal(unlinked[1].customData.fixture, "keep");
  assert.equal(unlinked[0], scene[0]);
  const blue = labelColorUpdate(unlinked, ["label"], "#1971c2");
  const linked = labelColorUpdate(blue, ["label"], null);
  assert.equal(linked[1].strokeColor, scene[0].strokeColor);
  assert.equal(linked[1].customData.labTextColor, null);
  assert.equal(scene[1].customData.labTextColor, undefined);
});
test("outline propagation cannot overwrite saved independent colour, and repair is idempotent", () => {
  const scene = labelColorUpdate(colorScene(), ["label"], "#1971c2");
  const propagated = scene.map(element => ({ ...element, strokeColor: "#2f9e44" }));
  const repaired = preserveLabelColors(JSON.parse(JSON.stringify(propagated)));
  assert.equal(repaired[0].strokeColor, "#2f9e44");
  assert.equal(repaired[1].strokeColor, "#1971c2");
  assert.equal(repaired[2].strokeColor, "#2f9e44");
  assert.equal(preserveLabelColors(repaired), repaired);
  assert.equal(preserveLabelColors(colorScene())[1].strokeColor, "#27343a");
});