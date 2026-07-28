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
const VAULT_URL_TTL_MS = 6 * 60 * 60 * 1000;  // signed vault-asset URL lifetime — 6 hours
const GRANT_REDEEM_TTL_MS = 12 * 60 * 60 * 1000; // ticket-holder vault access token lifetime — 12 hours
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000; // passkey register/auth challenge lifetime — 5 min
const PUBLISH_TOKEN_TTL_MS = 5 * 60 * 1000;       // publish step-up (passkey factor) token lifetime — 5 min

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // ---------- admin: verify the admin key, issue a short signed session ----------
    if (url.pathname === "/admin/login") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (env.VAULT_GRANTS && (await env.VAULT_GRANTS.get("cfg:passwordless")) === "1") return json({ error: "Password sign-in is disabled \u2014 use a passkey." }, 403, cors);
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

    // ---------- admin: passkey (WebAuthn) enrolment + sign-in ----------
    // Register is owner-gated (needs an existing session — i.e. the password login) so only the owner
    // can enrol a passkey. Auth is public: the assertion signature IS the proof. A "login" assertion
    // issues the same HMAC session as the password path; a "publish" assertion issues a short-lived
    // publish token (factor 1 of the publish step-up — the recovery proof is factor 2, checked later).
    if (url.pathname === "/admin/webauthn/register/begin") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Passkey store not configured" }, 500, cors);
      const challenge = b64urlFromBytes(crypto.getRandomValues(new Uint8Array(32)));
      await env.VAULT_GRANTS.put("wa:chal:" + challenge, JSON.stringify({ type: "reg", exp: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS }), { expirationTtl: 300 });
      const exclude = [];
      try { const l = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" }); for (const k of l.keys) exclude.push({ type: "public-key", id: k.name.slice(8) }); } catch (e) {}
      return json({
        rp: { id: waRpId(env), name: "riteshk.work" },
        user: { id: await waOwnerId(env), name: env.RP_USER_NAME || "owner@riteshk.work", displayName: env.RP_USER_DISPLAY || "Ritesh \u2014 riteshk.work admin" },
        challenge: challenge,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        timeout: 120000, attestation: "none",
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
        excludeCredentials: exclude,
      }, 200, cors);
    }
    if (url.pathname === "/admin/webauthn/register/finish") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      try {
        const body = await request.json();
        const cd = JSON.parse(new TextDecoder().decode(b64urlToBytes(body.response.clientDataJSON)));
        if (cd.type !== "webauthn.create") return json({ error: "Bad clientData type" }, 400, cors);
        const ck = "wa:chal:" + cd.challenge;
        const chal = await env.VAULT_GRANTS.get(ck, "json");
        if (!chal || chal.type !== "reg" || chal.exp < Date.now()) return json({ error: "Challenge expired" }, 400, cors);
        await env.VAULT_GRANTS.delete(ck);
        if (!waOriginOk(cd.origin, env)) return json({ error: "Bad origin" }, 400, cors);
        const att = cborDecode(b64urlToBytes(body.response.attestationObject)).value;
        const p = parseAuthData(att.get("authData"));
        const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(waRpId(env))));
        if (!bytesEq(p.rpIdHash, rpHash)) return json({ error: "RP mismatch" }, 400, cors);
        if (!(p.flags & 0x01)) return json({ error: "User not present" }, 400, cors);
        if (!p.credId || !p.credPubKey) return json({ error: "No credential" }, 400, cors);
        const parsedKey = coseToJwk(p.credPubKey);
        const credId = b64urlFromBytes(p.credId);
        await env.VAULT_GRANTS.put("wa:cred:" + credId, JSON.stringify({ jwk: parsedKey.jwk, alg: parsedKey.alg, counter: p.signCount, label: String(body.label || "passkey").slice(0, 40), createdAt: Date.now() }));
        const l = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" });
        return json({ ok: true, credId: credId, count: l.keys.length }, 200, cors);
      } catch (e) { return json({ error: "Registration failed", detail: String((e && e.message) || e) }, 400, cors); }
    }
    if (url.pathname === "/admin/webauthn/auth/begin") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Passkey store not configured" }, 500, cors);
      let purpose = "login"; try { const b = await request.json(); if (b && b.purpose === "publish") purpose = "publish"; } catch (e) {}
      const challenge = b64urlFromBytes(crypto.getRandomValues(new Uint8Array(32)));
      await env.VAULT_GRANTS.put("wa:chal:" + challenge, JSON.stringify({ type: "auth", purpose: purpose, exp: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS }), { expirationTtl: 300 });
      return json({ challenge: challenge, rpId: waRpId(env), timeout: 120000, userVerification: "preferred", allowCredentials: [] }, 200, cors);
    }
    if (url.pathname === "/admin/webauthn/auth/finish") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      try {
        const body = await request.json();
        const cd = JSON.parse(new TextDecoder().decode(b64urlToBytes(body.response.clientDataJSON)));
        if (cd.type !== "webauthn.get") return json({ error: "Bad clientData type" }, 400, cors);
        const ck = "wa:chal:" + cd.challenge;
        const chal = await env.VAULT_GRANTS.get(ck, "json");
        if (!chal || chal.type !== "auth" || chal.exp < Date.now()) return json({ error: "Challenge expired" }, 400, cors);
        await env.VAULT_GRANTS.delete(ck);
        if (!waOriginOk(cd.origin, env)) return json({ error: "Bad origin" }, 400, cors);
        const cred = await env.VAULT_GRANTS.get("wa:cred:" + body.id, "json");
        if (!cred) return json({ error: "Unknown credential" }, 401, cors);
        const authData = b64urlToBytes(body.response.authenticatorData);
        const p = parseAuthData(authData);
        const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(waRpId(env))));
        if (!bytesEq(p.rpIdHash, rpHash)) return json({ error: "RP mismatch" }, 400, cors);
        if (!(p.flags & 0x01)) return json({ error: "User not present" }, 400, cors);
        const cdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", b64urlToBytes(body.response.clientDataJSON)));
        const ok = await waVerifySig(cred.jwk, cred.alg, concatBytes(authData, cdHash), b64urlToBytes(body.response.signature));
        if (!ok) return json({ error: "Bad signature" }, 401, cors);
        if (cred.counter > 0 && p.signCount > 0 && p.signCount <= cred.counter) return json({ error: "Counter regression" }, 401, cors);
        cred.counter = p.signCount; await env.VAULT_GRANTS.put("wa:cred:" + body.id, JSON.stringify(cred));
        if (chal.purpose === "publish") {
          const exp = Date.now() + PUBLISH_TOKEN_TTL_MS;
          const payload = b64urlFromStr(JSON.stringify({ pub: 1, exp: exp }));
          return json({ ok: true, publishToken: payload + "." + (await hmac(env.SESSION_SECRET || "", payload)), exp: exp }, 200, cors);
        }
        return json(await issueSession(env), 200, cors);
      } catch (e) { return json({ error: "Auth failed", detail: String((e && e.message) || e) }, 401, cors); }
    }
    if (url.pathname === "/admin/webauthn/list") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, cors);
      // Low-sensitivity: whether passkeys exist + their labels, so the client can decide to offer
      // passkey sign-in. Credential IDs are not secrets (they travel in every assertion anyway).
      if (!env.VAULT_GRANTS) return json({ passkeys: [] }, 200, cors);
      try {
        const l = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" }); const out = [];
        for (const k of l.keys) { const c = await env.VAULT_GRANTS.get(k.name, "json"); out.push({ id: k.name.slice(8), label: (c && c.label) || "passkey", createdAt: (c && c.createdAt) || 0 }); }
        return json({ passkeys: out }, 200, cors);
      } catch (e) { return json({ passkeys: [] }, 200, cors); }
    }
    if (url.pathname === "/admin/webauthn/remove") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      try {
        const b = await request.json();
        if (b && b.credId) await env.VAULT_GRANTS.delete("wa:cred:" + b.credId);
        const l = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" });
        return json({ ok: true, count: l.keys.length }, 200, cors);
      } catch (e) { return json({ error: "Remove failed" }, 400, cors); }
    }
    // Owner sets/clears the publish step-up: stores SHA-256 of the recovery proof and the require flag.
    if (url.pathname === "/admin/publish/config") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      try {
        const b = await request.json();
        if (b && typeof b.proof === "string" && b.proof) await env.VAULT_GRANTS.put("cfg:publishproof", bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(b.proof))));
        if (b && typeof b.require === "boolean") {
          const hasProof = !!(await env.VAULT_GRANTS.get("cfg:publishproof"));
          const creds = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" });
          if (b.require && (!hasProof || !creds.keys.length)) return json({ error: "Add a passkey and set the passphrase first." }, 400, cors);
          await env.VAULT_GRANTS.put("cfg:publish2fa", b.require ? "1" : "");
        }
        return json({ ok: true, enabled: (await env.VAULT_GRANTS.get("cfg:publish2fa")) === "1", hasProof: !!(await env.VAULT_GRANTS.get("cfg:publishproof")) }, 200, cors);
      } catch (e) { return json({ error: "Config failed" }, 400, cors); }
    }
    if (url.pathname === "/admin/publish/status") {
      if (!env.VAULT_GRANTS) return json({ enabled: false, hasProof: false }, 200, cors);
      return json({ enabled: (await env.VAULT_GRANTS.get("cfg:publish2fa")) === "1", hasProof: !!(await env.VAULT_GRANTS.get("cfg:publishproof")) }, 200, cors);
    }
    // Auth mode the sign-in card reads: are we passwordless, is a recovery passphrase set, how many passkeys.
    if (url.pathname === "/admin/auth/status") {
      if (!env.VAULT_GRANTS) return json({ passwordless: false, hasRecovery: false, passkeys: 0 }, 200, cors);
      const l = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" });
      return json({ passwordless: (await env.VAULT_GRANTS.get("cfg:passwordless")) === "1", hasRecovery: !!(await env.VAULT_GRANTS.get("cfg:publishproof")), passkeys: l.keys.length }, 200, cors);
    }
    // Owner turns passwordless on/off. Enabling requires ≥1 passkey AND a recovery passphrase (so no lockout).
    if (url.pathname === "/admin/auth/config") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      try {
        const b = await request.json();
        if (b && typeof b.passwordless === "boolean") {
          if (b.passwordless) {
            const l = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" });
            if (!l.keys.length || !(await env.VAULT_GRANTS.get("cfg:publishproof"))) return json({ error: "Add a passkey and set your recovery passphrase first." }, 400, cors);
          }
          await env.VAULT_GRANTS.put("cfg:passwordless", b.passwordless ? "1" : "");
        }
        return json({ ok: true, passwordless: (await env.VAULT_GRANTS.get("cfg:passwordless")) === "1" }, 200, cors);
      } catch (e) { return json({ error: "Config failed" }, 400, cors); }
    }
    // Break-glass: recover admin access with the recovery-passphrase proof when all passkeys are lost.
    // Verified against the stored hash (never reveals the backend); rate-limited by IP.
    if (url.pathname === "/admin/recover") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Recovery unavailable" }, 500, cors);
      const rlKey = "rl:recover:" + (request.headers.get("CF-Connecting-IP") || "0");
      const tries = parseInt((await env.VAULT_GRANTS.get(rlKey)) || "0", 10) || 0;
      if (tries >= 6) return json({ error: "Too many attempts \u2014 try again later." }, 429, cors);
      try {
        const b = await request.json();
        const stored = await env.VAULT_GRANTS.get("cfg:publishproof");
        const proof = (b && b.proof) || "";
        const proofHash = proof ? bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof))) : "";
        if (!stored || !timingSafeEqual(proofHash, stored)) {
          await env.VAULT_GRANTS.put(rlKey, String(tries + 1), { expirationTtl: 900 });
          return json({ error: "That recovery passphrase didn\u2019t match." }, 401, cors);
        }
        await env.VAULT_GRANTS.delete(rlKey);
        return json(await issueSession(env), 200, cors);
      } catch (e) { return json({ error: "Recovery failed" }, 400, cors); }
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
      // Hardening: a publish only ever reads, creates blobs/trees/commits, updates the ref (PATCH),
      // and uploads files (PUT). It NEVER needs DELETE. Allowlisting these verbs means a stolen admin
      // session cannot delete files, delete or rewrite branches, or wipe history through this proxy.
      // (Branch protection on main also blocks force-pushes as a second layer.)
      if (["GET", "HEAD", "POST", "PUT", "PATCH"].indexOf(ghMethod) === -1) return json({ error: "Method not allowed via proxy" }, 405, cors);
      // Publish step-up: when enabled, every repo WRITE requires BOTH a fresh passkey assertion
      // (X-Publish-Token — factor 1, possession) AND the recovery-passphrase proof (X-Publish-Proof
      // — factor 2, knowledge). So a stolen session alone can read but cannot publish/deface.
      if (env.VAULT_GRANTS && ghMethod !== "GET" && ghMethod !== "HEAD" && (await env.VAULT_GRANTS.get("cfg:publish2fa")) === "1") {
        if (!(await verifyPublishToken(request.headers.get("X-Publish-Token"), env))) return json({ error: "Publish needs a passkey step-up." }, 401, cors);
        const stored = await env.VAULT_GRANTS.get("cfg:publishproof");
        const proof = request.headers.get("X-Publish-Proof") || "";
        const proofHash = proof ? bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof))) : "";
        if (!stored || !timingSafeEqual(proofHash, stored)) return json({ error: "Publish needs your recovery passphrase." }, 401, cors);
      }
      const ghBody = (ghMethod === "GET" || ghMethod === "HEAD") ? undefined : await request.arrayBuffer();

      let ghUp;
      try { ghUp = await fetch(ghTarget, { method: ghMethod, headers: ghHeaders, body: ghBody }); }
      catch (e) { return json({ error: "GitHub request failed" }, 502, cors); }

      const ghOut = new Headers(ghUp.headers);
      for (const [k, v] of Object.entries(cors)) ghOut.set(k, v);
      return new Response(ghUp.body, { status: ghUp.status, headers: ghOut });
    }

    // ---------- admin vault: private media in R2, gated + signed by the Worker ----------
    if (url.pathname === "/vault/upload") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT) return json({ error: "Vault storage is not configured" }, 500, cors);
      try {
        const ct = request.headers.get("Content-Type") || "application/octet-stream";
        const buf = await request.arrayBuffer();
        if (!buf || buf.byteLength === 0) return json({ error: "Empty upload" }, 400, cors);
        const hash = bytesToHex(await crypto.subtle.digest("SHA-256", buf));
        const ext = (url.searchParams.get("ext") || "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
        const key = ext ? (hash + "." + ext) : hash;
        await env.VAULT.put(key, buf, { httpMetadata: { contentType: ct } });
        return json({ key: key, size: buf.byteLength }, 200, cors);
      } catch (e) {
        return json({ error: "Upload failed", detail: String((e && e.message) || e) }, 500, cors);
      }
    }

    // Mint a short-lived signed per-asset URL. Authorised by EITHER the owner session (any key)
    // OR a redeemed curated-view grant token (only keys the grant allows). The <video>/<img> src
    // then loads with no auth header — the signature IS the auth, scoped to one key and expiring.
    if (url.pathname === "/vault/sign") {
      const key = url.searchParams.get("key") || "";
      if (!key || key.indexOf("..") !== -1 || key.indexOf("/") !== -1) return json({ error: "Bad key" }, 400, cors);
      let ok = await verifySession(bearer(request.headers.get("Authorization")), env);
      if (!ok) {
        const g = await verifyGrant(request.headers.get("X-Vault-Grant") || url.searchParams.get("grant"), env);
        if (!g) return json({ error: "Unauthorized" }, 401, cors);
        const rec = env.VAULT_GRANTS ? await env.VAULT_GRANTS.get("g:" + g.g, "json") : null;
        if (!rec || !rec.exp || rec.exp < Date.now() || !Array.isArray(rec.keys) || rec.keys.indexOf(key) === -1) return json({ error: "Not authorized for this item" }, 403, cors);
        ok = true;
      }
      const exp = Date.now() + VAULT_URL_TTL_MS;
      const sig = await hmac(env.SESSION_SECRET || "", "vault:" + key + ":" + exp);
      return json({ url: "/vault/asset/" + encodeURIComponent(key) + "?exp=" + exp + "&sig=" + sig, exp: exp }, 200, cors);
    }

    // Owner registers a curated-view grant: a pass that lets a recruiter mint signed URLs for a
    // fixed set of vault keys until it expires. Stored in KV keyed by an HMAC of the pass — the
    // raw pass is never stored, and the allowed-keys list scopes access to just that view.
    if (url.pathname === "/vault/grant") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Grants store not configured" }, 500, cors);
      let body; try { body = await request.json(); } catch (e) { body = null; }
      const code = body && typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
      const keys = body && Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string" && k && k.indexOf("/") === -1).slice(0, 2000) : [];
      const now = Date.now();
      const maxExp = now + 3650 * 86400000;   // 10y sanity bound — honours any realistic ticket length; 'never' tickets refresh on publish
      // Prefer an absolute expiry so a grant tracks its ticket's exact auto-hide time; fall back to a day count.
      let exp;
      if (body && typeof body.exp === "number" && isFinite(body.exp)) exp = Math.max(now + 60000, Math.min(maxExp, Math.floor(body.exp)));
      else { const days = Math.max(1, Math.min(365, parseInt((body && body.days) || 30, 10) || 30)); exp = now + days * 86400000; }
      if (!code) return json({ error: "Missing pass" }, 400, cors);
      const gid = await hmac(env.SESSION_SECRET || "", "grant:" + code);
      await env.VAULT_GRANTS.put("g:" + gid, JSON.stringify({ keys: keys, exp: exp }), { expiration: Math.floor(exp / 1000) });
      return json({ ok: true, exp: exp, count: keys.length }, 200, cors);
    }

    // Recruiter redeems their curated-view pass for a short-lived, scoped vault access token.
    if (url.pathname === "/vault/redeem") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Grants store not configured" }, 500, cors);
      let body; try { body = await request.json(); } catch (e) { body = null; }
      const code = body && typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
      if (!code) return json({ error: "Missing pass" }, 400, cors);
      const gid = await hmac(env.SESSION_SECRET || "", "grant:" + code);
      const rec = await env.VAULT_GRANTS.get("g:" + gid, "json");
      if (!rec || !rec.exp || rec.exp < Date.now()) return json({ error: "That pass isn’t valid or has expired." }, 403, cors);
      const exp = Math.min(Date.now() + GRANT_REDEEM_TTL_MS, rec.exp);
      const payload = b64urlFromStr(JSON.stringify({ g: gid, exp: exp }));
      const sig = await hmac(env.SESSION_SECRET || "", payload);
      return json({ token: payload + "." + sig, exp: exp }, 200, cors);
    }

    // Serve a vault object (signature-gated, HTTP range support for smooth video streaming).
    if (url.pathname.startsWith("/vault/asset/")) {
      if (!env.VAULT) return json({ error: "Vault storage is not configured" }, 500, cors);
      const key = decodeURIComponent(url.pathname.slice("/vault/asset/".length));
      const exp = parseInt(url.searchParams.get("exp") || "0", 10);
      const sig = url.searchParams.get("sig") || "";
      if (!key || key.indexOf("..") !== -1) return json({ error: "Bad key" }, 400, cors);
      const expect = await hmac(env.SESSION_SECRET || "", "vault:" + key + ":" + exp);
      if (!exp || exp < Date.now() || !timingSafeEqual(sig, expect)) return json({ error: "Link expired or invalid" }, 403, cors);

      const rangeHeader = request.headers.get("Range");
      const getOpts = {};
      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (m && (m[1] || m[2])) {
          if (m[1] && m[2]) getOpts.range = { offset: +m[1], length: (+m[2] - +m[1] + 1) };
          else if (m[1]) getOpts.range = { offset: +m[1] };
          else getOpts.range = { suffix: +m[2] };
        }
      }
      const obj = await env.VAULT.get(key, getOpts);
      if (!obj) return json({ error: "Not found" }, 404, cors);
      const headers = new Headers(cors);
      obj.writeHttpMetadata(headers);
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "private, max-age=3600");
      if (obj.range && rangeHeader) {
        const off = obj.range.offset || 0;
        const len = (obj.range.length != null) ? obj.range.length : (obj.size - off);
        headers.set("Content-Range", "bytes " + off + "-" + (off + len - 1) + "/" + obj.size);
        headers.set("Content-Length", String(len));
        return new Response(obj.body, { status: 206, headers });
      }
      headers.set("Content-Length", String(obj.size));
      return new Response(obj.body, { status: 200, headers });
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
    "Access-Control-Allow-Headers": "Authorization,Content-Type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,Accept,X-GitHub-Api-Version,X-Vault-Grant",
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
// Verify a redeemed curated-view grant token (payload {g, exp} + HMAC). Returns the payload
// ({g: the KV grant id}) when the signature + expiry check out, else null. The caller then
// looks the grant up in KV to confirm the requested key is in its allowed set.
async function verifyGrant(token, env) {
  if (!token || !env.SESSION_SECRET) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = await hmac(env.SESSION_SECRET, payload);
  if (!timingSafeEqual(sig, expect)) return null;
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    if (obj && obj.g && obj.exp && obj.exp > Date.now()) return obj;
  } catch (e) {}
  return null;
}
// Verify a publish step-up token (the passkey "publish" assertion result): payload {pub:1, exp} + HMAC.
async function verifyPublishToken(token, env) {
  if (!token || !env.SESSION_SECRET) return false;
  const dot = token.indexOf("."); if (dot < 1) return false;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!timingSafeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return false;
  try { const o = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))); return !!(o && o.pub && o.exp && o.exp > Date.now()); } catch (e) { return false; }
}

/* ---------- WebAuthn (passkey) helpers — dependency-free ---------- */
function waRpId(env) { return env.RP_ID || "riteshk.work"; }
function waOriginOk(origin, env) {
  const allow = String(env.ALLOW_ORIGIN || "https://riteshk.work").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.indexOf(origin) !== -1;
}
async function waOwnerId(env) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("owner:" + waRpId(env)));
  return b64urlFromBytes(new Uint8Array(h).slice(0, 16));
}
function bytesEq(a, b) { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
function concatBytes(a, b) { const c = new Uint8Array(a.length + b.length); c.set(a, 0); c.set(b, a.length); return c; }
// Minimal CBOR decoder — only the subset used in a WebAuthn attestationObject + COSE key.
function cborDecode(buf) {
  let o = 0;
  function read() {
    const first = buf[o++], major = first >> 5, info = first & 0x1f;
    let len = info;
    if (info === 24) len = buf[o++];
    else if (info === 25) { len = (buf[o] << 8) | buf[o + 1]; o += 2; }
    else if (info === 26) { len = (buf[o] * 0x1000000) + (buf[o + 1] << 16) + (buf[o + 2] << 8) + buf[o + 3]; o += 4; }
    else if (info === 27) { const hi = (buf[o] * 0x1000000) + (buf[o + 1] << 16) + (buf[o + 2] << 8) + buf[o + 3]; const lo = (buf[o + 4] * 0x1000000) + (buf[o + 5] << 16) + (buf[o + 6] << 8) + buf[o + 7]; o += 8; len = hi * 0x100000000 + lo; }
    switch (major) {
      case 0: return len;
      case 1: return -1 - len;
      case 2: { const b = buf.slice(o, o + len); o += len; return b; }
      case 3: { const s = new TextDecoder().decode(buf.slice(o, o + len)); o += len; return s; }
      case 4: { const a = []; for (let i = 0; i < len; i++) a.push(read()); return a; }
      case 5: { const m = new Map(); for (let i = 0; i < len; i++) { const k = read(); m.set(k, read()); } return m; }
      case 7: { if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; return len; }
      default: throw new Error("CBOR major " + major);
    }
  }
  const value = read();
  return { value: value, offset: o };
}
function parseAuthData(ad) {
  const rpIdHash = ad.slice(0, 32);
  const flags = ad[32];
  const signCount = (ad[33] * 0x1000000) + (ad[34] << 16) + (ad[35] << 8) + ad[36];
  let credId = null, credPubKey = null, o = 37;
  if (flags & 0x40) {
    o += 16; // aaguid
    const credIdLen = (ad[o] << 8) | ad[o + 1]; o += 2;
    credId = ad.slice(o, o + credIdLen); o += credIdLen;
    credPubKey = cborDecode(ad.slice(o)).value;
  }
  return { rpIdHash: rpIdHash, flags: flags, signCount: signCount, credId: credId, credPubKey: credPubKey };
}
function coseToJwk(cose) {
  const g = (k) => cose.get(k);
  const kty = g(1), alg = g(3);
  if (kty === 2) {
    const crv = g(-1);
    const crvName = crv === 2 ? "P-384" : crv === 3 ? "P-521" : "P-256";
    return { alg: alg, jwk: { kty: "EC", crv: crvName, x: b64urlFromBytes(g(-2)), y: b64urlFromBytes(g(-3)), ext: true } };
  }
  if (kty === 3) return { alg: alg, jwk: { kty: "RSA", n: b64urlFromBytes(g(-1)), e: b64urlFromBytes(g(-2)), ext: true } };
  throw new Error("Unsupported COSE key type " + kty);
}
function derToRawEcdsa(der) {
  let o = 0;
  if (der[o++] !== 0x30) throw new Error("DER seq");
  let sl = der[o++]; if (sl & 0x80) { let n = sl & 0x7f; sl = 0; while (n--) sl = (sl << 8) | der[o++]; }
  if (der[o++] !== 0x02) throw new Error("DER int r");
  const rl = der[o++]; let r = der.slice(o, o + rl); o += rl;
  if (der[o++] !== 0x02) throw new Error("DER int s");
  const sl2 = der[o++]; let s = der.slice(o, o + sl2); o += sl2;
  const norm = (x) => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; x = x.slice(i); if (x.length > 32) x = x.slice(x.length - 32); const out = new Uint8Array(32); out.set(x, 32 - x.length); return out; };
  const raw = new Uint8Array(64); raw.set(norm(r), 0); raw.set(norm(s), 32); return raw;
}
async function waVerifySig(jwk, alg, signed, sig) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: jwk.crv || "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRawEcdsa(sig), signed);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, sig, signed);
  }
  return false;
}
