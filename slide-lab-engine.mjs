import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export function cornerEnginePlugin() {
  let patched = 0;
  let pickerPatched = 0;
  return { name: "lab-corner-geometry", setup(build) {
    build.onResolve({ filter: /^@excalidraw\/excalidraw$/ }, () => ({ path: resolve("node_modules/@excalidraw/excalidraw/dist/dev/index.js") }));
    build.onLoad({ filter: /excalidraw[\\/]dist[\\/]dev[\\/]index\.js$/ }, async ({ path }) => {
      let source = await readFile(path, "utf8");
      const version = JSON.parse(await readFile("node_modules/@excalidraw/excalidraw/package.json", "utf8")).version;
      if (version !== "0.18.1") throw new Error("Revalidate the Slide Lab color adapter for Excalidraw " + version);
      const edits = [
        ['const [customColors] = React4.useState(() => {\n    if (type === "canvasBackground") {\n      return [];\n    }\n    return getMostUsedCustomColors(elements, type, palette2);\n  });', 'const customColors = labUseCustomColors(color, type === "canvasBackground" ? [] : getMostUsedCustomColors(elements, type, palette2), palette2);'],
        ['const handled = colorPickerKeyNavHandler({', 'if (event.target.closest(".lab-rich-color") && event.key !== "Escape" || event.key === "Tab" && event.target.tagName === "INPUT") return;\n        const handled = colorPickerKeyNavHandler({'],
        ['children: colorInputJSX\n', 'children: jsxs11("div", { className: "lab-color-detail", children: [colorInputJSX, jsx21(LabRichColor, { color, onChange })] })\n'],
        ['!!customColors.length && /* @__PURE__ */ jsxs8("div", { children: [', 'jsx16(LabStrokeLink, { type }),\n        !!customColors.length && /* @__PURE__ */ jsxs8("div", { children: ['],
        ['showFillIcons && renderAction("changeFillStyle"),', 'jsx70(LabTextColorControls, { NativePicker: ColorPicker, palette: DEFAULT_ELEMENT_STROKE_COLOR_PALETTE, topPicks: DEFAULT_ELEMENT_STROKE_PICKS, appState }),\n    showFillIcons && renderAction("changeFillStyle"),'],
        ['elementStroke: "strokeColor"\n', 'elementStroke: "strokeColor",\n    labText: "strokeColor"\n']
      ];
      for (const [before, after] of edits) {
        if (source.split(before).length !== 2) throw new Error("Excalidraw color adapter anchor changed: " + before.slice(0, 60));
        source = source.replace(before, after);
      }
      source = source.replaceAll('t("colorPicker.mostUsedCustomColors")', '"Custom colors"');
      pickerPatched++;
      return { contents: `import { LabRichColor, useLabCustomColors as labUseCustomColors } from ${JSON.stringify(resolve("src/js/slide-lab-color-picker.jsx").replaceAll("\\", "/"))};\nimport { LabStrokeLink, LabTextColorControls } from ${JSON.stringify(resolve("src/js/slide-lab-text-color.jsx").replaceAll("\\", "/"))};\n` + source, loader: "js", resolveDir: dirname(path) };
    });
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
    build.onEnd(result => { if (!result.errors.length && (patched !== 1 || pickerPatched !== 1)) return { errors: [{ text: "Expected exactly one Slide Lab corner and color adapter" }] }; });
  } };
}