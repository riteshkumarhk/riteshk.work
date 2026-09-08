import test from "node:test";
import assert from "node:assert/strict";
import { captureLayout, instantiateLayout } from "./src/js/slide-merge-layouts.mjs";

const scene = {
  elements: [
    { id: "lab-slide", type: "frame", customData: { slideSettings: { background: { color: "#fff" } } } },
    { id: "box", type: "rectangle", groupIds: ["group"], frameId: "lab-slide", boundElements: [{ id: "label", type: "text" }] },
    { id: "label", type: "text", text: "Editable", containerId: "box", groupIds: ["group"], frameId: "lab-slide" },
    { id: "arrow", type: "arrow", startBinding: { elementId: "box", focus: 0 }, endBinding: { elementId: "gone" } },
    { id: "image", type: "image", fileId: "original" },
    { id: "gone", type: "rectangle", isDeleted: true }
  ],
  files: { original: { id: "original", dataURL: "data:image/png;base64,original" }, unused: { id: "unused" } }
};

test("captures editable composition and original media, not deleted elements or unused files", () => {
  const layout = captureLayout(" My composition ", scene, "one");
  assert.equal(layout.name, "My composition");
  assert.equal(layout.elements.length, 5);
  assert.deepEqual(Object.keys(layout.files), ["original"]);
  assert.deepEqual(layout.files.original, scene.files.original);
  layout.elements[2].text = "Changed";
  assert.equal(scene.elements[2].text, "Editable");
});

test("instances remap bindings, containers and groups without sharing mutable data", () => {
  const layout = captureLayout("Reusable", scene, "one");
  let counter = 0;
  const instance = instantiateLayout(layout, () => `fresh-${++counter}`);
  const [frame, box, label, arrow] = instance.elements;
  assert.equal(frame.id, "lab-slide");
  assert.equal(frame.customData.slideSettings.layout, "user:one");
  assert.equal(box.frameId, frame.id);
  assert.equal(label.containerId, box.id);
  assert.equal(box.boundElements[0].id, label.id);
  assert.equal(arrow.startBinding.elementId, box.id);
  assert.equal(arrow.endBinding, null);
  assert.equal(box.groupIds[0], label.groupIds[0]);
  assert.notEqual(box.groupIds[0], "group");
  instance.files.original.dataURL = "changed";
  assert.equal(layout.files.original.dataURL, scene.files.original.dataURL);
});

test("rejects empty names and missing original media", () => {
  assert.throws(() => captureLayout("  ", scene), /name/);
  assert.throws(() => captureLayout("Missing", { ...scene, files: {} }), /media/);
});