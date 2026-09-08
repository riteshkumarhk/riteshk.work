import React, { useState } from "react";
import { Sidebar } from "@excalidraw/excalidraw";
import { IconLibrary } from "./slide-merge-library.jsx";
import { SectionPicker } from "./slide-merge-section-picker.jsx";
import { LayoutDialog } from "./slide-merge-navigator.jsx";
import { BADGE_PRESETS, CONTENT_BLOCKS } from "./slide-merge-inserts.mjs";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import "../../css/slide-merge-content-pane.css";

export const PANE_LABELS = { layers: "Layers", media: "Media", icons: "Icons", text: "Text", badges: "Badges", sections: "Sections", library: "Library", layout: "Add a layout", source: "Generate from a section" };
const samples = { body: "A clear idea, grounded in evidence.", list: "First point\nSecond point\nThird point", metric: "42%", quote: '"A useful insight changes the next decision."', section: "Context / Decision / Outcome" };

function BadgePicker({ onPick }) {
  const [label, setLabel] = useState("");
  return <>
    <div className="merge-badge-choices">{BADGE_PRESETS.map(([preset, title, color]) => <button key={preset} title={`Insert ${title} badge`} aria-label={`Insert ${title} badge`} onClick={() => onPick("badge", { preset })}><span style={{backgroundColor:color}}>{title}</span></button>)}</div>
    <form className="merge-custom-badge" onSubmit={event => { event.preventDefault(); if (label.trim()) onPick("badge", { label }); }}>
      <label htmlFor="merge-badge-label">Custom badge</label><div><input id="merge-badge-label" value={label} maxLength={40} placeholder="Status label" onChange={event => setLabel(event.target.value)} /><button type="submit" title="Insert custom badge" aria-label="Insert custom badge" disabled={!label.trim()}><ToolIcon name="add" /></button></div>
    </form>
  </>;
}

export function ContentPane({ pane, busy, onContent, onIcon, onSection, onNewLayout, onNewSection, onMedia, onUpload, layoutPicker, composition, children }) {
  return <Sidebar name="insert" className="merge-content-sidebar" docked={false}>
    <Sidebar.Header><strong>{PANE_LABELS[pane] || "Insert"}</strong></Sidebar.Header>
    <fieldset className={`merge-pane-body${pane === "layers" ? " merge-pane-body--layers" : ""}`} disabled={busy} aria-label={PANE_LABELS[pane] || "Insert"}>
      {pane === "layers" && children}
      {pane === "media" && <SectionPicker embedded mediaOnly onPick={onMedia} onUpload={onUpload} />}
      {pane === "icons" && <IconLibrary embedded onPick={onIcon} />}
      {pane === "text" && <div className="merge-text-choices">{CONTENT_BLOCKS.filter(([kind]) => kind !== "badge").map(([kind, title]) => <button key={kind} aria-label={`Insert ${title}`} onClick={() => onContent(kind)}><span className={`merge-text-preview merge-text-preview--${kind}`} aria-hidden="true">{samples[kind]}</span><strong>{title}</strong></button>)}</div>}
      {pane === "badges" && <BadgePicker onPick={onContent} />}
      {pane === "sections" && <SectionPicker embedded onPick={onSection} />}
      {pane === "layout" && <LayoutDialog embedded {...layoutPicker} disabled={busy} onPick={onNewLayout} />}
      {pane === "source" && <SectionPicker embedded multiple onPick={onNewSection} composition={composition} />}
    </fieldset>
  </Sidebar>;
}