import React, { useEffect, useRef, useState } from "react";
import { rulerTicks } from "./slide-merge-inserts.mjs";
import { guidePosition } from "./slide-merge-guide-core.mjs";

export function CanvasBackdrop({ api }) {
  const [bounds, setBounds] = useState(null);
  useEffect(() => {
    if (!api) return;
    const update = (elements, state) => {
      const frame = elements.find(element => element.id === "lab-slide" && !element.isDeleted);
      if (!frame) { setBounds(null); return; }
      const zoom = state.zoom.value;
      const next = { left:(frame.x + state.scrollX) * zoom, top:(frame.y + state.scrollY) * zoom, right:(frame.x + frame.width + state.scrollX) * zoom, bottom:(frame.y + frame.height + state.scrollY) * zoom };
      setBounds(previous => previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
    };
    update(api.getSceneElements(), api.getAppState());
    return api.onChange(update);
  }, [api]);
  return <><div className="merge-canvas-backdrop" aria-hidden="true" style={{clipPath:bounds ? `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${bounds.left}px ${bounds.top}px,${bounds.right}px ${bounds.top}px,${bounds.right}px ${bounds.bottom}px,${bounds.left}px ${bounds.bottom}px,${bounds.left}px ${bounds.top}px)` : undefined}} />{bounds && <div className="merge-view-frame" aria-hidden="true" style={{left:bounds.left,top:bounds.top,width:bounds.right-bounds.left,height:bounds.bottom-bounds.top}} />}</>;
}

export function CanvasGuides({ api, rulers, margins, thirds, guides = [], onGuides, disabled }) {
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const root=useRef(null),drag=useRef(null);
  const [preview,setPreview]=useState(null);
  useEffect(() => api?.onChange((elements, state) => {
    const next = { zoom: state.zoom.value, x: state.scrollX, y: state.scrollY };
    setCamera(previous => previous.zoom === next.zoom && previous.x === next.x && previous.y === next.y ? previous : next);
  }), [api]);
  function position(event,axis) { const box=root.current.getBoundingClientRect(); return guidePosition(axis==="x"?event.clientX:event.clientY,axis==="x"?box.left:box.top,camera.zoom,axis==="x"?1280:720); }
  function start(event,axis,guide) { if(disabled||event.button!==0)return;event.preventDefault();event.stopPropagation();drag.current={id:guide?.id||crypto.randomUUID(),axis};setPreview({...drag.current,position:position(event,axis)});event.currentTarget.setPointerCapture(event.pointerId); }
  function finish(event,cancel=false) { if(!drag.current)return;const guide={...drag.current,position:position(event,drag.current.axis)};drag.current=null;setPreview(null);if(!cancel)onGuides([...guides.filter(item=>item.id!==guide.id),...(guide.position===null?[]:[guide])]);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId); }
  const handlers={onPointerMove:event=>{if(drag.current)setPreview({...drag.current,position:position(event,drag.current.axis)});},onPointerUp:event=>finish(event),onPointerCancel:event=>finish(event,true),onLostPointerCapture:()=>{drag.current=null;setPreview(null);}};
  function addKey(event,axis) { if(!disabled&&["Enter"," "].includes(event.key)){event.preventDefault();onGuides([...guides,{id:crypto.randomUUID(),axis,position:axis==="x"?640:360}]);} }
  if (!rulers && !margins && !thirds && !guides.length) return null;
  const shown=guides.map(item=>item.id===preview?.id&&preview.position!=null?preview:item);
  if(preview?.position!=null&&!guides.some(item=>item.id===preview.id))shown.push(preview);
  return <div className="merge-guides" ref={root} style={{ left: camera.x * camera.zoom, top: camera.y * camera.zoom, width: 1280 * camera.zoom, height: 720 * camera.zoom }}>
    {rulers && <><div className="merge-ruler merge-ruler-x" role="button" tabIndex={0} aria-label="Add horizontal guide" title="Drag to add a horizontal guide" onPointerDown={event=>start(event,"y")} onKeyDown={event=>addKey(event,"y")} {...handlers}>{rulerTicks(1280).map(value => <span key={value} style={{ left: `${value / 1280 * 100}%` }}>{value}</span>)}</div><div className="merge-ruler merge-ruler-y" role="button" tabIndex={0} aria-label="Add vertical guide" title="Drag to add a vertical guide" onPointerDown={event=>start(event,"x")} onKeyDown={event=>addKey(event,"x")} {...handlers}>{rulerTicks(720).map(value => <span key={value} style={{ top: `${value / 720 * 100}%` }}>{value}</span>)}</div></>}
    {shown.map(guide=><div key={guide.id} role="slider" aria-label={`${guide.axis==="x"?"Vertical":"Horizontal"} guide`} aria-orientation={guide.axis==="x"?"horizontal":"vertical"} aria-valuemin={0} aria-valuemax={guide.axis==="x"?1280:720} aria-valuenow={guide.position} tabIndex={0} title={`${guide.position}px - drag to move; Delete to remove`} className={`merge-custom-guide merge-custom-guide-${guide.axis}`} style={{[guide.axis==="x"?"left":"top"]:`${guide.position/(guide.axis==="x"?1280:720)*100}%`}} onPointerDown={event=>start(event,guide.axis,guide)} onKeyDown={event=>{if(disabled)return;if(["Delete","Backspace"].includes(event.key)){event.preventDefault();onGuides(guides.filter(item=>item.id!==guide.id));}else if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();const delta=(["ArrowLeft","ArrowUp"].includes(event.key)?-1:1)*(event.shiftKey?10:1);onGuides(guides.map(item=>item.id===guide.id?{...item,position:Math.max(0,Math.min(guide.axis==="x"?1280:720,item.position+delta))}:item));}}} {...handlers} />)}
    {margins && <div className="merge-safe-margin" />}
    {thirds && <>{[1, 2].map(part => <React.Fragment key={part}><div className="merge-guide-x" style={{ left: `${part / 3 * 100}%` }} /><div className="merge-guide-y" style={{ top: `${part / 3 * 100}%` }} /></React.Fragment>)}</>}
  </div>;
}