export function placeholderBounds(element) {
  const slot = element.customData?.slidePlaceholder;
  return slot?.kind === "text" ? { ...element, height: Math.max(element.height, slot.height * 7.2) } : element;
}

export function fitPlaceholder(elements, slot) {
  if (!slot || !elements.length) return elements;
  slot = placeholderBounds(slot);
  const left = Math.min(...elements.map(element => element.x));
  const top = Math.min(...elements.map(element => element.y));
  const width = Math.max(...elements.map(element => element.x + element.width)) - left;
  const height = Math.max(...elements.map(element => element.y + element.height)) - top;
  const scale = Math.min(1, slot.width / Math.max(1, width), slot.height / Math.max(1, height));
  return elements.map(element => ({
    ...element,
    x: slot.x + (slot.width - width * scale) / 2 + (element.x - left) * scale,
    y: slot.y + (slot.height - height * scale) / 2 + (element.y - top) * scale,
    width: element.width * scale,
    height: element.height * scale,
    ...(element.fontSize ? { fontSize: element.fontSize * scale } : {}),
    ...(element.points ? { points: element.points.map(point => point.map(value => value * scale)) } : {})
  }));
}