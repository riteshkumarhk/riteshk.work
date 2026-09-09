import { installPresenterPanel } from '../../src/js/presenter-panel.mjs';
const bridge = window.chrome.webview;
const preview = document.querySelector('[data-pp-now]');
preview.id = 'preview'; preview.tabIndex = 0; preview.setAttribute('aria-label','Live presentation');
const notes = document.querySelector('[data-pp-notes]'); notes.id = 'notes';
document.querySelector('[data-pp-count]').id = 'count';
document.querySelector('[data-pp-timer]').id = 'timer';
document.querySelector('[data-pp="prev"]').id = 'prev';
document.querySelector('[data-pp="next"]').id = 'next';
for (const button of document.querySelectorAll('[data-pp]')) button.dataset.command=button.dataset.pp;
document.querySelector('[data-pp="timer-reset"]').dataset.command = 'timer-reset';
document.querySelector('[data-pp="exit"]').dataset.command = 'exit';
document.querySelector('[data-pp-live]').hidden = true;
document.querySelector('[data-pp="fullscreen"]').hidden = true;
document.querySelector('[data-pp-status]').textContent = 'Capture exclusion enabled';
document.querySelector('[data-pp-status]').dataset.state = 'live';
document.querySelector('[data-pp-privacy]').textContent = 'Verify the meeting feed before showing private notes.';
let state = null, received = 0, pendingMove = null, animation = 0;
const send = message => bridge.postMessage(message);
function place() { const rect = preview.getBoundingClientRect(); send({type:'rect',left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,visible:!document.querySelector('[data-pp-overview]').open}); }
const panel = installPresenterPanel({ doc:document, onCommand: command => send({type:'command',command}),
  storage:{getItem:()=>null,setItem:(key,value)=>send({type:'preference',key,value})},
  onEdit: (index,key,value) => { if (state?.editable) { panel.saved('Saving...'); send({type:'command',command:'edit',index,key,value}); } },
  onJump: index => send({type:'command',command:'jump',index}), onResize:place,
  renderThumbnail: (container,index) => { container.dataset.nativeThumb=index; renderThumbnail(container,index); }
});
function renderThumbnail(container,index) {
  const slide=state.slides[index];
  const source=slide?.thumbnail||slide?.document||'';
  if(container._thumbnail!==source) {
    container._thumbnail=source; container.replaceChildren();
    if(slide?.thumbnail) { const image=document.createElement('img');image.style.cssText='width:100%;height:100%;object-fit:contain';image.alt='';image.src=slide.thumbnail;container.appendChild(image); }
    else if(slide?.document) { const frame=document.createElement('iframe');frame.setAttribute('sandbox','');frame.tabIndex=-1;frame.title=slide.title;frame.style.cssText='width:1280px;height:720px;border:0;transform-origin:top left;pointer-events:none';frame.srcdoc=slide.document;container.appendChild(frame); }
  }
  if(container.firstChild?.tagName==='IFRAME') container.firstChild.style.transform='scale('+container.clientWidth/1280+')';
}
function format(ms) { const seconds = Math.max(0,Math.floor(ms/1000)); return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'); }
function tick() { if (!state) return; const delta = state.paused ? 0 : Date.now()-received; panel.tick({...state,elapsed:state.elapsed+delta,remaining:state.remaining-delta,format}); }
bridge.addEventListener('message', event => {
  if(event.data.type==='preferences') { panel.restorePreferences(event.data.values); return; }
  if(event.data.type!=='state') return;
  state=event.data; received=Date.now();
  panel.update(state); tick(); notes.readOnly=!state.editable; document.querySelector('[data-pp-minutes]').disabled=!state.editable;
  if(state.saveStatus) panel.saved(state.saveStatus);
  const next = document.querySelector('[data-pp-next]'); next.style.display = state.index+1<state.total?'':'none';
  renderThumbnail(next,state.index+1);
  document.querySelectorAll('[data-native-thumb]').forEach(container=>renderThumbnail(container,Number(container.dataset.nativeThumb)));
  document.querySelector('[data-pp-nexttitle]').textContent=state.nextTitle||'End of deck';
  preview.parentElement.style.aspectRatio=state.width+'/'+state.height; place();
});
function pointer(event,kind) { const rect=preview.getBoundingClientRect();return {type:'input',kind,x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height,buttons:event.buttons,deltaX:event.deltaX||0,deltaY:event.deltaY||0}; }
function flush() { if(pendingMove)send(pendingMove);pendingMove=null;animation=0; }
preview.addEventListener('pointermove',event=>{pendingMove=pointer(event,'mouseMoved');if(!animation)animation=requestAnimationFrame(flush);});
preview.addEventListener('pointerdown',event=>{if(event.button!==0)return;flush();preview.focus();preview.setPointerCapture(event.pointerId);send(pointer(event,'mousePressed'));});
preview.addEventListener('pointerup',event=>{if(event.button!==0)return;flush();send(pointer(event,'mouseReleased'));preview.releasePointerCapture(event.pointerId);});
preview.addEventListener('pointercancel',event=>{send({...pointer(event,'mouseReleased'),buttons:0});send({type:'command',command:'pointer-leave'});});
preview.addEventListener('pointerleave',()=>{flush();send({type:'command',command:'pointer-leave'});});
window.addEventListener('blur',()=>send({type:'command',command:'pointer-leave'}));
preview.addEventListener('wheel',event=>{event.preventDefault();send(pointer(event,'mouseWheel'));},{passive:false});
for(const type of ['keydown','keyup'])preview.addEventListener(type,event=>{if(event.key==='Tab')return;event.preventDefault();send({type:'input',kind:type==='keydown'?'keyDown':'keyUp',key:event.key,code:event.code,keyCode:event.keyCode});});
new ResizeObserver(place).observe(preview);
new MutationObserver(place).observe(document.querySelector('[data-pp-overview]'),{attributes:true,attributeFilter:['open']});
setInterval(tick,250);
send({type:'ready'});