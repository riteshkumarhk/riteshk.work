import { deckDocumentKey } from "./slide-merge-history.mjs";

export const STUDIO_DECK_SCHEMA = "rk-studio-native-deck";
export const STUDIO_DECK_DB = "rk-studio-slide-decks-v1";

export function studioDeckReference(caseStudyId, id = crypto.randomUUID()) {
  if (typeof caseStudyId !== "string" || !caseStudyId || typeof id !== "string" || !id) throw new Error("A case study and deck identity are required");
  return { schema: STUDIO_DECK_SCHEMA, version: 1, caseStudyId, id, revision: 0 };
}

function validateReference(reference) {
  if (reference?.schema !== STUDIO_DECK_SCHEMA || reference.version !== 1 || typeof reference.id !== "string" || !reference.id || typeof reference.caseStudyId !== "string" || !reference.caseStudyId || !Number.isSafeInteger(reference.revision) || reference.revision < 0) throw new Error("Unsupported native deck reference");
}

function validateDocument(document) {
  if (document?.version !== 1 || typeof document.title !== "string" || !Array.isArray(document.slides)) throw new Error("Unsupported native deck document");
  const ids = new Set();
  for (const slide of document.slides) {
    if (typeof slide.id !== "string" || !slide.id || ids.has(slide.id)) throw new Error("Slide identities must be unique");
    ids.add(slide.id);
    if (!slide.scene || !Array.isArray(slide.scene.elements) || !slide.scene.files || Array.isArray(slide.scene.files)) throw new Error("Slides must contain complete native scenes");
  }
  if (document.selected !== null && !ids.has(document.selected)) throw new Error("Selected slide does not exist");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open(STUDIO_DECK_DB, 1);
    request.onupgradeneeded = () => {
      for (const name of ["heads", "documents", "assets"]) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { failed = true; reject(new Error("Close other Studio tabs to finish opening slide storage")); };
  });
}

function requested(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function packedDocument(document) {
  validateDocument(document);
  const snapshot = structuredClone(document), assets = new Map();
  for (const slide of snapshot.slides) {
    for (const [id, file] of Object.entries(slide.scene.files)) {
      if (!file || typeof file !== "object" || typeof file.dataURL !== "string") throw new Error("Original slide media is missing");
      const bytes = new TextEncoder().encode(JSON.stringify(file));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const key = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
      assets.set(key, file); slide.scene.files[id] = key;
    }
  }
  return { document: snapshot, assets };
}

export async function saveStudioDeck(reference, document, { isCurrent = () => true } = {}) {
  validateReference(reference);
  const packed = await packedDocument(document);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deckDocumentKey(packed.document)));
  const documentHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (!isCurrent()) throw new Error("The case-study editor session has changed");
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction;
    try { transaction = database.transaction(["heads", "documents", "assets"], "readwrite"); }
    catch (error) { database.close(); reject(error); return; }
    const next = { ...reference, revision: reference.revision + 1, documentHash };
    let failure;
    transaction.oncomplete = () => { database.close(); resolve(next); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(failure || transaction.error || new Error("Slide save was not committed")); };
    const heads = transaction.objectStore("heads");
    const request = heads.get(reference.id);
    request.onsuccess = () => {
      const head = request.result;
      if (!isCurrent()) failure = new Error("The case-study editor session has changed");
      else if (head && head.caseStudyId !== reference.caseStudyId) failure = new Error("This deck belongs to another case study");
      else if ((head?.revision || 0) !== reference.revision) {
        failure = new Error("A newer slide revision was saved in another session. Reopen this case study before editing again.");
        failure.name = "StudioDeckConflictError";
      }
      if (failure) { transaction.abort(); return; }
      transaction.objectStore("documents").put({ reference: next, document: packed.document }, [next.id, next.revision]);
      for (const [key, file] of packed.assets) transaction.objectStore("assets").put(file, key);
      heads.put(next, next.id);
    };
  });
}

export async function loadStudioDeck(reference, { latest = false } = {}) {
  validateReference(reference);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["heads", "documents", "assets"], "readonly");
    const head = await requested(transaction.objectStore("heads").get(reference.id));
    if (head && head.caseStudyId !== reference.caseStudyId) throw new Error("This deck belongs to another case study");
    const target = latest && head ? head : reference;
    if (!target.revision) return { reference: target, document: null };
    const record = await requested(transaction.objectStore("documents").get([target.id, target.revision]));
    if (!record || record.reference.caseStudyId !== reference.caseStudyId) throw new Error("This deck revision is not available on this device");
    const jobs = [];
    for (const slide of record.document.slides) for (const [id, key] of Object.entries(slide.scene.files)) {
      jobs.push(requested(transaction.objectStore("assets").get(key)).then(file => {
        if (!file) throw new Error("A saved deck asset is missing. The original document has not been changed.");
        slide.scene.files[id] = file;
      }));
    }
    await Promise.all(jobs);
    validateDocument(record.document);
    return record;
  } finally { database.close(); }
}

export async function studioDeckBackup(data) {
  const backup = structuredClone(data), documents = [];
  for (const work of backup.work || []) {
    if (!work.study?.nativeDeck && !work.study?.nativeDeckDocument) continue;
    const reference = work.study.nativeDeck || studioDeckReference(work.id);
    if (reference.caseStudyId !== work.id) throw new Error("A native deck reference belongs to another case study");
    const saved = work.study.nativeDeckDocument ? { reference, document: work.study.nativeDeckDocument } : await loadStudioDeck(reference, { latest: true });
    const document = saved.document || createStudioDeck(work.title || "Untitled deck");
    documents.push({ reference: saved.reference, document });
    work.study.nativeDeck = { ...saved.reference, slideCount: document.slides.length };
    delete work.study.nativeDeckDocument;
  }
  if (documents.length) backup.nativeDecksBackup = { version: 1, documents };
  return backup;
}

export async function restoreStudioDeckBackup(backup, selectedCaseIds, { isCurrent = () => true } = {}) {
  const restored = structuredClone(backup), pending = [];
  for (const work of restored.work || []) {
    if (!selectedCaseIds.includes(String(work.id)) || !work.study?.nativeDeck) continue;
    const reference = work.study.nativeDeck;
    validateReference(reference);
    const records = restored.nativeDecksBackup?.documents?.filter(record => record.reference?.id === reference.id) || [];
    if (reference.caseStudyId !== work.id || restored.nativeDecksBackup?.version !== 1 || records.length !== 1 || records[0].reference.caseStudyId !== work.id || records[0].reference.revision !== reference.revision) throw new Error("This backup is missing the native deck document or original assets");
    validateDocument(records[0].document);
    pending.push({ work, document: records[0].document });
  }
  for (const { work, document } of pending) {
    const reference = await saveStudioDeck(studioDeckReference(work.id), document, { isCurrent });
    work.study.nativeDeck = { ...reference, slideCount: document.slides.length };
  }
  delete restored.nativeDecksBackup;
  return restored;
}

export function createStudioDeck(title = "Untitled deck") {
  return { version: 1, title, selected: null, slides: [] };
}

export function assertStudioDeckPublishable(data, { activeEditor = false, supportedNative = false } = {}) {
  const reject = () => {
    const error = new Error("This draft contains a native slide-editor preview. Publishing is paused until native deck publishing is supported. The published site has not changed.");
    error.name = "StudioDeckPublishError";
    throw error;
  };
  if (activeEditor && !supportedNative || Object.hasOwn(data || {}, "nativeDecksBackup")) reject();
  for (const work of data?.work || []) {
    const study = work?.study;
    if (!study) continue;
    if (study.nativeDeckDocument) reject();
    const nativeSlides = Array.isArray(study.slides) && study.slides.some(slide => slide?.scene?.elements);
    if (nativeSlides && !study.nativeDeck) reject();
    if (Object.hasOwn(study, "nativeDeck")) {
      if (!supportedNative) reject();
      try { validateReference(study.nativeDeck); } catch { reject(); }
      if (study.nativeDeck.caseStudyId !== work.id) reject();
    }
  }
}