/* ============================================================================
   DESIGN JOURNEY — immersive, vertically-scrolling overlay.
   Left rail = a chapter timeline (Microsoft / Jaguar Land Rover / …); the main
   column scrolls through each chapter's entries (period + title + rich
   description + an image gallery + an optional link to a full case study).
   Data lives at content.json -> journey { enabled, chapters:[{ name, entries:[
   { period, title, body, workId, layout, images:[{src,caption}] } ] }] }.
   Mirrors the case-study overlay (js/project.js) patterns; theme-aware.
   ========================================================================== */
(function () {
  "use strict";
  var PREVIEW = new URLSearchParams(location.search).has("preview");
  var overlay = null, scroller = null, spyRaf = 0, returnScrollY = 0, lastFocus = null;

  /* ---------- small helpers (reuse render.js where present) ---------- */
  function esc(s) {
    if (window.RK && window.RK.esc) return window.RK.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function md(s) { return (window.RK && window.RK.md) ? window.RK.md(s) : esc(s); }
  function data() { return (window.RK && window.RK.data) || null; }
  function journey() { var d = data(); return (d && d.journey) || null; }
  function chapters() { var j = journey(); return (j && Array.isArray(j.chapters)) ? j.chapters : []; }
  function activeChapters() { return chapters().filter(function (c) { return c && c.entries && c.entries.some(function (e) { return e && (e.title || e.body || (e.images && e.images.length) || e.period); }); }); }
  function hasContent() { var j = journey(); return !!(j && j.enabled && activeChapters().length); }
  function workById(id) { var d = data(); return d && (d.work || []).filter(function (w) { return w && w.id === id; })[0]; }

  function safeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/ on\w+="[^"]*"/gi, "").replace(/ on\w+='[^']*'/gi, "")
      .replace(/javascript:/gi, "");
  }
  function isRichHtml(s) { return /<(p|ul|ol|li|strong|em|b|i|s|strike|br|div|span|figure|img|blockquote|h[1-6])\b/i.test(s || ""); }
  function prose(body) {
    if (!body) return "";
    var inner = isRichHtml(body) ? safeHtml(body) : String(body).split(/\n\n+/).map(function (p) { return "<p>" + md(p) + "</p>"; }).join("");
    return '<div class="jrn__prose">' + inner + "</div>";
  }

  /* ---------- media ---------- */
  function isVideo(src, im) { return (im && im.kind === "video") || /^data:video\//i.test(src) || /\.(mp4|webm|mov|m4v|ogv)($|\?|#)/i.test(src); }
  function mediaTag(im) {
    var src = (im && im.src) || ""; if (!src) return "";
    if (isVideo(src, im)) {
      return '<div class="jrn__fig jrn__fig--v"><video class="jrn__media" src="' + esc(src) + '" muted loop playsinline controls preload="metadata"></video>' +
        (im.caption ? '<div class="jrn__cap">' + esc(im.caption) + "</div>" : "") + "</div>";
    }
    return '<figure class="jrn__fig"><img class="jrn__img" data-jzoom src="' + esc(src) + '" alt="' + esc(im.caption || "") + '" loading="lazy" draggable="false" />' +
      (im.caption ? '<figcaption class="jrn__cap">' + esc(im.caption) + "</figcaption>" : "") + "</figure>";
  }
  function gallery(entry) {
    var imgs = (entry.images || []).filter(function (im) { return im && im.src; });
    if (!imgs.length) return "";
    var layout = /^(grid|showcase|stack)$/.test(entry.layout || "") ? entry.layout : "auto";
    if (layout === "showcase" && imgs.length > 1) {
      return '<div class="jrn__shots jrn__shots--showcase">' +
        '<div class="jrn__hero">' + mediaTag(imgs[0]) + "</div>" +
        '<div class="jrn__thumbs">' + imgs.slice(1).map(mediaTag).join("") + "</div></div>";
    }
    return '<div class="jrn__shots jrn__shots--' + layout + '">' + imgs.map(mediaTag).join("") + "</div>";
  }

  /* ---------- entry + chapter ---------- */
  function entryHtml(entry, ci, ei) {
    var cs = "";
    if (entry.workId) {
      var w = workById(entry.workId);
      if (w && !w.encWork && !w.hidden) cs = '<button type="button" class="jrn__cs" data-jwork="' + esc(entry.workId) + '">View case study <span aria-hidden="true">\u2192</span></button>';
    }
    var meta = '<div class="jrn__entry-meta">' +
      (entry.period ? '<span class="jrn__period">' + esc(entry.period) + "</span>" : "") +
      (entry.title ? '<h3 class="jrn__title">' + md(entry.title) + "</h3>" : "") +
      (entry.body ? prose(entry.body) : "") +
      cs + "</div>";
    // NOTE: no data-reveal here — the global [data-reveal]{opacity:0} rule only clears to
    // opacity:1 when the page's scroll observer adds .is-in, which never runs inside this
    // fixed overlay (nor in the lite preview iframe). The overlay fades itself in instead.
    return '<article class="jrn__entry">' + meta + gallery(entry) + "</article>";
  }
  function chapterHtml(chap, ci) {
    var entries = (chap.entries || []).filter(function (e) { return e && (e.title || e.body || (e.images && e.images.length) || e.period); });
    if (!entries.length) return "";
    return '<section class="jrn__chap" id="jrnc-' + ci + '" data-jchap="' + ci + '">' +
      '<header class="jrn__chap-head"><span class="jrn__chap-rule"></span><h2 class="jrn__chap-name">' + esc(chap.name || "Chapter " + (ci + 1)) + "</h2></header>" +
      entries.map(function (e, ei) { return entryHtml(e, ci, ei); }).join("") + "</section>";
  }
  function chapterRange(chap) {
    var ps = (chap.entries || []).map(function (e) { return e && e.period; }).filter(Boolean);
    return ps.length ? esc(ps[ps.length - 1]) : "";
  }

  /* ---------- render ---------- */
  function render() {
    var j = journey() || {};
    var chaps = activeChapters();
    var toc = chaps.map(function (chap) {
      var ci = chapters().indexOf(chap);
      return '<button type="button" class="jrn__toc-chip" data-goto="jrnc-' + ci + '">' +
        '<span class="jrn__toc-dot"></span>' +
        '<span class="jrn__toc-txt"><b>' + esc(chap.name || "Chapter") + "</b>" +
        (chapterRange(chap) ? '<i class="jrn__toc-yr">' + chapterRange(chap) + "</i>" : "") + "</span></button>";
    }).join("");
    overlay.querySelector("[data-jtoc]").innerHTML = toc;
    var head = overlay.querySelector("[data-jhead]");
    if (head) head.innerHTML = '<span class="jrn__kicker">' + esc((j.eyebrow || "Design Journey")) + "</span>" +
      (j.title ? '<span class="jrn__lede">' + esc(j.title) + "</span>" : "");
    overlay.querySelector("[data-jcontent]").innerHTML =
      '<div class="jrn__hero-head"><span class="jrn__kicker">' + esc((j.eyebrow || "Design Journey")) + "</span>" +
      '<h1 class="jrn__h1">' + esc(j.title || "The full journey") + "</h1>" +
      (j.intro ? '<p class="jrn__intro">' + md(j.intro) + "</p>" : "") + "</div>" +
      chaps.map(function (chap) { return chapterHtml(chap, chapters().indexOf(chap)); }).join("");
  }

  /* ---------- overlay shell ---------- */
  function build() {
    overlay = document.createElement("div");
    overlay.className = "jrn";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Design journey");
    overlay.setAttribute("data-lenis-prevent", "");
    overlay.innerHTML =
      '<div class="jrn__scroll">' +
        '<button class="jrn__close" data-jclose aria-label="Close design journey" title="Close">\u2715</button>' +
        '<div class="jrn__shell">' +
          '<aside class="jrn__side">' +
            '<div class="jrn__side-head" data-jhead></div>' +
            '<nav class="jrn__toc" data-jtoc aria-label="Chapters"></nav>' +
            '<button class="jrn__side-back" data-jclose><span aria-hidden="true">\u2190</span> Back to site</button>' +
          "</aside>" +
          '<main class="jrn__main" data-jcontent></main>' +
        "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    scroller = overlay.querySelector(".jrn__scroll");

    // Lenis eats the page wheel, so scroll the overlay ourselves when it's active.
    overlay.addEventListener("wheel", function (e) {
      if (!window.__lenis) return;
      if (!scroller.contains(e.target)) return;
      var factor = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? Math.round(scroller.clientHeight * 0.9) : 1);
      scroller.scrollTop += e.deltaY * factor;
      e.preventDefault(); e.stopPropagation();
    }, { passive: false, capture: true });

    scroller.addEventListener("scroll", function () {
      if (spyRaf) return;
      spyRaf = requestAnimationFrame(function () { spyRaf = 0; updateSpy(); });
    }, { passive: true });

    overlay.addEventListener("click", onClick);
    overlay.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  }

  function topOffset() { return 26; }
  function updateSpy() {
    if (!overlay || !overlay.classList.contains("is-open")) return;
    var secs = [].slice.call(overlay.querySelectorAll("[data-jchap]"));
    if (!secs.length) return;
    var y = scroller.scrollTop + topOffset() + 14;
    var active = secs[0];
    secs.forEach(function (s) { if (s.offsetTop <= y) active = s; });
    // A short final chapter may never reach the top, so treat "scrolled to the
    // bottom" (when there is real scroll range) as that last chapter.
    var range = scroller.scrollHeight - scroller.clientHeight;
    if (range > 8 && scroller.scrollTop >= range - 4) active = secs[secs.length - 1];
    var id = active ? active.id : null;
    overlay.querySelectorAll(".jrn__toc-chip").forEach(function (c) { c.classList.toggle("is-active", c.getAttribute("data-goto") === id); });
  }
  function gotoSection(id) {
    var sec = overlay.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(id) : id));
    if (!sec) return;
    scroller.scrollTo({ top: Math.max(0, sec.offsetTop - topOffset() - 8), behavior: "smooth" });
  }

  function onClick(e) {
    if (e.target.closest("[data-jclose]")) { e.preventDefault(); close(); return; }
    var chip = e.target.closest(".jrn__toc-chip");
    if (chip) { gotoSection(chip.getAttribute("data-goto")); return; }
    var cs = e.target.closest("[data-jwork]");
    if (cs) {
      e.preventDefault();
      var id = cs.getAttribute("data-jwork");
      close();
      if (window.RK && window.RK.openProject) { try { window.RK.openProject(id); } catch (err) {} }
      return;
    }
    var zoom = e.target.closest("img[data-jzoom]");
    if (zoom && window.RK && window.RK.openLbx) {
      e.preventDefault();
      var fig = zoom.closest(".jrn__entry") || overlay;
      var all = [].slice.call(fig.querySelectorAll("img[data-jzoom]"));
      var group = all.map(function (im) { var f = im.closest(".jrn__fig"); var cap = f && f.querySelector(".jrn__cap"); return { src: im.getAttribute("src"), cap: cap ? cap.textContent : "" }; });
      var idx = all.indexOf(zoom);
      window.RK.openLbx(group, idx < 0 ? 0 : idx);
    }
  }

  /* ---------- background lock ---------- */
  function lockBg(on) {
    if (on) { if (window.__lenis && window.__lenis.stop) window.__lenis.stop(); document.documentElement.classList.add("pj-lock"); }
    else { if (window.__lenis && window.__lenis.start) window.__lenis.start(); document.documentElement.classList.remove("pj-lock"); }
  }

  /* ---------- open / close ---------- */
  function open(opts) {
    opts = opts || {};
    if (!hasContent() && !opts.preview) return;
    var firstOpen = !overlay || !overlay.classList.contains("is-open");
    if (!overlay) build();
    if (firstOpen) { returnScrollY = window.scrollY || window.pageYOffset || 0; lastFocus = document.activeElement; lockBg(true); }
    render();
    if (firstOpen) {
      scroller.scrollTop = 0;
      requestAnimationFrame(function () { overlay.classList.add("is-open"); requestAnimationFrame(updateSpy); });
      if (!opts.silent) { var c = overlay.querySelector(".jrn__close"); if (c) { try { c.focus(); } catch (e) {} } }
    } else { updateSpy(); }
  }
  function close() {
    if (!overlay || !overlay.classList.contains("is-open")) return;
    overlay.classList.remove("is-open");
    lockBg(false);
    requestAnimationFrame(function () {
      if (window.__lenis && window.__lenis.scrollTo) window.__lenis.scrollTo(returnScrollY, { immediate: true });
      else window.scrollTo(0, returnScrollY);
    });
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  /* ---------- wiring ---------- */
  function init() {
    // render.js creates window.RK asynchronously (after fetching content.json) and MERGES via
    // Object.assign, so it's safe to seed it here first — our keys survive the merge.
    window.RK = window.RK || {};
    window.RK.openJourney = open;
    window.RK.closeJourney = close;
    window.RK.journeyHasContent = hasContent;
    if (PREVIEW) return;  // the admin drives openJourney() directly in the preview iframe
    // Landing CTA (rendered by render.js into #journeyCta) opens the overlay.
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-journey-open]");
      if (t) { e.preventDefault(); open(); }
    });
    // Shareable / preview entry: /?journey opens it once the site has rendered.
    if (new URLSearchParams(location.search).has("journey")) {
      var go = function () { if (hasContent()) open(); };
      if (window.__siteRendered) go(); else document.addEventListener("site:rendered", go, { once: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
