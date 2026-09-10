export function deckDocumentKey(deck) {
  const { selected, ...document } = deck;
  return JSON.stringify({ ...document, slides: deck.slides.map(slide => ({ ...slide, scene: slide.scene ? {
    ...slide.scene,
    appState: { viewBackgroundColor: slide.scene.appState?.viewBackgroundColor },
    elements: slide.scene.elements.map(element => { const { version, versionNonce, updated, ...content } = element; return content; })
  } : null })) });
}

export function createDeckHistory(limit = 80) {
  let entries = [], cursor = -1;
  const assets = new Map(), assetKeys = new Map();
  let assetSequence = 0;
  function pack(deck) {
    return structuredClone({ ...deck, slides: deck.slides.map(slide => ({ ...slide, scene: slide.scene ? { ...slide.scene, files: Object.fromEntries(Object.entries(slide.scene.files || {}).map(([id, file]) => {
      const { created, lastRetrieved, ...content } = file;
      const key = JSON.stringify(content);
      if (!assetKeys.has(key)) { const reference = ++assetSequence; assetKeys.set(key, reference); assets.set(reference, { key, file: structuredClone(file) }); }
      return [id, assetKeys.get(key)];
    })) } : null })) });
  }
  function unpack(snapshot) {
    const deck = structuredClone(snapshot);
    for (const slide of deck.slides) if (slide.scene) slide.scene.files = Object.fromEntries(Object.entries(slide.scene.files).map(([id, reference]) => [id, structuredClone(assets.get(reference).file)]));
    return deck;
  }
  function prune() {
    const used = new Set(entries.flatMap(entry => entry.deck.slides.flatMap(slide => Object.values(slide.scene?.files || {}))));
    for (const [reference, value] of assets) if (!used.has(reference)) { assets.delete(reference); assetKeys.delete(value.key); }
  }
  return {
    get canUndo() { return cursor > 0; },
    get canRedo() { return cursor >= 0 && cursor < entries.length - 1; },
    get assetCount() { return assets.size; },
    reset(deck) { assets.clear(); assetKeys.clear(); const snapshot = pack(deck); entries = [{ key: deckDocumentKey(snapshot), deck: snapshot }]; cursor = 0; },
    acceptCurrent(deck) { if (cursor < 0) return; const snapshot = pack(deck); entries[cursor] = { key: deckDocumentKey(snapshot), deck: snapshot }; prune(); },
    record(deck) {
      const snapshot = pack(deck), key = deckDocumentKey(snapshot);
      if (entries[cursor]?.key === key) return false;
      entries = entries.slice(0, cursor + 1);
      entries.push({ key, deck: snapshot });
      if (entries.length > Math.max(2, limit + 1)) entries.shift();
      cursor = entries.length - 1;
      prune();
      return true;
    },
    undo() { if (cursor <= 0) return null; const selected = entries[cursor].deck.selected; const deck = unpack(entries[--cursor].deck); if (deck.slides.some(slide => slide.id === selected)) deck.selected = selected; return deck; },
    redo() { if (cursor < 0 || cursor >= entries.length - 1) return null; return unpack(entries[++cursor].deck); }
  };
}

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