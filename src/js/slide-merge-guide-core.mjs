export function guidePosition(client, origin, zoom, limit) {
  const value = (client - origin) / zoom;
  return value < 0 || value > limit ? null : Math.round(value * 10) / 10;
}
export function guideSnap(bounds, guides, zoom) {
  const result = { x: 0, y: 0 };
  for (const axis of ["x", "y"]) {
    const start = bounds[axis], size = bounds[axis === "x" ? "width" : "height"];
    let distance = 6 / zoom;
    for (const guide of guides.filter(item => item.axis === axis)) {
      for (const edge of [start, start + size / 2, start + size]) {
        const delta = guide.position - edge;
        if (Math.abs(delta) < distance) { result[axis] = delta; distance = Math.abs(delta); }
      }
    }
  }
  return result;
}