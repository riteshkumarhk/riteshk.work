import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLabActionManager } from "@excalidraw/excalidraw";
import { ArrowDown, ArrowUp, Copy, Pencil, PencilOff, Presentation, Trash2 } from "lucide-react";
import { DeckDialog } from "./slide-merge-navigator.jsx";
import { SelectControl } from "./slide-shared-controls.jsx";
import { ACTIVITY_CAPABILITIES, activityChanges, activitySnapshot, activityText } from "./slide-merge-activity.mjs";
import "../../css/slide-merge-bar.css";

export function HistoryControls({ target, disabled, activity }) {
  const manager = useLabActionManager();
  return target ? createPortal(<fieldset disabled={disabled} className="merge-history-buttons" onClickCapture={event => { const button = event.target.closest("button"); if (button && !button.matches(":disabled")) { activity.flush(); activity.note(button.getAttribute("aria-label")); } }}>{["undo", "redo"].map(action => <span className="merge-history-action" key={action}>{manager.renderAction(action)}<svg className="merge-history-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{action === "undo" ? <><polyline points="9 14 4 9 9 4" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></> : <><polyline points="15 14 20 9 15 4" /><path d="M20 9H9a5 5 0 0 0 0 10h1" /></>}</svg></span>)}</fieldset>, target) : null;
}

export function useActivity(api, live) {
  const [recording, setRecording] = useState(false), [showLog, setShowLog] = useState(false), [message, setMessage] = useState("");
  const [events, setEvents] = useState(() => { try { return JSON.parse(localStorage.getItem("rk:slide-merge:log") || "[]"); } catch { return []; } });
  const state = useRef({ recording: false, events: [], baseline: [], slide: null, timer: null, pending: new Set() });
  function write(kind, detail) {
    if (!state.current.recording) return;
    const entry = { t: Date.now(), k: kind, c: "slide-lab", d: detail };
    state.current.events.push(entry);
    if (state.current.events.length > 2000) state.current.events.splice(1, 1);
    const next = [...state.current.events];
    setEvents(next);
    try { localStorage.setItem("rk:slide-merge:log", JSON.stringify(next)); } catch { setMessage("Activity log is in memory; device storage is full"); }
  }
  function note(detail, kind = "sys") { setMessage(detail); write(kind, detail); }
  function reset(slide) { clearTimeout(state.current.timer); state.current.baseline = activitySnapshot(slide.scene.elements); state.current.slide = slide.id; }
  function flush() {
    clearTimeout(state.current.timer);
    if (!api || !live.current.ready) return;
    const current = activitySnapshot(api.getSceneElementsIncludingDeleted());
    const changes = state.current.slide === live.current.deck?.selected ? activityChanges(state.current.baseline, current) : [];
    state.current.baseline = current; state.current.slide = live.current.deck?.selected;
    const messages = [...state.current.pending, ...changes]; state.current.pending.clear();
    if (messages.length) note(messages.join("; ") + ` (slide ${(live.current.deck?.slides.findIndex(slide => slide.id === state.current.slide) ?? 0) + 1})`);
  }
  function pending(detail) { state.current.pending.add(detail); clearTimeout(state.current.timer); state.current.timer = setTimeout(flush, 600); }
  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onChange(() => { if (live.current.ready) { clearTimeout(state.current.timer); state.current.timer = setTimeout(flush, 600); } });
    const error = () => write("error", "Browser error (details omitted to protect content)");
    let frame;
    const finish = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(flush); };
    const keyboard = event => {
      if (!live.current.editing || api.getAppState().viewModeEnabled) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || !["z", "y"].includes(event.key.toLowerCase())) return;
      if (event.target.closest?.("input,textarea,[contenteditable=true]")) return;
      flush(); note(event.shiftKey || event.key.toLowerCase() === "y" ? "Redo" : "Undo");
    };
    document.addEventListener("pointerup", finish, true); document.addEventListener("keydown", keyboard, true);
    window.addEventListener("error", error); window.addEventListener("unhandledrejection", error);
    return () => { unsubscribe(); clearTimeout(state.current.timer); cancelAnimationFrame(frame); document.removeEventListener("pointerup", finish, true); document.removeEventListener("keydown", keyboard, true); window.removeEventListener("error", error); window.removeEventListener("unhandledrejection", error); };
  }, [api]);
  function start() {
    flush(); state.current.events = []; state.current.recording = true; setEvents([]); setRecording(true); setShowLog(false);
    write("meta", `Editor v1.31; ${innerWidth}x${innerHeight}; ${ACTIVITY_CAPABILITIES}`);
    note("Recording activity");
  }
  function stop() { flush(); write("sys", "Recording stopped"); state.current.recording = false; setRecording(false); setShowLog(true); }
  return { recording, showLog, setShowLog, events, message, note, write, pending, reset, flush, start, stop };
}

export function EditorBar({ historyRef, status, busy, editing, onEditing, slideView, onView, onPlay, canPlay, activity, children }) {
  const EditingIcon = editing ? Pencil : PencilOff;
  return <div className="merge-editor-bar">
    <div className="merge-bar-state"><div ref={historyRef} className="merge-bar-history" /><span className={status === "Saved on this device" || status.endsWith(" - saved") ? "is-saved" : undefined} role="status" title={status}>{status}</span></div>
    <div className="merge-bar-views">
      <button type="button" className="merge-layout-toggle" disabled={busy} aria-pressed={editing} onClick={() => onEditing(!editing)} title={editing ? "Turn slide editing off" : "Turn slide editing on"}><EditingIcon size={15} strokeWidth={1.75} /><span>{editing ? "Editing on" : "Editing off"}</span></button>
      <label className="merge-slideview"><Presentation size={15} strokeWidth={1.75} /><SelectControl aria-label="Slide view" value={slideView} disabled={busy} onChange={event => onView(event.target.value)}><option value="current">Current slide</option><option value="all">All slides</option></SelectControl><svg className="merge-slideview-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></label>
      <button className="merge-bar-play" type="button" title="Rehearse" aria-label="Rehearse" disabled={!canPlay || busy} onClick={onPlay}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></button>
    </div>
    <div className="merge-bar-actions">{children}<button type="button" className={`merge-bar-record${activity.recording ? " is-recording" : ""}`} aria-label={activity.recording ? "Stop recording activity log" : "Record activity log"} title={activity.recording ? "Stop activity logging and view log" : "Record activity log"} aria-pressed={activity.recording} onClick={activity.recording ? activity.stop : activity.start}><span className="merge-record-ring" />{activity.recording && <span className="merge-record-text">REC</span>}</button></div>
  </div>;
}

export function ActivityDialog({ activity }) {
  const [copyState, setCopyState] = useState("Copy");
  async function copy() { try { await navigator.clipboard.writeText(activityText(activity.events)); setCopyState("Copied"); } catch { setCopyState("Copy unavailable - select the log below"); } }
  return <DeckDialog title="Activity log" onClose={() => activity.setShowLog(false)}><div className="merge-log-actions"><button onClick={copy}><Copy size={15} />{copyState}</button><button onClick={activity.start}><span className="merge-log-dot" />Record again</button><span>{activity.events.length} events</span></div><pre className="merge-log-text" tabIndex={0}>{activityText(activity.events)}</pre></DeckDialog>;
}

export function AllSlides({ deck, thumbnails, busy, onOpen, modify, add, remove }) {
  return <section className="merge-all-slides" aria-label="All slides"><header><h2>All slides <small>{deck?.slides.length || 0}</small></h2><button disabled={busy} onClick={() => add()}>Add slide</button></header><div className="merge-all-grid">{deck?.slides.map((slide, index) => <article key={slide.id} className={deck.selected === slide.id ? "is-current" : ""}>
    <button className="merge-all-open" disabled={busy} onClick={() => onOpen(slide.id)} aria-label={`Open slide ${index + 1}: ${slide.title}`}><span className="merge-thumbnail">{thumbnails[slide.id]}</span><span>{index + 1}. {slide.title}</span>{slide.section && <small>{slide.section}</small>}{slide.hidden && <small>Skipped in rehearsal</small>}</button>
    <div className="merge-all-actions"><button disabled={busy || !index} title="Move slide earlier" aria-label={`Move slide ${index + 1} earlier`} onClick={() => modify("up", slide.id)}><ArrowUp size={15} /></button><button disabled={busy || index === deck.slides.length - 1} title="Move slide later" aria-label={`Move slide ${index + 1} later`} onClick={() => modify("down", slide.id)}><ArrowDown size={15} /></button><button disabled={busy} title="Duplicate slide" aria-label={`Duplicate slide ${index + 1}`} onClick={() => modify("duplicate", slide.id)}><Copy size={15} /></button><button disabled={busy} onClick={() => modify("hide", slide.id)}>{slide.hidden ? "Include" : "Skip"}</button><button className="is-danger" disabled={busy || deck.slides.length < 2} title="Delete slide" aria-label={`Delete slide ${index + 1}`} onClick={() => remove(slide.id)}><Trash2 size={15} /></button></div>
  </article>)}</div></section>;
}