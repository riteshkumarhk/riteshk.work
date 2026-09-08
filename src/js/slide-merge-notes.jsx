import { useLayoutEffect, useRef, useState } from "react";
import { clampNotesHeight } from "./slide-merge-notes.mjs";
import "../../css/slide-merge-notes.css";

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