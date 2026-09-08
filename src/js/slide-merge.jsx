import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, Footer, DefaultSidebar, CaptureUpdateAction, convertToExcalidrawElements, restoreElements, exportToSvg, getSceneVersion } from "@excalidraw/excalidraw";
import { createDeck, changeSlides, insertSlide, setSlideSection, presentationSlides, deckStore, slidePaneWidth } from "./slide-merge-core.mjs";
import { FRAME_ID, fixtureSkeleton, packScene, originalImage, selectedLabels, labelColorUpdate, preserveLabelColors } from "./slide-lab-core.mjs";
import { createScreenshot } from "./slide-lab-fixtures.mjs";
import { DEFAULT_SLIDE_FONT, platformText, loadPlatformFonts } from "./slide-platform-fonts.mjs";
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
import { SlideNavigator, SectionDialog } from "./slide-merge-navigator.jsx";
import { sectionPlan, sectionMediaUrl, sectionPlainText } from "./slide-merge-sections.mjs";
import { SlideProperties } from "./slide-merge-properties.jsx";
import { PROPERTY_LAYOUTS, slideSettings, slideOwnsFocus, layoutPlan, transitionMatch } from "./slide-merge-properties.mjs";
import { guideSnap } from "./slide-merge-guide-core.mjs";
import "@excalidraw/excalidraw/index.css";
import "../../css/slide-lab.css";
import "../../css/slide-merge.css";
import "../../css/slide-merge-theme.css";
import { useMobilePanels } from "./slide-merge-mobile.jsx";
import { canvasTheme } from "./slide-merge-appearance.mjs";

function useAppearance() {
  const [appearance, setAppearance] = useState(() => document.documentElement.dataset.appearance || "dark");
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
function Embed({ element }) {
  const video = element.customData?.sectionVideo;
  if (video && sectionMediaUrl(video)) return <video className="lab-embed" src={video} controls playsInline preload="metadata" />;
  const kind = element.customData?.fixture;
  return ["rich", "section", "video"].includes(kind) ? <iframe className="lab-embed" title={`Native ${kind}`} src={`/studio/slide-lab/native.html?fixture=${kind}`} /> : null;
}
const engineOptions = { tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } };
function CanvasVideo({api}) {
  const [video,setVideo]=useState(null),[failed,setFailed]=useState(false);
  useEffect(()=>{if(!api)return;const update=(elements,state)=>{const element=elements.find(item=>!item.isDeleted&&item.customData?.slideBackgroundVideo);const next=element?{src:element.customData.slideBackgroundVideo,x:(state.scrollX+element.x)*state.zoom.value,y:(state.scrollY+element.y)*state.zoom.value,width:element.width*state.zoom.value,height:element.height*state.zoom.value}:null;setVideo(previous=>previous?.src===next?.src&&previous?.x===next?.x&&previous?.y===next?.y&&previous?.width===next?.width&&previous?.height===next?.height?previous:next);};update(api.getSceneElements(),api.getAppState());return api.onChange(update);},[api]);
  useEffect(()=>setFailed(false),[video?.src]);
  if(!video)return null;
  return <div className="merge-video-layer" style={{left:video.x,top:video.y,width:video.width,height:video.height}}>{failed?<div role="status">Video unavailable in this browser</div>:<video className="merge-background-video" src={video.src} autoPlay muted loop playsInline onError={()=>setFailed(true)} />}</div>;
}
function sceneBackground() { return "transparent"; }
function changed(element, update) { return { ...element, ...update, version: element.version + 1, versionNonce: Math.floor(Math.random()*2147483647), updated: Date.now() }; }
function validEmbed(link) { return /^https:\/\/slide-lab\.invalid\/(rich|section|video|background|section-video)$/.test(link); }

async function materialize(slide) {
  if (slide.scene) return slide;
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

function Presenter({ slides, index, onIndex, onClose }) {
  const [api, setApi] = useState(null);
  const appearance = useAppearance();
  const stage = useRef(null);
  const previous=useRef(null),engine=useRef(null);
  const slide = slides[index];
  useEffect(() => {
    if (!api) return;
    const scene = slide.scene;
    api.resetScene();
    api.updateScene({ elements: scene.elements.map(element => element.id === FRAME_ID ? { ...element, name: "" } : element), appState: { ...scene.appState, theme:canvasTheme(scene.elements,appearance), viewBackgroundColor:sceneBackground(scene.elements), selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
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
    const fit = () => api.updateScene({ appState: { zoom: { value: stage.current.clientWidth / 1280 }, scrollX: 0, scrollY: 0 }, captureUpdate: CaptureUpdateAction.NEVER });
    const observer = new ResizeObserver(fit); observer.observe(stage.current); fit();
    return () => { observer.disconnect();cancelAnimationFrame(animationFrame);animation?.cancel(); };
  }, [api, slide]);
  useEffect(() => {
    const key = event => {
      if (event.key === "Escape") onClose();
      else if (["ArrowRight", "ArrowDown", " "].includes(event.key)) { event.preventDefault(); onIndex(Math.min(slides.length - 1, index + 1)); }
      else if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); onIndex(Math.max(0, index - 1)); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [index]);
  return <div className="merge-present" role="dialog" aria-modal="true" aria-label="Rehearsal">
    <header><strong>{slide.title}</strong><Button icon="close" label="Close rehearsal" onClick={onClose} autoFocus /></header>
    <div className="merge-present-stage" ref={stage}><div className="merge-present-engine" ref={engine}><CanvasVideo api={api} /><Excalidraw excalidrawAPI={setApi} theme={canvasTheme(slide.scene.elements,appearance)} viewModeEnabled zenModeEnabled aiEnabled={false} handleKeyboardGlobally={false} UIOptions={engineOptions} renderEmbeddable={element => <Embed element={element} />} validateEmbeddable={validEmbed} /></div></div>
    <footer><Button icon="back" label="Previous slide" disabled={!index} onClick={() => onIndex(index - 1)} /><span>{index + 1} / {slides.length}</span><Button icon="next" label="Next slide" disabled={index === slides.length - 1} onClick={() => onIndex(index + 1)} /><p>{slide.notes}</p></footer>
  </div>;
}

function Merger() {
  const [api, setApi] = useState(null), [deck, setDeck] = useState(null), [busy, setBusy] = useState(true);
  const appearance = useAppearance();
  const library = useSlideLibrary(api, !busy);
  const mobileUI = useMobilePanels(api);
  const [status, setStatus] = useState("Loading local draft"), [selection, setSelection] = useState("[]"), [hasSelection, setHasSelection] = useState(false);
  const [thumbnails, setThumbnails] = useState({}), [present, setPresent] = useState(null), [confirm, setConfirm] = useState(false);
  const [pane, setPane] = useState(null), [notesOpen, setNotesOpen] = useState(true);
  useEffect(() => {
    if (!api) return;
    return api.onChange((elements, state) => setPane(state.openSidebar?.name === "insert" ? state.openSidebar.tab : state.openSidebar ? "library" : null));
  }, [api]);
  const placeholderTarget = useRef(null);
  function openPane(next, toggle = true, placeholderId = null) {
    placeholderTarget.current = placeholderId;
    const target = toggle && pane === next ? null : next;
    if (mobileUI.mobile) mobileUI.open(target);
    else api.updateScene({ appState: { openSidebar: target ? { name: target === "library" ? "default" : "insert", tab: target } : null, openMenu: null, openPopup: null }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  function finishPaneInsert() { if (mobileUI.mobile) mobileUI.open(null); }
  const [deckDialog, setDeckDialog] = useState(null);
  const [view, setView] = useState({ grid: false, snap: false, rulers: false, margins: false, thirds: false });
  const [settings,setSettings]=useState({}),[snapGuides,setSnapGuides]=useState(true);
  const host = useRef(null), input = useRef(null), dialog = useRef(null);
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
  const current = deck?.slides.find(slide => slide.id === deck.selected);
  const selectedIndex = deck?.slides.findIndex(slide => slide.id === deck.selected) ?? 0;
  const rehearsal = deck ? presentationSlides(deck) : [];
  const labels = JSON.parse(selection);
  useEffect(() => {
    live.current.deck?.slides.forEach(slide => thumbnail(slide).catch(fail));
  }, [appearance]);
  function fail(error) { setStatus(`Not saved: ${error.message}`); }
  function paint(next) { live.current.deck = next; setDeck({ ...next }); }
  function capture() {
    const state = live.current;
    if (!state.ready) return;
    const slide = state.deck.slides.find(item => item.id === state.deck.selected);
    slide.scene = packScene(api.getSceneElementsIncludingDeleted(), api.getFiles(), api.getAppState());
  }
  async function thumbnail(slide) {
    const svg = await exportToSvg({ elements: slide.scene.elements.filter(element => !element.isDeleted), appState: { ...slide.scene.appState, exportBackground: false, exportWithDarkMode:canvasTheme(slide.scene.elements,document.documentElement.dataset.appearance)==="dark" }, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true });
    setThumbnails(previous => ({ ...previous, [slide.id]: svg.outerHTML }));
  }
  async function save() {
    clearTimeout(live.current.timer); live.current.timer = null; capture();
    if (!live.current.deck) return;
    const snapshot = structuredClone(live.current.deck), revision = live.current.revision;
    live.current.queue = live.current.queue.catch(() => {}).then(() => deckStore(snapshot));
    await live.current.queue;
    live.current.savedRevision = revision;
    if (revision === live.current.revision) setStatus("Saved on this device");
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
    const left=innerWidth>900?280:16,right=innerWidth>900?32:16;
    const zoom = Math.max(.1, Math.min((width - left - right) / 1280, (height - (innerWidth > 900 ? 180 : 48)) / 720, 1));
    api.updateScene({ appState: { zoom: { value: zoom }, scrollX: (left+(width-left-right-1280*zoom)/2)/zoom, scrollY: (height / zoom - 720) / 2 }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  async function mountSlide(slide) {
    placeholderTarget.current = null;
    live.current.ready = false;
    await loadPlatformFonts(slide.scene.elements);
    api.resetScene();
    api.updateScene({ elements: restoreElements(slide.scene.elements, null, { repairBindings: true }), appState: { ...slide.scene.appState, theme:canvasTheme(slide.scene.elements,appearance), viewBackgroundColor:sceneBackground(slide.scene.elements), currentItemFontFamily: DEFAULT_SLIDE_FONT, currentItemRoughness: 0, selectedElementIds: {}, gridModeEnabled: view.grid, objectsSnapModeEnabled: view.snap }, captureUpdate: CaptureUpdateAction.NEVER });
    api.addFiles(Object.values(slide.scene.files));
    api.history.clear(); live.current.version = getSceneVersion(slide.scene.elements); live.current.ready = true;
    setSettings(slideSettings(slide.scene.elements));
    setSelection("[]"); setHasSelection(false); requestAnimationFrame(fit);
  }
  async function run(operation) {
    if (live.current.operating) return;
    live.current.operating = true; setBusy(true);
    try { await operation(); } catch (error) { fail(error); } finally { live.current.operating = false; setBusy(false); }
  }
  async function choose(id) { await run(async () => { await save(); const next = { ...live.current.deck, selected: id }; paint(next); await mountSlide(next.slides.find(slide => slide.id === id)); await save(); }); }
  function modify(action, id = live.current.deck.selected) { return run(async () => {
    await save(); const next = changeSlides(live.current.deck, action, id, crypto.randomUUID());
    paint(next); await mountSlide(next.slides.find(slide => slide.id === next.selected)); await save();
  }); }
  function add(layout = "blank", beforeId = null) { return run(async () => {
    await save(); const slide = await materialize({ id: crypto.randomUUID(), title: layout === "blank" ? "Untitled slide" : PROPERTY_LAYOUTS.find(item => item.id === layout).name, notes: "", fixture: "blank" });
    if (layout !== "blank") {
      const plan = layoutPlan(slide.scene.elements, layout, DEFAULT_SLIDE_FONT, crypto.randomUUID());
      await loadPlatformFonts(plan.additions);
      const slots = new Map(plan.additions.map(element => [element.id, element]));
      const additions = restoreElements(convertToExcalidrawElements(plan.additions, { regenerateIds: false }).map(element => element.type === "text" ? { ...element, ...slots.get(element.id), originalText: slots.get(element.id).text, autoResize: false } : element), null, { repairBindings: true, refreshDimensions: true });
      slide.scene.elements = [...slide.scene.elements.map(element => element.id === FRAME_ID ? { ...element, customData: { ...element.customData, slideSettings: { ...slideSettings(slide.scene.elements), layout } } } : element), ...additions];
    }
    const next = insertSlide(live.current.deck, slide, beforeId);
    paint(next); await mountSlide(slide); await save();
  }); }
  function openDeckDialog(value) { mobileUI.open(null); setDeckDialog(value); }
  function saveSection(name) { const id = deckDialog.id; setDeckDialog(null); return run(async () => { await save(); paint(setSlideSection(live.current.deck, id, name)); await save(); }); }
  async function prepareSection(block) {
    const plan = sectionPlan(block, sectionPlainText, DEFAULT_SLIDE_FONT, crypto.randomUUID());
    const slide = await materialize({ id: crypto.randomUUID(), title: plan.title, notes: plan.notes, fixture: "blank" });
    const additions = [...plan.elements];
    if (plan.media) {
      const media = plan.media;
      const response = await fetch(media.url, { credentials: "omit", cache:"no-store", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Source media could not be loaded; no slide was added");
      if ((response.headers.get("content-type") || "").startsWith("video/")) {
        await response.body?.cancel();
        additions.push({ type: "embeddable", id: crypto.randomUUID(), x: media.x, y: media.y, width: media.width, height: media.height, frameId: FRAME_ID, link: "https://slide-lab.invalid/section-video", customData: { sectionVideo: media.url }, backgroundColor: "transparent", strokeColor: "transparent" });
      } else if ((response.headers.get("content-type") || "").startsWith("image/")) {
        const blob = await response.blob();
        const image = await originalImage(blob), scale = Math.min(media.width / image.width, media.height / image.height);
        slide.scene.files[image.id] = image;
        additions.push({ type: "image", id: crypto.randomUUID(), fileId: image.id, x: media.x + (media.width - image.width * scale) / 2, y: media.y + (media.height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale, scale: [1, 1], frameId: FRAME_ID });
      } else { await response.body?.cancel(); throw new Error("This section's media is not a direct image or video; no slide was added"); }
    }
    await loadPlatformFonts(additions);
    const skeletons = new Map(additions.map(element => [element.id, element]));
    const elements = restoreElements(convertToExcalidrawElements(additions, { regenerateIds: false }).map(element => element.type === "text" ? { ...element, width: skeletons.get(element.id).width, autoResize: false } : element), null, { repairBindings: true, refreshDimensions: true });
    return { slide, elements };
  }
  function addFromSection(block, intoCurrent = false) { setDeckDialog(null); return run(async () => {
    await save();
    const prepared = [];
    for (const sourceBlock of (intoCurrent ? [block] : Array.isArray(block) ? block : [block])) {
      prepared.push(await prepareSection(sourceBlock));
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
    if(snapGuides&&state.selectedElementsAreBeingDragged&&!live.current.snapping) {
      const selected=elements.filter(element=>!element.isDeleted&&!element.locked&&element.id!==FRAME_ID&&state.selectedElementIds[element.id]);
      const guides=[...(nextSettings.guides||[]),...(view.margins?[{axis:"x",position:64},{axis:"x",position:1216},{axis:"y",position:36},{axis:"y",position:684}]:[]),...(view.thirds?[{axis:"x",position:1280/3},{axis:"x",position:2560/3},{axis:"y",position:240},{axis:"y",position:480}]:[])];
      if(selected.length&&guides.length) {
        const left=Math.min(...selected.map(element=>element.x)),top=Math.min(...selected.map(element=>element.y));
        const delta=guideSnap({x:left,y:top,width:Math.max(...selected.map(element=>element.x+element.width))-left,height:Math.max(...selected.map(element=>element.y+element.height))-top},guides,state.zoom.value);
        if(delta.x||delta.y) { const ids=new Set(selected.flatMap(element=>[element.id,...(element.boundElements||[]).filter(bound=>bound.type==="text").map(bound=>bound.id)]));live.current.snapping=true;api.updateScene({elements:elements.map(element=>ids.has(element.id)?changed(element,{x:element.x+delta.x,y:element.y+delta.y}):element),captureUpdate:CaptureUpdateAction.NEVER});live.current.snapping=false; }
      }
    }
    const next = JSON.stringify(selectedLabels(elements, state.selectedElementIds).map(element => ({ id: element.id, color: element.strokeColor, linked: !element.customData?.labTextColor })));
    setSelection(previous => previous === next ? previous : next);
    const version = getSceneVersion(elements);
    if (version !== live.current.version) { live.current.version = version; schedule(); }
  }
  function metadata(key, value, isDeck = false) {
    const next = { ...live.current.deck, slides: live.current.deck.slides.map(slide => !isDeck && slide.id === live.current.deck.selected ? { ...slide, [key]: value } : slide) };
    if (isDeck) next[key] = value;
    paint(next); schedule();
  }
  function changeView(key, value) {
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
  function setBackground(background,file) { const apply=async()=>{
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
  };return file?run(apply):apply().catch(fail); }
  async function backgroundMedia(file) {
    try {
      if(!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm))$/.test(file.type))throw new Error("Choose PNG, JPEG, WebP, GIF, MP4 or WebM");
      const original=file.type.startsWith("image/")?await originalImage(file):{id:crypto.randomUUID(),mimeType:file.type,dataURL:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);})};
      await setBackground({type:"media",name:file.name,mimeType:file.type},original);
    } catch(error){fail(error);}
  }
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
  function importImage(file, studioIcon = false) { return run(() => insertImage(file, studioIcon)); }
  async function insertImage(file, studioIcon = false) {
    if (!file || !/^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/.test(file.type)) throw new Error("Choose PNG, JPEG, WebP, GIF, AVIF or SVG");
    const image = await originalImage(file), width = Math.min(640, image.width);
    const elements=api.getSceneElementsIncludingDeleted(),selected=api.getAppState().selectedElementIds;
    const placeholder=!placeholderTarget.current&&!studioIcon&&elements.find(element=>!element.isDeleted&&!element.locked&&selected[element.id]&&element.customData?.slidePlaceholder?.kind==="media");
    const scale=placeholder?Math.min(placeholder.width/image.width,placeholder.height/image.height):width/image.width;
    const element = restoreElements(convertToExcalidrawElements([{ type: "image", fileId: image.id, x: placeholder?placeholder.x+(placeholder.width-image.width*scale)/2:160, y: placeholder?placeholder.y+(placeholder.height-image.height*scale)/2:160, width:image.width*scale, height:image.height*scale, scale: [1, 1], frameId: FRAME_ID }]), null, { repairBindings:true })[0];
    api.updateScene({ elements: placeholderTarget.current ? insertIntoPlaceholder([element]) : [...elements.map(item=>item.id===placeholder?.id?changed(item,{isDeleted:true}):item), element], appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY }); api.addFiles([image]);
    await save();
  }
  function importMedia(source) {
    if (!source) return;
    return run(async () => {
      let file = source, videoUrl;
      if (source.url) {
        const url = sectionMediaUrl(source.url);
        if (!url) throw new Error("This media URL is unavailable");
        const response = await fetch(url, { credentials:"omit", cache:"no-store", signal:AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error("Media could not be loaded");
        if ((response.headers.get("content-type") || "").startsWith("video/")) { await response.body?.cancel(); videoUrl = url; }
        else file = await response.blob();
      }
      if (!videoUrl && /^video\/(mp4|webm|quicktime|ogg)$/.test(file.type)) {
        videoUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      }
      if (videoUrl) {
        const element = restoreElements(convertToExcalidrawElements([{type:"embeddable",id:crypto.randomUUID(),x:320,y:180,width:640,height:360,frameId:FRAME_ID,link:"https://slide-lab.invalid/section-video",customData:{sectionVideo:videoUrl},backgroundColor:"transparent",strokeColor:"transparent"}]), null, { repairBindings:true })[0];
        api.updateScene({elements:insertIntoPlaceholder([element]),appState:{selectedElementIds:{[element.id]:true}},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
        await save();
      } else await insertImage(file);
      finishPaneInsert();
    });
  }
  function receive(event) {
    const files = [...(event.clipboardData?.files || event.dataTransfer?.files || [])];
    if (files.length) { event.preventDefault(); event.stopPropagation(); if (!busy) importMedia(files[0]); }
  }
  useEffect(() => {
    if (!api) return;
    run(async () => {
      const stored = await deckStore();
      if (stored && (stored.version !== 1 || !Array.isArray(stored.slides) || !stored.slides.length)) throw new Error("Unsupported deck format");
      const next = stored || createDeck(); next.slides = await Promise.all(next.slides.map(materialize));
      if (!next.slides.some(slide => slide.id === next.selected)) next.selected = next.slides[0].id;
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
  useEffect(() => { if (confirm) dialog.current.showModal(); }, [confirm]);
  return <div className={`merge-shell ${resizing ? "is-resizing" : ""} ${notesOpen ? "" : "is-notes-hidden"} ${mobileUI.slides ? "mobile-slides-open" : ""} ${pane && !mobileUI.mobile ? "merge-rail-insert" : ""}`} data-mobile-panel={mobileUI.mobile ? mobileUI.panel : undefined} style={{ "--slide-pane-width": `${paneWidth}px` }}>
    <header className="merge-header"><a href="/studio/slide-lab/" title="Back to engine lab" aria-label="Back to engine lab"><Icon name="back" /></a><span className="merge-brand">Slide studio <small>MERGER LAB</small></span>
      <input aria-label="Deck title" value={deck?.title || ""} disabled={busy} onChange={event => metadata("title", event.target.value, true)} />
      <Button icon="save" label="Save local deck" disabled={busy || !deck} onClick={() => save().catch(fail)} />
      <button className="merge-rehearse" title={rehearsal.length ? "Rehearse included slides" : "Include a slide to rehearse"} disabled={busy || !rehearsal.length} onClick={() => run(async () => { await save(); const first = deck.slides.slice(selectedIndex).find(slide => !slide.hidden) || rehearsal[0]; setPresent(rehearsal.findIndex(slide => slide.id === first.id)); })}><Icon name="play" />Rehearse</button></header>
    <aside className="merge-slides" aria-label={pane && !mobileUI.mobile ? PANE_LABELS[pane] || "Library" : "Slides"}>
      <div className="merge-resizer" data-prevent-outside-click role="separator" aria-label="Resize slide navigation" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={slidePaneWidth(360, innerWidth)} aria-valuenow={paneWidth} tabIndex={0} title="Resize slide navigation"
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resize.current = { x: event.clientX, width: paneWidth }; setResizing(true); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (resize.current) setPaneWidth(slidePaneWidth(resize.current.width + resize.current.x - event.clientX, innerWidth)); }}
        onPointerUp={finishResize} onPointerCancel={event => finishResize(event, true)} onLostPointerCapture={() => { resize.current = null; setResizing(false); }}
        onDoubleClick={() => storePaneWidth(200)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); storePaneWidth(event.key === "Home" ? 200 : paneWidth + (event.key === "ArrowLeft" ? 16 : -16)); } }} />
      {pane && !mobileUI.mobile && <div className="merge-section-head merge-insert-head"><h2>{PANE_LABELS[pane] || "Library"}</h2><button className="merge-nav-action" title="Close panel" aria-label="Close panel" onClick={() => openPane(null, false)}><ToolIcon name="close" /></button></div>}
      <SlideNavigator deck={deck} thumbnails={thumbnails} busy={busy} choose={choose} modify={modify} add={add} remove={setConfirm} pick={kind => openPane(kind, false)} section={id => openDeckDialog({kind:"section",id})} /></aside>
    <section className="merge-editor">
      <main className={`merge-workspace ${hasSelection ? "has-selection" : ""}`} ref={host} onDropCapture={receive} onPasteCapture={receive} onDragOverCapture={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }}>
        <CanvasToolbar api={api} disabled={busy || present !== null || !!confirm || !!deckDialog} onImage={() => openPane("media")} mediaOpen={pane === "media"} onDiagram={kind => insertContent(kind, null, true)}>
          <div className="merge-tool-group">{[["icons","icons"],["text","content"],["badges","badge"],["sections","section"],["library","library"]].map(([name, icon]) => <button key={name} className="merge-tool" title={PANE_LABELS[name]} aria-label={name === "library" ? "Open library" : PANE_LABELS[name]} aria-pressed={pane === name} disabled={busy} onClick={() => openPane(name)}>{name === "library" ? <Icon name={icon} /> : <ToolIcon name={icon} />}</button>)}
          </div><div className="merge-tool-group"><ToolMenu label="View" icon="view" disabled={busy}>
            {[["grid", "Grid and snap"], ["snap", "Snap to objects"], ["rulers", "Rulers"], ["margins", "Safe margins"], ["thirds", "Thirds"]].map(([key, label]) => <label className="merge-view-option" key={key}><input type="checkbox" checked={view[key]} onChange={event => changeView(key, event.target.checked)} />{label}</label>)}
            <label className="merge-view-option"><input type="checkbox" checked={snapGuides} onChange={event=>setSnapGuides(event.target.checked)} />Snap to guides</label>
            <button data-close onClick={fit}>Fit slide</button><button data-close onClick={() => {setView({ ...view, margins: false, thirds: false });commitSettings({guides:[]});}}>Clear guides</button>
            <button data-close onClick={() => api.updateScene({ appState: { openMenu: null, openDialog: { name: "help" } }, captureUpdate: CaptureUpdateAction.NEVER })}>Help</button>
          </ToolMenu></div>
        </CanvasToolbar>
        <div className="lab-canvas"><CanvasBackdrop api={api} /><CanvasGuides api={api} {...view} guides={settings.guides||[]} onGuides={guides=>commitSettings({guides})} disabled={busy||present!==null||confirm} /><CanvasVideo api={api} /><LabTextColorContext.Provider value={{ api, labels, linked: labels.every(label => label.linked), busy, changeLabelColor: color => { if (color && color !== "unlink" && color !== "transparent") { color = normalizeHex(color); if (!color) return; } const elements = api.getSceneElementsIncludingDeleted(); const targets = selectedLabels(elements, api.getAppState().selectedElementIds); api.updateScene({ elements: labelColorUpdate(elements, targets.map(element => element.id), color), captureUpdate: CaptureUpdateAction.IMMEDIATELY }); } }}>
          <Excalidraw excalidrawAPI={setApi} theme={canvasTheme(api?.getSceneElements() || [],appearance)} onChange={onChange} onLibraryChange={library.onChange} libraryReturnUrl={location.origin + "/studio/slide-merge-lab/"} viewModeEnabled={busy || present !== null || !!confirm || !!deckDialog} aiEnabled={false} handleKeyboardGlobally={false} initialData={{ appState: { theme: appearance, currentItemFontFamily: DEFAULT_SLIDE_FONT, currentItemRoughness: 0, viewBackgroundColor: sceneBackground() } }} UIOptions={engineOptions} renderEmbeddable={element => <Embed element={element} />} validateEmbeddable={validEmbed}>
            <MainMenu />
            <DefaultSidebar docked={false} onDock={false} />
            <Footer><button className={`help-icon merge-notes-toggle${notesOpen ? " active" : ""}`} title="Speaker notes" aria-label="Speaker notes panel" aria-expanded={notesOpen} aria-controls="merge-speaker-notes" onClick={() => setNotesOpen(!notesOpen)}><ToolIcon name="notes" /><span>Notes</span></button></Footer>
            <ContentPane pane={pane} busy={busy} onContent={(kind, badge) => { finishPaneInsert(); insertContent(kind, badge); }} onIcon={file => { finishPaneInsert(); importImage(file, true); }} onSection={block => { finishPaneInsert(); addFromSection(block, true); }} onNewLayout={layout => { openPane(null, false); add(layout); }} onNewSection={blocks => addFromSection(blocks, false)} onMedia={importMedia} onUpload={() => input.current.click()} />
            {!hasSelection&&current&&<SlideProperties mobileOpen={mobileUI.mobile && mobileUI.panel === "properties"} settings={settings} elements={api?.getSceneElements()||[]} disabled={busy||present!==null||confirm} onLayout={applyLayout} onBackground={setBackground} onMedia={backgroundMedia} onTransition={transition=>commitSettings({transition})} />}
          </Excalidraw>
          <PlaceholderActions api={api} disabled={busy || present !== null || !!confirm || !!deckDialog} onInsert={(id, next) => { api.updateScene({appState:{selectedElementIds:{[id]:true}},captureUpdate:CaptureUpdateAction.NEVER});openPane(next, false, id); }} />
        </LabTextColorContext.Provider>{mobileUI.mobile && <div className="merge-mobile-canvas-controls"><button className="merge-icon" aria-label="Toggle slides" title="Slides" aria-expanded={mobileUI.slides} onClick={()=>mobileUI.setSlides(!mobileUI.slides)}><Icon name="slides" /></button><button className="merge-icon" title="Properties" aria-label="Open properties" onClick={()=>mobileUI.open("properties",hasSelection)}><Icon name="properties" /></button><button className="merge-notes-toggle" title="Speaker notes" aria-label="Speaker notes panel" aria-expanded={mobileUI.panel === "notes"} aria-controls="merge-speaker-notes" onClick={() => mobileUI.open(mobileUI.panel === "notes" ? null : "notes")}><ToolIcon name="notes" /><span>Notes</span></button><button className="merge-icon" title="Help" aria-label="Help" onClick={() => api?.updateScene({appState:{openDialog:{name:"help"}},captureUpdate:CaptureUpdateAction.NEVER})}><Icon name="help" /></button></div>}</div><CornerControls api={api} host={host} disabled={busy || present !== null} />{busy && <div className="lab-busy" role="status">Working</div>}
      </main><label className="merge-notes" id="merge-speaker-notes" hidden={mobileUI.mobile ? mobileUI.panel !== "notes" : !notesOpen}><textarea aria-label="Speaker notes" placeholder="Speaker notes" value={current?.notes || ""} disabled={busy} onChange={event => metadata("notes", event.target.value)} /></label></section>
    {mobileUI.mobile && mobileUI.panel && <><button className="merge-sheet-scrim" aria-label="Dismiss panel" tabIndex={-1} onClick={()=>mobileUI.open(null)} /><div className="merge-sheet-head"><strong>{mobileUI.panel === "properties" ? (hasSelection ? "Object properties" : "Slide properties") : PANE_LABELS[mobileUI.panel] || "Speaker notes"}</strong><button className="merge-icon merge-sheet-close" title="Close panel" aria-label="Close panel" onClick={()=>mobileUI.open(null)}><Icon name="close" /></button></div></>}
    <footer className="merge-status"><span role="status">{status}</span><button className="merge-library-sync" onClick={library.retry} title={library.status + ". Click to retry or sign in to Studio."}><Icon name="sync" /><span role="status">{library.status}</span></button><span>{selectedIndex + 1} / {deck?.slides.length || 0}</span><span>Local draft</span></footer>
    <input type="file" hidden ref={input} accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/ogg,.svg,.mov" onChange={event => { importMedia(event.target.files[0]); event.target.value = ""; }} />
    {present !== null && <Presenter slides={rehearsal} index={present} onIndex={setPresent} onClose={() => { setPresent(null); requestAnimationFrame(fit); }} />}
    {deckDialog?.kind === "section" && <SectionDialog value={deck.slides.find(slide => slide.id === deckDialog.id)?.section} onClose={() => setDeckDialog(null)} onSave={saveSection} />}
    {confirm && <dialog ref={dialog} className="merge-confirm" onCancel={() => setConfirm(false)}><h2>Delete this slide?</h2><p>{deck.slides.find(slide => slide.id === confirm)?.title}</p><div><button onClick={() => setConfirm(false)}>Cancel</button><button className="is-danger" onClick={() => { setConfirm(false); modify("delete", confirm); }}>Delete slide</button></div></dialog>}
  </div>;
}
createRoot(document.getElementById("root")).render(<Merger />);