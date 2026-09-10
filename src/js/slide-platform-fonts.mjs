import fonts from "../generated/slide-fonts.json";
import { FONT_GROUPS } from "./slide-font-categories.mjs";

export { fonts };
export const fontId = family => fonts.find(font => font.family === family)?.id;
export const DEFAULT_SLIDE_FONT = fontId("Inter");
export const LEGACY_FONTS = { 1: "Caveat", 2: "Inter", 3: "JetBrains Mono", 5: "Shantell Sans", 6: "Inter", 7: "Anton", 8: "JetBrains Mono", 9: "Inter" };
const registering = new Map();

export async function registerStudioFonts(system, registry, families, saved = []) {
  const records = [...saved];
  for (const record of records) {
    if (fonts.some(font => font.id === record.id)) continue;
    if (!record.family || !Array.isArray(record.faces) || !record.faces.length) continue;
    families[record.family] = record.id; fonts.push(record); registry.register(record.family, { metrics: record.metrics }, ...record.faces);
    if (!Object.values(FONT_GROUPS).some(group => group.includes(record.family))) FONT_GROUPS.sans.push(record.family);
  }
  if (!system) return;
  const faces = (system.faces || []).filter(face => face.family && face.url && (!face.style || face.style === "normal")).map(face => ({ family: face.family, uri: new URL(face.url, location.href).href, descriptors: { style: "normal", weight: String(face.weight || "400"), ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}) } }));
  for (const role of ["display", "text", "mono"]) {
    const font = system[role];
    if (!font?.family || fonts.some(record => record.family === font.family) || !font.css) continue;
    const url = font.src === "google" ? `https://fonts.googleapis.com/css2?family=${font.css}&display=swap` : font.src === "fontshare" ? `https://api.fontshare.com/v2/css?f[]=${font.css}&display=swap` : null;
    if (!url) continue;
    const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Could not load Studio font: ${font.family}`);
    const sheet = new CSSStyleSheet(); sheet.replaceSync(await response.text());
    for (const rule of sheet.cssRules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const style = rule.style, family = style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      if (family !== font.family || style.getPropertyValue("font-style") !== "normal") continue;
      const match = /url\(["']?([^"')]+)["']?\)/.exec(style.getPropertyValue("src"));
      if (match) faces.push({ family, uri: new URL(match[1], url).href, descriptors: { style: "normal", weight: style.getPropertyValue("font-weight") || "400", unicodeRange: style.getPropertyValue("unicode-range") || "U+0-10FFFF" } });
    }
  }
  for (const family of new Set(faces.map(face => face.family))) {
    if (fonts.some(font => font.family === family)) continue;
    if (!registering.has(family)) registering.set(family, (async () => {
      const sourceFaces = faces.filter(face => face.family === family).map(({ uri, descriptors }) => ({ uri, descriptors }));
      for (const face of sourceFaces) { const loaded = new FontFace(family, `url("${face.uri.replace(/["\\]/g, "")}")`, face.descriptors); await loaded.load(); document.fonts.add(loaded); }
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(family));
      const id = 1000 + parseInt([...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 7), 16);
      const context = document.createElement("canvas").getContext("2d"); context.font = `100px "${family.replace(/["\\]/g, "")}"`;
      const measured = context.measureText("Hg"), ascent = measured.fontBoundingBoxAscent || 80, descent = measured.fontBoundingBoxDescent || 20;
      const record = { family, id, faces: sourceFaces, runtime: true, metrics: { unitsPerEm: 1000, ascender: ascent * 10, descender: -descent * 10, lineHeight: Math.max(1.2, (ascent + descent) / 100) } };
      families[family] = id; fonts.push(record); registry.register(family, { metrics: record.metrics }, ...record.faces);
      const category = system.mono?.family === family ? "mono" : system.display?.family === family ? "display" : "sans";
      if (!Object.values(FONT_GROUPS).some(group => group.includes(family))) FONT_GROUPS[category].push(family);
    })().catch(error => { registering.delete(family); throw error; }));
    await registering.get(family);
  }
}
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