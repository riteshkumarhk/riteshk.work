import test from "node:test";
import assert from "node:assert/strict";
import { cornerPath, cornerSettings, cornerUpdate, selectedRectangles } from "./src/js/slide-lab-corners.mjs";

const shape = { id: "box", type: "rectangle", width: 200, height: 100, version: 1, roundness: { type: 3 }, customData: { keep: true }, boundElements: [{ id: "label", type: "text" }] };
test("image and video corners share styles, radius and original media references", () => {
  for (const type of ["image", "embeddable"]) {
    const media = { ...shape, type, fileId: "original", customData: { sectionVideo: { src: "original.mp4" } } };
    assert.equal(selectedRectangles([media], { box: true }).length, 1);
    const [updated] = cornerUpdate([media], ["box"], "squircle", 24);
    assert.equal(cornerSettings(updated).mode, "squircle");
    assert.equal(cornerSettings(updated).radius, 24);
    assert.equal(updated.fileId, media.fileId);
    assert.equal(updated.customData.sectionVideo, media.customData.sectionVideo);
  }
});
test("round and continuous corners use distinct paths within the same bounds", () => {
  const [round] = cornerUpdate([shape], ["box"], "round", 24);
  const [squircle] = cornerUpdate([shape], ["box"], "squircle", 24);
  assert.notEqual(cornerPath(round), cornerPath(squircle));
  assert.equal(cornerSettings(squircle).radius, 24);
  assert.ok(!/NaN|Infinity/.test(cornerPath(squircle)));
  assert.deepEqual(squircle.boundElements, shape.boundElements);
  assert.equal(squircle.customData.keep, true);
});
test("radius clamps, zero and sharp corners, and serialized settings remain valid", () => {
  const [large] = cornerUpdate([shape], ["box"], "squircle", 900);
  assert.equal(cornerSettings(large).radius, 50);
  const [small] = cornerUpdate([large], ["box"], null, -10);
  assert.equal(cornerSettings(small).radius, 0);
  const [sharp] = cornerUpdate([large], ["box"], "sharp");
  assert.equal(cornerSettings(sharp).radius, 0);
  assert.equal(sharp.roundness, null);
  assert.equal(cornerPath(JSON.parse(JSON.stringify(large))), cornerPath(large));
  assert.equal(shape.customData.labCorners, undefined);
});
test("selection supports bound labels but excludes locked and non-rectangular shapes", () => {
  const scene = [shape, { id: "label", type: "text", containerId: "box" }, { ...shape, id: "locked", locked: true }, { ...shape, id: "diamond", type: "diamond" }];
  assert.deepEqual(selectedRectangles(scene, { label: true, locked: true, diamond: true }).map(element => element.id), ["box"]);
  assert.equal(cornerUpdate(scene, ["locked"], "round", 12)[2], scene[2]);
});