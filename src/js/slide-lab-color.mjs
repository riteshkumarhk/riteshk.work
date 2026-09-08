export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return "#" + (digits.length === 3 ? [...digits].map(digit => digit + digit).join("") : digits);
}

export function hexToRgb(value) {
  const hex = normalizeHex(value);
  return hex ? [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) : null;
}

export function rgbToHex(channels) {
  if (channels.length !== 3 || channels.some(channel => String(channel).trim() === "" || !Number.isFinite(Number(channel)))) return null;
  return "#" + channels.map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0")).join("");
}

export function customColorList(colors, palette = []) {
  const presets = new Set(palette.map(normalizeHex).filter(Boolean));
  return [...new Set(colors.map(normalizeHex).filter(color => color && !presets.has(color)))].slice(0, 5);
}