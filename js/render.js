/* =================================================================
   RITESH KUMAR — content renderer
   Renders every editable section from content.json (the single
   source of truth). Exposes window.RK for the admin editor.
   ================================================================= */
(function () {
  "use strict";

  const DRAFT_KEY = "rk:content:draft";

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

    if (L.aboutLead) set("aboutLead", md(L.aboutLead));
    const aboutParas = String(L.about || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (aboutParas.length || L.aboutSign) set("aboutBody",
      aboutParas.map((p) => "<p>" + md(p) + "</p>").join("") +
      (L.aboutSign ? '<p class="about__sign">' + md(L.aboutSign) + "</p>" : ""));

    const one = caps.map((c) => "<span>" + esc(c) + '</span><span class="dot">✦</span>').join("");
    set("marqueeTrack", one + one);

    set("stats", (data.highlights || []).slice(0, 8).map(highlightEl).join(""));

    set("cases", (data.work || []).filter((w) => w.featured).slice(0, 6).map(caseEl).join(""));

    set("capsList", caps.map((c) => '<li data-reveal>' + esc(c) + "</li>").join(""));

    set("timeline", (data.path || []).map(tlEl).join(""));
    set("recognitionList", (data.recognition || []).map(awardEl).join(""));
    set("educationList", (data.education || []).map(awardEl).join(""));

    const mail = byId("contactMail");
    if (mail) mail.setAttribute("href", "mailto:" + (C.email || ""));
    set("contactRow",
      '<a href="mailto:' + esc(C.email) + '" class="contact__pill" data-cursor="hover">' + esc(C.email) + "</a>" +
      (C.phone ? '<a href="tel:' + esc(C.phoneRaw || "") + '" class="contact__pill" data-cursor="hover">' + esc(C.phone) + "</a>" : "") +
      (C.linkedin ? '<a href="' + esc(C.linkedin) + '" class="contact__pill" target="_blank" rel="noopener" data-cursor="hover">LinkedIn \u2197</a>' : "") +
      (C.resume ? '<a id="contactResume" href="' + (/^data:/.test(C.resume) ? "#" : esc(C.resume)) + '" class="contact__pill contact__pill--resume" data-cursor="hover">R\u00e9sum\u00e9 \u2193</a>' : ""));
    const cRes = byId("contactResume");
    if (cRes) cRes.onclick = function (e) { e.preventDefault(); openResume(C.resume); };

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
  function deriveSpecialData(base, sv) {
    const d = JSON.parse(JSON.stringify(base));
    if (sv.workIds && sv.workIds.length) {
      const byId = {};
      (base.work || []).forEach(function (w) { byId[w.id] = w; });
      d.work = sv.workIds.map(function (id) { return byId[id]; }).filter(Boolean).map(function (w) {
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
    if (svExpired(sv)) return { ok: false, reason: "expired" };
    try { sessionStorage.setItem(SV_KEY, id); } catch (e) {}
    render(deriveSpecialData(baseData(), sv));
    showSvBanner(sv);
    revealAll();
    return { ok: true, view: sv };
  }
  function clearSpecialView() {
    try { sessionStorage.removeItem(SV_KEY); } catch (e) {}
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
      DRAFT_KEY: DRAFT_KEY,
      applySpecialView: applySpecialView,
      clearSpecialView: clearSpecialView,
      deriveSpecialData: deriveSpecialData,
      svById: svById,
      svExpired: svExpired,
      svDaysLeft: svDaysLeft,
    });

    // If a curated view is active (e.g. after a refresh), render it as the initial view.
    let initial = data, activeSv = null;
    try {
      const activeId = sessionStorage.getItem(SV_KEY);
      if (activeId) {
        const sv = svById(activeId);
        if (sv && !svExpired(sv)) { activeSv = sv; initial = deriveSpecialData(data, sv); }
        else sessionStorage.removeItem(SV_KEY);
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
