import React, { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, closestCenter } from "@dnd-kit/core";
import { NavigatorKeyboardSensor } from "./slide-merge-drag.jsx";
import { layerMoveTargets, layerName } from "./slide-merge-layers.mjs";

const LayerDrag = createContext(null);

function keyboardCoordinates(event, { context, currentCoordinates }) {
  const direction = event.code === "ArrowDown" ? 1 : event.code === "ArrowUp" ? -1 : 0;
  if (!direction || !context.collisionRect) return;
  event.preventDefault();
  const candidates = context.droppableContainers.getEnabled().sort((first, second) => first.data.current.index - second.data.current.index);
  const currentId = context.over?.id || context.active.id;
  const index = candidates.findIndex(container => container.id === currentId);
  const destination = candidates[index + direction], rect = destination && context.droppableRects.get(destination.id);
  if (!rect) return;
  return { x:currentCoordinates.x, y:currentCoordinates.y + rect.top + rect.height * (direction > 0 ? .75 : .25) - context.collisionRect.top - context.collisionRect.height / 2 };
}

export function LayerDragList({ elements, selected, disabled, reorder, preview, children }) {
  const [dragging, setDragging] = useState(null), [destination, setDestination] = useState(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint:{ distance:6 } }), useSensor(TouchSensor, { activationConstraint:{ delay:200, tolerance:6 } }), useSensor(NavigatorKeyboardSensor, { coordinateGetter:keyboardCoordinates, scrollBehavior:"auto" }));
  const sourceIds = id => selected.includes(id) ? selected : [id];
  function dropTarget(event) {
    if (!event.over || !event.active.rect.current.translated) return null;
    const source = layerMoveTargets(elements, dragging?.sourceIds || sourceIds(event.active.id)), target = layerMoveTargets(elements, event.over.id);
    if ([...target].some(id => source.has(id))) return null;
    const pointer = event.activatorEvent.touches?.[0] || event.activatorEvent;
    const rect = event.active.rect.current.translated;
    const position = Number.isFinite(pointer.clientY) ? pointer.clientY + event.delta.y : rect.top + rect.height / 2;
    const edge = position < event.over.rect.top + event.over.rect.height / 2 ? "before" : "after";
    const targetRows = elements.filter(element => !element.isDeleted && target.has(element.id)).toReversed();
    return { id:event.over.id, markerId:targetRows[edge === "before" ? 0 : targetRows.length - 1].id, edge };
  }
  function reset() { setDragging(null); setDestination(null); }
  return <LayerDrag.Provider value={{ disabled, dragging, destination }}>
    <DndContext sensors={sensors} collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)} onDragStart={event => setDragging({ id:event.active.id, sourceIds:sourceIds(event.active.id), ids:layerMoveTargets(elements, sourceIds(event.active.id)), width:event.active.rect.current.initial?.width || 180 })} onDragMove={event => setDestination(dropTarget(event))} onDragOver={event => setDestination(dropTarget(event))} onDragCancel={reset} onDragEnd={event => {
      const target = dropTarget(event);
      reset();
      if (target && !disabled) reorder(dragging?.sourceIds || sourceIds(event.active.id), target.id, target.edge);
    }} accessibility={{ screenReaderInstructions:{ draggable:"Press Space to pick up a layer, Up or Down to move, Space to drop, or Escape to cancel." } }}>
      <ol className="merge-layer-list" aria-label="Slide layers">{children}</ol>
      {createPortal(<DragOverlay dropAnimation={null} zIndex={10050}>{dragging && <div className="merge-layer-drag-preview" data-prevent-outside-click style={{width:dragging.width}}>{preview(elements.find(element => element.id === dragging.id))}<span>{dragging.ids.size > 1 ? `${dragging.ids.size} layers` : layerName(elements.find(element => element.id === dragging.id))}</span></div>}</DragOverlay>, document.body)}
    </DndContext>
  </LayerDrag.Provider>;
}

export function LayerDragRow({ element, index, className, children }) {
  const { disabled, dragging, destination } = useContext(LayerDrag);
  const drag = useDraggable({ id:element.id, disabled });
  const target = useDroppable({ id:element.id, data:{index}, disabled });
  return <li ref={node => { drag.setNodeRef(node); target.setNodeRef(node); }} data-layer-id={element.id} data-drop-edge={destination?.markerId === element.id ? destination.edge : undefined} className={`${className} ${dragging?.ids.has(element.id) ? "is-reordering" : ""}`}>
    {children({ ...drag.attributes, ...drag.listeners })}
  </li>;
}