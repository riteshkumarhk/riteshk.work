/* =============================================================================
   rk-ai-proxy — a Cloudflare Worker that keeps your AI provider key OFF the
   browser. The studio sends a shared ACCESS_TOKEN (never the real key); this
   Worker verifies it, swaps in the real provider key server-side, and forwards
   the request. Because the call is server-to-server, it also sidesteps the
   browser CORS blocks some providers (e.g. Anthropic) impose.

   Deploy: paste into a Cloudflare Worker (Compute → Workers) and set these
   secrets/vars (Worker → Settings → Variables and Secrets):
     ACCESS_TOKEN   (secret)  a long random string — the studio must send this
     OPENAI_KEY     (secret)  your OpenAI key            (only if you use OpenAI)
     GEMINI_KEY     (secret)  your Google Gemini key     (only if you use Gemini)
     ANTHROPIC_KEY  (secret)  your Anthropic key         (only if you use Claude)
     ALLOW_ORIGIN   (text)    https://riteshk.work       (comma-separate to add more)

   The studio calls it as:  <worker-url>/<provider>/<the-normal-provider-path>
   e.g.  https://rk-ai-proxy.you.workers.dev/openai/chat/completions
   ========================================================================== */

const PROVIDERS = {
  openai:    { base: "https://api.openai.com/v1",                        keyVar: "OPENAI_KEY",    inject: "bearer"  },
  gemini:    { base: "https://generativelanguage.googleapis.com/v1beta", keyVar: "GEMINI_KEY",    inject: "query"   },
  anthropic: { base: "https://api.anthropic.com/v1",                     keyVar: "ANTHROPIC_KEY", inject: "xapikey" },
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/+/, "").split("/");
    const provider = segments.shift();
    const cfg = PROVIDERS[provider];
    if (!cfg) return json({ error: "Unknown provider" }, 404, cors);

    // --- auth: the studio presents ACCESS_TOKEN wherever a provider key would go ---
    const presented =
      bearer(request.headers.get("Authorization")) ||
      request.headers.get("x-api-key") ||
      url.searchParams.get("key") || "";
    if (!env.ACCESS_TOKEN || !timingSafeEqual(presented, env.ACCESS_TOKEN)) {
      return json({ error: "Unauthorized" }, 401, cors);
    }

    const realKey = env[cfg.keyVar];
    if (!realKey) return json({ error: provider + " is not configured on the server" }, 500, cors);

    // --- rebuild the upstream request with the REAL key ---
    const target = new URL(cfg.base + "/" + segments.join("/"));
    for (const [k, v] of url.searchParams) if (k !== "key") target.searchParams.set(k, v);

    const headers = new Headers();
    const contentType = request.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    if (cfg.inject === "bearer") headers.set("Authorization", "Bearer " + realKey);
    if (cfg.inject === "xapikey") {
      headers.set("x-api-key", realKey);
      headers.set("anthropic-version", request.headers.get("anthropic-version") || "2023-06-01");
    }
    if (cfg.inject === "query") target.searchParams.set("key", realKey);

    const method = request.method;
    const body = (method === "GET" || method === "HEAD") ? undefined : await request.arrayBuffer();

    let upstream;
    try {
      upstream = await fetch(target.toString(), { method, headers, body });
    } catch (e) {
      return json({ error: "Upstream request failed" }, 502, cors);
    }

    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};

function corsHeaders(origin, env) {
  const allow = String(env.ALLOW_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allow.includes("*") || allow.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? (origin || allow[0] || "*") : (allow[0] || "null"),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function bearer(h) { const m = /^Bearer\s+(.+)$/i.exec(h || ""); return m ? m[1] : ""; }
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
