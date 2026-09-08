import test from "node:test";
import assert from "node:assert/strict";
import { layerRows, layerName, layerTargets, layerPropertyChanges } from "./src/js/slide-merge-layers.mjs";

const elements = [{ id: "lab-slide", type: "frame" }, { id: "shape", type: "rectangle", opacity: 45, locked: false }, { id: "label", type: "text", text: "Bound label", containerId: "shape", opacity: 80, locked: true }, { id: "gone", isDeleted: true }];
test("layer order excludes the frame and deleted elements", () => {
  assert.deepEqual(layerRows(elements).map(element => element.id), ["label", "shape"]);
  assert.equal(layerName(elements[2]), "Bound label");
  assert.deepEqual([...layerTargets(elements, ["shape", "lab-slide"])], ["shape", "label"]);
});
test("hide and show restore each element's original opacity and lock", () => {
  const changes = layerPropertyChanges(elements, ["shape"], "hide", true);
  const hidden = elements.map(element => ({ ...element, ...changes.get(element.id) }));
  const restored = layerPropertyChanges(hidden, ["shape"], "hide", false);
  assert.equal(hidden[1].opacity, 0);
  assert.equal(hidden[1].locked, true);
  assert.equal(restored.get("shape").opacity, 45);
  assert.equal(restored.get("shape").locked, false);
  assert.equal(restored.get("label").opacity, 80);
  assert.equal(restored.get("label").locked, true);
  assert.equal(restored.get("shape").customData.labLayerHidden, undefined);
});
test("hidden-layer lock edits survive showing the layer", () => {
  const layer = { ...elements[1], opacity: 0, locked: true, customData: { labLayerHidden: { opacity: 45, locked: false } } };
  const locked = { ...layer, ...layerPropertyChanges([layer], [layer.id], "lock", true).get(layer.id) };
  assert.equal(layerPropertyChanges([locked], [layer.id], "hide", false).get(layer.id).locked, true);
  assert.equal(layerPropertyChanges(elements, ["lab-slide"], "rename", "Bad").size, 0);
  assert.equal(layerPropertyChanges(elements, ["shape"], "rename", "  Flow  ").get("shape").customData.labLayerName, "Flow");
  assert.equal(layerPropertyChanges(elements, ["shape"], "rename", "Flow").has("label"), false);
});

test("showing a container does not reveal independently hidden text", () => {
  const hiddenLabel = { ...elements[2], ...layerPropertyChanges(elements, ["label"], "hide", true).get("label") };
  const scene = [elements[0], elements[1], hiddenLabel];
  const hideShape = layerPropertyChanges(scene, ["shape"], "hide", true);
  const hidden = scene.map(element => ({ ...element, ...hideShape.get(element.id) }));
  assert.equal(layerPropertyChanges(hidden, ["shape"], "hide", false).has("label"), false);
});