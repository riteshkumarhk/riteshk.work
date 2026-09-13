async function protectedRequest(execute, signal, timeout) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason || new DOMException("Request cancelled.", "AbortError"));
  let timer, rejectAbort;
  const interrupted = new Promise((resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    timer = setTimeout(() => controller.abort(new DOMException("Protected content timed out.", "TimeoutError")), timeout);
    const value = await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return execute(controller.signal); }), interrupted]);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export async function loadProtectedBlocks(blocks, { sign, fetch: request = globalThis.fetch, signal, timeout = 15000 } = {}) {
  const result = blocks.slice(), failures = [];
  const entries = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block?.locked && typeof block.vaultBlock === "string" && block.vaultBlock);
  let next = 0, resolved = 0;
  async function loadNext() {
    while (next < entries.length) {
      signal?.throwIfAborted();
      const { block, index } = entries[next++];
      try {
        const full = await protectedRequest(async requestSignal => {
          const url = await sign(block.vaultBlock, { signal: requestSignal, strict: true });
          requestSignal.throwIfAborted();
          if (!url) throw Object.assign(new Error("Access unavailable"), { status: 403 });
          const response = await request(url, { signal: requestSignal, credentials: "omit", cache: "no-store" });
          if (!response.ok) throw Object.assign(new Error("Protected request failed"), { status: response.status });
          const value = await response.json();
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid protected content");
          return value;
        }, signal, timeout);
        signal?.throwIfAborted();
        result[index] = { ...full, locked: true };
        resolved++;
      } catch (error) {
        signal?.throwIfAborted();
        const kind = error?.name === "TimeoutError" ? "timeout" : [401, 403].includes(error?.status) ? "access" : error?.status >= 500 ? "server" : error?.name === "TypeError" ? "network" : "unavailable";
        failures.push({ index, kind, status: error?.status || 0 });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, loadNext));
  signal?.throwIfAborted();
  return { blocks: result, resolved, failures };
}