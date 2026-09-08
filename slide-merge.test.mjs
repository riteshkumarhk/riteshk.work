import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, changeSlides, MERGE_DB, slidePaneWidth } from "./src/js/slide-merge-core.mjs";

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