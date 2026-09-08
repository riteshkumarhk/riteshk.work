export const MERGE_DB = "rk-slide-merge-lab-v1";
export function slidePaneWidth(value, viewport) {
  return Math.min(Math.max(160, viewport - 640), 360, Math.max(160, Number(value) || 200));
}
export function createDeck() {
  return { version: 1, title: "A clearer next step", selected: "opening", slides: [
    { id: "opening", title: "The product flow", notes: "Start with the decision, then walk through the three connected steps.", fixture: "flow", scene: null },
    { id: "fidelity", title: "Content in context", notes: "Rich text, a reusable section, an original image and video.", fixture: "compatibility", scene: null }
  ] };
}
export function changeSlides(deck, action, id, newId) {
  const next = structuredClone(deck);
  const index = next.slides.findIndex(slide => slide.id === id);
  if (index < 0) throw new Error("Slide not found");
  if (action === "duplicate") {
    if (!newId || next.slides.some(slide => slide.id === newId)) throw new Error("Unique slide ID required");
    next.slides.splice(index + 1, 0, { ...structuredClone(next.slides[index]), id: newId, title: next.slides[index].title + " copy" });
    next.selected = newId;
  } else if (action === "delete") {
    if (next.slides.length === 1) throw new Error("Keep at least one slide");
    next.slides.splice(index, 1);
    next.selected = next.slides[Math.min(index, next.slides.length - 1)].id;
  } else if (action === "up" || action === "down") {
    const target = index + (action === "up" ? -1 : 1);
    if (target >= 0 && target < next.slides.length) [next.slides[index], next.slides[target]] = [next.slides[target], next.slides[index]];
  } else throw new Error("Unknown slide action");
  return next;
}
export async function deckStore(value) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(MERGE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("decks");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("decks", value ? "readwrite" : "readonly");
    const store = transaction.objectStore("decks");
    const request = value ? store.put(value, "draft") : store.get("draft");
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}