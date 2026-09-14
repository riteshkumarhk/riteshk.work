import React, { useEffect, useState } from "react";
import { Layers, Palette, Pencil, RefreshCw, Undo2 } from "lucide-react";
import { LabColorPicker, LAB_BACKGROUND_PALETTE } from "@excalidraw/excalidraw";
import { TRANSITIONS } from "./slide-merge-properties.mjs";
import { LayoutPicker } from "./slide-merge-layout-picker.jsx";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { SelectControl } from "./slide-shared-controls.jsx";
import { COVER_FIELDS, coverValues, coverPalette } from "./slide-merge-cover.mjs";
import "../../css/slide-merge-properties.css";

function CoverField({ field: [key, label, maxLength], value, onChange }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState("");
  useEffect(() => { setDraft(value); setError(""); }, [value]);
  const props = { "aria-label": `Cover ${label.toLowerCase()}`, "aria-invalid": !!error, maxLength, value: draft, onChange: event => { setDraft(event.target.value); setError(onChange({ [key]: event.target.value }) || ""); } };
  return <label className="merge-cover-field"><span>{label}</span>{["title", "team", "role", "footnote"].includes(key) ? <textarea {...props} rows={key === "role" || key === "team" ? 4 : 2} /> : <input {...props} type="text" />}{error && <span className="merge-cover-error" role="alert">{error}</span>}</label>;
}
function CoverColor({ name, color, elements, onChange }) {
  const [state, setState] = useState({ openPopup: null });
  return <fieldset className="merge-slide-color"><legend>{name}</legend><LabColorPicker type="elementBackground" label={name} color={color} elements={elements} palette={LAB_BACKGROUND_PALETTE} appState={state} updateData={setState} onChange={value => { if (/^#[0-9a-f]{6}$/i.test(value)) onChange(value); }} /></fieldset>;
}
function CoverMedia({ kind, label, value, onChange, onMedia }) {
  return <div className="merge-cover-media"><button className="merge-property-action" onClick={() => onMedia(kind)}><ToolIcon name="image" />{value ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}</button>{value && <div className="merge-background-file"><span title={value.name}>{value.name}</span><button type="button" title={`Remove ${label.toLowerCase()}`} aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange({ [kind]: null })}><ToolIcon name="trash" /></button></div>}</div>;
}
function CoverProperties({ value, elements, disabled, onChange, onMedia, source, onSource, onEditSource, sourceError }) {
  const cover = coverValues(value);
  const fields = <>{COVER_FIELDS.map(field => <React.Fragment key={field[0]}><CoverField field={field} value={cover[field[0]]} onChange={onChange} />{cover.source?.overrides.includes(field[0]) && <button className="merge-property-action" onClick={() => onSource(field[0])}><Undo2 size={18} />Reset {field[1].toLowerCase()}</button>}{field[0] === "client" && <CoverMedia kind="logo" label="Brand logo" value={cover.logo} onChange={onChange} onMedia={onMedia} />}</React.Fragment>)}<CoverMedia kind="image" label="Hero image" value={cover.image} onChange={onChange} onMedia={onMedia} />{["image", "logo"].filter(key => cover.source?.overrides.includes(key)).map(key => <button key={key} className="merge-property-action" onClick={() => onSource(key)}><Undo2 size={18} />Reset {key}</button>)}</>;
  return <>
    {source && <fieldset disabled={disabled}><legend>Project</legend><button className="merge-property-action" onClick={() => onEditSource("details")}><Pencil size={18} />Details</button><button className="merge-property-action" onClick={() => onEditSource("highlights")}><Pencil size={18} />Highlights</button><button className="merge-property-action" onClick={() => onSource()}><RefreshCw size={18} />{cover.source ? "Refresh linked cover" : "Use project content"}</button>{sourceError && <span className="merge-cover-error" role="alert">{sourceError}</span>}</fieldset>}
    {cover.source ? <>
      <fieldset disabled={disabled}><legend>Visible content</legend>{[["title", "Title"], ["client", "Client"], ["status", "Status"], ["duration", "Period"], ["team", "Team"], ["role", "My role"], ["footnote", "Scope"], ["image", "Cover image"], ["logo", "Brand logo"]].map(([key, label]) => <label className="merge-cover-visibility" key={key}><input type="checkbox" aria-label={`Show ${label.toLowerCase()}`} checked={!cover.hidden.includes(key)} onChange={event => onChange({ hidden: event.target.checked ? cover.hidden.filter(item => item !== key) : [...cover.hidden, key] })} />{label}</label>)}</fieldset>
      <fieldset disabled={disabled}><legend>Slide overrides</legend><details className="merge-cover-overrides"><summary>Custom content</summary>{fields}</details></fieldset>
    </> : <fieldset disabled={disabled}><legend>Cover</legend>{fields}</fieldset>}
    {cover.image && <fieldset disabled={disabled}><legend>Image crop</legend>{["x", "y"].map(axis => <label className="merge-cover-field" key={axis}><span>{axis === "x" ? "Horizontal" : "Vertical"}</span><input className="merge-cover-crop" type="range" style={{ "--fill": `${cover.crop[axis]}%` }} aria-label={`Cover crop ${axis}`} min="0" max="100" value={cover.crop[axis]} onChange={event => onChange({ crop: { ...cover.crop, [axis]: +event.target.value } })} /></label>)}{cover.depth && <label className="merge-cover-visibility"><input type="checkbox" checked={cover.motion} onChange={event => onChange({ motion: event.target.checked })} />Depth in playback</label>}</fieldset>}
    <fieldset disabled={disabled}><legend>Colours</legend><button className="merge-property-action" onClick={event => onChange(coverPalette(getComputedStyle(event.currentTarget.closest(".merge-shell"))))}><Palette size={18} strokeWidth={1.75} />Use site colours</button>{[["background", "Cover background"], ["rail", "Brand rail"], ["panel", "Image frame"], ["text", "Title colour"], ["muted", "Body colour"]].map(([key, name]) => <CoverColor key={key} name={name} color={cover[key]} elements={elements} onChange={color => onChange({ [key]: color })} />)}</fieldset>
  </>;
}
export function SlideProperties({ settings, elements, disabled, onLayout, onBackground, onMedia, onTransition, layoutPicker, onSaveLayout, onLayers, onCover, onCoverMedia, coverSource, onCoverSource, onEditCoverSource, coverSourceError }) {
  const [pickerState,setPickerState]=useState({openPopup:null});
  useEffect(()=>{if(disabled)setPickerState({openPopup:null});},[disabled]);
  return <aside className="merge-slide-properties Island App-menu__left" style={{"--padding":2}} aria-label="Slide properties" onKeyDown={event=>event.stopPropagation()}>
    <div className="panelColumn">
    {settings.cover ? <CoverProperties value={settings.cover} elements={elements} disabled={disabled} onChange={onCover} onMedia={onCoverMedia} source={coverSource} onSource={onCoverSource} onEditSource={onEditCoverSource} sourceError={coverSourceError} /> : <>
    <fieldset disabled={disabled}><legend>Layout</legend><LayoutPicker {...layoutPicker} compact selected={settings.layout} disabled={disabled} onPick={onLayout} /></fieldset>
    <fieldset className="merge-slide-color" disabled={disabled}><legend>Background</legend><LabColorPicker type="elementBackground" label="Background" color={settings.background?.color||"transparent"} elements={elements} palette={LAB_BACKGROUND_PALETTE} appState={pickerState} updateData={setPickerState} onChange={color=>onBackground(color==="transparent"?null:{type:"color",color})} />
      <button className="merge-property-action" disabled={disabled} onClick={onMedia}><ToolIcon name="image" />{settings.background?.type==="media"?"Replace image or video":"Image or video"}</button>
      {settings.background?.type==="media"&&<div className="merge-background-file"><span>{settings.background.name}</span><button disabled={disabled} title="Remove background media" aria-label="Remove background media" onClick={()=>onBackground(null)}><ToolIcon name="trash" /></button></div>}
    </fieldset>
    </>}
    <fieldset disabled={disabled}><legend>Transition in</legend><SelectControl className="merge-property-select" aria-label="Transition in" value={settings.transition||"fade"} onChange={event=>onTransition(event.target.value)}>{TRANSITIONS.map(([value,name])=><option key={value} value={value}>{name}</option>)}</SelectControl></fieldset>
    <fieldset className="merge-property-actions" disabled={disabled}><legend>Actions</legend><button className="merge-property-action" onClick={onSaveLayout}><ToolIcon name="save" />Save as layout</button><button className="merge-property-action" onClick={onLayers}><Layers size={18} strokeWidth={1.75} />Manage layers</button></fieldset>
    </div>
  </aside>;
}