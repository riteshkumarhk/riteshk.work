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
  function mediaSrc(m) { return (m && (m.src || m.image)) || ""; }
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
      return '<figure class="pjb__shot">' + body + cap + "</figure>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__media">' + shots + "</div>";
  }
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
      return '<figure class="pjb__slide">' + body + cap + "</figure>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__gallery" tabindex="0"><div class="pjb__gallery-track">' + slides + "</div></div>";
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
      var media = mediaSrc(c) ? '<div class="pjb__coln-media">' + mediaEl(c, "pjb__media-el") + "</div>" : "";
      return '<div class="pjb__coln">' +
        (c.label ? '<div class="pjb__coln-lbl">' + esc(c.label) + "</div>" : "") +
        (c.heading ? '<h3 class="pjb__coln-h">' + md(c.heading) + "</h3>" : "") +
        prose(c.body) +
        media + "</div>";
    }).join("");
    return kicker(b.kicker) + heading(b.heading) + '<div class="pjb__cols">' + items + "</div>";
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
      '<span class="pjb__cmp-lbl pjb__cmp-lbl--l">' + esc(b.beforeLabel || "Before") + "</span>" +
      '<span class="pjb__cmp-lbl pjb__cmp-lbl--r">' + esc(b.afterLabel || "After") + "</span>" +
      "</div>";
    return kicker(b.kicker) + heading(b.heading) + cmp + note;
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

  var RENDERERS = {
    text: textBlock, statement: stmtBlock, metrics: metricsBlock,
    steps: stepsBlock, media: mediaBlock, split: splitBlock, faq: faqBlock,
    cards: cardsBlock, gallery: galleryBlock, figure: figureBlock,
    columns: columnsBlock, compare: compareBlock,
  };
  function renderBlock(b, i) {
    var navLabel = b.nav || "";
    var idAttr = navLabel ? ' id="pjs-' + slug(navLabel, i) + '"' : "";
    var navAttr = navLabel ? ' data-nav="' + attr(navLabel) + '"' : "";
    var locked = b.locked && !isUnlocked(activeId);
    var inner = locked ? lockedBlock(b) : ((RENDERERS[b.type] || function () { return ""; })(b));
    var hsize = b.hsize === "sm" ? " pjb--hsm" : b.hsize === "lg" ? " pjb--hlg" : "";
    return '<section class="pjb pjb--' + esc(b.type) + (locked ? " pjb--locked" : "") + hsize + '"' + idAttr + navAttr +
      ' style="--i:' + i + '">' + inner + "</section>";
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
  function navFoot(prevW, nextW) {
    var card = function (w, dir) {
      if (!w) return '<div class="pj__foot-card pj__foot-card--empty"></div>';
      return '<button class="pj__foot-card" data-open="' + attr(w.id) + '">' +
        '<span class="pj__foot-dir">' + (dir === "next" ? "Next project →" : "← Previous") + "</span>" +
        '<span class="pj__foot-title">' + esc(w.title) + "</span>" +
        '<span class="pj__foot-client">' + esc(w.client) + "</span></button>";
    };
    return '<footer class="pj__foot">' +
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
      var cmp = e.target.closest(".pjb__cmp");
      if (!cmp) return;
      cmpDrag = cmp; cmpMove(e);
      document.addEventListener("pointermove", cmpMove);
      document.addEventListener("pointerup", cmpEnd);
    });
    overlay.addEventListener("click", onOverlayClick);
    overlay.addEventListener("dblclick", function (e) {
      var v = e.target.closest("video.pjb__media-el, video.pj__cover-el");
      if (v) { e.preventDefault(); toggleElFs(v); }
    });
    overlay.addEventListener("keydown", onOverlayKey);
  }

  function onOverlayClick(e) {
    var fsB = e.target.closest("[data-fs]");
    if (fsB) { e.preventDefault(); toggleFrameFs(fsB); return; }
    var zoomImg = e.target.closest("[data-zoom]");
    if (zoomImg) {
      e.preventDefault();
      var groupRoot = zoomImg.closest(".pjb__gallery, .pjb__media");
      var imgs = groupRoot ? [].slice.call(groupRoot.querySelectorAll("img[data-zoom]")) : [];
      if (imgs.indexOf(zoomImg) < 0) imgs = [zoomImg];
      var group = imgs.map(function (im) { return { src: im.currentSrc || im.src, cap: im.getAttribute("data-cap"), title: im.getAttribute("data-title") }; });
      openLbx(group, imgs.indexOf(zoomImg));
      return;
    }
    var goto = e.target.closest("[data-goto]");
    if (goto) { gotoSection(goto.getAttribute("data-goto")); return; }
    var open = e.target.closest("[data-open]");
    if (open) { openProject(open.getAttribute("data-open"), { push: true }); return; }
    var act = e.target.closest("[data-pj]");
    if (!act) return;
    var kind = act.getAttribute("data-pj");
    if (kind === "back" || kind === "close") { e.preventDefault(); closeProject({ push: true }); }
    else if (kind === "prev") nav(-1);
    else if (kind === "next") nav(1);
    else if (kind === "unlock") unlockFlow();
    else if (kind === "contact") { e.preventDefault(); closeProject({ push: true }); setTimeout(function () { var c = document.getElementById("contact"); if (c) c.scrollIntoView({ behavior: "smooth" }); }, 320); }
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

  function fillContent(w) {
    var head = overlay.querySelector("[data-crumb]");
    head.innerHTML = '<b>' + esc(w.client || "") + "</b>" + (w.plateTag ? "<span>" + esc(w.plateTag) + "</span>" : "");
    var st = w.study || {};
    var blocks = st.blocks || [];
    var showIntro = !!(w.image || st.cover) || blocks.length > 0;
    overlay.querySelector("[data-toc]").innerHTML = tocHtml(blocks, showIntro);
    overlay.querySelector("[data-content]").innerHTML = contentHtml(w);
    requestAnimationFrame(function () { updateSpy(); coverParallax(); });
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
    if (!w) { closeProject(opts); return; }
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
    var hash = w.study.unlockHash || "";
    passModal({
      title: "Unlock the full case study",
      sub: "Enter the pass you were given to reveal the deeper cut.",
      placeholder: "Your pass", cta: "Unlock", password: false,
      onSubmit: async function (v, err) {
        if (!hash) { err.textContent = "No deeper cut is set for this project."; return false; }
        var h = await sha256(v.toLowerCase());
        if (h !== hash) { err.textContent = "That pass doesn't match."; return false; }
        setUnlocked(activeId);
        fillContent(w);
        var lb = (w.study.blocks || []).filter(function (b) { return b.locked; })[0];
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
    if (window.RK) { window.RK.openProject = openProject; window.RK.closeProject = closeProject; window.RK.iconSvg = iconSvg; window.RK.iconNames = function () { return Object.keys(ICONS); }; }
    window.addEventListener("resize", function () { if (overlay && overlay.classList.contains("is-open")) updateSpy(); });
    if (PREVIEW) return; // the admin editor drives the overlay; skip link/history/deep-link wiring
    document.addEventListener("click", onDocLinkClick);
    window.addEventListener("popstate", route);
    initDeepLink();
  }
  if (window.__siteRendered) init();
  else document.addEventListener("site:rendered", init, { once: true });
})();
