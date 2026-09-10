export function clampNotesHeight(value, editorHeight) {
  const maximum = Math.max(0, editorHeight / 2);
  const minimum = Math.min(80, maximum);
  const requested = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(requested) && requested > 0 ? requested : 116));
}

export function formatSlideDuration(minutes) {
  const value = Number(minutes);
  const seconds = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(240, value)) * 60) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function parseSlideDuration(value) {
  const text = String(value).trim();
  if (!text) return 0;
  const match = /^(\d{1,3})(?::([0-5]\d))?$/.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2] || 0);
  return seconds <= 240 * 60 ? seconds / 60 : null;
}