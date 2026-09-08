export function captureLayout(name, scene, id = crypto.randomUUID()) {
  const title = name.trim().slice(0, 120);
  if (!title) throw new Error("Give this layout a name");
  const elements = structuredClone(scene.elements.filter(element => !element.isDeleted));
  const fileIds = new Set(elements.filter(element => element.fileId).map(element => element.fileId));
  const files = Object.fromEntries([...fileIds].map(fileId => {
    if (!scene.files[fileId]) throw new Error("Layout media is not ready to save");
    return [fileId, structuredClone(scene.files[fileId])];
  }));
  return { id: `user:${id}`, name: title, version: 1, created: Date.now(), elements, files };
}

export function instantiateLayout(layout, makeId = () => crypto.randomUUID()) {
  const elements = structuredClone(layout.elements);
  const ids = new Map(elements.map(element => [element.id, element.id === "lab-slide" ? "lab-slide" : makeId()]));
  const groups = new Map();
  for (const element of elements) {
    element.id = ids.get(element.id);
    element.groupIds = (element.groupIds || []).map(group => {
      if (!groups.has(group)) groups.set(group, makeId());
      return groups.get(group);
    });
    if (element.frameId) element.frameId = ids.get(element.frameId) || null;
    if (element.containerId) element.containerId = ids.get(element.containerId) || null;
    if (element.boundElements) element.boundElements = element.boundElements.filter(bound => ids.has(bound.id)).map(bound => ({ ...bound, id: ids.get(bound.id) }));
    for (const key of ["startBinding", "endBinding"]) {
      if (element[key]) element[key] = ids.has(element[key].elementId) ? { ...element[key], elementId: ids.get(element[key].elementId) } : null;
    }
    if (element.id === "lab-slide") {
      element.customData = { ...element.customData, slideSettings: { ...element.customData?.slideSettings, layout: layout.id } };
    }
  }
  return { elements, files: structuredClone(layout.files) };
}

export async function savedLayoutStore(action = "list", layout) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("rk-slide-layouts-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("layouts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("layouts", action === "list" ? "readonly" : "readwrite");
    const store = transaction.objectStore("layouts");
    const request = action === "list" ? store.getAll() : action === "delete" ? store.delete(layout.id) : store.put(layout);
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Layout could not be saved")); };
  });
}