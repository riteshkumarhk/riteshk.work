const DATABASE = "rk-prepare-resume-sources-v1";

function reference(value) {
  if (value?.version !== 1 || !/^[a-f0-9]{64}$/.test(value.sha256 || "") || !Number.isSafeInteger(value.size) || value.size < 1 || typeof value.name !== "string" || typeof value.type !== "string") throw new Error("The saved resume document reference is invalid.");
  return { version: 1, sha256: value.sha256, size: value.size, name: value.name, type: value.type, lastModified: Number(value.lastModified) || 0 };
}

async function digest(blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function store(mode, operation) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("documents", mode);
      const request = operation(transaction.objectStore("documents"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error("The original resume could not be saved."));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export async function retainResumeSource(file) {
  const saved = reference({ version: 1, sha256: await digest(file), size: file.size, name: file.name || "resume.pdf", type: file.type || "application/octet-stream", lastModified: file.lastModified });
  await store("readwrite", documents => documents.put(file, saved.sha256));
  return saved;
}

export async function readResumeSource(value) {
  const saved = reference(value);
  const file = await store("readonly", documents => documents.get(saved.sha256));
  if (!(file instanceof Blob)) throw new Error("The original resume is not available on this device. Restore it from private history or attach the original file.");
  if (file.size !== saved.size || await digest(file) !== saved.sha256) throw new Error("The saved resume failed its integrity check. Its reference has been kept.");
  return new File([file], saved.name, { type: saved.type, lastModified: saved.lastModified });
}

export async function resumeSourceForSync(value) {
  const saved = reference(value), file = await readResumeSource(saved);
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return { ...saved, data };
}

export async function restoreResumeSource(value) {
  const saved = reference(value);
  if (typeof value.data !== "string") { await readResumeSource(saved); return saved; }
  const bytes = Uint8Array.from(atob(value.data), character => character.charCodeAt(0));
  const file = new File([bytes], saved.name, { type: saved.type, lastModified: saved.lastModified });
  if (file.size !== saved.size || await digest(file) !== saved.sha256) throw new Error("The synced resume failed its integrity check. The existing document was not changed.");
  await store("readwrite", documents => documents.put(file, saved.sha256));
  return saved;
}