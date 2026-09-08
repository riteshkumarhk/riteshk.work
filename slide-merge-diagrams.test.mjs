import test from "node:test";
import assert from "node:assert/strict";
import { DIAGRAM_SHAPES, diagramSkeleton } from "./src/js/slide-merge-inserts.mjs";

test("diagram presets use editable native elements, unique IDs and slide groups", () => {
  for (const [kind] of DIAGRAM_SHAPES) {
    const elements = diagramSkeleton(kind, kind);
    assert.equal(new Set(elements.map(element => element.id)).size, elements.length);
    assert.ok(elements.every(element => ["rectangle","ellipse","line"].includes(element.type) && element.frameId === "lab-slide" && element.groupIds[0] === kind));
    assert.ok(elements.every(element => element.x >= 0 && element.y >= 0 && element.x + element.width <= 1280 && element.y + element.height <= 720));
    if (["triangle","hexagon","inputoutput"].includes(kind)) assert.deepEqual(elements[0].points[0], elements[0].points.at(-1));
  }
  assert.throws(() => diagramSkeleton("unknown","test"));
});