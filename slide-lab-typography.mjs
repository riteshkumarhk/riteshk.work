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