import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import postcss from "postcss";
import { patchFontPicker } from "./slide-lab-font-picker.mjs";
import { patchSelectionBounds } from "./slide-lab-selection-bounds.mjs";
import { patchTypography } from "./slide-lab-typography.mjs";

export function stripUpstreamFirebase(source) {
  return source.replace(/VITE_APP_FIREBASE_CONFIG: '(?:[^'\\]|\\.)*'/g, 'VITE_APP_FIREBASE_CONFIG: "{}"');
}

export function cornerEnginePlugin() {
  let patched = 0;
  let pickerPatched = 0;
  return { name: "lab-corner-geometry", setup(build) {
    build.onLoad({ filter: /excalidraw[\\/]dist[\\/].*\.css$/ }, async ({ path }) => {
      const css = postcss.parse(await readFile(path, "utf8"));
      css.walkAtRules("font-face", rule => rule.remove());
      css.walkDecls(declaration => { if (declaration.value.includes("Assistant")) declaration.value = declaration.value.replaceAll("Assistant", "Inter"); });
      return { contents: css.toString(), loader: "css", resolveDir: dirname(path) };
    });
    build.onResolve({ filter: /^@excalidraw\/excalidraw$/ }, () => ({ path: resolve("node_modules/@excalidraw/excalidraw/dist/dev/index.js") }));
    build.onLoad({ filter: /excalidraw[\\/]dist[\\/]dev[\\/]index\.js$/ }, async ({ path }) => {
      let source = await readFile(path, "utf8");
      const version = JSON.parse(await readFile("node_modules/@excalidraw/excalidraw/package.json", "utf8")).version;
      if (version !== "0.18.1") throw new Error("Revalidate the Slide Lab color adapter for Excalidraw " + version);
      const edits = [
        ['        /* @__PURE__ */ jsx92(Header, {}),', '        !document.querySelector(".merge-shell") && /* @__PURE__ */ jsx92(Header, {}),'],
        ['        isFullscreen && /* @__PURE__ */ jsx67(\n          "button",\n          {\n            className: "Dialog__close",', '        (isFullscreen || !!document.querySelector(".merge-shell")) && /* @__PURE__ */ jsx67(\n          "button",\n          {\n            className: "Dialog__close",'],
        ['                transform: isVisible ? `rotate(${el.angle}rad)` : "none",', '                transform: isVisible ? `rotate(${el.angle}rad)` : "none",\n                clipPath: el.customData?.labCorners ? `path("${labCornerPath(el)}")` : undefined,\n                "--embeddable-radius": el.customData?.labCorners ? "0px" : undefined,'],
        ['      const pixel = ctx.getImageData(\n        (clientX - appState.offsetLeft) * window.devicePixelRatio,\n        (clientY - appState.offsetTop) * window.devicePixelRatio,\n        1,\n        1\n      ).data;\n      return rgbToHex(pixel[0], pixel[1], pixel[2]);', '      return labSampleCanvasColor(app.canvas, clientX, clientY, colorPickerType === "canvasBackground" || !stableProps.selectedElements.length && !!excalidrawContainer?.querySelector(".merge-slide-color"));'],
        ['      if (isHoldingPointerDown) {\n        stableProps.onChange(', '      if (!currentColor) return;\n      if (isHoldingPointerDown) {\n        stableProps.onChange('],
        ['      onSelect2(getCurrentColor(event), event);', '      const pickedColor = getCurrentColor(event);\n      if (pickedColor) onSelect2(pickedColor, event);'],
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
      source = source.replace('value: FONT_FAMILY.Excalifont,\n    icon: FreedrawIcon,\n    text: t("labels.handDrawn")', 'value: FONT_FAMILY.Fraunces,\n    icon: TextIcon,\n    text: "Fraunces"');
      source = source.replace('value: FONT_FAMILY.Nunito,\n    icon: FontFamilyNormalIcon,\n    text: t("labels.normal")', 'value: FONT_FAMILY.Inter,\n    icon: FontFamilyNormalIcon,\n    text: "Inter"');
      source = source.replace('value: FONT_FAMILY["Comic Shanns"],\n    icon: FontFamilyCodeIcon,\n    text: t("labels.code")', 'value: FONT_FAMILY["JetBrains Mono"],\n    icon: FontFamilyCodeIcon,\n    text: "JetBrains Mono"');
      source = patchTypography(patchSelectionBounds(patchFontPicker(source), "renderer"));
      source = `import { FontSizePicker as LabFontSizePicker, FontLibraryIcon as LabFontLibraryIcon } from ${JSON.stringify(resolve("src/js/slide-font-size.jsx").replaceAll("\\", "/"))};\n` + source;
      source = `import { cornerPath as labCornerPath } from ${JSON.stringify(resolve("src/js/slide-lab-corners.mjs").replaceAll("\\", "/"))};\n` + source;
      source = `import { sampleCanvasColor as labSampleCanvasColor } from ${JSON.stringify(resolve("src/js/slide-lab-eyedropper.mjs").replaceAll("\\", "/"))};\n` + source;
      source += '\nexport { ColorPicker as LabColorPicker, DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE as LAB_BACKGROUND_PALETTE };\n';
      source += '\nexport { useExcalidrawActionManager as useLabActionManager, newElementWith as labNewElementWith };\n';
      source = `import { FontCategoryTabs as LabFontCategoryTabs } from ${JSON.stringify(resolve("src/js/slide-font-tabs.jsx").replaceAll("\\", "/"))};\nimport { filterFontCategory as labFilterFontCategory } from ${JSON.stringify(resolve("src/js/slide-font-categories.mjs").replaceAll("\\", "/"))};\n` + source;
      pickerPatched++;
      return { contents: `import { LabRichColor, useLabCustomColors as labUseCustomColors } from ${JSON.stringify(resolve("src/js/slide-lab-color-picker.jsx").replaceAll("\\", "/"))};\nimport { LabStrokeLink, LabTextColorControls } from ${JSON.stringify(resolve("src/js/slide-lab-text-color.jsx").replaceAll("\\", "/"))};\n` + source, loader: "js", resolveDir: dirname(path) };
    });
    build.onLoad({ filter: /excalidraw[\\/]dist[\\/]dev[\\/]chunk-.*\.js$/ }, async ({ path }) => {
      const original = await readFile(path, "utf8");
      let source = stripUpstreamFirebase(original);
      const radiusAnchor = "var getCornerRadius = (x, element) => {";
      if (!source.includes(radiusAnchor)) return source !== original ? { contents: source, loader: "js", resolveDir: dirname(path) } : undefined;
      const version = JSON.parse(await readFile("node_modules/@excalidraw/excalidraw/package.json", "utf8")).version;
      if (version !== "0.18.1") throw new Error("Revalidate the Slide Lab corner adapter for Excalidraw " + version);
      source = patchSelectionBounds(source, "handles");
      const shapeAnchor = "  embedsValidationStatus\n}) => {\n  switch (element.type) {";
      if (source.split(radiusAnchor).length !== 2 || source.split(shapeAnchor).length !== 2) throw new Error("Excalidraw corner adapter anchors changed");
      source = source.replace(radiusAnchor, radiusAnchor + '\n  if (element.customData?.labCorners) return labCornerSettings(element).radius;');
      source = source.replace(shapeAnchor, '  embedsValidationStatus\n}) => {\n  if (["rectangle", "embeddable"].includes(element.type) && element.customData?.labCorners) return generator.path(labCornerPath(element), generateRoughOptions(element, true));\n  switch (element.type) {');
      const mediaEdits = [
        ['        if (element.roundness && context.roundRect) {', '        if (element.customData?.labCorners) {\n          context.clip(new Path2D(labCornerPath(element)));\n        } else if (element.roundness && context.roundRect) {'],
        ['          clipPath.appendChild(clipRect);', '          if (element.customData?.labCorners) {\n            const clipShape = svgRoot.ownerDocument.createElementNS(SVG_NS, "path");\n            clipShape.setAttribute("d", labCornerPath(element));\n            clipShape.setAttribute("transform", `translate(${normalizedCropX} ${normalizedCropY})`);\n            clipPath.appendChild(clipShape);\n          } else clipPath.appendChild(clipRect);']
      ];
      for (const [before, after] of mediaEdits) {
        if (source.split(before).length !== 2) throw new Error("Excalidraw media corner anchor changed: " + before);
        source = source.replace(before, after);
      }
      const fontStart = source.indexOf('    init("Cascadia", ...CascadiaFontFaces);');
      const fontEnd = source.indexOf('    _Fonts._initialized = true;', fontStart);
      if (fontStart < 0 || fontEnd < 0) throw new Error("Excalidraw font registry anchor changed");
      source = source.slice(0, fontStart) + '    for (const font of labFonts) {\n      _Fonts.register.call(fonts, font.family, { metrics: font.metrics }, ...font.faces);\n    }\n    for (const [id, family] of Object.entries(labLegacyFonts)) {\n      const entry = fonts.registered.get(FONT_FAMILY[family]);\n      fonts.registered.set(Number(id), { ...entry, metadata: { ...entry.metadata, fallback: true } });\n    }\n' + source.slice(fontEnd);
      source = source.replace('var FONT_FAMILY = {', 'var FONT_FAMILY = {\n  ...Object.fromEntries(labFonts.map(font => [font.family, font.id])),');
      source = source.replace('var DEFAULT_FONT_FAMILY = FONT_FAMILY.Excalifont;', 'var DEFAULT_FONT_FAMILY = FONT_FAMILY.Inter;');
      source = source.replace('var getFontFamilyFallbacks = (fontFamily) => {', 'var getFontFamilyFallbacks = (fontFamily) => {\n  return [];');
      source = source.replace('}) => {\n  for (const [fontFamilyString, id] of Object.entries(FONT_FAMILY)) {', '}) => {\n  if (labLegacyFonts[fontFamily]) return labLegacyFonts[fontFamily];\n  for (const [fontFamilyString, id] of Object.entries(FONT_FAMILY)) {');
      patched++;
      return { contents: `import { fonts as labFonts, LEGACY_FONTS as labLegacyFonts } from ${JSON.stringify(resolve("src/js/slide-platform-fonts.mjs").replaceAll("\\", "/"))};\nimport { cornerPath as labCornerPath, cornerSettings as labCornerSettings } from ${JSON.stringify(resolve("src/js/slide-lab-corners.mjs").replaceAll("\\", "/"))};\n` + source, loader: "js", resolveDir: dirname(path) };
    });
    build.onEnd(result => { if (!result.errors.length && (patched !== 1 || pickerPatched !== 1)) return { errors: [{ text: "Expected exactly one Slide Lab corner and color adapter" }] }; });
  } };
}