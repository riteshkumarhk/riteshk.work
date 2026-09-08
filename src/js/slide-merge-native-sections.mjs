export function nativeSectionElement(element) {
  if (!element.customData?.sectionComponent) return element;
  if (element.type === "rectangle" && element.link == null && element.backgroundColor === "rgba(0, 0, 0, 0)") return element;
  return { ...element, type: "rectangle", link: null, backgroundColor: "rgba(0, 0, 0, 0)", strokeColor: "transparent", fillStyle: "solid", roughness: 0 };
}

export function nativeSectionLayers(elements, state) {
  const zoom = state.zoom.value;
  const visible = elements.filter(element => !element.isDeleted && !element.customData?.labLayerHidden);
  return visible.filter(element => element.customData?.sectionComponent).map(element => {
    const frame = visible.find(frame => frame.id === element.frameId) || visible.find(frame => frame.type === "frame");
    const left = frame ? (frame.x + state.scrollX) * zoom : 0;
    const top = frame ? (frame.y + state.scrollY) * zoom : 0;
    const right = left + (frame?.width || 0) * zoom;
    const bottom = top + (frame?.height || 0) * zoom;
    const rest = visible.slice(visible.indexOf(element) + 1);
    const next = rest.findIndex(item => item.customData?.sectionComponent);
    return {
      element,
      frame,
      foreground: rest.slice(0, next < 0 ? rest.length : next).filter(item => item.type !== "frame" && item.type !== "embeddable"),
      frameStyle: frame ? { left, top, width: frame.width * zoom, height: frame.height * zoom } : undefined,
      clipStyle: frame && state.frameRendering?.clip !== false ? { clipPath: `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)` } : undefined,
      style: {
        left: (element.x + state.scrollX) * zoom,
        top: (element.y + state.scrollY) * zoom,
        width: element.width * zoom,
        height: element.height * zoom,
        transform: `rotate(${element.angle || 0}rad)`,
        opacity: (element.opacity ?? 100) / 100
      }
    };
  });
}