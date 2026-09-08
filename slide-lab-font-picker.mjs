export function patchFontPicker(source) {
  const start = source.indexOf("var FontPickerList = React12.memo(");
  const end = source.indexOf("// components/FontPicker/FontPickerTrigger.tsx", start);
  if (start < 0 || end < 0) throw new Error("Excalidraw font picker boundary changed");
  let picker = source.slice(start, end);
  function replace(before, after) {
    if (picker.split(before).length !== 2) throw new Error("Excalidraw font tab anchor changed: " + before.slice(0, 60));
    picker = picker.replace(before, after);
  }
  replace('const [searchTerm, setSearchTerm] = useState7("");', 'const [searchTerm, setSearchTerm] = useState7("");\n    const [fontCategory, setFontCategory] = useState7("scene");\n    const fontPanelId = React12.useId();');
  replace('text: fontFaces[0]?.fontFace?.family ?? "Unknown"', 'text: (fontFaces[0]?.fontFace?.family ?? "Unknown").replace(/^[\'\"]|[\'\"]$/g, "")');
  replace('[...sceneFonts, ...availableFonts].filter(\n          (font) => font.text?.toLowerCase().includes(searchTerm)\n        )', 'labFilterFontCategory(allFonts, sceneFamilies, fontCategory, searchTerm)');
  replace('[sceneFonts, availableFonts, searchTerm]', '[allFonts, sceneFamilies, fontCategory, searchTerm]');
  const groupStart = picker.indexOf('    const groups = [];');
  const groupEnd = picker.indexOf('    return /* @__PURE__ */ jsxs17(', groupStart);
  if (groupStart < 0 || groupEnd < 0) throw new Error("Excalidraw font group anchor changed");
  picker = picker.slice(0, groupStart) + '    const groups = filteredFonts.map(renderFont);\n' + picker.slice(groupEnd);
  replace('className: "properties-content",', 'className: "properties-content lab-font-picker",');
  replace('style: { width: "15rem" },', 'style: { width: "18rem" },');
  replace('          /* @__PURE__ */ jsx30(\n            ScrollableList,', '          jsx30(LabFontCategoryTabs, { category: fontCategory, panelId: fontPanelId, onChange: category => { onLeave(); setFontCategory(category); } }),\n          jsx30("div", { role: "tabpanel", id: fontPanelId, "aria-labelledby": fontPanelId + "-" + fontCategory, children: jsx30(\n            ScrollableList,');
  replace('children: groups.length ? groups : null\n            }\n          )', 'children: groups.length ? groups : null\n            }\n          ) })');
  return source.slice(0, start) + picker + source.slice(end);
}