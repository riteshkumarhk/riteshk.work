import test from "node:test";
import assert from "node:assert/strict";
import { contentSkeleton, CONTENT_BLOCKS, SLIDE_LAYOUTS, rulerTicks } from "./src/js/slide-merge-inserts.mjs";

test("content and slide starters have unique IDs, hosted fonts and slide-local geometry", () => {
  for (const kind of [...CONTENT_BLOCKS.map(item => item[0]), "title", "columns"]) {
    const elements = contentSkeleton(kind, 12345, "test");
    assert.equal(new Set(elements.map(element => element.id)).size, elements.length);
    assert.ok(elements.every(element => element.frameId === "lab-slide" && element.groupIds[0] === "test" && element.x >= 0 && element.x < 1280 && element.y >= 0 && element.y < 720));
    assert.ok(elements.filter(element => element.type === "text").every(element => element.fontFamily === 12345));
    assert.ok(elements.filter(element => element.label).every(element => element.label.fontFamily === 12345));
  }
  assert.deepEqual(SLIDE_LAYOUTS.map(item => item[0]), ["blank", "title", "columns", "flow"]);
  assert.throws(() => contentSkeleton("missing", 12345, "test"), /Unknown/);
});
test("rulers use slide pixels and stay inside the fixed frame", () => {
  assert.equal(rulerTicks(1280).at(-1), 1200);
  assert.deepEqual(rulerTicks(720), [0,100,200,300,400,500,600,700]);
});