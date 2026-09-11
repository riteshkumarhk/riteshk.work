import { nativeFixtures, createScreenshot } from "./slide-lab-fixtures.mjs";
import { mountSectionRuntime } from "./slide-section-runtime.js";

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
  if (kind === "component") return mountSectionRuntime(stage);
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