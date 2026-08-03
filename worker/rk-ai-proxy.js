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
const TRUST_TTL_MS = 180 * 24 * 60 * 60 * 1000;    // device-trust token lifetime — 180 days
// VAPID public key (raw uncompressed P-256 point, base64url) — PUBLIC by design, paired with the
// VAPID_PRIVATE secret (a JWK). The same value is hardcoded in inbox/inbox.js (applicationServerKey).
const VAPID_PUBLIC = "BNvPqxaZXo1uLqMAXeW-l6WCPMceklB7Z5RzgpAL3p8N8MtkATL5j0w6YMwdFmNPD0nkcN4NWY_msYNewlZKCHQ";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // ---------- public: a visitor without a code asks for one (rate-limited + honeypot) ----------
    if (url.pathname === "/request-access") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Requests aren\u2019t available right now." }, 503, cors);
      const reqIp = request.headers.get("CF-Connecting-IP") || "0";
      const reqRl = "rl:req:" + reqIp;
      const reqTries = parseInt((await env.VAULT_GRANTS.get(reqRl)) || "0", 10) || 0;
      if (reqTries >= 5) return json({ error: "You\u2019ve sent a few already \u2014 I\u2019ll be in touch. Try later." }, 429, cors);
      try {
        const b = await request.json();
        if (b && String(b.hp || "").trim()) return json({ ok: true }, 200, cors);   // honeypot: silently drop bots
        const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
        const name = clip(b && b.name, 80), email = clip(b && b.email, 140), company = clip(b && b.company, 140), note = clip(b && b.note, 400), context = clip(b && b.context, 160);
        if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Add your name, company/role and a valid work email." }, 400, cors);
        // Cloudflare Turnstile human-check — enforced only once TURNSTILE_SECRET is set on the Worker.
        // Until then the form behaves exactly as before (honeypot + rate limit above stay as backstops).
        if (env.TURNSTILE_SECRET) {
          const tsTok = String((b && b.turnstileToken) || "");
          if (!tsTok) return json({ error: "Please complete the human check and try again." }, 400, cors);
          if (!(await verifyTurnstile(env.TURNSTILE_SECRET, tsTok, reqIp))) return json({ error: "That human check didn\u2019t pass \u2014 please try again." }, 403, cors);
        }
        await env.VAULT_GRANTS.put(reqRl, String(reqTries + 1), { expirationTtl: 3600 });
        const rec = { name, email, company, note, context, status: "pending", at: new Date().toISOString(), ip: reqIp, ua: clip(request.headers.get("User-Agent"), 200) };
        const reqId = "req:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
        try { await env.VAULT_GRANTS.put(reqId, JSON.stringify(rec), { expirationTtl: 90 * 24 * 3600 }); } catch (e) {}
        // Web Push fan-out to the owner's installed inbox PWA(s). The payload carries signed one-tap
        // capability links so the notification's Allow / Decline buttons act without opening the app.
        try {
          const allowTok = await hmac(env.SESSION_SECRET || "", "reqallow." + reqId);
          const cancelTok = await hmac(env.SESSION_SECRET || "", "reqcancel." + reqId);
          const notePrev = note ? (note.length > 140 ? note.slice(0, 139) + "\u2026" : note) : "";
          await pushToAll(env, {
            title: "New access request",
            body: name + (company ? " \u00b7 " + company : "") + (context ? "\nWants: " + context : "") + (notePrev ? "\n\u201c" + notePrev + "\u201d" : ""),
            tag: reqId, url: "/inbox/", reqId: reqId, timestamp: Date.now(),
            allow: url.origin + "/req/allow?id=" + encodeURIComponent(reqId) + "&t=" + allowTok,
            cancel: url.origin + "/req/cancel?id=" + encodeURIComponent(reqId) + "&t=" + cancelTok,
          });
        } catch (e) {}
        // Reliable fallback: also email the owner, so a new request reaches your Gmail even when Android
        // Doze defers the PWA push. No action links in the email (email scanners prefetch links and could
        // auto-approve) -- you approve/decline securely in the passkey-gated inbox. Reply-To = recruiter.
        try {
          const om = reqOwnerEmail({ name: name, email: email, company: company, context: context, note: note, inbox: url.origin + "/inbox/" });
          await sendEmail(env, { to: (env.OWNER_EMAIL || "riteshkumarhk@gmail.com"), subject: "New access request \u2014 " + name + (company ? " \u00b7 " + company : ""), html: om.html, text: om.text, replyTo: email });
        } catch (e) {}
        return json({ ok: true }, 200, cors);
      } catch (e) { return json({ error: "Couldn\u2019t send that \u2014 try again." }, 400, cors); }
    }

    // ---------- one-tap dismiss from the notification's "Ignore" button (signed capability link, no session) ----------
    if (url.pathname === "/req/dismiss") {
      const _id = url.searchParams.get("id") || "", _t = url.searchParams.get("t") || "";
      if (!_id || !_t || !env.VAULT_GRANTS) return new Response("Bad request", { status: 400, headers: cors });
      const _exp = await hmac(env.SESSION_SECRET || "", "reqdismiss." + _id);
      if (!timingSafeEqual(_t, _exp)) return new Response("Invalid or expired link", { status: 403, headers: cors });
      try { await env.VAULT_GRANTS.delete(_id); } catch (e) {}
      return new Response("Request dismissed \u2014 you can close this.", { status: 200, headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors) });
    }

    // ---------- one-tap "Allow" from the notification: auto-send the Full-access link (signed capability link) ----------
    if (url.pathname === "/req/allow") {
      const _id = url.searchParams.get("id") || "", _t = url.searchParams.get("t") || "";
      const _reply = (s) => new Response(s, { status: 200, headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors) });
      if (!_id || !_t || !env.VAULT_GRANTS) return new Response("Bad request", { status: 400, headers: cors });
      if (!timingSafeEqual(_t, await hmac(env.SESSION_SECRET || "", "reqallow." + _id))) return new Response("Invalid or expired link", { status: 403, headers: cors });
      const rec = await env.VAULT_GRANTS.get(_id, "json");
      if (!rec || !rec.email) return _reply("Already handled \u2014 nothing to send.");
      const qg = await env.VAULT_GRANTS.get("quickgrant:full", "json");
      if (!qg || !qg.code) return _reply("No Full-access quick-grant is set up yet. Open the studio, mark a special view as Full access, then tap Allow again.");
      if (qg.enabled === false) return _reply("One-tap Allow is turned off. Turn it back on in the studio, then tap Allow again.");
      if (qg.expiresAt && Date.now() > qg.expiresAt) return _reply("Your Full-access link has expired. Refresh it in the studio, then tap Allow again.");
      const who = String(rec.name || "there"), me = env.OWNER_EMAIL || "riteshkumarhk@gmail.com";
      const minted = await mintAccessLink(env, { email: rec.email, name: rec.name, company: rec.company, reqId: _id });
      const mail = fullAccessEmail(env, minted.link, who, 15);
      const sent = await sendEmail(env, { to: rec.email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: me, bcc: me });
      if (!sent.ok) return _reply("Couldn\u2019t send the email (" + (sent.status || "no email service") + "). Check the Resend setup, then tap Allow again.");
      try { await env.VAULT_GRANTS.delete(_id); } catch (e) {}
      return _reply("Sent full access to " + rec.email + ". \u2713");
    }

    // ---------- one-tap "Cancel" from the notification: email a polite decline (Reply-To you) + dismiss ----------
    if (url.pathname === "/req/cancel") {
      const _id = url.searchParams.get("id") || "", _t = url.searchParams.get("t") || "";
      const _reply = (s) => new Response(s, { status: 200, headers: Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, cors) });
      if (!_id || !_t || !env.VAULT_GRANTS) return new Response("Bad request", { status: 400, headers: cors });
      if (!timingSafeEqual(_t, await hmac(env.SESSION_SECRET || "", "reqcancel." + _id))) return new Response("Invalid or expired link", { status: 403, headers: cors });
      const rec = await env.VAULT_GRANTS.get(_id, "json");
      if (!rec || !rec.email) return _reply("Already handled.");
      const who = String(rec.name || "there"), me = env.OWNER_EMAIL || "riteshkumarhk@gmail.com";
      const html = "<p>Hi " + emailEsc(who) + ",</p><p>Thanks for reaching out about my work. I\u2019m not able to share access right now \u2014 feel free to reply here and we can talk.</p><p>\u2014 Ritesh Kumar</p>";
      const text = "Hi " + who + ",\n\nThanks for reaching out about my work. I'm not able to share access right now \u2014 feel free to reply here and we can talk.\n\n\u2014 Ritesh Kumar";
      const sent = await sendEmail(env, { to: rec.email, subject: "About your access request \u2014 Ritesh Kumar", html, text, replyTo: me });
      if (!sent.ok) return _reply("Couldn\u2019t send the note (" + (sent.status || "no email service") + "). Dismiss it in the studio instead, or check the Resend setup.");
      try { await env.VAULT_GRANTS.delete(_id); } catch (e) {}
      return _reply("Sent a cancellation note to " + rec.email + " (replies come to you). \u2713");
    }

    // ---------- public: a recruiter's unique ?k= link resolves to the current Full-access code ----------
    if (url.pathname === "/access/redeem") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Unavailable" }, 503, cors);
      let token = ""; try { const b = await request.json(); token = String((b && b.k) || "").trim(); } catch (e) {}
      if (!token) return json({ error: "Missing link", reason: "empty" }, 400, cors);
      const acc = await env.VAULT_GRANTS.get("access:" + token, "json");
      if (!acc) return json({ error: "This link isn\u2019t valid.", reason: "invalid" }, 403, cors);
      if (acc.revoked) return json({ error: "This link was turned off.", reason: "revoked" }, 403, cors);
      if (acc.expiresAt && Date.now() > acc.expiresAt) return json({ error: "This link has expired.", reason: "expired" }, 403, cors);
      const qg = await env.VAULT_GRANTS.get("quickgrant:full", "json");
      if (!qg || !qg.code) return json({ error: "Access isn\u2019t set up right now.", reason: "noquickgrant" }, 503, cors);
      try { acc.uses = (acc.uses || 0) + 1; acc.lastUsedAt = Date.now(); await env.VAULT_GRANTS.put("access:" + token, JSON.stringify(acc), acc.expiresAt ? { expiration: Math.floor(acc.expiresAt / 1000) } : undefined); } catch (e) {}
      // Per-request vault grant: mint THIS link its own grant, scoped to its works with the CURRENT
      // keys (cached at publish). Each recruiter is isolated + always fresh — no shared "Adobe" grant.
      // Refreshed on every redeem, so it self-heals after any re-publish. (Client falls back to the
      // shared quick-grant code when this is absent — e.g. before the first publish that seeds the cache.)
      let vaultGrant = null;
      try {
        const keyset = {};
        const wantIds = (acc.mode === "curated" && Array.isArray(acc.workIds) && acc.workIds.length) ? acc.workIds : null;
        if (wantIds) {
          for (const wid of wantIds) { const ks = await env.VAULT_GRANTS.get("vaultkeys:" + wid, "json"); if (Array.isArray(ks)) ks.forEach((k) => { keyset[k] = 1; }); }
        } else {
          const l = await env.VAULT_GRANTS.list({ prefix: "vaultkeys:" });
          for (const kk of l.keys) { const ks = await env.VAULT_GRANTS.get(kk.name, "json"); if (Array.isArray(ks)) ks.forEach((x) => { keyset[x] = 1; }); }
        }
        const keys = Object.keys(keyset);
        if (keys.length) {
          const gexp = (acc.expiresAt && acc.expiresAt > Date.now()) ? acc.expiresAt : (Date.now() + GRANT_REDEEM_TTL_MS);
          const gid = await hmac(env.SESSION_SECRET || "", "agrant:" + token);
          await env.VAULT_GRANTS.put("g:" + gid, JSON.stringify({ keys: keys, exp: gexp }), { expiration: Math.floor(gexp / 1000) });
          const gpayload = b64urlFromStr(JSON.stringify({ g: gid, exp: gexp }));
          const gsig = await hmac(env.SESSION_SECRET || "", gpayload);
          vaultGrant = { token: gpayload + "." + gsig, exp: gexp };
        }
      } catch (e) {}
      return json({ ok: true, code: qg.code, vaultGrant: vaultGrant, mode: acc.mode || "all", workIds: acc.workIds || null, highlightIdx: acc.highlightIdx || null, capabilityIdx: acc.capabilityIdx || null, name: acc.name || "", audience: acc.company || "" }, 200, cors);
    }

    // ---------- owner Present mode: the recovery passphrase is the true master key ----------
    // Prove the recovery passphrase (its domain-separated hash, same proof used for recovery/step-up)
    // and receive a READ-ONLY grant over EVERY vault key, so the owner can open all deeper cuts to
    // present. No admin session, no editing -- vault reads only. Rate-limited by IP.
    if (url.pathname === "/vault/owner-grant") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Unavailable" }, 503, cors);
      const rlKey = "rl:ownergrant:" + (request.headers.get("CF-Connecting-IP") || "0");
      const tries = parseInt((await env.VAULT_GRANTS.get(rlKey)) || "0", 10) || 0;
      if (tries >= 12) return json({ error: "Too many attempts -- try again later." }, 429, cors);
      try {
        const b = await request.json();
        const stored = await env.VAULT_GRANTS.get("cfg:publishproof");
        const proof = (b && b.proof) || "";
        const proofHash = proof ? bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof))) : "";
        if (!stored || !timingSafeEqual(proofHash, stored)) {
          await env.VAULT_GRANTS.put(rlKey, String(tries + 1), { expirationTtl: 900 });
          return json({ error: "That recovery passphrase did not match.", reason: "pass" }, 401, cors);
        }
        await env.VAULT_GRANTS.delete(rlKey);
        // Union of every work's vault keys -- Present mode unlocks all of them.
        const keyset = {};
        const l = await env.VAULT_GRANTS.list({ prefix: "vaultkeys:" });
        for (const kk of l.keys) { const ks = await env.VAULT_GRANTS.get(kk.name, "json"); if (Array.isArray(ks)) ks.forEach((x) => { keyset[x] = 1; }); }
        const keys = Object.keys(keyset);
        const gexp = Date.now() + GRANT_REDEEM_TTL_MS;
        const gid = await hmac(env.SESSION_SECRET || "", "ownergrant:" + gexp + ":" + keys.length);
        await env.VAULT_GRANTS.put("g:" + gid, JSON.stringify({ keys: keys, exp: gexp }), { expiration: Math.floor(gexp / 1000) });
        const gpayload = b64urlFromStr(JSON.stringify({ g: gid, exp: gexp }));
        const gsig = await hmac(env.SESSION_SECRET || "", gpayload);
        return json({ ok: true, vaultGrant: { token: gpayload + "." + gsig, exp: gexp } }, 200, cors);
      } catch (e) { return json({ error: "Owner grant failed" }, 400, cors); }
    }

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
      // Enrolling a passkey needs this device TRUSTED (a prior step-up) — except the very first passkey
      // ever (bootstrap from the initial session). Enrolment is owner-session-only (there is NO phone
      // pairing path): add new devices from the authenticated desktop studio, incl. a phone via the
      // browser's cross-device passkey flow. Stops anyone minting a credential (= authority) off a link.
      const _rc = await env.VAULT_GRANTS.list({ prefix: "wa:cred:" });
      if (_rc.keys.length > 0 && !(await verifyTrust(request.headers.get("X-Device-Trust"), env))) return json({ error: "Verify it\u2019s you to add a passkey on this device.", needStepup: true }, 403, cors);
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
        // A passkey assertion is strong proof of possession — trust this device (same as passing the
        // recovery+password step-up), so publishing needs no further verification here.
        const _sess = await issueSession(env), _trust = await issueTrust(env);
        return json({ token: _sess.token, exp: _sess.exp, trust: _trust.trust, trustExp: _trust.exp }, 200, cors);
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
      return json({ passwordless: (await env.VAULT_GRANTS.get("cfg:passwordless")) === "1", hasRecovery: !!(await env.VAULT_GRANTS.get("cfg:publishproof")), passkeys: l.keys.length, hasAdminPass: !!env.ADMIN_HASH }, 200, cors);
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
        // Baked in: the break-glass is 2-factor whenever an admin password exists (no toggle to forget).
        const need2fa = !!env.ADMIN_HASH;
        const passOk = !need2fa || (await verifyAdminPassword(String((b && b.password) || ""), env));
        if (!stored || !timingSafeEqual(proofHash, stored) || !passOk) {
          await env.VAULT_GRANTS.put(rlKey, String(tries + 1), { expirationTtl: 900 });
          return json({ error: need2fa ? "That recovery passphrase or admin password didn\u2019t match." : "That recovery passphrase didn\u2019t match." }, 401, cors);
        }
        await env.VAULT_GRANTS.delete(rlKey);
        return json(await issueSession(env), 200, cors);
      } catch (e) { return json({ error: "Recovery failed" }, 400, cors); }
    }
    // Device-trust step-up: verify the recovery passphrase (+ admin password when one exists) to mark
    // THIS device trusted so it may enrol a passkey or publish. Session-gated; rate-limited by IP.
    if (url.pathname === "/admin/stepup") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Unavailable" }, 500, cors);
      const rlKey = "rl:stepup:" + (request.headers.get("CF-Connecting-IP") || "0");
      const tries = parseInt((await env.VAULT_GRANTS.get(rlKey)) || "0", 10) || 0;
      if (tries >= 6) return json({ error: "Too many attempts \u2014 try again later." }, 429, cors);
      try {
        const b = await request.json();
        const stored = await env.VAULT_GRANTS.get("cfg:publishproof");
        const proof = (b && b.proof) || "";
        const proofHash = proof ? bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof))) : "";
        const proofOk = stored && timingSafeEqual(proofHash, stored);
        const needPass = !!env.ADMIN_HASH;
        const passOk = !needPass || (await verifyAdminPassword(String((b && b.password) || ""), env));
        if (!proofOk || !passOk) {
          await env.VAULT_GRANTS.put(rlKey, String(tries + 1), { expirationTtl: 900 });
          return json({ error: needPass ? "That recovery passphrase or admin password didn\u2019t match." : "That recovery passphrase didn\u2019t match." }, 401, cors);
        }
        await env.VAULT_GRANTS.delete(rlKey);
        return json(await issueTrust(env), 200, cors);
      } catch (e) { return json({ error: "Step-up failed" }, 400, cors); }
    }
    // Owner's request inbox: the access requests visitors have sent (session-gated). Newest first.
    if (url.pathname === "/admin/requests") {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ requests: [] }, 200, cors);
      try {
        const want = url.searchParams.get("status") || "pending";   // pending (default) | declined | all
        const l = await env.VAULT_GRANTS.list({ prefix: "req:" });
        const out = [];
        for (const k of l.keys) {
          const v = await env.VAULT_GRANTS.get(k.name, "json"); if (!v) continue;
          const st = v.status || "pending";
          if (want === "declined") { if (st !== "declined") continue; }
          else if (want !== "all") { if (st === "declined") continue; }   // default: hide the declined archive
          out.push(Object.assign({ id: k.name }, v));
        }
        out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
        return json({ requests: out.slice(0, 80) }, 200, cors);
      } catch (e) { return json({ requests: [] }, 200, cors); }
    }
    // Owner dismisses a request from the studio inbox (session-gated).
    if (url.pathname === "/admin/requests/delete") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ ok: true }, 200, cors);
      try { const b = await request.json(); if (b && b.id) await env.VAULT_GRANTS.delete(String(b.id)); } catch (e) {}
      return json({ ok: true }, 200, cors);
    }
    // Owner ALLOWS a request from the passkey-gated inbox PWA (session-gated) — mirrors /req/allow but
    // authorized by the owner session instead of a signed URL token. Emails the Full-access link.
    if (url.pathname === "/admin/requests/allow") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      try {
        const b = await request.json(); const _id = String((b && b.id) || "");
        if (!_id) return json({ error: "Missing id" }, 400, cors);
        const rec = await env.VAULT_GRANTS.get(_id, "json");
        if (!rec || !rec.email) return json({ ok: true, note: "already handled" }, 200, cors);
        const qg = await env.VAULT_GRANTS.get("quickgrant:full", "json");
        if (!qg || !qg.code) return json({ error: "No Full-access quick-grant is set up yet \u2014 mark a special view as Full access in the studio first." }, 400, cors);
        if (qg.expiresAt && Date.now() > qg.expiresAt) return json({ error: "Your Full-access link has expired \u2014 refresh it in the studio." }, 400, cors);
        const who = String(rec.name || "there"), me = env.OWNER_EMAIL || "riteshkumarhk@gmail.com";
        const minted = await mintAccessLink(env, { email: rec.email, name: rec.name, company: rec.company, reqId: _id });
        const mail = fullAccessEmail(env, minted.link, who, 15);
        const sent = await sendEmail(env, { to: rec.email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: me, bcc: me });
        if (!sent.ok) return json({ error: "Couldn\u2019t send the email (" + (sent.status || "no email service") + ")." }, 502, cors);
        try { await env.VAULT_GRANTS.delete(_id); } catch (e) {}
        return json({ ok: true, sentTo: rec.email }, 200, cors);
      } catch (e) { return json({ error: "Allow failed" }, 400, cors); }
    }
    // Owner DECLINES a request from the inbox PWA (session-gated) — mirrors /req/cancel. Polite email (Reply-To=you).
    if (url.pathname === "/admin/requests/decline") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      try {
        const b = await request.json(); const _id = String((b && b.id) || "");
        if (!_id) return json({ error: "Missing id" }, 400, cors);
        const rec = await env.VAULT_GRANTS.get(_id, "json");
        if (!rec || !rec.email) return json({ ok: true, note: "already handled" }, 200, cors);
        const who = String(rec.name || "there"), me = env.OWNER_EMAIL || "riteshkumarhk@gmail.com";
        const html = "<p>Hi " + emailEsc(who) + ",</p><p>Thanks for reaching out about my work. I\u2019m not able to share access right now \u2014 feel free to reply here and we can talk.</p><p>\u2014 Ritesh Kumar</p>";
        const text = "Hi " + who + ",\n\nThanks for reaching out about my work. I'm not able to share access right now \u2014 feel free to reply here and we can talk.\n\n\u2014 Ritesh Kumar";
        const sent = await sendEmail(env, { to: rec.email, subject: "About your access request \u2014 Ritesh Kumar", html, text, replyTo: me });
        if (!sent.ok) return json({ error: "Couldn\u2019t send the note (" + (sent.status || "no email service") + ")." }, 502, cors);
        rec.status = "declined"; rec.declinedAt = new Date().toISOString();   // keep as an archive (Requests tab "Show declined"), not delete
        try { await env.VAULT_GRANTS.put(_id, JSON.stringify(rec), { expirationTtl: 365 * 24 * 3600 }); } catch (e) {}
        return json({ ok: true, sentTo: rec.email, declined: true }, 200, cors);
      } catch (e) { return json({ error: "Decline failed" }, 400, cors); }
    }
    // Owner CURATES a request (session-gated): mint a curated grant (subset of works + optional custom phrase + duration) + email + move to Curated.
    if (url.pathname === "/admin/requests/curate") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      try {
        const b = await request.json(); const _id = String((b && b.id) || "");
        if (!_id) return json({ error: "Missing id" }, 400, cors);
        const rec = await env.VAULT_GRANTS.get(_id, "json");
        if (!rec || !rec.email) return json({ ok: true, note: "already handled" }, 200, cors);
        const workIds = Array.isArray(b.workIds) ? b.workIds.map(String).filter(Boolean) : null;
        const highlightIdx = Array.isArray(b.highlightIdx) ? b.highlightIdx : null;
        const capabilityIdx = Array.isArray(b.capabilityIdx) ? b.capabilityIdx : null;
        const days = parseInt(b.days, 10) > 0 ? Math.min(parseInt(b.days, 10), 365) : 15;
        const phrase = String((b && b.phrase) || "").trim() || null;
        const who = String(rec.name || "there"), me = env.OWNER_EMAIL || "riteshkumarhk@gmail.com";
        const minted = await mintAccessLink(env, { email: rec.email, name: rec.name, company: rec.company, reqId: _id, mode: "curated", workIds: workIds, highlightIdx: highlightIdx, capabilityIdx: capabilityIdx, phrase: phrase, status: "curated", days: days });
        const mail = fullAccessEmail(env, minted.link, who, days);
        const sent = await sendEmail(env, { to: rec.email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: me, bcc: me });
        if (!sent.ok) return json({ error: "Couldn\u2019t send the email (" + (sent.status || "no email service") + ")." }, 502, cors);
        try { await env.VAULT_GRANTS.delete(_id); } catch (e) {}
        return json({ ok: true, sentTo: rec.email, token: minted.token, link: minted.link }, 200, cors);
      } catch (e) { return json({ error: "Curate failed" }, 400, cors); }
    }
    // ---------- admin: list / revoke / delete the per-recruiter access links (session-gated) ----------
    if (url.pathname === "/admin/access") {
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ grants: [] }, 200, cors);
      if (request.method === "GET") {
        const out = [];
        try { const l = await env.VAULT_GRANTS.list({ prefix: "access:" }); for (const k of l.keys) { const v = await env.VAULT_GRANTS.get(k.name, "json"); if (v) out.push(Object.assign({ token: k.name.slice(7) }, v)); } } catch (e) {}
        out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return json({ grants: out }, 200, cors);
      }
      if (request.method === "POST") {
        try {
          const b = await request.json(); const t = String((b && b.token) || "");
          if (!t) return json({ error: "Missing token" }, 400, cors);
          if (b.delete) { await env.VAULT_GRANTS.delete("access:" + t); return json({ ok: true, deleted: true }, 200, cors); }
          const acc = await env.VAULT_GRANTS.get("access:" + t, "json");
          if (!acc) return json({ ok: true, note: "gone" }, 200, cors);
          if (typeof b.revoke === "boolean") acc.revoked = b.revoke;
          if (b.days && parseInt(b.days, 10) > 0) { const d = Math.min(parseInt(b.days, 10), 365); acc.days = d; acc.expiresAt = (acc.createdAt || Date.now()) + d * 86400000; }
          await env.VAULT_GRANTS.put("access:" + t, JSON.stringify(acc), acc.expiresAt ? { expiration: Math.floor(acc.expiresAt / 1000) } : undefined);
          return json({ ok: true, revoked: acc.revoked, expiresAt: acc.expiresAt, days: acc.days }, 200, cors);
        } catch (e) { return json({ error: "Failed" }, 400, cors); }
      }
      return json({ error: "Method not allowed" }, 405, cors);
    }
    // ---------- inbox PWA: register/replace THIS device's Web Push subscription (session-gated) ----------
    if (url.pathname === "/inbox/subscribe") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      try {
        const b = await request.json();
        const s = (b && b.subscription) || b || {};
        const endpoint = String(s.endpoint || ""), keys = s.keys || {};
        if (!/^https:\/\//i.test(endpoint) || !keys.p256dh || !keys.auth) return json({ error: "Bad subscription" }, 400, cors);
        const id = "push:" + bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))).slice(0, 32);
        await env.VAULT_GRANTS.put(id, JSON.stringify({ endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth), at: Date.now() }));
        return json({ ok: true }, 200, cors);
      } catch (e) { return json({ error: "Subscribe failed" }, 400, cors); }
    }
    // ---------- inbox PWA: remove THIS device's subscription (session-gated) ----------
    if (url.pathname === "/inbox/unsubscribe") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ ok: true }, 200, cors);
      try { const b = await request.json(); const ep = String((b && b.endpoint) || ""); if (ep) await env.VAULT_GRANTS.delete("push:" + bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ep))).slice(0, 32)); } catch (e) {}
      return json({ ok: true }, 200, cors);
    }
    // ---------- inbox PWA: fire a test push to all this owner's devices (session-gated) ----------
    if (url.pathname === "/inbox/test") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAPID_PRIVATE) return json({ error: "Push isn\u2019t configured on the server yet." }, 503, cors);
      let n = 0; try { const l = await env.VAULT_GRANTS.list({ prefix: "push:" }); n = l.keys.length; } catch (e) {}
      if (!n) return json({ error: "No devices are subscribed yet \u2014 enable notifications first." }, 400, cors);
      await pushToAll(env, { title: "Test notification", body: "Push is working \u2014 you\u2019ll be pinged on new requests.", tag: "rk-test", url: "/inbox/" });
      return json({ ok: true, devices: n }, 200, cors);
    }
    // Owner's private ticket keyring: an opaque recovery-encrypted blob {svId:code}, stored server-side
    // (cross-device). The Worker never sees the codes — only the ciphertext.
    if (url.pathname === "/admin/keyring") {
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      if (request.method === "GET") return json((await env.VAULT_GRANTS.get("cfg:keyring", "json")) || {}, 200, cors);
      if (request.method === "PUT") { try { const b = await request.json(); await env.VAULT_GRANTS.put("cfg:keyring", JSON.stringify(b || {})); return json({ ok: true }, 200, cors); } catch (e) { return json({ error: "Save failed" }, 400, cors); } }
      return json({ error: "Method not allowed" }, 405, cors);
    }
    // ---------- admin: the "Full access" quick-grant the notification's Allow button emails (session-gated) ----------
    // The ONE deliberate exception to zero-knowledge: the owner uploads a full-access code here so the
    // Worker can email it on one tap. Rotatable, timeboxable, revocable (POST {revoke:true}). Curated
    // special-view codes never live here — they stay in the recovery-encrypted keyring.
    if (url.pathname === "/admin/quickgrant") {
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      if (request.method === "GET") return json((await env.VAULT_GRANTS.get("quickgrant:full", "json")) || {}, 200, cors);
      if (request.method === "POST") {
        try {
          const b = await request.json();
          if (b && b.revoke) { await env.VAULT_GRANTS.delete("quickgrant:full"); return json({ ok: true, revoked: true }, 200, cors); }
          // On/off toggle without touching the code: keeps already-minted recruiter links resolving
          // (redeem only needs the code to exist) while /req/allow refuses NEW mints when disabled.
          if (b && (b.code == null || b.code === "") && typeof b.enabled === "boolean") {
            const cur = (await env.VAULT_GRANTS.get("quickgrant:full", "json")) || null;
            if (!cur || !cur.code) return json({ error: "Set up the Full-access code first." }, 400, cors);
            cur.enabled = b.enabled; cur.updatedAt = Date.now();
            await env.VAULT_GRANTS.put("quickgrant:full", JSON.stringify(cur));
            return json({ ok: true, enabled: cur.enabled, updatedAt: cur.updatedAt }, 200, cors);
          }
          const code = String((b && b.code) || "").trim();
          if (!code) return json({ error: "Add the Full-access code first." }, 400, cors);
          const rec = { code, expiresAt: Number((b && b.expiresAt) || 0) || 0, enabled: (b && b.enabled === false) ? false : true, updatedAt: Date.now() };
          await env.VAULT_GRANTS.put("quickgrant:full", JSON.stringify(rec));
          return json({ ok: true, expiresAt: rec.expiresAt, enabled: rec.enabled, updatedAt: rec.updatedAt }, 200, cors);
        } catch (e) { return json({ error: "Save failed" }, 400, cors); }
      }
      return json({ error: "Method not allowed" }, 405, cors);
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
      // Device-trust: a repo WRITE requires this device to have passed a step-up (recovery passphrase +
      // admin password) at least once — so a phone-only sign-in on a strange device can't publish.
      if (env.VAULT_GRANTS && ghMethod !== "GET" && ghMethod !== "HEAD" && !(await verifyTrust(request.headers.get("X-Device-Trust"), env))) {
        return json({ error: "This device isn\u2019t verified to publish yet.", needStepup: true }, 403, cors);
      }
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
      // Self-heal the pass's key-set from the current per-work caches on every redeem, so a pass minted
      // before a re-vault/flatten still covers today's content + inner media — the same robustness the
      // ?k= link already has via /access/redeem. (Union of all vault works; per-view scoping is a future
      // hardening — currently only recruiter works have vault content.)
      try {
        const _ks = {};
        (Array.isArray(rec.keys) ? rec.keys : []).forEach((k) => { _ks[k] = 1; });
        const _l = await env.VAULT_GRANTS.list({ prefix: "vaultkeys:" });
        for (const _kk of _l.keys) { const _arr = await env.VAULT_GRANTS.get(_kk.name, "json"); if (Array.isArray(_arr)) _arr.forEach((x) => { _ks[x] = 1; }); }
        const _keys = Object.keys(_ks);
        if (_keys.length && _keys.length !== (rec.keys || []).length) { rec.keys = _keys; await env.VAULT_GRANTS.put("g:" + gid, JSON.stringify(rec), { expiration: Math.floor(rec.exp / 1000) }); }
      } catch (e) {}
      const exp = Math.min(Date.now() + GRANT_REDEEM_TTL_MS, rec.exp);
      const payload = b64urlFromStr(JSON.stringify({ g: gid, exp: exp }));
      const sig = await hmac(env.SESSION_SECRET || "", payload);
      return json({ token: payload + "." + sig, exp: exp }, 200, cors);
    }

    // Publish seeds this: the current vault key-set per work, so /access/redeem can mint a per-link
    // grant with up-to-date keys (owner-session gated). Unions with prior sets (never replaces) so a
    // recruiter link keeps working across re-publishes and GitHub Pages CDN lag.
    if (url.pathname === "/admin/vault/keycache") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
      if (!(await verifySession(bearer(request.headers.get("Authorization")), env))) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.VAULT_GRANTS) return json({ error: "Store not configured" }, 500, cors);
      let kbody; try { kbody = await request.json(); } catch (e) { kbody = null; }
      const kmap = kbody && kbody.map && typeof kbody.map === "object" ? kbody.map : null;
      if (!kmap) return json({ error: "Bad map" }, 400, cors);
      let kn = 0;
      for (const wid of Object.keys(kmap)) {
        if (!/^[a-z0-9_]+$/i.test(wid)) continue;
        const incoming = Array.isArray(kmap[wid]) ? kmap[wid].filter((k) => typeof k === "string" && k && k.indexOf("/") === -1) : [];
        // Accumulate keys across publishes (union, newest last) instead of replacing. R2 objects are
        // content-addressed and never deleted, so a grant covering every historical key lets ANY
        // content.json version resolve — a stale copy on a laggy CDN edge OR the freshly-published one.
        // This removes the publish/propagation key-skew that intermittently locked recruiter links.
        let prior = [];
        try { const p = await env.VAULT_GRANTS.get("vaultkeys:" + wid, "json"); if (Array.isArray(p)) prior = p; } catch (e) {}
        const seen = {}, merged = [];
        for (const k of prior.concat(incoming)) { if (typeof k === "string" && k && !seen[k]) { seen[k] = 1; merged.push(k); } }
        const capped = merged.slice(-500);
        try { await env.VAULT_GRANTS.put("vaultkeys:" + wid, JSON.stringify(capped)); kn++; } catch (e) {}
      }
      return json({ ok: true, count: kn }, 200, cors);
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
    "Access-Control-Allow-Headers": "Authorization,Content-Type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,Accept,X-GitHub-Api-Version,X-Vault-Grant,X-Publish-Token,X-Publish-Proof,X-Device-Trust",
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
function emailEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Best-effort transactional email via Resend. Returns {ok,status,detail} and NEVER throws — it
// degrades to ok:false when RESEND_API_KEY / a verified sender domain isn't configured yet, so the
// one-tap Allow/Cancel report a clear "not set up" message instead of failing hard.
// Owner-facing "new request" email -- the reliable fallback for the PWA push (Gmail is never Doze-
// throttled). Notification only: request details + a button into the passkey-gated inbox to act.
function reqOwnerEmail(o) {
  const e = emailEsc;
  const line = o.company ? (e(o.company) + (o.context ? " \u00b7 " + e(o.context) : "")) : (o.context ? e(o.context) : "");
  const html =
    '<div style="background:#08080a;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#111116;border:1px solid #23232a;border-radius:16px;padding:26px">' +
    '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8f8a84;margin-bottom:10px">New access request</div>' +
    '<div style="font-size:21px;font-weight:700;color:#ECE7E1">' + e(o.name) + '</div>' +
    (line ? '<div style="color:#8f8a84;font-size:14px;margin-top:2px">' + line + '</div>' : '') +
    '<div style="margin-top:6px"><a href="mailto:' + e(o.email) + '" style="color:#D8A657;font-size:14px;text-decoration:none">' + e(o.email) + '</a></div>' +
    (o.note ? '<div style="margin-top:14px;color:#ECE7E1;font-size:14px;font-style:italic;opacity:.9;border-left:2px solid #23232a;padding-left:12px">' + e(o.note) + '</div>' : '') +
    '<div style="margin-top:22px"><a href="' + o.inbox + '" style="display:inline-block;background:#D8A657;color:#0a0a0a;font-weight:700;font-size:15px;padding:13px 22px;border-radius:10px;text-decoration:none">Open inbox to review</a></div>' +
    '<div style="margin-top:14px;font-size:12px;color:#5a5650;line-height:1.5">Approve or decline securely in your passkey-protected inbox. Reply to this email to reach ' + e(o.name) + ' directly.</div>' +
    '</div></div>';
  const text = "New access request\n" + o.name + (o.company ? " \u00b7 " + o.company : "") + "\n" + o.email + (o.note ? "\n\n\"" + o.note + "\"" : "") + "\n\nReview: " + o.inbox;
  return { html: html, text: text };
}

// Verify a Cloudflare Turnstile token server-side. Returns true only on a confirmed human. Never
// throws — a network error returns false (fail-closed), so a retry (guarded by the rate limit) is the
// path forward and bots can't slip through on an exception.
async function verifyTurnstile(secret, token, ip) {
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip && ip !== "0") form.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j = await r.json();
    return !!(j && j.success);
  } catch (e) { return false; }
}

async function sendEmail(env, msg) {
  if (!env.RESEND_API_KEY) return { ok: false, status: 0, detail: "no-api-key" };
  const from = env.EMAIL_FROM || "Ritesh Kumar <ritesh@riteshk.work>";
  const body = { from, to: [msg.to], subject: msg.subject, html: msg.html };
  if (msg.text) body.text = msg.text;
  if (msg.replyTo) body.reply_to = msg.replyTo;
  if (msg.bcc) body.bcc = Array.isArray(msg.bcc) ? msg.bcc : [msg.bcc];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let detail = ""; try { detail = await r.text(); } catch (e) {}
    return { ok: r.ok, status: r.status, detail: String(detail).slice(0, 300) };
  } catch (e) { return { ok: false, status: 0, detail: String((e && e.message) || e) }; }
}

// Recruiter access links: a unique, revocable, trackable token per approval. The shared decryption
// code never travels in the email — the link resolves to it server-side via /access/redeem, so a
// forwarded email can be revoked and each recruiter's use is tracked. Expires after ACCESS_TTL_MS.
const ACCESS_TTL_MS = 15 * 24 * 60 * 60 * 1000; // per-recruiter access link lifetime — 15 days
async function mintAccessLink(env, rec) {
  const token = b64urlFromBytes(crypto.getRandomValues(new Uint8Array(18))); // 144-bit opaque token
  const now = Date.now();
  const days = (rec.days && rec.days > 0) ? Math.min(rec.days, 365) : Math.round(ACCESS_TTL_MS / 86400000);
  const exp = now + days * 86400000;
  const entry = { email: rec.email, name: rec.name || "", company: rec.company || "", reqId: rec.reqId || "", mode: rec.mode || "all", workIds: rec.workIds || null, highlightIdx: rec.highlightIdx || null, capabilityIdx: rec.capabilityIdx || null, phrase: rec.phrase || null, status: rec.status || "approved", days: days, createdAt: now, expiresAt: exp, revoked: false, uses: 0, lastUsedAt: 0 };
  await env.VAULT_GRANTS.put("access:" + token, JSON.stringify(entry), { expiration: Math.floor(exp / 1000) });
  return { token, link: "https://riteshk.work/?k=" + token, expiresAt: exp };
}
// The personal, Primary-leaning access email: a plain visible link (no promo-looking button), the
// N-day validity, and a warm "need more time?" line (reply / call / LinkedIn).
function fullAccessEmail(env, link, who, days) {
  const phone = env.OWNER_PHONE || "+91 81978 09767";
  const li = env.OWNER_LINKEDIN || "https://www.linkedin.com/in/riteshkumarhk";
  const named = !!(who && who !== "there");
  const name = emailEsc(who || "there");
  const html = "<p>Hi " + name + ",</p>"
    + "<p>Thanks for reaching out \u2014 happy to share my work. Here\u2019s your private link:</p>"
    + "<p><a href=\"" + link + "\">" + link + "</a></p>"
    + "<p>It\u2019ll stay live for about <b>" + days + " days</b>. If you need a bit longer, just reply to this note \u2014 or reach me on " + emailEsc(phone) + " or <a href=\"" + li + "\">LinkedIn</a>.</p>"
    + "<p>Best,<br>Ritesh</p>";
  const text = "Hi " + (who || "there") + ",\n\n"
    + "Thanks for reaching out \u2014 happy to share my work. Here's your private link:\n" + link + "\n\n"
    + "It'll stay live for about " + days + " days. If you need a bit longer, just reply to this note \u2014 or reach me on " + phone + " or LinkedIn: " + li + "\n\n"
    + "Best,\nRitesh";
  return { subject: "Here\u2019s my work" + (named ? ", " + who : ""), html, text };
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
// Device-trust token: a long-lived, HMAC-signed marker that THIS device passed a 2-factor step-up.
// Domain-separated from sessions ("trust." prefix in the MAC) so one can never be used as the other.
async function issueTrust(env) {
  const exp = Date.now() + TRUST_TTL_MS;
  const payload = b64urlFromStr(JSON.stringify({ t: "trust", exp }));
  const sig = await hmac(env.SESSION_SECRET || "", "trust." + payload);
  return { trust: payload + "." + sig, exp };
}
async function verifyTrust(token, env) {
  if (!token || !env.SESSION_SECRET) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = await hmac(env.SESSION_SECRET, "trust." + payload);
  if (!timingSafeEqual(sig, expect)) return false;
  try {
    const obj = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return !!(obj && obj.t === "trust" && obj.exp && obj.exp > Date.now());
  } catch (e) { return false; }
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

/* ---------- Web Push (RFC 8291 aes128gcm payload + RFC 8292 VAPID) ---------- */
function pushConcat() { let n = 0; for (let i = 0; i < arguments.length; i++) n += arguments[i].length; const out = new Uint8Array(n); let o = 0; for (let i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; } return out; }
async function hmacRaw(keyBytes, dataBytes) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, dataBytes));
}
// HKDF-Expand with a single output block (len <= 32) using the given salt as the HMAC key.
async function hkdf1(salt, ikm, info, len) {
  const prk = await hmacRaw(salt, ikm);
  const out = await hmacRaw(prk, pushConcat(info, new Uint8Array([1])));
  return out.slice(0, len);
}
// Encrypt a payload for one Web Push subscription (aes128gcm content-coding, RFC 8188 + RFC 8291).
async function encryptPush(payloadBytes, p256dhB64, authB64) {
  const uaPub = b64urlToBytes(p256dhB64);       // subscriber public key, 65-byte uncompressed
  const authSecret = b64urlToBytes(authB64);    // 16-byte auth secret
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey)); // 65 bytes
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));
  const enc = new TextEncoder();
  const prkKey = await hmacRaw(authSecret, ecdh);
  const keyInfo = pushConcat(enc.encode("WebPush: info\0"), uaPub, asPub);
  const ikm = (await hmacRaw(prkKey, pushConcat(keyInfo, new Uint8Array([1])))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf1(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf1(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plaintext = pushConcat(payloadBytes, new Uint8Array([2])); // 0x02 = last-record padding delimiter
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));
  const header = new Uint8Array(16 + 4 + 1 + asPub.length);       // salt | rs(4) | idlen(1) | keyid
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);         // record size
  header[20] = asPub.length;                                       // 65
  header.set(asPub, 21);
  return pushConcat(header, ct);
}
// Build a VAPID JWT (ES256) for a given audience (the push endpoint's origin).
async function vapidJwt(env, audience) {
  const header = b64urlFromStr(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64urlFromStr(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:" + (env.OWNER_EMAIL || "riteshkumarhk@gmail.com") }));
  const signingInput = header + "." + payload;
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)));
  return signingInput + "." + b64urlFromBytes(sig); // WebCrypto ECDSA already returns raw r||s (JWS format)
}
// Send one encrypted push. Returns the push service's HTTP status (or 0 on a thrown error).
async function sendOnePush(env, sub, payloadObj) {
  const audience = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(env, audience);
  const body = await encryptPush(new TextEncoder().encode(JSON.stringify(payloadObj)), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high", "Authorization": "vapid t=" + jwt + ", k=" + VAPID_PUBLIC },
    body,
  });
  return r.status;
}
// Fan out a push to every stored inbox subscription; prune subscriptions the push service reports gone.
async function pushToAll(env, payloadObj) {
  if (!env.VAULT_GRANTS || !env.VAPID_PRIVATE) return;
  let list; try { list = await env.VAULT_GRANTS.list({ prefix: "push:" }); } catch (e) { return; }
  for (const k of list.keys) {
    const sub = await env.VAULT_GRANTS.get(k.name, "json");
    if (!sub || !sub.endpoint) continue;
    try { const st = await sendOnePush(env, sub, payloadObj); if (st === 404 || st === 410) { try { await env.VAULT_GRANTS.delete(k.name); } catch (e) {} } } catch (e) {}
  }
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
