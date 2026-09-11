import { sectionComponentPlan } from "./slide-merge-section-component.mjs";
import { watchStudioTypography } from "./slide-merge-typography.mjs";
import { sectionMediaUrl } from "./slide-merge-sections.mjs";

export function mountSectionRuntime(stage) {
  window.RK.mediaUrl = source => sectionMediaUrl(source) || "";
  const stopTypography = watchStudioTypography(window, document);
  const fit = () => {
    const height = Math.max(1, stage.scrollHeight, stage.offsetHeight);
    const scale = Math.min(innerWidth / 1120, innerHeight / height);
    stage.style.transform = `scale(${scale})`;
    stage.style.left = `${(innerWidth - 1120 * scale) / 2}px`;
    stage.style.top = `${(innerHeight - height * scale) / 2}px`;
  };
  stage.style.width = "1120px"; stage.style.height = "auto"; stage.style.padding = "0";
  stage.className = "pj__body";
  document.body.style.background = "transparent";
  document.documentElement.style.background = "transparent";
  const observer = new ResizeObserver(fit); observer.observe(stage);
  window.addEventListener("resize", fit);
  let rendered = "", zoomOpened = false, zoomFullscreen = false;
  const lightboxObserver = new MutationObserver(() => {
    const open = !!document.querySelector(".pjx.is-open");
    if (zoomOpened && !open && zoomFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    zoomOpened = open;
  });
  lightboxObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  stage.addEventListener("click", event => {
    if (!event.target.closest("[data-zoom],[data-cmp-zoom],figure.rt__fig img,.pjb__prose img,.pjb__iso-layer")) return;
    if (!document.fullscreenElement && document.fullscreenEnabled) document.documentElement.requestFullscreen().then(() => { zoomFullscreen = true; }).catch(() => {});
  }, true);
  stage.addEventListener("click", event => {
    const fullscreen = event.target.closest("[data-fs]");
    if (fullscreen) {
      const media = fullscreen.closest(".pjb__frame")?.querySelector("iframe,video,img");
      if (media) { event.preventDefault(); media.requestFullscreen?.().catch(() => {}); }
      return;
    }
    const image = event.target.closest("img[data-zoom],figure.rt__fig img,.pjb__prose img");
    if (!image) return;
    event.preventDefault();
    const root = image.closest(".pjb__gallery,.pjb__media,.pjb__mediagrid,.pjb__devices,.pjb") || stage;
    const images = [...root.querySelectorAll("img[data-zoom],figure.rt__fig img,.pjb__prose img")];
    window.RK.openLbx?.(images.map(item => ({ src: item.currentSrc || item.src, cap: item.dataset.cap, title: item.dataset.title })), images.indexOf(image));
  });
  const render = data => {
    try {
      const component = sectionComponentPlan(data.block, String, "check", { customIcons: data.icons }).elements[0].customData;
      if (!window.RK.renderStudyBlock) throw new Error("Section renderer unavailable");
      window.RK.registerIcons?.(component.sectionIcons);
      for (const key of ["--text", "--text-dim", "--text-faint", "--accent", "--bg", "--bg-2", "--line-soft", "--sans", "--serif", "--mono"]) {
        if (typeof data.tokens?.[key] === "string") document.documentElement.style.setProperty(key, data.tokens[key]);
      }
      document.documentElement.dataset.appearance = data.appearance === "light" ? "light" : "dark";
      const signature = JSON.stringify(component);
      if (signature === rendered) { fit(); return; }
      stage.innerHTML = window.RK.renderStudyBlock(component.sectionComponent);
      if (!stage.querySelector(".pjb")?.innerHTML.trim()) throw new Error("This section needs a newer case-study renderer");
      stage.querySelectorAll("img").forEach(image => { image.loading = "eager"; image.addEventListener("load", fit, { once: true }); });
      stage.querySelectorAll("iframe").forEach(frame => { frame.loading = "eager"; frame.allowFullscreen = true; frame.addEventListener("load", fit, { once: true }); });
      stage.querySelectorAll("video").forEach(video => video.addEventListener("loadedmetadata", fit, { once: true }));
      window.RK.enhanceBlocks?.(stage);
      stage.dataset.componentType = component.sectionComponent.type;
      rendered = signature; fit();
    } catch (error) { stage.textContent = error.message; }
  };
  window.RK.renderSectionComponent = render;
  const receive = event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "rk-section-component") return;
    render(event.data);
  };
  window.addEventListener("message", receive);
  window.addEventListener("pagehide", () => { observer.disconnect(); lightboxObserver.disconnect(); stopTypography?.(); window.removeEventListener("resize", fit); window.removeEventListener("message", receive); }, { once: true });
}

const stage = document.querySelector("[data-section-runtime]");
if (stage) {
  if (document.readyState === "complete") mountSectionRuntime(stage);
  else window.addEventListener("load", () => mountSectionRuntime(stage), { once: true });
}