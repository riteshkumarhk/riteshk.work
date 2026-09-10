export const SLIDE_TIME_STEP_SECONDS = 10;

export function installSlideTimeScrub(input, { handle = input, getValue, onPreview, onCommit }) {
  let gesture = null;
  function finish(event, cancelled = false, notify = true) {
    if (!gesture || event?.pointerId !== undefined && event.pointerId !== gesture.pointerId) return false;
    const previous = gesture; gesture = null;
    input.parentElement.removeAttribute('data-scrubbing');
    if (input.hasPointerCapture(previous.pointerId)) input.releasePointerCapture(previous.pointerId);
    if (previous.active && notify) {
      onPreview(null);
      if (!cancelled && !input.disabled && !input.readOnly && previous.value !== previous.initial) onCommit(previous.value);
    }
    return true;
  }
  function cancel(event) { return finish(event, true); }
  function start(event) {
    if (event.button !== 0 || input.disabled || input.readOnly || event.target.closest('button')) return;
    if (event.target !== input && !event.target.closest('svg')) return;
    const value = getValue();
    gesture = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, initial:value, value, active:false };
    input.focus();
    input.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (input.disabled || input.readOnly) { cancel(event); return; }
    const horizontal = event.clientX - gesture.x, vertical = event.clientY - gesture.y;
    if (!gesture.active && Math.abs(vertical) >= 8 && Math.abs(vertical) > Math.abs(horizontal)) { cancel(event); return; }
    if (!gesture.active && Math.abs(horizontal) < 8) return;
    gesture.active = true;
    event.preventDefault();
    gesture.value = Math.max(0, Math.min(14400, Math.round(gesture.initial * 60) + Math.trunc(horizontal / 8) * SLIDE_TIME_STEP_SECONDS)) / 60;
    input.parentElement.dataset.scrubbing = 'true';
    onPreview(gesture.value);
    input.setSelectionRange(input.value.length, input.value.length);
  }
  function key(event) {
    if (gesture && (event.key === 'Escape' || event.key === 'Enter')) {
      event.preventDefault(); event.stopImmediatePropagation();
      finish(null, event.key === 'Escape');
    }
  }
  function select(event) { if (gesture?.active) event.preventDefault(); }
  handle.addEventListener('pointerdown', start); handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', cancel);
  input.addEventListener('keydown', key, true); input.addEventListener('blur', cancel); input.addEventListener('selectstart', select);
  input.ownerDocument.defaultView.addEventListener('blur', cancel);
  return {
    get preview() { return gesture?.active ? gesture.value : null; },
    cancel: () => cancel(null),
    dispose() {
      finish(null, true, false);
      handle.removeEventListener('pointerdown', start); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', cancel);
      input.removeEventListener('keydown', key, true); input.removeEventListener('blur', cancel); input.removeEventListener('selectstart', select);
      input.ownerDocument.defaultView.removeEventListener('blur', cancel);
    }
  };
}

export function clampNotesHeight(value, editorHeight) {
  const maximum = Math.max(0, editorHeight / 2);
  const minimum = Math.min(80, maximum);
  const requested = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(requested) && requested > 0 ? requested : 116));
}

export function formatSlideDuration(minutes) {
  const value = Number(minutes);
  const seconds = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(240, value)) * 60) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function parseSlideDuration(value) {
  const text = String(value).trim();
  if (!text) return 0;
  const match = /^(\d{1,3})(?::([0-5]\d))?$/.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2] || 0);
  return seconds <= 240 * 60 ? seconds / 60 : null;
}