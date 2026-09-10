export function studioSavedLayouts(data) {
  return (Array.isArray(data?.slideLayouts) ? data.slideLayouts : []).filter(layout => layout?.id && Array.isArray(layout.blocks)).map(layout => ({
    id: `studio:${layout.id}`, name: layout.name || "Studio layout", source: "studio", created: 0, blocks: structuredClone(layout.blocks),
    slots: layout.blocks.map(block => ({ kind: block.kind === "media" ? "media" : "text", x: block.x ?? 8, y: block.y ?? 8, width: block.w ?? 40, height: block.h ?? 12 }))
  }));
}

export function studioLayoutElements(layout, fontFamily, color = value => value) {
  return layout.blocks.map((block, index) => {
    const common = { id: `${layout.id}-${index}`, frameId: "lab-slide", x: (block.x ?? 8) * 12.8, y: (block.y ?? 8) * 7.2, width: (block.w ?? 40) * 12.8, height: (block.h ?? 14) * 7.2, angle: (Number(block.rot) || 0) * Math.PI / 180, opacity: block.opacity ?? 100, roughness: 0, strokeWidth: block.strokeW ?? 1, strokeColor: color(block.stroke || block.color || "var(--text)"), backgroundColor: color(block.fill || block.bg || "transparent"), fillStyle: "solid", customData: { studioLayoutBlock: structuredClone(block) } };
    if (block.kind === "text" || !block.kind) return { ...common, type: "text", text: String(block.text || block.ph || "Text"), fontFamily: typeof fontFamily === "function" ? fontFamily(block) : fontFamily, fontSize: ({ sm: 24, md: 40, lg: 56 })[block.size] || 40, textAlign: block.align || "left", verticalAlign: block.valign || "top", autoResize: false, customData: { ...common.customData, slidePlaceholder: { kind: "text", label: String(block.text || block.ph || "Text"), height: block.h ?? 14 } } };
    if (block.kind === "media") return { ...common, type: "rectangle", strokeStyle: "dashed", customData: { ...common.customData, slidePlaceholder: { kind: "media", height: block.h ?? 50 } } };
    if (block.kind === "icon") return { ...common, type: "image", fileId: `${layout.id}-icon-${index}`, scale: [1, 1] };
    if (block.kind === "shape") {
      if (["line", "arrow"].includes(block.shape)) return { ...common, type: block.shape, points: [[0, 0], [common.width, common.height]], endArrowhead: block.shape === "arrow" ? "arrow" : null };
      return { ...common, type: block.shape === "ellipse" ? "ellipse" : "rectangle", customData: { ...common.customData, ...(block.radius ? { labCorners: { mode: "round", radius: block.radius } } : {}) } };
    }
    throw new Error(`Unsupported Studio layout block: ${block.kind}`);
  });
}

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