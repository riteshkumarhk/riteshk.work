export function installPresenterPointer(stage, frame, remoteInput = false) {
  const pointer = document.createElement("div");
  pointer.className = "pjp__pointer";
  pointer.setAttribute("aria-hidden", "true");
  pointer.innerHTML = '<svg viewBox="0 0 24 28"><path d="M3 2v21l5-5 4 8 4-2-4-8h8Z"/></svg>';
  stage.appendChild(pointer);
  stage.classList.add("pjp--laser");
  const interactive = 'a,button,input,textarea,select,summary,video[controls],audio[controls],iframe,[role="button"],[role="slider"],[contenteditable="true"],[data-pjhref],[data-pjjump]';
  function hide() { pointer.hidden = true; stage.removeAttribute("data-pointer"); }
  function point(x, y, remote = false) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) { hide(); return; }
    const target = document.elementFromPoint(x, y);
    if (!target || !frame.contains(target)) { hide(); return; }
    const control = !!target.closest(interactive);
    pointer.hidden = control && !remote;
    pointer.classList.toggle("is-control", control);
    pointer.style.left = x + "px";
    pointer.style.top = y + "px";
    stage.dataset.pointer = control ? "control" : "laser";
  }
  function move(event) { point(event.clientX, event.clientY, remoteInput); }
  stage.addEventListener("pointermove", move);
  stage.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  hide();
  return { point, hide, dispose() { stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerleave", hide); window.removeEventListener("blur", hide); pointer.remove(); } };
}