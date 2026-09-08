import React, { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { LabColorPicker, LAB_BACKGROUND_PALETTE } from "@excalidraw/excalidraw";
import { TRANSITIONS } from "./slide-merge-properties.mjs";
import { LayoutPicker } from "./slide-merge-layout-picker.jsx";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import "../../css/slide-merge-properties.css";

export function SlideProperties({ settings, elements, disabled, onLayout, onBackground, onMedia, onTransition, mobileOpen = false, layoutPicker, onSaveLayout, onLayers }) {
  const [expanded,setExpanded]=useState(()=>innerWidth>900);
  const [pickerState,setPickerState]=useState({openPopup:null});
  useEffect(()=>{if(disabled)setPickerState({openPopup:null});},[disabled]);
  return <aside className="merge-slide-properties" aria-label="Slide properties" onKeyDown={event=>event.stopPropagation()}>
    <button className="merge-properties-heading" aria-label="Slide properties panel" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><h2>Slide</h2><ToolIcon name="chevron" /></button>
    <div hidden={!expanded && !mobileOpen}>
    <details open><summary>Layout</summary><LayoutPicker {...layoutPicker} compact selected={settings.layout} disabled={disabled} onPick={onLayout} /><button className="merge-background-media merge-layout-save" disabled={disabled} onClick={onSaveLayout}><ToolIcon name="save" />Save as layout</button></details>
    <button className="merge-background-media merge-manage-layers" disabled={disabled} onClick={onLayers}><Layers size={18} strokeWidth={1.75} />Manage layers</button>
    <details open><summary>Background</summary><fieldset className="merge-slide-color" disabled={disabled}><LabColorPicker type="elementBackground" label="Slide background colour" color={settings.background?.color||"transparent"} elements={elements} palette={LAB_BACKGROUND_PALETTE} appState={pickerState} updateData={setPickerState} onChange={color=>onBackground(color==="transparent"?null:{type:"color",color})} /></fieldset>
      <button className="merge-background-media" disabled={disabled} onClick={onMedia}><ToolIcon name="image" />{settings.background?.type==="media"?"Replace image or video":"Image or video"}</button>
      {settings.background?.type==="media"&&<div className="merge-background-file"><span>{settings.background.name}</span><button disabled={disabled} title="Remove background media" aria-label="Remove background media" onClick={()=>onBackground(null)}><ToolIcon name="trash" /></button></div>}
    </details>
    <label className="merge-transition">Transition in<select aria-label="Transition in" disabled={disabled} value={settings.transition||"fade"} onChange={event=>onTransition(event.target.value)}>{TRANSITIONS.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
    </div>
  </aside>;
}