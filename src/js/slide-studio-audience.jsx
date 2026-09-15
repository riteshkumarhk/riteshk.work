import { FONT_FAMILY, LabFontRegistry, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { registerStudioFonts, loadPlatformFonts } from "./slide-platform-fonts.mjs";
import { createNativePresenter } from "./slide-studio-renderer.jsx";
import { fetchCoverMedia, restorePresentationCover } from "./slide-merge-cover.mjs";
import { sectionMediaUrl } from "./slide-merge-sections.mjs";
import { originalImage } from "./slide-lab-core.mjs";
import "@excalidraw/excalidraw/index.css";
import "../../css/deck-presenter.css";
import "../../css/slide-merge-presenter.css";

export async function presentNativeDocument(work, document, options = {}) {
  if (document?.version !== 1 || !Array.isArray(document.slides)) throw new Error("This slideshow needs a supported presentation version");
  const slides = structuredClone(document.slides.filter(slide => !slide.hidden));
  if (!slides.length) throw new Error("This slideshow has no visible slides");
  if (slides.some(slide => !Array.isArray(slide.scene?.elements) || !slide.scene?.files)) throw new Error("The slideshow is missing a complete slide");
  const images = new Map();
  const loadImage = source => {
    if (!images.has(source)) images.set(source, (async () => {
      const url = sectionMediaUrl(source);
      if (!url) throw new Error("The linked cover image URL is unavailable. Refresh the linked cover in Studio.");
      const response = await fetchCoverMedia(url);
      if (!response.ok) throw new Error("The linked cover image could not be loaded. Check the connection and retry the presentation.");
      const blob = await response.blob();
      if (!/^image\//.test(blob.type)) throw new Error("The linked cover is not an image. Refresh the linked cover in Studio.");
      return originalImage(blob);
    })());
    return images.get(source);
  };
  for (const slide of slides) await restorePresentationCover(slide, work, loadImage, convertToExcalidrawElements);
  await registerStudioFonts(null, LabFontRegistry, FONT_FAMILY, document.fonts || []);
  await loadPlatformFonts(slides.flatMap(slide => slide.scene.elements));
  return createNativePresenter(work, slides, options);
}