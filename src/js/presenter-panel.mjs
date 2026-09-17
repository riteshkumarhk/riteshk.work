import { installRichNotes, notesText } from "./slide-rich-text.mjs";
import { formatSlideDuration, parseSlideDuration, installSlideTimeScrub, SLIDE_TIME_STEP_SECONDS } from "./slide-merge-notes.mjs";
import { __iconNode as timerIcon } from "lucide-react/dist/esm/icons/timer.mjs";
import { __iconNode as userIcon } from "lucide-react/dist/esm/icons/user-round.mjs";
import { __iconNode as noteIcon } from "lucide-react/dist/esm/icons/message-square-text.mjs";
import { __iconNode as upIcon } from "lucide-react/dist/esm/icons/chevron-up.mjs";
import { __iconNode as downIcon } from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { __iconNode as slidesIcon } from "lucide-react/dist/esm/icons/layout-grid.mjs";

const lucidePaths = Object.fromEntries(Object.entries({ timer:timerIcon, user:userIcon, note:noteIcon, up:upIcon, down:downIcon, slides:slidesIcon }).map(([name, nodes]) => [name, nodes.map(([tag, attributes]) => '<' + tag + ' ' + Object.entries(attributes).filter(([key]) => key !== 'key').map(([key, value]) => key + '="' + value + '"').join(' ') + '/>').join('')]));
const DEFAULT_NOTES_SIZE = 20;

const paths = {
  ...lucidePaths,
  bold: '<path d="M6 4h7a4 4 0 0 1 0 8H6Zm0 8h8a4 4 0 0 1 0 8H6Z"/>', italic: '<path d="M19 4h-9m4 16H5M15 4 9 20"/>', list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>', indent: '<path d="M10 5h11M10 12h11M10 19h11m-18-9 3 3-3 3"/>', outdent: '<path d="M10 5h11M10 12h11M10 19h11m-15-9-3 3 3 3"/>',
  prev: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>',
  pause: '<path d="M8 4v16M16 4v16"/>', play: '<path d="m8 5 11 7-11 7Z"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.4 7M3 4v7h7"/>', stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  connect: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-3-10 2 2 4-4"/>',
  disconnect: '<path d="m3 3 18 18M8 21h8m-4-4v4M3 8v7a2 2 0 0 0 2 2h12M9 4h10a2 2 0 0 1 2 2v9"/>',
  retry: '<path d="M3 11a9 9 0 1 1 2.4 7M3 4v7h7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14m-7-7v14"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>'
};
export const presenterIcon = name => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.connect) + '</svg>';
const button = (name, label, action) => '<button class="pp__btn" type="button" data-pp="' + action + '" title="' + label + '" aria-label="' + label + '">' + presenterIcon(name) + '</button>';
export const presenterPanelStyles = `
*{box-sizing:border-box}.pp-body{margin:0;background:#080809;color:#ece7e1;font-family:var(--sans,"Segoe UI",sans-serif);height:100dvh;overflow:hidden}
.pp-body,.pp-body *{cursor:auto;letter-spacing:0}.pp-body button{cursor:pointer}
.pp{display:grid;grid-template-columns:minmax(0,var(--pp-split,60%)) 10px minmax(0,1fr);gap:10px;height:100dvh;padding:18px}
.pp__main{display:flex;flex-direction:column;min-width:0;min-height:0;gap:12px;overflow:auto;container-type:inline-size}.pp__workspace{display:flex;flex:1;flex-direction:column;justify-content:center;min-width:0;gap:12px}.pp__main>.pp__save,.pp__side>.pp__hint{flex:none;margin:0;overflow-wrap:anywhere}
.pp__toolbar{display:grid;grid-template-columns:minmax(0,1fr) max-content minmax(0,1fr);align-items:end;gap:8px;min-width:0}.pp__meta,.pp__tools,.pp__livebar,.pp__media{display:flex;align-items:center;gap:8px;min-width:0}.pp__meta{justify-self:end}.pp__livebar{min-width:0}
.pp__btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;padding:0;color:inherit;background:rgba(255,255,255,.04);border:1px solid #ffffff24;border-radius:6px}
.pp__btn svg{width:17px;height:17px;display:block}.pp__btn:hover,.pp__btn:focus-visible{border-color:var(--accent,#d8a657);color:var(--accent,#d8a657)}.pp__btn:disabled{opacity:.4;cursor:default}
.pp__livestatus{font-size:11px;line-height:1.35;color:#b8b2aa;overflow-wrap:anywhere;max-width:32ch}.pp__livestatus[data-state=live]{color:#80d2a7}.pp__livestatus[data-state=disconnected],.pp__remaining[data-level=warn]{color:#e0b965}.pp__remaining[data-level=over]{color:#ff8f8f}
.pp__time{display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;font-family:var(--mono,monospace)}.pp__time span{font-size:25px;line-height:1.15;font-variant-numeric:tabular-nums}.pp__time em{font-style:normal;text-transform:uppercase;font-size:9px;line-height:1.3;color:#8a857e}
.pp__nowwrap{position:relative;width:100%;aspect-ratio:16/9;flex:none;overflow:hidden;background:#0a0a0c;border:1px solid #ffffff20;border-radius:8px}
.pp__current{flex:none;min-width:0;width:100%}.pp__slideprogress{display:block;appearance:none;width:100%;height:2px;margin:3px 0 0;padding:0;border:0;border-radius:0;background:#ffffff16;color:var(--accent,#d8a657)}.pp__slideprogress::-webkit-progress-bar{background:#ffffff16}.pp__slideprogress::-webkit-progress-value{background:currentColor}.pp__slideprogress::-moz-progress-bar{background:currentColor}.pp__slideprogress[data-level=over]{color:#ff8f8f}
.pp__now{position:absolute;inset:0}.pp__now,.pp__now *{cursor:inherit}.pp__now .slidepv__stage,.pp__next .slidepv__stage,.pp__thumb .slidepv__stage{position:absolute;top:0;left:0;transform-origin:top left}.pp .slidepv__stage .pjps--free{padding:0}
.pp__media[hidden]{display:none}.pp__media input{min-width:0;flex:1;accent-color:var(--accent,#d8a657)}
.pp__ctrls{display:flex;justify-content:center;align-items:center;gap:14px;padding:18px 0}.pp__ctrls>.pp__btn{width:40px;height:40px;border-radius:50%}.pp__position{display:grid;justify-items:center;gap:7px;min-width:120px}.pp__count{border:0;background:none;color:inherit;font:13px var(--sans,sans-serif);padding:4px}.pp__clock{color:#b8b2aa;font:11px var(--mono,monospace)}.pp__progress{height:3px;width:100%;max-width:110px;accent-color:var(--accent,#d8a657)}
.pp__divider{cursor:col-resize;border:0;border-left:1px solid #ffffff16;touch-action:none}.pp__divider:hover,.pp__divider:focus-visible{border-color:var(--accent,#d8a657)}
.pp__side{display:flex;flex-direction:column;min-width:0;min-height:0;gap:10px;overflow:hidden}.pp__tools{flex-wrap:wrap}.pp__lbl{font:10px var(--mono,monospace);text-transform:uppercase;color:var(--accent,#d8a657);margin-right:auto}
.pp__notes{flex:1;min-height:80px;resize:none;width:100%;border:0;background:transparent;color:inherit;font:var(--pp-notes-size,20px)/1.55 var(--sans,sans-serif);padding:6px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:4px}.pp__notes:focus{outline:1px solid #ffffff30}.pp__notes:empty::before{content:attr(data-placeholder);color:#6f6a64}.pp__notes p,.pp__notes div{margin:0 0 .4em}.pp__notes ul,.pp__notes ol{margin:.2em 0;padding-left:1.4em}.pp__notes blockquote{margin:.3em 0 .3em 1.5em}.pp__notesformat{display:flex;gap:4px}.pp__notesformat .pp__btn{width:28px;height:26px}
.pp__bottomcontrols{display:grid;grid-template-columns:112px minmax(0,1fr) 112px;align-items:center;gap:8px;min-width:0}.pp__budget{display:flex;align-items:center;gap:8px;min-width:0;color:#b8b2aa}.pp__budget>svg{width:18px;height:18px;flex:none}.pp__timefield{display:grid;grid-template-columns:minmax(0,1fr) 18px;width:86px;height:30px;border:1px solid #ffffff24;border-radius:4px;background:#ffffff08;overflow:hidden}.pp__timefield:focus-within{border-color:var(--accent,#d8a657)}.pp__timefield:has([aria-invalid=true]){border-color:#ff8f8f}.pp__timefield input{width:100%;min-width:0;margin:0;padding:0 0 0 6px;border:0;outline:none;background:transparent;color:inherit;font:11px var(--mono,monospace);font-variant-numeric:tabular-nums}.pp__timefield input:disabled{opacity:.4}.pp__timesteps{display:grid;grid-template-rows:1fr 1fr;min-height:0}.pp__timesteps .pp__btn{width:18px;height:14px;min-height:0;border:0;border-radius:0;background:transparent}.pp__timesteps .pp__btn svg{width:11px;height:11px}.pp__timesteps .pp__btn:hover:not(:disabled){background:#ffffff10}.pp__remaining{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.pp__save{font-size:11px;line-height:1.4;text-align:center;color:#b8b2aa;min-height:15px;min-width:0;overflow-wrap:anywhere}
.pp__noteszoom{display:flex;align-items:center;justify-self:end;border:1px solid #ffffff24;border-radius:4px;overflow:hidden}.pp__noteszoom>.pp__btn{width:30px;height:28px;border:0;border-radius:0;background:transparent}.pp__noteszoom>.pp__btn:hover:not(:disabled){background:#ffffff10}.pp__noteszoom>.pp__btn svg{width:13px;height:13px}.pp__noteszoom>.pp__speakericon{position:relative;width:28px}.pp__speakericon>svg:first-child{position:absolute;width:16px;height:16px;left:4px;top:4px}.pp__speakericon>svg:last-child{position:absolute;width:9px;height:9px;right:2px;bottom:3px;background:#080809}
.pp__budget>svg{cursor:ew-resize;touch-action:none}.pp__timefield input{touch-action:pan-y}.pp__timefield[data-scrubbing]{border-color:var(--accent,#d8a657)}.pp__timefield[data-scrubbing] input{cursor:ew-resize;user-select:none}
.pp__nextbox{display:grid;grid-template-columns:minmax(80px,40%) minmax(0,1fr);gap:8px 14px;align-items:center;border-top:1px solid #ffffff16;padding-top:10px}.pp__nextbox>.pp__lbl{grid-column:1/-1}.pp__next{position:relative;width:100%;aspect-ratio:16/9;border:1px solid #ffffff16;border-radius:6px;overflow:hidden;background:#0a0a0c}.pp__nexttitle{font-size:13px;color:#b8b2aa;overflow-wrap:anywhere}.pp__hint{font-size:11px;color:#8a857e;line-height:1.4}
.pp__notesarea{position:relative;display:flex;flex:1;min-height:100px;overflow:hidden}.pp__overview{position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;background:#080809;color:inherit;border:0;border-radius:0;padding:0}.pp__overview[open]{display:flex;flex-direction:column}.pp__overview header{display:flex;align-items:center;justify-content:space-between;flex:none;margin-bottom:10px}.pp__overview h2{font:13px var(--sans,sans-serif);margin:0}.pp__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));align-content:start;gap:10px;overflow:auto;min-height:0}.pp__slide{min-width:0;padding:6px;text-align:left;color:inherit;background:transparent;border:1px solid #ffffff24;border-radius:6px}.pp__slide[aria-current=true]{border-color:var(--accent,#d8a657)}.pp__jump{display:block;width:100%;padding:0;border:0;background:transparent;color:inherit}.pp__thumb{position:relative;aspect-ratio:16/9;overflow:hidden;pointer-events:none}.pp__thumb *{pointer-events:none}.pp__titleinput{display:block;width:100%;min-width:0;padding:6px 2px;border:0;border-bottom:1px solid transparent;border-radius:0;background:transparent;color:inherit;font:13px var(--sans,sans-serif)}.pp__titleinput:not(:read-only):hover,.pp__titleinput:focus{border-bottom-color:var(--accent,#d8a657);outline:0}.pp__nextheading{display:flex;align-items:center;grid-column:1/-1;gap:8px}.pp__nexttitle{width:100%}
.pp__synctools{display:flex;gap:6px;align-items:center;margin-left:auto}.pp__synctools[hidden],.pp__synctools [hidden]{display:none}.pp__tools{flex-wrap:wrap;gap:6px}.pp__choice{padding:6px 10px;min-height:32px;font:12px var(--sans,sans-serif);color:inherit;border:1px solid #ffffff30;border-radius:6px;background:transparent;cursor:pointer}.pp__choice:focus-visible{outline:2px solid var(--accent,#d8a657);outline-offset:2px}.pp__compare{overflow:auto;min-height:0;flex:1}.pp__compare pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 var(--sans,sans-serif);margin:6px 0 16px}.pp__compare label{font:11px var(--mono,monospace);color:#b8b2aa}.pp__conflictactions{display:flex;gap:8px;flex-wrap:wrap;padding-top:8px}
@container(max-width:480px){.pp__bottomcontrols{grid-template-columns:1fr 1fr}.pp__bottomcontrols>.pp__ctrls{grid-column:1/-1;grid-row:1}.pp__budget{grid-column:1;grid-row:2}.pp__noteszoom{grid-column:2;grid-row:2}}
@container(max-width:420px){.pp__toolbar{grid-template-columns:minmax(0,1fr) auto;row-gap:8px}.pp__time{grid-column:1/-1;grid-row:1;justify-self:center}.pp__livebar{grid-column:1;grid-row:2}.pp__meta{grid-column:2;grid-row:2;gap:6px}.pp__time span{font-size:20px}}
@media(max-width:700px){.pp{grid-template-columns:1fr;grid-template-rows:auto minmax(180px,1fr);padding:12px;gap:12px;overflow:auto}.pp__divider{display:none}.pp__main{overflow:visible}.pp__side{min-height:240px}.pp__notes{min-height:90px}.pp__ctrls{padding:3px 0}.pp__nextbox{grid-template-columns:100px minmax(0,1fr)}.pp__time span{font-size:20px}.pp__livestatus{max-width:20ch}}
`;
export function presenterPanelMarkup({ richNotes = false } = {}) {
  return '<div class="pp"><div class="pp__main"><div class="pp__workspace"><div class="pp__toolbar">' +
    '<div class="pp__livebar"><button class="pp__btn" data-pp-live title="Connect live preview" aria-label="Connect live preview">' + presenterIcon('connect') + '</button><span class="pp__livestatus" data-pp-status role="status">Pointer connected</span></div>' +
    '<div class="pp__time"><em data-pp-elapsed>elapsed</em><span data-pp-timer>0:00</span></div><div class="pp__meta">' + button('pause','Pause timer','timer-pause') + button('reset','Reset timer','timer-reset') + button('fullscreen','Fullscreen audience','fullscreen') + button('stop','End presentation','exit') + '</div></div>' +
    '<div class="pp__current"><div class="pp__nowwrap"><div class="pp__now" data-pp-now></div></div><progress class="pp__slideprogress" data-pp-slide-progress max="1" value="0" aria-label="Slide time progress"></progress></div>' +
    '<div class="pp__bottomcontrols"><div class="pp__budget" role="group" aria-label="Slide timing">' + presenterIcon('timer') + '<div class="pp__timefield"><input type="text" role="spinbutton" data-pp-minutes aria-label="Slide time budget" title="Slide time budget (MM:SS)" aria-valuemin="0" aria-valuemax="14400" aria-valuenow="0" aria-valuetext="00:00" value="00:00" autocomplete="off" spellcheck="false"><span class="pp__timesteps">' + button('up','Increase slide time','time-increase') + button('down','Decrease slide time','time-decrease') + '</span></div><output class="pp__remaining" data-pp-remaining></output></div>' +
    '<div class="pp__ctrls">' + button('prev','Previous slide','prev') + '<div class="pp__position"><button class="pp__count" data-pp="overview" data-pp-count title="Slide overview" aria-label="Slide overview"></button><progress class="pp__progress" data-pp-progress aria-label="Presentation progress"></progress><span class="pp__clock" data-pp-clock></span></div>' + button('next','Next slide','next') + '</div>' +
    '<div class="pp__noteszoom" role="group" aria-label="Speaker notes size">' + button('minus','Smaller notes','notes-smaller') + '<button class="pp__btn pp__speakericon" type="button" data-pp="notes-reset" title="Reset notes size (20 px)" aria-label="Reset notes size">' + presenterIcon('user') + presenterIcon('note') + '</button>' + button('plus','Larger notes','notes-larger') + '</div></div></div><div class="pp__save" data-pp-save role="status"></div></div>' +
    '<div class="pp__divider" data-pp-divider role="separator" aria-label="Resize presenter panes" aria-orientation="vertical" tabindex="0" aria-valuemin="40" aria-valuemax="75" aria-valuenow="60"></div><div class="pp__side">' +
    '<div class="pp__tools"><span class="pp__lbl">Speaker notes</span><div class="pp__synctools" data-pp-sync hidden><button type="button" class="pp__choice" data-pp="review-sync" hidden>Review conflict</button>' + button('reset','Sync private notes and names','metadata-sync') + '</div></div>' +
    (richNotes ? '<div class="pp__notesformat" role="toolbar" aria-label="Speaker notes formatting">' + button('bold','Bold','notes-bold') + button('italic','Italic','notes-italic') + button('list','Bulleted list','notes-insertUnorderedList') + button('outdent','Decrease indent','notes-outdent') + button('indent','Increase indent','notes-indent') + '</div>' : '') +
    '<div class="pp__notesarea">' + (richNotes ? '<div class="pp__notes" data-pp-notes role="textbox" aria-multiline="true" aria-label="Speaker notes" data-placeholder="Speaker notes"></div>' : '<textarea class="pp__notes" data-pp-notes aria-label="Speaker notes" placeholder="Speaker notes"></textarea>') +
    '<dialog class="pp__overview" aria-label="Slide overview" data-pp-overview><header><h2>Slides</h2>' + button('close','Close slide overview','overview-close') + '</header><div class="pp__grid" data-pp-grid></div></dialog>' +
    '<dialog class="pp__overview" aria-label="Private sync conflict" data-pp-conflict><header><h2 data-pp-conflict-title>Private sync conflict</h2>' + button('close','Close sync comparison','conflict-close') + '</header><div class="pp__compare"><label>On this device</label><pre data-pp-local></pre><label>In private cloud storage</label><pre data-pp-remote></pre></div><div class="pp__conflictactions"><button type="button" class="pp__choice" data-pp="keep-local">Keep local version</button><button type="button" class="pp__choice" data-pp="use-remote">Use cloud version</button></div></dialog></div>' +
    '<div class="pp__hint" data-pp-privacy>Share only the audience tab or window. Presenter notes are private content.</div><div class="pp__nextbox"><div class="pp__nextheading"><span class="pp__lbl">Next slide</span>' + button('slides','Show all slides','overview') + '</div><div class="pp__next" data-pp-next></div><input type="text" class="pp__nexttitle pp__titleinput" data-pp-nexttitle aria-label="Next slide name" maxlength="200"></div></div></div>';
}

export function installPresenterPanel({ doc, onCommand, onEdit, onJump, renderThumbnail, onResize = () => {}, onBusy = () => {}, onResolve = () => {}, storage }) {
  doc.title = 'Presenter DJ pad';
  if (!storage) try { storage = doc.defaultView.localStorage; } catch {}
  const root = doc.querySelector('.pp'), notes = doc.querySelector('[data-pp-notes]'), minutes = doc.querySelector('[data-pp-minutes]');
  const overview = doc.querySelector('[data-pp-overview]'), divider = doc.querySelector('[data-pp-divider]');
  let current = null, slides = [], split = 60, size = DEFAULT_NOTES_SIZE, drag = false, duration = 0, initialDuration = 0, editable = !!onEdit, overviewTrigger = null;
  const comparison = doc.querySelector('[data-pp-conflict]');
  let conflicts = [], compared = null;
  const busy = () => onBusy(comparison.open || !!doc.activeElement?.closest('[data-pp-notes],[data-pp-title],[data-pp-nexttitle],[data-pp-minutes]'));
  const focus = () => queueMicrotask(busy);
  doc.addEventListener('focusin', focus); doc.addEventListener('focusout', focus);
  function closeComparison() {
    comparison.close(); compared = null; notes.inert = overview.open;
    doc.querySelector('[data-pp="review-sync"]').focus(); busy();
  }
  comparison.addEventListener('cancel', event => { event.preventDefault(); closeComparison(); });
  comparison.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') closeComparison(); });
  const increase = doc.querySelector('[data-pp="time-increase"]'), decrease = doc.querySelector('[data-pp="time-decrease"]');
  const budgetControl = minutes.closest('.pp__budget');
  increase.title = 'Increase time by 10 seconds'; decrease.title = 'Decrease time by 10 seconds';
  try { split = Math.max(40, Math.min(75, Number(storage.getItem('rk:presenter:split')) || 60)); size = Math.max(14, Math.min(32, Number(storage.getItem('rk:presenter:notes-size')) || DEFAULT_NOTES_SIZE)); } catch {}
  function preferences(save = true) {
    root.style.setProperty('--pp-split', split + '%'); root.style.setProperty('--pp-notes-size', size + 'px');
    divider.setAttribute('aria-valuenow', String(Math.round(split)));
    doc.querySelector('[data-pp="notes-smaller"]').disabled = size <= 14; doc.querySelector('[data-pp="notes-larger"]').disabled = size >= 32;
    if (save) try { storage.setItem('rk:presenter:split', String(split)); storage.setItem('rk:presenter:notes-size', String(size)); } catch {}
    onResize();
  }
  preferences(false);
  const observer = new ResizeObserver(onResize); observer.observe(root);
  notes.readOnly = !onEdit; minutes.disabled = !onEdit;
  function edit(key, value) { if (current !== null && editable && onEdit) onEdit(current, key, value); }
  const rich = notes.tagName === 'DIV' ? installRichNotes(notes, { disabled: !onEdit, onChange: value => edit('notes', value) }) : null;
  if (!rich) notes.addEventListener('input', () => edit('notes', notes.value));
  const preserveSelection = event => { if (event.target.closest('.pp__notesformat,.pp__timesteps')) event.preventDefault(); };
  doc.addEventListener('pointerdown', preserveSelection);
  doc.querySelectorAll('.pp__notesformat button').forEach(button => { button.disabled = !onEdit; });
  function renderTiming(formatInput = true) {
    if (formatInput) minutes.value = formatSlideDuration(scrub.preview ?? duration);
    const parsed = parseSlideDuration(minutes.value);
    minutes.setAttribute('aria-valuenow', String(Math.round((parsed ?? duration) * 60)));
    minutes.setAttribute('aria-valuetext', formatSlideDuration(parsed ?? duration));
    if (parsed === null) minutes.setAttribute('aria-invalid', 'true'); else minutes.removeAttribute('aria-invalid');
    minutes.title = parsed === null ? 'Enter a time from 00:00 to 240:00' : 'Slide time budget (MM:SS). Drag to adjust by 10 seconds.';
    increase.disabled = minutes.disabled || (parsed ?? duration) >= 240;
    decrease.disabled = minutes.disabled || (parsed ?? duration) <= 0;
  }
  function inputTiming() {
    const parsed = parseSlideDuration(minutes.value);
    if (parsed !== null) { duration = parsed; edit('durationMinutes', duration); }
    renderTiming(false);
  }
  function stepTiming(seconds) {
    if (minutes.disabled) return;
    scrub.cancel();
    duration = Math.max(0, Math.min(14400, Math.round((parseSlideDuration(minutes.value) ?? duration) * 60) + seconds)) / 60;
    renderTiming(); edit('durationMinutes', duration); minutes.focus();
  }
  function focusTiming() { initialDuration = duration; }
  function blurTiming() { scrub.cancel(); renderTiming(); }
  function keyTiming(event) {
    const steps = { ArrowUp:SLIDE_TIME_STEP_SECONDS, ArrowDown:-SLIDE_TIME_STEP_SECONDS, PageUp:SLIDE_TIME_STEP_SECONDS, PageDown:-SLIDE_TIME_STEP_SECONDS };
    if (Object.hasOwn(steps, event.key)) { event.preventDefault(); event.stopPropagation(); stepTiming(steps[event.key]); }
    else if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { duration = initialDuration; edit('durationMinutes', duration); }
      renderTiming();
    }
  }
  minutes.addEventListener('input', inputTiming); minutes.addEventListener('focus', focusTiming); minutes.addEventListener('blur', blurTiming); minutes.addEventListener('keydown', keyTiming);
  const scrub = installSlideTimeScrub(minutes, {
    handle: budgetControl,
    getValue: () => parseSlideDuration(minutes.value) ?? duration,
    onPreview: value => { if (value !== null) minutes.value = formatSlideDuration(value); renderTiming(value === null); },
    onCommit: value => { duration = value; renderTiming(); edit('durationMinutes', duration); }
  });
  renderTiming();
  divider.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = true; divider.setPointerCapture(event.pointerId); event.preventDefault(); });
  divider.addEventListener('pointermove', event => { if (!drag) return; const rect = root.getBoundingClientRect(); split = Math.max(40, Math.min(75, (event.clientX - rect.left) / rect.width * 100)); preferences(); });
  divider.addEventListener('pointerup', () => { drag = false; }); divider.addEventListener('pointercancel', () => { drag = false; }); divider.addEventListener('lostpointercapture', () => { drag = false; });
  divider.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); split = event.key === 'Home' ? 60 : Math.max(40, Math.min(75, split + (event.key === 'ArrowLeft' ? -2 : 2))); preferences(); });
  function closeOverview() { overview.close(); notes.inert = false; overviewTrigger?.focus(); onResize(); }
  const nextTitle = doc.querySelector('[data-pp-nexttitle]');
  function refreshTitles() {
    if (doc.activeElement !== nextTitle) nextTitle.value = slides[current+1]?.title || 'End of deck';
    nextTitle.readOnly = !editable || !slides[current+1]; nextTitle.title = nextTitle.value;
    const grid = doc.querySelector('[data-pp-grid]');
    if (grid.childElementCount !== slides.length) {
      grid.replaceChildren();
      slides.forEach((slide,index) => {
        const item = doc.createElement('div'); item.className = 'pp__slide';
        const jump = doc.createElement('button'); jump.type = 'button'; jump.className = 'pp__jump'; jump.dataset.ppJump = index;
        const thumb = doc.createElement('div'); thumb.className = 'pp__thumb'; jump.append(thumb);
        const title = doc.createElement('input'); title.type = 'text'; title.className = 'pp__titleinput'; title.dataset.ppTitle = index; title.maxLength = 200; title.setAttribute('aria-label','Slide '+(index+1)+' name');
        item.append(jump,title); grid.append(item);
      });
    }
    Array.from(grid.children).forEach((item,index) => {
      item.setAttribute('aria-current',String(index===current));
      item.querySelector('button').setAttribute('aria-label','Go to slide '+(index+1)+': '+slides[index].title);
      const title = item.querySelector('input'); if (doc.activeElement !== title) title.value = slides[index].title; title.readOnly = !editable; title.title = title.value;
    });
  }
  function rename(event) {
    const input = event.target.closest('[data-pp-title],[data-pp-nexttitle]');
    if (!input || !editable || input.readOnly) return;
    const index = input === nextTitle ? current+1 : Number(input.dataset.ppTitle), value = input.value.trim();
    if (!value || value.length > 200) { input.value = slides[index]?.title || ''; return; }
    onEdit(index,'title',value);
  }
  function titleKey(event) {
    if (!event.target.matches('[data-pp-title],[data-pp-nexttitle]')) return;
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); const index = event.target === nextTitle ? current+1 : Number(event.target.dataset.ppTitle); event.target.value = slides[index]?.title || ''; event.target.blur(); }
  }
  doc.addEventListener('change',rename); doc.addEventListener('keydown',titleKey);
  overview.addEventListener('cancel', event => { event.preventDefault(); closeOverview(); });
  overview.addEventListener('keydown', event => { titleKey(event); event.stopPropagation(); if (event.key === 'Escape' && !event.target.matches('input')) closeOverview(); });
  overview.addEventListener('click', event => { if (event.target === overview) closeOverview(); });
  const click = event => {
    const target = event.target.closest('[data-pp],[data-pp-jump]'); if (!target) return;
    if (target.hasAttribute('data-pp-jump')) { onJump(Number(target.dataset.ppJump)); closeOverview(); return; }
    const command = target.dataset.pp;
    if (['notes-bold','notes-italic','notes-insertUnorderedList','notes-outdent','notes-indent'].includes(command)) rich?.command(command.slice(6));
    else if (command === 'time-increase' || command === 'time-decrease') stepTiming(command === 'time-increase' ? SLIDE_TIME_STEP_SECONDS : -SLIDE_TIME_STEP_SECONDS);
    else if (command === 'notes-smaller' || command === 'notes-larger') { size = Math.max(14, Math.min(32, size + (command === 'notes-smaller' ? -2 : 2))); preferences(); }
    else if (command === 'notes-reset') { size = DEFAULT_NOTES_SIZE; preferences(); }
    else if (command === 'conflict-close') closeComparison();
    else if (command === 'review-sync' && conflicts.length) {
      closeOverview(); compared = structuredClone(conflicts[0]); notes.inert = true;
      doc.querySelector('[data-pp-conflict-title]').textContent = compared.key === 'notes' ? 'Speaker notes conflict' : compared.key === 'title' ? 'Slide name conflict' : 'Slide timing conflict';
      doc.querySelector('[data-pp-local]').textContent = notesText(String(compared.local), doc);
      doc.querySelector('[data-pp-remote]').textContent = notesText(String(compared.remote), doc);
      comparison.show(); comparison.querySelector('button').focus(); busy();
    }
    else if ((command === 'keep-local' || command === 'use-remote') && compared) {
      onResolve({ ...compared, choice: command === 'keep-local' ? 'local' : 'remote' }); closeComparison();
    }
    else if (command === 'overview-close') closeOverview();
    else if (command === 'overview') {
      const grid = doc.querySelector('[data-pp-grid]');
      overviewTrigger = target; refreshTitles(); notes.inert = true; overview.show(); onResize();
      if (renderThumbnail) Array.from(grid.children).forEach((item,index) => renderThumbnail(item.querySelector('.pp__thumb'),index));
      grid.querySelector('[aria-current=true] button')?.focus();
    } else onCommand(command);
  };
  doc.addEventListener('click', click);
  return {
    restorePreferences(values) {
      split = Math.max(40, Math.min(75, Number(values['rk:presenter:split']) || 60));
      size = Math.max(14, Math.min(32, Number(values['rk:presenter:notes-size']) || DEFAULT_NOTES_SIZE));
      preferences(false);
    },
    update(state) {
      const changed = current !== state.index;
      if (changed || state.editable === false) scrub.cancel();
      current = state.index; slides = state.slides;
      editable = !!onEdit && state.editable !== false; notes.readOnly = !editable;
      conflicts = state.conflicts || [];
      doc.querySelector('[data-pp-sync]').hidden = !state.syncEnabled || !editable;
      doc.querySelector('[data-pp="review-sync"]').hidden = !conflicts.length;
      doc.querySelector('[data-pp="metadata-sync"]').disabled = !!state.syncBusy;
      if (state.saveStatus) doc.querySelector('[data-pp-save]').textContent = state.saveStatus;
      if (rich) notes.contentEditable = String(editable);
      doc.querySelectorAll('.pp__notesformat button').forEach(button=>{button.disabled=!editable;});
      refreshTitles();
      if (changed || !notes.contains(doc.activeElement)) { if (rich) rich.set(state.notes || ''); else { notes.textContent = notesText(state.notes || '', doc); notes.value = notesText(state.notes || '', doc); } if (changed) notes.scrollTop = 0; }
      minutes.disabled = !onEdit || state.editable === false;
      duration = Math.max(0, Math.min(240, Number(state.durationMinutes) || 0));
      renderTiming(changed || doc.activeElement !== minutes);
      if (changed) initialDuration = duration;
      doc.querySelector('[data-pp-count]').textContent = (state.index + 1) + ' / ' + slides.length;
      const progress = doc.querySelector('[data-pp-progress]'); progress.max = slides.length; progress.value = state.index + 1;
      doc.querySelector('[data-pp="prev"]').disabled = state.index === 0; doc.querySelector('[data-pp="next"]').disabled = state.index === slides.length - 1;
    },
    tick({ elapsed, paused, remaining, budget, totalBudget, format }) {
      if (scrub.preview !== null) { const difference = scrub.preview * 60000 - budget; remaining += difference; budget += difference; totalBudget += difference; }
      doc.querySelector('[data-pp-timer]').textContent = format(elapsed);
      doc.querySelector('[data-pp-elapsed]').textContent = paused ? 'paused' : 'elapsed';
      const pause = doc.querySelector('[data-pp="timer-pause"]'); pause.innerHTML = presenterIcon(paused ? 'play' : 'pause'); pause.title = paused ? 'Resume timer' : 'Pause timer'; pause.setAttribute('aria-label', pause.title); pause.setAttribute('aria-pressed', String(paused));
      doc.querySelector('[data-pp-clock]').textContent = new Date().toLocaleTimeString([], { hour:'2-digit',minute:'2-digit' });
      const output = doc.querySelector('[data-pp-remaining]'); output.textContent = budget ? format(Math.abs(remaining)) + (remaining < 0 ? ' over' : ' left') : '';
      output.dataset.level = remaining < 0 ? 'over' : remaining <= budget * .2 ? 'warn' : '';
      const slideProgress = doc.querySelector('[data-pp-slide-progress]');
      slideProgress.max = budget || 1; slideProgress.value = budget ? Math.max(0, Math.min(budget, budget - remaining)) : 0;
      slideProgress.dataset.level = budget ? output.dataset.level : '';
      slideProgress.title = budget ? output.textContent : 'No slide time budget';
      slideProgress.setAttribute('aria-valuetext', slideProgress.title);
      doc.querySelector('[data-pp-timer]').title = totalBudget ? 'Deck budget: ' + format(totalBudget) : 'Elapsed presentation time';
    },
    saved(message) { doc.querySelector('[data-pp-save]').textContent = message; },
    dispose() {
      scrub.dispose(); observer.disconnect(); rich?.dispose();
      minutes.removeEventListener('input', inputTiming); minutes.removeEventListener('focus', focusTiming); minutes.removeEventListener('blur', blurTiming); minutes.removeEventListener('keydown', keyTiming);
      doc.removeEventListener('pointerdown', preserveSelection); doc.removeEventListener('click', click);
      doc.removeEventListener('change',rename); doc.removeEventListener('keydown',titleKey);
      doc.removeEventListener('focusin',focus); doc.removeEventListener('focusout',focus);
    }
  };
}