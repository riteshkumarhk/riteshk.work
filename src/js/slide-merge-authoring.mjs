import { sectionComponentPlan } from "./slide-merge-section-component.mjs";

export const AUTHORING_LAYOUTS = Object.freeze(["opening", "statement", "split", "comparison", "evidence"]);

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label} fields`);
}
function text(value, limit, label, optional = false) {
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > limit || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}
export function validateAuthoredSlide(slide) {
  exact(slide, ["id", "kind", "layout", "sourceIds", "headline", "kicker", "body", "notes", "components"], "authored slide");
  if (slide.kind !== "authored" || !AUTHORING_LAYOUTS.includes(slide.layout)) throw new Error("Unsupported authored layout");
  if (!Array.isArray(slide.sourceIds) || !slide.sourceIds.length || slide.sourceIds.length > 8 || new Set(slide.sourceIds).size !== slide.sourceIds.length) throw new Error("An authored slide needs 1 to 8 distinct sources");
  const sourceIds = slide.sourceIds.map(source => text(source, 512, "source ID"));
  if (!Array.isArray(slide.components) || new Set(slide.components).size !== slide.components.length || slide.components.some(source => !sourceIds.includes(source))) throw new Error("Components must reference this slide's sources");
  const expected = { opening: 0, statement: 0, split: 1, comparison: 2, evidence: 1 }[slide.layout];
  if (slide.components.length !== expected) throw new Error(`${slide.layout} requires ${expected} intact components`);
  return { id: slide.id, kind: "authored", layout: slide.layout, sourceIds, headline: text(slide.headline, 110, "headline"), kicker: text(slide.kicker, 48, "kicker", true), body: text(slide.body, slide.layout === "comparison" || slide.layout === "evidence" ? 180 : 600, "body", true), notes: text(slide.notes, 3000, "notes", true), components: [...slide.components] };
}

export function authoringEvidence(block, plain) {
  const fields = new Set(["heading", "kicker", "title", "body", "desc", "text", "value", "label", "caption", "quote", "author", "role", "name"]);
  const pieces = [];
  function visit(value, key) {
    if (typeof value === "string" && fields.has(key)) {
      const content = plain(value).replace(/(?:https?:\/\/|data:|vault:|rkenc:)[^\s]+/gi, "").trim();
      if (content && !pieces.includes(content)) pieces.push(content);
    } else if (Array.isArray(value)) value.forEach(item => visit(item, key));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => visit(item, key));
  }
  visit(block);
  return pieces.join("\n").slice(0, 6000);
}

export function authoredPlan(slide, sources, resources, { plain, fontFamily }) {
  const sourceList = slide.sourceIds.map(id => {
    const source = sources.get(id);
    if (!source) throw new Error(`Slide ${slide.id} references an unavailable source`);
    return source;
  });
  const prefix = `composition-${slide.id}`, elements = [];
  function addText(name, value, x, y, width, height, fontSize, color = "#141417") {
    if (!value) return;
    elements.push({ id: `${prefix}-${name}`, type: "text", text: value, x, y, width, height, fontSize, fontFamily, lineHeight: 1.25, textAlign: "left", verticalAlign: "top", autoResize: false, strokeColor: color, frameId: "lab-slide" });
  }
  const split = slide.layout === "split";
  addText("kicker", slide.kicker, 64, 40, 1152, 30, 20, "#a36b20");
  addText("headline", slide.headline, 64, slide.layout === "opening" ? 168 : 86, split ? 440 : 1152, split ? 190 : 120, slide.layout === "opening" ? 58 : split ? 38 : 44);
  addText("body", slide.body, 64, slide.layout === "opening" ? 356 : split ? 302 : 228, split ? 440 : 1152, slide.layout === "opening" ? 248 : slide.layout === "statement" ? 380 : split ? 340 : 96, slide.layout === "statement" ? 32 : 25);
  const slots = slide.layout === "comparison" ? [{ x: 64, y: 326, width: 560, height: 330 }, { x: 656, y: 326, width: 560, height: 330 }] : slide.layout === "split" ? [{ x: 548, y: 96, width: 668, height: 560 }] : [{ x: 64, y: 326, width: 1152, height: 330 }];
  slide.components.forEach((id, index) => {
    const source = sources.get(id);
    const element = sectionComponentPlan(source.block, plain, `${prefix}-${index}`, resources).elements[0];
    elements.push({ ...element, ...slots[index] });
  });
  return { id: slide.id, title: slide.headline, notes: slide.notes, elements, provenance: { sources: slide.sourceIds.map((id, index) => ({ sourceId: id, workId: sourceList[index].workId, blockIndex: sourceList[index].blockIndex })) } };
}