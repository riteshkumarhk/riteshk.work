import { observePresentationDocuments, presentationContains } from "./presenter-interaction.mjs";
import { presenterIcon } from "./presenter-panel.mjs";

export function installSlideExpansion(frame) {
  const rootDocument = frame.ownerDocument;
  let active = null;
  const rootApi = rootDocument.defaultView.RK ||= {};
  const previousDismiss = rootApi.dismissSlideMedia;
  const dismiss = () => {
    if (!active || active.overlay) return false;
    restore();
    return true;
  };
  rootApi.dismissSlideMedia = dismiss;
  function restore() {
    if (!active) return;
    const previous = active;
    active = null;
    if (previous.target.__rkPresentationRoot === frame) { delete previous.target.__rkPresentationRoot; previous.target.removeAttribute('data-rk-presentation-overlay'); }
    previous.layer?.remove();
    previous.changes.reverse().forEach(([element, style]) => {
      if (style === null) element.removeAttribute("style"); else element.setAttribute("style", style);
    });
    if (previous.parent && previous.target.isConnected) previous.parent.insertBefore(previous.target, previous.next?.parentNode === previous.parent ? previous.next : null);
    previous.trigger?.focus?.({ preventScroll:true });
  }
  function remember(element, styles) {
    if (!active.changes.some(([saved]) => saved === element)) active.changes.push([element, element.getAttribute("style")]);
    for (const [key,value] of Object.entries(styles)) element.style.setProperty(key,value,"important");
  }
  function fillPath(element, boundary) {
    for (let current = element; current && current !== boundary; current = current.parentElement) {
      remember(current, { position:"absolute", inset:"0", width:"100%", height:"100%", "max-width":"none", "max-height":"none", margin:"0", padding:"0", transform:"none", "clip-path":"none", overflow:"visible", "z-index":"30", "pointer-events":"auto" });
    }
  }
  function expand(target, overlay = false, trigger = target?.ownerDocument.activeElement) {
    if (!target?.isConnected) return false;
    const doc = target.ownerDocument;
    if (doc !== rootDocument && !presentationContains(frame,target)) return false;
    if (!overlay && !presentationContains(frame,target)) return false;
    if (active?.target === target) { if (!overlay) restore(); return true; }
    restore();
    active = { target, overlay, changes:[], trigger };
    if (overlay) { target.__rkPresentationRoot = frame; target.setAttribute('data-rk-presentation-overlay',''); }
    for (let child = doc; child !== rootDocument;) {
      const embedded = child.defaultView.frameElement;
      const parent = embedded.ownerDocument;
      fillPath(embedded, parent === rootDocument ? frame : parent.body);
      child = parent;
    }
    if (overlay) {
      if (doc === rootDocument && !frame.contains(target) && target.tagName !== "DIALOG") {
        active.parent = target.parentElement; active.next = target.nextSibling;
        frame.append(target);
      }
      if (doc === rootDocument) {
        if (target.tagName === "DIALOG") {
          const bounds = frame.getBoundingClientRect();
          remember(target, { position:"fixed", left:bounds.left+"px", top:bounds.top+"px", right:"auto", bottom:"auto", width:bounds.width+"px", height:bounds.height+"px", "max-width":"none", "max-height":"none", margin:"0" });
        } else remember(target, { position:"absolute", inset:"0", width:"100%", height:"100%" });
      }
      return true;
    }
    fillPath(target, doc === rootDocument ? frame : doc.body);
    remember(target, { inset:"44px 0 0", height:"calc(100% - 44px)", "object-fit":"contain", background:"var(--bg,#08080a)", "transform-origin":"center" });
    const layer = doc.createElement("div");
    layer.className = "pjp__expanded";
    layer.setAttribute("role","dialog"); layer.setAttribute("aria-modal","true"); layer.setAttribute("aria-label","Expanded slide media");
    layer.style.cssText = "position:absolute;inset:0;z-index:31;pointer-events:none;overflow:hidden";
    layer.innerHTML = '<div style="height:44px;display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:5px 8px;background:var(--bg,#08080a);pointer-events:auto">' + [["plus","Zoom in"],["minus","Zoom out"],["reset","Reset zoom"],["close","Close expanded media"]].map(([name,label]) => '<button type="button" class="pjp__x" data-expand="'+name+'" aria-label="'+label+'" title="'+label+'" style="width:34px;height:34px;padding:7px">'+presenterIcon(name)+'</button>').join("") + '</div><div data-expand-pan style="position:absolute;inset:44px 0 0;touch-action:none;cursor:grab;pointer-events:none" tabindex="0" aria-label="Pan expanded media"></div>';
    (doc === rootDocument ? frame : doc.body).append(layer);
    active.layer = layer;
    let scale = 1, offsetX = 0, offsetY = 0, drag = null;
    const pan = layer.querySelector("[data-expand-pan]");
    const paint = () => {
      remember(target, { transform:`translate(${offsetX}px,${offsetY}px) scale(${scale})` });
      pan.style.pointerEvents = scale > 1 ? "auto" : "none";
    };
    const zoom = factor => { scale = Math.max(1,Math.min(6,scale*factor)); if (scale === 1) offsetX = offsetY = 0; paint(); };
    layer.addEventListener("click", event => {
      const action = event.target.closest("[data-expand]")?.dataset.expand;
      if (action === "close") restore();
      else if (action === "reset") { scale = 1; offsetX = offsetY = 0; paint(); }
      else if (action) zoom(action === "plus" ? 1.4 : 1/1.4);
    });
    pan.addEventListener("wheel", event => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.18 : 1/1.18); }, { passive:false });
    pan.addEventListener("pointerdown", event => { if (event.button !== 0) return; drag = { x:event.clientX,y:event.clientY,offsetX,offsetY }; try { pan.setPointerCapture(event.pointerId); } catch {} });
    pan.addEventListener("pointermove", event => { if (!drag) return; offsetX = drag.offsetX+event.clientX-drag.x; offsetY = drag.offsetY+event.clientY-drag.y; paint(); });
    for (const type of ["pointerup","pointercancel"]) pan.addEventListener(type, () => { drag = null; });
    pan.addEventListener("keydown", event => { const delta = {ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[event.key]; if (!delta) return; event.preventDefault(); offsetX += delta[0]; offsetY += delta[1]; paint(); });
    layer.querySelector("button").focus({preventScroll:true});
    return true;
  }
  const stop = observePresentationDocuments(frame, doc => {
    const api = doc.defaultView.RK ||= {};
    const previous = api.expandSlideMedia;
    api.expandSlideMedia = target => expand(target);
    const saved = new Map();
    const buttons = [];
    let clickedInside = false, clicked = null;
    const click = event => { clickedInside = presentationContains(frame,event.target); if (clickedInside) clicked = event.target; };
    const refresh = () => {
      const scope = doc === rootDocument ? frame : doc;
      for (const media of scope.querySelectorAll("iframe,video")) {
        if (saved.has(media)) continue;
        saved.set(media, [media.getAttribute("allow"), media.hasAttribute("allowfullscreen"), media.getAttribute("controlslist")]);
        if (media.tagName === "IFRAME") { media.removeAttribute("allowfullscreen"); media.setAttribute("allow",(media.getAttribute("allow") || "").split(";").filter(value => !value.trim().startsWith("fullscreen")).concat("fullscreen 'none'").join(";")); }
        else media.controlsList?.add("nofullscreen");
        if (media.tagName === "VIDEO" || media.closest(".pjb__frame,.merge-embed-surface")) {
          const parent = media.parentElement;
          if (!parent.querySelector("[data-fs],[data-slide-expand]")) {
            const button = doc.createElement("button");
            button.type = "button"; button.className = "pjb__fs"; button.dataset.slideExpand = "";
            button.setAttribute("aria-label","Expand media in slide"); button.title = "Expand media in slide";
            button.innerHTML = presenterIcon("fullscreen");
            button.style.cssText = "position:absolute;right:10px;top:10px;z-index:3;width:34px;height:34px;padding:7px;cursor:pointer;opacity:1;transform:none";
            button.addEventListener("click",event => { event.preventDefault(); event.stopPropagation(); expand(media); });
            parent.append(button); buttons.push(button);
          }
        }
      }
      if (active?.target.ownerDocument === doc && (!active.target.isConnected || active.overlay && !active.target.matches(".is-open,dialog[open]"))) restore();
      const viewer = doc.querySelector(".pjx.is-open,.pjfx.is-open,dialog.wf-explorer[open]");
      if (viewer && active?.target !== viewer && (doc !== rootDocument || clickedInside)) expand(viewer,true,clicked);
    };
    const key = event => { if (event.key === "Escape" && active && !active.overlay) { event.preventDefault(); event.stopImmediatePropagation(); restore(); } };
    doc.addEventListener("click",click,true); doc.addEventListener("keydown",key,true);
    const observer = new doc.defaultView.MutationObserver(refresh);
    observer.observe(doc === rootDocument ? doc.body : doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class","open"]});
    refresh();
    return () => {
      observer.disconnect(); doc.removeEventListener("click",click,true); doc.removeEventListener("keydown",key,true);
      buttons.forEach(button => button.remove());
      if (previous) api.expandSlideMedia = previous; else delete api.expandSlideMedia;
      for (const [media,[allow,fullscreen,controls]] of saved) {
        if (allow === null) media.removeAttribute("allow"); else media.setAttribute("allow",allow);
        if (fullscreen) media.setAttribute("allowfullscreen","");
        if (controls === null) media.removeAttribute("controlslist"); else media.setAttribute("controlslist",controls);
      }
    };
  });
  function reset() {
    if (active?.overlay) {
      if (active.target.tagName === "DIALOG") active.target.close();
      else active.target.classList.remove("is-open");
    }
    restore();
  }
  return { reset, dispose() { reset(); stop(); if (rootApi.dismissSlideMedia === dismiss) { if (previousDismiss) rootApi.dismissSlideMedia = previousDismiss; else delete rootApi.dismissSlideMedia; } } };
}