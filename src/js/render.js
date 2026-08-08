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
  function highlightEl(h) {
    const m = String(h.value || "").match(/^(\d+)(.*)$/);
    let numHtml, wordClass = "";
    if (m) {
      numHtml =
        '<span class="count" data-count="' + m[1] + '">0</span>' +
        (m[2] ? "<i>" + esc(m[2]) + "</i>" : "");
    } else {
      numHtml = esc(h.value);
      wordClass = " stat__num--word";
    }
    return (
      '<div class="stat reveal" data-reveal><div class="stat__num' + wordClass + '">' +
      numHtml + '</div><div class="stat__label">' + esc(h.label) + "</div></div>"
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

  function caseEl(w, idx) {
    const n = String(idx + 1).padStart(2, "0");
    const tags = (w.tags || []).map((t) => "<span>" + esc(t) + "</span>").join("");
    const imgSrc = esc(w.image).replace(/"/g, "&quot;");
    const media = w.image
      ? '<div class="case__media case__media--photo" aria-hidden="true">' +
          '<img class="case__img" src="' + imgSrc + '" alt="" loading="lazy" />' +
          '<span class="plate__idx">' + n + '</span>' +
          '<span class="plate__tag">' + esc(w.plateTag) + '</span></div>'
      : '<div class="case__media case__media--' + esc(w.theme) + '" aria-hidden="true">' +
          '<div class="plate"><span class="plate__idx">' + n + "</span>" +
          plateInner(w.theme) +
          '<span class="plate__tag">' + esc(w.plateTag) + "</span></div></div>";
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

  function tlEl(p) {
    return (
      '<li class="tl reveal' + (p.present ? " tl--present" : "") + '" data-reveal>' +
      '<div class="tl__year">' + esc(p.years) + "</div>" +
      '<div class="tl__main"><h3>' + esc(p.role) + "</h3>" +
      '<span class="tl__org">' + esc(p.org) + "</span>" +
      "<p>" + esc(p.desc) + "</p></div></li>"
    );
  }

  function awardEl(a) {
    return "<li><span>" + esc(a.title) + "</span><i>" + esc(a.meta) + "</i></li>";
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

  /* ---------- master render ---------- */
  function render(data) {
    const L = data.landing || {};
    const C = data.contact || {};
    const caps = data.capabilities || [];

    set("heroLabel",
      '<span class="tick">◦</span> ' + esc(L.eyebrow) +
      ' <span class="hero__label-sep">/</span> ' + esc(L.domains));

    const lines = String(L.statement || "").split("\n").filter((x) => x.length);
    set("heroTitle",
      lines.map((ln) => '<span class="line" data-reveal><span>' + md(ln) + "</span></span>").join(""));

    set("heroIntro", md(L.intro));
    set("heroNowText", md(L.presence));
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

    set("stats", (data.highlights || []).slice(0, 8).map(highlightEl).join(""));

    // Present mode shows the SAME curated set as the home page (featured), PLUS any
    // project that's hidden-from-default (ticket-only) — now decrypted — so the owner can
    // present the confidential work too. Non-featured, non-hidden work stays hidden.
    set("cases", (data.work || []).filter((w) => presentActive ? (!w.encWork && (w.featured || w.hidden)) : (w.featured && !w.encWork && !w.hidden)).slice(0, presentActive ? 999 : 6).map(caseEl).join(""));
    // Work list layout is configurable from the studio: list | grid-2 | grid-3 (default grid-2).
    const casesEl = byId("cases");
    if (casesEl) { const wl = data.workLayout || "grid-2"; casesEl.className = "cases" + (wl === "grid-3" ? " cases--g3" : wl === "list" ? "" : " cases--g2"); }

    set("capsList", caps.map((c) => '<li data-reveal>' + esc(c) + "</li>").join(""));

    set("timeline", (data.path || []).map(tlEl).join(""));
    var jrn = data.journey;
    var jrnHas = !!(jrn && jrn.enabled && Array.isArray(jrn.chapters) && jrn.chapters.some(function (c) { return c && c.entries && c.entries.some(function (e) { return e && (e.title || e.body || (e.images && e.images.length) || e.period); }); }));
    // The Design Journey is an owner-only presentation aid — the "View full journey" CTA
    // only appears in Present mode (⋯ menu → Present mode), not on the public site.
    set("journeyCta", (jrnHas && presentActive) ? '<button type="button" class="path__journey" data-journey-open data-cursor="hover">View full journey <span aria-hidden="true">\u2192</span></button>' : "");
    set("recognitionList", (data.recognition || []).map(awardEl).join(""));
    set("educationList", (data.education || []).map(awardEl).join(""));

    applyAboutLayout(data);

    const mail = byId("contactMail");
    if (mail) { mail.setAttribute("href", "mailto:" + (C.email || "")); mail.onclick = function () { track("contact_submit"); }; }
    set("contactRow",
      '<a href="mailto:' + esc(C.email) + '" class="contact__pill" data-cursor="hover">' + esc(C.email) + "</a>" +
      (C.phone ? '<a href="tel:' + esc(C.phoneRaw || "") + '" class="contact__pill" data-cursor="hover">' + esc(C.phone) + "</a>" : "") +
      (C.linkedin ? '<a href="' + esc(C.linkedin) + '" class="contact__pill" target="_blank" rel="noopener" data-cursor="hover">LinkedIn \u2197</a>' : "") +
      '<button type="button" id="contactVcard" class="contact__pill contact__pill--vcard" data-cursor="hover">Save contact \u2193</button>' +
      (C.resume ? '<a id="contactResume" href="' + (/^data:/.test(C.resume) ? "#" : esc(C.resume)) + '" class="contact__pill contact__pill--resume" data-cursor="hover">R\u00e9sum\u00e9 \u2193</a>' : "") +
      (C.booking ? '<a id="contactBook" href="' + esc(C.booking) + '" class="contact__pill contact__pill--book" target="_blank" rel="noopener" data-cursor="hover">Book a call \u2197</a>' : ""));
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
