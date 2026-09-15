import { AI_SESSION_KEY } from "./ai-session.mjs";

let activePresentation = null;

export function openPresenterTab({ url, prepare = () => {}, present, onError }) {
  if (activePresentation && !activePresentation.audience.closed) { activePresentation.audience.focus(); return activePresentation; }
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) { onError(new Error("The audience must open on this site.")); return; }
  target.searchParams.set("presenter", "tab");
  const audience = window.open("about:blank", "_blank");
  if (!audience) { onError(new Error("Allow a new tab to open this slideshow.")); return; }
  try { audience.sessionStorage.removeItem(AI_SESSION_KEY); } catch {}
  const trigger = document.activeElement;
  let controller = null, prepared, started = false, closed = false, closing = false;
  let closeTimer = 0;
  const timeout = setTimeout(() => finish(new Error("The slideshow did not finish opening. Please try again.")), 30000);
  const watcher = setInterval(() => { if (audience.closed) finish(); }, 250);
  function finish(error) {
    if (closed) return;
    closed = true;
    clearTimeout(timeout); clearTimeout(closeTimer); clearInterval(watcher);
    window.removeEventListener("message", ready);
    window.removeEventListener("pagehide", leave);
    try { audience.removeEventListener("pagehide", requestClose); controller?.close(); } catch {}
    if (!audience.closed) audience.close();
    if (activePresentation?.audience === audience) activePresentation = null;
    requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll:true }); });
    if (error) onError(error);
  }
  function requestClose(event) {
    event?.preventDefault();
    if (closed || closing) return;
    closing = true;
    if (controller && !audience.closed) {
      closeTimer = setTimeout(() => finish(), 1000);
      try { controller.close(); } catch { finish(); }
    } else finish();
  }
  function leave() { finish(); }
  async function ready(event) {
    if (closed || started || event.origin !== location.origin || event.source !== audience || event.data?.type !== "rk-presenter-tab-ready") return;
    started = true;
    window.removeEventListener("message", ready);
    audience.opener = null;
    audience.addEventListener("pagehide", requestClose);
    try {
      const studio = trigger?.closest(".adm");
      const appearance = studio ? "dark" : document.documentElement.dataset.appearance || "dark";
      const palette = getComputedStyle(studio || document.documentElement);
      audience.document.documentElement.dataset.appearance = appearance;
      audience.document.documentElement.dataset.theme = appearance === "dark" ? "night" : "day";
      for (const name of ["--bg", "--bg-2", "--bg-elev", "--text", "--text-dim", "--text-faint", "--accent", "--line", "--line-soft", "--sans", "--serif", "--mono", "--serif-weight", "--card-weight"]) audience.document.documentElement.style.setProperty(name, palette.getPropertyValue(name));
      controller = await present(audience, null, prepared, () => finish());
      if (closed) { controller?.close(); return; }
      if (!controller) throw new Error("The slideshow was not started.");
      await controller.ready;
      if (closed) return;
      clearTimeout(timeout);
    } catch (error) { finish(error); }
  }
  window.addEventListener("message", ready);
  window.addEventListener("pagehide", leave);
  Promise.resolve().then(prepare).then(value => {
    if (closed) return;
    prepared = value;
    audience.location.replace(target.href);
  }).catch(error => finish(error));
  activePresentation = { audience, close:requestClose };
  return activePresentation;
}

export function connectPresenterTab(onError) {
  if (new URLSearchParams(location.search).get("presenter") !== "tab") return false;
  if (window.opener) window.opener.postMessage({ type:"rk-presenter-tab-ready" }, location.origin);
  else onError(new Error("Reopen this slideshow from its case study or Studio to reconnect the DJ pad."));
  return true;
}