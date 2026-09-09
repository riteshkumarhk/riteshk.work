import { FRAME_ID } from "./slide-lab-core.mjs";

export function layerRows(elements) {
  return elements.filter(element => !element.isDeleted && element.id !== FRAME_ID).toReversed();
}

export function layerName(element) {
  return element.customData?.labLayerName || (element.customData?.slideBackground ? "Background" : element.text?.trim().replace(/\s+/g, " ").slice(0, 80)) || element.name || ({ rectangle: "Rectangle", ellipse: "Ellipse", diamond: "Diamond", text: "Text", image: "Image", arrow: "Arrow", line: "Line", freedraw: "Drawing", embeddable: "Embed" }[element.type] || element.type);
}

export function layerTargets(elements, ids) {
  const targets = new Set(ids.filter(id => id !== FRAME_ID));
  for (const element of elements) {
    if (!element.isDeleted && element.type === "text" && targets.has(element.containerId)) targets.add(element.id);
  }
  return targets;
}

export function layerMoveTargets(elements, ids) {
  const active = elements.filter(element => !element.isDeleted && element.id !== FRAME_ID);
  const requested = new Set(Array.isArray(ids) ? ids : [ids]);
  const targets = new Set(active.filter(element => requested.has(element.id)).map(element => element.id));
  let previousSize;
  do {
    previousSize = targets.size;
    const groups = new Set(active.filter(element => targets.has(element.id)).map(element => element.groupIds?.at(-1)).filter(Boolean));
    for (const element of active) {
      if (targets.has(element.containerId) || element.groupIds?.some(group => groups.has(group))) targets.add(element.id);
      if (targets.has(element.id) && active.some(container => container.id === element.containerId)) targets.add(element.containerId);
    }
  } while (previousSize !== targets.size);
  return targets;
}

export function reorderLayerElements(elements, sourceId, targetId, edge, move) {
  if (!["before", "after"].includes(edge)) return elements;
  const targets = layerMoveTargets(elements, sourceId), destination = layerMoveTargets(elements, targetId);
  if (!targets.size || !destination.size || [...targets].some(id => destination.has(id))) return elements;
  const order = scene => scene.filter(element => !element.isDeleted && element.id !== FRAME_ID).map(element => element.id);
  const original = order(elements), remaining = original.filter(id => !targets.has(id)), moving = original.filter(id => targets.has(id));
  const targetIndices = remaining.flatMap((id, index) => destination.has(id) ? [index] : []);
  const insertion = edge === "before" ? Math.max(...targetIndices) + 1 : Math.min(...targetIndices);
  const expected = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
  const matches = scene => order(scene).every((id, index) => id === expected[index]);
  if (matches(elements)) return elements;
  let current = move(elements, "bringToFront", targets);
  if (!current) return elements;
  if (matches(current)) return current;
  for (let step = 0; step < original.length; step++) {
    const next = move(current, "sendBackward", targets);
    if (!next || order(next).join() === order(current).join()) return elements;
    if (matches(next)) return next;
    current = next;
  }
  return elements;
}

export function layerPropertyChanges(elements, ids, operation, value) {
  const targets = operation === "rename" ? new Set(ids.filter(id => id !== FRAME_ID)) : layerTargets(elements, ids);
  return new Map(elements.filter(element => !element.isDeleted && targets.has(element.id)).map(element => {
    const customData = { ...element.customData }, hidden = customData.labLayerHidden;
    let patch;
    if (operation === "rename") patch = { customData: { ...customData, labLayerName: value.trim().slice(0, 120) } };
    else if (operation === "hide") {
      if (value && !hidden) patch = { opacity: 0, locked: true, customData: { ...customData, labLayerHidden: { opacity: element.opacity, locked: element.locked, fromContainer: ids.includes(element.containerId) } } };
      else if (!value && hidden && (ids.includes(element.id) || hidden.fromContainer)) { delete customData.labLayerHidden; patch = { opacity: hidden.opacity, locked: hidden.locked, customData }; }
    } else if (operation === "lock") {
      patch = hidden ? { customData: { ...customData, labLayerHidden: { ...hidden, locked: value } } } : { locked: value };
    }
    return [element.id, patch];
  }).filter(([, patch]) => patch));
}