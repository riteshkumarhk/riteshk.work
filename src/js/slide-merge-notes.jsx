import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MessageSquareText, Timer, UserRound } from "lucide-react";
import { clampNotesHeight, formatSlideDuration, parseSlideDuration } from "./slide-merge-notes.mjs";
import "../../css/slide-merge-notes.css";

export function NotesControls({ expanded, onToggle, minutes, onTiming, disabled, slideId }) {
  return <div className="merge-notes-controls" data-prevent-outside-click>
    <button type="button" className="help-icon merge-notes-toggle" title="Speaker notes" aria-label="Speaker notes panel" aria-expanded={expanded} aria-controls="merge-speaker-notes" disabled={disabled} onClick={onToggle}>
      <span className="merge-speaker-icon" aria-hidden="true"><UserRound size={20} strokeWidth={1.75} /><MessageSquareText size={12} strokeWidth={1.75} /></span>
      <span className="merge-notes-label">Notes</span><ChevronDown className="merge-notes-chevron" size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
    <SlideTimeBudget key={slideId} minutes={minutes} onChange={onTiming} disabled={disabled} />
  </div>;
}

function SlideTimeBudget({ minutes = 0, onChange, disabled }) {
  const [draft, setDraft] = useState(null);
  const initial = useRef(minutes), input = useRef(null);
  const value = draft ?? formatSlideDuration(minutes);
  const parsed = parseSlideDuration(value), invalid = parsed === null;
  function change(text) {
    setDraft(text);
    const next = parseSlideDuration(text);
    if (next !== null) onChange(next);
  }
  function step(seconds) {
    const next = Math.max(0, Math.min(240 * 60, Math.round((parsed ?? minutes) * 60) + seconds)) / 60;
    setDraft(null); onChange(next);
  }
  function key(event) {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      step(({ ArrowUp: 30, ArrowDown: -30, PageUp: 300, PageDown: -300 })[event.key] * (event.shiftKey ? 2 : 1));
    } else if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") onChange(initial.current);
      setDraft(null);
    }
  }
  return <div className="merge-time-budget" role="group" aria-label="Slide timing">
    <Timer size={18} strokeWidth={1.75} aria-hidden="true" />
    <div className="merge-time-field">
      <input ref={input} type="text" role="spinbutton" aria-label="Slide time budget" title={invalid ? "Enter a time from 00:00 to 240:00" : "Slide time budget (minutes:seconds)"} aria-valuemin={0} aria-valuemax={14400} aria-valuenow={Math.round(minutes * 60)} aria-valuetext={formatSlideDuration(minutes)} aria-invalid={invalid || undefined} value={value} disabled={disabled} autoComplete="off" spellCheck={false} onFocus={() => { initial.current = minutes; }} onChange={event => change(event.target.value)} onBlur={() => setDraft(null)} onKeyDown={key} />
      <span className="merge-time-steps">
        <button type="button" title="Increase time by 30 seconds" aria-label="Increase slide time" disabled={disabled || (parsed ?? minutes) >= 240} onPointerDown={event => event.preventDefault()} onClick={() => { step(30); input.current.focus(); }}><ChevronUp size={11} strokeWidth={1.75} aria-hidden="true" /></button>
        <button type="button" title="Decrease time by 30 seconds" aria-label="Decrease slide time" disabled={disabled || (parsed ?? minutes) <= 0} onPointerDown={event => event.preventDefault()} onClick={() => { step(-30); input.current.focus(); }}><ChevronDown size={11} strokeWidth={1.75} aria-hidden="true" /></button>
      </span>
    </div>
  </div>;
}

export function useNotesResize(editor) {
  const [requested, setRequested] = useState(() => {
    try { return Number(localStorage.getItem("rk:slide-merge:notes-height")) || 116; } catch { return 116; }
  });
  const [editorHeight, setEditorHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const height = clampNotesHeight(requested, editorHeight);
  const maximum = editorHeight / 2;
  useLayoutEffect(() => {
    const element = editor.current;
    if (!element) return;
    const measure = () => setEditorHeight(element.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [editor]);
  function store(value) {
    const next = clampNotesHeight(value, editorHeight);
    setRequested(next);
    try { localStorage.setItem("rk:slide-merge:notes-height", String(next)); } catch {}
  }
  function finish(event, cancel = false) {
    if (!drag.current) return;
    store(cancel ? drag.current.height : drag.current.next);
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return { height, dragging, handle: {
    role: "separator", tabIndex: 0, "aria-label": "Resize speaker notes", "aria-orientation": "horizontal",
    "aria-controls": "merge-speaker-notes", "aria-valuemin": Math.min(80, maximum), "aria-valuemax": maximum,
    "aria-valuenow": height, "aria-valuetext": `${Math.round(height)} pixels`,
    title: "Resize speaker notes", "data-prevent-outside-click": true,
    onPointerDown: event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { y: event.clientY, height, next: height }; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); },
    onPointerMove: event => { if (!drag.current) return; drag.current.next = clampNotesHeight(drag.current.height + drag.current.y - event.clientY, editorHeight); setRequested(drag.current.next); },
    onPointerUp: finish, onPointerCancel: event => finish(event, true),
    onLostPointerCapture: event => finish(event, true),
    onDoubleClick: () => store(116),
    onKeyDown: event => {
      const step = event.shiftKey ? 40 : 16;
      const next = { ArrowUp: height + step, ArrowDown: height - step, Home: 80, End: maximum }[event.key];
      if (next !== undefined) { event.preventDefault(); event.stopPropagation(); store(next); }
    }
  } };
}