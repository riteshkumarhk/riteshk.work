import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, changeSlides } from "./src/js/slide-merge-core.mjs";
import { createSlideDeletionHistory } from "./src/js/slide-merge-history.mjs";

test("deletion undo restores exact slide content and position without overwriting other edits", () => {
  const history = createSlideDeletionHistory(), original = createDeck();
  original.slides[0].scene = { elements: [{ id: "component", customData: { block: { title: "Original" } } }], files: { image: { dataURL: "original-bytes" } } };
  history.record(original, "opening");
  const deleted = changeSlides(original, "delete", "opening");
  deleted.slides[0].notes = "New notes";
  const restored = history.undo(deleted);
  assert.deepEqual(restored.slides[0], original.slides[0]);
  assert.equal(restored.slides[1].notes, "New notes");
  assert.equal(restored.selected, "opening");
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(restored).slides.length, 1);
  assert.equal(original.slides.length, 2);
});

test("multiple deletions undo and redo through an empty deck", () => {
  const history = createSlideDeletionHistory();
  let deck = createDeck();
  for (const id of ["opening", "fidelity"]) { history.record(deck, id); deck = changeSlides(deck, "delete", id); }
  assert.equal(deck.selected, null);
  deck = history.undo(deck); deck = history.undo(deck);
  assert.deepEqual(deck.slides.map(slide => slide.id), ["opening", "fidelity"]);
  deck = history.redo(deck); deck = history.redo(deck);
  assert.deepEqual(deck.slides, []);
  assert.equal(deck.selected, null);
  assert.equal(history.canRedo, false);
});

test("new changes invalidate deletion redo and history is bounded", () => {
  const history = createSlideDeletionHistory(1), deck = createDeck();
  history.record(deck, "opening"); history.record(deck, "fidelity");
  history.undo(changeSlides(deck, "delete", "fidelity"));
  assert.equal(history.canUndo, false);
  history.clearRedo();
  assert.equal(history.canRedo, false);
});