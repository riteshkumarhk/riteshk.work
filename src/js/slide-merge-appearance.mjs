export function canvasTheme(elements, appearance) {
  return elements.some(element => !element.isDeleted && element.customData?.slideBackground) ? "light" : appearance;
}