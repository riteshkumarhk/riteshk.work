export function clampNotesHeight(value, editorHeight) {
  const maximum = Math.max(0, editorHeight / 2);
  const minimum = Math.min(80, maximum);
  const requested = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(requested) && requested > 0 ? requested : 116));
}