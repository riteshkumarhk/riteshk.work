import { HYBRID_REST_PATH, createHybridMotion } from './ai-ribbon-motion.mjs';
import { AI_APPEARANCE_EVENT, AI_APPEARANCE_KEY, readAiAppearance } from './ai-appearance.mjs';
import { AI_OPTICS, createAiVisual } from './ai-ribbon-visual.mjs';
import { paintTrail, TRAIL_SEGMENTS } from './ai-ribbon-ink.mjs';
export { AI_REST_PATH, HYBRID_REST_PATH, createMotion, createHybridMotion, liquidPoint, ribbonPath } from './ai-ribbon-motion.mjs';

export function aiRibbonIcon({size=18}={}) {
  if (!Number.isFinite(size) || size<=0) throw new Error('AI icon size must be positive.');
  return `<svg class="ai-ribbon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><g class="adm__ai-ribbon-turn"><path data-ai-line d="${HYBRID_REST_PATH}"/></g></svg>`;
}

export function mountAiRibbon(counter,{large=false,appearance,onError}={}) {
  const document=counter.ownerDocument, view=document.defaultView, svg=counter.querySelector('svg.ai-ribbon');
  if (!svg) throw new Error('AI visual requires its SVG fallback.');
  const reduced=view.matchMedia('(prefers-reduced-motion: reduce)');
  const path=svg.querySelector('path'), group=svg.querySelector('g');
  const size=Number(svg.getAttribute('width')) || 18;
  const profile=size<=20 ? AI_OPTICS.compact : size<=32 ? AI_OPTICS.tile : AI_OPTICS.review;
  path.style.strokeWidth=String(profile.width);
  group.insertAdjacentHTML('beforeend','<path data-ai-tail/>'.repeat(TRAIL_SEGMENTS));
  const trails=[...group.querySelectorAll('[data-ai-tail]')];
  trails.forEach(tail=>{ tail.style.strokeWidth=String(profile.width); tail.style.strokeLinecap='butt'; });
  const newCanvas=()=>{
    const value=document.createElement('canvas');
    value.className='ai-ribbon-canvas'; value.setAttribute('aria-hidden','true');
    value.style.width=size+'px'; value.style.height=size+'px'; value.hidden=true; svg.after(value);
    return value;
  };
  let canvas=newCanvas();
  const palette=document.createElement('canvas'); palette.width=palette.height=1;
  const context=palette.getContext('2d',{willReadFrequently:true});
  const colours={accent:[0,0,0],text:[0,0,0]};
  let colourKey='', motion=createHybridMotion(), renderer=null, renderedStyle='', failed=false;
  let frame=0, previous=0, disposed=false, visible=true, observedPhase=counter.dataset.aiState;
  const notify=error=>{
    const message='AI appearance: '+(error?.message || String(error))+' Using the simplified 2D visual.';
    view.console.warn(message); onError?.(message);
  };
  const fallback=error=>{
    if (disposed || failed) return;
    failed=true; renderer?.dispose(); renderer=null;
    canvas.hidden=true; svg.removeAttribute('hidden');
    counter.dataset.aiRenderer='svg'; counter.dataset.aiAppearanceFallback='true';
    notify(error);
  };
  const preference=()=>large ? appearance?.() || readAiAppearance(view) : {style:'2d',orb:false};
  let selected=preference();
  const setColours=()=>{
    const style=view.getComputedStyle(svg), ink=style.color, text=large ? style.getPropertyValue('--text').trim() || ink : ink;
    if (colourKey===ink+'|'+text) return;
    if (!context) throw new Error('Cannot resolve AI icon colours.');
    for (const [key,value] of [['accent',ink],['text',text]]) {
      if (!view.CSS.supports('color',value)) throw new Error('Invalid AI icon colour.');
      context.clearRect(0,0,1,1); context.fillStyle=value; context.fillRect(0,0,1,1);
      colours[key]=[...context.getImageData(0,0,1,1).data].slice(0,3).map(channel=>channel/255);
    }
    colourKey=ink+'|'+text;
  };
  const paint=(state,seconds)=>{
    path.setAttribute('d',state.d);
    path.setAttribute('opacity',profile.track+(1-profile.track)*(1-state.traceOpacity));
    paintTrail(trails,state.d,state,profile);
    if (!large) trails.at(-1).style.stroke='currentColor';
    group.setAttribute('transform',`rotate(${(state.angle*180/Math.PI).toFixed(4)} 12 12)`);
    const key=selected.style+':'+selected.orb;
    if (key!==renderedStyle) {
      renderer?.dispose(); renderer=null; failed=false; renderedStyle=key;
      canvas.remove(); canvas=newCanvas();
      delete counter.dataset.aiAppearanceFallback;
    }
    counter.dataset.aiStyle=selected.style; counter.dataset.aiOrb=String(selected.orb);
    if (!large && state.activity===0) {
      canvas.hidden=true; svg.removeAttribute('hidden'); counter.dataset.aiRenderer='svg';
      return;
    }
    if (failed) return;
    try {
      setColours();
      if (!renderer) {
        renderer=createAiVisual(canvas,{...selected,profile,colours,onFailure:fallback});
      }
      svg.setAttribute('hidden',''); canvas.hidden=false; counter.dataset.aiRenderer='gpu';
      renderer.paint(state,seconds);
    } catch (error) { fallback(error); }
  };
  const tick=now=>{
    frame=0;
    if (disposed) return;
    if (!counter.isConnected) { dispose(); return; }
    if (document.hidden || !visible || !counter.getClientRects().length) return;
    const seconds=previous ? (now-previous)/1000 : 0;
    const phase=counter.dataset.aiState || 'idle';
    const state=motion.step(seconds,phase,reduced.matches); previous=now;
    paint(state,seconds);
    if (!reduced.matches && (phase!=='idle' || state.activity>0)) frame=view.requestAnimationFrame(tick);
  };
  const sync=()=>{
    view.cancelAnimationFrame(frame); frame=0; previous=0;
    if (disposed) return;
    if (!counter.isConnected) { dispose(); return; }
    if (reduced.matches) motion=createHybridMotion();
    if (!document.hidden && visible) frame=view.requestAnimationFrame(tick);
  };
  const observer=new view.MutationObserver(()=>{
    if (counter.dataset.aiState===observedPhase) return;
    observedPhase=counter.dataset.aiState; sync();
  });
  observer.observe(counter,{attributes:true,attributeFilter:['data-ai-state']});
  const removal=new view.MutationObserver(()=>{ if (!counter.isConnected) dispose(); });
  removal.observe(document.documentElement,{childList:true,subtree:true});
  const theme=new view.MutationObserver(sync);
  theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','class','style']});
  const intersection=view.IntersectionObserver ? new view.IntersectionObserver(entries=>{
    const next=entries[0].isIntersecting;
    if (next!==visible) { visible=next; sync(); }
  }) : null;
  intersection?.observe(counter);
  const changed=()=>{ if (large) { selected=preference(); sync(); } };
  const stored=event=>{ if (event.key===AI_APPEARANCE_KEY || event.key===null) changed(); };
  document.addEventListener('visibilitychange',sync); reduced.addEventListener('change',sync);
  view.addEventListener('resize',sync);
  view.addEventListener(AI_APPEARANCE_EVENT,changed); view.addEventListener('storage',stored);
  function dispose() {
    if (disposed) return;
    disposed=true; view.cancelAnimationFrame(frame); renderer?.dispose();
    observer.disconnect(); removal.disconnect(); theme.disconnect(); intersection?.disconnect();
    document.removeEventListener('visibilitychange',sync); reduced.removeEventListener('change',sync);
    view.removeEventListener('resize',sync);
    view.removeEventListener(AI_APPEARANCE_EVENT,changed); view.removeEventListener('storage',stored);
    canvas.remove(); trails.forEach(tail=>tail.remove());
    svg.removeAttribute('hidden');
  }
  sync();
  return {dispose,syncAppearance:changed};
}
