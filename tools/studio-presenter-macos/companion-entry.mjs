import { installPresenterPanel } from '../../src/js/presenter-panel.mjs';
const send = message => window.webkit.messageHandlers.presenter.postMessage(message);
const preview = document.querySelector('[data-pp-now]');
const image = document.createElement('img');
image.alt = 'Audience preview'; image.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none';
preview.appendChild(image);
document.querySelector('[data-pp-live]').hidden = true;
document.querySelector('[data-pp=fullscreen]').hidden = true;
document.querySelector('[data-pp-status]').textContent = 'Audience window sharing only';
document.querySelector('[data-pp-privacy]').textContent = 'macOS preview: share only the audience window. Use the audience window for media controls. Whole-display sharing can expose notes.';
let state = null, received = 0;
function thumbnail(container,index) {
  const slide=state?.slides[index], source=slide?.thumbnail||slide?.document||'';
  container.dataset.macThumb=index;
  if(container._source!==source) {
    container._source=source; container.replaceChildren();
    if(slide?.thumbnail) { const thumb=document.createElement('img');thumb.alt='';thumb.src=source;thumb.style.cssText='width:100%;height:100%;object-fit:contain';container.appendChild(thumb); }
    else if(slide?.document) { const frame=document.createElement('iframe');frame.setAttribute('sandbox','');frame.title=slide.title;frame.tabIndex=-1;frame.srcdoc=source;frame.style.cssText='width:1280px;height:720px;border:0;transform-origin:top left;pointer-events:none';container.appendChild(frame); }
  }
  if(container.firstChild?.tagName==='IFRAME') container.firstChild.style.transform='scale('+container.clientWidth/1280+')';
}
const panel = installPresenterPanel({doc:document,
  onCommand:command=>send({type:'command',command}),
  onEdit:(index,key,value)=>{if(state?.editable)send({type:'command',command:'edit',index,key,value});},
  onJump:index=>send({type:'command',command:'jump',index}),
  storage:{getItem:()=>null,setItem:(key,value)=>send({type:'preference',key,value})},
  renderThumbnail:thumbnail,
  onResize:()=>{if(state)document.querySelectorAll('[data-mac-thumb]').forEach(container=>thumbnail(container,Number(container.dataset.macThumb)));}
});
function format(ms) { const seconds=Math.max(0,Math.floor(ms/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'); }
function tick() { if(state){const delta=state.paused?0:Date.now()-received;panel.tick({...state,elapsed:state.elapsed+delta,remaining:state.remaining-delta,format});} }
window.receivePresenter = message => {
  if(message.type==='preferences') {panel.restorePreferences(message.values);return;}
  if(message.type==='snapshot') {image.src=message.image;return;}
  if(message.type==='snapshot-error') {image.removeAttribute('src');return;}
  if(message.type!=='state')return;
  state=message;received=Date.now();panel.update(state);tick();
  document.querySelector('[data-pp-notes]').readOnly=!state.editable;
  document.querySelector('[data-pp-minutes]').disabled=!state.editable;
  panel.saved(state.saveStatus||'');
  preview.parentElement.style.aspectRatio=state.width+'/'+state.height;
  const next=document.querySelector('[data-pp-next]');next.style.display=state.index+1<state.total?'':'none';thumbnail(next,state.index+1);
  document.querySelector('[data-pp-nexttitle]').textContent=state.nextTitle||'End of deck';
  document.querySelectorAll('[data-mac-thumb]').forEach(container=>thumbnail(container,Number(container.dataset.macThumb)));
};
preview.addEventListener('pointermove',event=>{if(!state)return;const rect=preview.getBoundingClientRect();send({type:'pointer',x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});});
preview.addEventListener('pointerleave',()=>send({type:'command',command:'pointer-leave'}));
window.addEventListener('blur',()=>send({type:'command',command:'pointer-leave'}));
setInterval(tick,250);
send({type:'ready'});