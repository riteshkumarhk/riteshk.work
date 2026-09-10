export function createPresenterLaser(container, preview = false) {
  const doc = container.ownerDocument, view = doc.defaultView;
  const element = doc.createElement("div");
  element.className = "pjp__pointer" + (preview ? " pjp__pointer--preview" : "");
  element.setAttribute("aria-hidden", "true");
  element.hidden = true;
  element.innerHTML = '<canvas class="pjp__pointer-trail" width="160" height="160"></canvas><svg viewBox="0 0 24 28"><path d="M3 2v21l5-5 4 8 4-2-4-8h8Z"/></svg>';
  container.appendChild(element);
  const canvas = element.firstElementChild, context = canvas.getContext("2d");
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let position = null, target = null, samples = [], animation = 0, previousTime = 0, pixelRatio = 0, disposed = false;
  function clear() { context?.clearRect(0, 0, 160, 160); }
  function place() { element.style.left = position.x + "px"; element.style.top = position.y + "px"; }
  function trim(now) {
    samples = samples.filter(sample => now - sample.time < 140).slice(-24);
    let length = 0;
    for (let index = samples.length - 1; index > 0; index--) {
      const current = samples[index], previous = samples[index - 1];
      const distance = Math.hypot(previous.x - current.x, previous.y - current.y);
      if (length + distance > 56) {
        const fraction = (56 - length) / distance;
        samples[index - 1] = { x: current.x + (previous.x - current.x) * fraction, y: current.y + (previous.y - current.y) * fraction, time: current.time + (previous.time - current.time) * fraction };
        samples.splice(0, index - 1);
        break;
      }
      length += distance;
    }
  }
  function paint(now) {
    if (!context) return;
    const ratio = Math.min(2, view.devicePixelRatio || 1);
    if (pixelRatio !== ratio) {
      pixelRatio = ratio;
      canvas.width = canvas.height = Math.round(160 * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    clear();
    const path = [];
    for (let index = 1; index < samples.length; index++) {
      const sample = samples[index], previous = samples[index - 1], next = samples[index + 1] || sample;
      const startX = index === 1 ? previous.x : (previous.x + sample.x) / 2;
      const startY = index === 1 ? previous.y : (previous.y + sample.y) / 2;
      const endX = (sample.x + next.x) / 2, endY = (sample.y + next.y) / 2;
      if (!path.length) path.push({ x: startX, y: startY, time: previous.time });
      const steps = Math.max(2, Math.ceil((Math.hypot(sample.x - startX, sample.y - startY) + Math.hypot(endX - sample.x, endY - sample.y)) / 2));
      for (let step = 1; step <= steps; step++) {
        const fraction = step / steps, remaining = 1 - fraction;
        path.push({ x: remaining * remaining * startX + 2 * remaining * fraction * sample.x + fraction * fraction * endX, y: remaining * remaining * startY + 2 * remaining * fraction * sample.y + fraction * fraction * endY, time: previous.time + (sample.time - previous.time) * fraction });
      }
    }
    if (path.length < 2) return;
    const edges = path.map((sample, index) => {
      const previous = path[Math.max(0, index - 1)], next = path[Math.min(path.length - 1, index + 1)];
      const distance = Math.hypot(next.x - previous.x, next.y - previous.y) || 1;
      const strength = index / (path.length - 1) * Math.max(0, 1 - (now - sample.time) / 140);
      return { x: 80 + sample.x - position.x, y: 80 + sample.y - position.y, normalX: (previous.y - next.y) / distance * strength, normalY: (next.x - previous.x) / distance * strength };
    });
    function ribbon(width) {
      context.beginPath();
      for (const edge of edges) context.lineTo(edge.x + edge.normalX * width, edge.y + edge.normalY * width);
      for (let index = edges.length - 1; index >= 0; index--) context.lineTo(edges[index].x - edges[index].normalX * width, edges[index].y - edges[index].normalY * width);
      context.closePath();
      context.fill();
    }
    const first = edges[0], last = edges[edges.length - 1];
    const glow = context.createLinearGradient(first.x, first.y, last.x, last.y);
    glow.addColorStop(0, "rgba(255,55,75,0)"); glow.addColorStop(0.4, "rgba(255,55,75,.3)"); glow.addColorStop(1, "rgba(255,55,75,.85)");
    context.fillStyle = glow; context.shadowColor = "rgba(255,55,75,.35)"; context.shadowBlur = 4;
    ribbon(2.2);
    const core = context.createLinearGradient(first.x, first.y, last.x, last.y);
    core.addColorStop(0, "rgba(255,210,218,0)"); core.addColorStop(1, "rgba(255,210,218,.7)");
    context.fillStyle = core; context.shadowBlur = 0;
    ribbon(0.5);
  }
  function animate(now) {
    animation = 0;
    if (!target || disposed) return;
    const elapsed = Math.max(0, now - previousTime);
    previousTime = now;
    const blend = 1 - Math.exp(-elapsed / 24);
    position.x += (target.x - position.x) * blend;
    position.y += (target.y - position.y) * blend;
    const moving = Math.hypot(target.x - position.x, target.y - position.y) > 0.1;
    if (!moving) position = { ...target };
    const last = samples[samples.length - 1];
    if (!last || Math.hypot(position.x - last.x, position.y - last.y) > 0.1) samples.push({ ...position, time: now });
    trim(now);
    place();
    paint(now);
    if (moving || samples.length > 1) animation = view.requestAnimationFrame(animate);
    else { samples = []; clear(); }
  }
  function point(x, y, control = false) {
    if (disposed) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { hide(); return; }
    const snap = !position || element.hidden || control || element.classList.contains("is-control") || motion.matches;
    target = { x, y };
    element.hidden = false;
    element.classList.toggle("is-control", control);
    if (snap) {
      view.cancelAnimationFrame(animation); animation = 0;
      position = { ...target }; samples = [];
      place(); clear();
    } else if (!animation) {
      previousTime = view.performance.now();
      samples = [{ ...position, time: previousTime }];
      animation = view.requestAnimationFrame(animate);
    }
  }
  function hide() {
    view.cancelAnimationFrame(animation); animation = 0;
    target = position = null; samples = [];
    element.hidden = true;
    clear();
  }
  function onMotion() { if (target && motion.matches) point(target.x, target.y, element.classList.contains("is-control")); }
  motion.addEventListener("change", onMotion);
  return { element, point, hide, dispose() { disposed = true; hide(); motion.removeEventListener("change", onMotion); element.remove(); } };
}

export function installPresenterPointer(stage, frame, remoteInput = false) {
  const doc = stage.ownerDocument, view = doc.defaultView;
  const laser = createPresenterLaser(stage);
  stage.classList.add("pjp--laser");
  const interactive = 'a,button,input,textarea,select,summary,video[controls],audio[controls],iframe,[role="button"],[role="slider"],[contenteditable="true"],[data-pjhref],[data-pjjump]';
  function hide() { laser.hide(); stage.removeAttribute("data-pointer"); }
  function point(x, y, remote = false) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { hide(); return; }
    const target = doc.elementFromPoint(x, y);
    if (!target || !frame.contains(target)) { hide(); return; }
    const control = !!target.closest(interactive);
    if (control && !remote) laser.hide(); else laser.point(x, y, control);
    stage.dataset.pointer = control ? "control" : "laser";
  }
  function move(event) { point(event.clientX, event.clientY, remoteInput); }
  function onVisibility() { if (doc.hidden) hide(); }
  stage.addEventListener("pointermove", move);
  stage.addEventListener("pointerleave", hide);
  view.addEventListener("blur", hide);
  view.addEventListener("resize", hide);
  doc.addEventListener("visibilitychange", onVisibility);
  hide();
  return { point, hide, dispose() { stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerleave", hide); view.removeEventListener("blur", hide); view.removeEventListener("resize", hide); doc.removeEventListener("visibilitychange", onVisibility); hide(); laser.dispose(); stage.classList.remove("pjp--laser"); } };
}