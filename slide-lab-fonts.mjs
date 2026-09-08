import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import postcss from "postcss";
import { create } from "fontkit";

export function fontCatalog(stylesheets) {
  const families = new Map();
  for (const { css, base } of stylesheets) {
    postcss.parse(css).walkAtRules("font-face", rule => {
      const props = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
      const family = props["font-family"]?.replace(/^['"]|['"]$/g, "");
      const weight = (props["font-weight"] || "400").split(/\s+/).map(Number);
      if (!family || props["font-style"] !== "normal" || weight[0] > 400 || (weight[1] || weight[0]) < 400) return;
      const src = props.src?.match(/url\(['"]?([^'"\)]+)['"]?\)/)?.[1];
      if (!src) return;
      const uri = new URL(src, base).href;
      if (!/^https:\/\/(media\.)?riteshk\.work\//.test(uri)) throw new Error("Font must be platform hosted: " + uri);
      const descriptors = { style: "normal", weight: props["font-weight"] || "400" };
      if (props["unicode-range"]) descriptors.unicodeRange = props["unicode-range"];
      const faces = families.get(family) || [];
      const sameRange = faces.findIndex(face => face.descriptors.unicodeRange === descriptors.unicodeRange);
      if (sameRange >= 0) faces.splice(sameRange, 1);
      faces.push({ uri, descriptors });
      families.set(family, faces);
    });
  }
  return [...families].sort(([first], [second]) => first.localeCompare(second)).map(([family, faces]) => ({
    family, id: 1000 + parseInt(createHash("sha256").update(family).digest("hex").slice(0, 7), 16), faces
  }));
}

export async function generateFonts() {
  const stylesheets = await Promise.all(["fonts.css", "fonts-systems.css"].map(async name => ({
    css: await readFile("css/" + name, "utf8"), base: "https://riteshk.work/css/" + name
  })));
  const fonts = fontCatalog(stylesheets);
  for (const font of fonts) {
    const face = font.faces.find(item => !item.descriptors.unicodeRange || item.descriptors.unicodeRange.includes("U+0000-00FF")) || font.faces[0];
    const url = new URL(face.uri);
    let bytes;
    if (url.hostname === "riteshk.work") bytes = await readFile("." + url.pathname);
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Font download " + response.status + ": " + font.family);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const parsed = create(bytes);
    font.metrics = { unitsPerEm: parsed.unitsPerEm, ascender: parsed.ascent, descender: parsed.descent,
      lineHeight: Math.max(1.2, (parsed.ascent - parsed.descent + parsed.lineGap) / parsed.unitsPerEm) };
  }
  const target = "src/generated/slide-fonts.json";
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(fonts, null, 2) + "\n");
  console.log("Generated " + fonts.length + " platform font families with original font metrics");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await generateFonts();