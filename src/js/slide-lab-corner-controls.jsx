import React, { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { cornerSettings, cornerUpdate, selectedRectangles } from "./slide-lab-corners.mjs";

function CornerIcon({ mode }) {
  const sharp = mode === "sharp";
  const path = sharp ? "M3.33334 9.99998V6.66665C3.33334 6.04326 3.33403 4.9332 3.33539 3.33646C4.95233 3.33436 6.06276 3.33331 6.66668 3.33331H10"
    : mode === "round" ? "M4 12v-4a4 4 0 0 1 4 -4h4" : "M4 12C4 5 5 4 12 4";
  const dots = sharp ? [[13.3333,3.33331],[16.6667,3.33331],[16.6667,6.66669],[16.6667,10],[3.33334,13.3333],[16.6667,13.3333],[3.33334,16.6667],[6.66666,16.6667],[10,16.6667],[13.3333,16.6667],[16.6667,16.6667]]
    : [[16,4],[20,4],[20,8],[20,12],[4,16],[20,16],[4,20],[8,20],[12,20],[16,20],[20,20]];
  return <svg width="20" height="20" viewBox={sharp ? "0 0 20 20" : "0 0 24 24"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} />{dots.map(([left, top], index) => <path key={index} d={`M${left} ${top}v.01`} />)}</svg>;
}

export function CornerControls({ api, host, disabled }) {
  const [selection, setSelection] = useState("[]");
  const [slot, setSlot] = useState(null);
  const [value, setValue] = useState("0");
  const drag = useRef(null);
  const selected = JSON.parse(selection);
  const active = selected[0];
  const mixed = selected.some(item => item.radius !== active?.radius);
  const limit = selected.length ? Math.min(...selected.map(item => item.limit)) : 0;

  useEffect(() => {
    if (!api) return;
    const sync = (elements, state) => {
      const next = JSON.stringify(selectedRectangles(elements, state.selectedElementIds).map(element => ({ id: element.id, ...cornerSettings(element) })));
      setSelection(previous => previous === next ? previous : next);
    };
    sync(api.getSceneElements(), api.getAppState());
    return api.onChange(sync);
  }, [api]);
  useEffect(() => { setValue(mixed ? "" : String(active?.radius ?? 0)); }, [selection]);
  useEffect(() => {
    if (!api || !selected.length) return;
    const mount = document.createElement("div");
    mount.className = "lab-corner-slot";
    let native;
    const place = () => {
      const panel = host.current.querySelector(".selected-shape-actions .panelColumn, .App-mobile-menu .panelColumn");
      const next = panel && [...panel.querySelectorAll(":scope > fieldset")].find(field => field.querySelector("legend")?.textContent === "Edges");
      if (native !== next) { native?.removeAttribute("data-lab-corners"); native = next; }
      if (!native) { mount.remove(); setSlot(null); return; }
      native.setAttribute("data-lab-corners", "");
      if (mount.parentNode !== panel || mount.nextSibling !== native) panel.insertBefore(mount, native);
      setSlot(mount);
    };
    const observer = new MutationObserver(place);
    observer.observe(host.current, { childList: true, subtree: true });
    place();
    return () => { observer.disconnect(); native?.removeAttribute("data-lab-corners"); mount.remove(); };
  }, [api, selected.length > 0]);

  function apply(mode, radius, captureUpdate = CaptureUpdateAction.IMMEDIATELY) {
    const elements = api.getSceneElementsIncludingDeleted();
    const ids = drag.current?.ids || selectedRectangles(elements, api.getAppState().selectedElementIds).map(element => element.id);
    api.updateScene({ elements: cornerUpdate(elements, ids, mode, radius), captureUpdate });
  }
  function commit() {
    if (value.trim() && Number.isFinite(Number(value))) {
      if (mixed || Number(value) !== active.radius) apply(null, Number(value));
    }
    else setValue(mixed ? "" : String(active?.radius ?? 0));
  }
  function begin(event) {
    if (event.button !== 0 || disabled) return;
    event.preventDefault(); event.stopPropagation();
    api.updateScene({ captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    drag.current = { x: event.clientX, radius: active.radius, ids: selected.map(item => item.id), before: api.getSceneElementsIncludingDeleted(), moved: false, last: active.radius };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    const state = drag.current;
    if (!state || (!state.moved && Math.abs(event.clientX - state.x) < 4)) return;
    event.preventDefault();
    state.moved = true;
    state.last = Math.min(limit, Math.max(0, Math.round(state.radius + (event.clientX - state.x) * (event.shiftKey ? 10 : 1))));
    apply(null, state.last, CaptureUpdateAction.NEVER);
  }
  function finish(event, cancel = false) {
    const state = drag.current;
    if (!state) return;
    event.stopPropagation();
    if (state.moved) {
      flushSync(() => api.updateScene({ elements: state.before, captureUpdate: CaptureUpdateAction.NEVER }));
      if (!cancel) apply(null, state.last);
    } else if (!cancel) { event.currentTarget.focus(); event.currentTarget.select(); }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (!slot || !active || disabled) return null;
  return createPortal(<fieldset className="lab-corners" aria-label="Object edges">
    <legend>Edges</legend>
    <div className="lab-corner-modes" role="group" aria-label="Corner style">
      {["sharp", "round", "squircle"].map(mode => <button key={mode} type="button" title={mode === "squircle" ? "Squircle (continuous corners)" : mode === "round" ? "Round corners" : "Sharp corners"} aria-label={`${mode[0].toUpperCase()}${mode.slice(1)} corners`} aria-pressed={selected.every(item => item.mode === mode)} onClick={() => apply(mode)}><CornerIcon mode={mode} /></button>)}
    </div>
    <div className="lab-radius">
      <input aria-label="Corner radius" role="spinbutton" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={mixed ? undefined : active.radius} aria-valuetext={mixed ? "Mixed" : `${active.radius} pixels`} inputMode="decimal" value={value} placeholder="Mixed" title="Corner radius: drag left or right to adjust" onChange={event => setValue(event.target.value)} onBlur={commit}
        onPointerDown={begin} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
        onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); apply(null, active.radius + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)); } }} />
      <div className="lab-radius-steps">{[1, -1].map(step => <button key={step} type="button" title={step > 0 ? "Increase radius" : "Decrease radius"} aria-label={step > 0 ? "Increase radius" : "Decrease radius"} disabled={step > 0 ? active.radius >= limit : active.radius <= 0} onMouseDown={event => event.preventDefault()} onClick={() => apply(null, active.radius + step)}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d={step > 0 ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg></button>)}</div>
    </div>
  </fieldset>, slot);
}