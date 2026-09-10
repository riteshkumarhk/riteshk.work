export function fitAuthoredText(element, measure, minimumSize = 18) {
  if (element.type !== "text") return element;
  for (let size = element.fontSize; size >= minimumSize; size--) {
    const lines = [];
    for (const paragraph of element.text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (measure(word, size) > element.width) {
          if (line) { lines.push(line); line = ""; }
          for (const character of word) {
            if (line && measure(line + character, size) > element.width) { lines.push(line); line = ""; }
            line += character;
          }
        } else if (line && measure(`${line} ${word}`, size) > element.width) { lines.push(line); line = word; }
        else line += (line ? " " : "") + word;
      }
      lines.push(line);
    }
    if (lines.length * size * element.lineHeight <= element.height && lines.every(line => measure(line, size) <= element.width)) return { ...element, text: lines.join("\n"), originalText: element.text, fontSize: size };
  }
  throw new Error("An authored text block is too dense for its layout. Retry with shorter copy.");
}