export function patchTypography(source) {
  const start = source.indexOf('var actionChangeFontSize = register({');
  const end = source.indexOf('var actionDecreaseFontSize = register({', start);
  if (start < 0 || end < 0) throw new Error('Font size action boundary changed');
  const action = source.slice(start, end);
  const valueStart = action.indexOf('value: getFormValue(');
  const valueEnd = action.indexOf(',\n        onChange:', valueStart);
  if (valueStart < 0 || valueEnd < 0) throw new Error('Font size value anchor changed');
  const panelStart = action.indexOf('  PanelComponent:');
  const panel = `  PanelComponent: ({ elements, appState, updateData, app }) => jsx34(LabFontSizePicker, {
    ${action.slice(valueStart, valueEnd)}, onChange: updateData,
    ButtonSelect: ButtonIconSelect, Button: ButtonIcon, Content: PropertiesPopover,
    useContainer: useExcalidrawContainer,
    icons: [FontSizeSmallIcon, FontSizeMediumIcon, FontSizeLargeIcon]
  })\n});\n`;
  source = source.slice(0, start) + action.slice(0, panelStart) + panel + source.slice(end);
  const edits = [
    ['icon: TextIcon,\n      title: t("labels.showFonts"),', 'icon: jsx31(LabFontLibraryIcon, {}),\n      title: t("labels.showFonts"),'],
    ['jsx34("legend", { children: t("labels.fontFamily") })', 'jsxs20("legend", { children: [t("labels.fontFamily"), jsx34("span", { className: "lab-type-value", children: selectedFontFamily ? getFontFamilyString({ fontFamily: selectedFontFamily }).split(",")[0].replace(/[\'\"]/g, "") : "Mixed" })] })']
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('Typography anchor changed: ' + before);
    source = source.replace(before, after);
  }
  return source;
}

export function patchTextFormatting(source, target) {
  const edits = target === "renderer" ? [
    ['        "data-testid": testId,\n        className: clsx3(className, { standalone, active }),', '        "data-testid": testId,\n        "aria-label": props["aria-label"],\n        "aria-pressed": props["aria-pressed"],\n        "aria-haspopup": props["aria-haspopup"],\n        "aria-expanded": props["aria-expanded"],\n        "aria-controls": props["aria-controls"],\n        disabled: props.disabled,\n        onPointerDown: props.onPointerDown,\n        className: clsx3(className, { standalone, active }),'],
    ['      renderAction("changeFontSize"),', '      renderAction("changeFontSize"),\n      renderAction("labTextFormat"),'],
    ['        lineHeight: updatedTextElement.lineHeight,', '        lineHeight: updatedTextElement.lineHeight,\n        textDecoration: labTextDecoration(updatedTextElement),'],
    ['    const { textAlign, verticalAlign } = updatedTextElement;', '    if (editable.value !== updatedTextElement.originalText) {\n      const start = editable.selectionStart, end = editable.selectionEnd, direction = editable.selectionDirection;\n      editable.value = updatedTextElement.originalText;\n      editable.setSelectionRange(Math.min(start, editable.value.length), Math.min(end, editable.value.length), direction);\n    }\n    const { textAlign, verticalAlign } = updatedTextElement;'],
    ['var actionChangeTextAlign = register({', `var actionLabTextFormat = register({
  name: "labTextFormat", label: "Text style", trackEvent: false,
  perform: (elements, appState, value, app) => {
    if (appState.viewModeEnabled || !["bold", "italic", "underline", "strikethrough", "bullets", "bullet-style", "indent", "outdent"].includes(value?.action)) return false;
    if (value.action === "bullet-style" && !["dot", "number", "alphabet", "dash"].includes(value.value)) return false;
    return {
      elements: changeProperty(elements, appState, element => {
        if (!isTextElement(element) || element.locked || app.scene.getContainerElement(element)?.locked) return element;
        const styleAction = ["bold", "italic", "underline", "strikethrough"].includes(value.action);
        const originalText = styleAction ? element.originalText : labFormatTextLines(element.originalText ?? element.text, value.action, value.value);
        const updated = newElementWith(element, styleAction ? { customData: { ...element.customData, textFormat: { ...labTextFormat(element), [value.action]: value.value === true } } } : { originalText, text: originalText });
        redrawTextBoundingBox(updated, app.scene.getContainerElement(element), app.scene.getNonDeletedElementsMap());
        return updated;
      }, true),
      appState, captureUpdate: CaptureUpdateAction.IMMEDIATELY
    };
  },
  PanelComponent: ({ elements, appState, updateData, app }) => jsx34(LabTextFormatControls, {
    elements: getTargetElements(app.scene.getNonDeletedElementsMap(), appState).filter(element => isTextElement(element) && !element.locked && !app.scene.getContainerElement(element)?.locked),
    onChange: updateData, Button: ButtonIcon, Content: PropertiesPopover, useContainer: useExcalidrawContainer
  })
});
var actionChangeTextAlign = register({`]
  ] : [
    ['  const fontSize = parseFloat(font);', '  const fontSize = parseFloat(font.match(/(?:^|\\s)([\\d.]+)px\\b/)?.[1] ?? font);'],
    ['var getFontString = ({\n  fontSize,\n  fontFamily\n}) => {\n  return `${fontSize}px ${getFontFamilyString({ fontFamily })}`;\n};', 'var getFontString = (element) => {\n  return `${labTextFontPrefix(element)}${element.fontSize}px ${getFontFamilyString(element)}`;\n};'],
    ['            index * lineHeightPx + verticalOffset\n          );', '            index * lineHeightPx + verticalOffset\n          );\n          labDrawTextDecorations(context, element, lines[index], horizontalOffset, index * lineHeightPx + verticalOffset);'],
    ['          text.setAttribute("font-size", `${element.fontSize}px`);', '          text.setAttribute("font-size", `${element.fontSize}px`);\n          text.setAttribute("font-weight", labTextFormat(element).bold ? "bold" : "normal");\n          text.setAttribute("font-style", labTextFormat(element).italic ? "italic" : "normal");\n          text.setAttribute("text-decoration", labTextDecoration(element));']
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error("Text formatting anchor changed: " + before.slice(0, 70));
    source = source.replace(before, after);
  }
  return source;
}