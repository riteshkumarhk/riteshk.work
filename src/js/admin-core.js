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
