import React, { useEffect, useRef, useState } from "react";
import { DIAGRAM_SHAPES } from "./slide-merge-inserts.mjs";
import "../../css/slide-merge-toolbar.css";

const toolPaths = {
  terminator:"M8 6h8a6 6 0 0 1 0 12H8A6 6 0 0 1 8 6Z",rounded:"M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",inputoutput:"M7 5h15l-5 14H2Z",subprocess:"M3 5h18v14H3ZM7 5v14M17 5v14",database:"M4 6a8 3 0 0 0 16 0 8 3 0 0 0-16 0ZM4 6v12a8 3 0 0 0 16 0V6",connector:"M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12",triangle:"m12 3 10 18H2Z",hexagon:"M6 3h12l5 9-5 9H6l-5-9Z",
  up:"M12 19V5m-6 6 6-6 6 6",down:"M12 5v14m-6-6 6 6 6-6",copy:"M9 9h12v12H9ZM15 9V3H3v12h6",close:"M6 6l12 12M6 18 18 6",section:"M4 4h16v5H4ZM4 14h16M4 19h10",eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",eyeoff:"M3 3l18 18M10 5h2c6 0 10 7 10 7s-1 2-3 4M6 6c-3 2-4 6-4 6s4 7 10 7h2M10 10l4 4",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  hand: "M8 13V6a2 2 0 0 1 4 0v6M12 11V4a2 2 0 0 1 4 0v8M16 11V7a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2",
  selection: "m4 3 7 18 2-8 8-2Z", text: "M4 6V4h16v2M12 4v16M8 20h8",
  image: "M3 4h18v16H3ZM3 16l6-6 4 4 3-3 5 5M8 8h.01",
  rectangle: "M4 4h16v16H4Z", diamond: "m12 3 9 9-9 9-9-9Z", ellipse: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
  arrow: "M4 12h16m-6-6 6 6-6 6", line: "M4 18 20 6", freedraw: "m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15Z",
  eraser: "m16 3 5 5-12 13H5l-4-4L14 3ZM7 11l6 6M9 21h12", chevron: "m6 9 6 6 6-6",
  icons: "m12 3 3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1Z", content: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1", badge: "M20 13l-7 7-10-10V3h7ZM7 7h.01",
  view: "M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18M15 3v18", notes: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6", add: "M5 12h14M12 5v14"
};
export function ToolIcon({ name }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={toolPaths[name]} /></svg>;
}

export function ToolMenu({ label, icon, children, disabled, active = false, caption }) {
  const details = useRef(null);
  useEffect(() => { if (disabled && details.current) details.current.open = false; }, [disabled]);
  useEffect(() => {
    const outside = event => { if (!details.current?.contains(event.target)) details.current.open = false; };
    const escape = event => { if (event.key === "Escape" && details.current?.open) { event.preventDefault(); event.stopPropagation(); details.current.open = false; details.current.querySelector("summary").focus(); } };
    const resize = () => { if (details.current) details.current.open = false; };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", resize); };
  }, []);
  return <details className={`merge-tool-menu ${active ? "is-active" : ""}`} ref={details} onToggle={event => {
    const panel = details.current.querySelector(".merge-tool-pop");
    if (event.currentTarget.open) {
      document.querySelectorAll("details.merge-tool-menu[open]").forEach(other => { if (other !== details.current) other.open = false; });
      panel.showPopover();
      const anchor = details.current.querySelector("summary").getBoundingClientRect();
      const below = innerHeight - anchor.bottom - 16, above = anchor.top - 16;
      panel.style.maxHeight = `${Math.max(80, Math.max(below, above))}px`;
      const box = panel.getBoundingClientRect(), top = box.height <= below || below >= above ? anchor.bottom + 8 : anchor.top - box.height - 8;
      panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8))}px`;
      panel.style.top = `${Math.max(8, top)}px`;
    } else panel.hidePopover();
  }}>
    <summary title={label} aria-label={label} aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault(); }}><ToolIcon name={icon} />{caption && <span>{caption}</span>}<ToolIcon name="chevron" /></summary>
    <div className="merge-tool-pop" popover="manual" onClick={event => { if (event.target.closest("button[data-close]")) details.current.open = false; }}>{children}</div>
  </details>;
}

export function CanvasToolbar({ api, disabled, onImage, mediaOpen, onDiagram, children }) {
  const [tool, setTool] = useState("selection");
  useEffect(() => api?.onChange((elements, state) => setTool(state.activeTool.type)), [api]);
  function select(type) {
    if (!api || disabled) return;
    api.updateScene({ appState: { activeTool: { ...api.getAppState().activeTool, locked: false } } });
    api.setActiveTool({ type });
    document.querySelector(".merge-workspace .excalidraw")?.focus();
  }
  function button(type, label) { return <button type="button" className="merge-tool" title={label} aria-label={label} aria-pressed={tool === type} disabled={disabled} onClick={() => select(type)}><ToolIcon name={type} /></button>; }
  return <div className="merge-canvas-tools" role="toolbar" aria-label="Slide editing tools">
    <div className="merge-drawing-tools">
    <div className="merge-tool-group">{button("hand", "Hand (H)")}{button("selection", "Select (V)")}</div>
    <div className="merge-tool-group">{button("text", "Text (T)")}<button className="merge-tool" title="Media" aria-label="Media" aria-pressed={mediaOpen} disabled={disabled} onClick={onImage}><ToolIcon name="image" /></button>
      <ToolMenu label="Shapes" icon={["rectangle", "diamond", "ellipse"].includes(tool) ? tool : "rectangle"} active={["rectangle", "diamond", "ellipse"].includes(tool)} disabled={disabled}>
        {[["rectangle", "Rectangle (R)"], ["diamond", "Diamond (D)"], ["ellipse", "Ellipse (O)"]].map(([type, label]) => <button key={type} data-close aria-pressed={tool === type} onClick={() => select(type)}><ToolIcon name={type} />{label}</button>)}
        <hr />{DIAGRAM_SHAPES.map(([kind,label]) => <button key={kind} data-close onClick={() => onDiagram(kind)}><ToolIcon name={kind} />{label}</button>)}
      </ToolMenu>{button("arrow", "Arrow (A)")}{button("line", "Line (L)")}
      <ToolMenu label="Draw" icon={tool === "eraser" ? "eraser" : "freedraw"} active={["freedraw", "eraser"].includes(tool)} disabled={disabled}>
        <button className="merge-mobile-only" data-close onClick={()=>select("line")}><ToolIcon name="line" />Line (L)</button>
        {[["freedraw", "Pen (P)"], ["eraser", "Eraser (E)"]].map(([type, label]) => <button key={type} data-close aria-pressed={tool === type} onClick={() => select(type)}><ToolIcon name={type} />{label}</button>)}
      </ToolMenu>
    </div></div><div className="merge-extra-tools">{children}</div>
  </div>;
}