const paths = {
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
.pp__main{display:flex;flex-direction:column;justify-content:center;min-width:0;min-height:0;gap:12px;overflow:auto}
.pp__toolbar,.pp__meta,.pp__tools,.pp__livebar,.pp__media{display:flex;align-items:center;gap:8px;min-width:0}.pp__toolbar{flex-wrap:wrap}.pp__meta{margin-left:auto}.pp__livebar{flex:1;min-width:40px}
.pp__btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;padding:0;color:inherit;background:rgba(255,255,255,.04);border:1px solid #ffffff24;border-radius:6px}
.pp__btn svg{width:17px;height:17px;display:block}.pp__btn:hover,.pp__btn:focus-visible{border-color:var(--accent,#d8a657);color:var(--accent,#d8a657)}.pp__btn:disabled{opacity:.4;cursor:default}
.pp__livestatus{font-size:11px;line-height:1.35;color:#b8b2aa;overflow-wrap:anywhere;max-width:32ch}.pp__livestatus[data-state=live]{color:#80d2a7}.pp__livestatus[data-state=disconnected],.pp__remaining[data-level=warn]{color:#e0b965}.pp__remaining[data-level=over]{color:#ff8f8f}
.pp__time{display:flex;align-items:baseline;gap:6px;font-family:var(--mono,monospace)}.pp__time span{font-size:25px;font-variant-numeric:tabular-nums}.pp__time em{font-style:normal;text-transform:uppercase;font-size:9px;color:#8a857e}
.pp__nowwrap{position:relative;width:100%;aspect-ratio:16/9;flex:none;overflow:hidden;background:#0a0a0c;border:1px solid #ffffff20;border-radius:8px}
.pp__now{position:absolute;inset:0}.pp__now,.pp__now *{cursor:inherit}.pp__now .slidepv__stage,.pp__next .slidepv__stage,.pp__thumb .slidepv__stage{position:absolute;top:0;left:0;transform-origin:top left}.pp .slidepv__stage .pjps--free{padding:0}
.pp__media[hidden]{display:none}.pp__media input{min-width:0;flex:1;accent-color:var(--accent,#d8a657)}
.pp__ctrls{display:flex;justify-content:center;align-items:center;gap:14px;padding:18px 0}.pp__ctrls>.pp__btn{width:40px;height:40px;border-radius:50%}.pp__position{display:grid;justify-items:center;gap:7px;min-width:120px}.pp__count{border:0;background:none;color:inherit;font:13px var(--sans,sans-serif);padding:4px}.pp__clock{color:#b8b2aa;font:11px var(--mono,monospace)}.pp__progress{height:3px;width:100%;max-width:110px;accent-color:var(--accent,#d8a657)}
.pp__divider{cursor:col-resize;border:0;border-left:1px solid #ffffff16;touch-action:none}.pp__divider:hover,.pp__divider:focus-visible{border-color:var(--accent,#d8a657)}
.pp__side{display:flex;flex-direction:column;min-width:0;min-height:0;gap:10px;overflow:hidden}.pp__tools{flex-wrap:wrap}.pp__lbl{font:10px var(--mono,monospace);text-transform:uppercase;color:var(--accent,#d8a657);margin-right:auto}
.pp__notes{flex:1;min-height:80px;resize:none;width:100%;border:0;background:transparent;color:inherit;font:var(--pp-notes-size,20px)/1.55 var(--sans,sans-serif);padding:6px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:4px}.pp__notes:focus{outline:1px solid #ffffff30}
.pp__budget{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;color:#b8b2aa}.pp__budget input{width:68px;background:#ffffff08;color:inherit;border:1px solid #ffffff24;border-radius:4px;padding:6px;font:inherit}.pp__remaining{font:12px var(--mono,monospace);margin-left:auto}.pp__save{font-size:11px;color:#b8b2aa;min-height:15px}
.pp__nextbox{display:grid;grid-template-columns:minmax(80px,40%) minmax(0,1fr);gap:8px 14px;align-items:center;border-top:1px solid #ffffff16;padding-top:10px}.pp__nextbox>.pp__lbl{grid-column:1/-1}.pp__next{position:relative;width:100%;aspect-ratio:16/9;border:1px solid #ffffff16;border-radius:6px;overflow:hidden;background:#0a0a0c}.pp__nexttitle{font-size:13px;color:#b8b2aa;overflow-wrap:anywhere}.pp__hint{font-size:11px;color:#8a857e;line-height:1.4}
.pp__overview{width:min(900px,94vw);max-height:88dvh;background:#141417;color:#ece7e1;border:1px solid #ffffff30;border-radius:8px;padding:18px}.pp__overview::backdrop{background:#0009}.pp__overview header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.pp__overview h2{font-size:18px;margin:0}.pp__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;overflow:auto;max-height:65dvh}.pp__slide{min-width:0;padding:6px;text-align:left;color:inherit;background:transparent;border:1px solid #ffffff24;border-radius:6px}.pp__slide[aria-current=true]{border-color:var(--accent,#d8a657)}.pp__slide span{display:block;font-size:12px;margin-top:6px;overflow-wrap:anywhere}.pp__thumb{position:relative;aspect-ratio:16/9;overflow:hidden;pointer-events:none}.pp__thumb *{pointer-events:none}
@media(max-width:700px){.pp{grid-template-columns:1fr;grid-template-rows:auto minmax(180px,1fr);padding:12px;gap:12px;overflow:auto}.pp__divider{display:none}.pp__main{overflow:visible}.pp__side{min-height:240px}.pp__notes{min-height:90px}.pp__ctrls{padding:3px 0}.pp__nextbox{grid-template-columns:100px minmax(0,1fr)}.pp__time span{font-size:20px}.pp__livestatus{max-width:20ch}}
`;
export function presenterPanelMarkup() {
  return '<div class="pp"><div class="pp__main"><div class="pp__toolbar">' +
    '<div class="pp__livebar"><button class="pp__btn" data-pp-live title="Connect live preview" aria-label="Connect live preview">' + presenterIcon('connect') + '</button><span class="pp__livestatus" data-pp-status role="status">Pointer connected</span></div>' +
    '<div class="pp__meta"><div class="pp__time"><span data-pp-timer>0:00</span><em data-pp-elapsed>elapsed</em></div>' + button('pause','Pause timer','timer-pause') + button('reset','Reset timer','timer-reset') + button('fullscreen','Fullscreen audience','fullscreen') + button('stop','End presentation','exit') + '</div></div>' +
    '<div class="pp__nowwrap"><div class="pp__now" data-pp-now></div></div>' +
    '<div class="pp__ctrls">' + button('prev','Previous slide','prev') + '<div class="pp__position"><button class="pp__count" data-pp="overview" data-pp-count title="Slide overview" aria-label="Slide overview"></button><progress class="pp__progress" data-pp-progress aria-label="Presentation progress"></progress><span class="pp__clock" data-pp-clock></span></div>' + button('next','Next slide','next') + '</div></div>' +
    '<div class="pp__divider" data-pp-divider role="separator" aria-label="Resize presenter panes" aria-orientation="vertical" tabindex="0" aria-valuemin="40" aria-valuemax="75" aria-valuenow="60"></div><div class="pp__side">' +
    '<div class="pp__tools"><span class="pp__lbl">Speaker notes</span>' + button('minus','Smaller notes','notes-smaller') + button('plus','Larger notes','notes-larger') + '</div>' +
    '<textarea class="pp__notes" data-pp-notes aria-label="Speaker notes" placeholder="Speaker notes"></textarea>' +
    '<div class="pp__budget"><label>Slide minutes <input type="number" min="0" max="240" step="0.5" data-pp-minutes aria-label="Slide time budget in minutes"></label><output class="pp__remaining" data-pp-remaining></output></div><div class="pp__save" data-pp-save role="status"></div>' +
    '<div class="pp__nextbox"><div class="pp__lbl">Next slide</div><div class="pp__next" data-pp-next></div><div class="pp__nexttitle" data-pp-nexttitle></div></div><div class="pp__hint" data-pp-privacy>Share only the audience tab or window. Presenter notes are private content.</div></div></div>' +
    '<dialog class="pp__overview" aria-label="Slide overview" data-pp-overview><header><h2>Slides</h2>' + button('close','Close slide overview','overview-close') + '</header><div class="pp__grid" data-pp-grid></div></dialog>';
}

export function installPresenterPanel({ doc, onCommand, onEdit, onJump, renderThumbnail, onResize = () => {}, storage }) {
  if (!storage) try { storage = doc.defaultView.localStorage; } catch {}
  const root = doc.querySelector('.pp'), notes = doc.querySelector('[data-pp-notes]'), minutes = doc.querySelector('[data-pp-minutes]');
  const overview = doc.querySelector('[data-pp-overview]'), divider = doc.querySelector('[data-pp-divider]');
  let current = null, slides = [], split = 60, size = 20, drag = false;
  try { split = Math.max(40, Math.min(75, Number(storage.getItem('rk:presenter:split')) || 60)); size = Math.max(14, Math.min(32, Number(storage.getItem('rk:presenter:notes-size')) || 20)); } catch {}
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
  function edit(key, value) { if (current !== null && onEdit) onEdit(current, key, value); }
  notes.addEventListener('input', () => edit('notes', notes.value));
  minutes.addEventListener('input', () => { if (minutes.validity.valid) edit('durationMinutes', Number(minutes.value) || 0); });
  divider.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = true; divider.setPointerCapture(event.pointerId); event.preventDefault(); });
  divider.addEventListener('pointermove', event => { if (!drag) return; const rect = root.getBoundingClientRect(); split = Math.max(40, Math.min(75, (event.clientX - rect.left) / rect.width * 100)); preferences(); });
  divider.addEventListener('pointerup', () => { drag = false; }); divider.addEventListener('pointercancel', () => { drag = false; }); divider.addEventListener('lostpointercapture', () => { drag = false; });
  divider.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); split = event.key === 'Home' ? 60 : Math.max(40, Math.min(75, split + (event.key === 'ArrowLeft' ? -2 : 2))); preferences(); });
  function closeOverview() { overview.close(); doc.querySelector('[data-pp-count]').focus(); }
  overview.addEventListener('cancel', event => { event.preventDefault(); closeOverview(); });
  overview.addEventListener('keydown', event => event.stopPropagation());
  overview.addEventListener('click', event => { if (event.target === overview) closeOverview(); });
  const click = event => {
    const target = event.target.closest('[data-pp],[data-pp-jump]'); if (!target) return;
    if (target.hasAttribute('data-pp-jump')) { onJump(Number(target.dataset.ppJump)); closeOverview(); return; }
    const command = target.dataset.pp;
    if (command === 'notes-smaller' || command === 'notes-larger') { size = Math.max(14, Math.min(32, size + (command === 'notes-smaller' ? -2 : 2))); preferences(); }
    else if (command === 'overview-close') closeOverview();
    else if (command === 'overview') {
      const grid = doc.querySelector('[data-pp-grid]');
      if (!grid.childElementCount) slides.forEach((slide, index) => {
        const item = doc.createElement('button'); item.className = 'pp__slide'; item.dataset.ppJump = index;
        const thumb = doc.createElement('div'); thumb.className = 'pp__thumb'; item.appendChild(thumb);
        const title = doc.createElement('span'); title.textContent = (index + 1) + '. ' + slide.title; item.appendChild(title); grid.appendChild(item);
      });
      Array.from(grid.children).forEach((item, index) => item.setAttribute('aria-current', String(index === current)));
      overview.showModal();
      if (renderThumbnail) Array.from(grid.children).forEach((item,index) => renderThumbnail(item.querySelector('.pp__thumb'),index));
      grid.querySelector('[aria-current=true]')?.focus();
    } else onCommand(command);
  };
  doc.addEventListener('click', click);
  return {
    restorePreferences(values) {
      split = Math.max(40, Math.min(75, Number(values['rk:presenter:split']) || 60));
      size = Math.max(14, Math.min(32, Number(values['rk:presenter:notes-size']) || 20));
      preferences(false);
    },
    update(state) {
      const changed = current !== state.index; current = state.index; slides = state.slides;
      if (changed || doc.activeElement !== notes) { notes.textContent = state.notes || ''; notes.value = state.notes || ''; if (changed) notes.scrollTop = 0; }
      if (changed || doc.activeElement !== minutes) minutes.value = state.durationMinutes || '';
      doc.querySelector('[data-pp-count]').textContent = (state.index + 1) + ' / ' + slides.length;
      const progress = doc.querySelector('[data-pp-progress]'); progress.max = slides.length; progress.value = state.index + 1;
      doc.querySelector('[data-pp="prev"]').disabled = state.index === 0; doc.querySelector('[data-pp="next"]').disabled = state.index === slides.length - 1;
    },
    tick({ elapsed, paused, remaining, budget, totalBudget, format }) {
      doc.querySelector('[data-pp-timer]').textContent = format(elapsed);
      doc.querySelector('[data-pp-elapsed]').textContent = paused ? 'paused' : 'elapsed';
      const pause = doc.querySelector('[data-pp="timer-pause"]'); pause.innerHTML = presenterIcon(paused ? 'play' : 'pause'); pause.title = paused ? 'Resume timer' : 'Pause timer'; pause.setAttribute('aria-label', pause.title); pause.setAttribute('aria-pressed', String(paused));
      doc.querySelector('[data-pp-clock]').textContent = new Date().toLocaleTimeString([], { hour:'2-digit',minute:'2-digit' });
      const output = doc.querySelector('[data-pp-remaining]'); output.textContent = budget ? format(Math.abs(remaining)) + (remaining < 0 ? ' over' : ' left') : '';
      output.dataset.level = remaining < 0 ? 'over' : remaining <= budget * .2 ? 'warn' : '';
      doc.querySelector('[data-pp-timer]').title = totalBudget ? 'Deck budget: ' + format(totalBudget) : 'Elapsed presentation time';
    },
    saved(message) { doc.querySelector('[data-pp-save]').textContent = message; },
    dispose() { observer.disconnect(); doc.removeEventListener('click', click); }
  };
}