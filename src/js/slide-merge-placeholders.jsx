import React, { useEffect, useState } from "react";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { isEmptyPlaceholder } from "./slide-merge-properties.mjs";
import { placeholderBounds } from "./slide-merge-placeholder-fit.mjs";
import "../../css/slide-merge-placeholders.css";

export function PlaceholderActions({ api, disabled, onInsert }) {
  const [slots, setSlots] = useState([]);
  useEffect(() => {
    if (!api) return;
    const update = (elements, state) => {
      const next = state.editingTextElement || !["selection", "hand"].includes(state.activeTool.type) ? [] : elements.filter(element => !element.isDeleted && !element.locked && isEmptyPlaceholder(element) && (element.customData.slidePlaceholder.kind === "media" || ["Content", "Add your content"].includes(element.customData.slidePlaceholder.label))).map(placeholderBounds).map(element => ({ id: element.id, left: (element.x + state.scrollX) * state.zoom.value, top: (element.y + state.scrollY) * state.zoom.value, width: element.width * state.zoom.value, height: element.height * state.zoom.value, angle: element.angle || 0 }));
      setSlots(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update(api.getSceneElements(), api.getAppState());
    return api.onChange(update);
  }, [api]);
  if (disabled) return null;
  return <div className="merge-placeholder-layer">{slots.map(slot => <div key={slot.id} className="merge-placeholder-slot" style={{ left: slot.left, top: slot.top, width: slot.width, height: slot.height, transform: `rotate(${slot.angle}rad)` }}><div className="merge-placeholder-actions" role="group" aria-label="Insert into content placeholder">{[["text", "content", "Text"], ["media", "image", "Media"], ["sections", "section", "Section"], ["icons", "icons", "Icon"]].map(([pane, icon, label]) => <button key={pane} title={`Insert ${label.toLowerCase()} into placeholder`} aria-label={`Insert ${label.toLowerCase()} into placeholder`} onPointerDown={event => event.stopPropagation()} onClick={() => onInsert(slot.id, pane)}><ToolIcon name={icon} /><span>{label}</span></button>)}</div></div>)}</div>;
}