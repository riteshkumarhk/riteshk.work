export function createPresenterFrameSource(processor, onError) {
  const reader = processor.readable.getReader();
  let frame = null, stopped = false;
  const clear = () => { frame?.close(); frame = null; };
  const source = {
    processor,
    get frame() { return frame; },
    finished: null,
    async dispose() {
      if (stopped) return source.finished;
      stopped = true;
      clear();
      try { await reader.cancel(); }
      finally { await source.finished; }
    }
  };
  source.finished = (async () => {
    try {
      while (!stopped) {
        const next = await reader.read();
        if (next.done) {
          if (!stopped) throw new Error("The audience frame stream ended.");
          break;
        }
        if (stopped) { next.value.close(); break; }
        clear();
        frame = next.value;
      }
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      stopped = true;
      clear();
      reader.releaseLock();
      source.processor = null;
    }
  })();
  return source;
}

export function guardPresenterFrameStartup({ isCurrent, isReady, refresh, onError }, clock = globalThis) {
  let active = true, refreshTimer, deadline;
  function dispose() {
    active = false;
    clock.clearTimeout(refreshTimer);
    clock.clearTimeout(deadline);
  }
  function check() {
    if (!active) return true;
    if (!isCurrent() || isReady()) { dispose(); return true; }
    return false;
  }
  function fail(error) {
    if (check()) return;
    dispose();
    onError(error);
  }
  // A static captured tab can miss its initial refresh after the sink attaches.
  refreshTimer = clock.setTimeout(async () => {
    if (check()) return;
    try { await refresh(); check(); }
    catch (error) { fail(error); }
  }, 1000);
  deadline = clock.setTimeout(() => fail(new Error("Audience frames did not arrive. Reconnect live preview.")), 5000);
  check();
  return { check, dispose };
}
