import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, CaptureUpdateAction, exportToSvg } from "@excalidraw/excalidraw";
import { FRAME_ID } from "./slide-lab-core.mjs";
import { sectionMediaUrl } from "./slide-merge-sections.mjs";
import { nativeSectionLayers } from "./slide-merge-native-sections.mjs";
import { EmbeddedMedia } from "./slide-merge-embeds.jsx";
import { canvasTheme } from "./slide-merge-appearance.mjs";
import { slideSettings, transitionMatch } from "./slide-merge-properties.mjs";
import { notesHtml } from "./slide-rich-text.mjs";
import { presentDeckWithRenderer } from "./deck-presenter.mjs";
import "../../css/slide-studio-renderer.css";

function useAppearance() {
  const [appearance, setAppearance] = useState(() => document.documentElement.dataset.appearance || "dark");
  useEffect(() => {
    const update = () => setAppearance(document.documentElement.dataset.appearance || "dark");
    window.addEventListener("theme:change", update); update();
    return () => window.removeEventListener("theme:change", update);
  }, []);
  return appearance;
}

export function SectionComponent({ block, icons }) {
  const frame = useRef(null), appearance = useAppearance();
  const send = () => {
    if (!frame.current?.contentDocument) return;
    const styles = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(["--text", "--text-dim", "--text-faint", "--accent", "--bg", "--bg-2", "--line-soft", "--sans", "--serif", "--mono"].map(key => [key, styles.getPropertyValue(key)]));
    frame.current.contentWindow?.RK?.renderSectionComponent?.({ block, icons, tokens, appearance });
  };
  useEffect(send, [block, icons, appearance]);
  return <iframe ref={frame} className="lab-embed lab-section-component" title="Case-study section" src="/studio/slide-runtime/component.html?v=1.0" allow="fullscreen; autoplay" allowFullScreen onLoad={send} />;
}

export function Embed({ element, preview = false }) {
  if (element.customData?.labLayerHidden) return null;
  if (element.customData?.sectionComponent) return <SectionComponent block={element.customData.sectionComponent} icons={element.customData.sectionIcons} />;
  const video = element.customData?.sectionVideo;
  return video && sectionMediaUrl(video) ? <video className="lab-embed" src={video} controls={!preview} muted={preview} playsInline preload="metadata" onLoadedMetadata={event => { if (preview && event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} /> : null;
}

export const engineOptions = { tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } };
export function sceneBackground() { return "transparent"; }
export function changed(element, update) { return { ...element, ...update, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2147483647), updated: Date.now() }; }
export function validEmbed(link) { return /^https:\/\/slide-lab\.invalid\/(rich|section|video|background|section-video|section-component)$/.test(link); }

export function NativeSections({ api, interactive = false }) {
  const [layers, setLayers] = useState([]);
  useEffect(() => {
    if (!api) return;
    const update = (elements, state) => setLayers(nativeSectionLayers(elements, state));
    update(api.getSceneElements(), api.getAppState());
    return api.onChange(update);
  }, [api]);
  return <div className={`merge-native-sections${interactive ? " is-interactive" : ""}`}><SectionLayers layers={layers} files={api?.getFiles()} /></div>;
}

function SectionForeground({ elements, frame, files, style }) {
  const [svg, setSvg] = useState("");
  const appearance = useAppearance(), signature = JSON.stringify([elements, frame]);
  useEffect(() => {
    let current = true;
    if (!elements.length || !frame) { setSvg(""); return; }
    exportToSvg({ elements: [...elements.map(element => ({ ...element, frameId: frame.id })), frame], files: files || {}, exportingFrame: frame, skipInliningFonts: true, appState: { exportBackground: false, exportWithDarkMode: canvasTheme([...elements, frame], appearance) === "dark" } }).then(svg => { if (current) setSvg(svg.outerHTML); }).catch(() => { if (current) setSvg(""); });
    return () => { current = false; };
  }, [signature, files, appearance]);
  return svg ? <div className="merge-native-foreground" style={style} dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

function SectionLayers({ layers, files, preview = false }) {
  return layers.map(({ element, style, clipStyle, foreground, frame, frameStyle }) => <div key={element.id} className="merge-native-clip" style={clipStyle}><div className="merge-native-section" style={style}>{element.customData.slideEmbed ? <EmbeddedMedia value={element.customData.slideEmbed.url} preview={preview} /> : <SectionComponent block={element.customData.sectionComponent} icons={element.customData.sectionIcons} />}</div><SectionForeground elements={foreground} frame={frame} files={files} style={frameStyle} /></div>);
}

export function SectionThumbnail({ svg, elements, files, embeds = true, renderEmbed }) {
  const host = useRef(null), [scale, setScale] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1280));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={host} className="merge-section-thumbnail" inert=""><span className="merge-section-thumbnail-scene" style={{ transform: `scale(${scale})` }}>{embeds && elements.filter(element => !element.isDeleted && !element.customData?.labLayerHidden && element.customData?.slideBackgroundVideo).map(element => <video key={element.id} className="merge-thumbnail-background" src={element.customData.slideBackgroundVideo} muted playsInline preload="metadata" onLoadedMetadata={event => { if (event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} />)}<span className="merge-section-thumbnail-svg" dangerouslySetInnerHTML={{ __html: svg }} />{embeds && elements.filter(element => !element.isDeleted && !element.customData?.labLayerHidden && element.type === "embeddable" && validEmbed(element.link)).map(element => <span key={element.id} className="merge-present-embed-preview" style={{ left: element.x, top: element.y, width: element.width, height: element.height, opacity: element.opacity / 100, transform: `rotate(${element.angle}rad)` }}>{renderEmbed ? renderEmbed(element, true) : <Embed element={element} preview />}</span>)}<SectionLayers layers={nativeSectionLayers(elements, { zoom: { value: 1 }, scrollX: 0, scrollY: 0 })} files={files} preview /></span></span>;
}

export function CanvasVideo({ api }) {
  const [video, setVideo] = useState(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!api) return;
    const update = (elements, state) => {
      const element = elements.find(item => !item.isDeleted && !item.customData?.labLayerHidden && item.customData?.slideBackgroundVideo);
      const next = element ? { src: element.customData.slideBackgroundVideo, x: (state.scrollX + element.x) * state.zoom.value, y: (state.scrollY + element.y) * state.zoom.value, width: element.width * state.zoom.value, height: element.height * state.zoom.value } : null;
      setVideo(previous => previous?.src === next?.src && previous?.x === next?.x && previous?.y === next?.y && previous?.width === next?.width && previous?.height === next?.height ? previous : next);
    };
    update(api.getSceneElements(), api.getAppState()); return api.onChange(update);
  }, [api]);
  useEffect(() => setFailed(false), [video?.src]);
  return video ? <div className="merge-video-layer" style={{ left: video.x, top: video.y, width: video.width, height: video.height }}>{failed ? <div role="status">Video unavailable in this browser</div> : <video className="merge-background-video" src={video.src} autoPlay muted loop playsInline onError={() => setFailed(true)} />}</div> : null;
}

function PresentationCanvas({ slides, index, renderEmbed }) {
  const [api, setApi] = useState(null), appearance = useAppearance();
  const stage = useRef(null), previous = useRef(null), engine = useRef(null);
  const slide = slides[index];
  const fit = () => { if (api && stage.current) api.updateScene({ appState: { zoom: { value: stage.current.clientWidth / 1280 }, scrollX: 0, scrollY: 0 }, captureUpdate: CaptureUpdateAction.NEVER }); };
  useEffect(() => {
    if (!api) return;
    const scene = structuredClone(slide.scene);
    api.resetScene();
    api.updateScene({ elements: scene.elements.map(element => element.id === FRAME_ID ? { ...element, name: "" } : element), appState: { ...scene.appState, viewModeEnabled: true, zenModeEnabled: true, theme: canvasTheme(scene.elements, appearance), viewBackgroundColor: sceneBackground(), selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null }, captureUpdate: CaptureUpdateAction.NEVER });
    api.addFiles(Object.values(scene.files));
    const old = previous.current; previous.current = { slide, index };
    let animationFrame = 0, animation = null;
    const transition = slideSettings(scene.elements).transition || "fade";
    if (old && old.slide.id !== slide.id && !matchMedia("(prefers-reduced-motion: reduce)").matches && transition !== "none") {
      if (transition === "magic") {
        const matches = transitionMatch(old.slide.scene.elements, scene.elements), start = performance.now();
        const tick = now => {
          const progress = Math.min(1, (now - start) / 520), ease = 1 - Math.pow(1 - progress, 3);
          const interpolated = matches.map(match => {
            const target = match.next, source = match.previous, update = {};
            for (const key of ["x", "y", "width", "height", "angle", "fontSize", "opacity"]) if (Number.isFinite(target[key])) update[key] = source && Number.isFinite(source[key]) ? source[key] + (target[key] - source[key]) * ease : key === "opacity" ? target[key] * ease : target[key];
            if (source?.points?.length === target.points?.length && target.points) update.points = target.points.map((point, pointIndex) => point.map((value, axis) => source.points[pointIndex][axis] + (value - source.points[pointIndex][axis]) * ease));
            return changed(target, update);
          });
          api.updateScene({ elements: [...interpolated, scene.elements.find(element => element.id === FRAME_ID)].filter(Boolean), captureUpdate: CaptureUpdateAction.NEVER });
          if (progress < 1) animationFrame = requestAnimationFrame(tick); else api.updateScene({ elements: scene.elements, captureUpdate: CaptureUpdateAction.NEVER });
        };
        animationFrame = requestAnimationFrame(tick);
      } else animation = engine.current.animate(transition === "push" ? [{ transform: `translateX(${index < old.index ? -100 : 100}%)` }, { transform: "translateX(0)" }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" });
    }
    const observer = new ResizeObserver(fit); observer.observe(stage.current); fit();
    return () => { observer.disconnect(); cancelAnimationFrame(animationFrame); animation?.cancel(); };
  }, [api, slide]);
  return <div className="merge-present-stage" ref={stage}><div className="merge-present-engine" ref={engine}><CanvasVideo api={api} /><NativeSections api={api} interactive /><Excalidraw excalidrawAPI={setApi} onScrollChange={fit} theme={canvasTheme(slide.scene.elements, appearance)} viewModeEnabled zenModeEnabled aiEnabled={false} handleKeyboardGlobally={false} UIOptions={engineOptions} renderEmbeddable={element => renderEmbed ? renderEmbed(element) : <Embed element={element} />} validateEmbeddable={validEmbed} /></div></div>;
}

function PresentationThumbnail({ slide, renderEmbed }) {
  const [svg, setSvg] = useState(""), appearance = useAppearance();
  useEffect(() => {
    let active = true; setSvg("");
    if (slide) exportToSvg({ elements: slide.scene.elements, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true, appState: { exportBackground: false, exportWithDarkMode: canvasTheme(slide.scene.elements, appearance) === "dark" } }).then(result => { if (active) setSvg(result.outerHTML); }).catch(() => { if (active) setSvg(""); });
    return () => { active = false; };
  }, [slide, appearance]);
  return slide && svg ? <div className="merge-present-thumbnail" style={{ background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() }}><SectionThumbnail svg={svg} elements={slide.scene.elements} files={slide.scene.files} embeds renderEmbed={renderEmbed} /></div> : null;
}

export function createNativePresenter(work, slides, options = {}) {
  const roots = new Map();
  const mount = (container, content) => { if (!roots.has(container)) roots.set(container, createRoot(container)); roots.get(container).render(content); };
  return presentDeckWithRenderer(work, { ...options, slides }, {
    pjSlideTitle: slide => slide.title || "Untitled slide",
    pjNotesHtml: notes => notesHtml(notes) || '<span class="pjp__pnote-empty">No notes for this slide</span>',
    mountSlide: (frame, slide, index) => { frame.closest(".pjp").classList.add("pjp--canvas"); mount(frame, <PresentationCanvas slides={slides} index={index} renderEmbed={options.renderEmbed} />); options.onIndex?.(index); },
    renderThumbnail: (container, slide) => mount(container, <PresentationThumbnail slide={slide} renderEmbed={options.renderEmbed} />),
    thumbnailData: async slide => { const svg = await exportToSvg({ elements: slide.scene.elements, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true, appState: { exportBackground: false } }); return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.outerHTML); },
    disposePresenter: document => { for (const [container, root] of roots) if (container.ownerDocument === document) { root.unmount(); roots.delete(container); } },
    dispose: () => { roots.forEach(root => root.unmount()); roots.clear(); }
  });
}

export function Presenter({ slides, index, onIndex, onClose, onSlideEdit, renderEmbed }) {
  const callbacks = useRef({ onIndex, onClose, onSlideEdit }); callbacks.current = { onIndex, onClose, onSlideEdit };
  useLayoutEffect(() => {
    const player = createNativePresenter({}, slides, { start: index, autoStart: true, renderEmbed, onSlideEdit: (slide, key, value) => callbacks.current.onSlideEdit?.(slide.id, key, value), onIndex: next => callbacks.current.onIndex?.(next), onClose: () => callbacks.current.onClose?.() });
    return () => player?.close();
  }, []);
  return null;
}