import { normalizeSectionReference, sectionComponentPlan } from "./slide-merge-section-component.mjs";

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

function storeSourceDraft(draft, source, window) {
  if (!window.localStorage.getItem("rk:content:draft")) {
    let hash = 5381; const text = JSON.stringify(source);
    for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
    window.localStorage.setItem("rk:content:draft:sig", hash.toString(36));
  }
  window.localStorage.setItem("rk:content:draft", JSON.stringify(draft));
  window.dispatchEvent(new Event("rk:studio-draft"));
}

export async function studioSectionSources(signal, caseStudyId, window = globalThis.window) {
  const source = await studioSourceData(signal, window);
  signal?.throwIfAborted();
  if (!caseStudyId) return source;
  if (window.__RKStudio?.sectionAccess?.(caseStudyId)?.active) return window.__RKStudio.prepareSectionReferences(caseStudyId);
  const work = source.work?.find(item => item.id === caseStudyId);
  if (!work?.study || work.encWork) return source;
  const missing = work.study.blocks.filter(block => block && (block.locked || block.encStub || block.vaultBlock) && !normalizeSectionReference({version:1,caseStudyId,sectionId:block.sectionId}));
  if (!missing.length) return source;
  const draft = structuredClone(source), target = draft.work.find(item => item.id === caseStudyId);
  for (const block of target.study.blocks) {
    if (block && (block.locked || block.encStub || block.vaultBlock) && !normalizeSectionReference({version:1,caseStudyId,sectionId:block.sectionId})) block.sectionId = crypto.randomUUID();
  }
  signal?.throwIfAborted();
  storeSourceDraft(draft, source, window);
  return draft;
}

export function sectionAccessState(caseStudyId, window = globalThis.window) {
  const owner = window.__RKStudio?.sectionAccess?.(caseStudyId);
  return owner?.active ? owner : window.RK?.sectionAccess?.(caseStudyId) || {available:false,unlocked:false,busy:false};
}

export function resolvedSectionSource(reference, window = globalThis.window) {
  const source = normalizeSectionReference(reference);
  if (!source) return null;
  if (window.__RKStudio?.sectionAccess?.(source.caseStudyId)?.active) return window.__RKStudio.resolveSection(source);
  return window.RK?.resolveSection?.(source) || null;
}

export async function sectionRuntimeData(source, signal, window = globalThis.window) {
  signal?.throwIfAborted();
  const block = structuredClone(source.block), replacements = new Map(), media = {};
  block.locked = false;
  const replace = value => {
    if (!/^(vault:|blob:)/i.test(value)) return value;
    if (!replacements.has(value)) replacements.set(value, 'https://slide-lab.invalid/session-media/' + replacements.size);
    return replacements.get(value);
  };
  function visit(value) {
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') visit(child);
      else if (typeof child === 'string') {
        if (/^(vault:|blob:)/i.test(child)) value[key] = replace(child);
        else if (/<[a-z][\s\S]*(?:vault:|blob:)/i.test(child)) {
          const parsed = new window.DOMParser().parseFromString(child, 'text/html');
          for (const element of parsed.body.querySelectorAll('[src],[href],[poster]')) {
            for (const attribute of ['src','href','poster']) if (element.hasAttribute(attribute)) element.setAttribute(attribute, replace(element.getAttribute(attribute)));
          }
          value[key] = parsed.body.innerHTML;
        }
      }
    }
  }
  visit(block);
  const component = sectionComponentPlan(block, String, 'runtime', {customIcons:source.icons}).elements[0].customData;
  const entries = [...replacements], pending = {index:0};
  async function resolveNext() {
    while (pending.index < entries.length) {
      signal?.throwIfAborted();
      const [reference, token] = entries[pending.index++];
      const url = /^vault:/i.test(reference) ? await source.sign?.(reference.slice(6), {signal,strict:true}) : reference;
      signal?.throwIfAborted();
      if (!url) throw new Error('Protected media is unavailable');
      const parsed = new URL(url);
      if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(parsed.protocol === 'blob:' && parsed.origin === window.location.origin))) throw new Error('Protected media URL is not valid');
      media[token] = url;
    }
  }
  await Promise.all(Array.from({length:Math.min(3,entries.length)},resolveNext));
  signal?.throwIfAborted();
  return {block:component.sectionComponent,icons:component.sectionIcons,media};
}

export function connectSectionAccess(target, caseStudyIds, source = globalThis.window) {
  const allowed = new Set(caseStudyIds), previous = {access:target.RK.sectionAccess,resolve:target.RK.resolveSection};
  const access = id => allowed.has(id) && !source.closed ? sectionAccessState(id,source) : {available:false,unlocked:false,busy:false};
  const resolve = reference => allowed.has(reference?.caseStudyId) && !source.closed ? resolvedSectionSource(reference,source) : null;
  target.RK.sectionAccess = access;
  target.RK.resolveSection = resolve;
  const update = () => { if (!target.closed) target.dispatchEvent(new target.Event('rk:section-access')); };
  source.addEventListener('rk:section-access',update);
  source.addEventListener('rk:studio-draft',update);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    source.removeEventListener('rk:section-access',update);
    source.removeEventListener('rk:studio-draft',update);
    if (!target.closed) {
      if (target.RK.sectionAccess === access) target.RK.sectionAccess = previous.access;
      if (target.RK.resolveSection === resolve) target.RK.resolveSection = previous.resolve;
      update();
    }
  };
}

let registryPromise;
export function studioIconRegistry() {
  if (window.RK?.iconNames && window.RK?.iconSvg) return Promise.resolve(window.RK);
  registryPromise ||= new Promise((resolve, reject) => {
    const frame = document.createElement("iframe"); frame.hidden = true; frame.title = "Studio resources";
    const timeout = setTimeout(() => { frame.remove(); registryPromise = null; reject(new Error("Studio resources could not be loaded")); }, 15000);
    frame.onload = () => { clearTimeout(timeout); const registry = frame.contentWindow.RK; if (registry?.iconSvg) resolve(registry); else { frame.remove(); registryPromise = null; reject(new Error("Studio icon renderer unavailable")); } };
    frame.src = "/studio/slide-runtime/component.html?v=1.1"; document.body.appendChild(frame);
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
  storeSourceDraft(draft, source, window);
  registry.registerIcons({ [name]: icon.svg });
  return name;
}