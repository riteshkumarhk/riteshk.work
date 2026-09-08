export function patchSelectionBounds(source, part) {
  const edits = part === "renderer" ? [
    ["const padding = elementProperties.padding ?? DEFAULT_TRANSFORM_HANDLE_SPACING * 2;", "const padding = elementProperties.padding ?? 0;"],
    ["const dashedLinePadding = DEFAULT_TRANSFORM_HANDLE_SPACING * 2 / appState.zoom.value;", "const dashedLinePadding = 0;"]
  ] : [
    ["omitSides = {}, margin = 4, spacing = DEFAULT_TRANSFORM_HANDLE_SPACING) => {", "omitSides = {}, margin = 0, spacing = 0) => {"],
    ["const margin = isLinearElement(element) ? DEFAULT_TRANSFORM_HANDLE_SPACING + 8 : isImageElement(element) ? 0 : DEFAULT_TRANSFORM_HANDLE_SPACING;", "const margin = 0;"]
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error("Excalidraw selection bounds anchor changed: " + before);
    source = source.replace(before, after);
  }
  return source;
}