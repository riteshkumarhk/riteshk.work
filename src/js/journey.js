import { sanitizeRichHtml } from "./rich-html.mjs";
import { journeyRows } from "./journey-core.mjs";

(function () {
  "use strict";
  const previewFrame = new URLSearchParams(location.search).has("preview") && window.parent !== window;
  let currentData, rows = [], activeKey = null, mediaIndex = 0, editorPreview = false, caseReturn = null;
  const timeline = () => document.getElementById("timeline");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const md = value => window.RK?.md ? window.RK.md(value) : esc(value);
  const allStories = () => rows.flatMap(row => row.stories);
  const activeStory = () => allStories().find(story => story.key === activeKey);
  const media = story => (story.entry.images || []).filter(image => image?.src && mediaUrl(image.src));
  const video = image => image.kind === "video" || /^data:video\//i.test(image.src) || /\.(mp4|webm|mov|m4v|ogv)($|\?|#)/i.test(image.src);
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function mediaUrl(reference) {
    const value = window.RK?.mediaUrl ? window.RK.mediaUrl(reference) : reference;
    if (!value) return "";
    if (/^(blob:|data:(image|video)\/)/i.test(value)) return value;
    try {
      const url = new URL(value, location.href);
      return /^(https?:)$/.test(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }

  function prose(body) {
    if (!body) return "";
    const rich = /<(p|ul|ol|li|strong|em|b|i|s|strike|br|div|span|figure|img|blockquote|h[1-6])\b/i.test(body);
    return '<div class="jrn__prose">' + sanitizeRichHtml(rich ? body : String(body).split(/\n\n+/).map(part => "<p>" + md(part) + "</p>").join(""), mediaUrl) + "</div>";
  }

  function thumb(image) {
    if (!image) return '<span class="jrn-tile__empty" aria-hidden="true">&#8599;</span>';
    const src = esc(mediaUrl(image.src));
    return video(image)
      ? '<video src="' + src + '#t=0.1" muted playsinline preload="metadata" aria-hidden="true"></video><span class="jrn-tile__play" aria-hidden="true">&#9654;</span>'
      : '<img src="' + src + '" alt="" loading="lazy" draggable="false" />';
  }

  function tile(story) {
    const entry = story.entry;
    const identity = story.chapterIndex + "-" + story.entryIndex;
    const label = entry.title || story.chapter.name || "Chapter";
    return '<button type="button" class="jrn-tile" id="journey-story-' + identity + '" data-jstory="' + esc(story.key) + '" aria-expanded="false" aria-controls="journey-detail" aria-label="' + esc(label) + '">' +
      '<span class="jrn-tile__image">' + thumb(media(story)[0] || (story.chapter.logo ? { src: story.chapter.logo } : null)) + '</span>' +
      (entry.period ? '<span class="jrn-tile__period">' + esc(entry.period) + '</span>' : '') +
      '<span class="jrn-tile__title">' + md(label) + '</span></button>';
  }

  function render(data, options = {}) {
    currentData = data || window.RK?.data;
    if (!currentData || !timeline()) return;
    rows = journeyRows(currentData, { owner: options.owner ?? !!window.RK?.isOwnerPresentation?.(), preview: editorPreview && previewFrame });
    const host = timeline();
    host.querySelectorAll("video").forEach(element => element.pause());
    host.innerHTML = rows.map(row => '<li class="tl' + (row.role.present ? ' tl--present' : '') + '">' +
      '<div class="tl__year">' + esc(row.role.years) + '</div><div class="tl__main">' +
      '<h3>' + esc(row.role.role) + '</h3>' + (row.role.org ? '<span class="tl__org">' + esc(row.role.org) + '</span>' : '') +
      (row.role.desc ? '<p>' + esc(row.role.desc) + '</p>' : '') +
      (row.stories.length ? '<div class="jrn-stories">' + row.stories.map(tile).join('') + '</div>' : '') + '</div></li>').join('');
    if (activeStory()) expand(activeKey, false);
    else { activeKey = null; mediaIndex = 0; }
  }

  function triggerFor(key) {
    return [...(timeline()?.querySelectorAll("[data-jstory]") || [])].find(element => element.dataset.jstory === key);
  }

  function removeDetail() {
    const panel = document.getElementById("journey-detail");
    panel?.querySelectorAll("video").forEach(element => element.pause());
    panel?.remove();
    timeline()?.querySelectorAll('[aria-expanded="true"]').forEach(element => element.setAttribute("aria-expanded", "false"));
  }

  function close(focus = true) {
    const trigger = triggerFor(activeKey);
    removeDetail();
    activeKey = null;
    mediaIndex = 0;
    if (focus) trigger?.focus({ preventScroll: false });
  }

  function placeDetail(panel, trigger) {
    const siblings = [...trigger.parentElement.querySelectorAll("[data-jstory]")];
    const top = trigger.offsetTop;
    const last = siblings.filter(element => Math.abs(element.offsetTop - top) < 2).at(-1) || trigger;
    last.after(panel);
  }

  function expand(key, focus = true) {
    if (key !== activeKey) mediaIndex = 0;
    removeDetail();
    activeKey = key;
    const story = activeStory(), trigger = triggerFor(key);
    if (!story || !trigger) { activeKey = null; return; }
    trigger.setAttribute("aria-expanded", "true");
    const work = (currentData.work || []).find(item => item.id === story.entry.workId);
    const canLink = work && !work.encWork && (!work.hidden || window.RK?.isOwnerPresentation?.() || editorPreview && previewFrame);
    const panel = document.createElement("section");
    panel.id = "journey-detail";
    panel.className = "jrn-detail";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-labelledby", "journey-detail-title");
    panel.innerHTML = '<header class="jrn-detail__head"><div>' +
      (story.entry.period ? '<span class="jrn-tile__period">' + esc(story.entry.period) + '</span>' : '') +
      '<h4 id="journey-detail-title" tabindex="-1">' + md(story.entry.title || story.chapter.name || "Chapter") + '</h4></div>' +
      '<button type="button" class="jrn-control" data-jclose title="Close chapter" aria-label="Close chapter">&#215;</button></header>' +
      '<div class="jrn-detail__body"><div class="jrn-detail__copy">' + prose(story.entry.body) +
      (canLink ? '<button type="button" class="jrn-case" data-jwork="' + esc(work.id) + '">View case study <span aria-hidden="true">&#8599;</span></button>' : '') +
      '</div><div class="jrn-gallery"></div></div>';
    placeDetail(panel, trigger);
    renderMedia();
    if (focus) {
      panel.querySelector("h4").focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: reduced() ? "instant" : "smooth", block: "start" });
    }
  }

  function renderMedia() {
    const story = activeStory(), gallery = document.querySelector("#journey-detail .jrn-gallery");
    if (!story || !gallery) return;
    gallery.querySelectorAll("video").forEach(element => element.pause());
    const images = media(story);
    gallery.hidden = !images.length;
    gallery.closest(".jrn-detail__body").classList.toggle("jrn-detail__body--text", !images.length);
    if (!images.length) { gallery.innerHTML = ''; return; }
    mediaIndex = Math.max(0, Math.min(mediaIndex, images.length - 1));
    const image = images[mediaIndex], source = esc(mediaUrl(image.src));
    gallery.innerHTML = '<figure class="jrn-gallery__figure"><div class="jrn-gallery__stage">' +
      (video(image) ? '<video src="' + source + '" controls playsinline preload="metadata"></video>' :
        '<button type="button" data-jzoom aria-label="Enlarge image" title="Enlarge image"><img src="' + source + '" alt="' + esc(image.caption || story.entry.title || '') + '" /></button>') +
      '</div><figcaption class="jrn-gallery__caption">' + esc(image.caption || '') + '</figcaption></figure>' +
      (images.length > 1 ? '<div class="jrn-gallery__bar"><button class="jrn-control" type="button" data-jmedia="' + (mediaIndex - 1) + '" aria-label="Previous image" title="Previous image"' + (mediaIndex === 0 ? ' disabled' : '') + '>&#8592;</button><span aria-live="polite">' + (mediaIndex + 1) + ' / ' + images.length + '</span><button class="jrn-control" type="button" data-jmedia="' + (mediaIndex + 1) + '" aria-label="Next image" title="Next image"' + (mediaIndex === images.length - 1 ? ' disabled' : '') + '>&#8594;</button></div><div class="jrn-gallery__thumbs">' +
        images.map((item, index) => '<button type="button" data-jmedia="' + index + '" aria-label="Media ' + (index + 1) + '" aria-pressed="' + (index === mediaIndex) + '">' + thumb(item) + '</button>').join('') + '</div>' : '');
  }

  function open(options = {}) {
    editorPreview = !!options.preview && previewFrame;
    render(window.RK?.data);
    window.__rkShowPage?.("about", { push: !options.silent, scroll: false });
    if (!options.silent) document.getElementById("sec-path")?.scrollIntoView({ behavior: reduced() ? "instant" : "smooth", block: "start" });
  }

  function onClick(event) {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.hasAttribute("data-journey-open")) { open(); return; }
    if (!timeline()?.contains(target)) return;
    if (target.hasAttribute("data-jstory")) { target.dataset.jstory === activeKey ? close() : expand(target.dataset.jstory); return; }
    if (target.hasAttribute("data-jclose")) { close(); return; }
    if (target.hasAttribute("data-jretry")) { renderMedia(); document.querySelector('.jrn-gallery__stage button, .jrn-gallery__stage video')?.focus({ preventScroll: true }); return; }
    if (target.hasAttribute("data-jmedia")) {
      const label = target.getAttribute("aria-label");
      mediaIndex = Number(target.dataset.jmedia);
      renderMedia();
      const gallery = document.querySelector(".jrn-gallery");
      ([...gallery.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label && !button.disabled) || gallery.querySelector('[aria-pressed="true"]'))?.focus({ preventScroll: true });
      return;
    }
    if (target.hasAttribute("data-jzoom")) {
      const images = media(activeStory()), current = images[mediaIndex], stills = images.filter(image => !video(image));
      window.RK?.openLbx?.(stills.map(image => ({ src: mediaUrl(image.src), cap: image.caption || '' })), stills.indexOf(current));
      return;
    }
    if (target.hasAttribute("data-jwork")) {
      caseReturn = { path: location.pathname + location.search + location.hash, title: document.title };
      window.RK?.openProject?.(target.dataset.jwork, { push: true });
    }
  }

  function init() {
    window.RK = Object.assign(window.RK || {}, { openJourney: open, closeJourney: () => { editorPreview = false; close(false); render(window.RK?.data); }, renderJourney: render, journeyHasContent: () => allStories().length > 0 });
    document.addEventListener("click", onClick);
    document.addEventListener("error", event => {
      const stage = event.target.closest?.(".jrn-gallery__stage");
      if (!stage || !activeStory()) return;
      const image = media(activeStory())[mediaIndex];
      stage.innerHTML = '<div class="jrn-gallery__error" role="status"><p>Media unavailable</p><button type="button" class="jrn-case" data-jretry>Retry</button>' +
        (image ? '<a class="jrn-case" href="' + esc(mediaUrl(image.src)) + '" target="_blank" rel="noopener noreferrer">Open original <span aria-hidden="true">&#8599;</span></a>' : '') + '</div>';
    }, true);
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented || !activeKey || !timeline()?.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation(); close();
    });
    document.addEventListener("site:rendered", () => {
      render(window.RK?.data);
      if (new URLSearchParams(location.search).has("journey")) open({ silent: true });
    });
    document.addEventListener("rk:route", () => {
      if (!caseReturn || document.querySelector(".pj.is-open") || /^\/work\//.test(location.pathname)) return;
      history.replaceState({ rkPage: "about" }, "", caseReturn.path);
      document.title = caseReturn.title;
      caseReturn = null;
    });
    let resizeFrame = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const panel = document.getElementById("journey-detail"), trigger = triggerFor(activeKey);
        if (panel && trigger) { panel.remove(); placeDetail(panel, trigger); }
      });
    });
    if (window.__siteRendered) render(window.RK?.data);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();