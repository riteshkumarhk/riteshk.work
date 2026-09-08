import React, { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { PROPERTY_LAYOUTS, BACKGROUNDS, TRANSITIONS } from "./slide-merge-properties.mjs";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import "../../css/slide-merge-properties.css";

export function SlideProperties({ settings, disabled, onLayout, onBackground, onMedia, onTransition }) {
  const input=useRef(null);
  const [expanded,setExpanded]=useState(()=>innerWidth>900);
  const [color,setColor]=useState("#ffffff"),[picker,setPicker]=useState(false);
  useEffect(()=>setColor(settings.background?.color || "#ffffff"),[settings.background]);
  return <aside className="merge-slide-properties" aria-label="Slide properties" onKeyDown={event=>event.stopPropagation()}>
    <button className="merge-properties-heading" aria-label="Slide properties panel" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><h2>Slide</h2><span aria-hidden="true">{expanded?"−":"+"}</span></button>
    <div hidden={!expanded}>
    <details open><summary>Layout</summary><div className="merge-layout-grid">{PROPERTY_LAYOUTS.map(layout=><button type="button" key={layout.id} disabled={disabled} aria-pressed={settings.layout===layout.id} title={layout.name} onClick={()=>onLayout(layout.id)}><span className="merge-layout-thumb" aria-hidden="true">{layout.slots.map((slot,index)=><span key={index} className={slot.kind==="media"?"is-media":""} style={{left:`${slot.x}%`,top:`${slot.y}%`,width:`${slot.width}%`,height:`${slot.height}%`}} />)}{!layout.slots.length&&<em>Blank</em>}</span><span>{layout.name}</span></button>)}</div></details>
    <details open><summary>Background</summary><div className="merge-background-swatches">{BACKGROUNDS.map(([value,name])=><button type="button" key={value} disabled={disabled} title={name} aria-label={name} aria-pressed={value==="transparent"?!settings.background:settings.background?.color===value} className={value==="transparent"?"is-none":""} style={{backgroundColor:value}} onClick={()=>onBackground(value==="transparent"?null:{type:"color",color:value})} />)}<button type="button" className="merge-custom-color" disabled={disabled} title="Custom background colour" aria-label="Custom background colour" aria-expanded={picker} onClick={()=>setPicker(!picker)} /></div>
      {picker&&<div className="merge-background-picker"><HexColorPicker color={/^#[\da-f]{6}$/i.test(color)?color:"#ffffff"} onChange={setColor} /><label>Hex<input aria-label="Background hex colour" value={color} onChange={event=>setColor(event.target.value)} /></label><button disabled={disabled||!/^#[\da-f]{6}$/i.test(color)} onClick={()=>{onBackground({type:"color",color});setPicker(false);}}>Apply colour</button></div>}
      <button className="merge-background-media" disabled={disabled} onClick={()=>input.current.click()}><ToolIcon name="image" />{settings.background?.type==="media"?"Replace image or video":"Image or video"}</button>
      {settings.background?.type==="media"&&<div className="merge-background-file"><span>{settings.background.name}</span><button disabled={disabled} title="Remove background media" aria-label="Remove background media" onClick={()=>onBackground(null)}><ToolIcon name="trash" /></button></div>}
      <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" onChange={event=>{const file=event.target.files[0];if(file)onMedia(file);event.target.value="";}} />
    </details>
    <label className="merge-transition">Transition in<select aria-label="Transition in" disabled={disabled} value={settings.transition||"fade"} onChange={event=>onTransition(event.target.value)}>{TRANSITIONS.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
    </div>
  </aside>;
}