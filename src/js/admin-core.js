/* =================================================================
   ADMIN CORE — shared, stateless helpers used by both the admin shell
   and the (lazily-loaded) studio: JSON clone, HTML escaping, and the
   crypto envelope (SHA-256, PBKDF2 key-wrapping / AES-GCM for locked
   sections, and the salted admin-gate hash). No DOM, no module state —
   pure functions only, safe to import anywhere.
   ================================================================= */

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const escHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");

/* ---------- admin backend (Cloudflare Worker): session login + GitHub proxy ----------
   The studio logs in with the admin key to get a short signed session, then publishes
   through the Worker so the GitHub token never has to live in the browser. If the Worker
   isn't reachable, callers fall back to the existing local gate + repo token. */
export const ADMIN_WORKER = "https://rk-ai-proxy.riteshkumarhk.workers.dev"; // your Cloudflare Worker URL
export const ADMIN_SESSION_KEY = "rk:admin:sess";
export function adminSession() {
  try {
    const s = JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || "null");
    if (s && s.token && s.exp && s.exp > Date.now()) return s.token;
  } catch (e) {}
  return "";
}
export function saveAdminSession(token, exp) {
  try { localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ token, exp })); } catch (e) {}
}
export function clearAdminSession() { try { localStorage.removeItem(ADMIN_SESSION_KEY); } catch (e) {} }
// ---------- device-trust: this browser/device passed a 2-factor step-up (recovery passphrase + admin
// password), so it may enrol a passkey or publish. The token is HMAC-signed by the Worker (unspoofable);
// a fresh device (e.g. signed in via your phone) has none until it steps up. ----------
export const TRUST_KEY = "rk:trust";
export function deviceTrust() {
  try { const s = JSON.parse(localStorage.getItem(TRUST_KEY) || "null"); if (s && s.token && s.exp && s.exp > Date.now()) return s.token; } catch (e) {}
  return "";
}
export function deviceTrusted() { return !!deviceTrust(); }
export function saveDeviceTrust(token, exp) { try { localStorage.setItem(TRUST_KEY, JSON.stringify({ token: token, exp: exp })); } catch (e) {} }
export function clearDeviceTrust() { try { localStorage.removeItem(TRUST_KEY); } catch (e) {} }
// Verify the recovery passphrase (+ admin password when one is set) to trust THIS device; stores the token.
export async function stepUp(recovery, password) {
  const sess = adminSession(); if (!sess) { const e = new Error("Sign in first."); e.auth = true; throw e; }
  const proof = await publishProof(recovery);
  const r = await fetch(ADMIN_WORKER + "/admin/stepup", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify({ proof: proof, password: password || "" }) });
  if (!r.ok) { const j = await r.json().catch(() => null); const e = new Error((j && j.error) || "That didn’t verify."); e.status = r.status; throw e; }
  const j = await r.json();
  if (j && j.trust && j.exp) { saveDeviceTrust(j.trust, j.exp); return { ok: true }; }
  throw new Error("Step-up didn’t return a token.");
}
// Log in against the Worker. Returns {ok:true} (session stored), {ok:false,status} (rejected),
// or {ok:false,network:true} (Worker unreachable / not deployed → caller falls back to the local gate).
export async function adminLogin(password) {
  try {
    const res = await fetch(ADMIN_WORKER + "/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.status === 200) {
      const j = await res.json().catch(() => null);
      if (j && j.token && j.exp) { saveAdminSession(j.token, j.exp); return { ok: true }; }
      return { ok: false, status: 500 };
    }
    if (res.status === 404) return { ok: false, network: true }; // endpoint not deployed yet → fall back
    return { ok: false, status: res.status };
  } catch (e) { return { ok: false, network: true }; }
}

/* ---------- passkeys (WebAuthn) — passwordless admin sign-in + publish step-up ----------
   The Worker holds the credential public keys and verifies assertions; here we just run the
   browser ceremony and shuttle base64url<->ArrayBuffer. A "login" assertion returns a session
   (same as the password path); a "publish" assertion returns a short-lived step-up token. */
function b64urlToBuf(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}
function bufToB64url(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function webauthnSupported() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
export async function webauthnList() {
  try { const r = await fetch(ADMIN_WORKER + "/admin/webauthn/list"); if (!r.ok) return []; const j = await r.json(); return (j && j.passkeys) || []; } catch (e) { return []; }
}
// The owner's private ticket keyring (a recovery-encrypted {svId:code} blob) — stored server-side, cross-device.
export async function keyringGet() {
  const sess = adminSession(); if (!sess) return null;
  try { const r = await fetch(ADMIN_WORKER + "/admin/keyring", { headers: { Authorization: "Bearer " + sess } }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; }
}
export async function keyringPut(blob) {
  const sess = adminSession(); if (!sess) return { ok: false };
  try { const r = await fetch(ADMIN_WORKER + "/admin/keyring", { method: "PUT", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify(blob || {}) }); return { ok: r.ok }; } catch (e) { return { ok: false }; }
}
// Auto-name a new passkey from what we can detect (platform + attachment). attestation "none" zeroes the
// AAGUID so the exact provider isn't readable; this is the reliable signal, and the owner can rename later.
function guessPasskeyLabel(cred) {
  const att = (cred && cred.authenticatorAttachment) || "";
  const uaP = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
  const plat = /win/i.test(uaP) ? "Windows" : /mac/i.test(uaP) ? "Mac" : /iphone|ipad|ios/i.test(uaP) ? "iPhone" : /android/i.test(uaP) ? "Android" : /linux/i.test(uaP) ? "Linux" : "";
  if (att === "cross-platform") return "Phone or security key";
  if (att === "platform") {
    if (plat === "Windows") return "Windows Hello";
    if (plat === "Mac") return "Touch ID (Mac)";
    if (plat === "iPhone") return "iPhone (Face ID)";
    if (plat === "Android") return "Android";
    return plat ? plat + " passkey" : "This device";
  }
  return plat ? plat + " passkey" : "Passkey";
}
// Enrol a new passkey (owner-gated — needs a live session, e.g. from the password login the first time).
export async function webauthnRegister(label) {
  const sess = adminSession(); if (!sess) { const e = new Error("Sign in first to add a passkey."); e.auth = true; throw e; }
  const br = await fetch(ADMIN_WORKER + "/admin/webauthn/register/begin", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json", "X-Device-Trust": deviceTrust() }, body: "{}" });
  if (br.status === 401) { const e = new Error("Your session expired — sign in again."); e.auth = true; throw e; }
  if (br.status === 403) { const j = await br.json().catch(() => null); const e = new Error((j && j.error) || "Verify it’s you first."); if (j && j.needStepup) e.needStepup = true; throw e; }
  if (!br.ok) throw new Error("Couldn’t start passkey enrolment.");
  const o = await br.json();
  const cred = await navigator.credentials.create({ publicKey: {
    rp: o.rp, user: { id: b64urlToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
    challenge: b64urlToBuf(o.challenge), pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout,
    attestation: o.attestation, authenticatorSelection: o.authenticatorSelection,
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ type: c.type, id: b64urlToBuf(c.id) })),
  } });
  if (!cred) throw new Error("Passkey creation was cancelled.");
  const body = { id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type, label: label || guessPasskeyLabel(cred), response: { clientDataJSON: bufToB64url(cred.response.clientDataJSON), attestationObject: bufToB64url(cred.response.attestationObject) } };
  const fr = await fetch(ADMIN_WORKER + "/admin/webauthn/register/finish", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!fr.ok) { const j = await fr.json().catch(() => null); throw new Error((j && j.error) || "Passkey enrolment failed."); }
  return await fr.json();
}
// Sign in (purpose "login" → stores a session) or step up for publish (purpose "publish" → returns {publishToken,exp}).
export async function webauthnAuth(purpose) {
  const br = await fetch(ADMIN_WORKER + "/admin/webauthn/auth/begin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: purpose || "login" }) });
  if (!br.ok) throw new Error("Couldn’t start passkey sign-in.");
  const o = await br.json();
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge: b64urlToBuf(o.challenge), rpId: o.rpId, timeout: o.timeout || 120000, userVerification: o.userVerification || "preferred",
    allowCredentials: (o.allowCredentials || []).map((c) => ({ type: c.type, id: b64urlToBuf(c.id) })),
  } });
  if (!assertion) throw new Error("Passkey sign-in was cancelled.");
  const r = assertion.response;
  const body = { id: assertion.id, rawId: bufToB64url(assertion.rawId), type: assertion.type, response: { clientDataJSON: bufToB64url(r.clientDataJSON), authenticatorData: bufToB64url(r.authenticatorData), signature: bufToB64url(r.signature), userHandle: r.userHandle ? bufToB64url(r.userHandle) : null } };
  const fr = await fetch(ADMIN_WORKER + "/admin/webauthn/auth/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!fr.ok) { const j = await fr.json().catch(() => null); throw new Error((j && j.error) || "Passkey sign-in failed."); }
  const j = await fr.json();
  if (purpose === "publish") return j; // {publishToken, exp}
  if (j && j.token && j.exp) { saveAdminSession(j.token, j.exp); if (j.trust && j.trustExp) saveDeviceTrust(j.trust, j.trustExp); return { ok: true }; }
  throw new Error("Passkey sign-in didn’t return a session.");
}
// Remove an enrolled passkey (owner-gated).
export async function webauthnRemove(credId) {
  const sess = adminSession(); if (!sess) { const e = new Error("Sign in first."); e.auth = true; throw e; }
  const r = await fetch(ADMIN_WORKER + "/admin/webauthn/remove", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify({ credId: credId }) });
  if (!r.ok) throw new Error("Couldn’t remove that passkey.");
  return await r.json();
}
// Domain-separated proof of the recovery passphrase for the publish step-up (factor 2). A DIFFERENT
// label from any content-key derivation, so the Worker (which only stores its hash) can verify the
// owner typed the passphrase without ever being able to derive the content keys — zero-knowledge kept.
export async function publishProof(recovery) {
  const salt = new TextEncoder().encode("rk-publish-auth-v1");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(rkNormPass(recovery)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: 210000, hash: "SHA-256" }, base, 256);
  return bufToB64url(bits);
}
// Whether publishing currently requires the two-step (passkey + passphrase), and whether a proof is set.
export async function publishStatus() {
  try { const r = await fetch(ADMIN_WORKER + "/admin/publish/status"); if (!r.ok) return { enabled: false, hasProof: false }; return await r.json(); } catch (e) { return { enabled: false, hasProof: false }; }
}
// Owner-only: set the recovery proof hash and/or the require flag for the publish step-up.
export async function publishConfig(proof, require) {
  const sess = adminSession(); if (!sess) { const e = new Error("Sign in first."); e.auth = true; throw e; }
  const body = { require: !!require }; if (proof) body.proof = proof;
  const r = await fetch(ADMIN_WORKER + "/admin/publish/config", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.error) || "Couldn’t update publish security."); }
  return await r.json();
}
// Sign-in mode the gate reads: passwordless?, is a recovery passphrase set?, how many passkeys.
// Cached to localStorage so the gate can render the right mode INSTANTLY (no admin-key flash) on reopen.
export const AUTHMODE_KEY = "rk:authmode";
export function cachedAuthMode() { try { return JSON.parse(localStorage.getItem(AUTHMODE_KEY) || "null"); } catch (e) { return null; } }
export async function authStatus() {
  try {
    const r = await fetch(ADMIN_WORKER + "/admin/auth/status");
    if (!r.ok) return { passwordless: false, hasRecovery: false, passkeys: 0 };
    const j = await r.json();
    try { localStorage.setItem(AUTHMODE_KEY, JSON.stringify({ passwordless: !!j.passwordless, hasRecovery: !!j.hasRecovery, passkeys: j.passkeys | 0, hasAdminPass: !!j.hasAdminPass })); } catch (e) {}
    return j;
  } catch (e) { return { passwordless: false, hasRecovery: false, passkeys: 0 }; }
}
// Owner-only: turn the passwordless (passkey-only) admin login on/off.
export async function authConfig(passwordless) {
  const sess = adminSession(); if (!sess) { const e = new Error("Sign in first."); e.auth = true; throw e; }
  const r = await fetch(ADMIN_WORKER + "/admin/auth/config", { method: "POST", headers: { Authorization: "Bearer " + sess, "Content-Type": "application/json" }, body: JSON.stringify({ passwordless: !!passwordless }) });
  if (!r.ok) { const j = await r.json().catch(() => null); throw new Error((j && j.error) || "Couldn’t update sign-in mode."); }
  return await r.json();
}
// Break-glass sign-in with the recovery passphrase (all passkeys lost). Stores a session on success.
export async function recoverWithPassphrase(recovery, password) {
  const proof = await publishProof(recovery);
  const body = { proof: proof };
  if (password) body.password = password;
  const r = await fetch(ADMIN_WORKER + "/admin/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => null); const e = new Error((j && j.error) || "Recovery didn’t work."); e.status = r.status; throw e; }
  const j = await r.json();
  if (j && j.token && j.exp) { saveAdminSession(j.token, j.exp); return { ok: true }; }
  throw new Error("Recovery didn’t return a session.");
}

// Present mode / true master key: prove the recovery passphrase to the Worker and receive a read-only
// vault grant covering EVERY vault key, so the owner can open all deeper cuts to present. The
// passphrase never leaves the browser -- only its domain-separated proof does (same as recovery).
export async function ownerVaultGrant(recovery) {
  try {
    const proof = await publishProof(recovery);
    const r = await fetch(ADMIN_WORKER + "/vault/owner-grant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof: proof }) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return (j && j.vaultGrant && j.vaultGrant.token) ? j.vaultGrant : null;
  } catch (e) { return null; }
}

/* ---------- NDA vault (private R2, via the Worker) ----------
   Gated media (deeper-cut reels, NDA screen recordings) live in a private R2 bucket, never
   on a public URL. Uploads need the owner session; playback is a short-lived signed URL the
   viewer swaps in at render time. Keys are "<sha256>.<ext>" so the viewer can still tell a
   video from an image (and pick <video> vs <img>) without fetching the bytes first. */
export async function vaultUpload(file, extHint) {
  const sess = adminSession();
  if (!sess) { const e = new Error("Sign in to store media in the private vault."); e.auth = true; throw e; }
  const ext = String(extHint || "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const res = await fetch(ADMIN_WORKER + "/vault/upload" + (ext ? "?ext=" + ext : ""), {
    method: "POST",
    headers: { "Authorization": "Bearer " + sess, "Content-Type": (file && file.type) || "application/octet-stream" },
    body: file,
  });
  if (res.status === 401) { const e = new Error("Your session expired — sign in again."); e.auth = true; throw e; }
  if (!res.ok) throw new Error("The vault didn’t accept that upload (" + res.status + ").");
  const j = await res.json().catch(() => null);
  if (!j || !j.key) throw new Error("The vault didn’t return a key.");
  return j.key; // "<sha256>.<ext>"
}
// Owner-only: register/refresh a curated-view grant so a pass (a special-view ticket or a
// deeper-cut pass) can mint signed URLs for exactly `keys` until it expires. Each call REPLACES
// any prior grant for that pass, so callers must pass the full key set the pass should open.
export async function vaultRegisterGrant(code, keys, opts) {
  const sess = adminSession();
  if (!sess) { const e = new Error("Sign in to grant vault access."); e.auth = true; throw e; }
  const body = { code: String(code == null ? "" : code), keys: Array.isArray(keys) ? keys : [] };
  if (opts && typeof opts.exp === "number") body.exp = opts.exp;                 // absolute expiry — tracks the ticket's auto-hide
  else body.days = (opts && typeof opts.days === "number") ? opts.days : (typeof opts === "number" ? opts : 30);
  const res = await fetch(ADMIN_WORKER + "/vault/grant", {
    method: "POST",
    headers: { "Authorization": "Bearer " + sess, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { const e = new Error("Your session expired — sign in again."); e.auth = true; throw e; }
  if (!res.ok) throw new Error("The vault didn’t accept that grant (" + res.status + ").");
  return (await res.json().catch(() => null)) || { ok: true };
}
// Resolve a vault key to a short-lived, absolute streaming URL. Authorised by EITHER the owner
// session OR a redeemed curated-view grant (for pass-holders). Returns "" when neither is present
// or the Worker declines — the caller then shows the item locked.
export const VAULT_GRANT_KEY = "rk:vault:grant";
export function vaultGrantToken() {
  try {
    const g = JSON.parse(sessionStorage.getItem(VAULT_GRANT_KEY) || "null");
    if (g && g.token && g.exp && g.exp > Date.now()) return g.token;
  } catch (e) {}
  return "";
}
// Redeem a curated-view / deeper-cut pass for a scoped vault grant token (best-effort — a pass
// with no registered grant simply leaves the viewer without vault access, which is fine).
export async function vaultRedeem(code) {
  const c = String(code == null ? "" : code).trim();
  if (!c) return false;
  try {
    const res = await fetch(ADMIN_WORKER + "/vault/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: c }),
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    if (j && j.token && j.exp) { try { sessionStorage.setItem(VAULT_GRANT_KEY, JSON.stringify({ token: j.token, exp: j.exp })); } catch (e) {} return true; }
  } catch (e) {}
  return false;
}
export async function vaultSignedUrl(key) {
  if (!key) return "";
  const sess = adminSession();
  const headers = {};
  if (sess) headers.Authorization = "Bearer " + sess;
  else { const g = vaultGrantToken(); if (g) headers["X-Vault-Grant"] = g; else return ""; }
  try {
    const res = await fetch(ADMIN_WORKER + "/vault/sign?key=" + encodeURIComponent(key), { headers });
    if (!res.ok) return "";
    const j = await res.json().catch(() => null);
    return j && j.url ? ADMIN_WORKER + j.url : "";
  } catch (e) { return ""; }
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- locked-section encryption (envelope) ----------
   Each protected project has its own random content key (SEK). Its locked
   blocks publish as ciphertext stubs. The SEK is wrapped separately for every
   credential that may open it — a curating ticket, the deeper-cut pass, and the
   owner recovery passphrase — so any one decrypts, with per-ticket isolation.
   No sensitive content and no SEK ever ships in the clear. Credentials are
   normalised (trim + lowercase) to match the existing gate hashes. */
export var RK_KDF_IT = 210000;
export function rkNormPass(p) { return String(p == null ? "" : p).trim().toLowerCase(); }
export function rkB64(bytes) { var s = "", u = new Uint8Array(bytes); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
export function rkUnb64(str) { var s = atob(str), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
export async function rkDeriveKey(pass, salt, iters) {
  var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iters, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export function rkNewSek() { return crypto.getRandomValues(new Uint8Array(32)); }
export function rkImportSek(bytes) { return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
export async function rkEncWithSek(sekBytes, obj) {
  var key = await rkImportSek(sekBytes), iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: rkB64(iv), ct: rkB64(ct) };
}
export async function rkDecWithSek(sekBytes, e) {
  var key = await rkImportSek(sekBytes);
  var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rkUnb64(e.iv) }, key, rkUnb64(e.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
export async function rkWrapSek(credential, sekBytes) {
  var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  var key = await rkDeriveKey(rkNormPass(credential), salt, RK_KDF_IT);
  var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, sekBytes);
  return { salt: rkB64(salt), iv: rkB64(iv), ct: rkB64(ct) };
}
export async function rkUnwrapSek(credential, wrap) {
  var key = await rkDeriveKey(rkNormPass(credential), rkUnb64(wrap.salt), wrap.it || RK_KDF_IT);
  var raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rkUnb64(wrap.iv) }, key, rkUnb64(wrap.ct));
  return new Uint8Array(raw);
}
// Encrypt/decrypt raw bytes with a SEK (protected media hosted as its own .enc file).
export async function rkEncBytes(sekBytes, bytes) {
  var key = await rkImportSek(sekBytes), iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, bytes);
  return { iv: rkB64(iv), ct: new Uint8Array(ct) };
}
export async function rkDecBytes(sekBytes, ivB64, ctBytes) {
  var key = await rkImportSek(sekBytes);
  var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rkUnb64(ivB64) }, key, ctBytes);
  return new Uint8Array(pt);
}

/* ---------- admin-key gate hash (salted PBKDF2, published in content.json) ----------
   The admin key is verified against a salted hash that ships in content.json, so a
   fresh browser must know the real key instead of minting a new one. It is a slow
   PBKDF2 hash (not the plain SHA-256 kept in localStorage for quick re-entry) to make
   the public hash costly to brute-force. Case-sensitive, matching the existing key. */
export async function rkPbkHex(pass, saltBytes, iters) {
  var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pass == null ? "" : pass)), "PBKDF2", false, ["deriveBits"]);
  var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: iters, hash: "SHA-256" }, base, 256);
  return [...new Uint8Array(bits)].map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
export async function rkGateRecord(pass) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, it: RK_KDF_IT, salt: rkB64(salt), hash: await rkPbkHex(pass, salt, RK_KDF_IT) };
}
export async function rkGateVerify(pass, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  try { return (await rkPbkHex(pass, rkUnb64(rec.salt), rec.it || RK_KDF_IT)) === rec.hash; }
  catch (e) { return false; }
}

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
export function setPath(obj, path, val) {
  const keys = path.split(".");
  const last = keys.pop();
  let o = obj;
  keys.forEach((k) => { if (o[k] == null) o[k] = {}; o = o[k]; });
  o[last] = val;
}
