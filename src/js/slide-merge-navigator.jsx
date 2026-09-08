import React, { useEffect, useRef, useState } from "react";
import { ToolMenu, ToolIcon } from "./slide-merge-toolbar.jsx";
import { PROPERTY_LAYOUTS } from "./slide-merge-properties.mjs";
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
export function SlideNavigator({ deck, thumbnails, busy, choose, modify, add, pick, section, remove }) {
  const menu = () => <><button data-close onClick={() => add("blank")}>Add blank</button><button data-close onClick={() => pick("layout")}>Add a layout...</button><button data-close onClick={() => pick("source")}>Generate from a section</button></>;
  return <>
    <div className="merge-section-head"><h2>Slides <span>{deck?.slides.length || 0}</span></h2><div className="merge-section-actions"><Action icon="section" label="Start a section here" disabled={busy || !deck} onClick={() => section(deck.selected)} /><ToolMenu icon="add" label="Add a slide" disabled={busy || !deck}>{menu()}</ToolMenu></div></div>
    <div className="merge-slide-list">{deck?.slides.map((slide, index) => <div className="merge-slide-entry" key={slide.id}>
      {slide.section && <button className="merge-section-label" title="Rename or remove section" onClick={() => section(slide.id)} disabled={busy}><ToolIcon name="section" /><span>{slide.section}</span></button>}
      <InsertGap index={index} busy={busy} add={() => add("blank", slide.id)} section={() => section(slide.id)} />
      <article className={`merge-slide-card ${deck.selected === slide.id ? "is-active" : ""} ${slide.hidden ? "is-skipped" : ""}`}>
        <button className={`merge-slide ${deck.selected === slide.id ? "is-active" : ""}`} aria-label={`Slide ${index + 1}: ${slide.title}`} aria-current={deck.selected === slide.id ? "true" : undefined} disabled={busy} onClick={() => choose(slide.id)}><span className="merge-thumbnail" aria-hidden="true" dangerouslySetInnerHTML={{ __html: thumbnails[slide.id] || "" }} /><span><small>{String(index + 1).padStart(2, "0")}</small>{slide.title || "Untitled slide"}</span>{slide.hidden && <em className="merge-skipped-label">Skipped</em>}</button>
        <div className="merge-thumb-actions" aria-label={`Actions for slide ${index + 1}`}>
          <Action icon="up" label="Move slide up" disabled={busy || index === 0} onClick={() => modify("up", slide.id)} />
          <Action icon="down" label="Move slide down" disabled={busy || index === deck.slides.length - 1} onClick={() => modify("down", slide.id)} />
          <Action icon="add" label="Add slide above" disabled={busy} onClick={() => add("blank", slide.id)} />
          <Action icon="copy" label="Duplicate slide" disabled={busy} onClick={() => modify("duplicate", slide.id)} />
          <Action icon={slide.hidden ? "eyeoff" : "eye"} label={slide.hidden ? "Include in rehearsal" : "Skip in rehearsal"} aria-pressed={!!slide.hidden} disabled={busy} onClick={() => modify("hide", slide.id)} />
          <Action icon="trash" label="Delete slide" disabled={busy || deck.slides.length < 2} onClick={() => remove(slide.id)} />
        </div>
      </article>
    </div>)}</div>
  </>;
}

export function DeckDialog({ title, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => { const trigger = document.activeElement; dialog.current.showModal(); return () => { if (trigger?.isConnected) trigger.focus(); }; }, []);
  return <dialog className="merge-deck-dialog" aria-label={title} ref={dialog} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2>{title}</h2><Action icon="close" label="Close dialog" onClick={onClose} /></header>{children}
  </dialog>;
}
export function SectionDialog({ value, onSave, onClose }) {
  const [name, setName] = useState(value || "");
  return <DeckDialog title={value ? "Edit section" : "Start a section here"} onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSave(name); }}><label className="merge-dialog-field">Section name<input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label><footer>{value && <button className="is-danger" type="button" onClick={() => onSave("")}>Remove heading</button>}<button type="button" onClick={onClose}>Cancel</button><button className="merge-dialog-primary" type="submit" disabled={!name.trim()}>Save</button></footer></form></DeckDialog>;
}
export function LayoutDialog({ onPick, onClose, embedded = false }) {
  const choices = <div className="merge-layout-choices">{PROPERTY_LAYOUTS.map(layout => <button key={layout.id} onClick={() => onPick(layout.id)}><span className="merge-layout-thumb" aria-hidden="true">{layout.slots.map((slot, index) => <span key={index} className={slot.kind === "media" ? "is-media" : ""} style={{left:`${slot.x}%`, top:`${slot.y}%`, width:`${slot.width}%`, height:`${slot.height}%`}} />)}{!layout.slots.length && <em>Blank</em>}</span><span>{layout.name}</span></button>)}</div>;
  return embedded ? choices : <DeckDialog title="Add a layout" onClose={onClose}>{choices}</DeckDialog>;
}