import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, changeSlides, insertSlide, setSlideSection, presentationSlides, MERGE_DB, slidePaneWidth } from "./src/js/slide-merge-core.mjs";

test("slide pane width preserves canvas room and clamps stored or dragged values", () => {
  assert.equal(slidePaneWidth(null, 1600), 200);
  assert.equal(slidePaneWidth(500, 1600), 360);
  assert.equal(slidePaneWidth(20, 1600), 160);
  assert.equal(slidePaneWidth(360, 920), 280);
});

test("merger deck uses isolated storage and immutable slide operations", () => {
  assert.notEqual(MERGE_DB, "rk-slide-lab-v1");
  const deck = createDeck();
  deck.slides[0].scene = { elements: [{ id: "label", text: "Original" }], files: { image: { dataURL: "original-bytes" } } };
  const copy = changeSlides(deck, "duplicate", "opening", "copy");
  assert.equal(copy.slides.length, 3);
  assert.equal(copy.selected, "copy");
  copy.slides[1].scene.elements[0].text = "Edited copy";
  assert.equal(deck.slides[0].scene.elements[0].text, "Original");
  assert.equal(copy.slides[1].scene.files.image.dataURL, "original-bytes");
  assert.equal(changeSlides(copy, "up", "copy").slides[0].id, "copy");
  assert.equal(changeSlides(copy, "delete", "copy").selected, "fidelity");
});

test("slide deletion keeps a valid selection and cannot remove the last slide", () => {
  const deck = changeSlides(createDeck(), "delete", "fidelity");
  assert.equal(deck.selected, "opening");
  assert.throws(() => changeSlides(deck, "delete", "opening"), /at least one/);
  assert.throws(() => changeSlides(deck, "duplicate", "opening", "opening"), /Unique/);
  assert.equal(changeSlides(deck, "up", "opening").slides[0].id, "opening");
});

test("insertion targets a gap or appends without changing the existing deck", () => {
  const deck = createDeck(), slide = { id: "new", title: "Blank", notes: "", scene: null };
  const next = insertSlide(deck, slide, "fidelity");
  assert.deepEqual(next.slides.map(item => item.id), ["opening", "new", "fidelity"]);
  assert.equal(next.selected, "new");
  assert.equal(deck.slides.length, 2);
  assert.equal(insertSlide(deck, slide).slides.at(-1).id, "new");
  assert.throws(() => insertSlide(deck, slide, "missing"), /not found/);
  assert.throws(() => insertSlide(deck, { ...slide, id: "opening" }), /Unique/);
});

test("skipping preserves editor slides and notes while rehearsal omits hidden slides", () => {
  const deck = createDeck(), hidden = changeSlides(deck, "hide", "opening");
  assert.deepEqual(presentationSlides(hidden).map(slide => slide.id), ["fidelity"]);
  assert.equal(hidden.slides[0].notes, deck.slides[0].notes);
  assert.equal(deck.slides[0].hidden, undefined);
  assert.equal(presentationSlides(changeSlides(hidden, "hide", "opening")).length, 2);
  assert.equal(presentationSlides(changeSlides(hidden, "hide", "fidelity")).length, 0);
});

test("section headings stay with their group, are editable, and are not repeated by duplication", () => {
  const deck = setSlideSection(createDeck(), "opening", "  Context  ");
  assert.equal(deck.slides[0].section, "Context");
  const moved = changeSlides(deck, "down", "opening");
  assert.equal(moved.slides[0].id, "fidelity");
  assert.equal(moved.slides[0].section, "Context");
  assert.equal(moved.slides[1].section, undefined);
  assert.equal(changeSlides(deck, "duplicate", "opening", "copy").slides[1].section, undefined);
  assert.equal(setSlideSection(deck, "opening", "").slides[0].section, undefined);
  assert.throws(() => setSlideSection(deck, "missing", "Title"), /not found/);
});