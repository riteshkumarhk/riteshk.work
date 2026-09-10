import { presenterIcon } from "./presenter-panel.mjs";
import { createPresenterLaser } from "./presenter-pointer.mjs";
import { dispatchPresenterInput, presentationContains, presentationHover, presentationMedia, presentationPoint, presentationSurface } from "./presenter-interaction.mjs";
export function requestPresenterCapture() {
  const handle = crypto.randomUUID();
  let cancelled = false, captured = null;
  const result = (async () => {
    try {
      navigator.mediaDevices.setCaptureHandleConfig({ exposeOrigin:true, handle, permittedOrigins:[location.origin] });
      captured = await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:false,selfBrowserSurface:'include',surfaceSwitching:'exclude'});
      if (cancelled) { captured.getTracks().forEach(track=>track.stop()); return { error:new Error('Presentation closed') }; }
      return { stream:captured };
    } catch(error) { return {error}; }
  })();
  return {handle,result,cancel() { cancelled=true;captured?.getTracks().forEach(track=>track.stop()); }};
}
export function installWebPresenterPreview({ frame, pointer, container, presenterWindow, button, status, onDisconnect, captureTicket }) {
  const doc = container.ownerDocument;
  const previewSurface = container.parentElement;
  const localLaser = createPresenterLaser(previewSurface, true);
  const mediaDevices = navigator.mediaDevices;
  const handle = captureTicket?.handle || crypto.randomUUID();
  let stream = null, video = null, canvas = null, stopped = false, pending = false, animation = 0;
  let liveFrame = false, detachTrack = null, pendingTicket = null;
  let pressed = null, focused = null, hovered = null;
  const supported = !!(mediaDevices?.getDisplayMedia && mediaDevices?.setCaptureHandleConfig);
  function connection(state, message) {
    status.dataset.state = state; status.textContent = message;
    const label = state === "live" ? "Disconnect live preview" : state === "connecting" ? "Connecting live preview" : "Retry live preview connection";
    button.title = label; button.setAttribute("aria-label", label);
    button.innerHTML = presenterIcon(state === "live" ? "disconnect" : state === "connecting" ? "connect" : "retry");
  }
  const controls = doc.createElement("div");
  controls.className = "pp__media";
  controls.hidden = true;
  controls.innerHTML = '<button type="button" class="pp__btn" aria-label="Play or pause slide media" title="Play or pause slide media"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="m5 3 14 9-14 9Z"/></svg></button><input type="range" min="0" max="100" step="0.1" value="0" aria-label="Seek slide media">';
  container.parentElement.after(controls);
  const playButton = controls.querySelector("button"), seek = controls.querySelector("input");
  function activeMedia() { return (presentationContains(frame, focused?.target) && focused.target.closest("video,audio")) || presentationMedia(frame); }
  function toggleMedia(media = activeMedia()) {
    if (!media) return;
    if (media.paused) media.play().catch(() => { status.textContent = "Playback blocked. Start this media in the audience window."; });
    else media.pause();
  }
  playButton.addEventListener("click", () => toggleMedia());
  seek.addEventListener("input", () => {
    const media = activeMedia();
    if (media && Number.isFinite(media.duration)) media.currentTime = Number(seek.value) / 100 * media.duration;
  });
  function release() {
    const cancelled = pressed;
    pressed = null;
    if (cancelled && presentationContains(frame, cancelled.target)) dispatchPresenterInput(cancelled.target, "pointercancel", { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: cancelled.x, clientY: cancelled.y });
    if (canvas && cancelled && canvas.hasPointerCapture(cancelled.pointerId)) canvas.releasePointerCapture(cancelled.pointerId);
    presentationHover(frame, hovered, null, { pointerId: 1, pointerType: "mouse", buttons: 0 });
    hovered = null;
    pointer.hide();
    localLaser.hide();
  }
  function stop(message = "Live preview stopped. Pointer remains connected.") {
    release();
    focused = null;
    presenterWindow.cancelAnimationFrame(animation);
    detachTrack?.(); detachTrack = null;
    liveFrame = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; video.remove(); }
    video = null;
    if (canvas) canvas.remove();
    canvas = null;
    controls.hidden = true;
    container.classList.remove("pp__now--live");
    button.disabled = !supported;
    connection("disconnected", message);
    if (!stopped) onDisconnect?.();
  }
  function verified(track) {
    const identity = track?.getCaptureHandle?.();
    return track?.readyState === "live" && track.getSettings().displaySurface === "browser" && identity?.handle === handle && identity.origin === location.origin;
  }
  function coordinates(event) {
    const preview = container.getBoundingClientRect(), bounds = presentationSurface(frame).getBoundingClientRect();
    if (!preview.width || !preview.height || !bounds.width || !bounds.height) return null;
    return { x: bounds.left + (event.clientX - preview.left) / preview.width * bounds.width, y: bounds.top + (event.clientY - preview.top) / preview.height * bounds.height };
  }
  function targetAt(event) {
    if (stopped) return null;
    const position = coordinates(event);
    if (!position) { release(); return null; }
    const hit = pointer.point(position.x, position.y, true);
    if (!hit) { if (!pressed) release(); return null; }
    const control = !!hit.control;
    const surface = previewSurface.getBoundingClientRect();
    if (control || liveFrame) localLaser.hide();
    else localLaser.point(event.clientX - surface.left - previewSurface.clientLeft, event.clientY - surface.top - previewSurface.clientTop);
    previewSurface.style.cursor = control ? "pointer" : "none";
    if (canvas) canvas.style.cursor = control ? "pointer" : "none";
    if (hit.blocked) {
      status.textContent = "Embedded player: use its controls directly in the audience window.";
      return hit;
    }
    if (status.textContent.startsWith("Embedded player:")) status.textContent = stream ? "Live preview" : "Pointer connected";
    return hit;
  }
  function pointPreview(event) { if (event.target !== canvas) targetAt(event); }
  function leavePreview() { if (!pressed) release(); }
  previewSurface.addEventListener("pointermove", pointPreview, true);
  previewSurface.addEventListener("pointerleave", leavePreview);
  presenterWindow.addEventListener("blur", release);
  presenterWindow.addEventListener("resize", release);
  function setRange(target, x) {
    if (!target.matches('input[type="range"]')) return;
    const bounds = target.getBoundingClientRect();
    const min = Number(target.min || 0), max = Number(target.max || 100), step = target.step === "any" ? 0 : Number(target.step || 1);
    let value = min + Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)) * (max - min);
    if (step) value = min + Math.round((value - min) / step) * step;
    target.value = String(Math.max(min, Math.min(max, value)));
    target.dispatchEvent(new target.ownerDocument.defaultView.Event("input", { bubbles: true }));
    target.dispatchEvent(new target.ownerDocument.defaultView.Event("change", { bubbles: true }));
  }
  function modifiers(event) { return { ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey }; }
  function forward(event) {
    if (event.button > 0 && event.type !== "pointermove") return;
    const hit = targetAt(event);
    const options = { ...modifiers(event), button: event.type === "pointermove" ? -1 : 0, buttons: event.buttons, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const actionable = hit && !hit.blocked && !hit.disabled ? hit : null;
    if (!pressed) { presentationHover(frame, hovered, actionable, options); hovered = actionable; }
    if (event.type === "pointerdown") {
      if (!actionable) return;
      event.preventDefault();
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      pressed = { ...hit, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, compatibilityMouse: true };
      focused = hit;
    }
    const destination = pressed || actionable;
    if (!destination) return;
    if (!presentationContains(frame, destination.target)) { release(); return; }
    const rootPoint = coordinates(event);
    const position = rootPoint && presentationPoint(frame, destination.document, rootPoint.x, rootPoint.y);
    if (!position) { release(); return; }
    Object.assign(options, { clientX: position.x, clientY: position.y });
    if (pressed) {
      pressed.x = position.x; pressed.y = position.y;
      pressed.moved ||= Math.hypot(event.clientX - pressed.startX, event.clientY - pressed.startY) > 4;
    }
    const accepted = dispatchPresenterInput(destination.target, event.type, options);
    if (pressed && event.type === "pointerdown") pressed.compatibilityMouse = accepted;
    if (!pressed || pressed.compatibilityMouse) dispatchPresenterInput(destination.target, event.type.replace("pointer", "mouse"), { ...options, button: 0 });
    if (pressed) setRange(pressed.target, position.x);
    if (event.type === "pointerup") {
      const clicked = pressed;
      pressed = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (clicked && !clicked.moved && actionable && (clicked.target === hit.target || clicked.control && clicked.control === hit.control)) {
        if (hit.target.closest("video[controls],audio[controls]")) toggleMedia(hit.target.closest("video,audio"));
        else if (!hit.target.matches('input[type="range"]')) dispatchPresenterInput(hit.target, "click", { ...options, clientX: hit.x, clientY: hit.y, detail: 1 });
        canvas?.focus({ preventScroll: true });
      }
      presentationHover(frame, hovered, actionable, options); hovered = actionable;
    }
  }
  function wheel(event) {
    const hit = targetAt(event);
    if (!hit || hit.blocked) return;
    if (!dispatchPresenterInput(hit.target, "wheel", { ...modifiers(event), clientX: hit.x, clientY: hit.y, deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode })) { event.preventDefault(); event.stopPropagation(); return; }
    for (let scrollable = hit.target; presentationContains(frame, scrollable); scrollable = scrollable.parentElement || scrollable.ownerDocument.defaultView.frameElement) {
      const style = scrollable.ownerDocument.defaultView.getComputedStyle(scrollable);
      const factor = event.deltaMode === 1 ? parseFloat(style.lineHeight) || 16 : event.deltaMode === 2 ? scrollable.clientHeight : 1;
      const horizontal = /auto|scroll/.test(style.overflowX) && scrollable.scrollWidth > scrollable.clientWidth && event.deltaX;
      const vertical = /auto|scroll/.test(style.overflowY) && scrollable.scrollHeight > scrollable.clientHeight && event.deltaY;
      if (horizontal || vertical) {
        event.preventDefault(); event.stopPropagation();
        scrollable.scrollBy({ top: vertical ? event.deltaY * factor : 0, left: horizontal ? event.deltaX * factor : 0, behavior: "instant" });
        return;
      }
      if (scrollable === frame) break;
    }
  }
  function key(event) {
    if (!liveFrame || event.target !== canvas && event.target !== doc.body) return;
    if (!presentationContains(frame, focused?.target)) return;
    const owner = focused.document;
    const modal = [...owner.querySelectorAll('[role="dialog"][aria-modal="true"]')].find(element => presentationContains(frame, element) && !element.hidden && element.getClientRects().length && owner.defaultView.getComputedStyle(element).visibility !== "hidden");
    const target = modal ? modal.contains(owner.activeElement) ? owner.activeElement : modal : focused.control || focused.target;
    if (target.closest(':disabled,[aria-disabled="true"],[inert]')) return;
    const accepted = dispatchPresenterInput(target, "keydown", { ...modifiers(event), key: event.key, code: event.code, repeat: event.repeat });
    let handled = !accepted || !!modal;
    if (accepted && target.matches('input[type="range"]') && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      if (event.key === "Home") target.value = target.min || "0";
      else if (event.key === "End") target.value = target.max || "100";
      else if (target.step !== "any") target[event.key === "ArrowLeft" || event.key === "ArrowDown" ? "stepDown" : "stepUp"]();
      target.dispatchEvent(new owner.defaultView.Event("input", { bubbles: true }));
      target.dispatchEvent(new owner.defaultView.Event("change", { bubbles: true }));
      handled = true;
    } else if (accepted && (event.key === " " || event.key === "Enter") && target.matches('button,summary,a[href],input[type="checkbox"],input[type="radio"],video[controls],audio[controls],[role="button"]')) {
      if (target.matches("video,audio")) toggleMedia(target); else dispatchPresenterInput(target, "click", { detail: 0 });
      handled = true;
    }
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }
  function paint() {
    if (!stream || !canvas || !video) return;
    const track = stream.getVideoTracks()[0];
    if (!verified(track)) { stop("Preview disconnected: the captured tab changed."); return; }
    const bounds = presentationSurface(frame).getBoundingClientRect();
    const ratio = video.videoWidth / window.innerWidth;
    const verticalRatio = video.videoHeight / window.innerHeight;
    const width = Math.max(1, Math.round(container.clientWidth * (presenterWindow.devicePixelRatio || 1)));
    const height = Math.max(1, Math.round(width * bounds.height / (bounds.width || 1)));
    if (bounds.width > 0 && bounds.height > 0) container.parentElement.style.aspectRatio = bounds.width + " / " + bounds.height;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    const drawable = !track.muted && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && bounds.width > 0 && bounds.height > 0;
    if (drawable) {
      try { context.drawImage(video, bounds.left * ratio, bounds.top * verticalRatio, bounds.width * ratio, bounds.height * verticalRatio, 0, 0, width, height); }
      catch { stop("Live frames unavailable. Showing the current slide thumbnail."); return; }
    }
    if (drawable !== liveFrame) {
      if (!drawable) release();
      liveFrame = drawable;
      canvas.style.visibility = drawable ? "visible" : "hidden";
      container.classList.toggle("pp__now--live", drawable);
      connection("live", drawable ? "Live preview" : "Capture paused. Showing the current slide thumbnail.");
    }
    const media = activeMedia();
    controls.hidden = !liveFrame || !media;
    if (media) {
      playButton.setAttribute("aria-label", media.paused ? "Play slide media" : "Pause slide media");
      playButton.title = media.paused ? "Play slide media" : "Pause slide media";
      playButton.querySelector("path").setAttribute("d", media.paused ? "m5 3 14 9-14 9Z" : "M8 3v18M16 3v18");
      seek.disabled = !Number.isFinite(media.duration) || media.duration <= 0;
      if (!seek.disabled && doc.activeElement !== seek) seek.value = String(media.currentTime / media.duration * 100);
    }
    animation = presenterWindow.requestAnimationFrame(paint);
  }
  async function connect() {
    if (stopped || pending || !supported) return;
    if (stream) { stop(); return; }
    pending = true;
    button.disabled = true;
    connection("connecting", "Select the audience tab");
    try {
      mediaDevices.setCaptureHandleConfig({ exposeOrigin: true, handle, permittedOrigins: [location.origin] });
      const ticket = captureTicket; captureTicket = null; pendingTicket = ticket;
      const result = ticket ? await ticket.result : { stream: await mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false, selfBrowserSurface: "include", surfaceSwitching: "exclude" }) };
      if (result.error) throw result.error;
      const captured = result.stream;
      const track = captured.getVideoTracks()[0];
      if (stopped || presenterWindow.closed || !track || !verified(track)) {
        captured.getTracks().forEach(item => item.stop());
        if (!stopped) stop("Select this presentation's audience browser tab, not another tab, a window or a screen.");
        return;
      }
      stream = captured;
      const ended = () => { if (stream === captured) stop(); };
      const identityChanged = () => { if (stream === captured && !verified(track)) stop("Preview disconnected: the captured tab changed."); };
      track.addEventListener("ended", ended);
      track.addEventListener("capturehandlechange", identityChanged);
      detachTrack = () => { track.removeEventListener("ended", ended); track.removeEventListener("capturehandlechange", identityChanged); };
      video = doc.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
      video.srcObject = stream;
      doc.body.appendChild(video);
      const player = video;
      await player.play();
      if (stopped || stream !== captured || video !== player) return;
      canvas = doc.createElement("canvas");
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", "Live audience slide controls");
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;visibility:hidden";
      container.appendChild(canvas);
      for (const type of ["pointerdown", "pointermove", "pointerup"]) canvas.addEventListener(type, forward);
      canvas.addEventListener("pointercancel", release);
      canvas.addEventListener("pointerleave", () => { if (!pressed) pointer.hide(); });
      canvas.addEventListener("blur", release);
      canvas.addEventListener("wheel", wheel, { passive: false });
      canvas.addEventListener("dblclick", event => {
        const hit = targetAt(event);
        if (hit && !hit.blocked && !hit.disabled) { event.preventDefault(); dispatchPresenterInput(hit.target, "dblclick", { ...modifiers(event), clientX: hit.x, clientY: hit.y, detail: 2 }); }
      });
      connection("live", "Waiting for audience frames");
      paint();
    } catch (error) {
      if (!stopped) stop(error.name === "NotAllowedError" ? "Capture cancelled or denied. Slides and notes remain available; reconnect when ready." : "Live preview unavailable. Use the audience window for slide interactions.");
    } finally { pending = false; pendingTicket = null; if (!stopped) button.disabled = !supported; }
  }
  button.addEventListener("click", connect);
  presenterWindow.addEventListener("keydown", key, true);
  if (!supported) { button.disabled = true; status.textContent = "Pointer connected. Live video preview is unavailable in this browser."; }
  return {
    connect,
    resetPointer() { release(); focused = null; },
    get live() { return liveFrame; },
    dispose() {
      stopped = true;
      captureTicket?.cancel(); captureTicket = null;
      pendingTicket?.cancel(); pendingTicket = null;
      stop();
      button.removeEventListener("click", connect);
      previewSurface.removeEventListener("pointermove", pointPreview, true);
      previewSurface.removeEventListener("pointerleave", leavePreview);
      presenterWindow.removeEventListener("blur", release);
      presenterWindow.removeEventListener("resize", release);
      presenterWindow.removeEventListener("keydown", key, true);
      localLaser.dispose();
      previewSurface.style.cursor = "";
      controls.remove();
      try { mediaDevices?.setCaptureHandleConfig?.({}); } catch (error) {}
    }
  };
}