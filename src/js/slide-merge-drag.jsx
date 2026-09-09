import React, { createContext, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, closestCenter } from "@dnd-kit/core";

const NavigatorDrag = createContext(null);

export class NavigatorKeyboardSensor extends KeyboardSensor {
  attach() {
    this.handleStart();
    this.windowListeners.add("resize", this.handleCancel);
    this.windowListeners.add("visibilitychange", this.handleCancel);
    this.windowListeners.add("keydown", event => {
      if (["Space", "Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(event.code)) {
        this.handleKeyDown(event);
        event.stopImmediatePropagation();
      }
    }, { capture:true });
  }
}

function keyboardCoordinates(event, { context, currentCoordinates }) {
  const direction = ["ArrowDown", "ArrowRight"].includes(event.code) ? 1 : ["ArrowUp", "ArrowLeft"].includes(event.code) ? -1 : 0;
  if (!direction || !context.collisionRect) return;
  event.preventDefault();
  const candidates = context.droppableContainers.getEnabled().filter(container => context.active.data.current.kind !== "section" || container.data.current.isSection).sort((first, second) => first.data.current.index - second.data.current.index);
  const currentId = context.over?.data.current.slideId || context.active.data.current.slideId;
  const index = candidates.findIndex(container => container.data.current.slideId === currentId);
  const destination = candidates[index + direction], rect = destination && context.droppableRects.get(destination.id);
  if (!rect) return;
  const active = context.collisionRect, horizontal = destination.data.current.horizontal();
  return {
    x:currentCoordinates.x + rect.left + rect.width * (horizontal ? direction > 0 ? .75 : .25 : .5) - active.left - active.width / 2,
    y:currentCoordinates.y + rect.top + rect.height * (horizontal ? .5 : direction > 0 ? .75 : .25) - active.top - active.height / 2
  };
}

export function NavigatorDragList({ deck, thumbnails, disabled, reorder, children }) {
  const [dragging, setDragging] = useState(null), [destination, setDestination] = useState(null), list = useRef(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint:{ distance:6 } }), useSensor(TouchSensor, { activationConstraint:{ delay:200, tolerance:6 } }), useSensor(NavigatorKeyboardSensor, { coordinateGetter:keyboardCoordinates, scrollBehavior:"auto" }));
  const horizontal = () => { const style = getComputedStyle(list.current); return style.display === "flex" && style.flexDirection === "row"; };
  function groupRange(id) {
    let first = deck.slides.findIndex(slide => slide.id === id);
    while (first > 0 && !deck.slides[first].section) first--;
    let last = first;
    while (last + 1 < deck.slides.length && !deck.slides[last + 1].section) last++;
    return { first, last };
  }
  function dropTarget(event) {
    if (!event.over || !event.active.rect.current.translated) return null;
    const source = event.active.data.current, targetId = event.over.data.current.slideId;
    const rect = event.active.rect.current.translated, over = event.over.rect, across = horizontal();
    const pointer = event.activatorEvent.touches?.[0] || event.activatorEvent;
    const position = across ? Number.isFinite(pointer.clientX) ? pointer.clientX + event.delta.x : rect.left + rect.width / 2 : Number.isFinite(pointer.clientY) ? pointer.clientY + event.delta.y : rect.top + rect.height / 2;
    let edge = position < (across ? over.left + over.width / 2 : over.top + over.height / 2) ? "before" : "after";
    let markerId = targetId;
    if (source.kind === "section") {
      const range = groupRange(targetId), own = groupRange(source.slideId);
      if (range.first === own.first) return null;
      if (!deck.slides[range.first].section) edge = "after";
      markerId = deck.slides[edge === "before" ? range.first : range.last].id;
    } else if (source.slideId === targetId) return null;
    return { targetId, markerId, edge };
  }
  function startDrag(event) {
    const source = event.active.data.current, range = groupRange(source.slideId), slide = deck.slides.find(item => item.id === source.slideId);
    const entry = [...list.current.children].find(element => element.dataset.slideId === source.slideId);
    setDragging({ ...source, ids:source.kind === "section" ? deck.slides.slice(range.first, range.last + 1).map(item => item.id) : [source.slideId], label:source.kind === "section" ? slide.section : slide.title, width:source.kind === "section" ? 180 : entry?.querySelector(".merge-slide").getBoundingClientRect().width || 180 });
  }
  function finishDrag(event) {
    const target = dropTarget(event), source = event.active.data.current;
    setDragging(null); setDestination(null);
    if (target && !disabled) reorder(source.slideId, target.targetId, source.kind, target.edge);
  }
  return <NavigatorDrag.Provider value={{ dragging, destination, disabled, horizontal }}>
    <DndContext sensors={sensors} collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)} onDragStart={startDrag} onDragMove={event => setDestination(dropTarget(event))} onDragOver={event => setDestination(dropTarget(event))} onDragEnd={finishDrag} onDragCancel={() => { setDragging(null); setDestination(null); }}>
      <div ref={list} className={`merge-slide-list ${dragging ? "is-dragging" : ""}`}>{children}</div>
      {createPortal(<DragOverlay dropAnimation={null} zIndex={10050}>{dragging && <div className="merge-reorder-ghost" style={{ width:dragging.width }}>{dragging.kind === "slide" && <span className="merge-thumbnail">{thumbnails[dragging.slideId]}</span>}<span>{dragging.label}</span>{dragging.kind === "section" && <small>{dragging.ids.length} slides</small>}</div>}</DragOverlay>, document.body)}
    </DndContext>
  </NavigatorDrag.Provider>;
}

export function NavigatorDragEntry({ slide, index, children }) {
  const { dragging, destination, disabled, horizontal } = useContext(NavigatorDrag);
  const slideDrag = useDraggable({ id:`slide:${slide.id}`, data:{ kind:"slide", slideId:slide.id }, disabled });
  const sectionDrag = useDraggable({ id:`section:${slide.id}`, data:{ kind:"section", slideId:slide.id }, disabled:disabled || !slide.section });
  const target = useDroppable({ id:`target:${slide.id}`, data:{ slideId:slide.id, index, isSection:!!slide.section, horizontal }, disabled });
  const marker = destination?.markerId === slide.id ? destination.edge : "";
  const moving = dragging?.ids.includes(slide.id);
  const sectionHandle = <button ref={sectionDrag.setNodeRef} className="merge-section-grip" {...sectionDrag.attributes} {...sectionDrag.listeners} aria-label={`Move section ${slide.section}`} title="Move section" disabled={disabled}><GripVertical size={14} strokeWidth={1.75} /></button>;
  return <div ref={target.setNodeRef} className={`merge-slide-entry ${moving ? "is-reordering" : ""}`} data-slide-id={slide.id} data-drop-edge={marker}>
    {children({ slideDrag:{ ref:slideDrag.setNodeRef, ...(!disabled ? { ...slideDrag.attributes, ...slideDrag.listeners } : {}) }, sectionHandle })}
  </div>;
}