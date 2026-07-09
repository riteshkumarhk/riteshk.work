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
      case "grid": return '<div class="plate__grid"></div>';
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
      '<li class="case" data-reveal><a class="case__link" href="#contact" data-cursor="view">' +
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
      (C.phone ? '<a href="tel:' + esc(C.phoneRaw || "") + '" class="contact__pill" data-cursor="hover">' + esc(C.phone) + "</a>" : ""));

    set("menuFoot",
      '<a href="mailto:' + esc(C.email) + '">' + esc(C.email) + "</a>" +
      '<a href="' + esc(C.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>');

    const site = String(C.website || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    set("footerLinks",
      '<a href="' + esc(C.linkedin) + '" target="_blank" rel="noopener" data-cursor="hover">LinkedIn ↗</a>' +
      '<a href="' + esc(C.website) + '" target="_blank" rel="noopener" data-cursor="hover">' + esc(site) + " ↗</a>" +
      '<a href="mailto:' + esc(C.email) + '" data-cursor="hover">Email ↗</a>');
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
  async function loadData() {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) return JSON.parse(draft);
    } catch (e) { /* ignore bad draft */ }
    const res = await fetch("content.json?v=" + Date.now());
    if (!res.ok) throw new Error("content.json " + res.status);
    return await res.json();
  }

  async function bootstrap() {
    let data;
    try {
      data = await loadData();
    } catch (e) {
      console.error("Content load failed:", e);
      document.body.classList.remove("site-loading");
      return;
    }
    DATA = data;
    window.RK = Object.assign(window.RK || {}, {
      data: data,
      render: render,
      md: md,
      esc: esc,
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
