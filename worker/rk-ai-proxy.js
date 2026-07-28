/* =============================================================================
   rk-ai-proxy — one Cloudflare Worker, two jobs:

   1) AI proxy  (/<provider>/<path>) — keeps your AI provider key OFF the browser.
      The studio sends a shared ACCESS_TOKEN; the Worker swaps in the real key.

   2) Admin auth + GitHub proxy  (/admin/login, /admin/gh/*) — keeps your GitHub
      token OFF the browser. The studio logs in with your admin key, gets a short
      HMAC-signed session, and publishes through /admin/gh/* — the Worker injects
      the real GitHub token server-side and only allows your one repo.

   Deploy: paste into a Cloudflare Worker and set these secrets/vars
   (Worker → Settings → Variables and Secrets):
     ACCESS_TOKEN    (secret)  the AI proxy token the studio sends
     OPENAI_KEY      (secret)  your OpenAI key            (only if you use OpenAI)
     GEMINI_KEY      (secret)  your Google Gemini key     (only if you use Gemini)
     ANTHROPIC_KEY   (secret)  your Anthropic key         (only if you use Claude)
     ALLOW_ORIGIN    (text)    https://riteshk.work       (comma-separate to add more)
     ADMIN_HASH      (secret)  PBKDF2 hex of your admin key   (see the node snippet)
     ADMIN_SALT      (secret)  the salt hex that pairs with ADMIN_HASH
     ADMIN_ITERS     (text)    210000   (optional; must match how ADMIN_HASH was made)
     SESSION_SECRET  (secret)  a long random string used to sign login sessions
     GH_TOKEN        (secret)  a GitHub token (Contents: read+write on your repo)
     OWNER           (text)    riteshkumarhk
     REPO            (text)    riteshk.work
   ========================================================================== */

const PROVIDERS = {
  openai:    { base: "https://api.openai.com/v1",                        keyVar: "OPENAI_KEY",    inject: "bearer"  },
  gemini:    { base: "https://generativelanguage.googleapis.com/v1beta", keyVar: "GEMINI_KEY",    inject: "query"   },
  anthropic: { base: "https://api.anthropic.com/v1",                     keyVar: "ANTHROPIC_KEY", inject: "xapikey" },
};

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // admin session lifetime — 12 hours

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // ---------- admin: verify the admin key, issue a short signed session ----------
    if (url.pathname === "/admin/login") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      try {
        let creds = {};
        try { creds = await request.json(); } catch (e) {}
        const ok = await verifyAdminPassword(String(creds.password || ""), env);
        if (!ok) return json({ error: "Incorrect key" }, 401, cors);
        return json(await issueSession(env), 200, cors);
      } catch (e) {
        return json({ error: "Login failed on the server", detail: String((e && e.message) || e) }, 500, cors);
      }
    }

    // ---------- admin: authenticated GitHub proxy (holds the GH token server-side) ----------
    if (url.pathname.startsWith("/admin/gh/")) {
      const sess = bearer(request.headers.get("Authorization"));
      if (!(await verifySession(sess, env))) return json({ error: "Unauthorized" }, 401, cors);

      const owner = env.OWNER || "", repo = env.REPO || "";
      const rest = url.pathname.slice("/admin/gh".length); // "/repos/<owner>/<repo>/..."
      const allowed = "/repos/" + owner + "/" + repo + "/";
      if (!owner || !repo || rest.indexOf(allowed) !== 0) return json({ error: "Forbidden path" }, 403, cors);
      if (!env.GH_TOKEN) return json({ error: "GitHub is not configured on the server" }, 500, cors);

      const ghTarget = "https://api.github.com" + rest + url.search;
      const ghHeaders = new Headers();
      ghHeaders.set("Authorization", "token " + env.GH_TOKEN);
      ghHeaders.set("Accept", request.headers.get("Accept") || "application/vnd.github+json");
      ghHeaders.set("User-Agent", "rk-admin-proxy");
      const ghCt = request.headers.get("Content-Type"); if (ghCt) ghHeaders.set("Content-Type", ghCt);
      const ghAv = request.headers.get("X-GitHub-Api-Version"); if (ghAv) ghHeaders.set("X-GitHub-Api-Version", ghAv);

      const ghMethod = request.method;
      const ghBody = (ghMethod === "GET" || ghMethod === "HEAD") ? undefined : await request.arrayBuffer();

      let ghUp;
      try { ghUp = await fetch(ghTarget, { method: ghMethod, headers: ghHeaders, body: ghBody }); }
      catch (e) { return json({ error: "GitHub request failed" }, 502, cors); }

      const ghOut = new Headers(ghUp.headers);
      for (const [k, v] of Object.entries(cors)) ghOut.set(k, v);
      return new Response(ghUp.body, { status: ghUp.status, headers: ghOut });
    }

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
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,Accept,X-GitHub-Api-Version",
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

/* ---------- admin auth crypto (PBKDF2 verify + HMAC session) ---------- */
function hexToBytes(hex) {
  const h = String(hex || "").trim();
  const a = new Uint8Array(Math.floor(h.length / 2));
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}
function bytesToHex(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
function b64urlFromBytes(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function b64urlFromStr(str) { return b64urlFromBytes(new TextEncoder().encode(str)); }

async function pbkdf2Hex(password, saltBytes, iters) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: iters, hash: "SHA-256" }, key, 256);
  return bytesToHex(bits);
}
async function verifyAdminPassword(pw, env) {
  if (!pw || !env.ADMIN_HASH || !env.ADMIN_SALT) return false;
  // Cloudflare Workers' WebCrypto caps PBKDF2 at 100000 iterations (higher throws
  // NotSupportedError), so clamp here — the stored ADMIN_HASH must be generated with the same count.
  let iters = parseInt(env.ADMIN_ITERS || "100000", 10) || 100000;
  if (iters > 100000) iters = 100000;
  const hex = await pbkdf2Hex(pw, hexToBytes(env.ADMIN_SALT), iters);
  return timingSafeEqual(hex, String(env.ADMIN_HASH).trim().toLowerCase());
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64urlFromBytes(sig);
}
async function issueSession(env) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = b64urlFromStr(JSON.stringify({ exp }));
  const sig = await hmac(env.SESSION_SECRET || "", payload);
  return { token: payload + "." + sig, exp };
}
async function verifySession(token, env) {
  if (!token || !env.SESSION_SECRET) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = await hmac(env.SESSION_SECRET, payload);
  if (!timingSafeEqual(sig, expect)) return false;
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return !!(obj && obj.exp && obj.exp > Date.now());
  } catch (e) { return false; }
}
