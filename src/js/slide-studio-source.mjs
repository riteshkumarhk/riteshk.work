export function studioDraft(window = globalThis.window) {
  const active = window.__RKStudio?.getDraft?.();
  if (active && typeof active === "object") return active;
  const raw = window.localStorage.getItem("rk:content:draft");
  if (!raw) return null;
  const draft = JSON.parse(raw);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("Studio draft is not valid content");
  return draft;
}

export async function studioSourceData(signal, window = globalThis.window) {
  signal?.throwIfAborted();
  const draft = studioDraft(window);
  if (draft) return draft;
  let failure;
  for (const url of ["https://media.riteshk.work/content.json", "/content.json"]) {
    try {
      const response = await window.fetch(url, { signal, credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error("Studio content is unavailable");
      return await response.json();
    } catch (error) { if (signal?.aborted) throw error; failure = error; }
  }
  throw failure;
}

let registryPromise;
export function studioIconRegistry() {
  if (window.RK?.iconNames && window.RK?.iconSvg) return Promise.resolve(window.RK);
  registryPromise ||= new Promise((resolve, reject) => {
    const frame = document.createElement("iframe"); frame.hidden = true; frame.title = "Studio resources";
    const timeout = setTimeout(() => { frame.remove(); registryPromise = null; reject(new Error("Studio resources could not be loaded")); }, 15000);
    frame.onload = () => { clearTimeout(timeout); const registry = frame.contentWindow.RK; if (registry?.iconSvg) resolve(registry); else { frame.remove(); registryPromise = null; reject(new Error("Studio icon renderer unavailable")); } };
    frame.src = "/studio/slide-runtime/component.html?v=1.0"; document.body.appendChild(frame);
  });
  return registryPromise;
}

export async function saveGeneratedStudioIcon(icon, signal) {
  signal?.throwIfAborted();
  if (window.__RKStudio?.getDraft?.()) return window.__RKStudio.addDraftIcon(icon);
  const source = await studioSourceData(signal);
  const registry = await studioIconRegistry();
  signal?.throwIfAborted();
  if (window.__RKStudio?.getDraft?.()) return window.__RKStudio.addDraftIcon(icon);
  const draft = structuredClone(studioDraft() || source);
  const names = new Set([...registry.iconNames(), ...Object.keys(draft.customIcons || {})]);
  let name = icon.name, suffix = 2;
  while (names.has(name)) name = `${icon.name}-${suffix++}`;
  draft.customIcons = { ...draft.customIcons, [name]: icon.svg };
  draft.iconKeywords = { ...draft.iconKeywords, [name]: icon.keywords || [] };
  if (!localStorage.getItem("rk:content:draft")) {
    let hash = 5381; const text = JSON.stringify(source);
    for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
    localStorage.setItem("rk:content:draft:sig", hash.toString(36));
  }
  localStorage.setItem("rk:content:draft", JSON.stringify(draft));
  registry.registerIcons({ [name]: icon.svg });
  window.dispatchEvent(new Event("rk:studio-draft"));
  return name;
}