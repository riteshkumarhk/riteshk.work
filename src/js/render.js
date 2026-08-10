/* =================================================================
   RITESH KUMAR — content renderer
   Renders every editable section from content.json (the single
   source of truth). Exposes window.RK for the admin editor.
   ================================================================= */
(function () {
  "use strict";

  const DRAFT_KEY = "rk:content:draft";

  /* ---------- first-party analytics ----------
     Fire-and-forget intent events (case opens, deeper-cut unlocks, résumé, contact) to the Worker's
     /event. Owner devices are excluded using the SAME markers the Cloudflare beacon uses, plus a durable
     rk:owner flag set when you sign into the studio — so your own visits (PC or phone) never count. */
  const RK_EVENT_URL = "https://rk-ai-proxy.riteshkumarhk.workers.dev/event";
  function rkIsOwner() {
    try {
      return localStorage.getItem("rk:noanalytics") === "1"
        || localStorage.getItem("rk:owner") === "1"
        || !!localStorage.getItem("rk:admin:hash")
        || !!localStorage.getItem("rk:admin:sess")
        || /^\/studio(\/|$)/.test(location.pathname);
    } catch (e) { return false; }
  }
  function track(t, id) {
    try {
      if (!t || rkIsOwner()) return;
      const body = JSON.stringify({ t: t, id: id || "" });
      // text/plain keeps it a "simple" request (no CORS preflight); the Worker parses the body as JSON.
      if (navigator.sendBeacon) { navigator.sendBeacon(RK_EVENT_URL, new Blob([body], { type: "text/plain;charset=UTF-8" })); return; }
      fetch(RK_EVENT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: body, keepalive: true, credentials: "omit" }).catch(function () {});
    } catch (e) {}
  }
  window.__rkTrack = track;

  /* Build + download a vCard (.vcf) from the contact model — a "save my details" for recruiters.
     Pure client-side (Blob), no dependency. vCard 3.0 with CRLF line breaks. */
  function vcEsc(s) { return String(s == null ? "" : s).replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n"); }
  function saveVCard(C) {
    const name = String((C && C.name) || "").trim();
    const parts = name ? name.split(/\s+/) : [];
    const last = parts.length > 1 ? parts.pop() : "";
    const first = parts.join(" ");
    const lines = [
      "BEGIN:VCARD", "VERSION:3.0",
      "N:" + vcEsc(last) + ";" + vcEsc(first) + ";;;",
      "FN:" + vcEsc(name || "Contact"),
      C.email ? "EMAIL;TYPE=INTERNET:" + vcEsc(C.email) : "",
      C.phoneRaw ? "TEL;TYPE=CELL:" + vcEsc(C.phoneRaw) : "",
      C.website ? "URL:" + vcEsc(C.website) : "",
      C.linkedin ? "URL:" + vcEsc(C.linkedin) : "",
      "END:VCARD"
    ].filter(Boolean);
    try {
      const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/vcard;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = (name || "contact").replace(/\s+/g, "-") + ".vcf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (e) {}
    track("vcard_download");
  }

  /* Safety: never leave the page hidden if something fails */
  setTimeout(function () {
    document.body && document.body.classList.remove("site-loading");
  }, 4000);

  const esc = (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /* inline mini-markdown: [[accent]] -> bronze, **strong** -> bold, *em* -> italic accent */
  function md(s) {
    let t = esc(s);
    t = t.replace(/\[\[(.+?)\]\]/g, '<strong class="accent">$1</strong>');
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\*(.+?)\*/g, "<em>$1</em>");
    return t;
  }

  const byId = (id) => document.getElementById(id);
  const set = (id, html) => {
    const el = byId(id);
    if (el) el.innerHTML = html;
  };

  /* Open a résumé from a URL or an embedded data: URI. Browsers block top-level
     navigation to data: URLs, so convert those to a Blob URL first. */
  function openResume(src) {
    if (!src) return;
    track("resume_download");
    try {
      if (/^data:/.test(src)) {
        const m = src.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
        const mime = (m && m[1]) || "application/pdf";
        const payload = m ? m[3] : "";
        let bytes;
        if (m && m[2]) {
          const bin = atob(payload);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else {
          bytes = new TextEncoder().encode(decodeURIComponent(payload));
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        window.open(url, "_blank", "noopener");
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      } else {
        window.open(src, "_blank", "noopener");
      }
    } catch (e) {
      try { window.open(src, "_blank", "noopener"); } catch (e2) {}
    }
  }

  /* ---------- section renderers ---------- */
  // A highlight rides in the numbers marquee (a chip like the brand logos). The digits count up and
  // the trailing unit keeps the bronze suffix; an optional non-digit prefix (e.g. a "$" for revenue)
  // shows but isn't animated. Values with no digits, and the label, can carry *italic* / **bold** / [[bronze]].
  function highlightEl(h) {
    const m = String(h.value || "").match(/^(\D*)(\d+)(.*)$/);
    let numHtml, wordClass = "";
    if (m) {
      numHtml =
        (m[1] ? '<span class="hi__pre">' + esc(m[1]) + "</span>" : "") +
        '<span class="count" data-count="' + m[2] + '">0</span>' +
        (m[3] ? "<i>" + esc(m[3]) + "</i>" : "");
    } else {
      numHtml = md(h.value);
      wordClass = " hi__num--word";
    }
    return (
      '<span class="hi"><span class="hi__card"><span class="hi__num' + wordClass + '">' +
      numHtml + '</span><span class="hi__label">' + md(h.label) + "</span></span></span>"
    );
  }

  function plateInner(theme) {
    switch (theme) {
      case "edge": return '<div class="plate__grid"></div><div class="plate__glow"></div>';
      case "auth": return '<div class="plate__rings"></div>';
      case "search": return '<div class="plate__bars"></div>';
      case "auto": return '<div class="plate__road"></div>';
      case "xbox": return '<div class="plate__grid"></div>';
      case "grid": return '<div class="plate__grid"></div>';
      case "aurora": return '<div class="plate__aurora"></div>';
      case "orbit": return '<div class="plate__orbit"></div>';
      case "wave": return '<div class="plate__wave"></div>';
      case "mesh": return '<div class="plate__mesh"></div>';
      case "ember": return '<div class="plate__ember"></div>';
      default: return '<div class="plate__grid"></div><div class="plate__glow"></div>';
    }
  }

  // Per-thumbnail scroll parallax: the studio writes w.parDir ("up"/"down") + w.parAmt (0..100).
  // Always emit an explicit factor so the homepage motion matches the studio control exactly.
  // Unset cases use the SAME default the editor shows (up / 50), not a hidden per-position value.
  function parAttrs(w) {
    const amt = (w && w.parAmt != null && w.parAmt !== "") ? Math.max(0, Math.min(100, +w.parAmt || 0)) : 50;
    const sign = (w && w.parDir === "down") ? -1 : 1;   // "up" = positive factor (see main.js)
    const factor = sign * (amt / 100) * 0.24;
    const maxFrac = 0.03 + (amt / 100) * 0.10;          // 3%..13% of the tile height (within the 20% headroom)
    return ' data-par="' + factor.toFixed(4) + '" data-par-max="' + maxFrac.toFixed(3) + '"';
  }

  // Per-cover depth settings (studio "3D depth" menu) -> data attributes the runtime (depth.js)
  // reads each frame. Absent keys fall back to the engine defaults; on===false disables the cover.
  function depthAttrs(w) {
    const d = w && w.depth;
    if (!d) return "";
    if (d.on === false) return ' data-depth-off="1"';
    let s = "";
    if (d.strength != null && d.strength !== "") s += ' data-depth-strength="' + (+d.strength) + '"';
    if (d.softness != null && d.softness !== "") s += ' data-depth-softness="' + (+d.softness) + '"';
    if (d.focus != null && d.focus !== "") s += ' data-depth-focus="' + (+d.focus) + '"';
    if (d.zoom != null && d.zoom !== "") s += ' data-depth-zoom="' + (+d.zoom) + '"';
    if (d.map) s += ' data-depth-map="' + esc(String(d.map)).replace(/"/g, "&quot;") + '"';
    return s;
  }

  function caseEl(w, idx) {
    const n = String(idx + 1).padStart(2, "0");
    const tags = (w.tags || []).map((t) => "<span>" + esc(t) + "</span>").join("");
    const imgSrc = esc(w.image).replace(/"/g, "&quot;");
    // In the GRID layout, client + period are surfaced as an overlay inside the image
    // (styled to appear only for .cases--g2/.cases--g3). The below-image .case__meta stays in
    // the DOM as the accessible copy (screen-reader-only in grid) since the media is aria-hidden.
    const overlayMeta = '<div class="case__cm"><span class="case__cm-client">' + esc(w.client) +
      '</span><span class="case__cm-period">' + esc(w.period) + '</span></div>';
    const media = w.image
      ? '<div class="case__media case__media--photo" aria-hidden="true"' + depthAttrs(w) + '>' +
          '<div class="case__par"' + parAttrs(w) + '><img class="case__img" src="' + imgSrc + '" alt="" loading="lazy" /></div>' +
          '<span class="plate__idx">' + n + '</span>' +
          '<span class="plate__tag">' + esc(w.plateTag) + '</span>' + overlayMeta + '</div>'
      : '<div class="case__media case__media--' + esc(w.theme) + '" aria-hidden="true">' +
          '<div class="plate"><span class="plate__idx">' + n + "</span>" +
          plateInner(w.theme) +
          '<span class="plate__tag">' + esc(w.plateTag) + "</span>" + overlayMeta + "</div></div>";
    return (
      '<li class="case" data-reveal><a class="case__link" href="/work/' + esc(w.id) + '" data-work="' + esc(w.id) + '" data-cursor="view">' +
      media +
      '<div class="case__body"><div class="case__meta"><span>' + esc(w.client) +
      "</span><span>" + esc(w.period) + "</span></div>" +
      '<h3 class="case__title">' + esc(w.title) + "</h3>" +
      '<p class="case__desc">' + esc(w.desc) + "</p>" +
      '<div class="case__tags">' + tags + "</div></div></a></li>"
    );
  }

  function logoItem(g) {
    const nm = esc(g.name || "");
    const nmAttr = nm.replace(/"/g, "&quot;");
    const src = esc(g.src || "").replace(/"/g, "&quot;");
    const size = (g.size === "sm" || g.size === "lg") ? g.size : "md";
    return '<span class="logo" data-name="' + nmAttr + '">' +
      '<span class="logo__card logo__card--' + size + '">' +
        '<img class="logo__img" src="' + src + '" alt="' + nmAttr + '" loading="lazy" draggable="false" />' +
      "</span>" +
      (nm ? '<span class="logo__name">' + nm + "</span>" : "") +
      "</span>";
  }

  // ---- Header brand mark + favicon from landing.siteIcon (falls back to the RK monogram) ----
  function svgSan(s) {
    return String(s || "")
      .replace(/<\?xml[\s\S]*?\?>/gi, "")
      .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|data:text\/html)[^"']*\1/gi, "")
      .trim();
  }
  function svgAspect(svg) {
    var vb = /viewBox\s*=\s*["']\s*[\d.eE+-]+[\s,]+[\d.eE+-]+[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/i.exec(svg || "");
    if (vb) { var w = parseFloat(vb[1]), h = parseFloat(vb[2]); if (w > 0 && h > 0) return w / h; }
    return 1;
  }
  function iconDataUrl(ic) {
    if (ic && ic.svg) return "data:image/svg+xml," + encodeURIComponent(svgSan(ic.svg)).replace(/'/g, "%27");
    return (ic && ic.src) || "";
  }
  function applyBrand(L) {
    var mark = document.querySelector(".nav__mark");
    if (!mark) return;
    var ic = L && L.siteIcon, has = !!(ic && (ic.svg || ic.src)), mono = !!(has && ic.mono && ic.svg);
    mark.classList.toggle("nav__mark--logo", has);
    mark.classList.toggle("nav__mark--mono", mono);
    if (!has) { mark.style.removeProperty("--icon"); mark.style.removeProperty("--icon-ar"); mark.innerHTML = "RK"; return; }
    var url = iconDataUrl(ic);
    if (mono) {
      mark.innerHTML = "";
      mark.style.setProperty("--icon", "url('" + url + "')");
      mark.style.setProperty("--icon-ar", String(svgAspect(ic.svg)));
    } else {
      mark.style.removeProperty("--icon"); mark.style.removeProperty("--icon-ar");
      mark.innerHTML = '<img class="nav__mark-img" src="' + String(url).replace(/"/g, "&quot;") + '" alt="" />';
    }
  }
  var _favBound = false, _favDefault = null, _lastIcon = null;
  function favColor() { try { return (window.__theme && window.__theme.isLight()) ? "#141417" : "#ECE7E1"; } catch (e) { return "#ECE7E1"; } }
  function svgRecolor(svg, color) {
    var s = svgSan(svg);
    s = s.replace(/(fill|stroke)\s*=\s*(["'])(?!\s*(?:none|transparent|url\())[^"']*\2/gi, '$1="' + color + '"');
    s = s.replace(/(fill|stroke)\s*:\s*(?!\s*(?:none|transparent|url\())[^;"'}]+/gi, '$1:' + color);
    if (!/<svg[^>]*\bfill\s*=/i.test(s)) s = s.replace(/<svg\b/i, '<svg fill="' + color + '"');
    return s;
  }
  function favHref(ic) {
    if (ic && ic.svg) return "data:image/svg+xml," + encodeURIComponent(ic.mono ? svgRecolor(ic.svg, favColor()) : svgSan(ic.svg));
    return (ic && ic.src) || "";
  }
  function applyFavicon(L) {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    if (_favDefault === null) _favDefault = link.getAttribute("href") || "";
    var ic = L && L.siteIcon;
    _lastIcon = (ic && (ic.svg || ic.src)) ? ic : null;
    link.setAttribute("href", _lastIcon ? favHref(_lastIcon) : _favDefault);
    if (!_favBound) {
      _favBound = true;
      window.addEventListener("theme:change", function () {
        var l = document.querySelector('link[rel="icon"]');
        if (l && _lastIcon) l.setAttribute("href", favHref(_lastIcon));
      });
    }
  }

  function tlEl(p) {
    return (
      '<li class="tl reveal' + (p.present ? " tl--present" : "") + '" data-reveal>' +
      '<div class="tl__year">' + esc(p.years) + "</div>" +
      '<div class="tl__main"><h3>' + esc(p.role) + "</h3>" +
      '<span class="tl__org">' + esc(p.org) + "</span>" +
      "<p>" + esc(p.desc) + "</p></div></li>"
    );
  }

  /* ---------- recognition / education icons (AI-matched crisp line icons) ---------- */
  const RECOGNITION_ICONS = [
    ["trophy", "Trophy \u2014 award, honour, win"],
    ["award", "Medal \u2014 recognition, placed"],
    ["mic", "Mic \u2014 talk, speaker, conference"],
    ["zap", "Lightning \u2014 hackathon, sprint"],
    ["bike", "Bike \u2014 cycling, race"],
    ["flag", "Flag \u2014 championship, competition"],
    ["certificate", "Certificate \u2014 certification, certified"],
    ["graduation", "Graduation cap \u2014 degree, university"],
    ["book", "Book \u2014 schooling, study"],
    ["star", "Star \u2014 distinction, top honour"],
    ["sparkles", "Sparkles \u2014 AI, innovation"],
    ["mountain", "Mountain \u2014 outdoors, trail"],
  ];
  const RECOGNITION_ICON_SVG = {
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/><path d="M8 22h8"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    certificate: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="m9 15 2 2 4-4"/>',
    graduation: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    sparkles: '<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  };
  function recIcon(name) {
    const inner = RECOGNITION_ICON_SVG[name];
    if (!inner) return "";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  }

  function awardEl(a) {
    const ico = (a && a.icon && RECOGNITION_ICON_SVG[a.icon])
      ? '<span class="award__ico" aria-hidden="true">' + recIcon(a.icon) + "</span>"
      : "";
    return '<li><span class="award__main">' + ico + '<span class="award__title">' + esc(a.title) + "</span></span><i>" + esc(a.meta) + "</i></li>";
  }

  function galleryEl(g) {
    const src = (g && g.src) ? String(g.src).replace(/"/g, "&quot;") : "";
    if (!src) return "";
    const cap = (g && g.caption) ? '<figcaption class="gallery__cap">' + esc(g.caption) + "</figcaption>" : "";
    return '<figure class="gallery__item" data-reveal><img class="gallery__img" src="' + src + '" alt="' + esc((g && g.caption) || "") + '" loading="lazy" />' + cap + "</figure>";
  }

  /* ---------- About-page section layout (order + visibility) ----------
     The About page is composed of independent sections the owner can reorder and
     show/hide from the studio (data.aboutSections = [{key,on}]). Unknown/new keys
     fall back to the canonical order, all shown. */
  const ABOUT_SECTIONS = [
    ["about", "About"],
    ["recognition", "Recognition"],
    ["capabilities", "Capabilities"],
    ["path", "The Path"],
    ["education", "Education"],
  ];
  function aboutLayout(data) {
    const known = ABOUT_SECTIONS.map((s) => s[0]);
    const saved = (data && Array.isArray(data.aboutSections)) ? data.aboutSections : [];
    const out = [], seen = {};
    saved.forEach((s) => {
      if (s && known.indexOf(s.key) !== -1 && !seen[s.key]) {
        seen[s.key] = 1;
        out.push({ key: s.key, on: s.on !== false });
      }
    });
    known.forEach((k) => { if (!seen[k]) out.push({ key: k, on: true }); });
    return out;
  }
  function applyAboutLayout(data) {
    const wrap = byId("aboutSections");
    if (!wrap) return;
    const visible = [];
    aboutLayout(data).forEach((s) => {
      const el = document.getElementById("sec-" + s.key);
      if (!el) return;
      el.hidden = !s.on;
      el.classList.remove("sec--first", "sec--last");
      wrap.appendChild(el); // move into layout order (appendChild reorders existing nodes)
      if (s.on) visible.push(el);
    });
    // Mark the first/last *visible* section so the top one clears the fixed nav and the
    // bottom one keeps breathing room — robust even when a leading section is hidden.
    if (visible.length) {
      visible[0].classList.add("sec--first");
      visible[visible.length - 1].classList.add("sec--last");
    }
  }

  // ---- Work / landing page: reorderable + show/hide sections (mirrors the About model) ----
  const WORK_SECTIONS = [
    ["hero", "Statement"],
    ["intro", "Intro"],
    ["highlights", "Highlights"],
    ["work", "Selected work"],
    ["capabilities", "Capabilities"],
  ];
  function workLayout(data) {
    const known = WORK_SECTIONS.map((s) => s[0]);
    const saved = (data && Array.isArray(data.workSections)) ? data.workSections : [];
    const out = [], seen = {};
    saved.forEach((s) => {
      if (s && known.indexOf(s.key) !== -1 && !seen[s.key]) {
        seen[s.key] = 1;
        out.push({ key: s.key, on: s.on !== false });
      }
    });
    known.forEach((k, i) => {
      if (seen[k]) return;
      // Insert a key that's missing from the saved order (e.g. a newly-added section) next to its
      // canonical neighbour rather than dumping it at the end, so an upgrade stays sensible.
      let at = out.length;
      for (let j = i - 1; j >= 0; j--) {
        const idx = out.findIndex((o) => o.key === known[j]);
        if (idx !== -1) { at = idx + 1; break; }
      }
      out.splice(at, 0, { key: k, on: true });
    });
    return out;
  }
  function applyWorkLayout(data) {
    const wrap = byId("workSections");
    if (!wrap) return;
    const order = workLayout(data);
    const visible = [];
    order.forEach((s) => {
      const el = document.getElementById("wsec-" + s.key);
      if (!el) return;
      el.hidden = !s.on;
      el.classList.remove("sec--first", "sec--last");
      wrap.appendChild(el);
      if (s.on) visible.push(el);
    });
    if (visible.length) {
      visible[0].classList.add("sec--first");
      visible[visible.length - 1].classList.add("sec--last");
    }
    // The hero "Selected work" cue only makes sense when the hero leads and the work
    // section sits below it; otherwise hide it.
    const cue = document.querySelector(".hero__cue");
    if (cue) {
      const iHero = order.findIndex((s) => s.key === "hero" && s.on);
      const iWork = order.findIndex((s) => s.key === "work" && s.on);
      const showCue = !(data.landing && data.landing.show && data.landing.show.cue === false);
      cue.style.display = (showCue && iHero !== -1 && iWork > iHero) ? "" : "none";
    }
  }

  /* ---------- master render ---------- */
  function render(data) {
    const L = data.landing || {};
    const C = data.contact || {};
    const caps = data.capabilities || [];
    applyBrand(L); applyFavicon(L);

    // Landing pieces the owner can individually show/hide from the studio
    // (data.landing.show = {eyebrow,domains,intro,presence}; missing = shown).
    // The main statement is the hero anchor and always renders.
    const show = L.show || {};
    const showEyebrow = show.eyebrow !== false && !!L.eyebrow;
    const showDomains = show.domains !== false && !!L.domains;
    set("heroLabel",
      (showEyebrow || showDomains)
        ? ('<span class="tick">◦</span> ' +
           (showEyebrow ? esc(L.eyebrow) : "") +
           (showEyebrow && showDomains ? ' <span class="hero__label-sep">/</span> ' : "") +
           (showDomains ? esc(L.domains) : ""))
        : "");
    const heroLabelEl = byId("heroLabel");
    if (heroLabelEl) heroLabelEl.hidden = !(showEyebrow || showDomains);

    const lines = String(L.statement || "").split("\n").filter((x) => x.length);
    set("heroTitle",
      lines.map((ln) => '<span class="line" data-reveal><span>' + md(ln) + "</span></span>").join(""));
    const heroTitleEl = byId("heroTitle");
    if (heroTitleEl) heroTitleEl.className = "hero__title hero__title--" + (L.statementSize || "large");

    const showIntro = show.intro !== false;
    set("heroIntro", showIntro ? md(L.intro) : "");
    const heroIntroEl = byId("heroIntro");
    if (heroIntroEl) heroIntroEl.hidden = !showIntro;

    const showPresence = show.presence !== false;
    set("heroNowText", showPresence ? md(L.presence) : "");
    const heroNowEl = document.querySelector(".hero__now");
    if (heroNowEl) heroNowEl.hidden = !showPresence;
    const av = L.available || {};
    const avEl = byId("heroAvail");
    if (avEl) avEl.innerHTML = (av.on && av.text) ? ('<span class="hero__avail-dot" aria-hidden="true"></span>' + md(av.text)) : "";

    if (L.aboutLead) set("aboutLead", md(L.aboutLead));
    const aboutParas = String(L.about || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (aboutParas.length || L.aboutSign) set("aboutBody",
      aboutParas.map((p) => "<p>" + md(p) + "</p>").join("") +
      (L.aboutSign ? '<p class="about__sign">' + md(L.aboutSign) + "</p>" : ""));

    const one = caps.map((c) => "<span>" + esc(c) + '</span><span class="dot">✦</span>').join("");
    set("marqueeTrack", one + one);

    // Logo marquee (brands & products): full-colour logos with a hover name; the
    // per-logo elastic scroll + seamless repeat-to-fill are driven by main.js.
    const logos = (L.logos || []).filter((g) => g && g.src);
    const logoMarq = byId("logoMarquee");
    if (logoMarq) {
      if (logos.length) { set("logoTrack", logos.map(logoItem).join("")); logoMarq.hidden = false; }
      else { set("logoTrack", ""); logoMarq.hidden = true; }
    }

    // Highlights run as a marquee of number chips (main.js drives the scroll + count-up).
    const highlights = (data.highlights || []).slice(0, 8);
    const hiMarq = byId("hiMarquee");
    if (hiMarq) {
      if (highlights.length) { set("hiTrack", highlights.map(highlightEl).join("")); hiMarq.hidden = false; }
      else { set("hiTrack", ""); hiMarq.hidden = true; }
    }

    // Present mode shows the SAME curated set as the home page (featured), PLUS any
    // project that's hidden-from-default (ticket-only) — now decrypted — so the owner can
    // present the confidential work too. Non-featured, non-hidden work stays hidden.
    set("cases", (data.work || []).filter((w) => presentActive ? (!w.encWork && (w.featured || w.hidden)) : (w.featured && !w.encWork && !w.hidden)).slice(0, presentActive ? 999 : 6).map(caseEl).join(""));
    // Work list layout is configurable from the studio: list | grid-2 | grid-3 (default grid-2).
    const casesEl = byId("cases");
    if (casesEl) { const wl = data.workLayout || "grid-2"; casesEl.className = "cases" + (wl === "grid-3" ? " cases--g3" : wl === "list" ? "" : " cases--g2"); }
    set("workHeading", md(L.workTitle || "A few things I've *designed* and the thinking behind them."));
    const whEl = byId("workHeading");
    if (whEl) { whEl.classList.remove("section-head__title--standard", "section-head__title--large", "section-head__title--compact"); whEl.classList.add("section-head__title--" + (L.workTitleSize || "compact")); }

    set("capsList", caps.map((c) => '<li data-reveal>' + esc(c) + "</li>").join(""));

    set("timeline", (data.path || []).map(tlEl).join(""));
    var jrn = data.journey;
    var jrnHas = !!(jrn && jrn.enabled && Array.isArray(jrn.chapters) && jrn.chapters.some(function (c) { return c && c.entries && c.entries.some(function (e) { return e && (e.title || e.body || (e.images && e.images.length) || e.period); }); }));
    // The Design Journey is an owner-only presentation aid — the "View full journey" CTA
    // only appears in Present mode (⋯ menu → Present mode), not on the public site.
    set("journeyCta", (jrnHas && presentActive) ? '<button type="button" class="path__journey" data-journey-open data-cursor="hover">View full journey <span aria-hidden="true">\u2192</span></button>' : "");
    set("recognitionList", (data.recognition || []).map(awardEl).join(""));
    set("educationList", (data.education || []).map(awardEl).join(""));
    set("aboutGallery", (data.aboutGallery || []).filter((g) => g && g.src).slice(0, 6).map(galleryEl).join(""));

    applyAboutLayout(data);
    applyWorkLayout(data);

    const mail = byId("contactMail");
    if (mail) { mail.setAttribute("href", "mailto:" + (C.email || "")); mail.onclick = function () { track("contact_submit"); }; }
    const cb = C.badges || {};
    const badgeOn = (k) => cb[k] !== false; // absent = shown (backward compatible); only false hides
    const badges = [];
    if (C.email && badgeOn("email")) badges.push('<a href="mailto:' + esc(C.email) + '" class="contact__pill" data-cursor="hover">' + esc(C.email) + "</a>");
    if (C.phone && badgeOn("phone")) badges.push('<a href="tel:' + esc(C.phoneRaw || "") + '" class="contact__pill" data-cursor="hover">' + esc(C.phone) + "</a>");
    if (C.linkedin && badgeOn("linkedin")) badges.push('<a href="' + esc(C.linkedin) + '" class="contact__pill" target="_blank" rel="noopener" data-cursor="hover">LinkedIn \u2197</a>');
    if (badgeOn("vcard")) badges.push('<button type="button" id="contactVcard" class="contact__pill contact__pill--vcard" data-cursor="hover">Save contact \u2193</button>');
    if (C.resume && badgeOn("resume")) badges.push('<a id="contactResume" href="' + (/^data:/.test(C.resume) ? "#" : esc(C.resume)) + '" class="contact__pill contact__pill--resume" data-cursor="hover">R\u00e9sum\u00e9 \u2193</a>');
    if (C.booking && badgeOn("booking")) badges.push('<a id="contactBook" href="' + esc(C.booking) + '" class="contact__pill contact__pill--book" target="_blank" rel="noopener" data-cursor="hover">Book a call \u2197</a>');
    // Balanced rows: 6 badges → 4 + 2, 5 → 3 + 2, 1–4 → a single row.
    const firstRow = badges.length === 6 ? 4 : badges.length === 5 ? 3 : badges.length;
    const badgeLines = (firstRow < badges.length) ? [badges.slice(0, firstRow), badges.slice(firstRow)] : [badges];
    set("contactRow", badgeLines.map((ln) => '<div class="contact__line">' + ln.join("") + "</div>").join(""));
    const cRes = byId("contactResume");
    if (cRes) cRes.onclick = function (e) { e.preventDefault(); openResume(C.resume); };
    const cBook = byId("contactBook");
    if (cBook) cBook.onclick = function () { track("booking_open"); };
    const cVc = byId("contactVcard");
    if (cVc) cVc.onclick = function () { saveVCard(C); };

    set("menuFoot",
      '<a href="mailto:' + esc(C.email) + '">' + esc(C.email) + "</a>" +
      '<a href="' + esc(C.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>');

    // ---- floating dock (bottom-left): linkedin · résumé (conditional) · email · phone ----
    const dEmail = byId("dockEmail");
    if (dEmail) dEmail.setAttribute("href", "mailto:" + (C.email || ""));
    const dPhone = byId("dockPhone");
    if (dPhone) {
      if (C.phoneRaw) { dPhone.setAttribute("href", "tel:" + C.phoneRaw); dPhone.hidden = false; }
      else dPhone.hidden = true;
    }
    const dRes = byId("dockResume");
    if (dRes) {
      if (C.resume) {
        dRes.hidden = false;
        dRes.setAttribute("href", /^data:/.test(C.resume) ? "#" : C.resume);
        dRes.onclick = function (e) { e.preventDefault(); openResume(C.resume); };
      } else {
        dRes.hidden = true;
        dRes.onclick = null;
      }
    }
    const dLi = byId("dockLinkedin");
    if (dLi) {
      if (C.linkedin) { dLi.setAttribute("href", C.linkedin); dLi.hidden = false; }
      else dLi.hidden = true;
    }
    // ---- résumé links in the top nav + mobile menu (same behaviour as the dock) ----
    [byId("navResume"), byId("menuResume")].forEach(function (nr) {
      if (!nr) return;
      if (C.resume) {
        nr.hidden = false;
        nr.setAttribute("href", /^data:/.test(C.resume) ? "#" : C.resume);
        nr.onclick = function (e) { e.preventDefault(); openResume(C.resume); };
      } else { nr.hidden = true; nr.onclick = null; }
    });
  }

  /* ---------- special (curated) views ---------- */
  const SV_KEY = "rk:sv:active";
  let DATA = null;
  let presentActive = false;
  function baseData() { return (window.RK && window.RK.data) || DATA; }

  function svById(id) {
    const b = baseData();
    return (((b && b.specialViews) || [])).filter(function (v) { return v && v.id === id; })[0] || null;
  }
  function svExpired(sv) {
    return !!(sv && sv.days > 0 && Date.now() > (sv.createdAt || 0) + sv.days * 86400000);
  }
  function svDaysLeft(sv) {
    if (!sv || !sv.days) return Infinity;
    return Math.max(0, Math.ceil(((sv.createdAt || 0) + sv.days * 86400000 - Date.now()) / 86400000));
  }

  /* ---------- ticket decryption (envelope) ----------
     A ticket carries the wrapped content key for only the projects it curates.
     On entry (and on reload, from the session-stored code) we unwrap those keys
     and decrypt: hidden whole-project stubs are replaced with the full project;
     locked-section stubs are decrypted and the study marked unlocked. */
  var RK_UNLOCK_PREFIX = "rk:study:unlocked:";
  var RK_SV_CODE = "rk:sv:code";
  var RK_SV_CURATED = "rk:sv:curated";   // a server-minted curated grant's synthetic-view spec (JSON), restored on reload
  var RK_SV_TOK = "rk:sv:tok";   // set when a server-validated per-recruiter token unlocked the view — its own 15-day expiry governs, so the view's `days` is ignored
  function svTok() { try { return sessionStorage.getItem(RK_SV_TOK) === "1"; } catch (e) { return false; } }
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
  async function rkDecBytes(sekBytes, ivB64, ctBytes) {
    var key = await rkImportSek(sekBytes);
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rkUnb64(ivB64) }, key, ctBytes);
    return new Uint8Array(pt);
  }
  // Fetch each "rkenc:" protected image, decrypt it with the section key, and swap in a
  // blob: URL so it renders. Runs right after a ticket unlock, in place on the data.
  async function rkResolveEncImages(node, sekBytes) {
    var targets = [];
    (function walk(o) { if (!o || typeof o !== "object") return; for (var k in o) { var v = o[k]; if (typeof v === "string") { if (/^rkenc:/.test(v)) targets.push({ o: o, k: k }); } else if (v && typeof v === "object") walk(v); } })(node);
    for (var i = 0; i < targets.length; i++) {
      var o = targets[i].o, k = targets[i].k;
      try {
        var meta = JSON.parse(atob(o[k].slice(6)));
        var res = await fetch(meta.p); if (!res.ok) continue;
        var bytes = await rkDecBytes(sekBytes, meta.iv, new Uint8Array(await res.arrayBuffer()));
        o[k] = URL.createObjectURL(new Blob([bytes], { type: meta.m || "application/octet-stream" }));
        // The blob: URL drops the ".mp4" extension, so the renderer's extension-based detection
        // would fall back to <img> and the video silently vanishes. Pin kind:"video" (mirrors the
        // admin's resolvePreviewData) so a decrypted video still renders as a <video>.
        if (/^video\//i.test(meta.m || "") && (k === "src" || k === "image")) o.kind = "video";
      } catch (e) { /* leave as rkenc: */ }
    }
  }
  function rkMarkUnlocked(id) { try { sessionStorage.setItem(RK_UNLOCK_PREFIX + id, "1"); } catch (e) {} }
  async function rkDecryptStudyBlocks(st, sek) {
    if (!st || !Array.isArray(st.blocks)) return false;
    var out = st.blocks.slice(), any = false;
    for (var i = 0; i < out.length; i++) { var b = out[i]; if (b && b.encStub && b.iv && b.ct) { try { out[i] = await rkDecWithSek(sek, b); await rkResolveEncImages(out[i], sek); any = true; } catch (e) { return false; } } }
    if (any) st.blocks = out;
    return any;
  }
  // A server-minted per-recruiter vault grant (from /access/redeem) — store it directly so every
  // vault-hosted section signs against THIS link's own grant, scoped to its works with current keys,
  // instead of the shared quick-grant one.
  function applyVaultGrant(g) { try { if (g && g.token) sessionStorage.setItem("rk:vault:grant", JSON.stringify({ token: g.token, exp: g.exp || 0 })); } catch (e) {} try { document.dispatchEvent(new CustomEvent("rk:vaultgrant")); } catch (e) {} }
  function rkHasVaultGrant() { try { var g = JSON.parse(sessionStorage.getItem("rk:vault:grant") || "null"); return !!(g && g.token && g.exp && g.exp > Date.now()); } catch (e) { return false; } }
  // Decrypt everything a ticket authorises, in place on `data`.
  async function decryptActiveTicket(data, sv, code) {
    if (!data || !Array.isArray(data.work) || !sv) return;
    var ids = sv.workIds || [];
    for (var i = 0; i < ids.length; i++) {
      var idx = -1;
      for (var k = 0; k < data.work.length; k++) { if (data.work[k] && data.work[k].id === ids[i]) { idx = k; break; } }
      if (idx === -1) continue;
      var w = data.work[idx];
      var wtkt = w.encWork && w.enc && w.enc.wraps && w.enc.wraps.tickets && w.enc.wraps.tickets[sv.id];
      if (wtkt) {
        try { var sek = await rkUnwrapSek(code, wtkt); var full = await rkDecWithSek(sek, w); await rkResolveEncImages(full, sek); data.work[idx] = full; rkMarkUnlocked(full.id); } catch (e) {}
        continue;
      }
      var st = w.study;
      var wrap = st && st.enc && st.enc.wraps && st.enc.wraps.tickets && st.enc.wraps.tickets[sv.id];
      if (wrap) { try { var sek2 = await rkUnwrapSek(code, wrap); if (await rkDecryptStudyBlocks(st, sek2)) rkMarkUnlocked(w.id); } catch (e) {} }
    }
    // A valid ticket authorises this view's works: reveal their deeper-cut sections whenever the
    // locked content is actually available (decrypted just now, or already plaintext in an owner
    // draft/preview). Blocks still ciphertext (encStub) stay gated so we never render empty content.
    for (var mi = 0; mi < ids.length; mi++) {
      var mw = null;
      for (var mk = 0; mk < data.work.length; mk++) { if (data.work[mk] && data.work[mk].id === ids[mi]) { mw = data.work[mk]; break; } }
      if (!mw || mw.encWork || !mw.study || !Array.isArray(mw.study.blocks)) continue;
      var lk = mw.study.blocks.filter(function (b) { return b && b.locked; });
      if (lk.length && !lk.some(function (b) { return b.encStub; })) rkMarkUnlocked(mw.id);
    }
    // Also redeem this pass for a scoped vault grant, so any vault-hosted media in these works
    // streams for the pass-holder (best-effort; a no-op if no grant is registered for this code).
    // Skip when a per-LINK grant was already applied (recruiterInit stores the server-minted one
    // first) — don't clobber the fresh, tightly-scoped grant with the shared-code redeem.
    try { if (!rkHasVaultGrant() && window.RK && window.RK.vaultRedeem) await window.RK.vaultRedeem(code); } catch (e) {}
  }

  function deriveSpecialData(base, sv) {
    const d = JSON.parse(JSON.stringify(base));
    if (sv.workIds && sv.workIds.length) {
      const byId = {};
      (base.work || []).forEach(function (w) { byId[w.id] = w; });
      d.work = sv.workIds.map(function (id) { return byId[id]; }).filter(Boolean).filter(function (w) { return !w.encWork; }).map(function (w) {
        const c = JSON.parse(JSON.stringify(w)); c.featured = true; return c;
      });
    }
    if (sv.highlightIdx && sv.highlightIdx.length) {
      d.highlights = sv.highlightIdx.map(function (i) { return (base.highlights || [])[i]; }).filter(Boolean);
    }
    if (sv.capabilityIdx && sv.capabilityIdx.length) {
      d.capabilities = sv.capabilityIdx.map(function (i) { return (base.capabilities || [])[i]; }).filter(Boolean);
    }
    if (sv.audience) d.landing = Object.assign({}, d.landing || {}, { eyebrow: sv.audience });
    return d;
  }
  function revealAll() {
    document.querySelectorAll("[data-reveal]").forEach(function (el) { el.classList.add("is-in"); });
    document.querySelectorAll(".hero__title .line, .contact__mail-line").forEach(function (el) { el.classList.add("is-in"); });
    document.querySelectorAll(".count").forEach(function (c) { c.textContent = c.dataset.count; });
  }
  function applySpecialView(id) {
    const sv = svById(id);
    if (!sv) return { ok: false, reason: "not-found" };
    if (svExpired(sv) && !svTok()) return { ok: false, reason: "expired" };
    try { sessionStorage.setItem(SV_KEY, id); } catch (e) {}
    render(deriveSpecialData(baseData(), sv));
    showSvBanner(sv);
    revealAll();
    return { ok: true, view: sv };
  }
  // A server-minted per-recruiter CURATED grant. The recruiter's code is the full-access code, so
  // we decrypt against the MASTER view (svById(spec.masterId) — it carries the vault/study wraps),
  // then render only the curated subset. Display-scoping today; per-ticket vault keys would make it
  // a true content boundary. `spec` is a synthetic view: {id:"__curated__", masterId, name, audience,
  // workIds, highlightIdx, capabilityIdx, days:0}.
  async function applyCuratedView(spec, code) {
    const base = baseData();
    if (!base || !spec) return { ok: false, reason: "notready" };
    try {
      sessionStorage.setItem(RK_SV_CURATED, JSON.stringify(spec));
      if (code) sessionStorage.setItem(RK_SV_CODE, code);
      sessionStorage.setItem(RK_SV_TOK, "1");   // the server token governs expiry, not a view `days`
      sessionStorage.removeItem(SV_KEY);          // curated isn't a by-id view
    } catch (e) {}
    showUnlockingBanner("Unlocking\u2026");
    const master = svById(spec.masterId);
    if (master && code) { try { await decryptActiveTicket(base, master, code); } catch (e) {} }
    render(deriveSpecialData(base, spec));
    showSvBanner(spec);
    revealAll();
    return { ok: true, view: spec };
  }
  function clearSpecialView() {
    try { sessionStorage.removeItem(SV_KEY); } catch (e) {}
    try { sessionStorage.removeItem(RK_SV_CURATED); } catch (e) {}
    try { sessionStorage.removeItem(RK_SV_CODE); } catch (e) {}
    try { sessionStorage.removeItem(RK_SV_TOK); } catch (e) {}
    removeSvBanner();
    render(baseData());
    revealAll();
  }
  function showSvBanner(sv) {
    removeSvBanner();
    const left = svDaysLeft(sv);
    const exp = isFinite(left) ? (left <= 0 ? "expires today" : left + " day" + (left > 1 ? "s" : "") + " left") : "";
    const b = document.createElement("div");
    b.className = "sv-banner";
    b.innerHTML =
      '<span class="sv-banner__dot"></span>' +
      '<span class="sv-banner__txt">Curated view' + (sv.name ? " \u2014 " + esc(sv.name) : "") + "</span>" +
      (exp ? '<span class="sv-banner__exp">' + exp + "</span>" : "") +
      '<button class="sv-banner__exit" type="button">Exit \u2715</button>';
    b.querySelector(".sv-banner__exit").addEventListener("click", clearSpecialView);
    document.body.appendChild(b);
    document.body.classList.add("has-sv");
  }
  function removeSvBanner() {
    const b = document.querySelector(".sv-banner");
    if (b) b.remove();
    document.body.classList.remove("has-sv");
  }
  // Transient “working” banner (spinner + label) shown while a present/curated view is being
  // decrypted. It occupies the same spot as the final banner; showSvBanner/showPresentBanner
  // replace it (they removeSvBanner first) once everything is unlocked.
  function showUnlockingBanner(txt) {
    removeSvBanner();
    const b = document.createElement("div");
    b.className = "sv-banner sv-banner--loading";
    b.innerHTML =
      '<span class="sv-banner__spin" aria-hidden="true"></span>' +
      '<span class="sv-banner__txt">' + esc(txt || "Unlocking\u2026") + "</span>";
    document.body.appendChild(b);
    document.body.classList.add("has-sv");
  }

  /* ---------- present mode (owner) ----------
     One-click: decrypt every locked section + hidden project with the owner
     recovery passphrase, show ALL case studies as cards fully unlocked, in the
     normal viewer (never the editor). Ephemeral: a reload clears it. */
  var RK_PRESENT_ACTIVE = "rk:present:active";
  var RK_PRESENT_IDS = "rk:present:ids";
  function rkHasProtected() {
    var b = baseData();
    if (!b || !Array.isArray(b.work)) return false;
    return b.work.some(function (w) {
      if (w.encWork && w.enc && w.enc.wraps && w.enc.wraps.owner) return true;
      var st = w.study;
      return !!(st && st.enc && st.enc.wraps && st.enc.wraps.owner);
    });
  }
  async function presentAll(recovery) {
    var base = baseData();
    if (!base || !Array.isArray(base.work)) return { ok: false, reason: "no-data" };
    var data = JSON.parse(JSON.stringify(base));
    // The Design Journey is an owner-only presentation aid kept in the PRIVATE local draft
    // (it's intentionally not part of the public content.json). Present mode is entered from a
    // normal page load, which renders the published data — so pull the latest journey straight
    // from the draft here, letting the owner present it without publishing it publicly.
    try {
      var draftRaw = localStorage.getItem(DRAFT_KEY);
      if (draftRaw) {
        var dj = (JSON.parse(draftRaw) || {}).journey;
        var djHas = dj && Array.isArray(dj.chapters) && dj.chapters.some(function (c) { return c && c.entries && c.entries.some(function (e) { return e && (e.title || e.body || (e.images && e.images.length) || e.period); }); });
        if (djHas) data.journey = dj;
      }
    } catch (e) { /* ignore bad draft */ }
    // Show the working state right away — the decrypt loop below can take a moment.
    showUnlockingBanner("Unlocking\u2026");
    var ids = [], hadProtected = 0, unlocked = 0, passOk = false, hadVault = false;
    for (var idx = 0; idx < data.work.length; idx++) {
      var w = data.work[idx];
      var wwrap = w.encWork && w.enc && w.enc.wraps && w.enc.wraps.owner;
      if (wwrap) {
        hadProtected++;
        try { var sek = await rkUnwrapSek(recovery, wwrap); var full = await rkDecWithSek(sek, w); await rkResolveEncImages(full, sek); data.work[idx] = full; rkMarkUnlocked(full.id); ids.push(full.id); unlocked++; passOk = true; } catch (e) {}
        continue;
      }
      var st = w.study;
      // Vault-hosted deeper cuts don't decrypt client-side -- they resolve via the owner grant below.
      if (st && Array.isArray(st.blocks) && st.blocks.some(function (b) { return b && b.locked && b.vaultBlock; })) hadVault = true;
      var swrap = st && st.enc && st.enc.wraps && st.enc.wraps.owner;
      if (swrap) {
        hadProtected++;
        // A successful unwrap proves the passphrase even when the study is vault-only (0 encStubs to decrypt).
        try { var sek2 = await rkUnwrapSek(recovery, swrap); passOk = true; if (await rkDecryptStudyBlocks(st, sek2)) unlocked++; rkMarkUnlocked(w.id); ids.push(w.id); } catch (e) {}
      }
    }
    if (hadProtected && !passOk) { removeSvBanner(); return { ok: false, reason: "pass" }; }
    // The recovery passphrase is the TRUE master key: it also mints a read-only owner grant over every
    // vault key, so vault-hosted deeper cuts resolve in Present mode exactly like the decrypted ones.
    if (hadVault) {
      try { var og = (window.RK && window.RK.ownerVaultGrant) ? await window.RK.ownerVaultGrant(recovery) : null; if (og) applyVaultGrant(og); } catch (e) {}
    }
    try { sessionStorage.setItem(RK_PRESENT_IDS, JSON.stringify(ids)); sessionStorage.setItem(RK_PRESENT_ACTIVE, "1"); } catch (e) {}
    if (window.RK) window.RK.data = data;
    DATA = data;
    presentActive = true;
    render(data);
    revealAll();
    // Pre-fetch every presented work's vault-hosted deeper cuts while the "Unlocking…" toast is up, so
    // the banner only flips to "fully unlocked" once the deeper cuts are actually in hand — and each
    // case study then opens instantly. (An already-open case study was refreshed by the grant event.)
    if (hadVault && window.RK && typeof window.RK.resolveWorkVault === "function") {
      showUnlockingBanner("Unlocking deeper cuts\u2026");
      try {
        await Promise.all((data.work || []).filter(function (pw) {
          return pw && pw.study && Array.isArray(pw.study.blocks) && pw.study.blocks.some(function (b) { return b && b.locked && b.vaultBlock; });
        }).map(function (pw) { return window.RK.resolveWorkVault(pw).catch(function () { return 0; }); }));
      } catch (e) {}
    }
    showPresentBanner();
    return { ok: true, unlocked: unlocked, total: data.work.length };
  }
  function rkClearPresent() {
    try {
      var ids = JSON.parse(sessionStorage.getItem(RK_PRESENT_IDS) || "[]");
      (ids || []).forEach(function (id) { sessionStorage.removeItem(RK_UNLOCK_PREFIX + id); });
    } catch (e) {}
    try { sessionStorage.removeItem(RK_PRESENT_IDS); sessionStorage.removeItem(RK_PRESENT_ACTIVE); } catch (e) {}
  }
  function exitPresent() { rkClearPresent(); location.reload(); }
  function showPresentBanner() {
    removeSvBanner();
    var b = document.createElement("div");
    b.className = "sv-banner present-banner";
    b.innerHTML =
      '<span class="sv-banner__dot"></span>' +
      '<span class="sv-banner__txt">Presenting all work \u2014 fully unlocked</span>' +
      '<button class="sv-banner__exit" type="button">Exit \u2715</button>';
    b.querySelector(".sv-banner__exit").addEventListener("click", exitPresent);
    document.body.appendChild(b);
    document.body.classList.add("has-sv");
  }

  /* ---------- data loading ---------- */
  // Fast, stable signature of the published content so the admin can tell when a
  // saved draft is stale (i.e. content.json changed under it) and discard it.
  function sig(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  async function fetchPublished() {
    const res = await fetch("content.json?v=" + Date.now());
    if (!res.ok) throw new Error("content.json " + res.status);
    return await res.json();
  }

  async function bootstrap() {
    // Deeper-cut access is session-scoped (a link/ticket unlocks for this visit only). Remove any legacy
    // vault grant older builds persisted in localStorage, so a past unlock never lingers across sessions.
    try { localStorage.removeItem("rk:vault:grant"); } catch (e) {}
    let published;
    try {
      published = await fetchPublished();
    } catch (e) {
      console.error("Content load failed:", e);
      document.body.classList.remove("site-loading");
      return;
    }
    const publishedSig = sig(JSON.stringify(published));

    // The local draft is a PRIVATE admin working copy. Only render it when
    // explicitly previewing (?draft) or inside the admin live-preview iframe
    // (?preview). The public site always renders the committed content.json.
    let data = published;
    const params = new URLSearchParams(location.search);
    if (params.has("draft") || params.has("preview")) {
      try { const d = localStorage.getItem(DRAFT_KEY); if (d) data = JSON.parse(d); } catch (e) { /* ignore bad draft */ }
    }

    DATA = data;
    window.RK = Object.assign(window.RK || {}, {
      data: data,
      published: published,
      publishedSig: publishedSig,
      sig: sig,
      render: render,
      md: md,
      esc: esc,
      openResume: openResume,
      plateInner: plateInner,
      ABOUT_SECTIONS: ABOUT_SECTIONS,
      aboutLayout: aboutLayout,
      WORK_SECTIONS: WORK_SECTIONS,
      workLayout: workLayout,
      RECOGNITION_ICONS: RECOGNITION_ICONS,
      RECOGNITION_ICON_SVG: RECOGNITION_ICON_SVG,
      recIcon: recIcon,
      DRAFT_KEY: DRAFT_KEY,
      applySpecialView: applySpecialView,
      applyCuratedView: applyCuratedView,
      applyVaultGrant: applyVaultGrant,
      clearSpecialView: clearSpecialView,
      deriveSpecialData: deriveSpecialData,
      decryptActiveTicket: decryptActiveTicket,
      showUnlockingBanner: showUnlockingBanner,
      removeSvBanner: removeSvBanner,
      svById: svById,
      svExpired: svExpired,
      svDaysLeft: svDaysLeft,
      presentAll: presentAll,
      exitPresent: exitPresent,
      rkHasProtected: rkHasProtected,
    });

    // Present mode never survives a reload (the passphrase isn't kept), so clear any stale flags.
    try { if (sessionStorage.getItem(RK_PRESENT_ACTIVE)) rkClearPresent(); } catch (e) {}

    // If a curated view is active (e.g. after a refresh), render it as the initial view.
    let initial = data, activeSv = null;
    try {
      const curatedRaw = sessionStorage.getItem(RK_SV_CURATED);
      if (curatedRaw) {
        const spec = JSON.parse(curatedRaw);
        activeSv = spec;
        const master = svById(spec.masterId);
        const ccode = sessionStorage.getItem(RK_SV_CODE);
        if (master && ccode) { try { await decryptActiveTicket(data, master, ccode); } catch (e) {} }
        initial = deriveSpecialData(data, spec);
      } else {
        const activeId = sessionStorage.getItem(SV_KEY);
        if (activeId) {
          const sv = svById(activeId);
          if (sv && (!svExpired(sv) || svTok())) {
            activeSv = sv;
            const code = sessionStorage.getItem(RK_SV_CODE);
            if (code) { try { await decryptActiveTicket(data, sv, code); } catch (e) {} }
            initial = deriveSpecialData(data, sv);
          }
          else { sessionStorage.removeItem(SV_KEY); sessionStorage.removeItem(RK_SV_CODE); sessionStorage.removeItem(RK_SV_TOK); }
        }
      }
    } catch (e) {}

    render(initial);
    if (activeSv) showSvBanner(activeSv);
    document.body.classList.remove("site-loading");
    window.__siteRendered = true;
    document.dispatchEvent(new Event("site:rendered"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap);
  else bootstrap();
})();
