import { availableStudies, caseStudyMedia } from "./slide-merge-sections.mjs";
import { sectionComponentPlan } from "./slide-merge-section-component.mjs";
import { authoringEvidence, authoredPlan, validateAuthoredSlide } from "./slide-merge-authoring.mjs";

export const COMPOSITION_CAPABILITIES = Object.freeze({
  version: 2,
  maxSlides: 24,
  canvas: Object.freeze({ width: 1280, height: 720 }),
  kinds: Object.freeze(["section", "authored"]),
  sourceTypes: "case-study-renderer",
  output: Object.freeze(["editable-native-text", "interactive-section-component"]),
  excluded: Object.freeze(["protected-content", "arbitrary-html", "model-media-urls", "model-canvas-code"])
});

const protectedKeys = ["off", "locked", "encStub", "vaultBlock", "protected", "confidential", "private", "requiresReview"];

function containsProtected(value, seen = new WeakSet()) {
  if (typeof value === "string") return /(?:vault:|rkenc:|assets\/protected\/|\/vault\/|\.enc(?:$|[?#]))/i.test(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) throw new Error("Cyclic composition source");
  seen.add(value);
  const blocked = protectedKeys.some(key => !!value[key]) || Object.values(value).some(child => containsProtected(child, seen));
  seen.delete(value);
  return blocked;
}

function record(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${label} has unsupported or missing fields`);
}

function shortText(value, limit, label) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Invalid ${label}`);
  return value.trim();
}

async function eligibleSources(data, plain, fontFamily) {
  if (typeof plain !== "function") throw new Error("A plain-text converter is required");
  if (!Number.isInteger(fontFamily) || fontFamily < 1) throw new Error("A valid native font family is required");
  const sources = new Map();
  for (const work of availableStudies(data)) {
    const original = data.work.find(candidate => candidate?.id === work.id);
    if (!original || protectedKeys.some(key => !!original[key]) || protectedKeys.some(key => !!original.study?.[key])) continue;
    if (typeof work.id !== "string" || !work.id.trim()) continue;
    if (data.work.filter(candidate => candidate?.id === work.id).length !== 1) throw new Error("Duplicate case-study source ID");
    for (const block of work.blocks) {
      if (typeof block.type !== "string" || containsProtected(block)) continue;
      const index = original.study.blocks.indexOf(block);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(block)));
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const sourceId = JSON.stringify([work.id, index, fingerprint]);
      try {
        const plan = sectionComponentPlan(block, plain, "preview");
        sources.set(sourceId, { block, workId: work.id, blockIndex: index, plan });
      } catch (error) {
        if (!/no supported text or media/.test(error.message)) throw error;
      }
    }
  }
  return sources;
}

export async function compositionCatalog(data, { plain, fontFamily } = {}) {
  const snapshot = structuredClone(data);
  return [...await eligibleSources(snapshot, plain, fontFamily)].map(([sourceId, source]) => ({
    sourceId,
    type: source.block.type,
    title: plain(source.plan.title),
    excerpt: source.plan.notes.slice(0, 600),
    evidence: authoringEvidence(source.block, plain),
    hasMedia: caseStudyMedia({ study: { blocks: [source.block] } }).length > 0
  }));
}

export function validateComposition(value) {
  record(value, ["version", "title", "slides"], "Composition");
  if (![1, 2].includes(value.version)) throw new Error("Unsupported composition version");
  const title = shortText(value.title, 160, "composition title");
  if (!Array.isArray(value.slides) || !value.slides.length || value.slides.length > COMPOSITION_CAPABILITIES.maxSlides) throw new Error("Composition must contain 1 to 24 slides");
  const ids = new Set();
  const slides = value.slides.map(slide => {
    if (value.version === 1) record(slide, ["id", "kind", "sourceId"], "Slide");
    const id = shortText(slide.id, 64, "slide ID");
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) || ids.has(id)) throw new Error("Slide IDs must be unique safe identifiers");
    ids.add(id);
    if (value.version === 2) return { ...validateAuthoredSlide(slide), id };
      if (slide.kind !== "section") throw new Error("Unsupported composition kind");
    return { id, kind: slide.kind, sourceId: shortText(slide.sourceId, 512, "source ID") };
  });
  return { version: value.version, title, slides };
}

function planWarnings(plan, slideId) {
  const { width, height } = COMPOSITION_CAPABILITIES.canvas;
  for (const element of plan.elements) {
    if (element.type !== "rectangle" || element.link != null || !element.customData?.sectionComponent || ![element.x, element.y, element.width, element.height].every(Number.isFinite)) throw new Error("Invalid section composition element");
    if (element.x < 0 || element.y < 0 || element.x + element.width > width || element.y + element.height > height) throw new Error("Composition element is outside the slide");
  }
  return [{ slideId, code: "component-review", message: "Review the complete component and its interactions at presentation size." }];
}

export async function compileComposition(value, data, { plain, fontFamily } = {}) {
  const spec = validateComposition(value);
  const snapshot = structuredClone(data);
  const sources = await eligibleSources(snapshot, plain, fontFamily);
  const warnings = [], used = new Set();
  const slides = spec.slides.map(slide => {
    if (spec.version === 2) {
      const plan = authoredPlan(slide, sources, snapshot, { plain, fontFamily });
      warnings.push({ slideId: slide.id, code: "factual-review", message: "AI-written copy: verify every claim against the cited case-study sources." });
      return plan;
    }
    const source = sources.get(slide.sourceId);
    if (!source) throw new Error(`Slide ${slide.id} references an unavailable source`);
    const plan = sectionComponentPlan(source.block, plain, `composition-${slide.id}`, snapshot);
    plan.title = plain(plan.title);
    warnings.push(...planWarnings(plan, slide.id));
    if (used.has(slide.sourceId)) warnings.push({ slideId: slide.id, code: "repeated-source", message: "This source appears more than once." });
    used.add(slide.sourceId);
    return { id: slide.id, ...plan, provenance: { workId: source.workId, blockIndex: source.blockIndex, sourceId: slide.sourceId } };
  });
  return { version: spec.version, title: spec.title, slides, warnings };
}