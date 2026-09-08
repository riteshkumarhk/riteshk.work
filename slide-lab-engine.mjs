import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export function cornerEnginePlugin() {
  let patched = 0;
  return { name: "lab-corner-geometry", setup(build) {
    build.onResolve({ filter: /^@excalidraw\/excalidraw$/ }, () => ({ path: resolve("node_modules/@excalidraw/excalidraw/dist/dev/index.js") }));
    build.onLoad({ filter: /excalidraw[\\/]dist[\\/]dev[\\/]chunk-.*\.js$/ }, async ({ path }) => {
      let source = await readFile(path, "utf8");
      const radiusAnchor = "var getCornerRadius = (x, element) => {";
      if (!source.includes(radiusAnchor)) return;
      const version = JSON.parse(await readFile("node_modules/@excalidraw/excalidraw/package.json", "utf8")).version;
      if (version !== "0.18.1") throw new Error("Revalidate the Slide Lab corner adapter for Excalidraw " + version);
      const shapeAnchor = "  embedsValidationStatus\n}) => {\n  switch (element.type) {";
      if (source.split(radiusAnchor).length !== 2 || source.split(shapeAnchor).length !== 2) throw new Error("Excalidraw corner adapter anchors changed");
      source = source.replace(radiusAnchor, radiusAnchor + '\n  if (element.type === "rectangle" && element.customData?.labCorners) return labCornerSettings(element).radius;');
      source = source.replace(shapeAnchor, '  embedsValidationStatus\n}) => {\n  if (element.type === "rectangle" && element.customData?.labCorners) return generator.path(labCornerPath(element), generateRoughOptions(element, true));\n  switch (element.type) {');
      patched++;
      return { contents: `import { cornerPath as labCornerPath, cornerSettings as labCornerSettings } from ${JSON.stringify(resolve("src/js/slide-lab-corners.mjs").replaceAll("\\", "/"))};\n` + source, loader: "js", resolveDir: dirname(path) };
    });
    build.onEnd(result => { if (!result.errors.length && patched !== 1) return { errors: [{ text: "Expected exactly one Slide Lab corner geometry adapter" }] }; });
  } };
}