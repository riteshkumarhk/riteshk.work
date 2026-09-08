import fonts from "../generated/slide-fonts.json";

export { fonts };
export const fontId = family => fonts.find(font => font.family === family)?.id;
export const DEFAULT_SLIDE_FONT = fontId("Inter");
export const LEGACY_FONTS = { 1: "Caveat", 2: "Inter", 3: "JetBrains Mono", 5: "Shantell Sans", 6: "Inter", 7: "Anton", 8: "JetBrains Mono", 9: "Inter" };
export function platformText(elements) {
  return elements.map(element => {
    const next = { ...element };
    if (element.type === "text" && LEGACY_FONTS[element.fontFamily]) {
      next.fontFamily = fontId(LEGACY_FONTS[element.fontFamily]);
      next.lineHeight = fonts.find(font => font.id === next.fontFamily).metrics.lineHeight;
    }
    if (element.label) next.label = { ...element.label, fontFamily: fontId(LEGACY_FONTS[element.label.fontFamily]) || element.label.fontFamily || DEFAULT_SLIDE_FONT };
    return next;
  });
}

export async function loadPlatformFonts(elements = []) {
  const families = new Set([DEFAULT_SLIDE_FONT, ...elements.filter(element => element.type === "text").map(element => element.fontFamily)]);
  const loaded = [];
  for (const font of fonts.filter(item => families.has(item.id))) {
    for (const face of font.faces) {
      let existing = [...document.fonts].find(item => item.family.replace(/^['"]|['"]$/g, "") === font.family && item.unicodeRange === new FontFace(font.family, `url("${face.uri}")`, face.descriptors).unicodeRange);
      if (!existing) {
        existing = new FontFace(font.family, `url("${face.uri}")`, face.descriptors);
        document.fonts.add(existing);
      }
      loaded.push(existing.load());
    }
  }
  await Promise.all(loaded);
}