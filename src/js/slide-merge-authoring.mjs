import { sectionComponentPlan } from "./slide-merge-section-component.mjs";

export const AUTHORING_CONTRACT = Object.freeze({
  version: 2, maxSlides: 24, maxSourcesPerSlide: 8, maxTitleLength: 160, maxIdLength: 64, maxSourceIdLength: 512,
  idPattern: "^[a-zA-Z][a-zA-Z0-9_-]*$",
  slideFields: Object.freeze(["id", "kind", "layout", "sourceIds", "headline", "kicker", "body", "notes", "components"]),
  text: Object.freeze({
    headline: Object.freeze({ maxLength: 110, required: true }),
    kicker: Object.freeze({ maxLength: 48, required: false }),
    notes: Object.freeze({ maxLength: 3000, required: false })
  }),
  layouts: Object.freeze({
    opening: Object.freeze({ components: 0, bodyMaxLength: 600 }),
    statement: Object.freeze({ components: 0, bodyMaxLength: 600 }),
    split: Object.freeze({ components: 1, bodyMaxLength: 600 }),
    comparison: Object.freeze({ components: 2, bodyMaxLength: 180 }),
    evidence: Object.freeze({ components: 1, bodyMaxLength: 180 })
  })
});
export const AUTHORING_LAYOUTS = Object.freeze(Object.keys(AUTHORING_CONTRACT.layouts));

export function authoredTextRules(layout) {
  return { headline: AUTHORING_CONTRACT.text.headline, kicker: AUTHORING_CONTRACT.text.kicker,
    body: { maxLength: AUTHORING_CONTRACT.layouts[layout]?.bodyMaxLength, required: false }, notes: AUTHORING_CONTRACT.text.notes };
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label} fields`);
}
function text(value, limit, label, optional = false) {
  if (typeof value === "string" && value.length > limit) throw new Error(`Invalid ${label}: ${value.length} characters exceeds the ${limit}-character limit`);
  if (typeof value !== "string" || (!optional && !value.trim()) || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}
export function authoredTextIssues(slide) {
  return Object.entries(authoredTextRules(slide.layout)).flatMap(([field, rule]) => {
    try { text(slide[field], rule.maxLength, field, !rule.required); return []; }
    catch (error) {
      const actual = typeof slide[field] === "string" ? slide[field].length : null;
      return [{ path: [field], code: actual != null && actual > rule.maxLength ? "text-length" : "text-value", message: error.message, limit: rule.maxLength, actual }];
    }
  });
}
export function validateAuthoredSlide(slide) {
  exact(slide, AUTHORING_CONTRACT.slideFields, "authored slide");
  if (slide.kind !== "authored" || !AUTHORING_LAYOUTS.includes(slide.layout)) throw new Error("Unsupported authored layout");
  if (!Array.isArray(slide.sourceIds) || !slide.sourceIds.length || slide.sourceIds.length > AUTHORING_CONTRACT.maxSourcesPerSlide || new Set(slide.sourceIds).size !== slide.sourceIds.length) throw new Error("An authored slide needs 1 to " + AUTHORING_CONTRACT.maxSourcesPerSlide + " distinct sources");
  const sourceIds = slide.sourceIds.map(source => text(source, AUTHORING_CONTRACT.maxSourceIdLength, "source ID"));
  if (!Array.isArray(slide.components) || new Set(slide.components).size !== slide.components.length || slide.components.some(source => !sourceIds.includes(source))) throw new Error("Components must reference this slide's sources");
  const expected = AUTHORING_CONTRACT.layouts[slide.layout].components;
  if (slide.components.length !== expected) throw new Error(`${slide.layout} requires ${expected} intact components`);
  const validationIssues = authoredTextIssues(slide);
  if (validationIssues.length) throw Object.assign(new Error(validationIssues[0].message), { validationIssues });
  const copy = Object.fromEntries(Object.keys(authoredTextRules(slide.layout)).map(field => [field, slide[field].trim()]));
  return { id: slide.id, kind: "authored", layout: slide.layout, sourceIds, ...copy, components: [...slide.components] };
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