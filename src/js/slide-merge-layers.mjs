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