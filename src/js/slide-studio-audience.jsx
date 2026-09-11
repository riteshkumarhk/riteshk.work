import { FONT_FAMILY, LabFontRegistry } from "@excalidraw/excalidraw";
import { registerStudioFonts, loadPlatformFonts } from "./slide-platform-fonts.mjs";
import { createNativePresenter } from "./slide-studio-renderer.jsx";
import "@excalidraw/excalidraw/index.css";
import "../../css/deck-presenter.css";
import "../../css/slide-merge-presenter.css";

export async function presentNativeDocument(work, document, options = {}) {
  if (document?.version !== 1 || !Array.isArray(document.slides)) throw new Error("This slideshow needs a supported presentation version");
  const slides = structuredClone(document.slides.filter(slide => !slide.hidden));
  if (!slides.length) throw new Error("This slideshow has no visible slides");
  if (slides.some(slide => !Array.isArray(slide.scene?.elements) || !slide.scene?.files)) throw new Error("The slideshow is missing a complete slide");
  await registerStudioFonts(null, LabFontRegistry, FONT_FAMILY, document.fonts || []);
  await loadPlatformFonts(slides.flatMap(slide => slide.scene.elements));
  return createNativePresenter(work, slides, options);
}