const RECOVERY_DB = "rk-studio-draft-recovery-v1";

export function studioDraftContent(draft) {
  const content = structuredClone(draft);
  for (const work of content?.work || []) if (work.study?.nativeDeck?.documentHash) delete work.study.nativeDeck.revision;
  return content;
}

export function selectStudioDraft(published, draft, publishedSignature, draftSignature) {
  const matching = !!draft && !!publishedSignature && publishedSignature === draftSignature;
  return { data: structuredClone(matching ? draft : published), recovery: draft && !matching ? structuredClone(draft) : null };
}

function openRecoveryStore() {
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open(RECOVERY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onblocked = () => { failed = true; reject(new Error("Close other Studio tabs to open draft recovery")); };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function recoveryTransaction(mode, operation) {
  const database = await openRecoveryStore();
  return new Promise((resolve, reject) => {
    let transaction, result;
    try { transaction = database.transaction("drafts", mode); }
    catch (error) { database.close(); reject(error); return; }
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Draft recovery was not saved")); };
    try {
      const request = operation(transaction.objectStore("drafts"));
      request.onsuccess = () => { result = request.result; };
    } catch (error) { transaction.abort(); reject(error); }
  });
}

export async function archiveStudioDraft(backup, signature = "") {
  const snapshot = structuredClone(backup);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ signature, backup: snapshot })));
  const id = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  const record = { id, created: Date.now(), signature, backup: snapshot };
  await recoveryTransaction("readwrite", store => store.put(record));
  return record;
}

export async function studioDraftRecoveries(id) {
  if (id) {
    const record = await recoveryTransaction("readonly", store => store.get(id));
    if (!record) throw new Error("This recovery draft is not available on this device");
    return record;
  }
  const records = await recoveryTransaction("readonly", store => store.getAll());
  return records.filter(record => record.kind !== "published").sort((first, second) => second.created - first.created).map(({ id, created, backup }) => ({ id, created, cases: backup.work?.length || 0 }));
}

export async function saveStudioPublishedDraft(signature, draft) {
  if (!signature) throw new Error("The published revision is missing");
  await recoveryTransaction("readwrite", store => store.put({ id: `published:${signature}`, kind: "published", created: Date.now(), backup: structuredClone(draft) }));
}

export async function studioPublishedDraft(signature) {
  if (!signature) return null;
  const record = await recoveryTransaction("readonly", store => store.get(`published:${signature}`));
  return record?.backup || null;
}