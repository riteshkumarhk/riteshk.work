const text = (x, y, width, label, size = 28, align = "left", height = 12) => ({ kind: "text", x, y, width, height, label, size, align });
const media = (x, y, width, height) => ({ kind: "media", x, y, width, height });
export const PROPERTY_LAYOUTS = [
  { id: "title", name: "Title Slide", slots: [text(15,33,70,"Kicker",24,"center",7),text(8,40,84,"Presentation title",56,"center",15),text(20,62,60,"Subtitle",24,"center",8)] },
  { id: "titlecontent", name: "Title and Content", slots: [text(7,9,86,"Title",40),text(7,27,86,"Add your content",28,"left",63)] },
  { id: "section", name: "Section Header", slots: [text(8,36,50,"01",24,"left",7),text(8,43,84,"Section title",56,"left",15)] },
  { id: "twocontent", name: "Two Content", slots: [text(7,8,86,"Title",40),text(7,27,42,"Content",28,"left",62),text(51,27,42,"Content",28,"left",62)] },
  { id: "comparison", name: "Comparison", slots: [text(7,6,86,"Title",40),text(7,23,42,"Heading"),text(7,31,42,"Content",28,"left",57),text(51,23,42,"Heading"),text(51,31,42,"Content",28,"left",57)] },
  { id: "titleonly", name: "Title Only", slots: [text(7,8,86,"Title",40)] },
  { id: "blank", name: "Blank", slots: [] },
  { id: "contentcaption", name: "Content with Caption", slots: [text(7,10,30,"Title",40),text(7,27,30,"Caption text",28,"left",61),media(41,10,52,78)] },
  { id: "picturecaption", name: "Picture with Caption", slots: [media(7,10,58,72),text(69,28,24,"Title",40),text(69,50,24,"Caption",24)] }
];
export const TRANSITIONS = [["none","None"],["fade","Fade"],["push","Push"],["magic","Magic Move"]];
export const BACKGROUNDS = [["transparent","No background"],["#d8a657","Gold"],["#ece7e1","Paper"],["#8b8882","Grey"],["#141417","Dark"],["#ffffff","White"]];
const DEFAULT_SETTINGS = { layout: null, background: null, transition: "fade" };
export function slideSettings(elements) {
  return elements.find(element => element.id === "lab-slide")?.customData?.slideSettings || DEFAULT_SETTINGS;
}
export function isEmptyPlaceholder(element) {
  const placeholder = element.customData?.slidePlaceholder;
  return !!placeholder && (placeholder.kind === "media" || (element.originalText ?? element.text) === placeholder.label);
}
export function layoutPlan(elements, layoutId, fontFamily, prefix) {
  const layout = PROPERTY_LAYOUTS.find(item => item.id === layoutId);
  if (!layout) throw new Error("Unknown slide layout");
  const eligible = elements.filter(element => !element.isDeleted && !element.locked && !element.containerId && !element.groupIds?.length && !element.customData?.slideBackground && !isEmptyPlaceholder(element));
  const texts = eligible.filter(element => element.type === "text");
  const images = eligible.filter(element => element.type === "image");
  const updates = [], additions = [];
  const removed = elements.filter(element => !element.isDeleted && !element.locked && isEmptyPlaceholder(element)).map(element => element.id);
  for (const [index, slot] of layout.slots.entries()) {
    const existing = (slot.kind === "text" ? texts : images).shift();
    let geometry = { x: slot.x * 12.8, y: slot.y * 7.2, width: slot.width * 12.8, height: slot.height * 7.2 };
    if (slot.kind === "text") geometry = { ...geometry, fontSize: slot.size, textAlign: slot.align, autoResize: false };
    if (existing) {
      if (slot.kind === "media") {
        const scale = Math.min(geometry.width / existing.width, geometry.height / existing.height);
        geometry = { x: geometry.x + (geometry.width - existing.width * scale) / 2, y: geometry.y + (geometry.height - existing.height * scale) / 2, width: existing.width * scale, height: existing.height * scale };
      }
      updates.push({ id: existing.id, ...geometry });
    } else additions.push({ ...geometry, id: `${prefix}-${index}`, type: slot.kind === "text" ? "text" : "rectangle", frameId: "lab-slide", fontFamily, text: slot.label, strokeColor: "#666673", strokeStyle: slot.kind === "media" ? "dashed" : "solid", backgroundColor: "transparent", roughness: 0, strokeWidth: 1, customData: { slidePlaceholder: slot } });
  }
  return { updates, additions, removed };
}
export function slideOwnsFocus(elements, state) {
  return ["selection", "hand"].includes(state.activeTool.type) && !state.editingTextElement && !elements.some(element => element.id !== "lab-slide" && !element.isDeleted && !element.customData?.slideBackground && state.selectedElementIds[element.id]);
}
export function transitionMatch(previous, next) {
  const available = previous.filter(element => !element.isDeleted && element.id !== "lab-slide");
  return next.filter(element => !element.isDeleted && element.id !== "lab-slide").map(element => {
    const index = available.findIndex(old => old.type === element.type && (old.id === element.id || (element.type === "text" && (old.originalText ?? old.text) === (element.originalText ?? element.text)) || (element.type === "image" && old.fileId === element.fileId)));
    return { next: element, previous: index >= 0 ? available.splice(index, 1)[0] : null };
  });
}