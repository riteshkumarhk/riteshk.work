import { AI_SESSION_KEY } from "./ai-session.mjs";
import { presenterIcon } from "./presenter-panel.mjs";

export function openPresenterTab({ url, prepare = () => {}, present, onError }) {
  const existing = document.querySelector("dialog.pjp-tab");
  if (existing) { existing.querySelector("iframe")?.contentWindow?.focus(); return; }
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) { onError(new Error("The audience must open on this site.")); return; }
  target.searchParams.set("presenter", "tab");
  const audience = window.open("about:blank", "_blank");
  if (!audience) { onError(new Error("Allow a new tab to open this slideshow.")); return; }
  try { audience.sessionStorage.removeItem(AI_SESSION_KEY); } catch {}
  const trigger = document.activeElement;
  const host = document.createElement("dialog");
  host.className = "pjp-tab";
  host.setAttribute("aria-label", "Presenter DJ pad");
  host.innerHTML = '<iframe title="Presenter DJ pad" data-presenter-host></iframe><div class="pjp-tab__loading" role="status">Opening slideshow...</div><button type="button" class="pjp__x" aria-label="Cancel presentation">' + presenterIcon("close") + '</button>';
  const frame = host.querySelector("iframe");
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
    host.close(); host.remove();
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
      controller = await present(audience, frame.contentWindow, prepared, () => finish());
      if (closed) { controller?.close(); return; }
      if (!controller) throw new Error("The slideshow was not started.");
      await controller.ready;
      if (closed) return;
      clearTimeout(timeout);
      host.dataset.ready = "true";
      host.querySelector(".pjp-tab__loading").remove();
      host.querySelector(":scope > button").remove();
      frame.contentWindow.focus();
    } catch (error) { finish(error); }
  }
  host.addEventListener("cancel", requestClose);
  host.querySelector("button").addEventListener("click", requestClose);
  window.addEventListener("message", ready);
  window.addEventListener("pagehide", leave);
  document.body.append(host); host.showModal();
  Promise.resolve().then(prepare).then(value => {
    if (closed) return;
    prepared = value;
    audience.location.replace(target.href);
  }).catch(error => finish(error));
  return { close:requestClose };
}

export function connectPresenterTab(onError) {
  if (new URLSearchParams(location.search).get("presenter") !== "tab") return false;
  if (window.opener) window.opener.postMessage({ type:"rk-presenter-tab-ready" }, location.origin);
  else onError(new Error("Reopen this slideshow from its case study or Studio to reconnect the DJ pad."));
  return true;
}