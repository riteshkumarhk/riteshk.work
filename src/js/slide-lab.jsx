import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Excalidraw, MainMenu, convertToExcalidrawElements, restoreElements, exportToSvg, getSceneVersion, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { FRAME_ID, SCENARIOS, fixtureSkeleton, frameReport, originalImage, packScene, readScene, sha256, writeScene, selectedLabels, labelColorUpdate, preserveLabelColors } from "./slide-lab-core.mjs";
import { createScreenshot } from "./slide-lab-fixtures.mjs";
import { CornerControls } from "./slide-lab-corner-controls.jsx";
import "@excalidraw/excalidraw/index.css";
import "../../css/slide-lab.css";

const ICONS = {
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8",
  reload: "M3 11a9 9 0 1 1 2.5 7M3 4v7h7",
  fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z",
  image: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 16l6-6 4 4 3-3 5 5M8 7h.01",
  play: "m8 5 11 7-11 7V5Z",
  close: "m6 6 12 12M6 18 18 6",
  check: "m4 12 5 5L20 6"
};
function Icon({ name }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>; }
function Action({ name, label, onClick, disabled }) { return <button className="lab-icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon name={name} /></button>; }

function NativeEmbed({ element }) {
  const fixture = element.customData?.fixture;
  return ["rich", "section", "video"].includes(fixture)
    ? <iframe className="lab-embed" title={`Native ${fixture}`} src={`./native.html?preview=1&fixture=${fixture}`} /> : null;
}

function Lab() {
  const [api, setApi] = useState(null);
  const [scenario, setScenario] = useState("flow");
  const [status, setStatus] = useState("Loading");
  const [busy, setBusy] = useState(true);
  const [report, setReport] = useState(null);
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState("canvas");
  const [labelSelection, setLabelSelection] = useState("[]");
  const [textColor, setTextColor] = useState("#27343a");
  const [colorSlot, setColorSlot] = useState(null);
  const runtime = useRef({ scenario: "flow", ready: false, timer: null, version: -1, library: [], queue: Promise.resolve(), measuring: false });
  const input = useRef(null);
  const host = useRef(null);
  const dialog = useRef(null);

  function fail(error) { setStatus(`Failed: ${error.message}`); }
  function capture() { return packScene(api.getSceneElementsIncludingDeleted(), api.getFiles(), api.getAppState(), runtime.current.library); }
  async function save() {
    const state = runtime.current;
    clearTimeout(state.timer);
    if (!state.ready || !api) return;
    const key = state.scenario;
    const value = structuredClone(capture());
    state.queue = state.queue.catch(() => {}).then(() => writeScene(key, value));
    await state.queue;
    setStatus("Saved locally");
  }
  function onChange(elements, appState) {
    const state = runtime.current;
    if (!state.ready || state.measuring) return;
    const preserved = preserveLabelColors(elements);
    if (preserved !== elements) {
      api.updateScene({ elements: preserved, captureUpdate: CaptureUpdateAction.NEVER });
      return;
    }
    const selection = selectedLabels(elements, appState.selectedElementIds).map(element => ({ id: element.id, color: element.strokeColor, linked: !element.customData?.labTextColor }));
    setLabelSelection(previous => {
      const next = JSON.stringify(selection);
      return previous === next ? previous : next;
    });
    const version = getSceneVersion(elements);
    if (version === state.version) return;
    state.version = version;
    clearTimeout(state.timer);
    setStatus("Unsaved");
    state.timer = setTimeout(() => save().catch(fail), 700);
  }
  const labels = JSON.parse(labelSelection);
  const linked = labels.every(label => label.linked);
  function changeLabelColor(color) {
    if (color && color !== "unlink" && !/^#[\da-f]{6}$/i.test(color)) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const targets = selectedLabels(elements, api.getAppState().selectedElementIds);
    api.updateScene({ elements: labelColorUpdate(elements, targets.map(element => element.id), color), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }
  useEffect(() => { setTextColor(JSON.parse(labelSelection)[0]?.color || "#27343a"); }, [labelSelection]);
  useEffect(() => {
    if (!api) return;
    const slot = document.createElement("div");
    slot.className = "lab-color-slot";
    const place = () => {
      const panel = host.current.querySelector(".selected-shape-actions .panelColumn, .App-mobile-menu .panelColumn");
      if (!panel) { slot.remove(); setColorSlot(null); return; }
      const next = panel.querySelector(":scope > fieldset");
      if (slot.parentNode !== panel || slot.nextSibling !== next) panel.insertBefore(slot, next);
      setColorSlot(slot);
    };
    const observer = new MutationObserver(place);
    observer.observe(host.current, { childList: true, subtree: true });
    place();
    return () => { observer.disconnect(); slot.remove(); };
  }, [api]);
  async function load(key, reload = false) {
    setBusy(true);
    try {
      if (!reload) await save();
      else { clearTimeout(runtime.current.timer); await runtime.current.queue; }
      const stored = await readScene(key);
      if (stored && stored.version !== 1) throw new Error("Unsupported lab draft version");
      let scene = stored;
      if (!scene) {
        const elements = convertToExcalidrawElements(fixtureSkeleton(key), { regenerateIds: false });
        const files = {};
        if (key === "compatibility") {
          const original = await originalImage(await createScreenshot());
          files["fixture-image"] = { ...original, id: "fixture-image" };
        }
        scene = packScene(elements, files, { viewBackgroundColor: "#f6f7f6", theme: "light", zoom: { value: 0.7 }, scrollX: 0, scrollY: 0 });
      }
      scene.elements = restoreElements(scene.elements, null, { repairBindings: true }).map(element => element.id === FRAME_ID
        ? { ...element, x: 0, y: 0, width: 1280, height: 720, angle: 0, locked: true } : element);
      runtime.current.ready = false;
      runtime.current.scenario = key;
      runtime.current.library = scene.libraryItems || [];
      api.resetScene();
      api.addFiles(Object.values(scene.files || {}));
      api.updateScene({ elements: scene.elements, appState: { ...scene.appState, zoom: { value: 0.7 }, scrollX: 0, scrollY: 0, selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
      await api.updateLibrary({ libraryItems: runtime.current.library });
      api.history.clear();
      runtime.current.version = getSceneVersion(scene.elements);
      runtime.current.ready = true;
      setScenario(key); setReport(null); setStatus(stored ? "Restored locally" : "New fixture");
      requestAnimationFrame(() => fit());
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  function fit() {
    const frame = api.getSceneElements().find(element => element.id === FRAME_ID);
    if (frame) api.scrollToContent(frame, { fitToContent: true, viewportZoomFactor: 0.72, animate: false });
  }
  async function importImage(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setStatus("Choose PNG, JPEG, WebP or GIF"); return; }
    setBusy(true);
    try {
      const image = await originalImage(file);
      const width = Math.min(640, image.width);
      const element = convertToExcalidrawElements([{ type: "image", fileId: image.id, x: 100, y: 160,
        width, height: width * image.height / image.width, scale: [1, 1], frameId: FRAME_ID }])[0];
      api.addFiles([image]);
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), element],
        appState: { selectedElementIds: { [element.id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      await save();
      setReport({ kind: "image", values: { width: image.width, height: image.height, bytes: image.bytes, sha256: image.sha256 } });
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  function receiveFiles(event) {
    const files = Array.from(event.clipboardData?.files || event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation();
    if (!busy) importImage(files[0]);
  }
  async function verify() {
    setBusy(true);
    try {
      await save();
      const before = capture();
      const restored = await readScene(runtime.current.scenario);
      const values = { sceneRoundtrip: JSON.stringify(before) === JSON.stringify(restored),
        validGeometry: before.elements.every(element => [element.x, element.y, element.width, element.height, element.angle].every(Number.isFinite)),
        validCamera: [before.appState.scrollX, before.appState.scrollY, before.appState.zoom.value].every(Number.isFinite),
        objects: before.elements.filter(element => !element.isDeleted).length,
        boundArrows: before.elements.filter(element => !element.isDeleted && element.type === "arrow" && element.startBinding && element.endBinding).length,
        nativeEmbeds: before.elements.filter(element => !element.isDeleted && element.type === "embeddable").length };
      const originals = await Promise.all(Object.values(restored.files).map(async file => ({ id: file.id, sameBytes: !file.sha256 ? null : await sha256(await (await fetch(file.dataURL)).arrayBuffer()) === file.sha256 })));
      values.originalBytes = originals.length ? originals.every(file => file.sameBytes === true) : "No images";
      setReport({ kind: "integrity", values });
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  async function exportPreview() {
    setBusy(true);
    try {
      const elements = api.getSceneElements();
      const svg = await exportToSvg({ elements, appState: { ...api.getAppState(), exportBackground: true, exportEmbedScene: false },
        files: api.getFiles(), exportingFrame: elements.find(element => element.id === FRAME_ID) });
      setPreview({ svg: svg.outerHTML, embeds: elements.filter(element => element.type === "embeddable").length });
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  async function measure() {
    if (runtime.current.measuring) return;
    setBusy(true);
    await save().catch(fail);
    const initial = api.getAppState();
    const intervals = [], longTasks = [];
    let observer, lastTime, start;
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: "longtask" });
    }
    runtime.current.measuring = true;
    await new Promise(resolve => {
      const step = time => {
        start ??= time;
        if (lastTime !== undefined) intervals.push(time - lastTime);
        lastTime = time;
        const elapsed = time - start;
        if (elapsed < 4000 && document.visibilityState === "visible") {
          const phase = elapsed / 4000 * Math.PI * 2;
          api.updateScene({ appState: { scrollX: initial.scrollX + Math.sin(phase) * 240, scrollY: initial.scrollY + Math.cos(phase) * 100 }, captureUpdate: CaptureUpdateAction.NEVER });
          requestAnimationFrame(step);
        } else resolve();
      };
      requestAnimationFrame(step);
    });
    if (observer) { longTasks.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect(); }
    api.updateScene({ appState: { scrollX: initial.scrollX, scrollY: initial.scrollY }, captureUpdate: CaptureUpdateAction.NEVER });
    runtime.current.measuring = false;
    setReport({ kind: "camera benchmark", values: { ...frameReport(intervals, longTasks),
      objects: api.getSceneElements().length, viewport: `${host.current.clientWidth} x ${host.current.clientHeight}`, dpr: devicePixelRatio,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, hidden: document.visibilityState !== "visible" } });
    setBusy(false);
  }
  useEffect(() => {
    if (!api) return;
    load("flow");
    const flush = () => { if (document.visibilityState === "hidden") save().catch(fail); };
    document.addEventListener("visibilitychange", flush);
    window.__slideLab = { api, verify, save, load, measure, importImage, capture };
    return () => { clearTimeout(runtime.current.timer); document.removeEventListener("visibilitychange", flush); delete window.__slideLab; };
  }, [api]);
  useEffect(() => {
    if (!preview) return;
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, [preview]);

  return <div className="lab-shell">
    <header className="lab-header"><div className="lab-brand">Slide lab <span>ENGINE STUDY</span></div>
      <div className="lab-tabs" role="tablist" aria-label="Workspace">
        <button role="tab" aria-selected={view === "canvas"} onClick={() => setView("canvas")}>Canvas</button>
        <button role="tab" aria-selected={view === "native"} onClick={() => setView("native")}>Native reference</button>
      </div>
      <div className="lab-actions">
        <Action name="image" label="Import original image" onClick={() => input.current.click()} disabled={busy || view !== "canvas"} />
        <Action name="fit" label="Fit slide" onClick={fit} disabled={busy || view !== "canvas"} />
        <Action name="save" label="Save local draft" onClick={() => save().catch(fail)} disabled={busy} />
        <Action name="reload" label="Reload saved scene" onClick={() => load(scenario, true)} disabled={busy} />
        <Action name="play" label="Preview slide export" onClick={exportPreview} disabled={busy} />
      </div>
    </header>
    <aside className="lab-nav" aria-label="Test scenes">
      <h2>Scenes</h2>
      {SCENARIOS.map((item, index) => <button key={item.id} className={`lab-scene ${scenario === item.id ? "is-active" : ""}`} disabled={busy} onClick={() => { setView("canvas"); load(item.id); }}>
        <span className={`lab-thumb lab-thumb--${item.id}`} aria-hidden="true"><span /><span /><span /></span>
        <span className="lab-scene-label"><small>0{index + 1}</small>{item.name}</span>
      </button>)}
      <div className="lab-test-actions"><button disabled={busy} onClick={verify}><Icon name="check" />Check integrity</button>
        <button disabled={busy || view !== "canvas"} onClick={measure}><Icon name="play" />Run benchmark</button></div>
    </aside>
    <main className="lab-workspace" ref={host} onDropCapture={receiveFiles} onPasteCapture={receiveFiles}
      onDragOverCapture={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }}>
      <div className="lab-canvas" hidden={view !== "canvas"}>
        <Excalidraw excalidrawAPI={setApi} onChange={onChange} handleKeyboardGlobally={false} aiEnabled={false} viewModeEnabled={busy || !!preview || view !== "canvas"}
          initialData={{ appState: { viewBackgroundColor: "#f6f7f6", currentItemRoughness: 0, currentItemFontFamily: 2, theme: "light" } }}
          UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false } }}
          validateEmbeddable={link => /^https:\/\/slide-lab\.invalid\/(rich|section|video)$/.test(link)}
          renderEmbeddable={element => <NativeEmbed element={element} />}
          onLibraryChange={items => { runtime.current.library = items; if (runtime.current.ready) save().catch(fail); }}>
          <MainMenu><MainMenu.DefaultItems.ToggleTheme /><MainMenu.DefaultItems.Help /></MainMenu>
        </Excalidraw>
      </div>
      {view === "native" && <div className="lab-native"><iframe title="Native slide reference" src="./native.html?preview=1&fixture=all" /></div>}
      <CornerControls api={api} host={host} disabled={busy || !!preview || view !== "canvas"} />
      {colorSlot && view === "canvas" && labels.length > 0 && !preview && createPortal(<fieldset className="lab-label-color" aria-label="Bound text colour">
        <legend>Text colour</legend>
        <label className="lab-color-link"><input type="checkbox" checked={linked} disabled={busy} onChange={event => changeLabelColor(event.target.checked ? null : "unlink")} />Link text to outline</label>
        {!linked && <><div className="lab-color-swatches">{["#1e1e1e", "#ffffff", "#e03131", "#2f9e44", "#1971c2", "#f08c00"].map(color => <button key={color} title={`Text ${color}`} aria-label={`Text ${color}`} aria-pressed={labels.every(label => label.color === color)} style={{ background: color }} disabled={busy} onClick={() => changeLabelColor(color)} />)}</div>
          <label className="lab-color-hex">Hex<input aria-label="Text colour hex" value={textColor} maxLength={7} spellCheck={false} disabled={busy} onChange={event => setTextColor(event.target.value)} onBlur={() => { if (/^#[\da-f]{6}$/i.test(textColor)) changeLabelColor(textColor); else setTextColor(labels[0].color); }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); }} /></label></>}
      </fieldset>, colorSlot)}
      {busy && <div className="lab-busy" role="status">{runtime.current.measuring ? "Measuring" : "Working"}</div>}
    </main>
    <footer className="lab-footer"><span role="status">{status}</span><span>1280 x 720</span><span>Excalidraw 0.18.1</span>
      {report && <details className="lab-report" open><summary>{report.kind}</summary><dl>{Object.entries(report.values).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></React.Fragment>)}</dl></details>}
    </footer>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { importImage(event.target.files[0]); event.target.value = ""; }} />
    {preview && <dialog ref={dialog} className="lab-preview" onCancel={() => setPreview(null)}>
      <header><strong>Slide export</strong><span>{preview.embeds ? `${preview.embeds} native embeds: export parity not supported` : "SVG / frame-clipped"}</span><Action name="close" label="Close preview" onClick={() => setPreview(null)} /></header>
      <div className="lab-export" dangerouslySetInnerHTML={{ __html: preview.svg }} />
    </dialog>}
  </div>;
}

createRoot(document.getElementById("root")).render(<Lab />);