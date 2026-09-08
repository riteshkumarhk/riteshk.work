export const FONT_TABS = [
  ["scene", "In this scene"], ["serif", "Serif"], ["sans", "Sans"],
  ["display", "Display"], ["mono", "Mono"], ["handwritten", "Handwritten"]
];

export const FONT_GROUPS = {
  serif: ["Baskervville", "EB Garamond", "Gambetta", "Gelasio", "Instrument Serif", "Newsreader", "Spectral"],
  sans: ["Albert Sans", "Archivo", "Epilogue", "Figtree", "General Sans", "Hanken Grotesk", "IBM Plex Sans", "Inter", "Inter Tight", "Libre Franklin", "Manrope", "Mulish", "Plus Jakarta Sans", "Schibsted Grotesk", "Sora", "Space Grotesk", "Switzer", "Work Sans"],
  display: ["Anton", "Bricolage Grotesque", "DM Serif Display", "Fraunces", "Syne", "Unbounded"],
  mono: ["DM Mono", "Fira Code", "Fragment Mono", "Geist Mono", "IBM Plex Mono", "JetBrains Mono", "Martian Mono", "Space Mono", "Spline Sans Mono"],
  handwritten: ["Architects Daughter", "Caveat", "Dancing Script", "Kalam", "Patrick Hand", "Shantell Sans"]
};

export function filterFontCategory(fonts, sceneFamilies, category, query = "") {
  const search = query.trim().toLowerCase();
  return fonts.filter(font => {
    const family = font.text.replace(/^['"]|['"]$/g, "");
    return (category === "scene" ? sceneFamilies.has(font.value) : FONT_GROUPS[category]?.includes(family)) && family.toLowerCase().includes(search);
  });
}