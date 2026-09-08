import test from "node:test";
import assert from "node:assert/strict";
import { activitySnapshot, activityChanges, activityText } from "./src/js/slide-merge-activity.mjs";

test("activity snapshots omit private text and media but classify changes", () => {
  const original = [{ id: "title", type: "text", text: "private words", x: 0, customData: {} }];
  const updated = [{ ...original[0], text: "new private words", x: 10, groupIds: ["group"] }];
  const snapshot = activitySnapshot(original);
  assert.ok(!JSON.stringify(snapshot).includes("private words"));
  const changes = activityChanges(snapshot, activitySnapshot(updated));
  assert.ok(changes.includes("Changed text on 1 layer"));
  assert.ok(changes.includes("Changed position on 1 layer"));
  assert.ok(changes.includes("Changed grouping on 1 layer"));
});

test("activity reports addition, deletion, visibility and order without raw payloads", () => {
  const elements = [{ id: "shape", type: "rectangle" }, { id: "image", type: "image", fileId: "secret-file" }];
  const before = activitySnapshot(elements);
  assert.deepEqual(activityChanges(before, activitySnapshot([...elements].reverse())), ["Changed layer order"]);
  assert.ok(activityChanges(before, activitySnapshot(elements.slice(0, 1))).includes("Deleted 1 image layer"));
  assert.ok(activityChanges([], before).includes("Added 1 rectangle layer"));
  assert.ok(activityChanges(before, activitySnapshot(elements.map(element => ({ ...element, customData: { labLayerHidden: {} } })))).includes("Changed visibility on 2 layers"));
  assert.ok(activityText([{ t: 100, k: "sys", c: "slide-lab", d: "Undo" }]).includes("+0ms SYS [slide-lab] Undo"));
});