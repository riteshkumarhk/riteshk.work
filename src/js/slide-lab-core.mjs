export const LAB_VERSION = 1;
export const FRAME_ID = "lab-slide";
export const SCENARIOS = [
  { id: "flow", name: "Product flow", count: 0 },
  { id: "compatibility", name: "Content fidelity", count: 0 },
  { id: "dense", name: "200 objects", count: 200 },
  { id: "stress", name: "1,000 objects", count: 1000 }
];

export function fixtureSkeleton(scenario) {
  const common = { roughness: 0, strokeColor: "#27343a", strokeWidth: 2, fillStyle: "solid" };
  let elements;
  if (scenario === "dense" || scenario === "stress") {
    const count = scenario === "dense" ? 200 : 1000;
    const columns = scenario === "dense" ? 20 : 40;
    const rows = count / columns;
    elements = Array.from({ length: count }, (_, index) => ({
      ...common, id: `node-${index}`, type: index % 3 === 0 ? "ellipse" : "rectangle",
      x: 30 + (index % columns) * (1220 / columns), y: 30 + Math.floor(index / columns) * (660 / rows),
      width: 1000 / columns, height: 500 / rows,
      backgroundColor: ["#c9e4da", "#fae5ad", "#d4e5f5"][index % 3]
    }));
  } else if (scenario === "compatibility") {
    elements = [
      { ...common, id: "rich", type: "embeddable", x: 50, y: 60, width: 550, height: 210,
        link: "https://slide-lab.invalid/rich", customData: { fixture: "rich" } },
      { ...common, id: "section", type: "embeddable", x: 50, y: 300, width: 550, height: 340,
        link: "https://slide-lab.invalid/section", customData: { fixture: "section" } },
      { ...common, id: "video", type: "embeddable", x: 650, y: 360, width: 560, height: 280,
        link: "https://slide-lab.invalid/video", customData: { fixture: "video" } },
      { ...common, id: "source-image", type: "image", x: 650, y: 60, width: 560, height: 280,
        fileId: "fixture-image", scale: [1, 1] }
    ];
  } else {
    elements = [
      { ...common, type: "text", id: "title", x: 70, y: 65, text: "A clearer path to the next step", fontSize: 38, fontFamily: 2 },
      { ...common, type: "text", id: "subtitle", x: 70, y: 123, text: "DISCOVER / DECIDE / CONTINUE", fontSize: 16, fontFamily: 3, strokeColor: "#64726f" },
      ...["Discover", "Decide", "Continue"].map((text, index) => ({
        ...common, type: index === 1 ? "diamond" : "rectangle", id: `step-${index}`,
        x: 70 + index * 390, y: 220, width: 240, height: 150,
        backgroundColor: ["#c9e4da", "#fae5ad", "#d4e5f5"][index],
        roundness: { type: 3 }, label: { text, fontSize: 26, fontFamily: 2 }
      })),
      ...[0, 1].map(index => ({
        ...common, type: "arrow", id: `connector-${index}`, x: 315 + index * 390, y: 295,
        width: 135, height: 0, points: [[0, 0], [135, 0]],
        start: { id: `step-${index}` }, end: { id: `step-${index + 1}` }, endArrowhead: "arrow"
      })),
      { ...common, type: "text", id: "outcome", x: 70, y: 465,
        text: "One decision. A useful next action.", fontSize: 28, fontFamily: 2 },
      { ...common, type: "text", id: "detail", x: 70, y: 520,
        text: "Reduce uncertainty before adding another choice.", fontSize: 20, fontFamily: 2, strokeColor: "#64726f" }
    ];
  }
  return [...elements, { type: "frame", id: FRAME_ID, x: 0, y: 0, width: 1280, height: 720,
    name: "Slide 01", locked: true, children: elements.map(element => element.id) }];
}

export function packScene(elements, files, appState, libraryItems = []) {
  return {
    version: LAB_VERSION, elements, files, libraryItems,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      scrollX: appState.scrollX, scrollY: appState.scrollY,
      zoom: appState.zoom, theme: appState.theme
    }
  };
}

export function frameReport(intervals, longTasks = []) {
  const sorted = intervals.filter(Number.isFinite).sort((first, second) => first - second);
  const percentile = fraction => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(2) : null;
  return { samples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95),
    over34Ms: sorted.filter(value => value > 34).length, longTasks: longTasks.length,
    longestTaskMs: Math.max(0, ...longTasks) };
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export async function originalImage(file) {
  const bytes = await file.arrayBuffer();
  const id = await sha256(bytes);
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataURL;
  await image.decode();
  return { id, dataURL, mimeType: file.type, created: Date.now(), lastRetrieved: Date.now(),
    width: image.naturalWidth, height: image.naturalHeight, bytes: bytes.byteLength, sha256: id };
}

export function openLabStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("rk-slide-lab-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("scenes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readScene(key) {
  const database = await openLabStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("scenes", "readonly");
    const request = transaction.objectStore("scenes").get(key);
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function writeScene(key, value) {
  const database = await openLabStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("scenes", "readwrite");
    transaction.objectStore("scenes").put(value, key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export function selectedLabels(elements, selectedIds = {}) {
  const liveIds = new Set(elements.filter(element => !element.isDeleted && !element.locked).map(element => element.id));
  return elements.filter(element => !element.isDeleted && !element.locked && element.type === "text" &&
    element.containerId && liveIds.has(element.containerId) && (selectedIds[element.id] || selectedIds[element.containerId]));
}

export function labelColorUpdate(elements, labelIds, color) {
  const targets = new Set(labelIds);
  const owners = new Map(elements.map(element => [element.id, element]));
  return elements.map(element => {
    if (!targets.has(element.id)) return element;
    const independent = color === "unlink" ? element.strokeColor : color;
    const strokeColor = independent || owners.get(element.containerId)?.strokeColor || element.strokeColor;
    return { ...element, strokeColor, customData: { ...element.customData, labTextColor: independent || null },
      version: element.version + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() };
  });
}

export function preserveLabelColors(elements) {
  let changed = false;
  const result = elements.map(element => {
    const color = element.customData?.labTextColor;
    if (element.isDeleted || element.type !== "text" || !element.containerId || (color !== "transparent" && !/^#[\da-f]{6}$/i.test(color || "")) || element.strokeColor === color) return element;
    changed = true;
    return { ...element, strokeColor: color, version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() };
  });
  return changed ? result : elements;
}