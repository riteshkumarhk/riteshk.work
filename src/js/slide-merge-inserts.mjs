export const SLIDE_LAYOUTS = [["blank", "Blank"], ["title", "Title"], ["columns", "Two columns"], ["flow", "Product flow"]];
export const CONTENT_BLOCKS = [["body", "Text block"], ["list", "Bulleted list"], ["metric", "Metric"], ["quote", "Quote"], ["section", "Section layout"], ["badge", "Badge"]];
export const BADGE_PRESETS = [
  ["proposed", "Proposed", "#e4e8ef"], ["in-progress", "In progress", "#d9eafa"],
  ["completed", "Completed", "#d8eee2"], ["shipped", "Shipped", "#c9e8df"],
  ["concept", "Concept", "#eee3f0"], ["under-review", "Under review", "#f5e7c7"],
  ["released", "Released", "#d3ebee"], ["work-in-progress", "Work in progress", "#f3dfcd"],
  ["planned", "Planned", "#e4e8ef"], ["on-hold", "On hold", "#ece6dc"],
  ["blocked", "Blocked", "#f3dbdc"], ["key-insight", "Key insight", "#e4eee9"]
];

export function contentSkeleton(kind, fontFamily, prefix, badge = {}) {
  const common = { roughness: 0, strokeColor: "#27343a", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, frameId: "lab-slide", groupIds: [prefix] };
  const text = (id, value, x, y, fontSize = 28) => ({ ...common, type: "text", id: `${prefix}-${id}`, text: value, x, y, fontSize, fontFamily });
  const card = (id, label, x, y, width, height) => ({ ...common, type: "rectangle", id: `${prefix}-${id}`, x, y, width, height, backgroundColor: "#e4eee9", roundness: { type: 3 }, label: { text: label, fontSize: 24, fontFamily } });
  switch (kind) {
    case "body": return [text("body", "A clear idea, grounded in evidence.", 240, 280)];
    case "list": return [text("list", "\u2022 First point\n\u2022 Second point\n\u2022 Third point", 240, 260)];
    case "metric": return [text("value", "42%", 240, 240, 72), text("label", "Outcome measured", 240, 335, 24)];
    case "quote": return [text("quote", '"A useful insight changes the next decision."', 160, 260, 32), text("source", "Source", 160, 325, 20)];
    case "badge": {
      const preset = BADGE_PRESETS.find(item => item[0] === badge.preset) || BADGE_PRESETS.at(-1);
      const label = String(badge.label || preset[1]).trim().slice(0, 40) || preset[1];
      const width = Math.max(180, Math.min(680, label.length * 17 + 48));
      return [{ ...card("badge", label, (1280 - width) / 2, 300, width, 68), backgroundColor: preset[2] }];
    }
    case "section": return [text("heading", "Section heading", 100, 150, 38), ...["Context", "Decision", "Outcome"].map((label, index) => card(`card-${index}`, label, 100 + index * 370, 280, 330, 200))];
    case "title": return [text("heading", "A clear point of view", 100, 240, 56), text("subheading", "Context and the next step", 100, 340, 28)];
    case "columns": return [text("heading", "Two perspectives", 100, 90, 44), text("left", "What we learned", 100, 240, 32), text("left-body", "Evidence and context", 100, 305, 24), text("right", "What we changed", 700, 240, 32), text("right-body", "Decision and outcome", 700, 305, 24)];
    default: throw new Error("Unknown content layout");
  }
}

export function rulerTicks(length, step = 100) {
  return Array.from({ length: Math.floor(length / step) + 1 }, (_, index) => index * step);
}