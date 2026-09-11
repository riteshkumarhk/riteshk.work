import { normalizeAiModel } from "./ai-model-router.mjs";

export const AI_REFERENCE_URL = "https://models.dev/api.json";

function modelHeaders(config) {
  return config.provider === "anthropic"
    ? { "x-api-key": config.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : config.provider === "gemini" ? {} : { Authorization: "Bearer " + config.key };
}

export function aiProviderScope(config) {
  const base = new URL(config.base);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Use an AI base URL without credentials or query parameters");
  return JSON.stringify([config.provider, base.href.replace(/\/+$/, "")]);
}

export function createAiCatalog({ fetch = globalThis.fetch, now = Date.now, ttl = 15 * 60000, referenceTtl = 24 * 3600000 } = {}) {
  const cache = new Map();
  let reference = null;
  async function referenceModels(signal, refresh) {
    if (!refresh && reference && now() - reference.at < referenceTtl) return reference;
    try {
      const timeout = AbortSignal.timeout(6000);
      const response = await fetch(AI_REFERENCE_URL, { credentials: "omit", referrerPolicy: "no-referrer", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) throw new Error("Reference catalogue unavailable");
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid reference catalogue");
      signal?.throwIfAborted();
      reference = { data, at: now(), available: true };
      return reference;
    } catch (error) {
      signal?.throwIfAborted();
      return { data: {}, at: now(), available: false };
    }
  }
  return {
    clear() { cache.clear(); reference = null; },
    async discover(config, { signal, refresh = false, useReference = true } = {}) {
      signal?.throwIfAborted();
      const scope = aiProviderScope(config);
      if (!config.key) throw new Error("Connect an AI provider first");
      const cacheKey = JSON.stringify([scope, config.key, config.provider === "custom" ? config.model || "" : "", useReference]);
      const existing = cache.get(cacheKey);
      if (!refresh && existing && now() - existing.updatedAt < ttl) return structuredClone(existing);
      if (config.provider === "custom" && config.model) {
        const selected = normalizeAiModel(config.provider, { id: config.model });
        if (!selected) throw new Error("The configured custom model is invalid");
        selected.sources = ["configured model"];
        return { scope, updatedAt: now(), models: [selected], referenceAvailable: false, explicit: true };
      }
      const records = [], cursors = new Set();
      let cursor = "";
      for (let page = 0; page < 10; page++) {
        signal?.throwIfAborted();
        const url = new URL(config.base.replace(/\/+$/, "") + "/models");
        if (config.provider === "gemini") {
          url.searchParams.set("key", config.key); url.searchParams.set("pageSize", "1000");
          if (cursor) url.searchParams.set("pageToken", cursor);
        } else {
          url.searchParams.set("limit", "1000");
          if (cursor) url.searchParams.set(config.provider === "anthropic" ? "after_id" : "after", cursor);
        }
        const timeout = AbortSignal.timeout(15000);
        const response = await fetch(url.href, { headers: modelHeaders(config), credentials: "omit", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (!response.ok) {
          const error = new Error("Model discovery failed (HTTP " + response.status + "). Check the selected provider connection.");
          error.status = response.status; throw error;
        }
        const data = await response.json();
        const models = config.provider === "gemini" ? data.models : data.data;
        if (!Array.isArray(models)) throw new Error("The provider returned an invalid model catalogue");
        records.push(...models);
        if (records.length > 5000) throw new Error("The provider model catalogue exceeds the supported size");
        const next = config.provider === "gemini" ? data.nextPageToken : data.has_more ? data.last_id : null;
        if (data.has_more === true && !next) throw new Error("The provider returned incomplete model pagination");
        if (!next) break;
        if (typeof next !== "string" || cursors.has(next) || page === 9) throw new Error("The provider returned incomplete model pagination");
        cursors.add(next); cursor = next;
      }
      const facts = useReference ? await referenceModels(signal, refresh) : { data: {}, available: false };
      signal?.throwIfAborted();
      const referenceProvider = config.provider === "gemini" ? "google" : config.provider;
      const referenceMap = facts.data[referenceProvider]?.models || {};
      const models = new Map();
      for (const raw of records) {
        const id = raw?.id || (typeof raw?.name === "string" ? raw.name.replace(/^models\//, "") : "");
        const extra = Object.hasOwn(referenceMap, id) ? referenceMap[id] : {};
        const model = normalizeAiModel(config.provider, raw, extra);
        if (model && !models.has(model.id)) models.set(model.id, model);
      }
      const result = { scope, updatedAt: now(), models: [...models.values()], referenceAvailable: facts.available, explicit: false };
      cache.set(cacheKey, structuredClone(result));
      return result;
    }
  };
}