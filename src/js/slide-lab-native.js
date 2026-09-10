import { nativeFixtures, createScreenshot } from "./slide-lab-fixtures.mjs";
import { sectionComponentPlan } from "./slide-merge-section-component.mjs";
import { watchStudioTypography } from "./slide-merge-typography.mjs";
import { sectionMediaUrl } from "./slide-merge-sections.mjs";

const kind = new URLSearchParams(location.search).get("fixture") || "all";
const stage = document.getElementById("stage");
async function videoFixture() {
  const video = document.createElement("video"); video.id = "video"; video.controls = true; video.muted = true; video.loop = true; video.playsInline = true;
  video.src = "./motion.webm";
  video.preload = "auto";
  video.addEventListener("error", () => {
    const message = document.createElement("p");
    message.textContent = "Video playback unavailable in this browser";
    video.replaceWith(message);
  }, { once: true });
  stage.replaceWith(video);
  window.addEventListener("pagehide", () => video.pause(), { once: true });
}
function fit() {
  const height = kind === "rich" ? 480 : 720;
  stage.style.height = `${height}px`;
  stage.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / height)})`;
  window.RK.fitSections?.(stage);
}
async function render() {
  if (kind === "component") {
    window.RK.mediaUrl = source => sectionMediaUrl(source) || "";
    watchStudioTypography(window, document);
    const fitComponent = () => {
      const height = Math.max(1, stage.scrollHeight, stage.offsetHeight);
      const scale = Math.min(innerWidth / 1120, innerHeight / height);
      stage.style.transform = `scale(${scale})`;
      stage.style.left = `${(innerWidth - 1120 * scale) / 2}px`;
      stage.style.top = `${(innerHeight - height * scale) / 2}px`;
    };
    stage.style.width = "1120px";
    stage.style.height = "auto";
    stage.className = "pj__body";
    stage.style.padding = "0";
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    const observer = new ResizeObserver(fitComponent);
    observer.observe(stage);
    window.addEventListener("resize", fitComponent);
    let rendered = "";
    let zoomOpened = false, zoomFullscreen = false;
    const lightboxObserver = new MutationObserver(() => {
      const open = !!document.querySelector(".pjx.is-open");
      if (zoomOpened && !open && zoomFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      zoomOpened = open;
    });
    lightboxObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    stage.addEventListener("click", event => {
      if (!event.target.closest("[data-zoom],[data-cmp-zoom],figure.rt__fig img,.pjb__prose img,.pjb__iso-layer")) return;
      if (!document.fullscreenElement && document.fullscreenEnabled) {
        document.documentElement.requestFullscreen().then(() => { zoomFullscreen = true; }).catch(() => {});
      }
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
    window.addEventListener("message", event => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "rk-section-component") return;
      try {
        const component = sectionComponentPlan(event.data.block, String, "check", { customIcons: event.data.icons }).elements[0].customData;
        const block = component.sectionComponent;
        if (!window.RK.renderStudyBlock) throw new Error("Section renderer unavailable");
        window.RK.registerIcons?.(component.sectionIcons);
        for (const key of ["--text", "--text-dim", "--text-faint", "--accent", "--bg", "--bg-2", "--line-soft", "--sans", "--serif", "--mono"]) {
          const value = event.data.tokens?.[key];
          if (typeof value === "string") document.documentElement.style.setProperty(key, value);
        }
        document.documentElement.dataset.appearance = event.data.appearance === "light" ? "light" : "dark";
        const signature = JSON.stringify(component);
        if (signature === rendered) { fitComponent(); return; }
        stage.innerHTML = window.RK.renderStudyBlock(block);
        if (!stage.querySelector(".pjb")?.innerHTML.trim()) throw new Error("This section needs a newer case-study renderer");
        stage.querySelectorAll("img").forEach(image => { image.loading = "eager"; image.addEventListener("load", fitComponent, { once: true }); });
        stage.querySelectorAll("iframe").forEach(frame => { frame.loading = "eager"; frame.allowFullscreen = true; frame.addEventListener("load", fitComponent, { once: true }); });
        stage.querySelectorAll("video").forEach(video => video.addEventListener("loadedmetadata", fitComponent, { once: true }));
        window.RK.enhanceBlocks?.(stage);
        stage.dataset.componentType = block.type;
        rendered = signature;
        fitComponent();
      } catch (error) { stage.textContent = error.message; }
    });
    return;
  }
  if (kind === "video") return videoFixture();
  if (!window.RK.renderDeckSlide) { stage.textContent = "Native renderer unavailable"; return; }
  const fixture = structuredClone(nativeFixtures[kind] || nativeFixtures.rich);
  if (kind === "all") {
    fixture.blocks[0].w = 45;
    fixture.blocks.push({ ...nativeFixtures.section.blocks[0], x: 3, y: 43, w: 48 });
    const screenshot = await createScreenshot();
    const url = URL.createObjectURL(screenshot);
    fixture.blocks.push({ kind: "media", x: 54, y: 10, w: 42, h: 70, fit: "contain", src: url });
    window.addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
  }
  stage.innerHTML = window.RK.renderDeckSlide(fixture);
  window.RK.enhanceBlocks?.(stage);
  fit();
  window.addEventListener("resize", fit);
}
if (document.readyState === "complete") render(); else window.addEventListener("load", render, { once: true });