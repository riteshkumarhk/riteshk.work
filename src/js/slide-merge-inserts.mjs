export const SLIDE_LAYOUTS = [["blank", "Blank"], ["title", "Title"], ["columns", "Two columns"], ["flow", "Product flow"]];
export const CONTENT_BLOCKS = [["body", "Text block"], ["list", "Bulleted list"], ["metric", "Metric"], ["quote", "Quote"], ["section", "Section layout"], ["badge", "Badge"]];
export const DIAGRAM_SHAPES = [["terminator", "Start / End"], ["rounded", "Rounded process"], ["inputoutput", "Input / Output"], ["subprocess", "Predefined process"], ["database", "Database"], ["connector", "Connector"], ["triangle", "Triangle"], ["hexagon", "Hexagon"]];
export function diagramSkeleton(kind, prefix) {
  const common = { x:520, y:300, width:240, height:120, roughness:0, strokeColor:"#27343a", backgroundColor:"transparent", fillStyle:"solid", strokeWidth:2, frameId:"lab-slide", groupIds:[prefix] };
  const shape = (suffix, type, extra = {}) => ({ ...common, id:`${prefix}-${suffix}`, type, ...extra });
  const polygon = points => [shape("outline", "line", { points })];
  switch (kind) {
    case "terminator": return [shape("outline", "ellipse")];
    case "rounded": return [shape("outline", "rectangle", { roundness:{type:3} })];
    case "connector": return [shape("outline", "ellipse", {x:600,y:320,width:80,height:80})];
    case "inputoutput": return polygon([[30,0],[240,0],[210,120],[0,120],[30,0]]);
    case "triangle": return polygon([[120,0],[240,120],[0,120],[120,0]]);
    case "hexagon": return polygon([[40,0],[200,0],[240,60],[200,120],[40,120],[0,60],[40,0]]);
    case "subprocess": return [shape("outline", "rectangle"), shape("left", "line", {x:540,width:0,points:[[0,0],[0,120]]}), shape("right", "line", {x:740,width:0,points:[[0,0],[0,120]]})];
    case "database": return [shape("body", "line", {points:[[0,20],...Array.from({length:17},(_,index)=>{const angle=Math.PI-index*Math.PI/16;return [120+120*Math.cos(angle),100+20*Math.sin(angle)];}),[240,20]]}), shape("top", "ellipse", {height:40})];
    default: throw new Error("Unknown diagram shape");
  }
}
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