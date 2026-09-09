export function installWebPresenterPreview({ frame, pointer, container, presenterWindow, button, status, onDisconnect }) {
  const doc = container.ownerDocument;
  const mediaDevices = navigator.mediaDevices;
  const handle = crypto.randomUUID();
  let stream = null, video = null, canvas = null, stopped = false, pending = false, animation = 0;
  let pressed = null, focused = null;
  const supported = !!(mediaDevices?.getDisplayMedia && mediaDevices?.setCaptureHandleConfig);
  const controls = doc.createElement("div");
  controls.className = "pp__media";
  controls.hidden = true;
  controls.innerHTML = '<button type="button" class="pp__btn" aria-label="Play or pause slide media" title="Play or pause slide media"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="m5 3 14 9-14 9Z"/></svg></button><input type="range" min="0" max="100" step="0.1" value="0" aria-label="Seek slide media">';
  container.parentElement.after(controls);
  const playButton = controls.querySelector("button"), seek = controls.querySelector("input");
  function activeMedia() { return frame.querySelector("video,audio"); }
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
    if (pressed?.isConnected) pressed.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1, pointerType: "mouse" }));
    pressed = null;
    pointer.hide();
  }
  function stop(message = "Live preview stopped. Reconnect to control the audience tab.") {
    release();
    presenterWindow.cancelAnimationFrame(animation);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; video.remove(); }
    video = null;
    if (canvas) canvas.remove();
    canvas = null;
    controls.hidden = true;
    container.classList.remove("pp__now--live");
    button.disabled = !supported;
    button.textContent = "Connect live preview";
    status.textContent = message;
    if (!stopped) onDisconnect?.();
  }
  function verified(track) {
    const identity = track.getCaptureHandle?.();
    return track.getSettings().displaySurface === "browser" && identity?.handle === handle && identity.origin === location.origin;
  }
  function targetAt(event) {
    if (!stream || !canvas) return null;
    const preview = canvas.getBoundingClientRect(), bounds = frame.getBoundingClientRect();
    const x = bounds.left + Math.max(0, Math.min(1, (event.clientX - preview.left) / preview.width)) * bounds.width;
    const y = bounds.top + Math.max(0, Math.min(1, (event.clientY - preview.top) / preview.height)) * bounds.height;
    const target = document.elementFromPoint(x, y);
    if (!target || !frame.contains(target)) return null;
    pointer.point(x, y, true);
    if (target.closest("iframe")) {
      canvas.style.cursor = "pointer";
      status.textContent = "Embedded player: use its controls directly in the audience window.";
      return null;
    }
    canvas.style.cursor = target.closest('a,button,input,textarea,select,summary,video,audio,[role="button"],[role="slider"],[contenteditable="true"],[data-pjhref],[data-pjjump]') ? "pointer" : "none";
    return { target, x, y };
  }
  function setRange(target, x) {
    if (!target.matches('input[type="range"]')) return;
    const bounds = target.getBoundingClientRect();
    const min = Number(target.min || 0), max = Number(target.max || 100), step = target.step === "any" ? 0 : Number(target.step || 1);
    let value = min + Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)) * (max - min);
    if (step) value = min + Math.round((value - min) / step) * step;
    target.value = String(Math.max(min, Math.min(max, value)));
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function forward(event) {
    const hit = targetAt(event);
    if (!hit) { if (event.type === "pointerup") release(); return; }
    const { target, x, y } = hit;
    const options = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: event.buttons, pointerId: 1, pointerType: "mouse" };
    if (event.type === "pointerdown") {
      if (event.button !== 0) return;
      event.preventDefault();
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      pressed = target;
      focused = target;
    }
    (pressed || target).dispatchEvent(new PointerEvent(event.type, options));
    if (pressed) setRange(pressed, x);
    if (event.type === "pointerup") {
      const clicked = pressed;
      pressed = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (clicked === target) {
        if (target.closest("video,audio")) toggleMedia(target.closest("video,audio"));
        else if (!target.matches('input[type="range"]')) target.dispatchEvent(new MouseEvent("click", options));
      }
    }
  }
  function paint() {
    if (!stream || !canvas || !video) return;
    const track = stream.getVideoTracks()[0];
    if (!verified(track)) { stop("Preview disconnected: the captured tab changed."); return; }
    const bounds = frame.getBoundingClientRect();
    const ratio = video.videoWidth / window.innerWidth;
    const verticalRatio = video.videoHeight / window.innerHeight;
    const width = Math.max(1, Math.round(container.clientWidth * (presenterWindow.devicePixelRatio || 1)));
    const height = Math.max(1, Math.round(width * bounds.height / bounds.width));
    container.parentElement.style.aspectRatio = bounds.width + " / " + bounds.height;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    if (!track.muted && video.readyState >= 2 && bounds.width > 0 && bounds.height > 0) {
      context.drawImage(video, bounds.left * ratio, bounds.top * verticalRatio, bounds.width * ratio, bounds.height * verticalRatio, 0, 0, width, height);
    }
    const media = activeMedia();
    controls.hidden = !media;
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
    status.textContent = "Select the audience slides tab in the browser picker. Your meeting must share only that tab or window.";
    try {
      mediaDevices.setCaptureHandleConfig({ exposeOrigin: true, handle, permittedOrigins: [location.origin] });
      const captured = await mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false, selfBrowserSurface: "include", surfaceSwitching: "exclude" });
      const track = captured.getVideoTracks()[0];
      if (stopped || presenterWindow.closed || !track || !verified(track)) {
        captured.getTracks().forEach(item => item.stop());
        if (!stopped) stop("Select this presentation's audience browser tab, not another tab, a window or a screen.");
        return;
      }
      stream = captured;
      track.addEventListener("ended", () => stop());
      track.addEventListener("capturehandlechange", () => { if (!verified(track)) stop("Preview disconnected: the captured tab changed."); });
      video = doc.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
      video.srcObject = stream;
      doc.body.appendChild(video);
      await video.play();
      if (stopped || !stream) return;
      canvas = doc.createElement("canvas");
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", "Live audience slide controls");
      canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
      container.replaceChildren(canvas);
      container.classList.add("pp__now--live");
      for (const type of ["pointerdown", "pointermove", "pointerup"]) canvas.addEventListener(type, forward);
      canvas.addEventListener("pointercancel", release);
      canvas.addEventListener("pointerleave", () => { if (!pressed) pointer.hide(); });
      canvas.addEventListener("blur", release);
      canvas.addEventListener("wheel", event => {
        const hit = targetAt(event);
        if (!hit) return;
        let scrollable = hit.target;
        while (scrollable && frame.contains(scrollable)) {
          if (scrollable.scrollHeight > scrollable.clientHeight && /auto|scroll/.test(getComputedStyle(scrollable).overflowY)) {
            event.preventDefault();
            scrollable.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: "instant" });
            break;
          }
          scrollable = scrollable.parentElement;
        }
      }, { passive: false });
      canvas.addEventListener("keydown", event => {
        if (!focused?.isConnected || !frame.contains(focused)) return;
        if (focused.matches('input[type="range"]') && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Home") focused.value = focused.min || "0";
          else if (event.key === "End") focused.value = focused.max || "100";
          else if (focused.step !== "any") focused[event.key === "ArrowLeft" || event.key === "ArrowDown" ? "stepDown" : "stepUp"]();
          focused.dispatchEvent(new Event("input", { bubbles: true }));
          focused.dispatchEvent(new Event("change", { bubbles: true }));
        } else if ((event.key === " " || event.key === "Enter") && focused.closest("button,summary,video,audio")) {
          event.preventDefault(); event.stopPropagation();
          const media = focused.closest("video,audio");
          if (media) toggleMedia(media); else focused.closest("button,summary").click();
        }
      });
      button.textContent = "Disconnect live preview";
      status.textContent = "Live audience tab connected. Embedded players require direct interaction in the audience window.";
      paint();
    } catch (error) {
      if (!stopped) stop(error.name === "NotAllowedError" ? "Capture cancelled or denied. Slides and notes remain available; reconnect when ready." : "Live preview unavailable. Use the audience window for slide interactions.");
    } finally { pending = false; if (!stopped) button.disabled = !supported; }
  }
  button.addEventListener("click", connect);
  if (!supported) { button.disabled = true; status.textContent = "Live preview needs a supported desktop Chrome or Edge browser. Use the audience window for interactions."; }
  return {
    get live() { return !!stream; },
    dispose() {
      stopped = true;
      stop();
      button.removeEventListener("click", connect);
      controls.remove();
      try { mediaDevices?.setCaptureHandleConfig?.({}); } catch (error) {}
    }
  };
}