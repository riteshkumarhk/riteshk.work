import test from "node:test";
import assert from "node:assert/strict";
import { clampNotesHeight, formatSlideDuration, parseSlideDuration } from "./src/js/slide-merge-notes.mjs";

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

test("slide timing displays minutes and seconds without changing saved minute units", () => {
  assert.equal(formatSlideDuration(0), "00:00");
  assert.equal(formatSlideDuration(1.5), "01:30");
  assert.equal(formatSlideDuration(3.5), "03:30");
  assert.equal(formatSlideDuration(1 / 60), "00:01");
  assert.equal(formatSlideDuration(240), "240:00");
  assert.equal(formatSlideDuration(Infinity), "00:00");
  assert.equal(parseSlideDuration("01:30"), 1.5);
  assert.equal(parseSlideDuration(" 2:05 "), 2 + 5 / 60);
  assert.equal(parseSlideDuration("2"), 2);
  assert.equal(parseSlideDuration(""), 0);
  assert.equal(parseSlideDuration("240:00"), 240);
  for (const value of ["240:01", "241", "01:60", "1:2", "-1:30", "bad", "1.5", "12:30:00"]) assert.equal(parseSlideDuration(value), null, value);
});