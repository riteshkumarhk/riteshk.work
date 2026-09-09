import { rulerTicks } from "./slide-merge-inserts.mjs";

const configurations = new WeakMap();

export function slideSnappingEnabled(elements) {
  const frame = elements.find(element => !element.isDeleted && configurations.has(element));
  if (!frame) return false;
  const options = configurations.get(frame);
  return !!(options.snap || options.grid || options.rulers || options.guidesEnabled !== false);
}

export function configureSlideSnapping(frame, options) {
  if (frame) configurations.set(frame, options);
}

export function slideSnapTargets(options = {}) {
  const horizontal = new Set([0, 640, 1280]);
  const vertical = new Set([0, 360, 720]);
  if (options.grid) {
    const step = Number.isFinite(options.gridSize) && options.gridSize >= 5 ? options.gridSize : 20;
    for (let position = 0; position <= 1280; position += step) horizontal.add(position);
    for (let position = 0; position <= 720; position += step) vertical.add(position);
  }
  if (options.rulers) {
    rulerTicks(1280).forEach(position => horizontal.add(position));
    rulerTicks(720).forEach(position => vertical.add(position));
  }
  if (options.guidesEnabled !== false) {
    for (const guide of options.guides || []) {
      if (Number.isFinite(guide.position) && (guide.axis === "x" || guide.axis === "y")) (guide.axis === "x" ? horizontal : vertical).add(guide.position);
    }
    if (options.margins) { horizontal.add(64).add(1216); vertical.add(36).add(684); }
    if (options.thirds) { horizontal.add(1280 / 3).add(2560 / 3); vertical.add(240).add(480); }
  }
  return { x: [...horizontal], y: [...vertical] };
}

export function slideReferencePoints(elements) {
  const frame = elements.find(element => !element.isDeleted && configurations.has(element));
  if (!frame) return [];
  const targets = slideSnapTargets(configurations.get(frame));
  return [...targets.x.flatMap(position => [[position, 0], [position, 720]]), ...targets.y.flatMap(position => [[0, position], [1280, position]])];
}

export function isSlideSnappingScene(elements) {
  return elements.some(element => !element.isDeleted && configurations.has(element));
}