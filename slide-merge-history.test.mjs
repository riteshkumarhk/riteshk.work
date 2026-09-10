import test from "node:test";
import assert from "node:assert/strict";
import { createDeck, changeSlides } from "./src/js/slide-merge-core.mjs";
import { createDeckHistory, createSlideDeletionHistory } from "./src/js/slide-merge-history.mjs";

test("full deck history restores reorder, additions, notes, timing, sections and canvas edits", () => {
  const history = createDeckHistory(), original = createDeck();
  original.slides[0].scene = { elements: [{ id: "shape", x: 10, version: 1 }], files: { image: { dataURL: "original bytes" } }, appState: { zoom: { value: 1 } } };
  history.reset(original);
  let deck = changeSlides(original, "down", "opening"); history.record(deck);
  deck = changeSlides(deck, "duplicate", "opening", "copy"); history.record(deck);
  deck = structuredClone(deck); deck.slides[0].notes = "<p><strong>Rich notes</strong></p>"; deck.slides[0].durationMinutes = 2; deck.slides[0].section = "Context"; history.record(deck);
  deck = structuredClone(deck); deck.slides[1].scene.elements[0].x = 400; history.record(deck);
  const final = structuredClone(deck);
  for (let index = 0; index < 4; index++) deck = history.undo();
  assert.deepEqual(deck, original);
  for (let index = 0; index < 4; index++) deck = history.redo();
  assert.deepEqual(deck, final);
  deck.slides[1].scene.files.image.dataURL = "changed outside history";
  history.undo(); assert.equal(history.redo().slides[1].scene.files.image.dataURL, "original bytes");
});

test("deck history ignores selection, camera and engine bookkeeping but invalidates redo on edits", () => {
  const history = createDeckHistory(2), deck = createDeck();
  deck.slides[0].scene = { elements: [{ id: "shape", x: 10, version: 1, versionNonce: 1, updated: 1 }], appState: { zoom: { value: 1 } } };
  history.reset(deck);
  deck.selected = "fidelity"; deck.slides[0].scene.appState.zoom.value = 0.5; deck.slides[0].scene.elements[0].version++;
  assert.equal(history.record(deck), false); assert.equal(history.canUndo, false);
  for (let index = 0; index < 4; index++) { deck.title = `Deck ${index}`; history.record(deck); }
  assert.equal(history.undo().title, "Deck 2"); assert.equal(history.undo().title, "Deck 1"); assert.equal(history.undo(), null);
  const branch = history.redo(); branch.slides[0].hidden = true; history.record(branch);
  assert.equal(history.canRedo, false);
});

test("history interns original media once and removes unreachable asset revisions", () => {
  const history = createDeckHistory(2), deck = createDeck();
  deck.slides[0].scene = { elements: [], files: { image: { id: "image", dataURL: "original", lastRetrieved: 1 } } };
  history.reset(deck);
  for (let index = 0; index < 5; index++) { deck.title = `Change ${index}`; deck.slides[0].scene.files.image.lastRetrieved++; history.record(deck); }
  assert.equal(history.assetCount, 1);
  deck.slides[0].scene.files.image.dataURL = "replacement"; history.record(deck);
  assert.equal(history.assetCount, 2);
  assert.equal(history.undo().slides[0].scene.files.image.dataURL, "original");
  const restored = history.redo();
  for (let index = 0; index < 3; index++) { restored.title = `New ${index}`; history.record(restored); }
  assert.equal(history.assetCount, 1);
});

test("normalizing a restored scene does not discard its redo branch", () => {
  const history = createDeckHistory(), deck = createDeck();
  history.reset(deck); deck.title = "Edited"; history.record(deck);
  const restored = history.undo(); restored.slides[0].scene = { elements: [], files: {}, appState: {} };
  history.acceptCurrent(restored); assert.equal(history.record(restored), false);
  assert.equal(history.canRedo, true); assert.equal(history.redo().title, "Edited");
});

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