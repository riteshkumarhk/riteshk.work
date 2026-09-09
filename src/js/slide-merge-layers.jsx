import React, { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, exportToSvg, labNewElementWith, useLabActionManager } from "@excalidraw/excalidraw";
import { ArrowDown, ArrowUp, Check, ChevronsDown, ChevronsUp, Copy, Eye, EyeOff, GripVertical, Group, Image, Layers, LockKeyhole, Pencil, Trash2, Ungroup, UnlockKeyhole, X } from "lucide-react";
import { FRAME_ID } from "./slide-lab-core.mjs";
import { layerName, layerPropertyChanges, layerRows, layerTargets, reorderLayerElements } from "./slide-merge-layers.mjs";
import { LayerDragList, LayerDragRow } from "./slide-merge-layer-drag.jsx";
import { ToolMenu } from "./slide-merge-toolbar.jsx";
import "../../css/slide-merge-layers.css";

function LayerButton({ icon: Icon, label, danger, ...props }) {
  return <button type="button" className={danger ? "is-danger" : undefined} title={label} aria-label={label} {...props}><Icon size={15} strokeWidth={1.75} /></button>;
}

function LayerThumbnail({ element, elements, files }) {
  const [svg, setSvg] = useState("");
  const video = element.customData?.slideBackgroundVideo || element.customData?.sectionVideo;
  const label = elements.find(item => item.type === "text" && item.containerId === element.id && !item.isDeleted);
  useEffect(() => {
    let active = true;
    if (video) return;
    const items = [element, label].filter(Boolean).map(item => ({ ...item, frameId: null, opacity: item.customData?.labLayerHidden?.opacity ?? item.opacity, locked: false }));
    exportToSvg({ elements: items, files, appState: { exportBackground: false, exportWithDarkMode: false }, skipInliningFonts: true }).then(result => {
      result.setAttribute("width", "100%"); result.setAttribute("height", "100%"); result.setAttribute("preserveAspectRatio", "xMidYMid meet");
      if (active) setSvg(result.outerHTML);
    }).catch(() => { if (active) setSvg(""); });
    return () => { active = false; };
  }, [element, label, files, video]);
  return <span className="merge-layer-thumb" aria-hidden="true">{video ? <video src={video} muted playsInline preload="metadata" /> : svg ? <span dangerouslySetInnerHTML={{ __html: svg }} /> : <Image size={18} />}</span>;
}

export function LayerPanel({ api, disabled, onClose, onAdd }) {
  const manager = useLabActionManager();
  const [scene, setScene] = useState(() => ({ elements: api.getSceneElementsIncludingDeleted(), selected: api.getAppState().selectedElementIds }));
  const [editing, setEditing] = useState(null), [name, setName] = useState(""), [error, setError] = useState("");
  const root = useRef(null);
  useEffect(() => api.onChange((elements, state) => setScene({ elements, selected: state.selectedElementIds })), [api]);
  const rows = layerRows(scene.elements), files = api.getFiles();
  const selected = rows.filter(element => scene.selected[element.id]).map(element => element.id);
  function commitProperty(ids, operation, value) {
    if (disabled) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const changes = layerPropertyChanges(elements, ids, operation, value);
    const selectedElementIds = { ...api.getAppState().selectedElementIds };
    if (operation === "hide" && value) for (const id of changes.keys()) delete selectedElementIds[id];
    api.updateScene({ elements: elements.map(element => changes.has(element.id) ? labNewElementWith(element, changes.get(element.id)) : element), appState: { selectedElementIds }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }
  function select(element, additive) {
    const current = additive ? { ...api.getAppState().selectedElementIds } : {};
    if (additive && current[element.id]) delete current[element.id]; else current[element.id] = true;
    delete current[FRAME_ID];
    api.updateScene({ appState: { selectedElementIds: current, selectedGroupIds: {}, editingGroupId: null }, captureUpdate: CaptureUpdateAction.NEVER });
  }
  function action(name, ids) {
    if (disabled || !ids.length) return;
    try {
      const elements = api.getSceneElementsIncludingDeleted();
      const targets = layerTargets(elements, ids);
      const state = { ...api.getAppState(), selectedElementIds: Object.fromEntries([...targets].map(id => [id, true])), selectedGroupIds: {}, editingGroupId: null, editingLinearElement: null, selectedLinearElement: null };
      if (name === "group" || name === "ungroup") {
        const groups = new Set(elements.filter(element => targets.has(element.id) && !element.isDeleted).map(element => element.groupIds?.at(-1)).filter(Boolean));
        for (const element of elements) {
          if (!element.isDeleted && element.id !== FRAME_ID && element.groupIds?.some(id => groups.has(id))) state.selectedElementIds[element.id] = true;
        }
        state.selectedGroupIds = Object.fromEntries([...groups].map(id => [id, true]));
      }
      const native = manager.actions[name];
      if (!native) throw new Error("Layer action unavailable");
      const result = native.perform(elements, state, null, manager.app);
      if (result?.elements && name === "deleteSelectedElements" && elements.some(element => !element.isDeleted && element.customData?.slideBackground) && !result.elements.some(element => !element.isDeleted && element.customData?.slideBackground)) {
        result.elements = result.elements.map(element => element.id === FRAME_ID ? labNewElementWith(element, { customData: { ...element.customData, slideSettings: { ...element.customData?.slideSettings, background: null } } }) : element);
      }
      if (result?.elements && name === "duplicateSelection") {
        result.elements = result.elements.map(element => {
          if (!result.appState?.selectedElementIds?.[element.id] || !element.customData?.slideBackground) return element;
          const customData = { ...element.customData, labLayerName: "Background copy" }, video = customData.slideBackgroundVideo;
          delete customData.slideBackground; delete customData.slideBackgroundVideo;
          if (video) customData.sectionVideo = video;
          return labNewElementWith(element, { customData, locked: !!customData.labLayerHidden, ...(video ? { type: "embeddable", link: "https://slide-lab.invalid/section-video", opacity: customData.labLayerHidden ? 0 : 100 } : {}) });
        });
      }
      manager.updater(result);
      setError("");
    } catch { setError("The layer could not be updated."); }
  }
  function reorder(sourceId, targetId, edge) {
    if (disabled) return;
    try {
      const elements = api.getSceneElementsIncludingDeleted();
      const state = api.getAppState();
      let result;
      const next = reorderLayerElements(elements, sourceId, targetId, edge, (current, name, targets) => {
        result = manager.actions[name].perform(current, { ...state, selectedElementIds:Object.fromEntries([...targets].map(id => [id,true])), selectedGroupIds:{}, editingGroupId:null }, null, manager.app);
        return result?.elements;
      });
      if (next !== elements) manager.updater({ ...result, elements:next, captureUpdate:CaptureUpdateAction.IMMEDIATELY });
      setError("");
    } catch { setError("The layer could not be reordered."); }
  }
  function saveName(element) { if (name.trim()) commitProperty([element.id], "rename", name); setEditing(null); }
  const activeElements = rows.filter(element => selected.includes(element.id));
  const locked = activeElements.length > 0 && activeElements.every(element => element.customData?.labLayerHidden?.locked ?? element.locked);
  const hidden = activeElements.length > 0 && activeElements.every(element => !!element.customData?.labLayerHidden);
  const groupUnits = new Set(activeElements.map(element => element.groupIds?.at(-1) || element.containerId || element.id));
  const canUngroup = activeElements.some(element => element.groupIds?.length);
  return <div ref={root} role="complementary" className="merge-layer-panel" aria-label="Layers" data-prevent-outside-click="true" onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && !editing) onClose(); }}>
    <div className="merge-layer-tools" role="toolbar" aria-label="Layer actions">
      <ToolMenu icon="add" label="Add layer" disabled={disabled}>{[["text", "Text"], ["shape", "Shape"], ["media", "Image or video"]].map(([kind, label]) => <button key={kind} data-close disabled={disabled} onClick={() => onAdd(kind)}>{label}</button>)}</ToolMenu>
      <LayerButton icon={ChevronsUp} label="Bring selected to front" disabled={disabled || !selected.length} onClick={() => action("bringToFront", selected)} />
      <LayerButton icon={ChevronsDown} label="Send selected to back" disabled={disabled || !selected.length} onClick={() => action("sendToBack", selected)} />
      <LayerButton icon={hidden ? Eye : EyeOff} label={hidden ? "Show selected layers" : "Hide selected layers"} disabled={disabled || !selected.length} onClick={() => commitProperty(selected, "hide", !hidden)} />
      <LayerButton icon={locked ? UnlockKeyhole : LockKeyhole} label={locked ? "Unlock selected layers" : "Lock selected layers"} disabled={disabled || !selected.length} onClick={() => commitProperty(selected, "lock", !locked)} />
      <LayerButton icon={Copy} label="Duplicate selected layers" disabled={disabled || !selected.length} onClick={() => action("duplicateSelection", selected)} />
      <LayerButton icon={Trash2} label="Delete selected layers" danger disabled={disabled || !selected.length} onClick={() => action("deleteSelectedElements", selected)} />
      <LayerButton icon={Group} label="Group selected layers" disabled={disabled || groupUnits.size < 2} onClick={() => action("group", selected)} />
      <LayerButton icon={Ungroup} label="Ungroup selected layers" disabled={disabled || !canUngroup} onClick={() => action("ungroup", selected)} />
    </div>
    {error && <p role="alert">{error}</p>}
    <LayerDragList elements={scene.elements} selected={selected} disabled={disabled || !!editing} reorder={reorder} preview={element => <LayerThumbnail element={element} elements={scene.elements} files={files} />}>
      {rows.map((element, index) => {
        const isHidden = !!element.customData?.labLayerHidden, isLocked = element.customData?.labLayerHidden?.locked ?? element.locked;
        return <LayerDragRow key={element.id} element={element} index={index} className={`${scene.selected[element.id] ? "is-selected" : ""} ${isHidden ? "is-hidden" : ""}`}>{dragProps => <>
          <div className="merge-layer-main">
            <button {...dragProps} className="merge-layer-select" disabled={disabled} aria-label={`Select layer: ${layerName(element)}`} aria-pressed={!!scene.selected[element.id]} onClick={event => { if (!isHidden) select(element, event.shiftKey || event.ctrlKey || event.metaKey); }} onDoubleClick={() => { setEditing(element.id); setName(layerName(element)); }}>
              <GripVertical className="merge-layer-grip" size={12} strokeWidth={1.75} aria-hidden="true" /><LayerThumbnail element={element} elements={scene.elements} files={files} /><span title={layerName(element)}>{layerName(element)}<small>{element.customData?.slideBackgroundVideo || element.customData?.sectionVideo ? "Video" : element.type}{element.containerId ? " / Bound text" : element.groupIds?.length ? " / Grouped" : ""}</small></span>
            </button>
            <LayerButton icon={isHidden ? EyeOff : Eye} label={isHidden ? "Show layer" : "Hide layer"} disabled={disabled} aria-pressed={isHidden} onClick={() => commitProperty([element.id], "hide", !isHidden)} />
            <LayerButton icon={isLocked ? LockKeyhole : UnlockKeyhole} label={isLocked ? "Unlock layer" : "Lock layer"} disabled={disabled} aria-pressed={isLocked} onClick={() => commitProperty([element.id], "lock", !isLocked)} />
          </div>
          {editing === element.id ? <form className="merge-layer-rename" onSubmit={event => { event.preventDefault(); saveName(element); }}><input autoFocus aria-label="Layer name" maxLength={120} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEditing(null); } }} /><LayerButton icon={Check} label="Save layer name" disabled={!name.trim()} onClick={() => saveName(element)} /><LayerButton icon={X} label="Cancel layer rename" onClick={() => setEditing(null)} /></form> : <div className="merge-layer-row-actions">
            <LayerButton icon={ArrowUp} label="Move layer up" disabled={disabled || index === 0} onClick={() => action("bringForward", [element.id])} />
            <LayerButton icon={ArrowDown} label="Move layer down" disabled={disabled || index === rows.length - 1} onClick={() => action("sendBackward", [element.id])} />
            <LayerButton icon={Pencil} label="Rename layer" disabled={disabled} onClick={() => { setEditing(element.id); setName(layerName(element)); }} />
            <LayerButton icon={Copy} label="Duplicate layer" disabled={disabled} onClick={() => action("duplicateSelection", [element.id])} />
            <LayerButton icon={Trash2} label="Delete layer" danger disabled={disabled} onClick={() => action("deleteSelectedElements", [element.id])} />
          </div>}
        </>}</LayerDragRow>;
      })}
      {!rows.length && <li className="merge-layer-empty"><Layers size={22} /><span>No layers</span></li>}
    </LayerDragList>
  </div>;
}