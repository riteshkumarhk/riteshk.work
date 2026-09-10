import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Excalidraw, MainMenu, DefaultSidebar, CaptureUpdateAction, convertToExcalidrawElements, restoreElements, exportToSvg, getSceneVersion, LabFontRegistry, FONT_FAMILY } from "@excalidraw/excalidraw";
import { createDeck, changeSlides, insertSlide, setSlideSection, reorderSlides, presentationSlides, deckStore, slidePaneWidth } from "./slide-merge-core.mjs";
import { createDeckHistory } from "./slide-merge-history.mjs";
import { FRAME_ID, fixtureSkeleton, packScene, originalImage, selectedLabels, labelColorUpdate, preserveLabelColors } from "./slide-lab-core.mjs";
import { createScreenshot } from "./slide-lab-fixtures.mjs";
import { DEFAULT_SLIDE_FONT, platformText, loadPlatformFonts, registerStudioFonts } from "./slide-platform-fonts.mjs";
import { LabTextColorContext } from "./slide-lab-text-color.jsx";
import { CornerControls } from "./slide-lab-corner-controls.jsx";
import { normalizeHex } from "./slide-lab-color.mjs";
import { CanvasToolbar, ToolMenu, ToolIcon } from "./slide-merge-toolbar.jsx";
import { ContentPane, PANE_LABELS } from "./slide-merge-content-pane.jsx";
import { useSlideLibrary } from "./slide-library.jsx";
import { CanvasGuides, CanvasBackdrop } from "./slide-merge-guides.jsx";
import { PlaceholderActions } from "./slide-merge-placeholders.jsx";
import { fitPlaceholder } from "./slide-merge-placeholder-fit.mjs";
import { contentSkeleton, diagramSkeleton } from "./slide-merge-inserts.mjs";
import { SlideNavigator, SlideAddActions, DeckDialog, LayoutNameDialog } from "./slide-merge-navigator.jsx";
import { captureLayout, instantiateLayout, savedLayoutStore, studioSavedLayouts, studioLayoutElements } from "./slide-merge-layouts.mjs";
import { studioSourceData, studioIconRegistry } from "./slide-studio-source.mjs";
import { sectionMediaUrl, sectionPlainText } from "./slide-merge-sections.mjs";
import { sectionComponentPlan } from "./slide-merge-section-component.mjs";
import { nativeSectionElement, nativeSectionLayers } from "./slide-merge-native-sections.mjs";
import { fitAuthoredText } from "./slide-merge-authoring-fit.mjs";
import { fonts as authoringFonts } from "./slide-platform-fonts.mjs";
import { SlideProperties } from "./slide-merge-properties.jsx";
import { PROPERTY_LAYOUTS, slideSettings, slideOwnsFocus, layoutPlan, transitionMatch } from "./slide-merge-properties.mjs";
import { configureSlideSnapping } from "./slide-merge-snapping.mjs";
import "@excalidraw/excalidraw/index.css";
import "../../css/slide-lab.css";
import "../../css/slide-merge.css";
import "../../css/slide-merge-theme.css";
import { useMobilePanels } from "./slide-merge-mobile.jsx";
import { canvasTheme } from "./slide-merge-appearance.mjs";
import { NotesControls, RichNotesEditor, useNotesResize } from "./slide-merge-notes.jsx";
import { notesHtml } from "./slide-rich-text.mjs";
import { EmbeddedMedia, EmbedComposer } from "./slide-merge-embeds.jsx";
import { LayerPanel } from "./slide-merge-layers.jsx";
import { ActivityDialog, AllSlides, EditorBar, HistoryControls, StatusControls, useActivity } from "./slide-merge-bar.jsx";
import { VisibilityMenu, VisibilityConfirmation } from "./slide-merge-visibility.jsx";
import { presentDeckWithRenderer } from "./deck-presenter.mjs";
import "../../css/deck-presenter.css";
import "../../css/slide-merge-presenter.css";
import { setDeckVisibility } from "./slide-merge-visibility.mjs";
import { watchStudioTypography, typographySystem } from "./slide-merge-typography.mjs";
import { compileComposition } from "./slide-merge-composition.mjs";
import { compositionDeck } from "./slide-merge-ai.mjs";
import { loadCompositionData, improveSlideText } from "./slide-merge-ai-client.mjs";
import "../../css/slide-merge-controls.css";

function useAppearance() {
  const [appearance, setAppearance] = useState(() => document.documentElement.dataset.appearance || "dark");
  useEffect(() => watchStudioTypography(window, document), []);
  useEffect(() => {
    const update = () => setAppearance(document.documentElement.dataset.appearance || "dark");
    window.addEventListener("theme:change", update);
    update();
    return () => window.removeEventListener("theme:change", update);
  }, []);
  return appearance;
}

const paths = {
  help: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  add: "M12 5v14M5 12h14", copy: "M9 9h12v12H9zM15 9V3H3v12h6", trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  up: "M12 19V5m-7 7 7-7 7 7", down: "M12 5v14m-7-7 7 7 7-7", play: "m8 5 11 7-11 7Z", close: "m6 6 12 12M6 18 18 6",
  library: "M4 6v14M8 6v14M12 6v14M16 4l4 16",
  properties: "M4 7h16M4 17h16M8 4v6M16 14v6", slides: "M4 4h16v12H4ZM8 20h8",
  fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z", save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12ZM7 3v6h10V3M7 21v-8h10v8",
  image: "M3 3h18v18H3ZM3 16l6-6 4 4 3-3 5 5M8 7h.01", back: "M19 12H5m7-7-7 7 7 7", next: "M5 12h14m-7-7 7 7-7 7", sync: "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 17.9 17"
};
function Icon({ name }) { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
function Button({ icon, label, ...props }) { return <button className={`merge-icon ${icon === "trash" ? "is-danger" : ""}`} title={label} aria-label={label} {...props}><Icon name={icon} /></button>; }
function FitSlideControl({ api, host, disabled, onFit, mobile }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    if (!api || mobile) return;
    const mount = document.createElement("div");
    mount.className = "zoom-actions merge-fit-slot";
    const place = () => {
      const zoom = host.current?.querySelector(".zoom-actions:not(.merge-fit-slot)");
      if (!zoom) { mount.remove(); setSlot(null); return; }
      if (zoom.nextSibling !== mount) zoom.parentNode.insertBefore(mount, zoom.nextSibling);
      setSlot(mount);
    };
    const observer = new MutationObserver(place);
    observer.observe(host.current, { childList: true, subtree: true }); place();
    return () => { observer.disconnect(); mount.remove(); };
  }, [api, mobile]);
  return !mobile && slot && createPortal(<button className="ToolIcon_type_button ToolIcon_size_medium zoom-button ToolIcon_type_button--show ToolIcon" type="button" title="Fit slide" aria-label="Fit slide" disabled={disabled} onClick={onFit}><div className="ToolIcon__icon"><Icon name="fit" /></div></button>, slot);
}
function SectionComponent({ block, icons }) {
  const frame = useRef(null);
  const appearance = useAppearance();
  const send = () => {
    if (!frame.current?.contentDocument) return;
    const styles = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(["--text", "--text-dim", "--text-faint", "--accent", "--bg", "--bg-2", "--line-soft", "--sans", "--serif", "--mono"].map(key => [key, styles.getPropertyValue(key)]));
    frame.current?.contentWindow?.RK?.renderSectionComponent?.({ block, icons, tokens, appearance });
  };
  useEffect(send, [block, icons, appearance]);
  return <iframe ref={frame} className="lab-embed lab-section-component" title="Case-study section" src="/studio/slide-lab/native.html?fixture=component" allow="fullscreen; autoplay" allowFullScreen onLoad={send} />;
}
function Embed({ element, preview = false }) {
  if (element.customData?.labLayerHidden) return null;
  if (element.customData?.sectionComponent) return <SectionComponent block={element.customData.sectionComponent} icons={element.customData.sectionIcons} />;
  const video = element.customData?.sectionVideo;
  if (video && sectionMediaUrl(video)) return <video className="lab-embed" src={video} controls={!preview} muted={preview} playsInline preload="metadata" onLoadedMetadata={event => { if (preview && event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} />;
  const kind = element.customData?.fixture;
  return ["rich", "section", "video"].includes(kind) ? <iframe className="lab-embed" title={`Native ${kind}`} src={`/studio/slide-lab/native.html?fixture=${kind}`} /> : null;
}
const engineOptions = { tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } };
function NativeSections({ api, interactive = false }) {
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
  const appearance = useAppearance();
  const signature = JSON.stringify([elements, frame]);
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
function SectionThumbnail({ svg, elements, files, embeds = true }) {
  const host = useRef(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1280));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={host} className="merge-section-thumbnail" inert=""><span className="merge-section-thumbnail-scene" style={{ transform: `scale(${scale})` }}>{embeds && elements.filter(element => !element.isDeleted && !element.customData?.labLayerHidden && element.customData?.slideBackgroundVideo).map(element => <video key={element.id} className="merge-thumbnail-background" src={element.customData.slideBackgroundVideo} muted playsInline preload="metadata" onLoadedMetadata={event => { if (event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} />)}<span className="merge-section-thumbnail-svg" dangerouslySetInnerHTML={{ __html: svg }} />{embeds && elements.filter(element => !element.isDeleted && !element.customData?.labLayerHidden && element.type === "embeddable" && validEmbed(element.link)).map(element => <span key={element.id} className="merge-present-embed-preview" style={{ left:element.x, top:element.y, width:element.width, height:element.height, opacity:element.opacity / 100, transform:`rotate(${element.angle}rad)` }}><Embed element={element} preview /></span>)}<SectionLayers layers={nativeSectionLayers(elements, { zoom: { value: 1 }, scrollX: 0, scrollY: 0 })} files={files} preview /></span></span>;
}
function CanvasVideo({api}) {
  const [video,setVideo]=useState(null),[failed,setFailed]=useState(false);
  useEffect(()=>{if(!api)return;const update=(elements,state)=>{const element=elements.find(item=>!item.isDeleted&&!item.customData?.labLayerHidden&&item.customData?.slideBackgroundVideo);const next=element?{src:element.customData.slideBackgroundVideo,x:(state.scrollX+element.x)*state.zoom.value,y:(state.scrollY+element.y)*state.zoom.value,width:element.width*state.zoom.value,height:element.height*state.zoom.value}:null;setVideo(previous=>previous?.src===next?.src&&previous?.x===next?.x&&previous?.y===next?.y&&previous?.width===next?.width&&previous?.height===next?.height?previous:next);};update(api.getSceneElements(),api.getAppState());return api.onChange(update);},[api]);
  useEffect(()=>setFailed(false),[video?.src]);
  if(!video)return null;
  return <div className="merge-video-layer" style={{left:video.x,top:video.y,width:video.width,height:video.height}}>{failed?<div role="status">Video unavailable in this browser</div>:<video className="merge-background-video" src={video.src} autoPlay muted loop playsInline onError={()=>setFailed(true)} />}</div>;
}
function sceneBackground() { return "transparent"; }
function changed(element, update) { return { ...element, ...update, version: element.version + 1, versionNonce: Math.floor(Math.random()*2147483647), updated: Date.now() }; }
function validEmbed(link) { return /^https:\/\/slide-lab\.invalid\/(rich|section|video|background|section-video|section-component)$/.test(link); }

async function materialize(slide) {
  if (slide.scene) return { ...slide, scene: { ...slide.scene, elements: slide.scene.elements.map(nativeSectionElement) } };
  const layout = ["title", "columns"].includes(slide.fixture) ? contentSkeleton(slide.fixture, DEFAULT_SLIDE_FONT, crypto.randomUUID()) : null;
  const skeleton = platformText(layout ? [...layout, { ...fixtureSkeleton("flow").at(-1), children: layout.map(element => element.id) }] : slide.fixture === "blank" ? [fixtureSkeleton("flow").at(-1)] : fixtureSkeleton(slide.fixture));
  if (slide.fixture === "blank") skeleton[0].children = [];
  await loadPlatformFonts(skeleton);
  let elements = restoreElements(convertToExcalidrawElements(skeleton, { regenerateIds: false }), null, { repairBindings: true });
  elements = elements.map(element => element.id === FRAME_ID ? { ...element, x: 0, y: 0, width: 1280, height: 720, locked: true, name: slide.title } : element);
  const files = {};
  if (slide.fixture === "compatibility") files["fixture-image"] = { ...await originalImage(await createScreenshot()), id: "fixture-image" };
  return { ...slide, scene: packScene(elements, files, { viewBackgroundColor: sceneBackground(), zoom: { value: 1 }, scrollX: 0, scrollY: 0 }) };
}

async function prepareAuthoredSlide(plan) {
  const slide = await materialize({ id: crypto.randomUUID(), title: plan.title, notes: plan.notes, fixture: "blank", ...(plan.provenance ? { provenance: structuredClone(plan.provenance) } : {}) });
  await loadPlatformFonts(plan.elements);
  const context = document.createElement("canvas").getContext("2d");
  const fitted = plan.elements.map(element => fitAuthoredText(element, (text, size) => { context.font = `${size}px "${authoringFonts.find(font => font.id === element.fontFamily)?.family || "sans-serif"}"`; return context.measureText(text).width; }));
  const skeletons = new Map(fitted.map(element => [element.id, element]));
  const elements = restoreElements(convertToExcalidrawElements(fitted, { regenerateIds: false }).map(element => ({ ...element, frameId: FRAME_ID, ...(element.type === "text" ? { width: skeletons.get(element.id).width, autoResize: false } : {}) })), null, { repairBindings: true, refreshDimensions: true });
  slide.scene.elements.push(...elements);
  return slide;
}
function CompositionPreview({ plan }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState("");
  const appearance = useAppearance();
  useEffect(() => {
    let active = true;
    prepareAuthoredSlide(plan).then(async slide => {
      const svg = await exportToSvg({ elements: slide.scene.elements, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true, appState: { exportBackground: false, exportWithDarkMode: canvasTheme(slide.scene.elements, appearance) === "dark" } });
      if (active) setPreview(<SectionThumbnail svg={svg.outerHTML} elements={slide.scene.elements} files={slide.scene.files} />);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [plan, appearance]);
  return error ? <p role="alert">{error}</p> : preview;
}

function PresentationCanvas({ slides, index }) {
  const [api, setApi] = useState(null);
  const appearance = useAppearance();
  const stage = useRef(null);
  const previous=useRef(null),engine=useRef(null);
  const slide = slides[index];
  const fit = () => {
    if (api && stage.current) api.updateScene({ appState: { zoom: { value: stage.current.clientWidth / 1280 }, scrollX: 0, scrollY: 0 }, captureUpdate: CaptureUpdateAction.NEVER });
  };
  useEffect(() => {
    if (!api) return;
    const scene = structuredClone(slide.scene);
    api.resetScene();
    api.updateScene({ elements: scene.elements.map(element => element.id === FRAME_ID ? { ...element, name: "" } : element), appState: { ...scene.appState, viewModeEnabled: true, zenModeEnabled: true, theme:canvasTheme(scene.elements,appearance), viewBackgroundColor:sceneBackground(scene.elements), selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null }, captureUpdate: CaptureUpdateAction.NEVER });
    api.addFiles(Object.values(scene.files));
    const old=previous.current;previous.current={slide,index};
    let animationFrame=0,animation=null;
    const transition=slideSettings(scene.elements).transition||"fade";
    if(old&&old.slide.id!==slide.id&&!matchMedia("(prefers-reduced-motion: reduce)").matches&&transition!=="none") {
      if(transition==="magic") {
        const matches=transitionMatch(old.slide.scene.elements,scene.elements),start=performance.now();
        const tick=now=>{
          const progress=Math.min(1,(now-start)/520),ease=1-Math.pow(1-progress,3);
          const interpolated=matches.map(match=>{
            const target=match.next,source=match.previous;
            const update={};
            for(const key of ["x","y","width","height","angle","fontSize","opacity"]) if(Number.isFinite(target[key]))update[key]=source&&Number.isFinite(source[key])?source[key]+(target[key]-source[key])*ease:key==="opacity"?target[key]*ease:target[key];
            if(source?.points?.length===target.points?.length&&target.points)update.points=target.points.map((point,pointIndex)=>point.map((value,axis)=>source.points[pointIndex][axis]+(value-source.points[pointIndex][axis])*ease));
            return changed(target,update);
          });
          api.updateScene({elements:[...interpolated,scene.elements.find(element=>element.id===FRAME_ID)].filter(Boolean),captureUpdate:CaptureUpdateAction.NEVER});
          if(progress<1)animationFrame=requestAnimationFrame(tick);else api.updateScene({elements:scene.elements,captureUpdate:CaptureUpdateAction.NEVER});
        };animationFrame=requestAnimationFrame(tick);
      } else animation=engine.current.animate(transition==="push"?[{transform:`translateX(${index<old.index?-100:100}%)`},{transform:"translateX(0)"}]:[{opacity:0},{opacity:1}],{duration:520,easing:"cubic-bezier(.16,1,.3,1)"});
    }
    const observer = new ResizeObserver(fit); observer.observe(stage.current); fit();
    return () => { observer.disconnect();cancelAnimationFrame(animationFrame);animation?.cancel(); };
  }, [api, slide]);
  return <div className="merge-present-stage" ref={stage}><div className="merge-present-engine" ref={engine}><CanvasVideo api={api} /><NativeSections api={api} interactive /><Excalidraw excalidrawAPI={setApi} onScrollChange={fit} theme={canvasTheme(slide.scene.elements,appearance)} viewModeEnabled zenModeEnabled aiEnabled={false} handleKeyboardGlobally={false} UIOptions={engineOptions} renderEmbeddable={element => <Embed element={element} />} validateEmbeddable={validEmbed} /></div></div>;
}

function PresentationThumbnail({ slide }) {
  const [svg, setSvg] = useState("");
  const appearance = useAppearance();
  useEffect(() => {
    let active = true;
    setSvg("");
    if (slide) exportToSvg({ elements: slide.scene.elements, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true, appState: { exportBackground: false, exportWithDarkMode: canvasTheme(slide.scene.elements, appearance) === "dark" } }).then(result => { if (active) setSvg(result.outerHTML); }).catch(() => { if (active) setSvg(""); });
    return () => { active = false; };
  }, [slide, appearance]);
  return slide && svg ? <div className="merge-present-thumbnail" style={{ background:getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() }}><SectionThumbnail svg={svg} elements={slide.scene.elements} files={slide.scene.files} embeds /></div> : null;
}

function Presenter({ slides, index, onIndex, onClose, onSlideEdit }) {
  const callbacks = useRef({ onIndex, onClose, onSlideEdit });
  callbacks.current = { onIndex, onClose, onSlideEdit };
  useLayoutEffect(() => {
    const roots = new Map();
    const mount = (container, content) => {
      if (!roots.has(container)) roots.set(container, createRoot(container));
      roots.get(container).render(content);
    };
    const player = presentDeckWithRenderer({}, { slides, start: index, autoStart:true, onSlideEdit: (slide, key, value) => callbacks.current.onSlideEdit(slide.id, key, value), onClose: () => callbacks.current.onClose() }, {
      pjSlideTitle: slide => slide.title || "Untitled slide",
      pjNotesHtml: notes => notesHtml(notes) || '<span class="pjp__pnote-empty">No notes for this slide</span>',
      mountSlide: (frame, slide, nextIndex) => {
        frame.closest(".pjp").classList.add("pjp--canvas");
        mount(frame, <PresentationCanvas slides={slides} index={nextIndex} />);
        callbacks.current.onIndex(nextIndex);
      },
      renderThumbnail: (container, slide) => mount(container, <PresentationThumbnail slide={slide} />),
      thumbnailData: async slide => { const svg = await exportToSvg({elements:slide.scene.elements,files:slide.scene.files,exportingFrame:slide.scene.elements.find(element=>element.id===FRAME_ID),skipInliningFonts:true,appState:{exportBackground:false}});return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.outerHTML); },
      disposePresenter: document => { for (const [container, root] of roots) if (container.ownerDocument === document) { root.unmount(); roots.delete(container); } },
      dispose: () => { roots.forEach(root => root.unmount()); roots.clear(); }
    });
    return () => player?.close();
  }, []);
  return null;
}

function Merger() {
  const [api, setApi] = useState(null), [deck, setDeck] = useState(null), [busy, setBusy] = useState(true);
  const appearance = useAppearance();
  const library = useSlideLibrary(api, !busy);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const mobileUI = useMobilePanels(api);
  const [status, setStatus] = useState("Loading local draft"), [selection, setSelection] = useState("[]"), [hasSelection, setHasSelection] = useState(false);
  const [thumbnails, setThumbnails] = useState({}), [present, setPresent] = useState(null);
  const confirm = false;
  const [pane, setPane] = useState(null), [notesOpen, setNotesOpen] = useState(true);
  const [editing, setEditing] = useState(true), [slideView, setSlideView] = useState("current"), [historyTarget, setHistoryTarget] = useState(null);
  useEffect(() => {
    if (!api) return;
    return api.onChange((elements, state) => setPane(state.openSidebar?.name === "insert" ? state.openSidebar.tab : state.openSidebar ? "library" : null));
  }, [api]);
  const placeholderTarget = useRef(null);
  const [mediaPurpose, setMediaPurpose] = useState("insert");
  function openPane(next, toggle = true, placeholderId = null, purpose = "insert") {
    if (!editing && next) return;
    setMediaPurpose(purpose);
    placeholderTarget.current = placeholderId;
    const target = toggle && pane === next ? null : next;
    activity.write("nav", target ? `Opened ${target} panel` : "Closed side panel");
    if (mobileUI.mobile) mobileUI.open(target);
    else api.updateScene({ appState: { openSidebar: target ? { name: target === "library" ? "default" : "insert", tab: target } : null, openMenu: null, openPopup: null }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  function finishPaneInsert() { if (mobileUI.mobile) mobileUI.open(null); }
  const [deckDialog, setDeckDialog] = useState(null);
  const [savedLayouts, setSavedLayouts] = useState([]), [layoutTab, setLayoutTab] = useState("stock");
  const [layoutError, setLayoutError] = useState(""), [layoutSaveError, setLayoutSaveError] = useState("");
  async function refreshLayouts() {
    try { const source = await studioSourceData(); await registerStudioFonts(typographySystem(source), LabFontRegistry, FONT_FAMILY); setSavedLayouts([...(await savedLayoutStore()).sort((first, second) => second.created - first.created), ...studioSavedLayouts(source)]); setLayoutError(""); }
    catch { setLayoutError("Saved layouts could not be loaded."); }
  }
  useEffect(() => { refreshLayouts(); window.addEventListener("focus", refreshLayouts); window.addEventListener("storage", refreshLayouts); window.addEventListener("rk:studio-draft", refreshLayouts); return () => { window.removeEventListener("focus", refreshLayouts); window.removeEventListener("storage", refreshLayouts); window.removeEventListener("rk:studio-draft", refreshLayouts); }; }, []);
  const layoutPicker = { layouts: savedLayouts, tab: layoutTab, onTab: setLayoutTab, error: layoutError, onRetry: refreshLayouts,
    onRename: layout => { setLayoutSaveError(""); openDeckDialog({ kind: "rename-layout", layout }); },
    onDelete: layout => openDeckDialog({ kind: "delete-layout", layout }) };
  const [view, setView] = useState({ grid: false, snap: false, rulers: false, margins: false, thirds: false });
  const [settings,setSettings]=useState({}),[snapGuides,setSnapGuides]=useState(true);
  useEffect(() => {
    const frame = api?.getSceneElements().find(element => element.id === FRAME_ID);
    if (frame) configureSlideSnapping(frame, { ...view, gridSize: api.getAppState().gridSize, guidesEnabled: snapGuides, guides: settings.guides || [] });
  }, [api, view, snapGuides, settings]);
  const host = useRef(null), input = useRef(null);
  const editor = useRef(null);
  useEffect(() => {
    if (pane !== "library" || !host.current) return;
    const labelMenu = () => {
      const button = host.current.querySelector(".library-menu-dropdown-container > button");
      if (button) { button.setAttribute("aria-label", "Library actions"); button.title = "Library actions"; }
    };
    const observer = new MutationObserver(labelMenu);
    observer.observe(host.current, { childList:true, subtree:true }); labelMenu();
    return () => observer.disconnect();
  }, [pane]);
  const notesResize = useNotesResize(editor);
  useLayoutEffect(() => {
    const shell = host.current?.closest(".merge-shell"), rail = shell?.querySelector(".merge-slides");
    if (!rail) return;
    const measure = () => {
      const bounds = rail.getBoundingClientRect();
      shell.style.setProperty("--insert-rail-left", `${bounds.left + rail.clientLeft}px`);
      shell.style.setProperty("--insert-rail-top", `${bounds.top}px`);
      shell.style.setProperty("--insert-rail-width", `${rail.clientWidth}px`);
      shell.style.setProperty("--insert-rail-height", `${rail.clientHeight}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(rail); observer.observe(shell); measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const sectionSelection = useRef(null);
  useEffect(() => {
    if (busy || !api || !sectionSelection.current) return;
    const frame = requestAnimationFrame(() => {
      api.updateScene({ appState: sectionSelection.current, captureUpdate: CaptureUpdateAction.NEVER });
      sectionSelection.current = null;
      host.current?.querySelector(".excalidraw")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, api]);
  const resize = useRef(null);
  const [paneWidth, setPaneWidth] = useState(() => {
    try { return slidePaneWidth(localStorage.getItem("rk:slide-merge:rail-width"), innerWidth); } catch { return 200; }
  });
  const [resizing, setResizing] = useState(false);
  function storePaneWidth(value) {
    const width = slidePaneWidth(value, innerWidth);
    setPaneWidth(width);
    try { localStorage.setItem("rk:slide-merge:rail-width", String(width)); } catch {}
  }
  function finishResize(event, cancel = false) {
    if (!resize.current) return;
    storePaneWidth(cancel ? resize.current.width : paneWidth);
    resize.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const live = useRef({ deck: null, ready: false, timer: null, version: -1, queue: Promise.resolve(), revision: 0, savedRevision: 0 });
  live.current.improveText = () => run(async () => {
    if (!editing) return;
    const selected = api.getAppState().selectedElementIds;
    const scene = api.getSceneElements();
    const texts = scene.filter(element => element.type === "text" && (selected[element.id] || selected[element.containerId]) && !element.locked && !scene.find(container => container.id === element.containerId)?.locked);
    if (!texts.length) return;
    await save();
    if (texts.length > 12) throw new Error("Select up to 12 text elements to improve at once.");
    const replacements = new Map();
    for (const element of texts) {
      const value = String(await improveSlideText(element.originalText || element.text)).trim();
      if (!value) throw new Error("AI returned no text. The original is unchanged.");
      replacements.set(element.id, value);
    }
    const context = document.createElement("canvas").getContext("2d");
    const elements = api.getSceneElementsIncludingDeleted().map(element => {
      const text = replacements.get(element.id); if (text === undefined) return element;
      return fitAuthoredText(changed(element, { text, originalText: text, autoResize: false }), (value, size) => { context.font = `${size}px "${authoringFonts.find(font => font.id === element.fontFamily)?.family || "sans-serif"}"`; return context.measureText(value).width; }, Math.min(18, element.fontSize));
    });
    api.updateScene({ elements: restoreElements(elements, null, { repairBindings: true, refreshDimensions: true }), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    await save();
  });
  useEffect(() => { const improve = () => live.current.improveText?.(); document.addEventListener("rk:improve-slide-text", improve); return () => document.removeEventListener("rk:improve-slide-text", improve); }, []);
  const deckHistory = useRef(createDeckHistory());
  const [, refreshHistory] = useState(0);
  useEffect(() => {
    let scheduled = 0;
    const begin = event => {
      if (event.button !== 0 || !editor.current?.contains(event.target) || !live.current.ready || live.current.operating) return;
      capture();
      if (deckHistory.current.record(live.current.deck)) refreshHistory(value => value + 1);
      live.current.gesture = event.pointerId;
    };
    const finish = event => {
      if (live.current.gesture == null || event.pointerId !== undefined && event.pointerId !== live.current.gesture) return;
      live.current.gesture = null;
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => { if (live.current.ready && !live.current.operating) save().catch(fail); });
    };
    document.addEventListener("pointerdown", begin, true);
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", finish);
    return () => { cancelAnimationFrame(scheduled); document.removeEventListener("pointerdown", begin, true); document.removeEventListener("pointerup", finish, true); document.removeEventListener("pointercancel", finish, true); window.removeEventListener("blur", finish); };
  }, [api]);
  live.current.editing = editing;
  const activity = useActivity(api, live);
  const current = deck?.slides.find(slide => slide.id === deck.selected);
  const selectedIndex = deck?.slides.findIndex(slide => slide.id === deck.selected) ?? 0;
  const rehearsal = deck ? presentationSlides(deck) : [];
  const labels = JSON.parse(selection);
  useEffect(() => {
    live.current.deck?.slides.forEach(slide => thumbnail(slide).catch(fail));
  }, [appearance]);
  function fail(error) { activity.write("error", "Editor operation or local save failed"); setStatus(`Not saved: ${error.message}`); }
  function paint(next, restoring = false) {
    const previous = live.current.deck;
    if (previous) {
      if (previous.title !== next.title) activity.pending("Changed deck title");
      if (previous.slides.length !== next.slides.length) activity.note(`Slide count ${previous.slides.length} -> ${next.slides.length}`);
      else if (previous.slides.map(slide => slide.id).join() !== next.slides.map(slide => slide.id).join()) activity.note("Reordered slides");
      for (const slide of next.slides) {
        const old = previous.slides.find(item => item.id === slide.id);
        if (!old) continue;
        for (const key of ["notes", "durationMinutes", "title", "section", "hidden"]) if (old[key] !== slide[key]) activity.pending(`Changed slide ${key}`);
      }
      if (previous.selected !== next.selected) activity.write("nav", `Current slide ${next.slides.findIndex(slide => slide.id === next.selected) + 1}`);
    }
    live.current.deck = next; setDeck({ ...next });
  }
  function capture() {
    const state = live.current;
    if (!state.ready) return;
    const slide = state.deck.slides.find(item => item.id === state.deck.selected);
    if (!slide) return;
    slide.scene = packScene(api.getSceneElementsIncludingDeleted(), api.getFiles(), api.getAppState());
    const usedFonts = new Set(state.deck.slides.flatMap(slide => slide.scene?.elements.filter(element => element.type === "text").map(element => element.fontFamily) || []));
    const definitions = authoringFonts.filter(font => font.runtime && usedFonts.has(font.id));
    if (definitions.length) state.deck.fonts = structuredClone(definitions);
  }
  async function thumbnail(slide) {
    const svg = await exportToSvg({ elements: slide.scene.elements.filter(element => !element.isDeleted), appState: { ...slide.scene.appState, exportBackground: false, exportWithDarkMode:canvasTheme(slide.scene.elements,document.documentElement.dataset.appearance)==="dark" }, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true });
    const preview = <SectionThumbnail svg={svg.outerHTML} elements={slide.scene.elements} files={slide.scene.files} />;
    setThumbnails(previous => ({ ...previous, [slide.id]: preview }));
  }
  async function save(recordHistory = true) {
    clearTimeout(live.current.timer); live.current.timer = null; activity.flush(); capture();
    if (!live.current.deck) return;
    const snapshot = structuredClone(live.current.deck), revision = live.current.revision;
    const state = api?.getAppState();
    if (recordHistory && live.current.gesture == null && !state?.isDragging && !state?.isResizing) { deckHistory.current.record(snapshot); refreshHistory(value => value + 1); }
    if (!recordHistory) deckHistory.current.acceptCurrent(snapshot);
    live.current.queue = live.current.queue.catch(() => {}).then(() => deckStore(snapshot));
    await live.current.queue;
    live.current.savedRevision = revision;
    if (revision === live.current.revision) { setStatus("Saved on this device"); activity.write("sys", "Local draft saved"); }
    const slide = snapshot.slides.find(item => item.id === snapshot.selected);
    if (slide?.scene) thumbnail(slide).catch(() => {});
  }
  function schedule() {
    live.current.revision++; clearTimeout(live.current.timer); setStatus("Saving...");
    live.current.timer = setTimeout(() => save().catch(fail), 500);
  }
  function fit() {
    if (!api || !host.current) return;
    const canvas = host.current.querySelector(".lab-canvas");
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const viewingInset = innerWidth > 900 ? 48 : 24;
    const left=live.current.editing?innerWidth>900?280:16:viewingInset,right=live.current.editing?innerWidth>900?32:16:viewingInset;
    const controls = host.current.querySelector(innerWidth > 900 ? ".merge-canvas-presenter-controls" : ".merge-mobile-canvas-controls");
    const top = live.current.editing ? innerWidth > 900 ? 90 : 16 : viewingInset;
    const bottom = Math.max(live.current.editing && innerWidth > 900 ? 90 : viewingInset, (controls?.offsetHeight || 36) + 24);
    const zoom = Math.max(.01, Math.min((width - left - right) / 1280, (height - top - bottom) / 720, 1));
    const scrollX = (left+(width-left-right-1280*zoom)/2)/zoom, scrollY = (top+(height-top-bottom-720*zoom)/2)/zoom;
    const state = api.getAppState();
    if (Math.abs(state.zoom.value-zoom)<.00001 && Math.abs(state.scrollX-scrollX)<.01 && Math.abs(state.scrollY-scrollY)<.01) return;
    api.updateScene({ appState: { zoom: { value: zoom }, scrollX, scrollY }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  async function mountSlide(slide) {
    placeholderTarget.current = null;
    live.current.ready = false;
    if (!slide) {
      api.resetScene(); api.history.clear();
      setSelection("[]"); setHasSelection(false);
      openPane(null, false); setSlideView("current");
      return;
    }
    await loadPlatformFonts(slide.scene.elements);
    api.resetScene();
    api.updateScene({ elements: restoreElements(slide.scene.elements, null, { repairBindings: true }), appState: { ...slide.scene.appState, viewModeEnabled: !live.current.editing, frameRendering: { enabled: true, name: live.current.editing, outline: live.current.editing, clip: true }, theme:canvasTheme(slide.scene.elements,appearance), viewBackgroundColor:sceneBackground(slide.scene.elements), currentItemFontFamily: DEFAULT_SLIDE_FONT, currentItemRoughness: 0, selectedElementIds: {}, gridModeEnabled: view.grid, objectsSnapModeEnabled: view.snap }, captureUpdate: CaptureUpdateAction.NEVER });
    api.addFiles(Object.values(slide.scene.files));
    api.history.clear(); live.current.version = getSceneVersion(slide.scene.elements); live.current.ready = true;
    setSettings(slideSettings(slide.scene.elements));
    activity.reset(slide);
    setSelection("[]"); setHasSelection(false); requestAnimationFrame(fit);
  }
  async function run(operation) {
    if (live.current.operating) return;
    live.current.operating = true; setBusy(true);
    try { return await operation(); } catch (error) { fail(error); } finally { live.current.operating = false; setBusy(false); }
  }
  const selectedSlideFocus = useRef(null);
  React.useLayoutEffect(() => {
    if (busy) return;
    const trigger = selectedSlideFocus.current;
    selectedSlideFocus.current = null;
    if (trigger?.isConnected && document.activeElement === document.body) trigger.focus();
  }, [busy]);
  async function choose(id) {
    const trigger = document.activeElement?.closest(".merge-slide");
    selectedSlideFocus.current = trigger;
    await run(async () => { await save(); if (id !== live.current.deck.selected) { const next = { ...live.current.deck, selected: id }; paint(next); await mountSlide(next.slides.find(slide => slide.id === id)); await save(); } });
  }
  function modify(action, id = live.current.deck.selected) { return run(async () => {
    if (!live.current.editing) return;
    await save(); const next = changeSlides(live.current.deck, action, id, crypto.randomUUID());
    paint(next); await mountSlide(next.slides.find(slide => slide.id === next.selected)); await save();
  }); }
  function restoreHistory(direction) { return run(async () => {
    if (present !== null || deckDialog) return;
    await save();
    const next = deckHistory.current[direction]();
    if (!next) return;
    paint(next, true); await mountSlide(next.slides.find(slide => slide.id === next.selected));
    live.current.revision++; refreshHistory(value => value + 1); await save(false);
    for (const slide of next.slides) thumbnail(slide).catch(() => {});
    activity.note(direction === "undo" ? "Deck change undone" : "Deck change redone");
  }); }
  async function removeSlide(id) {
    if (busy || !live.current.editing || present !== null || deckDialog) return;
    const sorter = slideView === "all";
    await modify("delete", id);
    requestAnimationFrame(() => {
      const selected = live.current.deck.selected;
      const cards = document.querySelectorAll("[data-slide-delete-id]");
      if (!selected) document.querySelector(".merge-empty-actions button")?.focus();
      else [...cards].find(card => card.dataset.slideDeleteId === selected && !!card.closest(".merge-all-slides") === sorter)?.querySelector(".merge-slide, .merge-all-open")?.focus();
    });
  }
  function deleteSlideKey(event) {
    if (!["Delete", "Backspace"].includes(event.key) || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.target.closest("input, textarea, select, [contenteditable], dialog, [role=dialog]")) return;
    const card = event.target.closest("[data-slide-delete-id]");
    if (!card) return;
    event.preventDefault(); event.stopPropagation();
    removeSlide(card.dataset.slideDeleteId);
  }
  function add(layout = "blank", beforeId = null) { return run(async () => {
    if (!live.current.editing) return;
    const saved = savedLayouts.find(item => item.id === layout);
    const stock = PROPERTY_LAYOUTS.find(item => item.id === layout);
    if (!saved && !stock) throw new Error("This layout is no longer available");
    await save(); const slide = await materialize({ id: crypto.randomUUID(), title: layout === "blank" ? "Untitled slide" : (saved || stock).name, notes: "", fixture: "blank" });
    if (saved) {
      const instance = await layoutInstance(saved);
      slide.scene.elements = instance.elements.map(element => element.id === FRAME_ID ? { ...element, name: slide.title } : element);
      slide.scene.files = instance.files;
    } else if (layout !== "blank") {
      const plan = layoutPlan(slide.scene.elements, layout, DEFAULT_SLIDE_FONT, crypto.randomUUID());
      await loadPlatformFonts(plan.additions);
      const slots = new Map(plan.additions.map(element => [element.id, element]));
      const additions = restoreElements(convertToExcalidrawElements(plan.additions, { regenerateIds: false }).map(element => element.type === "text" ? { ...element, ...slots.get(element.id), originalText: slots.get(element.id).text, autoResize: false } : element), null, { repairBindings: true, refreshDimensions: true });
      slide.scene.elements = [...slide.scene.elements.map(element => element.id === FRAME_ID ? { ...element, customData: { ...element.customData, slideSettings: { ...slideSettings(slide.scene.elements), layout } } } : element), ...additions];
    }
    const next = insertSlide(live.current.deck, slide, beforeId);
    paint(next); await mountSlide(slide); await save();
  }); }
  function openDeckDialog(value) { if (!live.current.editing) return; mobileUI.open(null); setDeckDialog(value); }
  function saveLayout(name) { return run(async () => {
    try {
      setLayoutSaveError("");
      let layout;
      if (deckDialog.kind === "rename-layout") layout = { ...deckDialog.layout, name: name.trim().slice(0, 120) };
      else {
        await save();
        const scene = live.current.deck.slides.find(slide => slide.id === live.current.deck.selected).scene;
        layout = captureLayout(name, scene);
        const svg = await exportToSvg({ elements: layout.elements, files: layout.files, appState: { exportBackground: false, exportWithDarkMode: false }, exportingFrame: layout.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true });
        layout.preview = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
      }
      await savedLayoutStore("put", layout);
      await refreshLayouts(); setLayoutTab("user"); setDeckDialog(null); setStatus("Layout saved on this device");
    } catch (error) { setLayoutSaveError(error.message); }
  }); }
  function deleteLayout(layout) { return run(async () => {
    await savedLayoutStore("delete", layout); await refreshLayouts(); setDeckDialog(null); setStatus("Layout deleted");
  }); }
  async function layoutInstance(layout) {
    if (layout.source !== "studio") return instantiateLayout(layout);
    const source = await studioSourceData(), registry = await studioIconRegistry();
    registry.registerIcons(source.customIcons || {});
    const styles = getComputedStyle(document.documentElement);
    const color = value => { const match = /^var\((--[\w-]+)\)$/.exec(value); return match ? styles.getPropertyValue(match[1]).trim() || "#ece7e1" : value; };
    const font = block => { const role = block.font === "mono" || block.role === "kicker" ? "--mono" : block.font === "serif" ? "--serif" : "--sans"; const family = styles.getPropertyValue(role).split(",")[0].replace(/["']/g, "").trim(); return authoringFonts.find(font => font.family === family)?.id || DEFAULT_SLIDE_FONT; };
    const skeleton = studioLayoutElements(layout, font, color), files = {};
    for (const element of skeleton.filter(element => element.type === "image")) {
      const svg = registry.iconSvg(element.customData.studioLayoutBlock.name || "star");
      const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      root.setAttribute("xmlns", "http://www.w3.org/2000/svg"); root.setAttribute("width", "96"); root.setAttribute("height", "96"); root.setAttribute("color", color(element.customData.studioLayoutBlock.color || "var(--text)"));
      const file = await originalImage(new File([new XMLSerializer().serializeToString(root)], "layout-icon.svg", { type: "image/svg+xml" }));
      files[file.id] = file; element.fileId = file.id;
    }
    const slots = new Map(skeleton.map(element => [element.id, element]));
    const elements = restoreElements(convertToExcalidrawElements(skeleton, { regenerateIds: false }).map(element => element.type === "text" ? { ...element, width: slots.get(element.id).width, autoResize: false } : element), null, { repairBindings: true, refreshDimensions: true });
    const blank = await materialize({ title: layout.name, fixture: "blank" });
    return instantiateLayout({ ...layout, elements: [...blank.scene.elements, ...elements], files });
  }
  function useSavedLayout(layout) { return run(async () => {
    const instance = await layoutInstance(layout);
    await loadPlatformFonts(instance.elements);
    const elements = api.getSceneElementsIncludingDeleted();
    const frame = elements.find(element => element.id === FRAME_ID);
    const additions = restoreElements(instance.elements.map(element => element.id === FRAME_ID ? changed(frame, { customData: element.customData }) : element), null, { repairBindings: true });
    api.addFiles(Object.values(instance.files));
    const next = [...elements.filter(element => element.id !== FRAME_ID).map(element => changed(element, { isDeleted: true })), ...additions];
    commitSettings({ layout: layout.id }, next);
    await save(); setDeckDialog(null);
  }); }
  function chooseLayout(id) {
    const layout = savedLayouts.find(item => item.id === id);
    if (layout) openDeckDialog({ kind: "apply-layout", layout });
    else applyLayout(id);
  }
  function saveSection(id, name) { return run(async () => { if (!live.current.editing) return; await save(); paint(setSlideSection(live.current.deck, id, name)); await save(); }); }
  function reorder(id, targetId, kind, edge) { return run(async () => { if (!live.current.editing) return; await save(); paint(reorderSlides(live.current.deck, id, targetId, kind, edge)); await save(); }); }
  async function prepareSection(block, resources) {
    const plan = sectionComponentPlan(block, sectionPlainText, crypto.randomUUID(), resources);
    const slide = await materialize({ id: crypto.randomUUID(), title: plan.title, notes: plan.notes, fixture: "blank" });
    const additions = [...plan.elements];
    await loadPlatformFonts(additions);
    const skeletons = new Map(additions.map(element => [element.id, element]));
    const elements = restoreElements(convertToExcalidrawElements(additions, { regenerateIds: false }).map(element => element.type === "text" ? { ...element, width: skeletons.get(element.id).width, autoResize: false } : element), null, { repairBindings: true, refreshDimensions: true });
    return { slide, elements };
  }
  async function applyAiComposition(proposal, studyId, mode) {
    if (live.current.operating || !live.current.editing) throw new Error("The editor is busy. Try again.");
    live.current.operating = true; setBusy(true);
    try {
      await save();
      const source = await loadCompositionData();
      const selected = { ...source, work: source.work?.filter(study => study.id === studyId) || [] };
      const compiled = await compileComposition(proposal, selected, { plain: sectionPlainText, fontFamily: DEFAULT_SLIDE_FONT });
      const slides = [];
      for (const plan of compiled.slides) {
        slides.push(await prepareAuthoredSlide(plan));
      }
      const next = compositionDeck(live.current.deck, slides, compiled.title, mode);
      live.current.queue = live.current.queue.catch(() => {}).then(() => deckStore(next));
      await live.current.queue;
      paint(next);
      await mountSlide(next.slides.find(slide => slide.id === next.selected));
      await save();
      setSlideView("current"); setStatus("Saved on this device");
      activity.note(`AI proposal ${mode === "append" ? "appended" : "replaced deck"}`, "sys");
    } finally { live.current.operating = false; setBusy(false); }
  }
  function addFromSection(block, intoCurrent = false, resources) { setDeckDialog(null); return run(async () => {
    await save();
    const prepared = [];
    for (const sourceBlock of (intoCurrent ? [block] : Array.isArray(block) ? block : [block])) {
      prepared.push(await prepareSection(sourceBlock, resources));
    }
    if (!prepared.length) return;
    if (intoCurrent) {
      const { slide, elements } = prepared[0];
      const groupId = crypto.randomUUID();
      sectionSelection.current = { selectedElementIds: Object.fromEntries(elements.map(element => [element.id, true])), selectedGroupIds: { [groupId]: true } };
      api.addFiles(Object.values(slide.scene.files));
      api.setActiveTool({ type: "selection" });
      api.updateScene({ elements: insertIntoPlaceholder(elements.map(element => ({ ...element, groupIds: [groupId] }))), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    } else {
      const next = prepared.reduce((result, { slide, elements }) => {
        slide.scene.elements.push(...elements);
        return insertSlide(result, slide);
      }, live.current.deck);
      paint(next); await mountSlide(prepared[prepared.length - 1].slide);
      openPane(null, false);
    }
    await save();
  }); }
  function onChange(elements, state) {
    if (!live.current.ready || live.current.operating) return;
    setView(previous => previous.grid === state.gridModeEnabled && previous.snap === state.objectsSnapModeEnabled ? previous : { ...previous, grid: state.gridModeEnabled, snap: state.objectsSnapModeEnabled });
    const fixed = preserveLabelColors(elements);
    if (fixed !== elements) { api.updateScene({ elements: fixed, captureUpdate: CaptureUpdateAction.NEVER }); return; }
    setHasSelection(!slideOwnsFocus(elements,state));
    const nextSettings=slideSettings(elements);
    setSettings(previous=>previous===nextSettings?previous:nextSettings);
    const snapFrame = elements.find(element => element.id === FRAME_ID);
    if (snapFrame) configureSlideSnapping(snapFrame, { ...view, snap: state.objectsSnapModeEnabled, grid: state.gridModeEnabled, gridSize: state.gridSize, guidesEnabled: snapGuides, guides: nextSettings.guides || [] });
    const next = JSON.stringify(selectedLabels(elements, state.selectedElementIds).map(element => ({ id: element.id, color: element.strokeColor, linked: !element.customData?.labTextColor })));
    setSelection(previous => previous === next ? previous : next);
    const version = getSceneVersion(elements);
    if (version !== live.current.version) { live.current.version = version; schedule(); }
  }
  function metadata(key, value, isDeck = false) {
    if (!live.current.editing && (isDeck || !["notes", "durationMinutes"].includes(key))) return;
    const next = { ...live.current.deck, slides: live.current.deck.slides.map(slide => !isDeck && slide.id === live.current.deck.selected ? { ...slide, [key]: value } : slide) };
    if (isDeck) next[key] = value;
    paint(next); schedule();
  }
  async function presenterMetadata(id, key, value) {
    if (!["notes", "durationMinutes"].includes(key)) return;
    paint({ ...live.current.deck, slides: live.current.deck.slides.map(slide => slide.id === id ? { ...slide, [key]: value } : slide) });
    schedule();
    await save();
  }
  function toggleNotes() { if (mobileUI.mobile) mobileUI.open(mobileUI.panel === "notes" ? null : "notes"); else setNotesOpen(open => !open); }
  function changeVisibility(isPublic) {
    if (busy || !live.current.ready) return;
    capture();
    paint(setDeckVisibility(live.current.deck, isPublic ? "public" : "private"));
    activity.note(isPublic ? "Public draft selected" : "Owner-only draft selected");
    schedule(); setDeckDialog(null);
  }
  function changeView(key, value) {
    activity.write("sys", `${key} ${value ? "enabled" : "disabled"}`);
    setView(previous => ({ ...previous, [key]: value }));
    if (key === "grid" || key === "snap") api.updateScene({ appState: { [key === "grid" ? "gridModeEnabled" : "objectsSnapModeEnabled"]: value }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  function commitSettings(update,elements=api.getSceneElementsIncludingDeleted()) {
    const nextSettings={...slideSettings(elements),...update};
    const next=elements.map(element=>element.id===FRAME_ID?changed(element,{customData:{...element.customData,slideSettings:nextSettings}}):element);
    api.updateScene({elements:next,appState:{selectedElementIds:{},viewBackgroundColor:sceneBackground(next)},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
    setSettings(nextSettings);setHasSelection(false);schedule();
  }
  function applyLayout(layout) { return run(async()=>{
    const elements=api.getSceneElementsIncludingDeleted(),plan=layoutPlan(elements,layout,DEFAULT_SLIDE_FONT,crypto.randomUUID());
    await loadPlatformFonts(plan.additions);
    const updates=new Map(plan.updates.map(update=>[update.id,update]));
    const next=elements.map(element=>plan.removed.includes(element.id)?changed(element,{isDeleted:true}):updates.has(element.id)?changed(element,updates.get(element.id)):element);
    const slots=new Map(plan.additions.map(element=>[element.id,element]));
    const additions=restoreElements(convertToExcalidrawElements(plan.additions,{regenerateIds:false}).map(element=>element.type==="text"?{...element,...slots.get(element.id),originalText:slots.get(element.id).text,autoResize:false}:element),null,{repairBindings:true,refreshDimensions:true});
    const restored=restoreElements([...next.filter(element=>element.id!==FRAME_ID),...additions,next.find(element=>element.id===FRAME_ID)],null,{repairBindings:true,refreshDimensions:true});
    commitSettings({layout},restored);await save();
  }); }
  async function applyBackground(background,file) {
    const elements=api.getSceneElementsIncludingDeleted().map(element=>element.customData?.slideBackground?changed(element,{isDeleted:true}):element);
    let additions=[];
    if(background) {
      const skeleton={id:crypto.randomUUID(),x:0,y:0,width:1280,height:720,locked:true,frameId:FRAME_ID,roughness:0,strokeWidth:0,strokeColor:"transparent",fillStyle:"solid",customData:{slideBackground:true}};
      if(background.type==="color")Object.assign(skeleton,{type:"rectangle",backgroundColor:background.color});
      else if(file?.mimeType?.startsWith("video/"))Object.assign(skeleton,{type:"rectangle",backgroundColor:"transparent",opacity:0,customData:{...skeleton.customData,slideBackgroundVideo:file.dataURL}});
      else {
        const scale=Math.max(1280/file.width,720/file.height),width=1280/scale,height=720/scale;
        Object.assign(skeleton,{type:"image",fileId:file.id,scale:[1,1],crop:{x:(file.width-width)/2,y:(file.height-height)/2,width,height,naturalWidth:file.width,naturalHeight:file.height}});
      }
      additions=restoreElements(convertToExcalidrawElements([skeleton],{regenerateIds:false}),null,{repairBindings:true});
    }
    commitSettings({background},[...additions,...elements]);if(file&&!file.mimeType.startsWith("video/"))api.addFiles([file]);await save();
  }
  function setBackground(background,file) { return file ? run(() => applyBackground(background,file)) : applyBackground(background,file).catch(fail); }
  function insertIntoPlaceholder(additions) {
    const elements = api.getSceneElementsIncludingDeleted();
    const slot = elements.find(element => element.id === placeholderTarget.current && !element.isDeleted && !element.locked && element.customData?.slidePlaceholder);
    placeholderTarget.current = null;
    return [...elements.map(element => element === slot ? changed(element, {isDeleted:true}) : element), ...fitPlaceholder(additions, slot)];
  }
  function insertContent(kind, badge, diagram = false) { return run(async () => {
    const skeleton = diagram ? diagramSkeleton(kind, crypto.randomUUID()) : contentSkeleton(kind, DEFAULT_SLIDE_FONT, crypto.randomUUID(), badge);
    await loadPlatformFonts(skeleton);
    const elements = restoreElements(convertToExcalidrawElements(skeleton, { regenerateIds: false }), null, { repairBindings: true });
    api.setActiveTool({ type: "selection" });
    api.updateScene({ elements: insertIntoPlaceholder(elements), appState: { selectedElementIds: Object.fromEntries(elements.map(element => [element.id, true])) }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    await save();
  }); }
  function importImage(file, studioIcon = false) { if (!live.current.editing) return; return run(() => insertImage(file, studioIcon)); }
  function addEmbed() { return run(async () => {
    await save(); openPane(null, false);
    const pending = api.getSceneElements().find(element => element.customData?.pendingEmbed);
    if (pending) { api.updateScene({ appState: { selectedElementIds: { [pending.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER }); requestAnimationFrame(() => document.querySelector('[aria-label="Embed media link"]')?.focus()); return; }
    const element = restoreElements(convertToExcalidrawElements([{ type: "rectangle", id: crypto.randomUUID(), frameId: FRAME_ID, x: 320, y: 180, width: 640, height: 360, roughness: 0, strokeColor: "#8f8a84", backgroundColor: "transparent", customData: { pendingEmbed: true } }]), null, { repairBindings: true })[0];
    api.updateScene({ elements: insertIntoPlaceholder([element]), appState: { selectedElementIds: { [element.id]: true }, activeTool: { type: "selection" } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    await save();
  }); }
  function commitEmbed(id, url) { return run(async () => {
    const elements = api.getSceneElementsIncludingDeleted();
    api.updateScene({ elements: elements.map(element => element.id === id ? changed(element, { strokeColor: "transparent", backgroundColor: "rgba(0, 0, 0, 0)", fillStyle: "solid", customData: { ...element.customData, pendingEmbed: false, slideEmbed: { url } } }) : element), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    await save();
  }); }
  async function insertImage(file, studioIcon = false) {
    if (!file || !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(file.type)) throw new Error("Choose PNG, JPEG, WebP, GIF, AVIF or SVG");
    const image = await originalImage(file), width = Math.min(640, image.width);
    const elements=api.getSceneElementsIncludingDeleted(),selected=api.getAppState().selectedElementIds;
    const placeholder=!placeholderTarget.current&&!studioIcon&&elements.find(element=>!element.isDeleted&&!element.locked&&selected[element.id]&&element.customData?.slidePlaceholder?.kind==="media");
    const scale=placeholder?Math.min(placeholder.width/image.width,placeholder.height/image.height):width/image.width;
    const element = restoreElements(convertToExcalidrawElements([{ type: "image", fileId: image.id, x: placeholder?placeholder.x+(placeholder.width-image.width*scale)/2:160, y: placeholder?placeholder.y+(placeholder.height-image.height*scale)/2:160, width:image.width*scale, height:image.height*scale, scale: [1, 1], frameId: FRAME_ID }]), null, { repairBindings:true })[0];
    api.updateScene({ elements: placeholderTarget.current ? insertIntoPlaceholder([element]) : [...elements.map(item=>item.id===placeholder?.id?changed(item,{isDeleted:true}):item), element], appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY }); api.addFiles([image]);
    await save();
    return true;
  }
  function importMedia(source, asBackground = false) {
    if (!source || !live.current.editing) return;
    return run(async () => {
      let file = source, videoUrl, videoMime;
      if (source.url) {
        const url = sectionMediaUrl(source.url);
        if (!url) throw new Error("This media URL is unavailable");
        const response = await fetch(url, { credentials:"omit", cache:"no-store", signal:AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("Media could not be loaded");
        if ((response.headers.get("content-type") || "").startsWith("video/")) { videoMime = response.headers.get("content-type").split(";")[0]; await response.body?.cancel(); videoUrl = url; }
        else file = await response.blob();
      }
      if (!videoUrl && /^video\/(mp4|webm|quicktime|ogg)$/.test(file.type)) {
        videoMime = file.type;
        videoUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      }
      if (asBackground) {
        if (!videoUrl && !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(file.type)) throw new Error("Choose an image or video supported by Media");
        const original = videoUrl ? { id: crypto.randomUUID(), mimeType: videoMime, dataURL: videoUrl } : await originalImage(file);
        await applyBackground({ type: "media", name: source.name || source.title || (videoUrl ? "Video" : "Image"), mimeType: original.mimeType }, original);
      } else if (videoUrl) {
        const element = restoreElements(convertToExcalidrawElements([{type:"embeddable",id:crypto.randomUUID(),x:320,y:180,width:640,height:360,frameId:FRAME_ID,link:"https://slide-lab.invalid/section-video",customData:{sectionVideo:videoUrl},backgroundColor:"transparent",strokeColor:"transparent"}]), null, { repairBindings:true })[0];
        api.updateScene({elements:insertIntoPlaceholder([element]),appState:{selectedElementIds:{[element.id]:true}},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
        await save();
      } else await insertImage(file);
      finishPaneInsert();
    });
  }
  function receive(event) {
    if (!live.current.deck?.selected) return;
    const files = [...(event.clipboardData?.files || event.dataTransfer?.files || [])];
    if (files.length) { event.preventDefault(); event.stopPropagation(); if (!busy && editing) importMedia(files[0]); }
  }
  useEffect(() => {
    if (!api) return;
    run(async () => {
      const stored = await deckStore();
      if (stored && (stored.version !== 1 || !Array.isArray(stored.slides))) throw new Error("Unsupported deck format");
      if (stored?.fonts) await registerStudioFonts(null, LabFontRegistry, FONT_FAMILY, stored.fonts);
      const next = stored || createDeck(); next.slides = await Promise.all(next.slides.map(materialize));
      if (!next.slides.some(slide => slide.id === next.selected)) next.selected = next.slides[0]?.id ?? null;
      paint(next); await mountSlide(next.slides.find(slide => slide.id === next.selected)); await save();
      next.slides.forEach(slide => thumbnail(slide).catch(() => {}));
    });
    const flush = () => { if (document.visibilityState === "hidden") save().catch(fail); };
    const leave = event => { if (live.current.revision !== live.current.savedRevision) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", flush); window.addEventListener("beforeunload", leave);
    const observer = new ResizeObserver(fit); observer.observe(host.current.querySelector(".lab-canvas"));
    window.__slideMerge = { api, save, choose, importImage, deck: () => structuredClone(live.current.deck) };
    return () => { observer.disconnect(); clearTimeout(live.current.timer); document.removeEventListener("visibilitychange", flush); window.removeEventListener("beforeunload", leave); delete window.__slideMerge; };
  }, [api]);
  useEffect(() => {
    if (!api || editing || slideView !== "current" || present !== null || deckDialog || activity.showLog) return;
    const canvas = host.current.querySelector(".lab-canvas");
    let lastWheel = -Infinity, wheelDistance = 0, wheelUsed = false;
    const advance = direction => {
      const currentDeck = live.current.deck;
      if (!currentDeck || !live.current.ready || live.current.operating) return;
      const index = currentDeck.slides.findIndex(slide => slide.id === currentDeck.selected);
      const next = currentDeck.slides[index + direction];
      if (next) choose(next.id);
    };
    const wheel = event => {
      if (event.target.closest("iframe,video,audio,input,textarea,select,[contenteditable=true]")) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.ctrlKey || event.metaKey) return;
      const now = performance.now();
      if (now - lastWheel > 220) { wheelUsed = false; wheelDistance = 0; }
      lastWheel = now;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      wheelDistance += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      if (!wheelUsed && Math.abs(wheelDistance) >= 40) { wheelUsed = true; advance(Math.sign(wheelDistance)); }
    };
    const key = event => {
      if (event.target.closest("input,textarea,select,[contenteditable=true],[role=separator],video,audio,[role=dialog],dialog") || api.getAppState().openDialog) return;
      const direction = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!direction && !["+", "=", "-", "0", "?"].includes(event.key)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (direction && !event.repeat) advance(direction);
    };
    canvas.addEventListener("wheel", wheel, { capture: true, passive: false });
    document.addEventListener("keydown", key, true);
    fit();
    return () => { canvas.removeEventListener("wheel", wheel, true); document.removeEventListener("keydown", key, true); };
  }, [api, editing, slideView, present, deckDialog, activity.showLog]);
  async function switchView(next) { await run(async () => { await save(); openPane(null, false); if (!live.current.deck.slides.length) next = "current"; setSlideView(next); activity.note(next === "all" ? "All slides" : "Current slide", "nav"); if (next === "all") await Promise.all(live.current.deck.slides.map(thumbnail)); requestAnimationFrame(fit); }); }
  function switchEditing(next) { activity.flush(); openPane(null, false); setEditing(next); api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null, frameRendering: { enabled: true, name: next, outline: next, clip: true } }, captureUpdate: CaptureUpdateAction.NEVER }); activity.note(next ? "Editing on" : "Rehearse", "nav"); requestAnimationFrame(fit); }
  function rehearse() { return run(async () => { await save(); const first = deck.slides.slice(selectedIndex).find(slide => !slide.hidden) || rehearsal[0]; activity.note("Slide show started", "nav"); setPresent(rehearsal.findIndex(slide => slide.id === first.id)); }); }
  const notesControls = <><NotesControls slideId={current?.id} expanded={mobileUI.mobile ? mobileUI.panel === "notes" : notesOpen} onToggle={toggleNotes} minutes={current?.durationMinutes || 0} onTiming={value => metadata("durationMinutes", value)} disabled={busy || !current || present !== null || !!deckDialog} /><button type="button" className="merge-icon help-icon merge-presenter-help" title="Help" aria-label="Help" disabled={busy || present !== null || !!deckDialog} onClick={() => api?.updateScene({appState:{openDialog:{name:"help"}},captureUpdate:CaptureUpdateAction.NEVER})}><Icon name="help" /></button></>;
  return <div className={`merge-shell ${resizing ? "is-resizing" : ""} ${notesResize.dragging ? "is-notes-resizing" : ""} ${!editing || notesOpen ? "" : "is-notes-hidden"} ${mobileUI.slides ? "mobile-slides-open" : ""} ${pane && !mobileUI.mobile ? "merge-rail-insert" : ""}`} data-editing={editing} data-slide-view={slideView} data-mobile-panel={mobileUI.mobile ? editing ? mobileUI.panel : "notes" : undefined} style={{ "--slide-pane-width": `${paneWidth}px`, "--notes-height": `${notesResize.height}px` }}>
    <header className="merge-header"><a href="/studio/slide-lab/" title="Back to engine lab" aria-label="Back to engine lab"><Icon name="back" /></a><span className="merge-brand">Slide studio <small>MERGER LAB</small></span>
      <input aria-label="Deck title" value={deck?.title || ""} disabled={busy || !editing} onChange={event => metadata("title", event.target.value, true)} />
      </header>
    <EditorBar historyRef={setHistoryTarget} busy={busy || present !== null || !!deckDialog} editing={editing} onEditing={switchEditing} slideView={slideView} onView={switchView} onPlay={rehearse} canPlay={!!rehearsal.length} />
    <aside className="merge-slides" onKeyDownCapture={deleteSlideKey} aria-label={pane && !mobileUI.mobile ? PANE_LABELS[pane] || "Library" : "Slides"}>
      <div className="merge-resizer" data-prevent-outside-click role="separator" aria-label="Resize slide navigation" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={slidePaneWidth(360, innerWidth)} aria-valuenow={paneWidth} tabIndex={0} title="Resize slide navigation"
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resize.current = { x: event.clientX, width: paneWidth }; setResizing(true); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (resize.current) setPaneWidth(slidePaneWidth(resize.current.width + resize.current.x - event.clientX, innerWidth)); }}
        onPointerUp={finishResize} onPointerCancel={event => finishResize(event, true)} onLostPointerCapture={() => { resize.current = null; setResizing(false); }}
        onDoubleClick={() => storePaneWidth(200)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); storePaneWidth(event.key === "Home" ? 200 : paneWidth + (event.key === "ArrowLeft" ? 16 : -16)); } }} />
      {pane && !mobileUI.mobile && <div className="merge-section-head merge-insert-head"><h2>{PANE_LABELS[pane] || "Library"}</h2><button className="merge-nav-action" title="Close panel" aria-label="Close panel" onClick={() => openPane(null, false)}><ToolIcon name="close" /></button></div>}
      <SlideNavigator deck={deck} thumbnails={thumbnails} busy={busy} editing={editing} choose={choose} modify={modify} reorder={reorder} add={add} remove={removeSlide} pick={kind => openPane(kind, false)} section={saveSection} /></aside>
    <section className="merge-editor" ref={editor}>
      <main className={`merge-workspace ${hasSelection ? "has-selection" : ""}`} data-empty={!!deck && !current} ref={host} onDropCapture={receive} onPasteCapture={receive} onDragOverCapture={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }}>
        <CanvasToolbar api={api} disabled={busy || present !== null || !!deckDialog} onImage={() => openPane("media")} mediaOpen={pane === "media"} onDiagram={kind => insertContent(kind, null, true)}>
          <div className="merge-tool-group">{[["icons","icons"],["text","content"],["badges","badge"],["sections","section"],["library","library"]].map(([name, icon]) => <button key={name} className="merge-tool" title={PANE_LABELS[name]} aria-label={name === "library" ? "Open library" : PANE_LABELS[name]} aria-pressed={pane === name} disabled={busy} onClick={() => openPane(name)}>{name === "library" ? <Icon name={icon} /> : <ToolIcon name={icon} />}</button>)}
          </div><div className="merge-tool-group"><ToolMenu label="View" icon="view" disabled={busy}>
            {[["grid", "Grid and snap"], ["snap", "Snap to objects"], ["rulers", "Rulers"], ["margins", "Safe margins"], ["thirds", "Thirds"]].map(([key, label]) => <label className="merge-view-option" key={key}><input type="checkbox" checked={view[key]} onChange={event => changeView(key, event.target.checked)} />{label}</label>)}
            <label className="merge-view-option"><input type="checkbox" checked={snapGuides} onChange={event=>setSnapGuides(event.target.checked)} />Snap to guides</label>
            <button data-close onClick={() => {setView({ ...view, margins: false, thirds: false });commitSettings({guides:[]});}}>Clear guides</button>
          </ToolMenu></div>
        </CanvasToolbar>
        <div className="lab-canvas"><CanvasBackdrop api={api} /><CanvasGuides api={api} {...view} guides={settings.guides||[]} onGuides={guides=>commitSettings({guides})} disabled={busy||present!==null} /><CanvasVideo api={api} /><LabTextColorContext.Provider value={{ api, labels, linked: labels.every(label => label.linked), busy, changeLabelColor: color => { if (color && color !== "unlink" && color !== "transparent") { color = normalizeHex(color); if (!color) return; } const elements = api.getSceneElementsIncludingDeleted(); const targets = selectedLabels(elements, api.getAppState().selectedElementIds); api.updateScene({ elements: labelColorUpdate(elements, targets.map(element => element.id), color), captureUpdate: CaptureUpdateAction.IMMEDIATELY }); } }}>
          <Excalidraw excalidrawAPI={setApi} theme={canvasTheme(api?.getSceneElements() || [],appearance)} onChange={onChange} onScrollChange={() => { if (!live.current.editing) fit(); }} onLibraryChange={library.onChange} libraryReturnUrl={location.origin + "/studio/slide-merge-lab/"} viewModeEnabled={!current || !editing || busy || present !== null || !!deckDialog || slideView === "all"} aiEnabled={false} handleKeyboardGlobally={false} initialData={{ appState: { theme: appearance, currentItemFontFamily: DEFAULT_SLIDE_FONT, currentItemRoughness: 0, viewBackgroundColor: sceneBackground() } }} UIOptions={engineOptions} renderEmbeddable={element => <Embed element={element} />} validateEmbeddable={validEmbed}>
            <HistoryControls target={historyTarget} api={api} activity={activity} history={deckHistory.current} pending={live.current.revision !== live.current.savedRevision} onHistory={restoreHistory} disabled={busy || present !== null || !!deckDialog} />
            <MainMenu />
            <DefaultSidebar docked={false} onDock={false} onStateChange={state => setLibraryOpen(state?.name === "default" && state?.tab === "library")}>
              {libraryOpen && <div className="merge-library-status"><button className="merge-library-sync" onClick={library.retry} title={library.status + ". Click to retry or sign in to Studio."}><Icon name="sync" /><span role="status">{library.status}</span></button></div>}
            </DefaultSidebar>
            <ContentPane pane={pane} busy={busy} onEmbed={addEmbed} layoutPicker={layoutPicker} composition={{ existingCount: deck?.slides.length || 0, onApply: applyAiComposition, renderPreview: plan => <CompositionPreview plan={plan} /> }} onContent={(kind, badge) => { finishPaneInsert(); insertContent(kind, badge); }} onIcon={file => importImage(file, true)} onSection={(block, resources) => { finishPaneInsert(); addFromSection(block, true, resources); }} onNewLayout={layout => { openPane(null, false); add(layout); }} onNewSection={(blocks, resources) => addFromSection(blocks, false, resources)} onMedia={source => importMedia(source, mediaPurpose === "background")} onUpload={() => input.current.click()}>
              {api && <LayerPanel api={api} disabled={busy||present!==null||!!deckDialog} onClose={() => openPane(null, false)} onAdd={kind => { if (kind === "media") openPane("media", false); else if (kind === "text") { finishPaneInsert(); insertContent("body"); } else { openPane(null, false); api.setActiveTool({ type:"rectangle" }); } }} />}
            </ContentPane>
            {!hasSelection&&current&&<SlideProperties settings={settings} elements={api?.getSceneElements()||[]} disabled={busy||present!==null||!!deckDialog} layoutPicker={layoutPicker} onSaveLayout={() => { setLayoutSaveError(""); openDeckDialog({ kind: "save-layout" }); }} onLayout={chooseLayout} onBackground={setBackground} onMedia={() => openPane("media", false, null, "background")} onLayers={() => openPane("layers", false)} onTransition={transition=>commitSettings({transition})} />}
          </Excalidraw>
          <NativeSections api={api} interactive={!editing && !busy && present === null && !deckDialog} />
          <EmbedComposer api={api} onCommit={commitEmbed} disabled={busy || !editing || present !== null} />
          {deck && !current && <section className="merge-empty" aria-label="Empty deck"><h2>No slides</h2>{editing && <div className="merge-empty-actions"><SlideAddActions add={add} pick={kind => openPane(kind, false)} busy={busy} /></div>}</section>}
          {editing && <FitSlideControl api={api} host={host} mobile={mobileUI.mobile} disabled={busy || present !== null || !!deckDialog} onFit={fit} />}
          <PlaceholderActions api={api} disabled={busy || present !== null || !!deckDialog} onInsert={(id, next) => { api.updateScene({appState:{selectedElementIds:{[id]:true}},captureUpdate:CaptureUpdateAction.NEVER});openPane(next, false, id); }} />
        </LabTextColorContext.Provider>{mobileUI.mobile ? <div className="merge-mobile-canvas-controls"><button className="merge-icon" aria-label="Toggle slides" title="Slides" aria-expanded={mobileUI.slides} onClick={()=>mobileUI.setSlides(!mobileUI.slides)}><Icon name="slides" /></button><button className="merge-icon" title="Properties" aria-label="Open properties" onClick={()=>mobileUI.open("properties",hasSelection)}><Icon name="properties" /></button><Button icon="fit" label="Fit slide" disabled={busy || present !== null || !!deckDialog} onClick={fit} /><div className="merge-mobile-presenter-controls">{notesControls}</div></div> : <div className="merge-canvas-presenter-controls">{notesControls}</div>}</div><CornerControls api={api} host={host} disabled={busy || present !== null} />{busy && <div className="lab-busy" role="status">Working</div>}
      </main><div className="merge-notes" id="merge-speaker-notes" hidden={editing && (mobileUI.mobile ? mobileUI.panel !== "notes" : !notesOpen)}><div className="merge-notes-resizer" {...notesResize.handle} /><RichNotesEditor key={current?.id} value={current?.notes || ""} disabled={busy || !current} onBoundary={() => { capture(); if (live.current.deck) deckHistory.current.record(live.current.deck); }} onChange={value => metadata("notes", value)} /></div></section>
    {mobileUI.mobile && mobileUI.panel && <><button className="merge-sheet-scrim" aria-label="Dismiss panel" tabIndex={-1} onClick={()=>mobileUI.open(null)} /><div className="merge-sheet-head"><strong>{mobileUI.panel === "properties" ? (hasSelection ? "Object properties" : "Slide properties") : PANE_LABELS[mobileUI.panel] || "Speaker notes"}</strong><button className="merge-icon merge-sheet-close" title="Close panel" aria-label="Close panel" onClick={()=>mobileUI.open(null)}><Icon name="close" /></button></div></>}
    {slideView === "all" && !!deck?.slides.length && <AllSlides deck={deck} thumbnails={thumbnails} busy={busy} onDeleteKey={deleteSlideKey} onOpen={async id => { await choose(id); setSlideView("current"); activity.note("Current slide", "nav"); requestAnimationFrame(fit); }} modify={modify} add={add} remove={removeSlide} />}
    {activity.showLog && <ActivityDialog activity={activity} />}
    <footer className="merge-status" aria-label="Document status">
      <StatusControls status={status === "Saved on this device" && activity.message ? `${activity.message} - saved` : status} activity={activity}>
        <VisibilityMenu deck={deck} disabled={busy || present !== null || !!deckDialog} onChange={isPublic => { if (isPublic) { openPane(null, false); setDeckDialog({kind:"visibility"}); } else changeVisibility(false); }} />
      </StatusControls>
      <span className="merge-slide-position">{selectedIndex + 1} / {deck?.slides.length || 0}</span>
    </footer>
    <input type="file" hidden ref={input} accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/ogg,.svg,.mov" onChange={event => { importMedia(event.target.files[0], mediaPurpose === "background"); event.target.value = ""; }} />
    {present !== null && <Presenter slides={rehearsal} index={present} onSlideEdit={presenterMetadata} onIndex={index => { activity.write("nav", `Slide show slide ${index + 1}`); setPresent(index); }} onClose={() => { activity.note("Slide show closed", "nav"); setPresent(null); requestAnimationFrame(fit); }} />}
    {["save-layout", "rename-layout"].includes(deckDialog?.kind) && <LayoutNameDialog value={deckDialog.layout?.name} busy={busy} error={layoutSaveError} onClose={() => setDeckDialog(null)} onSave={saveLayout} />}
    {deckDialog?.kind === "visibility" && <VisibilityConfirmation onClose={() => setDeckDialog(null)} onConfirm={() => changeVisibility(true)} />}
    {["apply-layout", "delete-layout"].includes(deckDialog?.kind) && <DeckDialog wide={false} title={deckDialog.kind === "apply-layout" ? "Apply saved layout?" : "Delete saved layout?"} onClose={() => { if (!busy) setDeckDialog(null); }}><p className="merge-layout-dialog-copy">{deckDialog.kind === "apply-layout" ? `Replace this slide's content and background with "${deckDialog.layout.name}"? Speaker notes are kept. You can undo this change.` : `Delete "${deckDialog.layout.name}" from My layouts? Existing slides are not changed.`}</p><footer><button disabled={busy} onClick={() => setDeckDialog(null)}>Cancel</button><button disabled={busy} className={deckDialog.kind === "delete-layout" ? "is-danger" : "merge-dialog-primary"} onClick={() => deckDialog.kind === "delete-layout" ? deleteLayout(deckDialog.layout) : useSavedLayout(deckDialog.layout)}>{deckDialog.kind === "delete-layout" ? "Delete layout" : "Apply layout"}</button></footer></DeckDialog>}
  </div>;
}
createRoot(document.getElementById("root")).render(<Merger />);