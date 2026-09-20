import { COVER_DEFAULTS } from "./slide-merge-cover.mjs";

export const COVER_LIGHT_PALETTE = Object.freeze({ background: "#f2eee6", rail: "#eae5db", panel: "#e2dcd0", text: "#1b1915", muted: "#5c5850" });

export function coverAppearanceElements(elements, appearance) {
  const palette = appearance === "light" ? COVER_LIGHT_PALETTE : COVER_DEFAULTS;
  const background = elements.find(element => !element.isDeleted && element.customData?.slideBackground && element.type === "rectangle" && element.x === 0 && element.y === 0 && element.width === 1280 && element.height === 720);
  const legacy = background && !elements.some(element => element.customData?.slideCover) && elements.some(element => !element.isDeleted && element.frameId === background.frameId && element.type === "rectangle" && element.x === 0 && element.y === 0 && element.width === 136 && element.height === 720) && elements.some(element => !element.isDeleted && element.frameId === background.frameId && element.type === "rectangle" && element.x === 529 && element.width === 751 && element.y + element.height === 720);
  return elements.map(element => {
    if (element.isDeleted || !(element.customData?.slideCover || legacy && element.frameId === background.frameId) || !["text", "rectangle"].includes(element.type)) return element;
    const field = element.type === "text" ? "strokeColor" : "backgroundColor";
    const keys = element.type === "text" ? ["text", "muted"] : ["background", "rail", "panel"];
    const key = keys.find(name => [COVER_DEFAULTS[name], COVER_LIGHT_PALETTE[name]].includes(element[field]?.toLowerCase()));
    return key && element[field] !== palette[key] ? { ...element, [field]: palette[key] } : element;
  });
}

export function canvasTheme(elements, appearance) {
  return elements.some(element => !element.isDeleted && element.customData?.slideBackground) ? "light" : appearance;
}