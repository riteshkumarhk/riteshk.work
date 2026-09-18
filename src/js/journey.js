import { sanitizeRichHtml } from "./rich-html.mjs";
import { journeyRows } from "./journey-core.mjs";

(function () {
  "use strict";
  const previewFrame = new URLSearchParams(location.search).has("preview") && window.parent !== window;
  let currentData, rows = [], activeKey = null, mediaIndex = 0, editorPreview = false, caseReturn = null;
  let background = null, openingKey = null;
  let peekTile = null;
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
    const work = linkedWork(story);
    return '<div class="jrn-tile"><div class="jrn-tile__preview"><button type="button" class="jrn-tile__story" id="journey-story-' + identity + '" data-jstory="' + esc(story.key) + '" aria-expanded="false" aria-controls="journey-detail" aria-label="' + esc(label) + '">' +
      '<span class="jrn-tile__image">' + thumb(media(story)[0] || (story.chapter.logo ? { src: story.chapter.logo } : null)) + '</span><span class="jrn-tile__details">' +
      (entry.period ? '<span class="jrn-tile__period">' + esc(entry.period) + '</span>' : '') +
      '<span class="jrn-tile__title">' + md(label) + '</span></span></button>' +
      (work ? '<a class="jrn-case jrn-tile__case" data-jpeek-work="' + esc(work.id) + '" href="/work/' + encodeURIComponent(work.id) + '">View case study <span aria-hidden="true">&#8599;</span></a>' : '') + '</div></div>';
  }

  function linkedWork(story) {
    const work = (currentData.work || []).find(item => item.id === story?.entry.workId);
    return work && !work.encWork && (!work.hidden || window.RK?.isOwnerPresentation?.() || editorPreview && previewFrame) ? work : null;
  }

  function closePeek() {
    peekTile?.classList.remove("is-peeking");
    peekTile = null;
  }

  function peek(tile) {
    if (!tile || activeKey || tile === peekTile) return;
    closePeek();
    const bounds = tile.getBoundingClientRect(), host = tile.parentElement.getBoundingClientRect();
    const columns = innerWidth > 1000 ? 3 : innerWidth > 600 ? 2 : 1;
    const width = Math.min(innerWidth - 32, (host.width - (columns - 1) * 20) / columns);
    const left = Math.max(16 - bounds.left, Math.min(0, host.right - bounds.left - width));
    tile.style.setProperty("--jrn-peek-width", width + "px");
    tile.style.setProperty("--jrn-peek-left", left + "px");
    tile.style.setProperty("--jrn-peek-scale", Math.min(1, bounds.width / width));
    tile.style.setProperty("--jrn-peek-top", "0px");
    tile.classList.add("is-peeking");
    const preview = tile.querySelector(".jrn-tile__preview");
    const height = Math.min(preview.scrollHeight, innerHeight - 32);
    tile.style.setProperty("--jrn-peek-top", Math.max(16 - bounds.top, Math.min(0, innerHeight - 16 - bounds.top - height)) + "px");
    peekTile = tile;
  }

  function render(data, options = {}) {
    closePeek();
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
    else close(false);
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

  function lockBackground(on) {
    if (on && !background) {
      background = { x: scrollX, y: scrollY, htmlOverflow: document.documentElement.style.overflow, bodyOverflow: document.body.style.overflow, stopped: !!window.__lenis?.isStopped, elements: [...document.body.children].filter(element => !element.matches('.jrn, .pj, .pjx, .pjfx, script, style, link')).map(element => [element, element.inert]) };
    }
    if (!background) return;
    document.documentElement.style.overflow = on ? "hidden" : background.htmlOverflow;
    document.body.style.overflow = on ? "hidden" : background.bodyOverflow;
    background.elements.forEach(([element, inert]) => { element.inert = on || inert; });
    if (on) window.__lenis?.stop?.();
    else if (!background.stopped) window.__lenis?.start?.();
  }

  function close(focus = true) {
    const trigger = triggerFor(openingKey) || triggerFor(activeKey);
    const saved = background;
    removeDetail();
    lockBackground(false);
    background = null; openingKey = null; caseReturn = null;
    activeKey = null;
    mediaIndex = 0;
    if (saved) window.scrollTo(saved.x, saved.y);
    if (focus) { trigger?.focus({ preventScroll: true }); closePeek(); }
  }

  function expand(key, focus = true) {
    closePeek();
    if (key !== activeKey) mediaIndex = 0;
    removeDetail();
    activeKey = key;
    const story = activeStory(), trigger = triggerFor(key);
    if (!story || !trigger) { activeKey = null; return; }
    if (!openingKey) openingKey = key;
    trigger.setAttribute("aria-expanded", "true");
    const work = linkedWork(story);
    const panel = document.createElement("section");
    panel.id = "journey-detail";
    panel.className = "jrn jrn-detail";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "journey-detail-title");
    panel.setAttribute("data-lenis-prevent", "");
    panel.innerHTML = '<div class="jrn__top"><nav class="jrn-timeline" aria-label="Journey chapters">' + allStories().map(item =>
      '<button type="button" class="jrn-timeline__item" data-jchapter="' + esc(item.key) + '" aria-label="Open story: ' + esc(item.entry.title || item.chapter.name || "Chapter") + '"' + (item.key === key ? ' aria-current="step"' : '') + '><span class="jrn-tile__period">' + esc(item.entry.period || item.chapter.name) + '</span><span class="jrn-timeline__title">' + esc(item.entry.title || item.chapter.name || "Chapter") + '</span></button>').join('') +
      '</nav><button type="button" class="jrn-control" data-jclose title="Close chapter" aria-label="Close chapter">&#215;</button></div>' +
      '<div class="jrn__scroll"><div class="jrn-gallery"></div><div class="jrn-detail__body"><header class="jrn-detail__head"><div>' +
      (story.entry.period ? '<span class="jrn-tile__period">' + esc(story.entry.period) + '</span>' : '') +
      '<h4 id="journey-detail-title" tabindex="-1">' + md(story.entry.title || story.chapter.name || "Chapter") + '</h4></div></header>' +
      '<div class="jrn-detail__copy">' + prose(story.entry.body) +
      (work ? '<button type="button" class="jrn-case" data-jwork="' + esc(work.id) + '">View case study <span aria-hidden="true">&#8599;</span></button>' : '') +
      '</div></div></div>';
    document.body.append(panel);
    lockBackground(true);
    renderMedia();
    panel.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    if (focus) {
      panel.querySelector("h4").focus({ preventScroll: true });
    }
  }

  function renderMedia() {
    const story = activeStory(), gallery = document.querySelector("#journey-detail .jrn-gallery");
    if (!story || !gallery) return;
    gallery.querySelectorAll("video").forEach(element => element.pause());
    const images = media(story);
    gallery.hidden = !images.length;
    gallery.closest(".jrn-detail").classList.toggle("jrn-detail--text", !images.length);
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
    const selected = allStories().find(story => story.chapterIndex === options.chapterIndex && story.entryIndex === options.entryIndex);
    if (selected) {
      expand(selected.key, false);
      if (options.scroll) document.getElementById("journey-detail")?.scrollIntoView({ behavior: "instant", block: "start" });
    } else if (!options.silent || options.scroll) document.getElementById("sec-path")?.scrollIntoView({ behavior: reduced() ? "instant" : "smooth", block: "start" });
  }

  function onClick(event) {
    const target = event.target.closest("button, a[data-jpeek-work]");
    if (!target) return;
    if (target.hasAttribute("data-journey-open")) { open(); return; }
    if (!timeline()?.contains(target) && !document.getElementById("journey-detail")?.contains(target)) return;
    if (target.hasAttribute("data-jpeek-work")) {
      const trigger = target.closest(".jrn-tile").querySelector("[data-jstory]");
      const work = linkedWork(allStories().find(story => story.key === trigger.dataset.jstory));
      if (!work) { event.preventDefault(); return; }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      caseReturn = { path: location.pathname + location.search + location.hash, title: document.title, key: trigger.dataset.jstory };
      trigger.focus({ preventScroll: true });
      closePeek();
      window.RK?.openProject?.(work.id, { push: true });
      return;
    }
    if (target.hasAttribute("data-jstory")) { target.dataset.jstory === activeKey ? close() : expand(target.dataset.jstory); return; }
    if (target.hasAttribute("data-jchapter")) { expand(target.dataset.jchapter); return; }
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
      document.querySelectorAll('#journey-detail video').forEach(element => element.pause());
      document.getElementById("journey-detail").hidden = true;
      lockBackground(false);
      window.RK?.openProject?.(target.dataset.jwork, { push: true });
    }
  }

  function init() {
    window.RK = Object.assign(window.RK || {}, { openJourney: open, closeJourney: () => { editorPreview = false; close(false); render(window.RK?.data); }, renderJourney: render, journeyHasContent: () => allStories().length > 0 });
    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", event => {
      const tile = event.target.closest?.(".jrn-tile");
      if (event.pointerType === "mouse" && matchMedia("(hover: hover) and (pointer: fine)").matches && !tile?.contains(event.relatedTarget)) peek(tile);
    });
    document.addEventListener("pointerout", event => {
      if (peekTile?.contains(event.target) && !peekTile.contains(event.relatedTarget) && !peekTile.querySelector(":focus-visible")) closePeek();
    });
    document.addEventListener("focusin", event => {
      const tile = event.target.closest?.(".jrn-tile");
      if (tile && event.target.matches(":focus-visible")) peek(tile);
    });
    document.addEventListener("focusout", event => {
      if (peekTile?.contains(event.target) && !peekTile.contains(event.relatedTarget)) closePeek();
    });
    window.addEventListener("resize", closePeek);
    document.addEventListener("error", event => {
      const stage = event.target.closest?.(".jrn-gallery__stage");
      if (!stage || !activeStory()) return;
      const image = media(activeStory())[mediaIndex];
      stage.innerHTML = '<div class="jrn-gallery__error" role="status"><p>Media unavailable</p><button type="button" class="jrn-case" data-jretry>Retry</button>' +
        (image ? '<a class="jrn-case" href="' + esc(mediaUrl(image.src)) + '" target="_blank" rel="noopener noreferrer">Open original <span aria-hidden="true">&#8599;</span></a>' : '') + '</div>';
    }, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && peekTile) { closePeek(); event.preventDefault(); return; }
      const panel = document.getElementById("journey-detail");
      if (!panel || panel.hidden || event.defaultPrevented || document.querySelector('.pjx.is-open, .pj.is-open')) return;
      if (event.key === "Escape" && panel.contains(event.target)) { event.preventDefault(); event.stopPropagation(); close(); return; }
      const chapter = event.target.closest?.("[data-jchapter]");
      if (chapter && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        const stories = allStories(), index = stories.findIndex(item => item.key === activeKey);
        const next = event.key === "Home" ? 0 : event.key === "End" ? stories.length - 1 : Math.max(0, Math.min(stories.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
        event.preventDefault(); expand(stories[next].key, false);
        document.querySelector('.jrn-timeline [aria-current="step"]')?.focus({ preventScroll: true });
      }
      if (event.key === "Tab") {
        const controls = [...panel.querySelectorAll('button:not(:disabled), a[href], video[controls], [tabindex="0"]')].filter(element => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    });
    document.addEventListener("site:rendered", () => {
      render(window.RK?.data);
      if (new URLSearchParams(location.search).has("journey")) open({ silent: true });
    });
    document.addEventListener("rk:route", () => {
      if (!caseReturn || document.querySelector(".pj.is-open") || /^\/work\//.test(location.pathname)) return;
      history.replaceState({ rkPage: "about" }, "", caseReturn.path);
      document.title = caseReturn.title;
      const returnKey = caseReturn.key;
      caseReturn = null;
      const panel = document.getElementById("journey-detail");
      if (panel) { panel.hidden = false; lockBackground(true); panel.querySelector('[data-jwork]')?.focus({ preventScroll: true }); }
      else if (returnKey) { triggerFor(returnKey)?.focus({ preventScroll: true }); closePeek(); }
    });
    if (window.__siteRendered) render(window.RK?.data);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();