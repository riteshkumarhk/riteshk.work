export function textFormat(element) {
  const saved = element?.customData?.textFormat;
  return Object.fromEntries(["bold", "italic", "underline", "strikethrough"].map(key => [key, saved?.[key] === true]));
}

export function textFontPrefix(element) {
  const format = textFormat(element);
  return `${format.italic ? "italic " : ""}${format.bold ? "bold " : ""}`;
}

export function textDecoration(element) {
  const format = textFormat(element);
  return [format.underline && "underline", format.strikethrough && "line-through"].filter(Boolean).join(" ") || "none";
}

export function drawTextDecorations(context, element, line, horizontalOffset, baseline) {
  const format = textFormat(element);
  if (!line || (!format.underline && !format.strikethrough)) return;
  const width = context.measureText(line).width;
  const left = horizontalOffset - (element.textAlign === "center" ? width / 2 : element.textAlign === "right" ? width : 0);
  context.save();
  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1, element.fontSize / 16);
  context.setLineDash([]);
  context.beginPath();
  for (const offset of [format.underline ? element.fontSize * .1 : null, format.strikethrough ? -element.fontSize * .3 : null]) {
    if (offset === null) continue;
    context.moveTo(left, baseline + offset);
    context.lineTo(left + width, baseline + offset);
  }
  context.stroke();
  context.restore();
}

export function formatTextLines(text, action, enabled) {
  const lines = String(text).split("\n");
  const content = lines.filter(line => line.trim());
  const removeBullets = enabled === undefined ? content.length > 0 && content.every(line => /^\s*\u2022 /.test(line)) : !enabled;
  return lines.map(line => {
    if (!line.trim()) return line;
    if (action === "bullets") {
      if (removeBullets) return line.replace(/^(\s*)\u2022 /, "$1");
      return /^\s*\u2022 /.test(line) ? line : line.replace(/^(\s*)/, "$1\u2022 ");
    }
    if (action === "indent") return `  ${line}`;
    if (action === "outdent") return line.replace(/^(?:\t| {1,2})/, "");
    return line;
  }).join("\n");
}