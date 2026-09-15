import { sectionComponentPlan, sectionTextVisibility } from "./slide-merge-section-component.mjs";
import { watchStudioTypography } from "./slide-merge-typography.mjs";
import { sectionMediaUrl } from "./slide-merge-sections.mjs";

export function applySectionTextVisibility(stage, value) {
  const visibility = sectionTextVisibility(value);
  stage.querySelectorAll('[data-section-text-hidden]').forEach(element => element.removeAttribute('data-section-text-hidden'));
  const hide = element => element.setAttribute('data-section-text-hidden','');
  for (const [key,selector] of [['heading','.pjb__h'],['kicker','.pjb__kicker'],['caption','figcaption']]) {
    if (visibility[key] === false) stage.querySelectorAll(selector).forEach(hide);
  }
  if (visibility.description !== false) return;
  const media = 'figure,img,video,iframe,svg,figcaption';
  function hideProse(container) {
    for (const node of [...container.childNodes]) {
      if (node.nodeType === 3 && node.textContent.trim()) {
        const span = stage.ownerDocument.createElement('span');
        node.replaceWith(span);span.append(node);hide(span);
      } else if (node.nodeType === 1 && !node.matches(media)) {
        if (node.querySelector(media)) hideProse(node); else hide(node);
      }
    }
  }
  stage.querySelectorAll('.pjb__prose,.pjb__sub,.pjb__cloud-desc,.pjb__quote').forEach(element => {
    if (element.querySelector(media)) hideProse(element); else hide(element);
  });
}

export function mountSectionRuntime(stage) {
  let runtimeMedia = {};
  window.RK.mediaUrl = source => runtimeMedia[source] || sectionMediaUrl(source) || "";
  const stopTypography = watchStudioTypography(window, document);
  const fit = () => {
    if (document.querySelector(".pjp__expanded")) return;
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
  let rendered = "";
  stage.addEventListener("click", event => {
    const fullscreen = event.target.closest("[data-fs]");
    if (fullscreen) {
      const media = fullscreen.closest(".pjb__frame")?.querySelector("iframe,video,img");
      if (media) { event.preventDefault(); if (!window.RK.expandSlideMedia?.(media)) media.requestFullscreen?.().catch(() => {}); }
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
      runtimeMedia = {};
      for (const [token,value] of Object.entries(data.media || {})) {
        if (!/^https:\/\/slide-lab\.invalid\/session-media\/\d+$/.test(token) || typeof value !== 'string') continue;
        const url = new URL(value);
        if (!url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'blob:' && url.origin === location.origin))) runtimeMedia[token] = value;
      }
      const signature = JSON.stringify([component,runtimeMedia]);
      if (signature === rendered) { applySectionTextVisibility(stage,data.textVisibility);fit();return; }
      stage.innerHTML = window.RK.renderStudyBlock(component.sectionComponent);
      if (!stage.querySelector(".pjb")?.innerHTML.trim()) throw new Error("This section needs a newer case-study renderer");
      stage.querySelectorAll("img").forEach(image => { image.loading = "eager"; image.addEventListener("load", fit, { once: true }); });
      stage.querySelectorAll("iframe").forEach(frame => { frame.loading = "eager"; frame.allowFullscreen = true; frame.addEventListener("load", fit, { once: true }); });
      stage.querySelectorAll("video").forEach(video => video.addEventListener("loadedmetadata", fit, { once: true }));
      window.RK.enhanceBlocks?.(stage);
      applySectionTextVisibility(stage,data.textVisibility);
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
  window.addEventListener("pagehide", () => { observer.disconnect(); stopTypography?.(); window.removeEventListener("resize", fit); window.removeEventListener("message", receive); }, { once: true });
}

const stage = document.querySelector("[data-section-runtime]");
if (stage) {
  if (document.readyState === "complete") mountSectionRuntime(stage);
  else window.addEventListener("load", () => mountSectionRuntime(stage), { once: true });
}