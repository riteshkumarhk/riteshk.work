import React, { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { LabColorPicker, LAB_BACKGROUND_PALETTE } from "@excalidraw/excalidraw";
import { TRANSITIONS } from "./slide-merge-properties.mjs";
import { LayoutPicker } from "./slide-merge-layout-picker.jsx";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { SelectControl } from "./slide-shared-controls.jsx";
import "../../css/slide-merge-properties.css";

export function SlideProperties({ settings, elements, disabled, onLayout, onBackground, onMedia, onTransition, layoutPicker, onSaveLayout, onLayers }) {
  const [pickerState,setPickerState]=useState({openPopup:null});
  useEffect(()=>{if(disabled)setPickerState({openPopup:null});},[disabled]);
  return <aside className="merge-slide-properties Island App-menu__left" style={{"--padding":2}} aria-label="Slide properties" onKeyDown={event=>event.stopPropagation()}>
    <div className="panelColumn">
    <fieldset disabled={disabled}><legend>Layout</legend><LayoutPicker {...layoutPicker} compact selected={settings.layout} disabled={disabled} onPick={onLayout} /></fieldset>
    <fieldset className="merge-slide-color" disabled={disabled}><legend>Background</legend><LabColorPicker type="elementBackground" label="Background" color={settings.background?.color||"transparent"} elements={elements} palette={LAB_BACKGROUND_PALETTE} appState={pickerState} updateData={setPickerState} onChange={color=>onBackground(color==="transparent"?null:{type:"color",color})} />
      <button className="merge-property-action" disabled={disabled} onClick={onMedia}><ToolIcon name="image" />{settings.background?.type==="media"?"Replace image or video":"Image or video"}</button>
      {settings.background?.type==="media"&&<div className="merge-background-file"><span>{settings.background.name}</span><button disabled={disabled} title="Remove background media" aria-label="Remove background media" onClick={()=>onBackground(null)}><ToolIcon name="trash" /></button></div>}
    </fieldset>
    <fieldset disabled={disabled}><legend>Transition in</legend><SelectControl className="merge-property-select" aria-label="Transition in" value={settings.transition||"fade"} onChange={event=>onTransition(event.target.value)}>{TRANSITIONS.map(([value,name])=><option key={value} value={value}>{name}</option>)}</SelectControl></fieldset>
    <fieldset className="merge-property-actions" disabled={disabled}><legend>Actions</legend><button className="merge-property-action" onClick={onSaveLayout}><ToolIcon name="save" />Save as layout</button><button className="merge-property-action" onClick={onLayers}><Layers size={18} strokeWidth={1.75} />Manage layers</button></fieldset>
    </div>
  </aside>;
}