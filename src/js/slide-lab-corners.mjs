import { getSvgPath } from "figma-squircle";

export function selectedRectangles(elements, selectedIds = {}) {
  const owners = new Set(elements.filter(element => !element.isDeleted && selectedIds[element.id] && element.type === "text").map(element => element.containerId));
  return elements.filter(element => element.type === "rectangle" && !element.isDeleted && !element.locked && (selectedIds[element.id] || owners.has(element.id)));
}

export function cornerSettings(element) {
  const limit = Math.max(0, Math.min(element.width, element.height) / 2);
  const saved = element.customData?.labCorners;
  const mode = saved?.mode || (element.roundness ? "round" : "sharp");
  const legacy = element.roundness?.type === 3 ? Math.min(element.roundness.value ?? 32, Math.min(element.width, element.height) / 4) : Math.min(element.width, element.height) / 4;
  const radius = Math.min(limit, Math.max(0, Number.isFinite(saved?.radius) ? saved.radius : legacy));
  return { mode, radius: mode === "sharp" ? 0 : radius, limit };
}

export function cornerUpdate(elements, ids, mode, radius) {
  const targets = new Set(ids);
  return elements.map(element => {
    if (!targets.has(element.id) || element.type !== "rectangle" || element.locked || element.isDeleted) return element;
    const current = cornerSettings(element);
    const nextMode = mode || (current.mode === "sharp" ? "round" : current.mode);
    const nextRadius = Math.min(current.limit, Math.max(0, Number.isFinite(radius) ? radius : current.radius || 16));
    return { ...element, roundness: nextMode === "sharp" || nextRadius === 0 ? null : { type: 3, value: nextRadius },
      customData: { ...element.customData, labCorners: { mode: nextMode, radius: nextRadius } },
      version: element.version + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() };
  });
}

export function cornerPath(element) {
  const { mode, radius } = cornerSettings(element);
  return getSvgPath({ width: element.width, height: element.height, cornerRadius: radius,
    cornerSmoothing: mode === "squircle" ? 0.6 : 0, preserveSmoothing: true });
}