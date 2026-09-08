export function mergeLibrary(base, local, remote) {
  const before = new Map(base.map(item => [item.id, item]));
  const after = new Map(local.map(item => [item.id, item]));
  const merged = new Map(remote.map(item => [item.id, item]));
  for (const id of before.keys()) if (!after.has(id)) merged.delete(id);
  for (const [id, item] of after) if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) merged.set(id, item);
  return [...merged.values()];
}

export function applyLibrarySnapshot(api, baseline, items) {
  return api.updateLibrary({ libraryItems: current => mergeLibrary(baseline, current, items), merge: false });
}

export async function libraryCache(value) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("rk-slide-library-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("library");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("library", value ? "readwrite" : "readonly");
    const store = transaction.objectStore("library");
    const request = value ? store.put(value, "owner") : store.get("owner");
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

export function createLibrarySync({ cache = libraryCache, session, request, onItems, onStatus }) {
  let state = { base: [], items: [] }, writes = Promise.resolve(), running = null, timer = null, stopped = false, saving = 0;
  const persist = () => {
    const snapshot = structuredClone(state);
    saving++;
    writes = writes.catch(() => {}).then(() => cache(snapshot)).finally(() => { saving--; });
    return writes;
  };
  const ready = cache().then(saved => { if (saved) state = saved; return state.items; });
  function later() {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => sync(), 600);
  }
  async function change(items) {
    await ready;
    if (JSON.stringify(items) === JSON.stringify(state.items)) return;
    state.items = structuredClone(items);
    onStatus("Library: saving locally");
    try { await persist(); onStatus("Library: pending sync"); later(); }
    catch { onStatus("Library: local save failed; export a backup"); }
  }
  async function sync() {
    if (running) return running;
    running = (async () => {
      try {
        await ready;
        await writes;
        const token = session();
        if (!token) { onStatus("Library: sign in to sync"); return; }
        onStatus("Library: syncing");
        for (let attempt = 0; attempt < 4; attempt++) {
          const remote = await request(token);
          const snapshot = structuredClone(state);
          const merged = mergeLibrary(snapshot.base, snapshot.items, remote.items);
          if (JSON.stringify(merged) !== JSON.stringify(remote.items)) {
            const result = await request(token, { revision: remote.revision, items: merged });
            if (result.conflict) continue;
          }
          state = { base: merged, items: mergeLibrary(snapshot.items, state.items, merged) };
          await persist();
          await onItems(state.items);
          if (JSON.stringify(state.items) !== JSON.stringify(state.base)) { later(); onStatus("Library: pending sync"); }
          else onStatus("Library: synced");
          return;
        }
        onStatus("Library: busy on another device; retry sync");
      } catch (error) {
        onStatus(error.status === 401 ? "Library: sign in to sync" : error.status ? "Library: " + error.message : "Library: offline or sync failed; retry");
      }
    })().finally(() => { running = null; });
    return running;
  }
  return { ready, change, sync, items: () => structuredClone(state.items), get saving() { return saving > 0; }, stop: () => { stopped = true; clearTimeout(timer); } };
}