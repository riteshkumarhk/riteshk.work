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

export function textListLine(line) {
  const match = /^([ \t]*)(?:(\u2022|-|\d+\.|[a-z]{1,3}\.)[ \t]+)?(.*)$/i.exec(line);
  const marker = match?.[2];
  return { indent: match?.[1] || "", content: match?.[3] ?? line, style: !marker ? null : marker === "\u2022" ? "dot" : marker === "-" ? "dash" : /^\d/.test(marker) ? "number" : "alphabet" };
}

function alphabetMarker(index) {
  let result = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(97 + (value - 1) % 26) + result;
  return `${result}.`;
}

export function formatTextLines(text, action, enabled) {
  const lines = String(text).split("\n");
  const content = lines.filter(line => line.trim());
  const removeBullets = enabled === undefined ? content.length > 0 && content.every(line => textListLine(line).style) : !enabled;
  let item = 0;
  return lines.map(line => {
    if (!line.trim()) return line;
    const parsed = textListLine(line);
    if (action === "bullet-style" && ["dot", "number", "alphabet", "dash"].includes(enabled)) {
      item++;
      const marker = { dot: "\u2022", number: `${item}.`, alphabet: alphabetMarker(item), dash: "-" }[enabled];
      return `${parsed.indent}${marker} ${parsed.content}`;
    }
    if (action === "bullets") {
      if (removeBullets) return `${parsed.indent}${parsed.content}`;
      return parsed.style ? line : `${parsed.indent}\u2022 ${parsed.content}`;
    }
    if (action === "indent") return `  ${line}`;
    if (action === "outdent") return line.replace(/^(?:\t| {1,2})/, "");
    return line;
  }).join("\n");
}