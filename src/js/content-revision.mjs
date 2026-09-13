export async function contentRevision(content) {
  const canonical = JSON.stringify(content, (key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]])) : value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function publicationConflict(message = "Published content changed since this draft was opened. Your draft is kept. Review the latest version before publishing.") {
  return Object.assign(new Error(message), { conflict: true, http: 412 });
}

export async function gitContentRevision(api, repository, treeSha) {
  const tree = await api(repository + "/git/trees/" + treeSha);
  const entry = tree?.tree?.find(item => item.path === "content.json" && item.type === "blob");
  if (!entry) return null;
  const blob = await api(repository + "/git/blobs/" + entry.sha);
  if (blob.encoding !== "base64" || typeof blob.content !== "string") throw publicationConflict("The published Git baseline could not be verified. Your draft is kept.");
  const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), character => character.charCodeAt(0));
  return contentRevision(JSON.parse(new TextDecoder().decode(bytes)));
}