const forwardedEvents = new WeakSet();
const controls = 'a[href],button,input,textarea,select,summary,video[controls],audio[controls],[role="button"],[role="slider"],[role="tab"],[role="checkbox"],[role="switch"],[role="link"],[role="menuitem"],[role="radio"],[role="combobox"],[contenteditable="true"],[data-pjhref],[data-pjjump],[data-zoom],[data-cmp],.pjb__cmp,.pjb__iso-layer,[data-focus-open],figure.rt__fig img,.pjb__prose img,.pjx__img,[data-rk-fx="orbit"],[data-rk-fx="spin"]';

function frameDocument(element) {
  try { return element.contentDocument?.documentElement ? element.contentDocument : null; } catch { return null; }
}

function elementMatrix(element) {
  const view = element.ownerDocument.defaultView;
  const bounds = element.getBoundingClientRect();
  const width = element.offsetWidth, height = element.offsetHeight;
  if (!width || !height || !bounds.width || !bounds.height) return null;
  const quad = element.getBoxQuads?.()[0];
  if (quad) return new view.DOMMatrix([(quad.p2.x - quad.p1.x) / width, (quad.p2.y - quad.p1.y) / width, (quad.p4.x - quad.p1.x) / height, (quad.p4.y - quad.p1.y) / height, quad.p1.x, quad.p1.y]);
  let matrix = new view.DOMMatrix();
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    if (style.perspective && style.perspective !== "none") return null;
    let local = new view.DOMMatrix();
    const zoom = parseFloat(style.zoom);
    if (zoom > 0) local = local.scale(zoom);
    if (style.rotate && style.rotate !== "none") {
      const match = /^(-?[\d.]+)(deg|rad|turn)$/.exec(style.rotate);
      if (!match) return null;
      const degrees = Number(match[1]) * (match[2] === "rad" ? 180 / Math.PI : match[2] === "turn" ? 360 : 1);
      local = local.rotate(degrees);
    }
    if (style.scale && style.scale !== "none") {
      const [horizontal, vertical = horizontal] = style.scale.split(/\s+/).map(Number);
      local = local.scale(horizontal, vertical);
    }
    const transform = new view.DOMMatrix(style.transform === "none" ? undefined : style.transform);
    if (!transform.is2D) return null;
    local = local.multiply(transform);
    matrix = local.multiply(matrix);
    if (ancestor.matches(":fullscreen")) break;
  }
  const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y, y: matrix.b * x + matrix.d * y }));
  return new view.DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, bounds.left - Math.min(...corners.map(point => point.x)), bounds.top - Math.min(...corners.map(point => point.y))]);
}

function framePath(root, document) {
  const path = [];
  while (document !== root.ownerDocument) {
    let element;
    try { element = document.defaultView?.frameElement; } catch { return null; }
    if (!element?.isConnected || frameDocument(element) !== document || path.length >= 8) return null;
    path.unshift(element);
    document = element.ownerDocument;
  }
  return !path.length || root.contains(path[0]) ? path : null;
}

export function presentationContains(root, target) {
  if (!target?.isConnected) return false;
  return target.ownerDocument === root.ownerDocument ? root.contains(target) : framePath(root, target.ownerDocument) !== null;
}

export function presentationSurface(root) {
  const fullscreen = root.ownerDocument.fullscreenElement;
  return fullscreen && presentationContains(root, fullscreen) ? fullscreen : root;
}

export function presentationPoint(root, document, x, y) {
  const path = framePath(root, document);
  if (!path) return null;
  for (const element of path) {
    const matrix = elementMatrix(element);
    if (!matrix) return null;
    const point = matrix.inverse().transformPoint({ x, y });
    x = point.x - element.clientLeft; y = point.y - element.clientTop;
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function presentationRootPoint(root, document, x, y) {
  const path = framePath(root, document);
  if (!path) return null;
  for (const element of path.reverse()) {
    const matrix = elementMatrix(element);
    if (!matrix) return null;
    const point = matrix.transformPoint({ x: x + element.clientLeft, y: y + element.clientTop });
    x = point.x; y = point.y;
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function presentationControl(target) {
  const control = target?.closest(controls);
  return control && !control.closest(':disabled,[aria-disabled="true"],[inert]') ? control : null;
}

export function presentationHit(root, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let document = root.ownerDocument, target = document.elementFromPoint(x, y);
  if (!target || !root.contains(target)) return null;
  let point = { x, y }, depth = 0;
  while (target?.tagName === "IFRAME" && depth++ < 8) {
    const child = frameDocument(target);
    if (!child) return { target, document, ...point, rootX: x, rootY: y, control: null, blocked: true };
    const next = presentationPoint(root, child, x, y);
    if (!next) return null;
    document = child; point = next; target = document.elementFromPoint(point.x, point.y);
  }
  if (!target) return null;
  return { target, document, ...point, rootX: x, rootY: y, control: presentationControl(target), disabled: !!target.closest(':disabled,[aria-disabled="true"],[inert]'), blocked: target.tagName === "IFRAME" };
}

export function dispatchPresenterInput(target, type, options = {}) {
  const view = target.ownerDocument.defaultView;
  const Constructor = type.startsWith("pointer") ? view.PointerEvent : type.startsWith("key") ? view.KeyboardEvent : type === "wheel" ? view.WheelEvent : view.MouseEvent;
  const event = new Constructor(type, { bubbles: true, cancelable: true, composed: true, ...options });
  forwardedEvents.add(event);
  return target.dispatchEvent(event);
}

export function isPresenterInput(event) { return forwardedEvents.has(event); }

export function presentationHover(root, previous, next, options = {}) {
  if (previous?.target === next?.target) return;
  const ancestors = hit => {
    const elements = [];
    for (let element = hit?.target; element && presentationContains(root, element); element = element.parentElement) elements.push(element);
    return elements;
  };
  const leaving = ancestors(previous), entering = ancestors(next);
  const related = (hit, other) => hit?.document === other?.document ? other.target : null;
  if (leaving.length) {
    const position = presentationPoint(root, previous.document, next?.rootX ?? previous.rootX, next?.rootY ?? previous.rootY) || previous;
    const detail = { ...options, clientX: position.x, clientY: position.y, relatedTarget: related(previous, next) };
    dispatchPresenterInput(previous.target, "pointerout", detail);
    dispatchPresenterInput(previous.target, "mouseout", detail);
    for (const element of leaving.filter(element => !entering.includes(element))) {
      dispatchPresenterInput(element, "pointerleave", { ...detail, bubbles: false });
      dispatchPresenterInput(element, "mouseleave", { ...detail, bubbles: false });
    }
  }
  if (entering.length) {
    const detail = { ...options, clientX: next.x, clientY: next.y, relatedTarget: related(next, previous) };
    dispatchPresenterInput(next.target, "pointerover", detail);
    dispatchPresenterInput(next.target, "mouseover", detail);
    for (const element of entering.filter(element => !leaving.includes(element)).reverse()) {
      dispatchPresenterInput(element, "pointerenter", { ...detail, bubbles: false });
      dispatchPresenterInput(element, "mouseenter", { ...detail, bubbles: false });
    }
  }
}

export function observePresentationDocuments(root, connect) {
  const subscriptions = new Map();
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    const reachable = new Map();
    const visit = (scope, depth = 0) => {
      const document = scope.ownerDocument || scope;
      if (reachable.has(document) || depth > 8) return;
      reachable.set(document, scope);
      for (const element of scope.querySelectorAll("iframe")) { const child = frameDocument(element); if (child) visit(child, depth + 1); }
    };
    visit(root);
    for (const [document, cleanup] of subscriptions) if (!reachable.has(document)) { cleanup(); subscriptions.delete(document); }
    for (const [document, scope] of reachable) if (!subscriptions.has(document)) {
      const cleanup = connect(document);
      const observer = new document.defaultView.MutationObserver(records => {
        if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.tagName === "IFRAME" || node.querySelector?.("iframe"))))) refresh();
      });
      observer.observe(scope, { childList: true, subtree: true });
      scope.addEventListener("load", refresh, true);
      subscriptions.set(document, () => { observer.disconnect(); scope.removeEventListener("load", refresh, true); cleanup?.(); });
    }
  };
  refresh();
  return () => { disposed = true; for (const cleanup of subscriptions.values()) cleanup(); subscriptions.clear(); };
}

export function presentationMedia(root) {
  const media = [];
  const visit = (scope, depth = 0) => {
    if (depth > 8) return;
    for (const element of scope.querySelectorAll("video,audio,iframe")) {
      if (element.tagName === "IFRAME") { const child = frameDocument(element); if (child && element.getClientRects().length) visit(child, depth + 1); }
      else if (element.getClientRects().length) media.push(element);
    }
  };
  visit(root);
  return media.find(element => element.controls) || media[0] || null;
}