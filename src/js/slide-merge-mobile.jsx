import { useEffect, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import "../../css/slide-merge-mobile.css";

export function useMobilePanels(api) {
  const [mobile, setMobile] = useState(() => matchMedia("(max-width:900px)").matches);
  const [panel, setPanel] = useState(null);
  const [slides, setSlides] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width:900px)");
    const change = () => { setMobile(media.matches); setPanel(null); api?.updateScene({ appState: { openSidebar: null, openMenu: null }, captureUpdate: CaptureUpdateAction.NEVER }); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [api]);
  useEffect(() => {
    if (!api || !mobile) return;
    return api.onChange((elements, state) => {
      if (state.openSidebar) setPanel(state.openSidebar.name === "insert" ? state.openSidebar.tab : "library");
      else setPanel(previous => ["library", "icons", "text", "badges", "sections", "layout", "source", "media", "layers"].includes(previous) ? null : previous);
    });
  }, [api, mobile]);
  function open(next, selected = false) {
    setPanel(next);
    api?.updateScene({ appState: {
      openSidebar: next === "library" ? { name: "default", tab: "library" } : ["icons", "text", "badges", "sections", "layout", "source", "media", "layers"].includes(next) ? { name: "insert", tab: next } : null,
      openMenu: next === "properties" && selected ? "shape" : null,
      openPopup: null
    }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  useEffect(() => {
    if (!mobile || !panel) return;
    const trigger = document.activeElement;
    document.querySelector(".merge-sheet-close")?.focus();
    const key = event => {
      if (api.getAppState().openDialog) return;
      if (document.querySelector('.color-picker-content, .font-picker-content, .merge-tool-pop:popover-open')) return;
      if (panel === "notes") {
        if (event.key === "Escape" && !event.target.closest(".merge-time-budget")) { event.preventDefault(); open(null); }
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); open(null); }
      if (event.key === "Tab") {
        const containers = [...document.querySelectorAll('.merge-sheet-head, .merge-slide-properties, .App-mobile-menu, .selected-shape-actions, .default-sidebar, .merge-content-sidebar, .merge-notes')];
        const controls = containers.flatMap(container => [...container.querySelectorAll('button, input, textarea, select, summary, a[href], [tabindex="0"]')]).filter(element => !element.disabled && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
        const first = controls[0], last = controls[controls.length - 1];
        if (first && (event.shiftKey ? document.activeElement === first : document.activeElement === last) || !controls.includes(document.activeElement)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); if (trigger?.isConnected) trigger.focus(); };
  }, [mobile, panel]);
  return { mobile, panel, slides, setSlides, open };
}