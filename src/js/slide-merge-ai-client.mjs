export async function loadCompositionData(signal) {
  signal?.throwIfAborted();
  const draft = localStorage.getItem("rk:content:draft");
  if (draft) return JSON.parse(draft);
  const response = await fetch("https://media.riteshk.work/content.json", { credentials: "omit", cache: "no-store", signal });
  if (!response.ok) throw new Error("Could not load case studies. Try again.");
  return response.json();
}

let service;
export async function requestComposition(catalog, brief, signal) {
  if (!window.__RKStudio?.draftSlides) {
    const url = "/js/admin-studio.js?v=" + Date.now();
    service ||= import(url).catch(error => { service = null; throw error; });
    await service;
  }
  signal?.throwIfAborted();
  if (!window.__RKStudio?.draftSlides) throw new Error("Studio AI service is unavailable. Reload and try again.");
  return window.__RKStudio.draftSlides(catalog, brief, { signal });
}