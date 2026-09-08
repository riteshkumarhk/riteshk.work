import test from "node:test";
import assert from "node:assert/strict";
import { reorderSlides, changeSlides, setSlideSection } from "./src/js/slide-merge-core.mjs";

function fixture() {
  return { selected:"second", slides:[
    { id:"intro", notes:"Keep notes", scene:{ files:{ original:"bytes" } } },
    { id:"first", section:"Research" },
    { id:"second", hidden:true },
    { id:"third", section:"Design" },
    { id:"fourth" }
  ] };
}
const ids = deck => deck.slides.map(slide => slide.id);
const sections = deck => deck.slides.filter(slide => slide.section).map(slide => [slide.id, slide.section]);

test("slide movement preserves section boundaries, selection and original data", () => {
  const deck = fixture(), original = structuredClone(deck);
  const result = reorderSlides(deck, "first", "fourth", "slide", "after");
  assert.deepEqual(ids(result), ["intro", "second", "third", "fourth", "first"]);
  assert.deepEqual(sections(result), [["second", "Research"], ["third", "Design"]]);
  assert.equal(result.selected, "second");
  assert.deepEqual(result.slides[0], deck.slides[0]);
  assert.equal(result.slides[1].hidden, true);
  assert.deepEqual(deck, original);
});
test("dropping before a section's first slide joins that section", () => {
  const result = reorderSlides(fixture(), "intro", "third");
  assert.deepEqual(ids(result), ["first", "second", "intro", "third", "fourth"]);
  assert.deepEqual(sections(result), [["first", "Research"], ["intro", "Design"]]);
});
test("section drag moves the entire group including skipped slides", () => {
  const result = reorderSlides(fixture(), "first", "fourth", "section", "after");
  assert.deepEqual(ids(result), ["intro", "third", "fourth", "first", "second"]);
  assert.deepEqual(sections(result), [["third", "Design"], ["first", "Research"]]);
  assert.equal(result.slides.at(-1).hidden, true);
});
test("unsectioned opening slides remain before reordered named sections", () => {
  const result = reorderSlides(fixture(), "third", "intro", "section");
  assert.deepEqual(ids(result), ["intro", "third", "fourth", "first", "second"]);
  assert.equal(result.slides[0].section, undefined);
});
test("within-section reorder retains its heading on the new first slide", () => {
  const result = reorderSlides(fixture(), "second", "first");
  assert.deepEqual(ids(result), ["intro", "second", "first", "third", "fourth"]);
  assert.deepEqual(sections(result), [["second", "Research"], ["third", "Design"]]);
});
test("same slide and same section drops are no-ops", () => {
  assert.deepEqual(reorderSlides(fixture(), "second", "second"), fixture());
  assert.deepEqual(reorderSlides(fixture(), "first", "second", "section"), fixture());
});
test("empty sections disappear and removing a section preserves every slide", () => {
  const deck = { selected:"solo", slides:[{ id:"solo", section:"One" }, { id:"other", section:"Two" }] };
  assert.deepEqual(sections(reorderSlides(deck, "solo", "other")), [["solo", "Two"]]);
  const removed = setSlideSection(fixture(), "first", "");
  assert.deepEqual(ids(removed), ids(fixture()));
  assert.deepEqual(sections(removed), [["third", "Design"]]);
});
test("arrow actions use the same boundary-preserving reorder", () => {
  assert.deepEqual(changeSlides(fixture(), "down", "first"), reorderSlides(fixture(), "first", "second", "slide", "after"));
});
test("invalid reorder targets and non-section sources are rejected", () => {
  assert.throws(() => reorderSlides(fixture(), "missing", "first"), /not found/);
  assert.throws(() => reorderSlides(fixture(), "first", "missing"), /not found/);
  assert.throws(() => reorderSlides(fixture(), "second", "third", "section"), /not found/);
  assert.throws(() => reorderSlides(fixture(), "first", "third", "other"), /Invalid/);
});