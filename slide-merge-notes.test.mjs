import test from "node:test";
import assert from "node:assert/strict";
import { clampNotesHeight } from "./src/js/slide-merge-notes.mjs";

test("notes retain a usable minimum and never exceed half the editor", () => {
  assert.equal(clampNotesHeight(116, 900), 116);
  assert.equal(clampNotesHeight(900, 900), 450);
  assert.equal(clampNotesHeight(20, 900), 80);
  assert.equal(clampNotesHeight(450, 600), 300);
  assert.equal(clampNotesHeight(450, 120), 60);
  assert.equal(clampNotesHeight(116, 0), 0);
});

test("invalid stored heights fall back without exceeding the available area", () => {
  assert.equal(clampNotesHeight("bad", 900), 116);
  assert.equal(clampNotesHeight(Infinity, 900), 116);
  assert.equal(clampNotesHeight(null, 200), 100);
});