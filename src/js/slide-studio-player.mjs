import { nativePublicDeck } from "./slide-studio-publication.mjs";
import { loadStudioDeck } from "./slide-studio-deck.mjs";

export function hasNativeDeck(work) {
  const study = work?.study;
  return !!(study?.nativeDeck || study?.nativeDeckEnc || study?.nativeDeckPublic || study?.nativeDeckDocument);
}

let opening = null;

export function presentStudioDeck(work, options = {}) {
  if (!options.document && options.draft && window.__RKStudio?.getDraft?.() && window.__RKStudio.presentNativeDeck) return window.__RKStudio.presentNativeDeck(work.id, options);
  if (opening) return opening;
  opening = openStudioDeck(work, options).finally(() => { opening = null; });
  return opening;
}

async function openStudioDeck(work, options) {
  let document = options.document || work.study?.nativeDeckDocument;
  if (!document && options.draft && work.study?.nativeDeck) document = (await loadStudioDeck(work.study.nativeDeck, { latest: true })).document;
  document ||= nativePublicDeck(work);
  if (!document && work.study?.nativeDeckEnc && window.RK?.requestOwnerPresentation) {
    if (!await window.RK.requestOwnerPresentation()) return null;
    work = window.RK.data.work.find(item => item.id === work.id) || work;
    document = work.study?.nativeDeckDocument;
  }
  if (!document) throw new Error("This slideshow is owner-only. Open it in Studio or owner Present mode.");
  window.EXCALIDRAW_ASSET_PATH ||= new URL("/studio/slide-lab/assets/", location.href).href;
  const stylesheet = window.document.createElement("link");
  stylesheet.rel = "stylesheet"; stylesheet.href = "/studio/slide-lab/assets/audience.css?v=1.1";
  stylesheet.dataset.nativeAudience = "true";
  const loaded = new Promise((resolve, reject) => { stylesheet.onload = resolve; stylesheet.onerror = () => reject(new Error("Presentation styles could not be loaded")); });
  window.document.head.append(stylesheet);
  try {
    const entry = "/studio/slide-lab/assets/audience.js?v=1.6";
    const [renderer] = await Promise.all([import(entry), loaded]);
    return await renderer.presentNativeDocument(work, document, { ...options, onClose: () => { stylesheet.remove(); options.onClose?.(); } });
  } catch (error) { stylesheet.remove(); throw error; }
}

export function presentationFailure(error) {
  const modal = document.createElement("div"), trigger = document.activeElement;
  modal.className = "pass"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "Presentation unavailable");
  modal.innerHTML = '<div class="pass__box"><div class="pass__title">Presentation unavailable</div><div class="pass__sub" role="alert"></div><div class="pass__actions"><button class="btn btn--ghost" type="button">Close</button></div></div>';
  modal.querySelector(".pass__sub").textContent = error.message;
  const close = () => { modal.remove(); document.removeEventListener("keydown", onKey); if (trigger?.isConnected) trigger.focus(); };
  const onKey = event => { if (event.key === "Escape") { event.preventDefault(); close(); } };
  modal.querySelector("button").onclick = close;
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  document.body.append(modal); document.addEventListener("keydown", onKey); modal.querySelector("button").focus();
}