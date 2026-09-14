import React, { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { LabColorPicker, LAB_BACKGROUND_PALETTE } from "@excalidraw/excalidraw";
import { TRANSITIONS } from "./slide-merge-properties.mjs";
import { LayoutPicker } from "./slide-merge-layout-picker.jsx";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { SelectControl } from "./slide-shared-controls.jsx";
import { COVER_FIELDS, coverValues } from "./slide-merge-cover.mjs";
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
function CoverProperties({ value, elements, disabled, onChange, onMedia }) {
  const cover = coverValues(value);
  return <>
    <fieldset disabled={disabled}><legend>Cover</legend>{COVER_FIELDS.map(field => <CoverField key={field[0]} field={field} value={cover[field[0]]} onChange={onChange} />)}</fieldset>
    <fieldset disabled={disabled}><legend>Media</legend>{[["image", "Hero image"], ["logo", "Logo"]].map(([key, label]) => <div key={key} className="merge-cover-media"><button className="merge-property-action" onClick={() => onMedia(key)}><ToolIcon name="image" />{cover[key] ? `Replace ${label.toLowerCase()}` : label}</button>{cover[key] && <div className="merge-background-file"><span title={cover[key].name}>{cover[key].name}</span><button type="button" title={`Remove ${label.toLowerCase()}`} aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange({ [key]: null })}><ToolIcon name="trash" /></button></div>}</div>)}</fieldset>
    <fieldset disabled={disabled}><legend>Colours</legend>{[["background", "Cover background"], ["rail", "Brand rail"], ["panel", "Image frame"], ["text", "Title colour"], ["muted", "Body colour"]].map(([key, name]) => <CoverColor key={key} name={name} color={cover[key]} elements={elements} onChange={color => onChange({ [key]: color })} />)}</fieldset>
  </>;
}
export function SlideProperties({ settings, elements, disabled, onLayout, onBackground, onMedia, onTransition, layoutPicker, onSaveLayout, onLayers, onCover, onCoverMedia }) {
  const [pickerState,setPickerState]=useState({openPopup:null});
  useEffect(()=>{if(disabled)setPickerState({openPopup:null});},[disabled]);
  return <aside className="merge-slide-properties Island App-menu__left" style={{"--padding":2}} aria-label="Slide properties" onKeyDown={event=>event.stopPropagation()}>
    <div className="panelColumn">
    {settings.cover ? <CoverProperties value={settings.cover} elements={elements} disabled={disabled} onChange={onCover} onMedia={onCoverMedia} /> : <>
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