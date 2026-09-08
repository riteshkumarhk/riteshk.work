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
    delete next.slides[index + 1].section;
    next.selected = newId;
  } else if (action === "delete") {
    if (next.slides.length === 1) throw new Error("Keep at least one slide");
    next.slides.splice(index, 1);
    next.selected = next.slides[Math.min(index, next.slides.length - 1)].id;
  } else if (action === "hide") {
    next.slides[index].hidden = !next.slides[index].hidden;
  } else if (action === "up" || action === "down") {
    const target = index + (action === "up" ? -1 : 1);
    if (target >= 0 && target < next.slides.length) return reorderSlides(deck, id, next.slides[target].id, "slide", action === "up" ? "before" : "after");
  } else throw new Error("Unknown slide action");
  return next;
}
export function insertSlide(deck, slide, beforeId = null) {
  if (!slide.id || deck.slides.some(item => item.id === slide.id)) throw new Error("Unique slide ID required");
  const next = structuredClone(deck);
  const index = beforeId === null ? next.slides.length : next.slides.findIndex(item => item.id === beforeId);
  if (index < 0) throw new Error("Slide not found");
  next.slides.splice(index, 0, structuredClone(slide));
  next.selected = slide.id;
  return next;
}
export function setSlideSection(deck, id, name) {
  const next = structuredClone(deck), slide = next.slides.find(item => item.id === id);
  if (!slide) throw new Error("Slide not found");
  if (name.trim()) slide.section = name.trim();
  else delete slide.section;
  return next;
}
export function reorderSlides(deck, id, targetId, kind = "slide", edge = "before") {
  if (!["slide", "section"].includes(kind) || !["before", "after"].includes(edge)) throw new Error("Invalid reorder operation");
  const next = structuredClone(deck), groups = [];
  for (const slide of next.slides) {
    if (!groups.length || slide.section) groups.push({ name:slide.section || "", slides:[] });
    groups[groups.length - 1].slides.push(slide);
  }
  const source = groups.find(group => group.slides.some(slide => slide.id === id));
  const target = groups.find(group => group.slides.some(slide => slide.id === targetId));
  if (!source || !target) throw new Error("Slide not found");
  if (id === targetId) return next;
  if (kind === "section") {
    if (!source.name || source.slides[0].id !== id) throw new Error("Section not found");
    if (source === target) return next;
    groups.splice(groups.indexOf(source), 1);
    const destination = Math.max(groups[0]?.name ? 0 : 1, groups.indexOf(target) + (edge === "after" ? 1 : 0));
    groups.splice(destination, 0, source);
  } else {
    const [slide] = source.slides.splice(source.slides.findIndex(item => item.id === id), 1);
    target.slides.splice(target.slides.findIndex(item => item.id === targetId) + (edge === "after" ? 1 : 0), 0, slide);
  }
  next.slides = groups.flatMap(group => group.slides.map((slide, index) => {
    delete slide.section;
    if (!index && group.name) slide.section = group.name;
    return slide;
  }));
  return next;
}
export function presentationSlides(deck) {
  return deck.slides.filter(slide => !slide.hidden);
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