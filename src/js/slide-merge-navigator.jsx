import React, { useEffect, useRef, useState } from "react";
import { ToolMenu, ToolIcon } from "./slide-merge-toolbar.jsx";
import { LayoutPicker } from "./slide-merge-layout-picker.jsx";
import { NavigatorDragList, NavigatorDragEntry } from "./slide-merge-drag.jsx";
import "../../css/slide-merge-navigator.css";

function Action({ icon, label, ...props }) {
  return <button className={`merge-nav-action ${icon === "trash" ? "is-danger" : ""}`} title={label} aria-label={label} {...props}><ToolIcon name={icon} /></button>;
}
function InsertGap({ index, busy, add, section }) {
  const [open, setOpen] = useState(false), host = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  return <div className="merge-gap" ref={host} onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); host.current.querySelector(".merge-insert-gap").focus(); } }}>
    <button className="merge-insert-gap" title="Insert here" aria-label={`Insert before slide ${index + 1}`} aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}><ToolIcon name="add" /></button>
    {open && <div className="merge-gap-choices" role="group" aria-label="Insert here"><button disabled={busy} onClick={() => { setOpen(false); add(); }}><ToolIcon name="add" />Add slide</button><button disabled={busy} onClick={() => { setOpen(false); section(); }}><ToolIcon name="section" />Start section</button></div>}
  </div>;
}
function SectionName({ value, onSave, onClose }) {
  const [name, setName] = useState(value || ""), input = useRef(null), finished = useRef(false);
  useEffect(() => { input.current.focus(); input.current.select(); input.current.scrollIntoView({ block:"nearest" }); }, []);
  function finish(cancel = false) {
    if (finished.current) return;
    finished.current = true;
    if (!cancel && name.trim() && name.trim() !== value) onSave(name.trim());
    onClose();
  }
  return <input ref={input} className="merge-section-name" aria-label="Section name" placeholder="Section name" maxLength={120} value={name} onChange={event => setName(event.target.value)} onBlur={() => finish()} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); finish(event.key === "Escape"); } }} />;
}
export function SlideNavigator({ deck, thumbnails, busy, editing = true, choose, modify, add, pick, section, remove, reorder }) {
  const [naming, setNaming] = useState(null);
  useEffect(() => { if (!editing) setNaming(null); }, [editing]);
  const menu = () => <><button data-close onClick={() => add("blank")}>Add blank</button><button data-close onClick={() => pick("layout")}>Add a layout...</button><button data-close onClick={() => pick("source")}>Add sections as slides</button><button data-close onClick={() => pick("draft")}>Draft entire deck with AI</button></>;
  return <>
    <div className="merge-section-head"><h2>Slides <span>{deck?.slides.length || 0}</span></h2>{editing && <div className="merge-navigator-actions"><Action icon="section" label="Start a section here" disabled={busy || !deck} onClick={() => setNaming(deck.selected)} /><ToolMenu icon="add" label="Add a slide" disabled={busy || !deck}>{menu()}</ToolMenu></div>}</div>
    <NavigatorDragList deck={deck} thumbnails={thumbnails} disabled={busy || !editing || naming !== null} reorder={reorder}>{deck?.slides.map((slide, index) => <NavigatorDragEntry key={slide.id} slide={slide} index={index}>{({ slideDrag, sectionHandle }) => <>
      {(slide.section || naming === slide.id) && <div className="merge-section-row">
      {editing && slide.section && sectionHandle}
        {naming === slide.id && editing ? <SectionName key={slide.id} value={slide.section} onSave={name => section(slide.id, name)} onClose={() => setNaming(null)} /> : <button className="merge-section-label" title={editing ? "Rename section" : "Section"} onClick={() => setNaming(slide.id)} disabled={busy || !editing}><ToolIcon name="section" /><span>{slide.section}</span></button>}
        {editing && slide.section && <Action icon="trash" label="Remove section" disabled={busy} onPointerDown={event => event.preventDefault()} onClick={() => { setNaming(null); section(slide.id, ""); }} />}
      </div>}
      {editing && <InsertGap index={index} busy={busy} add={() => add("blank", slide.id)} section={() => setNaming(slide.id)} />}
      <article data-slide-delete-id={slide.id} className={`merge-slide-card ${deck.selected === slide.id ? "is-active" : ""} ${slide.hidden ? "is-skipped" : ""}`}>
        <button {...slideDrag} className={`merge-slide ${deck.selected === slide.id ? "is-active" : ""}`} aria-label={`Slide ${index + 1}: ${slide.title}`} aria-current={deck.selected === slide.id ? "true" : undefined} disabled={busy} onClick={() => choose(slide.id)}><span className="merge-thumbnail" aria-hidden="true">{thumbnails[slide.id]}</span><span><small>{String(index + 1).padStart(2, "0")}</small>{slide.title || "Untitled slide"}</span>{slide.hidden && <em className="merge-skipped-label">Skipped</em>}</button>
        {editing && <div className="merge-thumb-actions" aria-label={`Actions for slide ${index + 1}`}>
          <Action icon="up" label="Move slide up" disabled={busy || index === 0} onClick={() => modify("up", slide.id)} />
          <Action icon="down" label="Move slide down" disabled={busy || index === deck.slides.length - 1} onClick={() => modify("down", slide.id)} />
          <Action icon="add" label="Add slide above" disabled={busy} onClick={() => add("blank", slide.id)} />
          <Action icon="copy" label="Duplicate slide" disabled={busy} onClick={() => modify("duplicate", slide.id)} />
          <Action icon={slide.hidden ? "eyeoff" : "eye"} label={slide.hidden ? "Include in rehearsal" : "Skip in rehearsal"} aria-pressed={!!slide.hidden} disabled={busy} onClick={() => modify("hide", slide.id)} />
          <Action icon="trash" label="Delete slide" disabled={busy || deck.slides.length < 2} onClick={() => remove(slide.id)} />
        </div>}
      </article>
    </>}</NavigatorDragEntry>)}</NavigatorDragList>
  </>;
}

export function DeckDialog({ title, onClose, children, wide = true }) {
  const dialog = useRef(null), trigger = useRef(document.activeElement);
  useEffect(() => { dialog.current.showModal(); dialog.current.querySelector("input:not(:disabled), footer button:not(:disabled)")?.focus(); return () => { requestAnimationFrame(() => { if (trigger.current?.isConnected && !document.querySelector("dialog[open]")) trigger.current.focus(); }); }; }, []);
  return <dialog className={`merge-deck-dialog${wide ? " merge-deck-dialog--wide" : ""}`} aria-label={title} ref={dialog} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2>{title}</h2>{wide && <Action icon="close" label="Close dialog" onClick={onClose} />}</header>{children}
  </dialog>;
}
export function LayoutDialog({ onPick, onClose, embedded = false, ...props }) {
  const choices = <LayoutPicker {...props} onPick={onPick} />;
  return embedded ? choices : <DeckDialog title="Add a layout" onClose={onClose}>{choices}</DeckDialog>;
}

export function LayoutNameDialog({ value, onSave, onClose, busy, error }) {
  const [name, setName] = useState(value || "My layout");
  return <DeckDialog wide={false} title={value ? "Rename layout" : "Save as layout"} onClose={() => { if (!busy) onClose(); }}><form onSubmit={event => { event.preventDefault(); onSave(name); }}><label className="merge-dialog-field">Layout name<input autoFocus disabled={busy} value={name} maxLength={120} required onChange={event => setName(event.target.value)} /></label>{error && <p className="merge-layout-dialog-error" role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="merge-dialog-primary" type="submit" disabled={busy || !name.trim()}>{busy ? "Saving..." : "Save layout"}</button></footer></form></DeckDialog>;
}