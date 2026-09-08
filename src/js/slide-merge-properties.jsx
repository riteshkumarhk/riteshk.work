import React, { useEffect, useRef, useState } from "react";
import { LabColorPicker, LAB_BACKGROUND_PALETTE } from "@excalidraw/excalidraw";
import { PROPERTY_LAYOUTS, TRANSITIONS } from "./slide-merge-properties.mjs";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import "../../css/slide-merge-properties.css";

export function SlideProperties({ settings, elements, disabled, onLayout, onBackground, onMedia, onTransition }) {
  const input=useRef(null);
  const [expanded,setExpanded]=useState(()=>innerWidth>900);
  const [pickerState,setPickerState]=useState({openPopup:null});
  useEffect(()=>{if(disabled)setPickerState({openPopup:null});},[disabled]);
  return <aside className="merge-slide-properties" aria-label="Slide properties" onKeyDown={event=>event.stopPropagation()}>
    <button className="merge-properties-heading" aria-label="Slide properties panel" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><h2>Slide</h2><span aria-hidden="true">{expanded?"−":"+"}</span></button>
    <div hidden={!expanded}>
    <details open><summary>Layout</summary><div className="merge-layout-grid">{PROPERTY_LAYOUTS.map(layout=><button type="button" key={layout.id} disabled={disabled} aria-pressed={settings.layout===layout.id} title={layout.name} onClick={()=>onLayout(layout.id)}><span className="merge-layout-thumb" aria-hidden="true">{layout.slots.map((slot,index)=><span key={index} className={slot.kind==="media"?"is-media":""} style={{left:`${slot.x}%`,top:`${slot.y}%`,width:`${slot.width}%`,height:`${slot.height}%`}} />)}{!layout.slots.length&&<em>Blank</em>}</span><span>{layout.name}</span></button>)}</div></details>
    <details open><summary>Background</summary><fieldset className="merge-slide-color" disabled={disabled}><LabColorPicker type="elementBackground" label="Slide background colour" color={settings.background?.color||"transparent"} elements={elements} palette={LAB_BACKGROUND_PALETTE} appState={pickerState} updateData={setPickerState} onChange={color=>onBackground(color==="transparent"?null:{type:"color",color})} /></fieldset>
      <button className="merge-background-media" disabled={disabled} onClick={()=>input.current.click()}><ToolIcon name="image" />{settings.background?.type==="media"?"Replace image or video":"Image or video"}</button>
      {settings.background?.type==="media"&&<div className="merge-background-file"><span>{settings.background.name}</span><button disabled={disabled} title="Remove background media" aria-label="Remove background media" onClick={()=>onBackground(null)}><ToolIcon name="trash" /></button></div>}
      <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" onChange={event=>{const file=event.target.files[0];if(file)onMedia(file);event.target.value="";}} />
    </details>
    <label className="merge-transition">Transition in<select aria-label="Transition in" disabled={disabled} value={settings.transition||"fade"} onChange={event=>onTransition(event.target.value)}>{TRANSITIONS.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
    </div>
  </aside>;
}