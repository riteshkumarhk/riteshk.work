import test from "node:test";
import assert from "node:assert/strict";
import { layerRows, layerName, layerTargets, layerPropertyChanges, layerMoveTargets, reorderLayerElements } from "./src/js/slide-merge-layers.mjs";

const elements = [{ id: "lab-slide", type: "frame" }, { id: "shape", type: "rectangle", opacity: 45, locked: false }, { id: "label", type: "text", text: "Bound label", containerId: "shape", opacity: 80, locked: true }, { id: "gone", isDeleted: true }];
const stepLayer = (scene, action, targets) => {
  const moving = scene.filter(element => targets.has(element.id)), rest = scene.filter(element => !targets.has(element.id));
  const start = scene.findIndex(element => targets.has(element.id));
  const insertion = action === "bringToFront" ? rest.length : start - 1;
  return [...rest.slice(0, insertion), ...moving, ...rest.slice(insertion)];
};
test("drag reorder follows visual top-to-bottom order without changing elements", () => {
  const scene = [{ id: "lab-slide", type: "frame" }, ...["bottom", "middle", "top"].map(id => ({ id, type: "rectangle", customData: { note:id } }))];
  const moved = reorderLayerElements(scene, "bottom", "top", "before", stepLayer);
  assert.deepEqual(layerRows(moved).map(element => element.id), ["bottom", "top", "middle"]);
  assert.deepEqual(layerRows(reorderLayerElements(moved, "bottom", "middle", "after", stepLayer)).map(element => element.id), ["top", "middle", "bottom"]);
  assert.deepEqual(scene.map(element => element.id), ["lab-slide", "bottom", "middle", "top"]);
  assert.equal(moved.find(element => element.id === "bottom"), scene[1]);
});
test("dragging a bound label or group member moves its complete unit", () => {
  const scene = [...elements.slice(0, 3).map(element => ({ ...element, groupIds: element.id === "shape" ? ["inner", "outer"] : [] })), { id:"peer", groupIds:["outer"] }, { id:"top" }];
  assert.deepEqual([...layerMoveTargets(scene, "label")].sort(), ["label", "peer", "shape"]);
  const moved = reorderLayerElements(scene, "label", "top", "before", stepLayer);
  assert.deepEqual(moved.map(element => element.id), ["lab-slide", "top", "shape", "label", "peer"]);
  assert.equal(reorderLayerElements(scene, "label", "peer", "after", stepLayer), scene);
});
test("multi-selection reorder preserves relative order and expands bound groups", () => {
  const scene = ["one", "two", "three", "four", "five"].map(id => ({id}));
  const moved = reorderLayerElements(scene, ["one", "three"], "five", "before", stepLayer);
  assert.deepEqual(moved.map(element => element.id), ["two", "four", "five", "one", "three"]);
  assert.equal(reorderLayerElements(scene, ["one", "three"], "three", "after", stepLayer), scene);
  assert.deepEqual([...layerMoveTargets([...elements, {id:"other"}], ["label", "other", "lab-slide", "gone"])].sort(), ["label", "other", "shape"]);
});
test("multi-selection can gather around a destination between its selected layers", () => {
  const scene = ["one", "two", "three", "four", "five"].map(id => ({id}));
  const actions = [];
  const moved = reorderLayerElements(scene, ["one", "five"], "three", "before", (current, action, targets) => {
    actions.push(action);
    return stepLayer(current, action, targets);
  });
  assert.deepEqual(moved.map(element => element.id), ["two", "three", "one", "five", "four"]);
  assert.equal(actions[0], "bringToFront");
  assert.ok(actions.slice(1).every(action => action === "sendBackward"));
  assert.deepEqual(reorderLayerElements(scene, ["one", "five"], "three", "after", stepLayer).map(element => element.id), ["two", "one", "five", "three", "four"]);
});
test("reorder ignores stale targets, invalid edges, no-ops and unsupported native moves", () => {
  assert.equal(reorderLayerElements(elements, "lab-slide", "shape", "before", stepLayer), elements);
  assert.equal(reorderLayerElements(elements, "shape", "gone", "before", stepLayer), elements);
  assert.equal(reorderLayerElements(elements, "shape", "label", "before", stepLayer), elements);
  const scene = [{id:"one"}, {id:"two"}];
  assert.equal(reorderLayerElements(scene, "one", "two", "after", stepLayer), scene);
  assert.equal(reorderLayerElements(scene, "one", "two", "bad", stepLayer), scene);
  assert.equal(reorderLayerElements(scene, "one", "two", "before", current => current), scene);
});
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