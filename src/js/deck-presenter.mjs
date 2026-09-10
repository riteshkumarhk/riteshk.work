import { installPresenterPointer } from "./presenter-pointer.mjs";
import { installWebPresenterPreview, requestPresenterCapture } from "./presenter-web-preview.mjs";
import { createPresenterClock } from "./presenter-clock.mjs";
import { presenterPanelMarkup, presenterPanelStyles, installPresenterPanel } from "./presenter-panel.mjs";
var pjpStage = null;
export function presentDeckWithRenderer(w, opts, { renderPjSlide, pjDeckSlides, pjSlideTitle, pjNotesHtml, fitSections, enhanceStudyBlocks, mountSlide, renderThumbnail, thumbnailData, dispose }) {
  opts = opts || {};
  if (!w || pjpStage) return;
  var st = w.study || {};
  var slides = (opts.slides && opts.slides.length) ? opts.slides : pjDeckSlides(w, st);
  if (!slides.length) return;
  var idx = Math.max(0, Math.min(slides.length - 1, opts.start || 0));
  var stage = document.createElement("div");
  var returnFocus = document.activeElement;
  pjpStage = stage;
  stage.className = "pjp";
  stage.tabIndex = -1;
  stage.setAttribute("role", "dialog"); stage.setAttribute("aria-modal", "true"); stage.setAttribute("aria-label", "Presentation");
  stage.innerHTML =
    '<div class="pjp__stagewrap"><div class="pjp__frame" data-pjp-frame></div></div>' +
    '<div class="pjp__bar"><button class="pjp__x" data-pjp="exit" aria-label="Exit presentation" title="Exit (Esc)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
    '<div class="pjp__progress" data-pjp-progress></div><span class="pjp__count" data-pjp-count></span>' +
    '<button class="pjp__notesbtn" data-pjp="notes" aria-label="Presenter notes (P)" title="Presenter notes (P)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>' +
    '<button class="pjp__popbtn" data-pjp="popout" aria-label="Open presenter window" title="Open the presenter view in a separate window — keep your notes private while screen-sharing the slides"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></button></div>' +
    '<button class="pjp__edge pjp__edge--prev" data-pjp="prev" aria-label="Previous slide"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
    '<button class="pjp__edge pjp__edge--next" data-pjp="next" aria-label="Next slide"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
    '<div class="pjp__present" data-pjp-panel>' +
    '<div class="pjp__pmeta"><div class="pjp__ptime"><span class="pjp__ptime-v" data-pjp-timer>0:00</span><span class="pjp__ptime-l">elapsed</span></div><button class="pjp__ptimereset" data-pjp="timer-reset" title="Reset the timer">Reset</button><span class="pjp__pclock" data-pjp-clock></span></div>' +
    '<div class="pjp__pnotes"><span class="pjp__plabel">Notes</span><div class="pjp__pnotes-body" data-pjp-notes></div></div>' +
    '<div class="pjp__pnext"><span class="pjp__plabel">Up next</span><div class="pjp__pnext-thumb" data-pjp-nextthumb></div><div class="pjp__pnext-body" data-pjp-next></div></div>' +
    '</div>';
  document.body.appendChild(stage);
  var inactiveSiblings = Array.prototype.filter.call(document.body.children, function (element) { return element !== stage && !element.inert; });
  inactiveSiblings.forEach(function (element) { element.inert = true; });
  stage.focus({ preventScroll: true });
  var frame = stage.querySelector("[data-pjp-frame]"), prog = stage.querySelector("[data-pjp-progress]"), count = stage.querySelector("[data-pjp-count]");
  var nativeHost = window.__RK_NATIVE_PRESENTER === true && !!window.chrome?.webview;
  var pointer = installPresenterPointer(stage, frame, nativeHost);
  stage.classList.toggle("pjp--native", nativeHost);
  var notesEl = stage.querySelector("[data-pjp-notes]"), nextEl = stage.querySelector("[data-pjp-next]"), presenting = false;
  var nextThumb = stage.querySelector("[data-pjp-nextthumb]"), timerEl = stage.querySelector("[data-pjp-timer]"), clockEl = stage.querySelector("[data-pjp-clock]"), startT = Date.now(), presenterWin = null;
  var exited = false, openingPresenter = false, pipUnavailable = false, webPreview = null, panel = null;
  var clock = createPresenterClock(), lastTimedIndex = idx, ownsFullscreen = false, editRevision = 0, launchCapture = null, saveStatus = "";
  var nativeThumbnails = [];
  var nativeDocuments = nativeHost && !thumbnailData ? slides.map(function (slide) {
    var links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(function (link) { return '<link rel="stylesheet" href="' + link.href + '">'; }).join('');
    return '<!doctype html><html><head><meta charset="utf-8">' + links + '<style>html,body{margin:0;width:1280px;height:720px;overflow:hidden}body>.pjps{width:1280px;height:720px}</style></head><body>' + renderPjSlide(slide) + '</body></html>';
  }) : [];
  var metadata = slides.map(function (slide) { return { notes: slide.notes || "", durationMinutes: Math.max(0, Math.min(240, Number(slide.durationMinutes) || 0)) }; });
  function currentNotes() { return metadata[idx].notes; }
  function panelState() { return { index: idx, notes: currentNotes(), durationMinutes: metadata[idx].durationMinutes, saveStatus:saveStatus, slides: slides.map(function (slide, index) { return { title: pjSlideTitle(slide), thumbnail:nativeThumbnails[index], document:nativeDocuments[index] }; }) }; }
  function pacing() { var budget = metadata[idx].durationMinutes * 60000; return { elapsed: clock.elapsed(), paused: clock.paused, budget: budget, remaining: budget - clock.slideElapsed(), totalBudget: metadata.reduce(function (total, slide) { return total + slide.durationMinutes * 60000; }, 0), format: fmtDur }; }
  function editSlide(index, key, value) {
    if (!opts.onSlideEdit || !Number.isInteger(index) || !slides[index] || !["notes", "durationMinutes"].includes(key)) return;
    if (key === "notes") { if (typeof value !== "string") return; }
    else { value = Number(value); if (!Number.isFinite(value) || value < 0 || value > 240) return; }
    metadata[index][key] = value;
    var revision = ++editRevision;
    saveStatus = "Saving..."; panel?.saved(saveStatus);
    Promise.resolve().then(function () { return opts.onSlideEdit(slides[index], key, value); }).then(function () { if (revision === editRevision) { saveStatus = "Saved to deck"; panel?.saved(saveStatus); syncNative(); } }, function () { if (revision === editRevision) { saveStatus = "Not saved. Edit again to retry."; panel?.saved(saveStatus); syncNative(); } });
    if (notesEl && !nativeHost) notesEl.innerHTML = pjNotesHtml(currentNotes());
    tick(); syncNative();
  }
  async function fullscreen() {
    if (exited || nativeHost || document.fullscreenElement) return;
    try { await stage.requestFullscreen(); ownsFullscreen = true; if (exited) await document.exitFullscreen(); }
    catch (error) { if (panel) panel.saved("Fullscreen unavailable. Use the fullscreen button to retry."); }
  }
  function command(action) {
    if (action === "prev") go(-1); else if (action === "next") go(1); else if (action === "exit") exit();
    else if (action === "timer-pause") { clock.toggle(); tick(); syncNative(); }
    else if (action === "timer-reset") { clock.reset(); startT = Date.now(); tick(); syncNative(); }
    else if (action === "fullscreen") fullscreen();
  }
  var popButton = stage.querySelector('[data-pjp="popout"]');
  popButton.title = window.documentPictureInPicture ? "Open always-on-top presenter window" : "Open presenter window (always-on-top is unavailable in this browser)";
  function preview(container, slide) {
    if (renderThumbnail) { renderThumbnail(container, slide); return; }
    container.innerHTML = '<div class="slidepv__stage">' + renderPjSlide(slide) + "</div>";
    if (container.firstChild) container.firstChild.style.transform = "scale(" + ((container.clientWidth || 300) / 1280) + ")";
  }
  function pjPad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtDur(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ":" + pjPad(m) : m) + ":" + pjPad(s % 60); }
  function tick() { if (presenterWin && presenterWin.closed) onPresenterClosed(); if (timerEl) timerEl.textContent = fmtDur(clock.elapsed()); if (clockEl) clockEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); if (panel) panel.tick(pacing()); if (nativeHost) syncNative(); }
  var clockTimer = setInterval(tick, 1000); tick();
  prog.innerHTML = slides.map(function (_, i) { return '<span class="pjp__pdot" data-pjp-dot="' + i + '"></span>'; }).join("");
  document.documentElement.classList.add("pjp-on");
  var reduceMo = (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches), transTimer = 0;
  function syncNative() {
    if (!nativeHost || exited) return;
    var parsed = new DOMParser().parseFromString(pjNotesHtml(currentNotes()), "text/html");
    parsed.querySelectorAll("br").forEach(function (element) { element.replaceWith("\n"); });
    parsed.querySelectorAll("p,li,div").forEach(function (element) { element.append("\n"); });
    var bounds = frame.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    window.chrome.webview.postMessage({ channel: "rk-presenter", type: "state", ...panelState(), notes: opts.onSlideEdit ? currentNotes() : parsed.body.textContent.trim(), editable: !!opts.onSlideEdit, total: slides.length, nextTitle: idx + 1 < slides.length ? pjSlideTitle(slides[idx + 1]) : "", started: startT, elapsed: clock.elapsed(), paused: clock.paused, budget: pacing().budget, remaining: pacing().remaining, totalBudget: pacing().totalBudget, width: bounds.width, height: bounds.height, left: bounds.left, top: bounds.top });
  }
  function onNative(event) {
    var message = event.data;
    if (!message || message.channel !== "rk-presenter") return;
    if (message.command === "pointer") pointer.point(message.x, message.y, true);
    else if (message.command === "pointer-leave") pointer.hide();
    else if (message.command === "jump" && Number.isInteger(message.index) && slides[message.index]) { idx = message.index; render(1); }
    else if (message.command === "edit") editSlide(message.index, message.key, message.value);
    else command(message.command);
  }
  if (nativeHost) { window.chrome.webview.addEventListener("message", onNative); window.addEventListener("resize", syncNative); }
  function pjSlideTrans(s) { var t = s && s.transition; return (t === "none" || t === "push" || t === "magic") ? t : "fade"; }
  function updateChrome() {
    var s = slides[idx];
    count.textContent = (idx + 1) + " / " + slides.length;
    if (notesEl && !nativeHost) notesEl.innerHTML = pjNotesHtml(currentNotes());
    if (nextEl) nextEl.textContent = (idx < slides.length - 1) ? pjSlideTitle(slides[idx + 1]) : "End of deck";
    if (nextThumb) {
      if (idx < slides.length - 1) {
        nextThumb.classList.remove("is-end");
        preview(nextThumb, slides[idx + 1]);
      } else { nextThumb.classList.add("is-end"); if (renderThumbnail) renderThumbnail(nextThumb, null); else nextThumb.innerHTML = ""; }
    }
    [].forEach.call(prog.children, function (d, i) { d.classList.toggle("is-on", i <= idx); });
    syncPresenter();
    syncNative();
  }
  // Auto-animate: FLIP every block whose match-key exists on both slides from its old rect to its new one.
  function magicMove(oldEl, newEl) {
    var olds = {};
    [].forEach.call(oldEl.querySelectorAll("[data-mk]"), function (el) { var k = el.getAttribute("data-mk"); if (!(k in olds)) olds[k] = el; });
    var moved = [];
    [].forEach.call(newEl.querySelectorAll("[data-mk]"), function (el) {
      var k = el.getAttribute("data-mk"), o = olds[k];
      if (o) {
        var nr = el.getBoundingClientRect(), or = o.getBoundingClientRect();
        var dx = or.left - nr.left, dy = or.top - nr.top, sx = or.width / (nr.width || 1), sy = or.height / (nr.height || 1);
        var base = el.style.transform || "";
        el.style.transformOrigin = "top left"; el.style.transition = "none";
        el.style.transform = "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ") " + base;
        o.style.visibility = "hidden"; moved.push({ el: el, base: base });
      } else { el.classList.add("pjps--in-fade"); void el.offsetWidth; el.classList.add("is-live"); }
    });
    oldEl.classList.add("pjps--out-fade");
    requestAnimationFrame(function () { requestAnimationFrame(function () { moved.forEach(function (m) { m.el.style.transition = "transform .52s var(--ease)"; m.el.style.transform = m.base; }); }); });
    transTimer = setTimeout(function () { if (oldEl.parentNode) oldEl.remove(); moved.forEach(function (m) { m.el.style.transition = ""; m.el.style.transformOrigin = ""; }); [].forEach.call(newEl.querySelectorAll(".pjps--in-fade"), function (el) { el.classList.remove("pjps--in-fade", "is-live"); }); }, 560);
  }
  function render(dir) {
    if (idx !== lastTimedIndex) { clock.nextSlide(); lastTimedIndex = idx; }
    pointer.hide();
    webPreview?.resetPointer();
    if (mountSlide) {
      mountSlide(frame, slides[idx], idx);
      updateChrome();
      return;
    }
    clearTimeout(transTimer);
    var kids = frame.querySelectorAll(".pjps"); for (var j = 0; j < kids.length - 1; j++) kids[j].remove();
    var oldEl = frame.querySelector(".pjps"), s = slides[idx];
    var tmp = document.createElement("div"); tmp.innerHTML = renderPjSlide(s); var newEl = tmp.firstChild;
    function place(el) { frame.appendChild(el); fitSections(el); enhanceStudyBlocks(el); }
    updateChrome();
    if (!oldEl) { place(newEl); frame.classList.remove("pjp__frame--in"); void frame.offsetWidth; frame.classList.add("pjp__frame--in"); return; }
    var trans = pjSlideTrans(s);
    if (reduceMo || trans === "none") { oldEl.remove(); place(newEl); return; }
    place(newEl);
    if (trans === "magic" && oldEl.querySelector("[data-mk]") && newEl.querySelector("[data-mk]")) { magicMove(oldEl, newEl); return; }
    var dirf = dir < 0 ? -1 : 1;
    if (trans === "push") { newEl.style.setProperty("--pjd", dirf); oldEl.style.setProperty("--pjd", dirf); newEl.classList.add("pjps--in-push"); }
    else newEl.classList.add("pjps--in-fade");
    void newEl.offsetWidth; newEl.classList.add("is-live");
    oldEl.classList.add(trans === "push" ? "pjps--out-push" : "pjps--out-fade");
    transTimer = setTimeout(function () { if (oldEl.parentNode) oldEl.remove(); if (newEl.parentNode) { newEl.classList.remove("pjps--in-fade", "pjps--in-push", "is-live"); newEl.style.removeProperty("--pjd"); } }, 520);
  }
  function go(d) { var n = Math.max(0, Math.min(slides.length - 1, idx + d)); if (n === idx) return; idx = n; render(d); }
  function togglePresent() { if (nativeHost || presenterWin && !presenterWin.closed) return; presenting = !presenting; stage.classList.toggle("pjp--presenting", presenting); if (presenting) updateChrome(); }
  // A second-screen / screen-share-safe presenter view: a SEPARATE window (private) shows notes,
  // timer, current + next slide; the main window stays the clean slides you share. Same-origin, so
  // the main window drives both. Share just the slides WINDOW (or a 2nd display) to keep notes hidden.
  function presenterDocHtml() {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presenter DJ pad</title>' + [].slice.call(document.querySelectorAll('link[rel="stylesheet"]')).map(function (link) { return '<link rel="stylesheet" href="' + link.href + '">'; }).join('') + '<style>' + presenterPanelStyles + '</style></head><body class="pp-body">' + presenterPanelMarkup() + '</body></html>';
  }
  function legacyPresenterDocHtml() {
    var links = [].slice.call(document.querySelectorAll('link[rel="stylesheet"]')).map(function (l) { return '<link rel="stylesheet" href="' + l.href + '">'; }).join("");
    var css = "<style>" +
      ".pp-body{margin:0;background:#050506;color:#ece7e1;font-family:var(--sans,Inter,system-ui,sans-serif);height:100vh;overflow:hidden}" +
      ".pp{display:grid;grid-template-columns:1.35fr 1fr;gap:18px;height:100vh;box-sizing:border-box;padding:18px}" +
      ".pp__main{display:flex;flex-direction:column;min-width:0;min-height:0;gap:14px;overflow:auto}" +
      ".pp-body,.pp-body *{cursor:auto}.pp-body button{cursor:pointer}.pp__livebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pp__livestatus{font-size:.78rem;line-height:1.4;color:#b8b2aa;flex:1;min-width:150px}.pp__media{display:flex;align-items:center;gap:10px}.pp__media[hidden]{display:none}.pp__media input{min-width:0;flex:1;accent-color:var(--accent,#d8a657)}.pp__btn:disabled{opacity:.5;cursor:default}.pp__nowwrap{flex-shrink:0}.pp__now--live{cursor:none}.pp__media svg{display:block}" +
      ".pp__nowwrap{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:var(--bg,#0a0a0c);border:1px solid rgba(255,255,255,.12)}" +
      ".pp__now{position:absolute;inset:0}.pp__now,.pp__now *{cursor:inherit}.pp__now .slidepv__stage{position:absolute;top:0;left:0;transform-origin:top left}.pp__now .slidepv__stage .pjps--free{padding:0}" +
      ".pp__meta{display:flex;align-items:center;gap:14px}.pp__time{display:flex;align-items:baseline;gap:6px;font-family:var(--mono,ui-monospace,monospace)}.pp__time span{font-size:2rem;font-variant-numeric:tabular-nums}.pp__time em{font-style:normal;text-transform:uppercase;letter-spacing:.12em;font-size:.6rem;color:#8a857e}" +
      ".pp__clock{margin-left:auto;font-family:var(--mono,monospace);font-size:1rem;color:#b8b2aa}.pp__count{font-family:var(--mono,monospace);font-size:1rem;color:#b8b2aa}" +
      ".pp__ctrls{display:flex;gap:10px;margin-top:auto}.pp__btn{font-family:var(--mono,monospace);font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#ece7e1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:.7rem 1.1rem;cursor:pointer}.pp__btn:hover{border-color:var(--accent,#d8a657);color:var(--accent,#d8a657)}.pp__btn--next{flex:1;background:var(--accent,#d8a657);color:#161206;border-color:var(--accent,#d8a657);font-weight:600}.pp__btn--next:hover{color:#161206}.pp__btn--end{margin-left:auto}" +
      ".pp__side{display:flex;flex-direction:column;min-width:0;gap:8px;overflow:hidden}.pp__lbl{font-family:var(--mono,monospace);text-transform:uppercase;letter-spacing:.16em;font-size:.62rem;color:var(--accent,#d8a657)}" +
      ".pp__notes{flex:1 1 auto;overflow:auto;font-size:1.35rem;line-height:1.5;color:#ece7e1}.pp__notes p{margin:0 0 .6em}.pp__pnote-empty{color:#6f6a63}" +
      ".pp__nextbox{flex:0 0 auto;border-top:1px solid rgba(255,255,255,.1);padding-top:8px}.pp__next{position:relative;width:100%;max-width:260px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:var(--bg,#0a0a0c);border:1px solid rgba(255,255,255,.1);margin:.35rem 0}.pp__next .slidepv__stage{position:absolute;top:0;left:0;transform-origin:top left}.pp__next .slidepv__stage .pjps--free{padding:0}.pp__nexttitle{font-family:var(--serif,Georgia,serif);color:#b8b2aa;font-size:1rem}" +
      ".pp__hint{flex:0 0 auto;font-size:.78rem;line-height:1.4;color:#8a857e;border-top:1px solid rgba(255,255,255,.08);padding-top:8px}@media(max-width:820px){.pp{grid-template-columns:1fr}}" +
      "</style>";
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Presenter view \u2014 riteshk.work</title>" + links + css + "</head><body class=\"pp-body\">" +
      '<div class="pp"><div class="pp__main">' +
      '<div class="pp__nowwrap"><div class="pp__now" data-pp-now></div></div>' +
      '<div class="pp__livebar"><button class="pp__btn" data-pp-live>Connect live preview</button><span class="pp__livestatus" data-pp-status role="status">Pointer connected. Live video preview is optional.</span></div>' +
      '<div class="pp__meta"><div class="pp__time"><span data-pp-timer>0:00</span><em>elapsed</em></div><button class="pp__btn" data-pp="timer-reset">Reset</button><span class="pp__clock" data-pp-clock></span><span class="pp__count" data-pp-count></span></div>' +
      '<div class="pp__ctrls"><button class="pp__btn" data-pp="prev">\u2039 Previous</button><button class="pp__btn pp__btn--next" data-pp="next">Next \u203a</button><button class="pp__btn pp__btn--end" data-pp="exit">End</button></div>' +
      '</div><div class="pp__side">' +
      '<div class="pp__lbl">Speaker notes</div><div class="pp__notes" data-pp-notes></div>' +
      '<div class="pp__nextbox"><div class="pp__lbl">Next slide</div><div class="pp__next" data-pp-next></div><div class="pp__nexttitle" data-pp-nexttitle></div></div>' +
      '<div class="pp__hint">Share the <b>slides tab or window</b>, not your entire screen. Check your meeting preview: screen capture can include these notes.</div>' +
      '</div></div></body></html>';
  }
  function syncPresenter() {
    if (!presenterWin || presenterWin.closed) return;
    var doc = presenterWin.document, s = slides[idx];
    var now = doc.querySelector("[data-pp-now]");
    if (now && !webPreview?.live) preview(now, s);
    var nx = doc.querySelector("[data-pp-next]"), nt = doc.querySelector("[data-pp-nexttitle]");
    if (idx < slides.length - 1) {
      if (nx) { nx.style.display = ""; preview(nx, slides[idx + 1]); }
      if (nt) nt.textContent = pjSlideTitle(slides[idx + 1]);
    } else { if (nx) { nx.style.display = "none"; if (renderThumbnail) renderThumbnail(nx, null); else nx.innerHTML = ""; } if (nt) nt.textContent = "End of deck"; }
    if (panel) { panel.update(panelState()); panel.tick(pacing()); }
  }
  function onPresenterClosed(event) { if (event && presenterWin && event.currentTarget !== presenterWin) return; panel?.dispose(); panel = null; if (webPreview) { webPreview.dispose(); webPreview = null; } presenterWin = null; stage.classList.remove("pjp--popped"); var pb = stage.querySelector('[data-pjp="popout"]'); if (pb) pb.classList.remove("is-on"); }
  async function openPresenter() {
    if (nativeHost) return;
    if (exited || openingPresenter) return;
    if (presenterWin && !presenterWin.closed) { presenterWin.focus(); return; }
    var opened = null, pinned = false;
    openingPresenter = true;
    try {
      if (window.documentPictureInPicture && !pipUnavailable) {
        try {
          opened = await window.documentPictureInPicture.requestWindow({ width: 960, height: 720 });
          pinned = true;
        } catch (error) {
          pipUnavailable = true;
          popButton.title = "Always-on-top unavailable. Click to open a regular presenter window.";
        }
      }
      if (exited) { if (opened) opened.close(); return; }
      if (!opened) opened = window.open("", "rkPresenter", "width=1060,height=720");
      if (!opened) { popButton.title = "Presenter window blocked. Allow popups, then click again."; return; }
      presenterWin = opened;
    } finally { openingPresenter = false; }
    var markup = new DOMParser().parseFromString(presenterDocHtml(), "text/html");
    var presenterDoc = presenterWin.document;
    presenterDoc.head.replaceChildren.apply(presenterDoc.head, Array.from(markup.head.childNodes).map(function (node) { return presenterDoc.importNode(node, true); }));
    presenterDoc.body.className = "pp-body";
    presenterDoc.body.replaceChildren(...Array.from(markup.body.children).map(function (node) { return presenterDoc.importNode(node, true); }));
    presenterDoc.documentElement.dataset.presenterWindow = pinned ? "always-on-top" : "popup";
    webPreview = installWebPresenterPreview({ frame: frame, pointer: pointer, container: presenterDoc.querySelector("[data-pp-now]"), presenterWindow: presenterWin, button: presenterDoc.querySelector("[data-pp-live]"), status: presenterDoc.querySelector("[data-pp-status]"), onDisconnect: syncPresenter, captureTicket:launchCapture });
    popButton.title = pinned ? "Focus always-on-top presenter window" : "Focus presenter window (not always-on-top)";
    panel = installPresenterPanel({ doc: presenterDoc, onCommand: command, onEdit: opts.onSlideEdit ? editSlide : null, onJump: function (index) { idx = index; render(1); }, renderThumbnail: function (container, index) { preview(container, slides[index]); }, onResize: function () { if (presenterWin && !exited) syncPresenter(); } });
    presenterWin.addEventListener("keydown", onKey);
    presenterWin.addEventListener("pagehide", onPresenterClosed);
    stage.classList.add("pjp--popped"); presenting = false; stage.classList.remove("pjp--presenting");
    var pb = stage.querySelector('[data-pjp="popout"]'); if (pb) pb.classList.add("is-on");
    setTimeout(syncPresenter, 60); syncPresenter();
    if (opts.autoStart) webPreview.connect();
  }
    function exit() { if (exited) return; exited = true; launchCapture?.cancel(); panel?.dispose(); panel = null; if (ownsFullscreen && document.fullscreenElement === stage) document.exitFullscreen().catch(function () {}); if (webPreview) { webPreview.dispose(); webPreview = null; } pointer.dispose(); if (nativeHost) { window.chrome.webview.removeEventListener("message", onNative); window.removeEventListener("resize", syncNative); window.chrome.webview.postMessage({ channel: "rk-presenter", type: "end" }); } clearInterval(clockTimer); clearTimeout(transTimer); if (presenterWin && !presenterWin.closed) { try { presenterWin.removeEventListener("pagehide", onPresenterClosed); presenterWin.close(); } catch (e) {} } presenterWin = null; document.removeEventListener("keydown", onKey); document.documentElement.classList.remove("pjp-on"); stage.classList.add("pjp--out"); setTimeout(function () { if (dispose) dispose(); stage.remove(); pjpStage = null; inactiveSiblings.forEach(function (element) { element.inert = false; }); if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true }); if (opts.onClose) opts.onClose(); }, 240); }
  function onKey(e) {
    if (e.key === "Tab" && e.currentTarget === document) {
      var controls = Array.prototype.filter.call(stage.querySelectorAll('button:not(:disabled), a[href], video[controls], iframe, [tabindex="0"]'), function (element) { return element.getClientRects().length && getComputedStyle(element).visibility !== "hidden" && (!element.closest("[data-pjp-panel]") || presenting); });
      if (!controls.length) { e.preventDefault(); stage.focus(); return; }
      var focused = controls.indexOf(document.activeElement);
      if (focused < 0 || (!e.shiftKey && focused === controls.length - 1) || (e.shiftKey && focused === 0)) { e.preventDefault(); controls[e.shiftKey ? controls.length - 1 : 0].focus(); }
      return;
    }
    if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    if (e.target && e.target.closest("video[controls],audio[controls]")) return;
    if (e.key === " " && e.target && e.target.closest("button, a")) return;
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    else if (e.key === "Escape") { e.preventDefault(); exit(); }
    else if (e.key === "p" || e.key === "P") { e.preventDefault(); togglePresent(); }
    else if (e.key === "Home") { idx = 0; render(-1); }
    else if (e.key === "End") { idx = slides.length - 1; render(1); }
  }
  stage.addEventListener("click", function (e) {
    var lk = e.target.closest("[data-pjhref],[data-pjjump]");
    if (lk && stage.contains(lk)) {
      var hr = lk.getAttribute("data-pjhref");
      if (hr) { window.open(hr, "_blank", "noopener"); return; }
      var jp = parseInt(lk.getAttribute("data-pjjump"), 10);
      if (isFinite(jp)) { var _jt = Math.max(0, Math.min(slides.length - 1, jp - 1)); var _jd = _jt > idx ? 1 : -1; idx = _jt; render(_jd); return; }
    }
    var d = e.target.closest("[data-pjp-dot]"); if (d) { var _to = +d.getAttribute("data-pjp-dot"); var _dd = _to > idx ? 1 : -1; idx = _to; render(_dd); return; }
    var b = e.target.closest("[data-pjp]"); if (!b) return;
    var k = b.getAttribute("data-pjp");
    if (k === "notes") togglePresent(); else if (k === "popout") openPresenter(); else command(k);
  });
  document.addEventListener("keydown", onKey);
  render(1);
  if (nativeHost && thumbnailData) slides.forEach(function (slide,index) { Promise.resolve(thumbnailData(slide)).then(function (image) { if (!exited) { nativeThumbnails[index] = image; syncNative(); } }).catch(function () {}); });
  if (!nativeHost && opts.autoStart) {
    launchCapture = requestPresenterCapture();
    openPresenter().then(function () { if (!presenterWin) launchCapture?.cancel(); fullscreen(); });
  }
  return { close: exit };
}

