import { createInkMesh, createInkRenderer } from './ai-ribbon-ink.mjs';
import { createGoldMesh, createGoldRenderer, createGlassPass } from './ai-ribbon-gold.mjs';

export const AI_OPTICS = Object.freeze({
  compact:{width:1.7,track:.1,floor:.18,power:1.1},
  tile:{width:1.55,track:.07,floor:.1,power:1.3},
  review:{width:1.5,track:.06,floor:.08,power:1.4}
});

export function createAiVisual(canvas,{style,orb,profile,colours,onFailure}) {
  if (style==='3d') {
    const mesh=createGoldMesh();
    let renderer,disposed=false;
    const dispose=()=>{ if (disposed) return; disposed=true; renderer?.dispose(); canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext(); };
    try {
      renderer=createGoldRenderer(canvas,onFailure,orb);
      return {paint:(state,seconds)=>{ if (!disposed) renderer.draw(mesh.update(state,seconds)); },dispose};
    } catch (error) { dispose(); throw error; }
  }
  const mesh=createInkMesh();
  if (!orb) {
    let renderer,disposed=false;
    const dispose=()=>{ if (disposed) return; disposed=true; renderer?.dispose(); canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); };
    try {
      renderer=createInkRenderer(canvas,profile,colours,onFailure);
      return {paint:state=>{ if (!disposed) renderer.draw(mesh.update(state)); },dispose};
    } catch (error) { dispose(); throw error; }
  }
  const doc=canvas.ownerDocument, source=doc.createElement('canvas'), scene=doc.createElement('canvas');
  const context=scene.getContext('2d');
  if (!context) throw new Error('The liquid glass scene is unavailable.');
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,premultipliedAlpha:true,powerPreference:'low-power'});
  if (!gl) throw new Error('WebGL is unavailable.');
  let ink,glass,time=0,disposed=false,checked=false;
  const lost=()=>onFailure(new Error('The liquid glass graphics context was lost.'));
  const dispose=()=>{
    if (disposed) return;
    disposed=true; canvas.removeEventListener('webglcontextlost',lost);
    ink?.dispose(); gl.useProgram(null); gl.bindBuffer(gl.ARRAY_BUFFER,null); gl.bindTexture(gl.TEXTURE_2D,null); glass?.dispose();
    source.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  try {
    ink=createInkRenderer(source,profile,colours,onFailure); glass=createGlassPass(gl);
    canvas.addEventListener('webglcontextlost',lost);
    return {
      paint(state,seconds) {
        if (disposed) return;
        if (gl.isContextLost()) { onFailure(new Error('The liquid glass graphics context was lost.')); return; }
        const size=canvas.getBoundingClientRect().width, ratio=doc.defaultView.devicePixelRatio;
        const pixels=Math.round(size*Math.min(2,ratio)*2);
        if (canvas.width!==pixels || canvas.height!==pixels) {
          canvas.width=canvas.height=scene.width=scene.height=pixels; checked=false;
        }
        time=state.activity===0 ? 0 : time+Math.max(0,Math.min(.05,seconds))*state.activity;
        ink.draw(mesh.update(state),Math.max(132,size));
        if (disposed) return;
        context.clearRect(0,0,pixels,pixels);
        const inside=pixels*(.8*3.2*12/42), inset=(pixels-inside)/2;
        context.drawImage(source,inset,inset,inside,inside);
        glass.begin(pixels); glass.upload(scene); gl.viewport(0,0,pixels,pixels);
        glass.draw(size<=32,{time,activity:state.activity});
        if (!checked) {
          const error=gl.getError();
          if (error!==gl.NO_ERROR) throw new Error('Liquid glass upload failed: '+error);
          checked=true;
        }
      },
      dispose
    };
  } catch (error) { dispose(); throw error; }
}
