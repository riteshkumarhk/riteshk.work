import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, CaptureUpdateAction, convertToExcalidrawElements, restoreElements, exportToSvg, getSceneVersion } from "@excalidraw/excalidraw";
import { createDeck, changeSlides, deckStore, slidePaneWidth } from "./slide-merge-core.mjs";
import { FRAME_ID, fixtureSkeleton, packScene, originalImage, selectedLabels, labelColorUpdate, preserveLabelColors } from "./slide-lab-core.mjs";
import { createScreenshot } from "./slide-lab-fixtures.mjs";
import { DEFAULT_SLIDE_FONT, platformText, loadPlatformFonts } from "./slide-platform-fonts.mjs";
import { LabTextColorContext } from "./slide-lab-text-color.jsx";
import { CornerControls } from "./slide-lab-corner-controls.jsx";
import { normalizeHex } from "./slide-lab-color.mjs";
import "@excalidraw/excalidraw/index.css";
import "../../css/slide-lab.css";
import "../../css/slide-merge.css";

const paths = {
  add: "M12 5v14M5 12h14", copy: "M9 9h12v12H9zM15 9V3H3v12h6", trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  up: "M12 19V5m-7 7 7-7 7 7", down: "M12 5v14m-7-7 7 7 7-7", play: "m8 5 11 7-11 7Z", close: "m6 6 12 12M6 18 18 6",
  fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z", save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12ZM7 3v6h10V3M7 21v-8h10v8",
  image: "M3 3h18v18H3ZM3 16l6-6 4 4 3-3 5 5M8 7h.01", back: "M19 12H5m7-7-7 7 7 7", next: "M5 12h14m-7-7 7 7-7 7"
};
function Icon({ name }) { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
function Button({ icon, label, ...props }) { return <button className={`merge-icon ${icon === "trash" ? "is-danger" : ""}`} title={label} aria-label={label} {...props}><Icon name={icon} /></button>; }
function Embed({ element }) {
  const kind = element.customData?.fixture;
  return ["rich", "section", "video"].includes(kind) ? <iframe className="lab-embed" title={`Native ${kind}`} src={`/studio/slide-lab/native.html?fixture=${kind}`} /> : null;
}
const engineOptions = { tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false } };

async function materialize(slide) {
  if (slide.scene) return slide;
  const skeleton = platformText(slide.fixture === "blank" ? [fixtureSkeleton("flow").at(-1)] : fixtureSkeleton(slide.fixture));
  if (slide.fixture === "blank") skeleton[0].children = [];
  await loadPlatformFonts(skeleton);
  let elements = restoreElements(convertToExcalidrawElements(skeleton, { regenerateIds: false }), null, { repairBindings: true });
  elements = elements.map(element => element.id === FRAME_ID ? { ...element, x: 0, y: 0, width: 1280, height: 720, locked: true, name: slide.title } : element);
  const files = {};
  if (slide.fixture === "compatibility") files["fixture-image"] = { ...await originalImage(await createScreenshot()), id: "fixture-image" };
  return { ...slide, scene: packScene(elements, files, { viewBackgroundColor: "#ffffff", theme: "light", zoom: { value: 1 }, scrollX: 0, scrollY: 0 }) };
}

function Presenter({ slides, index, onIndex, onClose }) {
  const [api, setApi] = useState(null);
  const stage = useRef(null);
  const slide = slides[index];
  useEffect(() => {
    if (!api) return;
    const scene = slide.scene;
    api.resetScene(); api.addFiles(Object.values(scene.files));
    api.updateScene({ elements: scene.elements.map(element => element.id === FRAME_ID ? { ...element, name: "" } : element), appState: { ...scene.appState, selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    const fit = () => api.updateScene({ appState: { zoom: { value: stage.current.clientWidth / 1280 }, scrollX: 0, scrollY: 0 }, captureUpdate: CaptureUpdateAction.NEVER });
    const observer = new ResizeObserver(fit); observer.observe(stage.current); fit();
    return () => observer.disconnect();
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
    <div className="merge-present-stage" ref={stage}><Excalidraw excalidrawAPI={setApi} viewModeEnabled zenModeEnabled aiEnabled={false} handleKeyboardGlobally={false} UIOptions={engineOptions} renderEmbeddable={element => <Embed element={element} />} validateEmbeddable={link => /^https:\/\/slide-lab\.invalid\/(rich|section|video)$/.test(link)} /></div>
    <footer><Button icon="back" label="Previous slide" disabled={!index} onClick={() => onIndex(index - 1)} /><span>{index + 1} / {slides.length}</span><Button icon="next" label="Next slide" disabled={index === slides.length - 1} onClick={() => onIndex(index + 1)} /><p>{slide.notes}</p></footer>
  </div>;
}

function Merger() {
  const [api, setApi] = useState(null), [deck, setDeck] = useState(null), [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("Loading local draft"), [selection, setSelection] = useState("[]"), [hasSelection, setHasSelection] = useState(false);
  const [thumbnails, setThumbnails] = useState({}), [present, setPresent] = useState(null), [confirm, setConfirm] = useState(false);
  const host = useRef(null), input = useRef(null), dialog = useRef(null);
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
  const labels = JSON.parse(selection);
  function fail(error) { setStatus(`Not saved: ${error.message}`); }
  function paint(next) { live.current.deck = next; setDeck({ ...next }); }
  function capture() {
    const state = live.current;
    if (!state.ready) return;
    const slide = state.deck.slides.find(item => item.id === state.deck.selected);
    slide.scene = packScene(api.getSceneElementsIncludingDeleted(), api.getFiles(), api.getAppState());
  }
  async function thumbnail(slide) {
    const svg = await exportToSvg({ elements: slide.scene.elements.filter(element => !element.isDeleted), appState: { ...slide.scene.appState, exportBackground: true }, files: slide.scene.files, exportingFrame: slide.scene.elements.find(element => element.id === FRAME_ID), skipInliningFonts: true });
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
    const width = host.current.clientWidth, height = host.current.clientHeight;
    const zoom = Math.max(.1, Math.min((width - 64) / 1280, (height - 180) / 720, 1));
    api.updateScene({ appState: { zoom: { value: zoom }, scrollX: (width / zoom - 1280) / 2, scrollY: (height / zoom - 720) / 2 }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  async function mountSlide(slide) {
    live.current.ready = false;
    await loadPlatformFonts(slide.scene.elements);
    api.resetScene(); api.addFiles(Object.values(slide.scene.files));
    api.updateScene({ elements: restoreElements(slide.scene.elements, null, { repairBindings: true }), appState: { ...slide.scene.appState, currentItemFontFamily: DEFAULT_SLIDE_FONT, currentItemRoughness: 0, selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    api.history.clear(); live.current.version = getSceneVersion(slide.scene.elements); live.current.ready = true;
    setSelection("[]"); setHasSelection(false); requestAnimationFrame(fit);
  }
  async function run(operation) {
    if (live.current.operating) return;
    live.current.operating = true; setBusy(true);
    try { await operation(); } catch (error) { fail(error); } finally { live.current.operating = false; setBusy(false); }
  }
  async function choose(id) { await run(async () => { await save(); const next = { ...live.current.deck, selected: id }; paint(next); await mountSlide(next.slides.find(slide => slide.id === id)); await save(); }); }
  function modify(action) { return run(async () => {
    await save(); const next = changeSlides(live.current.deck, action, live.current.deck.selected, crypto.randomUUID());
    paint(next); await mountSlide(next.slides.find(slide => slide.id === next.selected)); await save();
  }); }
  function add() { return run(async () => {
    await save(); const slide = await materialize({ id: crypto.randomUUID(), title: "Untitled slide", notes: "", fixture: "blank" });
    const next = { ...live.current.deck, slides: [...live.current.deck.slides, slide], selected: slide.id };
    paint(next); await mountSlide(slide); await save();
  }); }
  function onChange(elements, state) {
    if (!live.current.ready || live.current.operating) return;
    const fixed = preserveLabelColors(elements);
    if (fixed !== elements) { api.updateScene({ elements: fixed, captureUpdate: CaptureUpdateAction.NEVER }); return; }
    setHasSelection(Object.keys(state.selectedElementIds).some(id => state.selectedElementIds[id]) || state.activeTool.type !== "selection");
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
  function importImage(file) { return run(async () => {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error("Choose PNG, JPEG, WebP or GIF");
    const image = await originalImage(file), width = Math.min(640, image.width);
    const element = convertToExcalidrawElements([{ type: "image", fileId: image.id, x: 160, y: 160, width, height: width * image.height / image.width, scale: [1, 1], frameId: FRAME_ID }])[0];
    api.addFiles([image]); api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), element], appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    await save();
  }); }
  function receive(event) {
    const files = [...(event.clipboardData?.files || event.dataTransfer?.files || [])];
    if (files.length) { event.preventDefault(); event.stopPropagation(); if (!busy) importImage(files[0]); }
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
    const observer = new ResizeObserver(fit); observer.observe(host.current);
    window.__slideMerge = { api, save, choose, importImage, deck: () => structuredClone(live.current.deck) };
    return () => { observer.disconnect(); clearTimeout(live.current.timer); document.removeEventListener("visibilitychange", flush); window.removeEventListener("beforeunload", leave); delete window.__slideMerge; };
  }, [api]);
  useEffect(() => { if (confirm) dialog.current.showModal(); }, [confirm]);
  return <div className={`merge-shell ${resizing ? "is-resizing" : ""}`} style={{ "--slide-pane-width": `${paneWidth}px` }}>
    <header className="merge-header"><a href="/studio/slide-lab/" title="Back to engine lab" aria-label="Back to engine lab"><Icon name="back" /></a><span className="merge-brand">Slide studio <small>MERGER LAB</small></span>
      <input aria-label="Deck title" value={deck?.title || ""} disabled={busy} onChange={event => metadata("title", event.target.value, true)} />
      <Button icon="save" label="Save local deck" disabled={busy || !deck} onClick={() => save().catch(fail)} />
      <button className="merge-rehearse" disabled={busy || !deck} onClick={() => run(async () => { await save(); setPresent(selectedIndex); })}><Icon name="play" />Rehearse</button></header>
    <aside className="merge-slides" aria-label="Slides">
      <div className="merge-resizer" role="separator" aria-label="Resize slide navigation" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={slidePaneWidth(360, innerWidth)} aria-valuenow={paneWidth} tabIndex={0} title="Resize slide navigation"
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resize.current = { x: event.clientX, width: paneWidth }; setResizing(true); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (resize.current) setPaneWidth(slidePaneWidth(resize.current.width + resize.current.x - event.clientX, innerWidth)); }}
        onPointerUp={finishResize} onPointerCancel={event => finishResize(event, true)} onLostPointerCapture={() => { resize.current = null; setResizing(false); }}
        onDoubleClick={() => storePaneWidth(200)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); storePaneWidth(event.key === "Home" ? 200 : paneWidth + (event.key === "ArrowLeft" ? 16 : -16)); } }} />
      <div className="merge-section-head"><h2>Slides <span>{deck?.slides.length || 0}</span></h2><Button icon="add" label="Add slide" disabled={busy || !deck} onClick={add} /></div>
      <div className="merge-slide-list">{deck?.slides.map((slide, index) => <button key={slide.id} className={`merge-slide ${deck.selected === slide.id ? "is-active" : ""}`} aria-label={`Slide ${index + 1}: ${slide.title}`} aria-current={deck.selected === slide.id ? "true" : undefined} disabled={busy} onClick={() => choose(slide.id)}><span className="merge-thumbnail" aria-hidden="true" dangerouslySetInnerHTML={{ __html: thumbnails[slide.id] || "" }} /><span><small>{String(index + 1).padStart(2, "0")}</small>{slide.title || "Untitled slide"}</span></button>)}</div>
      <div className="merge-slide-actions"><Button icon="up" label="Move slide up" disabled={busy || selectedIndex < 1} onClick={() => modify("up")} /><Button icon="down" label="Move slide down" disabled={busy || !deck || selectedIndex === deck.slides.length - 1} onClick={() => modify("down")} /><Button icon="copy" label="Duplicate slide" disabled={busy || !deck} onClick={() => modify("duplicate")} /><Button icon="trash" label="Delete slide" disabled={busy || !deck || deck.slides.length < 2} onClick={() => setConfirm(true)} /></div></aside>
    <section className="merge-editor"><div className="merge-toolbar"><input aria-label="Slide title" value={current?.title || ""} disabled={busy} onChange={event => metadata("title", event.target.value)} /><Button icon="image" label="Import original image" disabled={busy} onClick={() => input.current.click()} /><Button icon="fit" label="Fit slide" disabled={busy} onClick={fit} /></div>
      <main className={`merge-workspace ${hasSelection ? "has-selection" : ""}`} ref={host} onDropCapture={receive} onPasteCapture={receive} onDragOverCapture={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }}>
        <div className="lab-canvas"><LabTextColorContext.Provider value={{ api, labels, linked: labels.every(label => label.linked), busy, changeLabelColor: color => { if (color && color !== "unlink" && color !== "transparent") { color = normalizeHex(color); if (!color) return; } const elements = api.getSceneElementsIncludingDeleted(); const targets = selectedLabels(elements, api.getAppState().selectedElementIds); api.updateScene({ elements: labelColorUpdate(elements, targets.map(element => element.id), color), captureUpdate: CaptureUpdateAction.IMMEDIATELY }); } }}>
          <Excalidraw excalidrawAPI={setApi} onChange={onChange} viewModeEnabled={busy || present !== null || confirm} aiEnabled={false} handleKeyboardGlobally={false} initialData={{ appState: { theme: "light", currentItemFontFamily: DEFAULT_SLIDE_FONT, currentItemRoughness: 0, viewBackgroundColor: "#ffffff" } }} UIOptions={engineOptions} renderEmbeddable={element => <Embed element={element} />} validateEmbeddable={link => /^https:\/\/slide-lab\.invalid\/(rich|section|video)$/.test(link)}><MainMenu><MainMenu.DefaultItems.Help /></MainMenu></Excalidraw>
        </LabTextColorContext.Provider></div><CornerControls api={api} host={host} disabled={busy || present !== null} />{busy && <div className="lab-busy" role="status">Working</div>}
      </main><label className="merge-notes"><span>Speaker notes</span><textarea aria-label="Speaker notes" value={current?.notes || ""} disabled={busy} onChange={event => metadata("notes", event.target.value)} /></label></section>
    <footer className="merge-status"><span role="status">{status}</span><span>{selectedIndex + 1} / {deck?.slides.length || 0}</span><span>Local draft</span></footer>
    <input type="file" hidden ref={input} accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { importImage(event.target.files[0]); event.target.value = ""; }} />
    {present !== null && <Presenter slides={deck.slides} index={present} onIndex={setPresent} onClose={() => { setPresent(null); requestAnimationFrame(fit); }} />}
    {confirm && <dialog ref={dialog} className="merge-confirm" onCancel={() => setConfirm(false)}><h2>Delete this slide?</h2><p>{current?.title}</p><div><button onClick={() => setConfirm(false)}>Cancel</button><button className="is-danger" onClick={() => { setConfirm(false); modify("delete"); }}>Delete slide</button></div></dialog>}
  </div>;
}
createRoot(document.getElementById("root")).render(<Merger />);