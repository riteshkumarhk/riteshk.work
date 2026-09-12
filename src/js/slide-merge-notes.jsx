import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bold, Italic, IndentDecrease, IndentIncrease, List, ListOrdered, ChevronDown, ChevronUp, MessageSquareText, Timer, UserRound } from "lucide-react";
import { AiRibbonIcon as Sparkles } from "./ai-ribbon.jsx";
import { clampNotesHeight, formatSlideDuration, parseSlideDuration, installSlideTimeScrub, SLIDE_TIME_STEP_SECONDS } from "./slide-merge-notes.mjs";
import { installRichNotes, notesHtml } from "./slide-rich-text.mjs";
import { improveSlideText } from "./slide-merge-ai-client.mjs";
import "../../css/slide-merge-notes.css";

export function RichNotesEditor({ value, onChange, disabled, onBoundary }) {
  const editor = useRef(null), controller = useRef(null), latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const request = useRef(null), [working, setWorking] = useState(false), [error, setError] = useState("");
  const [format, setFormat] = useState({});
  useEffect(() => {
    controller.current = installRichNotes(editor.current, { disabled, onChange: next => latest.current.onChange(next), onFormatChange: setFormat });
    controller.current.set(latest.current.value);
    return () => controller.current?.dispose();
  }, [disabled]);
  useEffect(() => { if (document.activeElement !== editor.current) controller.current?.set(value); }, [value]);
  useEffect(() => () => request.current?.abort(), []);
  async function improve() {
    const source = latest.current.value;
    if (!editor.current.innerText.trim() || working) return;
    request.current = new AbortController(); setWorking(true); setError(""); onBoundary?.();
    try {
      const output = notesHtml(await improveSlideText(source, { rich: true, signal: request.current.signal }));
      if (request.current.signal.aborted) return;
      if (latest.current.value !== source) throw new Error("Notes changed while improving. Try again with the current text.");
      controller.current.set(output); latest.current.onChange(output);
    } catch (failure) { if (failure.name !== "AbortError") setError(failure.message); }
    finally { setWorking(false); }
  }
  const controls = [["bold", "Bold", Bold], ["italic", "Italic", Italic], ["insertUnorderedList", "Bulleted list", List], ["insertOrderedList", "Numbered list", ListOrdered], ["outdent", "Decrease indent", IndentDecrease], ["indent", "Increase indent", IndentIncrease]];
  return <div className="merge-rich-notes">
    <div className="merge-rich-toolbar" role="toolbar" aria-label="Speaker notes formatting" data-prevent-outside-click>
      {controls.map(([command, label, Icon]) => <button key={command} type="button" title={label} aria-label={label} aria-pressed={["bold", "italic", "insertUnorderedList", "insertOrderedList"].includes(command) ? !!format[command] : undefined} disabled={disabled || working} onPointerDown={event => event.preventDefault()} onClick={() => { onBoundary?.(); controller.current.command(command); }}><Icon size={15} strokeWidth={1.75} /></button>)}
      <button type="button" className="merge-rich-improve" title="Improve with AI" aria-label="Improve speaker notes with AI" disabled={disabled || working || !String(value || "").trim()} onPointerDown={event => event.preventDefault()} onClick={improve}><Sparkles size={15} strokeWidth={1.75} /><span>{working ? "Improving..." : "Improve"}</span></button>
      {working && <button type="button" onClick={() => request.current?.abort()}>Cancel</button>}
    </div>
    <div ref={editor} className="merge-notes-input" aria-label="Speaker notes" aria-placeholder="Speaker notes" data-placeholder="Speaker notes" onFocus={onBoundary} />
    {error && <div className="merge-rich-error" role="alert">{error}</div>}
  </div>;
}

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
  const scrub = useRef(null), latest = useRef({ minutes, onChange });
  latest.current = { minutes, onChange };
  useEffect(() => {
    scrub.current = installSlideTimeScrub(input.current, {
      handle: input.current.closest('.merge-time-budget'),
      getValue: () => parseSlideDuration(input.current.value) ?? latest.current.minutes,
      onPreview: value => setDraft(value === null ? null : formatSlideDuration(value)),
      onCommit: value => latest.current.onChange(value)
    });
    return () => { scrub.current.dispose(); scrub.current = null; };
  }, []);
  useEffect(() => { if (disabled) scrub.current?.cancel(); }, [disabled]);
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
      step(event.key === "ArrowUp" || event.key === "PageUp" ? SLIDE_TIME_STEP_SECONDS : -SLIDE_TIME_STEP_SECONDS);
    } else if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") onChange(initial.current);
      setDraft(null);
    }
  }
  return <div className="merge-time-budget" role="group" aria-label="Slide timing">
    <Timer size={18} strokeWidth={1.75} aria-hidden="true" />
    <div className="merge-time-field">
      <input ref={input} type="text" role="spinbutton" aria-label="Slide time budget" title={invalid ? "Enter a time from 00:00 to 240:00" : "Slide time budget (MM:SS). Drag to adjust by 10 seconds."} aria-valuemin={0} aria-valuemax={14400} aria-valuenow={Math.round((parsed ?? minutes) * 60)} aria-valuetext={formatSlideDuration(parsed ?? minutes)} aria-invalid={invalid || undefined} value={value} disabled={disabled} autoComplete="off" spellCheck={false} onFocus={() => { initial.current = minutes; }} onChange={event => change(event.target.value)} onBlur={() => setDraft(null)} onKeyDown={key} />
      <span className="merge-time-steps">
        <button type="button" title="Increase time by 10 seconds" aria-label="Increase slide time" disabled={disabled || (parsed ?? minutes) >= 240} onPointerDown={event => event.preventDefault()} onClick={() => { step(SLIDE_TIME_STEP_SECONDS); input.current.focus(); }}><ChevronUp size={11} strokeWidth={1.75} aria-hidden="true" /></button>
        <button type="button" title="Decrease time by 10 seconds" aria-label="Decrease slide time" disabled={disabled || (parsed ?? minutes) <= 0} onPointerDown={event => event.preventDefault()} onClick={() => { step(-SLIDE_TIME_STEP_SECONDS); input.current.focus(); }}><ChevronDown size={11} strokeWidth={1.75} aria-hidden="true" /></button>
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