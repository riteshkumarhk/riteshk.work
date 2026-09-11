import { studioSourceData } from "./slide-studio-source.mjs";

export async function loadCompositionData(signal) {
  return studioSourceData(signal);
}

let service;
async function studioService() {
  if (!window.__RKStudio?.draftSlides) {
    const url = "/js/admin-studio.js?v=" + Date.now();
    service ||= import(url).catch(error => { service = null; throw error; });
    await service;
  }
  return window.__RKStudio;
}
export async function improveSlideText(text, { signal, rich = false } = {}) {
  const studio = await studioService(); signal?.throwIfAborted();
  if (!studio?.improveText) throw new Error("Studio text improvement is unavailable. Reload and try again.");
  return studio.improveText(text, { signal, rich });
}
export async function generateSlideIcon(description, references, signal) {
  const studio = await studioService(); signal?.throwIfAborted();
  if (!studio?.generateIcon) throw new Error("Studio icon generation is unavailable. Reload and try again.");
  return studio.generateIcon(description, references, { signal });
}
export async function requestComposition(catalog, brief, signal, { onRoute, onActivity } = {}) {
  await studioService();
  signal?.throwIfAborted();
  if (!window.__RKStudio?.draftSlides) throw new Error("Studio AI service is unavailable. Reload and try again.");
  return window.__RKStudio.draftSlides(catalog, brief, { signal, onRoute, onActivity });
}
export async function recordCompositionFeedback(decisionId, feedback) {
  const studio = await studioService();
  if (!studio?.aiRouting?.feedback) throw new Error("AI routing feedback is unavailable. Reload and try again.");
  return studio.aiRouting.feedback(decisionId, feedback);
}