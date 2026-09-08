export const SLIDE_LAYOUTS = [["blank", "Blank"], ["title", "Title"], ["columns", "Two columns"], ["flow", "Product flow"]];
export const CONTENT_BLOCKS = [["body", "Text block"], ["list", "Bulleted list"], ["metric", "Metric"], ["quote", "Quote"], ["section", "Section layout"], ["badge", "Badge"]];

export function contentSkeleton(kind, fontFamily, prefix) {
  const common = { roughness: 0, strokeColor: "#27343a", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, frameId: "lab-slide", groupIds: [prefix] };
  const text = (id, value, x, y, fontSize = 28) => ({ ...common, type: "text", id: `${prefix}-${id}`, text: value, x, y, fontSize, fontFamily });
  const card = (id, label, x, y, width, height) => ({ ...common, type: "rectangle", id: `${prefix}-${id}`, x, y, width, height, backgroundColor: "#e4eee9", roundness: { type: 3 }, label: { text: label, fontSize: 24, fontFamily } });
  switch (kind) {
    case "body": return [text("body", "A clear idea, grounded in evidence.", 240, 280)];
    case "list": return [text("list", "\u2022 First point\n\u2022 Second point\n\u2022 Third point", 240, 260)];
    case "metric": return [text("value", "42%", 240, 240, 72), text("label", "Outcome measured", 240, 335, 24)];
    case "quote": return [text("quote", '"A useful insight changes the next decision."', 160, 260, 32), text("source", "Source", 160, 325, 20)];
    case "badge": return [card("badge", "Key insight", 480, 300, 260, 68)];
    case "section": return [text("heading", "Section heading", 100, 150, 38), ...["Context", "Decision", "Outcome"].map((label, index) => card(`card-${index}`, label, 100 + index * 370, 280, 330, 200))];
    case "title": return [text("heading", "A clear point of view", 100, 240, 56), text("subheading", "Context and the next step", 100, 340, 28)];
    case "columns": return [text("heading", "Two perspectives", 100, 90, 44), text("left", "What we learned", 100, 240, 32), text("left-body", "Evidence and context", 100, 305, 24), text("right", "What we changed", 700, 240, 32), text("right-body", "Decision and outcome", 700, 305, 24)];
    default: throw new Error("Unknown content layout");
  }
}

export function rulerTicks(length, step = 100) {
  return Array.from({ length: Math.floor(length / step) + 1 }, (_, index) => index * step);
}