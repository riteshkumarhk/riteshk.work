export function createRefreshGate(load, { ttl = 60000, now = Date.now } = {}) {
  let current;
  return function refresh(key, { force = false } = {}) {
    if (!current || current.key !== key) current = { key, at: null, pending: null, queued: null };
    const entry = current;
    if (entry.pending) {
      if (!force) return entry.queued || entry.pending;
      if (!entry.queued) entry.queued = entry.pending.then(() => {
        entry.queued = null;
        return current === entry ? refresh(key, { force: true }) : false;
      });
      return entry.queued;
    }
    if (!force && entry.at !== null && now() - entry.at < ttl) return Promise.resolve(true);
    entry.pending = Promise.resolve().then(() => load(key, () => current === entry)).then(success => {
      if (success) entry.at = now();
      else entry.at = null;
      return !!success;
    }, () => { entry.at = null; return false; }).finally(() => { entry.pending = null; });
    return entry.pending;
  };
}