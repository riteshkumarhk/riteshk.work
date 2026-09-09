export function createPresenterClock(now = Date.now) {
  let started = now(), pausedAt = null, excluded = 0, slideStarted = 0;
  const elapsed = () => (pausedAt ?? now()) - started - excluded;
  return {
    elapsed,
    slideElapsed: () => elapsed() - slideStarted,
    get paused() { return pausedAt !== null; },
    toggle() {
      if (pausedAt === null) pausedAt = now();
      else { excluded += now() - pausedAt; pausedAt = null; }
    },
    reset() { started = now(); excluded = 0; slideStarted = 0; if (pausedAt !== null) pausedAt = started; },
    nextSlide() { slideStarted = elapsed(); }
  };
}