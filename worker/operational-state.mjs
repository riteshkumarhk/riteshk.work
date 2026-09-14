const records = { analytics: { path: "system/analytics.json", legacy: "ev:agg" }, usage: { path: "system/ai-usage.json", legacy: "ai:usage" } };

async function snapshot(env, name, initial) {
  if (!Object.hasOwn(records, name)) throw new Error("Unsupported operational record");
  const record = records[name], object = await env.VAULT?.get(record.path);
  const value = object ? await object.json() : await env.VAULT_GRANTS?.get(record.legacy, "json") ?? structuredClone(initial);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid operational record");
  return { value, etag: object?.etag, path: record.path };
}

export async function readOperationalState(env, name, initial) {
  return (await snapshot(env, name, initial)).value;
}

export async function updateOperationalState(env, name, initial, change) {
  if (!env.VAULT) throw new Error("Private operational storage is unavailable");
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await snapshot(env, name, initial);
    if (change(current.value) === false) return current.value;
    const saved = await env.VAULT.put(current.path, JSON.stringify(current.value), {
      onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-store" }
    });
    if (saved) return current.value;
  }
  throw new Error("Operational storage is busy; retry the update");
}