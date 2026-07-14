/* =================================================================
   RITESH KUMAR — Project case study (L2)
   An immersive, URL-addressable overlay that renders a per-project
   "study" from content.json (the single source of truth) as a set
   of typed blocks. Opens over the site (Lenis paused), syncs a clean
   /work/<id> URL via the History API, and degrades to a real link
   (404.html restores deep loads). Inert inside the admin preview.
   ================================================================= */
(function () {
  "use strict";

  // Inside the admin live-preview iframe we stay inert to global routing/history,
  // but still expose openProject/closeProject so the editor can drive the preview.
  var PREVIEW = new URLSearchParams(location.search).has("preview");

  var UNLOCK_KEY = "rk:study:unlocked:"; // + workId  (session-scoped)
  var DEFAULT_TITLE = document.title;
  var SHOT_THEMES = ["edge", "auth", "search", "auto"];
  var VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

  // Any media field accepts an image, gif or video (string URL/data-URI, or
  // an object { src, kind, poster, controls, caption }). We pick the element.
  function mediaSrc(m) {
    var s = (m && (m.src || m.image)) || "";
    // Allow pasting a whole embed snippet (e.g. OneDrive/YouTube <iframe src="...">) — pull the URL out.
    var f = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(s);
    return f ? f[1] : s;
  }
  function isVideo(url, kind) {
    if (kind === "video") return true;
    if (kind === "image" || kind === "gif") return false;
    if (/^data:video\//i.test(url)) return true;
    if (/^data:image\//i.test(url)) return false;
    return VIDEO_RE.test(url || "");
  }
  var FS_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  function figmaEmbed(url) { return /embed/i.test(url) && /figma\.com/i.test(url) ? url : ("https://www.figma.com/embed?embed_host=ritesh&url=" + encodeURIComponent(url)); }
  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
  function officeEmbed(url) { return "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(absUrl(url)); }
  function ytEmbed(url) {
    var y = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
    if (y) return "https://www.youtube.com/embed/" + y[1];
    var v = url.match(/vimeo\.com\/(\d+)/);
    if (v) return "https://player.vimeo.com/video/" + v[1];
    return url;
  }
  function mediaKind(m) {
    var k = m && m.kind;
    if (k === "figma" || k === "pdf" || k === "office" || k === "embed" || k === "video") return k;
    if (k === "image" || k === "gif") return "image";
    var url = mediaSrc(m);
    if (!url) return "image";
    if (/figma\.com/i.test(url)) return "figma";
    if (/(1drv\.ms|onedrive\.live\.com|onedrive\.com|\.sharepoint\.com)/i.test(url)) return "embed";
    if (/\.pdf($|\?|#)/i.test(url)) return "pdf";
    if (/\.(pptx?|docx?|xlsx?|key)($|\?|#)/i.test(url)) return "office";
    if (/(youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) return "embed";
    if (isVideo(url, k)) return "video";
    return "image";
  }
  function frameEl(src, cls, label) {
    return '<div class="pjb__frame ' + cls + '">' +
      '<iframe class="pjb__frame-el" src="' + attr(src) + '" loading="lazy" allow="fullscreen; autoplay; clipboard-read; clipboard-write" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>' +
      '<button class="pjb__fs" type="button" data-fs aria-label="Toggle fullscreen \u2014 ' + attr(label) + '" title="Fullscreen">' + FS_SVG + '<span>Fullscreen</span></button></div>';
  }
  function mediaEl(m, cls) {
    var url = mediaSrc(m);
    if (!url) return "";
    var kind = mediaKind(m);
    if (kind === "figma") return frameEl(figmaEmbed(url), cls, "prototype");
    if (kind === "office") return frameEl(officeEmbed(url), cls, "slideshow");
    if (kind === "pdf") return frameEl(url + (/[#?]/.test(url) ? "" : "#view=FitH"), cls, "PDF");
    if (kind === "embed") return frameEl(ytEmbed(url), cls, /(1drv|onedrive|sharepoint)/i.test(url) ? "slideshow" : "video");
    if (kind === "video") {
      var poster = m.poster ? ' poster="' + attr(m.poster) + '"' : "";
      if (m.controls) return '<video class="' + cls + '" src="' + attr(url) + '"' + poster + ' controls controlsList="nodownload noplaybackrate" disablepictureinpicture playsinline preload="metadata"></video>';
      return '<video class="' + cls + '" src="' + attr(url) + '"' + poster + ' autoplay muted loop playsinline preload="metadata"></video>';
    }
    var cap = attr(m.caption || "");
    return '<img class="' + cls + '" src="' + attr(url) + '" alt="' + cap + '" data-cap="' + cap + '"' + (m.title ? ' data-title="' + attr(m.title) + '"' : "") + ' data-zoom loading="lazy" />';
  }

  var overlay = null, scroller = null, activeId = null;
  var returnScrollY = 0, lastFocus = null, spyRaf = 0;

  /* ---------- small helpers (reuse RK where possible) ---------- */
  function esc(s) {
    return (window.RK && window.RK.esc)
      ? window.RK.esc(s)
      : String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function attr(s) { return esc(s).replace(/"/g, "&quot;"); }
  function md(s) { return (window.RK && window.RK.md) ? window.RK.md(s) : esc(s); }
  function plain(s) {
    return String(s == null ? "" : s)
      .replace(/\[\[(.+?)\]\]/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
  }
  function paras(body) {
    return String(body || "").split(/\n\n+/).map(function (p) { return "<p>" + md(p) + "</p>"; }).join("");
  }
  // Rich body fields authored in the editor are stored as HTML; legacy fields are markdown/plain.
  function isRichHtml(s) { return /<(p|ul|ol|li|strong|em|b|i|s|strike|br|div|h[1-6]|span|figure|img|blockquote)\b/i.test(s || ""); }
  function safeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/ on\w+="[^"]*"/gi, "").replace(/ on\w+='[^']*'/gi, "")
      .replace(/javascript:/gi, "");
  }
  function prose(body, cls) { if (!body) return ""; return '<div class="pjb__prose' + (cls ? " " + cls : "") + '">' + (isRichHtml(body) ? safeHtml(body) : paras(body)) + "</div>"; }
  function richInline(s) { s = s == null ? "" : String(s); return isRichHtml(s) ? safeHtml(s) : md(s); }
  function data() { return (window.RK && window.RK.data) || null; }
  function workById(id) {
    var d = data(); if (!d) return null;
    return (d.work || []).filter(function (w) { return w.id === id; })[0] || null;
  }
  function siblings(id) {
    var d = data(); if (!d) return [];
    var f = (d.work || []).filter(function (w) { return w.featured; });
    return f.some(function (w) { return w.id === id; }) ? f : (d.work || []);
  }
  function slug(s, i) {
    return (String(s == null ? ("s" + i) : s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || ("s" + i);
  }
  async function sha256(str) {
    var b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  }
  function isUnlocked(id) { try { return sessionStorage.getItem(UNLOCK_KEY + id) === "1"; } catch (e) { return false; } }
  function setUnlocked(id) { try { sessionStorage.setItem(UNLOCK_KEY + id, "1"); } catch (e) {} }

  /* ---------- locked-section decryption (envelope) ----------
     Protected blocks ship as ciphertext stubs. A credential (deeper-cut pass or a
     curating ticket code) unwraps the project's content key, which decrypts them. */
  function rkNormPass(p) { return String(p == null ? "" : p).trim().toLowerCase(); }
  function rkUnb64(str) { var s = atob(str), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function rkImportSek(bytes) { return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
  async function rkDeriveKey(pass, salt, iters) {
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iters, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function rkUnwrapSek(credential, wrap) {
    var key = await rkDeriveKey(rkNormPass(credential), rkUnb64(wrap.salt), wrap.it || 210000);
    var raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rkUnb64(wrap.iv) }, key, rkUnb64(wrap.ct));
    return new Uint8Array(raw);
  }
  async function rkDecWithSek(sekBytes, e) {
    var key = await rkImportSek(sekBytes);
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rkUnb64(e.iv) }, key, rkUnb64(e.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  // Decrypt a study's ciphertext stubs in place with its content key. Atomic:
  // returns true only if every stub decrypted, else leaves the study untouched.
  async function decryptStudyBlocks(st, sekBytes) {
    if (!st || !Array.isArray(st.blocks)) return false;
    var out = st.blocks.slice(), any = false;
    for (var i = 0; i < out.length; i++) {
      var b = out[i];
      if (b && b.encStub && b.iv && b.ct) {
        try { out[i] = await rkDecWithSek(sekBytes, b); any = true; }
        catch (e) { return false; }
      }
    }
    if (any) st.blocks = out;
    return any;
  }
  // Unlock a study with one credential against a specific key-wrap.
  async function unlockStudyWithCred(st, credential, wrap) {
    if (!st || !st.enc || !wrap) return false;
    var sek;
    try { sek = await rkUnwrapSek(credential, wrap); } catch (e) { return false; }
    return decryptStudyBlocks(st, sek);
  }

  /* ---------- block renderers ---------- */
  function kicker(k) { return k ? '<div class="pjb__kicker">' + esc(k) + "</div>" : ""; }
  function heading(h) { return h ? '<h2 class="pjb__h">' + md(h) + "</h2>" : ""; }
  function mediaInset(b) {
    if (!mediaSrc(b)) return "";
    return '<figure class="pjb__inset">' + mediaEl(b, "pjb__media-el") + (b.caption ? '<figcaption class="pjb__cap">' + esc(b.caption) + "</figcaption>" : "") + "</figure>";
  }
  var ICONS = {
    users: '<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3"/><path d="M22 19v-1a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    idea: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/>',
    coins: '<circle cx="8" cy="8" r="5"/><path d="M13.5 5.2a5 5 0 0 1 0 9.6"/><path d="M16 16.6a5 5 0 0 1-3 1.2"/>',
    chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7"/><rect x="12" y="7" width="3" height="11"/><rect x="17" y="4" width="3" height="14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    spark: '<path d="M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    heart: '<path d="M20.8 5.6a5.4 5.4 0 0 0-7.7 0L12 6.7l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.7L12 22l8.8-8.7a5.4 5.4 0 0 0 0-7.7z"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 4 13C4 6 9 3 20 3c0 11-3 16-9 16-2 0-3-.5-3-.5"/><path d="M4 20c1.5-4 4-6.5 8-8"/>',
    star: '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5L2.6 9.8l6.5-.9z"/>',
    rocket: '<path d="M5 13c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 11a10 10 0 0 1 9-6c1 5-1 8-6 9l-3-3z"/><circle cx="14.5" cy="9.5" r="1.4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/>',
    eye: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
    flag: '<path d="M5 22V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M4.5 12v9h15v-9"/><path d="M12 8C12 5 13.5 3 15.5 3A2.5 2.5 0 0 1 15.5 8zM12 8C12 5 10.5 3 8.5 3A2.5 2.5 0 0 0 8.5 8z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 13H4.4a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4.6V4.4a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-1.3 2.9z"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    pin: '<path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M8.2 13.9 7 22l5-3 5 3-1.2-8.1"/>',
    like: '<path d="M7 10v11H3V10zM7 10l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.5l-1.6 7A2 2 0 0 1 17 21H7z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 5.3-5.3 2.2 2.2-5.3z"/>',
    book: '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
    code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    cloud: '<path d="M18 10a5 5 0 0 0-9.6-1.6A4 4 0 1 0 7 18h10.5A3.5 3.5 0 0 0 18 10z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    flame: '<path d="M12 22c3.9 0 7-3 7-7 0-3-2-5.5-3.5-7 0 2-1.5 3-2.5 3 0-3-1.5-5.5-4-7 .3 3-1.5 4.5-3 6.7C5.7 10.4 5 12.6 5 15c0 4 3.1 7 7 7z"/>',
    key: '<circle cx="8" cy="9" r="5"/><path d="M11.5 12.5L21 22M17 18l2-2M14 15l2-2"/>',
    tag: '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
    trophy: '<path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0zM6 4H3v2a3 3 0 0 0 3 3M18 4h3v2a3 3 0 0 1-3 3"/>',
    cart: '<circle cx="9" cy="21" r="1.3"/><circle cx="18" cy="21" r="1.3"/><path d="M2 3h3l2.5 12.5h11L21 7H6"/>',
    hand: '<path d="M18 11V6a1.5 1.5 0 0 0-3 0M15 6V4a1.5 1.5 0 0 0-3 0v2M12 6.5V4a1.5 1.5 0 0 0-3 0v7M9 11V8.5a1.5 1.5 0 0 0-3 0V14c0 3.5 2.5 7 7 7s6-3 6-7v-3a1.5 1.5 0 0 0-3 0"/>',
    puzzle: '<path d="M10 3h4v3a1.6 1.6 0 0 0 3 0V3h4v4h-3a1.6 1.6 0 0 0 0 3h3v4h-3a1.6 1.6 0 0 0 0 3h3v4h-4v-3a1.6 1.6 0 0 0-3 0v3h-4v-4H7a1.6 1.6 0 0 0 0-3h3v-4H7a1.6 1.6 0 0 0 0-3h3z"/>',
    filter: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>'
  };
  function iconSvg(name) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.spark) + "</svg>";
  }

  function textBlock(b) {
    var list = (b.list && b.list.length)
      ? '<ul class="pjb__list">' + b.list.map(function (x) { return "<li>" + md(x) + "</li>"; }).join("") + "</ul>"
      : "";
    return kicker(b.kicker) + heading(b.heading) +
      prose(b.body) + list + mediaInset(b);
  }
  function stmtBlock(b) {
    var quote = isRichHtml(b.body)
      ? '<div class="pjb__quote pjb__quote--rich">' + safeHtml(b.body) + "</div>"
      : '<p class="pjb__quote">' + md(b.body) + "</p>";
    return kicker(b.kicker) + quote +
      (b.sub ? '<p class="pjb__sub">' + md(b.sub) + "</p>" : "") + mediaInset(b);
  }
  function metricsBlock(b) {
    var items = (b.items || []).map(function (m) {
      return '<div class="pjb__metric"><div class="pjb__metric-v">' + esc(m.value) +
        '</div><div class="pjb__metric-l">' + esc(m.label) + "</div></div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__metrics">' + items + "</div>";
  }
  function stepsBlock(b) {
    var items = (b.items || []).map(function (s, i) {
      return '<li class="pjb__step"><span class="pjb__step-n">' + String(i + 1).padStart(2, "0") +
        '</span><div class="pjb__step-b"><h3 class="pjb__step-h">' + md(s.title) + '</h3><div class="pjb__step-p">' + richInline(s.body) + "</div></div></li>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<ol class="pjb__steps">' + items + "</ol>";
  }
  function mediaBlock(b) {
    var items = b.items || [], n = items.length;
    var shots = items.map(function (m, i) {
      var body = mediaSrc(m)
        ? mediaEl(m, "pjb__media-el")
        : '<div class="pjb__shot-ph pjb__shot-ph--' + SHOT_THEMES[i % SHOT_THEMES.length] + '"><span class="pjb__shot-tag">Visual redacted</span></div>';
      var cap = m.caption
        ? '<figcaption class="pjb__cap"><span class="pjb__cap-n">' + String(i + 1).padStart(2, "0") + " / " + String(n).padStart(2, "0") + "</span>" + esc(m.caption) + "</figcaption>"
        : "";
      var sz = (m.size === "fit" || m.size === "custom") ? m.size : "fill";
      var mst = "";
      if (m.bg) mst += "background:" + esc(m.bg) + ";";
      if (sz === "fit") mst += "aspect-ratio:" + ratioCss(m.fitRatio) + ";";
      var inner = body;
      if (sz === "custom") { var w = Math.max(10, 100 - Math.max(0, Math.min(90, +m.shrink || 0))); inner = '<span class="pjb__shot-scale" style="width:' + w + '%">' + body + "</span>"; }
      return '<figure class="pjb__shot pjb__shot--' + sz + '"><div class="pjb__shot-media"' + (mst ? ' style="' + mst + '"' : "") + ">" + inner + "</div>" + cap + "</figure>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__media">' + shots + "</div>";
  }
  function ratioCss(r) { var m = /^(\d+)\s*:\s*(\d+)$/.exec(r || ""); return m ? m[1] + " / " + m[2] : "16 / 9"; }
  function splitBlock(b) {
    var col = function (label, val, img, cls) {
      var media = (img && mediaSrc({ src: img })) ? '<div class="pjb__col-media">' + mediaEl({ src: img }, "pjb__media-el") + "</div>" : "";
      var body = Array.isArray(val)
        ? (val.length ? "<ul>" + val.map(function (x) { return "<li>" + md(x) + "</li>"; }).join("") + "</ul>" : "")
        : (val ? '<div class="pjb__col-body">' + (isRichHtml(val) ? safeHtml(val) : paras(val)) + "</div>" : "");
      return '<div class="pjb__col' + (cls || "") + '"><div class="pjb__col-label">' + esc(label) + "</div>" + media + body + "</div>";
    };
    return kicker(b.kicker) + heading(b.heading) +
      '<div class="pjb__split">' + col(b.leftLabel || "Before", b.left, b.leftImg) + col(b.rightLabel || "After", b.right, b.rightImg, " pjb__col--after") + "</div>";
  }
  function faqBlock(b) {
    var items = (b.items || []).map(function (f) {
      return '<div class="pjb__qa"><h3 class="pjb__q">' + md(f.q) + '</h3><div class="pjb__a">' + richInline(f.a) + "</div></div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__faq">' + items + "</div>";
  }
  // Balanced card rows: up to 4 in one row; otherwise rows of 3, with a single
  // row of 4 when the count leaves a remainder of 1 (so 7→4,3 · 8→3,3,2 · 10→4,3,3).
  function cardRows(n) {
    if (n <= 4) return [n];
    var rows = [], rem = n;
    if (n % 3 === 1) { rows.push(4); rem -= 4; }
    while (rem > 0) { rows.push(Math.min(3, rem)); rem -= 3; }
    return rows;
  }
  function cardsBlock(b) {
    var list = b.items || [];
    var spans = [];
    cardRows(list.length).forEach(function (size) { for (var q = 0; q < size; q++) spans.push(size ? 12 / size : 12); });
    var items = list.map(function (c, idx) {
      var top = mediaSrc(c) ? '<div class="pjb__card-media">' + mediaEl(c, "pjb__media-el") + "</div>"
        : (c.icon ? '<div class="pjb__card-ico">' + iconSvg(c.icon) + "</div>" : "");
      return '<div class="pjb__card' + (mediaSrc(c) ? " pjb__card--media" : "") + '" style="--cspan:' + (spans[idx] || 4) + '">' + top + '<h3 class="pjb__card-h">' + md(c.title) + "</h3>" + (c.body ? '<div class="pjb__card-b">' + richInline(c.body) + "</div>" : "") + "</div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__cards">' + items + "</div>";
  }
  function galleryBlock(b) {
    var items = b.items || [], n = items.length;
    var slides = items.map(function (m, i) {
      var body = mediaSrc(m)
        ? mediaEl(m, "pjb__media-el")
        : '<div class="pjb__shot-ph pjb__shot-ph--' + SHOT_THEMES[i % SHOT_THEMES.length] + '"><span class="pjb__shot-tag">Visual redacted</span></div>';
      var cap = '<figcaption class="pjb__slide-cap"><span class="pjb__slide-n">' + String(i + 1).padStart(2, "0") + " / " + String(n).padStart(2, "0") + "</span>" + (m.caption ? esc(m.caption) : "") + "</figcaption>";
      return '<figure class="pjb__slide"><div class="pjb__slide-media">' + body + "</div>" + cap + "</figure>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__gallery" tabindex="0"><div class="pjb__gallery-track">' + slides + "</div></div>";
  }
  // Equalise gallery slide heights: scale taller images DOWN (contain — no crop, no
  // quality loss) so every slide matches the shortest image's height at the current width.
  var galleryTimer = 0;
  function normalizeGalleries(root) {
    var scope = root || (overlay && overlay.querySelector("[data-content]"));
    if (!scope) return;
    [].forEach.call(scope.querySelectorAll(".pjb__gallery"), function (g) {
      var boxes = [].slice.call(g.querySelectorAll(".pjb__slide-media"));
      if (boxes.length < 2) return;
      var imgs = boxes.map(function (bx) { return bx.querySelector("img.pjb__media-el"); });
      if (imgs.some(function (im) { return !im; })) return; // only equalise pure-image galleries
      function apply() {
        var minH = Infinity;
        for (var i = 0; i < boxes.length; i++) {
          var im = imgs[i];
          if (!im.naturalWidth || !im.naturalHeight) return; // wait until all images have loaded
          var h = boxes[i].clientWidth * (im.naturalHeight / im.naturalWidth);
          if (h < minH) minH = h;
        }
        if (!isFinite(minH) || minH <= 0) return;
        boxes.forEach(function (bx) { bx.style.height = Math.round(minH) + "px"; bx.classList.add("is-normalized"); });
      }
      imgs.forEach(function (im) {
        if (im.complete && im.naturalWidth) return;
        im.addEventListener("load", apply, { once: true });
        im.addEventListener("error", apply, { once: true });
      });
      apply();
    });
  }
  function figureBlock(b) {
    var media = mediaSrc(b)
      ? mediaEl(b, "pjb__media-el")
      : '<div class="pjb__shot-ph pjb__shot-ph--' + esc(b.theme || "edge") + '"><span class="pjb__shot-tag">Visual redacted</span></div>';
    var fig = '<figure class="pjb__figure-media">' + media + (b.caption ? '<figcaption class="pjb__cap">' + esc(b.caption) + "</figcaption>" : "") + "</figure>";
    var txt = '<div class="pjb__figure-text">' + heading(b.heading) + prose(b.body) + "</div>";
    return kicker(b.kicker) + '<div class="pjb__figure' + (b.flip ? " pjb__figure--flip" : "") + '">' + fig + txt + "</div>";
  }
  function columnsBlock(b) {
    var items = (b.items || []).map(function (c) {
      var cells = (Array.isArray(c.cells) && c.cells.length) ? c.cells : [{ heading: c.heading, body: c.body, src: c.src }];
      var inner = cells.map(function (cell) {
        var media = mediaSrc(cell) ? '<div class="pjb__coln-media">' + mediaEl(cell, "pjb__media-el") + "</div>" : "";
        return '<div class="pjb__cell">' +
          (cell.heading ? '<h3 class="pjb__coln-h">' + md(cell.heading) + "</h3>" : "") +
          prose(cell.body) + media + "</div>";
      }).join("");
      return '<div class="pjb__coln">' + (c.label ? '<div class="pjb__coln-lbl">' + esc(c.label) + "</div>" : "") + inner + "</div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__cols">' + items + "</div>";
  }
  // Rows are the transpose of Columns: stacked bands, each with a row label and cells laid out side by side.
  function rowsBlock(b) {
    var hasLabels = (b.items || []).some(function (r) { return r.label; });
    var rows = (b.items || []).map(function (r) {
      var cells = (Array.isArray(r.cells) && r.cells.length) ? r.cells : [{ heading: r.heading, body: r.body, src: r.src }];
      var inner = cells.map(function (cell) {
        var media = mediaSrc(cell) ? '<div class="pjb__coln-media">' + mediaEl(cell, "pjb__media-el") + "</div>" : "";
        return '<div class="pjb__row-cell">' +
          (cell.heading ? '<h3 class="pjb__coln-h">' + md(cell.heading) + "</h3>" : "") +
          prose(cell.body) + media + "</div>";
      }).join("");
      return '<div class="pjb__row">' +
        (hasLabels ? '<div class="pjb__row-lbl">' + esc(r.label || "") + "</div>" : "") +
        '<div class="pjb__row-cells" style="--rn:' + cells.length + '">' + inner + "</div></div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__rows' + (hasLabels ? "" : " pjb__rows--nolabel") + '">' + rows + "</div>";
  }
  function compareBlock(b) {
    var note = prose(b.body, "pjb__cmp-note");
    if (!mediaSrc({ src: b.beforeSrc }) || !mediaSrc({ src: b.afterSrc })) {
      return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__shot-ph pjb__shot-ph--edge"><span class="pjb__shot-tag">Add a before &amp; after image</span></div>' + note;
    }
    var cmp = '<div class="pjb__cmp" style="--pos:50%">' +
      '<img class="pjb__cmp-base" src="' + attr(b.afterSrc) + '" alt="" draggable="false" />' +
      '<div class="pjb__cmp-top"><img src="' + attr(b.beforeSrc) + '" alt="" draggable="false" /></div>' +
      '<span class="pjb__cmp-line" aria-hidden="true"></span>' +
      '<button type="button" class="pjb__cmp-grip" data-cmp aria-label="Drag to compare before and after"><span>\u2039\u203a</span></button>' +
      '<button type="button" class="pjb__cmp-zoom" data-cmp-zoom aria-label="View full screen" title="View full screen">' + FS_SVG + "</button>" +
      '<span class="pjb__cmp-lbl pjb__cmp-lbl--l">' + esc(b.beforeLabel || "Before") + "</span>" +
      '<span class="pjb__cmp-lbl pjb__cmp-lbl--r">' + esc(b.afterLabel || "After") + "</span>" +
      "</div>";
    return kicker(b.kicker) + heading(b.heading) + cmp + note;
  }
  // Open the before/after pair in the full-screen lightbox (double-click or expand button).
  function openCmpLbx(cmp) {
    if (!cmp) return;
    var beforeImg = cmp.querySelector(".pjb__cmp-top img");
    var afterImg = cmp.querySelector(".pjb__cmp-base");
    var lblL = cmp.querySelector(".pjb__cmp-lbl--l");
    var lblR = cmp.querySelector(".pjb__cmp-lbl--r");
    var group = [];
    if (beforeImg) group.push({ src: beforeImg.currentSrc || beforeImg.src, cap: (lblL && lblL.textContent) || "Before" });
    if (afterImg) group.push({ src: afterImg.currentSrc || afterImg.src, cap: (lblR && lblR.textContent) || "After" });
    if (group.length) openLbx(group, 0);
  }
  var LOCK_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.4">' +
    '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  function lockedBlock(b) {
    return kicker(b.kicker || "Deeper cut") +
      (b.heading ? '<h2 class="pjb__h pjb__h--blur">' + md(b.heading) + "</h2>" : "") +
      '<div class="pjb__lock"><div class="pjb__lock-ico" aria-hidden="true">' + LOCK_SVG + "</div>" +
      '<p class="pjb__lock-txt">This deeper cut is shared on request.</p>' +
      '<button type="button" class="pj__btn pj__btn--primary" data-pj="unlock">Unlock the full case study</button>' +
      '<div class="pjb__lock-hint">Enter the pass you were given.</div></div>';
  }

  function stickiesBlock(b) {
    var items = (b.items || []).map(function (n) {
      var media = mediaSrc(n) ? '<div class="pjb__sticky-media">' + mediaEl(n, "pjb__media-el") + "</div>" : "";
      return '<article class="pjb__sticky">' +
        (n.label ? '<div class="pjb__sticky-lbl">' + esc(n.label) + "</div>" : "") +
        (n.heading ? '<h3 class="pjb__sticky-h">' + md(n.heading) + "</h3>" : "") +
        (n.body ? '<div class="pjb__sticky-b">' + richInline(n.body) + "</div>" : "") +
        media + "</article>";
    }).join("");
    var size = (b.stickySize === "uniform" || b.stickySize === "none") ? b.stickySize : "natural";
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__stickies pjb__stickies--' + size + '">' + items + "</div>";
  }

  function voicesBlock(b) {
    var mode = b.mode === "thought" ? "thought" : b.mode === "chat" ? "chat" : "verbatim";
    var list = b.items || [];
    // In chat mode, if sides were left untouched (all default "left"), auto-alternate so it
    // reads as a back-and-forth conversation. If the author set any bubble to the right, respect
    // their explicit arrangement instead.
    var autoAlt = mode === "chat" && list.every(function (v) { return !v.side || String(v.side).toLowerCase() === "left"; });
    var items = list.map(function (v, i) {
      var side = autoAlt ? (i % 2 ? "right" : "left") : (String(v.side || "").trim().toLowerCase() === "right" ? "right" : "left");
      var head = (mode === "verbatim" && v.heading) ? '<div class="pjb__voice-h">' + md(v.heading) + "</div>" : "";
      var body = v.body ? '<div class="pjb__voice-b">' + richInline(v.body) + "</div>" : "";
      var cite = v.cite ? '<div class="pjb__voice-cite">' + esc(v.cite) + "</div>" : "";
      return '<div class="pjb__voice' + (side ? " pjb__voice--" + side : "") + '"><div class="pjb__voice-bubble">' + head + body + "</div>" + cite + "</div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__voices pjb__voices--' + mode + (b.vsize === "lg" ? " pjb__voices--lg" : "") + '">' + items + "</div>";
  }

  // Workflow — a process shown as a linear left-to-right flow or a repeating loop,
  // with optional fork/merge (a step split into parallel branches with "//").
  function workflowBlock(b) {
    var flow = b.flow === "loop" ? "loop" : "linear";
    var items = b.items || [];
    var branchesOf = function (label) { return String(label || "").split("//").map(function (s) { return s.trim(); }).filter(Boolean); };
    var arrowSvg = '<svg width="32" height="10" viewBox="0 0 32 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M0 5h27"/><path d="M24 1.5 28.5 5 24 8.5"/></svg>';
    var nodes = items.map(function (it, i) {
      var parts = branchesOf(it.label);
      var num = '<span class="pjb__flow-num">' + String(i + 1).padStart(2, "0") + "</span>";
      var note = it.note ? '<span class="pjb__flow-note">' + esc(it.note) + "</span>" : "";
      var node;
      if (parts.length > 1) {
        node = '<div class="pjb__flow-fork">' + num + '<div class="pjb__flow-branches">' + parts.map(function (p) { return '<span class="pjb__flow-branch">' + md(p) + "</span>"; }).join("") + "</div>" + note + "</div>";
      } else {
        node = '<div class="pjb__flow-node">' + num + '<span class="pjb__flow-lbl">' + md(parts[0] || it.label || "") + "</span>" + note + "</div>";
      }
      var arrow = i > 0 ? '<span class="pjb__flow-arrow">' + arrowSvg + "</span>" : "";
      return '<div class="pjb__flow-step">' + arrow + node + "</div>";
    }).join("");
    var ret = "";
    if (flow === "loop" && items.length) {
      var first = branchesOf(items[0].label)[0] || items[0].label || "";
      ret = '<div class="pjb__flow-return"><span class="pjb__flow-return-ico" aria-hidden="true">\u21ba</span><span>' + (first ? "Repeats from \u201c" + esc(first) + "\u201d" : "Repeats as a cycle") + "</span></div>";
    }
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__flow pjb__flow--' + flow + '">' + nodes + "</div>" + ret;
  }

  function mediagridBlock(b) {
    var layout = b.gridLayout === "cluster" ? "cluster" : "uniform";
    var cells = (b.items || []).map(function (m, i) {
      var body = mediaSrc(m)
        ? mediaEl(m, "pjb__media-el")
        : '<div class="pjb__shot-ph pjb__shot-ph--' + SHOT_THEMES[i % SHOT_THEMES.length] + '"><span class="pjb__shot-tag">Visual redacted</span></div>';
      var cap = m.caption ? '<figcaption class="pjb__grid-cap">' + esc(m.caption) + "</figcaption>" : "";
      return '<figure class="pjb__grid-cell"><div class="pjb__grid-media">' + body + "</div>" + cap + "</figure>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__mediagrid pjb__mediagrid--' + layout + '">' + cells + "</div>";
  }

  // Device mockups — abstract CSS frames (phone / tablet / laptop / watch) wrapped
  // around a screen. A screen either uses a preset aspect ratio (media fills, cover)
  // or "auto" (the frame simply wraps the media's natural size). Each device has its
  // own natural width, so narrow devices (portrait phone, watch) pack several per row
  // while wide ones (laptop, landscape tablet/phone) take the room they need and wrap.
  var DEVICE_RATIOS = {
    phone: { iphone: "9 / 19.5", android: "9 / 20", landscape: "19.5 / 9", auto: "" },
    tablet: { portrait: "3 / 4", landscape: "4 / 3", auto: "" },
    laptop: { wide: "16 / 10", hd: "16 / 9", auto: "" },
    watch: { circle: "1 / 1", square: "1 / 1" },
  };
  var DEVICE_DEFAULT = { phone: "iphone", tablet: "portrait", laptop: "wide", watch: "circle" };
  function deviceMeta(device, preset) {
    var map = DEVICE_RATIOS[device] || DEVICE_RATIOS.phone;
    var key = preset && preset in map ? preset : DEVICE_DEFAULT[device];
    var cls = "";
    if (device === "watch") cls = "pjb__dev--watch-" + (key === "square" ? "square" : "circle");
    else if (key === "landscape") cls = "pjb__dev--" + device + "-land";
    return { ratio: map[key], cls: cls };
  }
  function deviceBlock(b) {
    var device = /^(phone|tablet|laptop|watch)$/.test(b.device) ? b.device : "phone";
    var meta = deviceMeta(device, b.preset);
    var frames = (b.items || []).map(function (m, i) {
      var media = mediaSrc(m)
        ? mediaEl(m, "pjb__media-el")
        : '<div class="pjb__shot-ph pjb__shot-ph--' + SHOT_THEMES[i % SHOT_THEMES.length] + '"><span class="pjb__shot-tag">Screen</span></div>';
      var scls = "pjb__dev-screen" + (meta.ratio ? "" : " pjb__dev-screen--auto");
      var sstyle = meta.ratio ? ' style="aspect-ratio:' + meta.ratio + '"' : "";
      var cap = m.caption ? '<figcaption class="pjb__dev-cap">' + esc(m.caption) + "</figcaption>" : "";
      return '<figure class="pjb__dev pjb__dev--' + device + (meta.cls ? " " + meta.cls : "") + '">' +
        '<div class="pjb__dev-frame"><div class="' + scls + '"' + sstyle + ">" + media + "</div></div>" + cap + "</figure>";
    }).join("");
    var fill = /^(34|full)$/.test(b.fill) ? " pjb__devices--fill-" + b.fill : "";
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__devices pjb__devices--' + device + fill + '">' + frames + "</div>";
  }

  // Isometric layered UI — ONE orthographic (NON-perspective) tilted stack per
  // section. Layers are spaced by a uniform --distance; each carries a small --depth
  // slab that extrudes DOWNWARD, built from masked slices in the height colour (--hc)
  // so it follows the image's alpha — a rounded/transparent PNG gets rounded depth,
  // no sharp edges. Height colour auto-derives from the image (data-iso-auto) unless
  // the author sets one. Four view directions. Stack = opaque; interface = transparent
  // (PNG alpha shows) with an optional transparency reduction. Capped at 12 layers.
  function isolayersBlock(b) {
    var mode = b.mode === "interface" ? "interface" : "stack";
    var dir = /^(topR|topL|right|left)$/.test(b.dir) ? b.dir : "topR";
    var distance = Math.max(6, Math.min(160, parseInt(b.distance, 10) || 40));
    var baseDepth = parseInt(b.depth, 10); baseDepth = Math.max(0, Math.min(48, isNaN(baseDepth) ? 12 : baseDepth));
    var items = (b.items || []).slice(0, 12);
    var op = mode === "interface" ? ({ light: "0.92", medium: "0.75", strong: "0.55" }[b.transparency] || "") : "";
    var maxDepth = 0;
    var layers = items.map(function (m, i) {
      var url = mediaSrc(m);
      // A layer can override the block's slab depth; a blank override just follows the block.
      var rawD = parseInt(m.depth, 10);
      var depth = isNaN(rawD) ? baseDepth : Math.max(0, Math.min(48, rawD));
      if (depth > maxDepth) maxDepth = depth;
      var nSlices = depth > 0 ? Math.max(3, Math.min(12, Math.round(depth / 1.4))) : 0;
      var face = url ? mediaEl(m, "pjb__iso-media")
        : '<div class="pjb__shot-ph pjb__shot-ph--' + SHOT_THEMES[i % SHOT_THEMES.length] + '"><span class="pjb__shot-tag">Layer</span></div>';
      var col = String(m.heightColor || "").replace(/[^#0-9a-z(),.%\s]/gi, "").slice(0, 32);
      var depthEl = "";
      if (nSlices && url) {
        var murl = "url('" + attr(url) + "')";
        var slices = "";
        for (var k = 1; k <= nSlices; k++) {
          var z = -(depth * (k / nSlices));
          slices += '<span class="pjb__iso-ext" style="--z:' + z.toFixed(1) + "px;-webkit-mask-image:" + murl + ";mask-image:" + murl + '"></span>';
        }
        depthEl = '<span class="pjb__iso-depth">' + slices + "</span>";
      }
      var st = "--i:" + i + (col ? ";--hc:" + col : "") + (op ? ";opacity:" + op : "");
      var auto = !col && url ? ' data-iso-auto="1"' : "";
      return '<div class="pjb__iso-layer" style="' + st + '"' + auto + ">" + depthEl + face + "</div>";
    }).join("");
    var maxz = Math.max(0, items.length - 1) * distance + maxDepth;
    return kicker(b.kicker) + heading(b.heading) +
      '<div class="pjb__iso pjb__iso--' + mode + " pjb__iso--" + dir + '" data-iso style="--distance:' + distance + "px;--depth:" + depth + "px;--maxz:" + maxz + 'px">' +
      '<div class="pjb__iso-stage">' + layers + "</div></div>";
  }

  var RENDERERS = {
    text: textBlock, statement: stmtBlock, metrics: metricsBlock,
    steps: stepsBlock, media: mediaBlock, split: splitBlock, faq: faqBlock,
    cards: cardsBlock, gallery: galleryBlock, figure: figureBlock,
    columns: columnsBlock, rows: rowsBlock, compare: compareBlock, stickies: stickiesBlock, voices: voicesBlock,
    workflow: workflowBlock, mediagrid: mediagridBlock, device: deviceBlock, isolayers: isolayersBlock,
  };
  function renderBlock(b, i) {
    var navLabel = b.nav || "";
    var idAttr = navLabel ? ' id="pjs-' + slug(navLabel, i) + '"' : "";
    var navAttr = navLabel ? ' data-nav="' + attr(navLabel) + '"' : "";
    var locked = b.locked && !isUnlocked(activeId);
    var inner = locked ? lockedBlock(b) : ((RENDERERS[b.type] || function () { return ""; })(b));
    var hsize = b.hsize === "sm" ? " pjb--hsm" : b.hsize === "lg" ? " pjb--hlg" : "";
    var flush = b.sep === false ? " pjb--flush" : "";
    return '<section class="pjb pjb--' + esc(b.type) + (locked ? " pjb--locked" : "") + hsize + flush + '"' + idAttr + navAttr +
      ' data-block="' + i + '" style="--i:' + i + '">' + inner + "</section>";
  }

  /* ---------- hero + shell content ---------- */
  function metaGrid(st) {
    var rows = [["Role", st.role], ["Team", st.team], ["Timeline", st.timeline], ["Scope", st.scope]]
      .filter(function (r) { return r[1]; });
    if (!rows.length) return "";
    return '<dl class="pj__meta">' + rows.map(function (r) {
      return '<div class="pj__meta-cell"><dt>' + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }
  function tocHtml(blocks, showIntro) {
    var items = blocks.map(function (b, i) { return b.nav ? { label: b.nav, id: "pjs-" + slug(b.nav, i) } : null; }).filter(Boolean);
    if (items.length + (showIntro ? 1 : 0) < 2) return "";
    var chips = showIntro ? '<button class="pj__toc-chip pj__toc-chip--intro is-active" data-goto="__intro">Project info</button>' : "";
    return chips + items.map(function (it, i) {
      return '<button class="pj__toc-chip' + (!showIntro && i === 0 ? " is-active" : "") + '" data-goto="' + it.id + '">' + esc(it.label) + "</button>";
    }).join("");
  }
  function coverHtml(w, st) {
    var cov = w.image || (st && st.cover);   // unified: the project image doubles as the case-study cover
    var c = typeof cov === "string" ? { src: cov } : (cov || null);
    if (c && mediaSrc(c)) return '<div class="pj__cover">' + mediaEl(c, "pj__cover-el") + "</div>";
    return '<div class="pj__cover pj__cover--ph pjb__shot-ph--' + esc(w.theme || "edge") + '"><span class="pj__cover-card">' + esc(w.plateTag || w.client || "") + "</span></div>";
  }
  function coverParallax() {
    if (!scroller || document.documentElement.classList.contains("lite")) return;
    var el = scroller.querySelector(".pj__cover-el");
    if (!el) return;
    var cov = el.parentNode;
    var h = (cov && cov.clientHeight) || 300;
    var ty = Math.max(0, Math.min(h * 0.14, scroller.scrollTop * 0.2));
    el.style.transform = "translate3d(0," + ty.toFixed(1) + "px,0)";
  }
  var cmpDrag = null;
  function cmpMove(e) {
    if (!cmpDrag) return;
    var r = cmpDrag.getBoundingClientRect();
    var x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    var pct = Math.max(2, Math.min(98, ((x - r.left) / r.width) * 100));
    cmpDrag.style.setProperty("--pos", pct.toFixed(1) + "%");
    if (e.cancelable) e.preventDefault();
  }
  function cmpEnd() { cmpDrag = null; document.removeEventListener("pointermove", cmpMove); document.removeEventListener("pointerup", cmpEnd); }
  function emptyStudy(w) {
    var tags = (w.tags || []).map(function (t) { return "<span>" + esc(t) + "</span>"; }).join("");
    return '<section class="pjb pjb--text" style="--i:0">' +
      '<div class="pjb__prose"><p>' + md(w.desc || "") + "</p></div>" +
      (tags ? '<div class="pj__tags">' + tags + "</div>" : "") +
      '<div class="pjb__cta"><p>A detailed case study for this project is available on request.</p>' +
      '<a class="pj__btn pj__btn--primary" href="#contact" data-pj="contact">Get in touch →</a></div></section>';
  }
  // Rounded contact + résumé controls (same as the home dock), laid out horizontally.
  function contactDock() {
    var d = data(); var c = (d && d.contact) || {};
    var out = "";
    if (c.resume) {
      out += '<a class="dock__btn" data-pj="resume" href="' + (/^data:/.test(c.resume) ? "#" : attr(c.resume)) + '" target="_blank" rel="noopener" data-label="R\u00e9sum\u00e9" aria-label="Open r\u00e9sum\u00e9">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg></a>';
    }
    if (c.linkedin) {
      out += '<a class="dock__btn" href="' + attr(c.linkedin) + '" target="_blank" rel="noopener" data-label="LinkedIn" aria-label="LinkedIn">' +
        '<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3.2 9h3.6v11.5H3.2zM9 9h3.45v1.57h.05c.48-.9 1.65-1.85 3.4-1.85 3.64 0 4.3 2.4 4.3 5.5v6.28h-3.6v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9z"/></svg></a>';
    }
    if (c.email) {
      out += '<a class="dock__btn" href="mailto:' + attr(c.email) + '" data-label="Email" aria-label="Email me">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg></a>';
    }
    var tel = c.phoneRaw || c.phone;
    if (tel) {
      out += '<a class="dock__btn" href="tel:' + attr(tel) + '" data-label="Call" aria-label="Call me">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 5 5l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z"/></svg></a>';
    }
    if (!out) return "";
    return '<div class="pj__cta"><div class="pj__cta-dock">' + out + "</div></div>";
  }
  function navFoot(prevW, nextW) {
    var card = function (w, dir) {
      if (!w) return '<div class="pj__foot-card pj__foot-card--empty"></div>';
      return '<button class="pj__foot-card" data-open="' + attr(w.id) + '">' +
        '<span class="pj__foot-dir">' + (dir === "next" ? "Next project \u2192" : "\u2190 Previous") + "</span>" +
        '<span class="pj__foot-title">' + esc(w.title) + "</span>" +
        '<span class="pj__foot-client">' + esc(w.client) + "</span></button>";
    };
    return '<footer class="pj__foot">' +
      contactDock() +
      '<div class="pj__foot-cards">' + card(prevW, "prev") + card(nextW, "next") + "</div>" +
      '<button class="pj__btn pj__btn--ghost pj__foot-back" data-pj="back">← All work</button></footer>';
  }
  function contentHtml(w) {
    var st = w.study || {};
    var blocks = st.blocks || [];
    var sibs = siblings(w.id);
    var idx = sibs.findIndex(function (x) { return x.id === w.id; });
    var nextW = sibs.length > 1 ? sibs[(idx + 1 + sibs.length) % sibs.length] : null;
    var prevW = sibs.length > 1 ? sibs[(idx - 1 + sibs.length) % sibs.length] : null;
    var hero =
      '<header class="pj__hero">' +
        '<div class="pj__eyebrow">' + esc(w.client) + (w.period ? " · " + esc(w.period) : "") + "</div>" +
        '<h1 class="pj__title">' + md(w.title) + "</h1>" +
        '<p class="pj__tagline">' + md(st.tagline || w.desc || "") + "</p>" +
        metaGrid(st) +
      "</header>";
    var bodyBlocks = blocks.length ? blocks.map(renderBlock).join("") : emptyStudy(w);
    var hasCover = !!(w.image || (st && st.cover));
    var cover = (hasCover || blocks.length) ? coverHtml(w, st) : "";
    return cover + hero + '<div class="pj__body">' + bodyBlocks + "</div>" + navFoot(prevW, nextW);
  }

  /* ---------- media lightbox (image zoom / pan) + fullscreen ---------- */
  function reqFs(el) { var fn = el && (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen); if (fn) { try { fn.call(el); } catch (e) {} } }
  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function exitFs() { var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen; if (fn) { try { fn.call(document); } catch (e) {} } }
  function toggleElFs(el) { if (fsEl() === el) exitFs(); else reqFs(el); }
  function toggleFrameFs(btn) { var f = btn.closest(".pjb__frame"); toggleElFs((f && f.querySelector(".pjb__frame-el")) || f); }

  var lbx = null, lbxImg = null, lbxCap = null, lbxScale = 1, lbxX = 0, lbxY = 0, lbxReturn = null;
  var lbxNav = null, lbxGroup = [], lbxIdx = 0;
  function lbxApply() {
    lbxImg.style.transform = "translate(" + lbxX.toFixed(1) + "px," + lbxY.toFixed(1) + "px) scale(" + lbxScale.toFixed(3) + ")";
    lbx.classList.toggle("is-zoomed", lbxScale > 1.001);
  }
  function lbxZoom(f) {
    var prev = lbxScale;
    lbxScale = Math.max(1, Math.min(6, lbxScale * f));
    if (lbxScale <= 1.001) { lbxScale = 1; lbxX = 0; lbxY = 0; }
    else { var r = lbxScale / prev; lbxX *= r; lbxY *= r; }
    lbxApply();
  }
  function lbxReset() { lbxScale = 1; lbxX = 0; lbxY = 0; lbxApply(); }
  function buildLbx() {
    lbx = document.createElement("div");
    lbx.className = "pjx";
    lbx.setAttribute("role", "dialog"); lbx.setAttribute("aria-modal", "true"); lbx.setAttribute("aria-label", "Image viewer");
    lbx.innerHTML =
      '<div class="pjx__ctrl">' +
        '<button class="pjx__btn" type="button" data-lz="out" aria-label="Zoom out" title="Zoom out">\u2212</button>' +
        '<button class="pjx__btn" type="button" data-lz="in" aria-label="Zoom in" title="Zoom in">+</button>' +
        '<button class="pjx__btn" type="button" data-lz="reset" aria-label="Reset zoom" title="Reset">\u21ba</button>' +
        '<button class="pjx__btn pjx__btn--close" type="button" data-lx aria-label="Close" title="Close">\u2715</button>' +
      '</div>' +
      '<figure class="pjx__stage"><img class="pjx__img" alt="" draggable="false" /></figure>' +
      '<div class="pjx__cap"></div>' +
      '<div class="pjx__nav" hidden>' +
        '<button class="pjx__btn" type="button" data-ln="prev" aria-label="Previous image" title="Previous (\u2190)">\u2039</button>' +
        '<button class="pjx__btn" type="button" data-ln="next" aria-label="Next image" title="Next (\u2192)">\u203a</button>' +
      '</div>';
    document.body.appendChild(lbx);
    lbxImg = lbx.querySelector(".pjx__img");
    lbxCap = lbx.querySelector(".pjx__cap");
    lbxNav = lbx.querySelector(".pjx__nav");
    var stage = lbx.querySelector(".pjx__stage");
    lbx.addEventListener("click", function (e) {
      if (e.target.closest("[data-lx]")) { closeLbx(); return; }
      var z = e.target.closest("[data-lz]");
      if (z) { var k = z.getAttribute("data-lz"); if (k === "in") lbxZoom(1.4); else if (k === "out") lbxZoom(1 / 1.4); else lbxReset(); return; }
      var nb = e.target.closest("[data-ln]");
      if (nb) { lbxGo(nb.getAttribute("data-ln") === "prev" ? -1 : 1); return; }
      if (e.target === lbx || e.target === stage) closeLbx();
    });
    stage.addEventListener("wheel", function (e) { e.preventDefault(); lbxZoom(e.deltaY < 0 ? 1.18 : 1 / 1.18); }, { passive: false });
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    lbxImg.addEventListener("pointerdown", function (e) {
      if (lbxScale <= 1) return;
      dragging = true; sx = e.clientX; sy = e.clientY; ox = lbxX; oy = lbxY;
      try { lbxImg.setPointerCapture(e.pointerId); } catch (er) {}
      lbx.classList.add("is-grab");
    });
    lbxImg.addEventListener("pointermove", function (e) { if (!dragging) return; lbxX = ox + (e.clientX - sx); lbxY = oy + (e.clientY - sy); lbxApply(); });
    var endDrag = function () { dragging = false; lbx.classList.remove("is-grab"); };
    lbxImg.addEventListener("pointerup", endDrag);
    lbxImg.addEventListener("pointercancel", endDrag);
    lbxImg.addEventListener("dblclick", function () { if (lbxScale > 1) lbxReset(); else lbxZoom(2.2); });
    document.addEventListener("keydown", function (e) {
      if (!lbx || !lbx.classList.contains("is-open")) return;
      if (e.key === "Escape") { e.stopPropagation(); closeLbx(); }
      else if (e.key === "+" || e.key === "=") lbxZoom(1.4);
      else if (e.key === "-" || e.key === "_") lbxZoom(1 / 1.4);
      else if (e.key === "0") lbxReset();
      else if (e.key === "ArrowLeft") { e.preventDefault(); lbxGo(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); lbxGo(1); }
    }, true);
  }
  function showLbxItem(i) {
    var it = lbxGroup[i]; if (!it) return;
    lbxIdx = i;
    lbxScale = 1; lbxX = 0; lbxY = 0; lbxImg.src = it.src; lbxApply();
    var html = (it.title ? '<b class="pjx__cap-t">' + esc(it.title) + "</b>" : "") + (it.cap ? '<span class="pjx__cap-d">' + esc(it.cap) + "</span>" : "");
    lbxCap.innerHTML = html; lbxCap.style.display = html ? "" : "none";
    if (lbxNav) lbxNav.hidden = lbxGroup.length < 2;
  }
  function lbxGo(delta) {
    if (lbxGroup.length < 2) return;
    showLbxItem((lbxIdx + delta + lbxGroup.length) % lbxGroup.length);
  }
  function openLbx(group, idx) {
    if (!group || !group.length) return;
    if (!lbx) buildLbx();
    lbxGroup = group;
    showLbxItem(idx || 0);
    lbxReturn = document.activeElement;
    void lbx.offsetWidth;                 // reflow so the open transition plays (rAF is throttled in background tabs)
    lbx.classList.add("is-open");
    var c = lbx.querySelector(".pjx__btn--close"); if (c) { try { c.focus(); } catch (e) {} }
  }
  function closeLbx() {
    if (!lbx) return;
    lbx.classList.remove("is-open", "is-zoomed", "is-grab");
    setTimeout(function () { if (lbx && !lbx.classList.contains("is-open")) lbxImg.src = ""; }, 300);
    if (lbxReturn && lbxReturn.focus) { try { lbxReturn.focus(); } catch (e) {} }
  }

  /* ---------- overlay shell ---------- */
  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "pj";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Project case study");
    overlay.setAttribute("data-lenis-prevent", "");
    overlay.innerHTML =
      '<div class="pj__scroll">' +
        '<div class="pj__ctrl">' +
          '<button class="pj__icon" data-pj="prev" aria-label="Previous project" title="Previous">‹</button>' +
          '<button class="pj__icon" data-pj="next" aria-label="Next project" title="Next">›</button>' +
          '<button class="pj__icon pj__icon--close" data-pj="close" aria-label="Close case study" title="Close">✕</button>' +
        '</div>' +
        '<div class="pj__shell">' +
          '<aside class="pj__side">' +
            '<div class="pj__side-head" data-crumb></div>' +
            '<nav class="pj__toc" data-toc aria-label="Sections"></nav>' +
            '<button class="pj__side-back" data-pj="back"><span aria-hidden="true">←</span> All work</button>' +
          '</aside>' +
          '<main class="pj__main" data-content></main>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    scroller = overlay.querySelector(".pj__scroll");

    // Lenis owns the page wheel and preventDefaults it, so we scroll the overlay
    // ourselves (only when Lenis is active — native scroll is fine in lite mode).
    overlay.addEventListener("wheel", function (e) {
      if (!window.__lenis) return;
      if (!scroller.contains(e.target)) return;
      var factor = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? Math.round(scroller.clientHeight * 0.9) : 1);
      scroller.scrollTop += e.deltaY * factor;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false, capture: true });

    scroller.addEventListener("scroll", function () {
      if (spyRaf) return;
      spyRaf = requestAnimationFrame(function () { spyRaf = 0; updateSpy(); coverParallax(); });
    }, { passive: true });

    overlay.addEventListener("pointerdown", function (e) {
      if (e.target.closest("[data-cmp-zoom]")) return; // let the expand button receive its click
      var cmp = e.target.closest(".pjb__cmp");
      if (!cmp) return;
      cmpDrag = cmp; cmpMove(e);
      document.addEventListener("pointermove", cmpMove);
      document.addEventListener("pointerup", cmpEnd);
    });
    overlay.addEventListener("click", onOverlayClick);
    overlay.addEventListener("dblclick", function (e) {
      var v = e.target.closest("video.pjb__media-el, video.pj__cover-el");
      if (v) { e.preventDefault(); toggleElFs(v); return; }
      var cmp = e.target.closest(".pjb__cmp");
      if (cmp) { e.preventDefault(); openCmpLbx(cmp); }
    });
    overlay.addEventListener("keydown", onOverlayKey);
  }

  function onOverlayClick(e) {
    var fsB = e.target.closest("[data-fs]");
    if (fsB) { e.preventDefault(); toggleFrameFs(fsB); return; }
    var cmpZoom = e.target.closest("[data-cmp-zoom]");
    if (cmpZoom) { e.preventDefault(); openCmpLbx(cmpZoom.closest(".pjb__cmp")); return; }
    var zoomImg = e.target.closest("[data-zoom]");
    // Images inserted into a rich body (figure.rt__fig / .pjb__prose) are zoomable too, even without data-zoom.
    var richImg = zoomImg ? null : e.target.closest("figure.rt__fig img, .pjb__prose img");
    if (zoomImg || richImg) {
      e.preventDefault();
      var clickedImg = zoomImg || richImg, groupRoot, imgs;
      if (zoomImg) {
        groupRoot = zoomImg.closest(".pjb__gallery, .pjb__media, .pjb__mediagrid, .pjb__devices");
        imgs = groupRoot ? [].slice.call(groupRoot.querySelectorAll("img[data-zoom]")) : [];
      } else {
        groupRoot = richImg.closest(".pjb");
        imgs = groupRoot ? [].slice.call(groupRoot.querySelectorAll("figure.rt__fig img, .pjb__prose img")) : [];
      }
      if (imgs.indexOf(clickedImg) < 0) imgs = [clickedImg];
      var group = imgs.map(function (im) { return { src: im.currentSrc || im.src, cap: im.getAttribute("data-cap"), title: im.getAttribute("data-title") }; });
      openLbx(group, imgs.indexOf(clickedImg));
      return;
    }
    var goto = e.target.closest("[data-goto]");
    if (goto) { gotoSection(goto.getAttribute("data-goto")); return; }
    var open = e.target.closest("[data-open]");
    if (open) { openProject(open.getAttribute("data-open"), { push: true }); return; }
    var act = e.target.closest("[data-pj]");
    if (act) {
      var kind = act.getAttribute("data-pj");
      if (kind === "back" || kind === "close") { e.preventDefault(); closeProject({ push: true }); }
      else if (kind === "prev") nav(-1);
      else if (kind === "next") nav(1);
      else if (kind === "unlock") unlockFlow();
      else if (kind === "resume") { e.preventDefault(); var dz = data(); var rz = dz && dz.contact && dz.contact.resume; if (rz) { if (window.RK && window.RK.openResume) window.RK.openResume(rz); else window.open(rz, "_blank", "noopener"); } }
      else if (kind === "contact") { e.preventDefault(); closeProject({ push: true }); setTimeout(function () { var c = document.getElementById("contact"); if (c) c.scrollIntoView({ behavior: "smooth" }); }, 320); }
      return;
    }
    // Admin preview only: clicking a non-interactive part of a section tells the editor to
    // jump straight to that section (skips hunting through the nested list). Real controls
    // (links, buttons, media, embeds, fullscreen/zoom) keep their own behaviour.
    if (PREVIEW) {
      if (e.target.closest('a[href], button, video, iframe, audio, input, select, textarea, label, summary, [data-fs], [data-zoom], [data-cmp-zoom], [data-goto], [data-open]')) return;
      var sec = e.target.closest("[data-block]");
      if (sec) { try { window.parent.postMessage({ __rk: "selectBlock", index: +sec.getAttribute("data-block") }, "*"); } catch (err) {} }
    }
  }
  function onOverlayKey(e) {
    if (e.key === "Escape") { e.preventDefault(); closeProject({ push: true }); return; }
    if (e.key === "Tab") trapTab(e);
  }
  function trapTab(e) {
    var f = overlay.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
    f = [].slice.call(f).filter(function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Enhance isometric-layer blocks after render: (1) auto-derive each layer's height
  // colour by sampling its image (darkened) when the author didn't set one — falls
  // back silently if the canvas is cross-origin tainted; (2) double-click opens every
  // layer full-screen in the shared lightbox (single click does nothing).
  function isoEnhance(root) {
    var scope = root || document;
    [].slice.call(scope.querySelectorAll(".pjb__iso[data-iso]")).forEach(function (iso) {
      if (iso.__isoDone) return;
      iso.__isoDone = true;
      [].slice.call(iso.querySelectorAll(".pjb__iso-layer[data-iso-auto]")).forEach(function (layer) {
        var img = layer.querySelector("img.pjb__iso-media"); if (!img) return;
        var apply = function () {
          try {
            var s = 22, cv = document.createElement("canvas"); cv.width = s; cv.height = s;
            var cx = cv.getContext("2d"); cx.drawImage(img, 0, 0, s, s);
            var d = cx.getImageData(0, 0, s, s).data, r = 0, g = 0, b = 0, n = 0;
            for (var p = 0; p < d.length; p += 4) { if (d[p + 3] < 24) continue; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; }
            if (n) layer.style.setProperty("--hc", "rgb(" + Math.round(r / n * .6) + "," + Math.round(g / n * .6) + "," + Math.round(b / n * .6) + ")");
          } catch (e) {}
        };
        if (img.complete && img.naturalWidth) apply(); else img.addEventListener("load", apply, { once: true });
      });
      var faces = [].slice.call(iso.querySelectorAll("img.pjb__iso-media"));
      faces.forEach(function (im) { im.removeAttribute("data-zoom"); });
      iso.addEventListener("dblclick", function () {
        // Re-query the layer images at click time — a list cached at enhance time can go stale
        // (late-loading images, or the churny admin preview), collapsing the group to one and
        // hiding the prev/next nav. Number each so the viewer knows where they are in the stack.
        var live = [].slice.call(iso.querySelectorAll("img.pjb__iso-media"));
        var n = live.length;
        var group = live.map(function (im, k) { return { src: im.getAttribute("src"), cap: "Layer " + (k + 1) + " of " + n }; }).filter(function (x) { return x.src; });
        if (group.length) openLbx(group, group.length - 1);
      });
      if (faces.length) { iso.style.cursor = "zoom-in"; iso.title = "Double-click to view every layer"; }
    });
  }

  function fillContent(w) {
    var head = overlay.querySelector("[data-crumb]");
    head.innerHTML = '<b>' + esc(w.client || "") + "</b>" + (w.plateTag ? "<span>" + esc(w.plateTag) + "</span>" : "");
    var st = w.study || {};
    var blocks = st.blocks || [];
    var showIntro = !!(w.image || st.cover) || blocks.length > 0;
    overlay.querySelector("[data-toc]").innerHTML = tocHtml(blocks, showIntro);
    var contentEl = overlay.querySelector("[data-content]");
    var html = contentHtml(w);
    // In the admin live-preview, re-rendering the SAME project on every keystroke
    // must not tear down embed iframes/videos (reparenting an iframe reloads it —
    // a distracting flash). Morph the DOM instead, leaving unchanged media in place.
    if (PREVIEW && contentEl.getAttribute("data-wid") === String(w.id) && contentEl.firstChild) {
      morphInto(contentEl, html);
    } else {
      contentEl.innerHTML = html;
    }
    contentEl.setAttribute("data-wid", String(w.id));
    requestAnimationFrame(function () { updateSpy(); coverParallax(); normalizeGalleries(contentEl); isoEnhance(contentEl); });
  }

  // Minimal DOM morph: update text/attributes in place and add/remove nodes, but
  // leave any <iframe>/<video> whose src is unchanged completely untouched, so the
  // embed keeps playing and never reloads. Used only for same-project preview refreshes.
  function morphInto(container, html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    morphChildren(container, tmp);
  }
  function morphChildren(oldParent, newParent) {
    var oldKids = [].slice.call(oldParent.childNodes);
    var newKids = [].slice.call(newParent.childNodes);
    for (var i = 0; i < newKids.length; i++) {
      var n = newKids[i], o = oldKids[i];
      if (!o) { oldParent.appendChild(n); continue; }
      if (o.nodeType !== n.nodeType || (o.nodeType === 1 && o.nodeName !== n.nodeName)) { oldParent.replaceChild(n, o); continue; }
      morphNode(o, n);
    }
    for (var j = oldKids.length - 1; j >= newKids.length; j--) oldParent.removeChild(oldKids[j]);
  }
  function morphNode(o, n) {
    if (o.nodeType === 3 || o.nodeType === 8) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    if (o.nodeType !== 1) return;
    var tag = o.nodeName;
    // Same embed (identical src) → keep the live node, sync only its other attributes.
    if ((tag === "IFRAME" || tag === "VIDEO") && o.getAttribute("src") === n.getAttribute("src")) { morphAttrs(o, n); return; }
    morphAttrs(o, n);
    morphChildren(o, n);
  }
  function morphAttrs(o, n) {
    var i, oa = o.attributes, na = n.attributes;
    for (i = na.length - 1; i >= 0; i--) { if (o.getAttribute(na[i].name) !== na[i].value) o.setAttribute(na[i].name, na[i].value); }
    for (i = oa.length - 1; i >= 0; i--) { if (!n.hasAttribute(oa[i].name)) o.removeAttribute(oa[i].name); }
  }

  function nav(dir) {
    var sibs = siblings(activeId);
    if (sibs.length < 2) return;
    var idx = sibs.findIndex(function (x) { return x.id === activeId; });
    var target = sibs[(idx + dir + sibs.length) % sibs.length];
    if (target) openProject(target.id, { push: true });
  }

  /* ---------- scroll-spy + jump ---------- */
  function topOffset() {
    if (window.matchMedia && window.matchMedia("(min-width: 1000px)").matches) return 24;
    var side = overlay.querySelector(".pj__side");
    return side ? side.offsetHeight + 8 : 60;
  }
  function updateSpy() {
    if (!overlay || !overlay.classList.contains("is-open")) return;
    var secs = [].slice.call(overlay.querySelectorAll("[data-nav]"));
    if (!secs.length) return;
    var y = scroller.scrollTop + topOffset() + 14;
    var id;
    if (overlay.querySelector(".pj__toc-chip--intro") && y < secs[0].offsetTop) {
      id = "__intro";
    } else {
      var active = secs[0];
      secs.forEach(function (s) { if (s.offsetTop <= y) active = s; });
      id = active ? active.id : null;
    }
    overlay.querySelectorAll(".pj__toc-chip").forEach(function (c) {
      c.classList.toggle("is-active", c.getAttribute("data-goto") === id);
    });
  }
  function gotoSection(id) {
    if (id === "__intro") {
      var cov = overlay.querySelector(".pj__cover");
      var vh = scroller.clientHeight || window.innerHeight || 700;
      scroller.scrollTo({ top: cov ? Math.max(0, cov.offsetHeight - vh * 0.5) : 0, behavior: "smooth" });
      return;
    }
    var sec = overlay.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
    if (!sec) return;
    scroller.scrollTo({ top: Math.max(0, sec.offsetTop - topOffset() - 8), behavior: "smooth" });
  }

  /* ---------- background lock + a11y ---------- */
  function lockBg(on) {
    if (on) {
      if (window.__lenis && window.__lenis.stop) window.__lenis.stop();
      document.documentElement.classList.add("pj-lock");
    } else {
      if (window.__lenis && window.__lenis.start) window.__lenis.start();
      document.documentElement.classList.remove("pj-lock");
    }
  }
  function setSiteInert(on) {
    ["#nav", "#top", ".footer", ".menu", ".scroll-progress"].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (on) el.setAttribute("aria-hidden", "true"); else el.removeAttribute("aria-hidden");
    });
  }

  /* ---------- open / close ---------- */
  function openProject(id, opts) {
    opts = opts || {};
    var w = workById(id);
    if (!w || w.encWork) { closeProject(opts); return; }   // hidden/encrypted project — not viewable without its ticket
    var firstOpen = !overlay || !overlay.classList.contains("is-open");
    if (!overlay) buildOverlay();
    if (firstOpen) {
      returnScrollY = window.scrollY || window.pageYOffset || 0;
      lastFocus = document.activeElement;
      lockBg(true);
      setSiteInert(true);
    }
    activeId = id;
    var prevScroll = scroller ? scroller.scrollTop : 0;
    fillContent(w);
    document.title = w.title ? (plain(w.title) + " \u2014 Ritesh Kumar") : DEFAULT_TITLE;
    if (opts.push !== false) { try { history.pushState({ rkWork: id }, "", "/work/" + id); } catch (e) {} }
    scroller.scrollTop = opts.keepScroll ? prevScroll : 0;
    if (firstOpen) requestAnimationFrame(function () { overlay.classList.add("is-open"); requestAnimationFrame(updateSpy); });
    else updateSpy();
    if (!opts.silent) focusOverlay();
  }
  function focusOverlay() { var f = overlay && overlay.querySelector(".pj__icon--close"); if (f) { try { f.focus(); } catch (e) {} } }

  function closeProject(opts) {
    opts = opts || {};
    var wasOpen = overlay && overlay.classList.contains("is-open");
    if (wasOpen) {
      overlay.classList.remove("is-open");
      lockBg(false);
      setSiteInert(false);
      document.title = DEFAULT_TITLE;
      var y = returnScrollY;
      requestAnimationFrame(function () {
        if (window.__lenis && window.__lenis.scrollTo) window.__lenis.scrollTo(y, { immediate: true });
        else window.scrollTo(0, y);
      });
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }
    activeId = null;
    if (opts.push !== false) { try { history.pushState({}, "", "/"); } catch (e) {} }
  }

  /* ---------- unlock (gated deeper tier) ---------- */
  function unlockFlow() {
    var w = workById(activeId);
    if (!w || !w.study) return;
    var st = w.study;
    var passWrap = st.enc && st.enc.wraps && st.enc.wraps.pass;
    var hash = st.unlockHash || "";
    passModal({
      title: "Unlock the full case study",
      sub: "Enter the pass you were given to reveal the deeper cut.",
      placeholder: "Your pass", cta: "Unlock", password: false,
      onSubmit: async function (v, err) {
        if (passWrap) {
          var ok = await unlockStudyWithCred(st, v, passWrap);
          if (!ok) { err.textContent = "That pass doesn't match."; return false; }
        } else {
          if (!hash) { err.textContent = "No deeper cut is set for this project."; return false; }
          var h = await sha256(v.toLowerCase());
          if (h !== hash) { err.textContent = "That pass doesn't match."; return false; }
        }
        setUnlocked(activeId);
        fillContent(w);
        var lb = (st.blocks || []).filter(function (b) { return b.locked; })[0];
        if (lb && lb.nav) requestAnimationFrame(function () { gotoSection("pjs-" + slug(lb.nav, 0)); });
        return true;
      },
    });
  }
  function passModal(opts) {
    var modal = document.createElement("div");
    modal.className = "pass";
    modal.innerHTML =
      '<div class="pass__box"><div class="pass__title">' + esc(opts.title) + "</div>" +
      '<div class="pass__sub">' + esc(opts.sub) + "</div>" +
      '<input type="' + (opts.password ? "password" : "text") + '" placeholder="' + attr(opts.placeholder || "") + '" autocomplete="off" />' +
      '<div class="pass__err"></div>' +
      '<div class="pass__actions"><button class="btn btn--ghost" data-cancel>Cancel</button>' +
      '<button class="btn btn--primary" data-go>' + esc(opts.cta || "Enter") + "</button></div></div>";
    document.body.appendChild(modal);
    var inp = modal.querySelector("input"), err = modal.querySelector(".pass__err");
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
    var done = function () { modal.remove(); };
    modal.querySelector("[data-cancel]").addEventListener("click", done);
    modal.addEventListener("click", function (e) { if (e.target === modal) done(); });
    function submit() {
      var v = inp.value.trim();
      if (!v) { err.textContent = "Enter your pass"; return; }
      Promise.resolve(opts.onSubmit(v, err)).then(function (ok) { if (ok) done(); });
    }
    modal.querySelector("[data-go]").addEventListener("click", submit);
    modal.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); if (e.key === "Escape") done(); });
  }

  /* ---------- routing ---------- */
  function pathWorkId() {
    var m = location.pathname.match(/\/work\/([^\/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    var q = new URLSearchParams(location.search).get("work");
    return q ? String(q) : null;
  }
  function route() {
    var id = pathWorkId();
    if (id && workById(id)) openProject(id, { push: false });
    else closeProject({ push: false });
  }
  function onDocLinkClick(e) {
    var a = e.target.closest && e.target.closest("a[data-work]");
    if (!a || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var id = a.getAttribute("data-work");
    if (!id || !workById(id)) return;
    e.preventDefault();
    openProject(id, { push: true });
  }
  function initDeepLink() {
    var id = pathWorkId();
    if (!id) return;
    if (!workById(id)) { try { history.replaceState({}, "", "/"); } catch (e) {} return; }
    try { history.replaceState({ rkWork: id }, "", "/work/" + id); } catch (e) {}
    openProject(id, { push: false });
  }

  /* ---------- bootstrap ---------- */
  function init() {
    if (window.RK) { window.RK.openProject = openProject; window.RK.closeProject = closeProject; window.RK.iconSvg = iconSvg; window.RK.iconNames = function () { return Object.keys(ICONS); }; window.RK.setStudyUnlocked = setUnlocked; window.RK.decryptStudyBlocks = decryptStudyBlocks; window.RK.unlockStudyWithCred = unlockStudyWithCred; }
    window.addEventListener("resize", function () { if (overlay && overlay.classList.contains("is-open")) { updateSpy(); clearTimeout(galleryTimer); galleryTimer = setTimeout(function () { normalizeGalleries(); }, 160); } });
    if (PREVIEW) { document.documentElement.classList.add("rk-preview"); return; } // the admin editor drives the overlay; skip link/history/deep-link wiring
    document.addEventListener("click", onDocLinkClick);
    window.addEventListener("popstate", route);
    initDeepLink();
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
