export function createSlideDeletionHistory(limit = 20) {
  const past = [], future = [];
  return {
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    clearRedo() { future.length = 0; },
    record(deck, id) {
      const index = deck.slides.findIndex(slide => slide.id === id);
      if (index < 0) throw new Error("Slide not found");
      past.push({ slide: structuredClone(deck.slides[index]), index });
      if (past.length > limit) past.shift();
      future.length = 0;
    },
    undo(deck) {
      const entry = past.at(-1);
      if (!entry) return deck;
      if (deck.slides.some(slide => slide.id === entry.slide.id)) throw new Error("Slide already exists");
      const next = structuredClone(deck);
      next.slides.splice(Math.min(entry.index, next.slides.length), 0, structuredClone(entry.slide));
      next.selected = entry.slide.id;
      past.pop(); future.push(entry);
      return next;
    },
    redo(deck) {
      const entry = future.at(-1);
      if (!entry) return deck;
      const next = structuredClone(deck);
      const index = next.slides.findIndex(slide => slide.id === entry.slide.id);
      if (index < 0) throw new Error("Slide not found");
      next.slides.splice(index, 1);
      if (next.selected === entry.slide.id) next.selected = next.slides[Math.min(index, next.slides.length - 1)]?.id ?? null;
      future.pop(); past.push(entry);
      return next;
    }
  };
}