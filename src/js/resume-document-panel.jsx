import React, { useEffect, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, closestCenter } from "@dnd-kit/core";
import { GripVertical, ArrowUp, ArrowDown, Plus, Trash2, Copy, ChevronRight } from "lucide-react";
import { resumeContactItems, resumeSectionColumn, reorderResumeItems } from "./resume-document.mjs";

function DocumentRow({ item, index, items, onMove, children, details }) {
  const drag = useDraggable({ id: item.id }), drop = useDroppable({ id: item.id });
  return <div ref={drop.setNodeRef} className={"rws-document-row" + (drop.isOver && !drag.isDragging ? " is-drop-target" : "")} data-document-item={item.id}>
    <div ref={drag.setNodeRef} className="rws-document-row-heading" style={{ opacity: drag.isDragging ? 0.45 : 1 }}>
      <button className="rws-document-drag" ref={drag.setActivatorNodeRef} {...drag.attributes} {...drag.listeners} aria-label={"Drag " + item.label} title="Drag to reorder"><GripVertical size={14} /></button>
      {children}
      <div className="rws-document-order">
        <button aria-label={"Move " + item.label + " up"} disabled={!index} onClick={() => onMove(item.id, items[index - 1].id)}><ArrowUp size={13} /></button>
        <button aria-label={"Move " + item.label + " down"} disabled={index === items.length - 1} onClick={() => onMove(item.id, items[index + 1].id)}><ArrowDown size={13} /></button>
      </div>
    </div>
    {details}
  </div>;
}

function DocumentList({ items, onMove, children, label, renderDetails }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) onMove(active.id, over.id); }}>
    <div className="rws-document-list" aria-label={label}>
      {items.map((item, index) => <DocumentRow key={item.id} {...{ item, index, items, onMove }} details={renderDetails?.(item)}>{children(item)}</DocumentRow>)}
    </div>
  </DndContext>;
}

export function ResumeDocumentPanel({ document, group, selectedField, onSelect, onEditContact, onAddContact, onAddSection, onAddItem, onRemoveSection, mutate }) {
  const [expanded, setExpanded] = useState(null);
  useEffect(() => setExpanded(group), [group, selectedField]);
  const model = document.model, contacts = resumeContactItems(model);
  const reorder = (get, set) => (active, over) => mutate(next => set(next, reorderResumeItems(get(next), active, over)), "Reordered document");
  const reorderSections = reorder(next => next.model.sections, (next, items) => { next.model.sections = items; });
  const select = (id, fieldId) => { setExpanded(id); onSelect(id, fieldId); };
  const duplicate = (sectionId, entryId) => mutate(next => {
    const section = next.model.sections.find(section => section.id === sectionId), items = section.groups || section.items;
    const index = items.findIndex(item => item.id === entryId), entry = structuredClone(items[index]);
    entry.id = crypto.randomUUID();
    if (entry.bullets) entry.bullets = entry.bullets.map(bullet => ({ ...bullet, id: crypto.randomUUID() }));
    items.splice(index + 1, 0, entry);
  }, "Duplicated entry");
  const sectionControls = section => {
    const items = (section.groups || section.items || []).map(item => ({ ...item, label: item.org || item.school || item.label || item.title || "New entry" }));
    return <div className="rws-document-children">
      {document.design.layout === "sidebar" && <label className="rws-field"><span>Column</span><select aria-label={"Column for " + section.heading} value={resumeSectionColumn(section)} onChange={event => mutate(next => { next.model.sections.find(item => item.id === section.id).column = event.target.value; }, "Moved section to column")}><option value="main">Main column</option><option value="side">Side column</option></select></label>}
      {document.design.layout === "hybrid" && section.items && !['experience', 'education'].includes(section.kind) && <label className="rws-field"><span>Entry columns</span><select aria-label={"Entry columns for " + section.heading} value={section.columns || 1} onChange={event => mutate(next => { next.model.sections.find(item => item.id === section.id).columns = Number(event.target.value); }, "Changed entry columns")}><option value="1">One</option><option value="2">Two</option><option value="3">Three</option></select></label>}
      <DocumentList label={section.heading + " entries"} items={items} onMove={reorder(next => { const current = next.model.sections.find(item => item.id === section.id); return current.groups || current.items; }, (next, items) => { const current = next.model.sections.find(item => item.id === section.id); current[current.groups ? "groups" : "items"] = items; })} renderDetails={item => (selectedField?.startsWith(item.id + ".") || item.bullets?.some(bullet => bullet.id === selectedField)) && <div className="rws-document-children">
        {item.bullets && <DocumentList label={"Achievements for " + item.label} items={item.bullets.map((bullet, index) => ({ ...bullet, label: bullet.text || "Achievement " + (index + 1) }))} onMove={reorder(next => next.model.sections.find(row => row.id === section.id).items.find(row => row.id === item.id).bullets, (next, bullets) => { next.model.sections.find(row => row.id === section.id).items.find(row => row.id === item.id).bullets = bullets; })}>
          {bullet => <><button className="rws-document-item-label" onClick={() => select(section.id, bullet.id)}>{bullet.label}</button><button aria-label="Remove achievement" onClick={() => mutate(next => { const entry = next.model.sections.find(row => row.id === section.id).items.find(row => row.id === item.id); entry.bullets = entry.bullets.filter(row => row.id !== bullet.id); }, "Removed achievement")}><Trash2 size={13} /></button></>}
        </DocumentList>}
        <div className="rws-document-entry-actions">
          {(section.kind === "skills" ? [["label", "Skill group title"]] : [["dates", "Date (optional)"], ...(section.kind === "education" ? [["note", "Note (optional)"]] : section.kind === "experience" ? [["location", "Location (optional)"]] : [["meta", "Details (optional)"]])]).map(([key, label]) => {
            const Input = key === "meta" ? "textarea" : "input";
            return <label className="rws-field" key={key}><span>{label}</span><Input aria-label={label} value={(section.groups || section.items).find(entry => entry.id === item.id)[key] || ""} onChange={event => mutate(next => {
              const current = next.model.sections.find(row => row.id === section.id);
              (current.groups || current.items).find(entry => entry.id === item.id)[key] = event.target.value;
            }, "Edited " + label.toLowerCase())} /></label>;
          })}
          {item.bullets && <button onClick={() => mutate(next => { next.model.sections.find(row => row.id === section.id).items.find(row => row.id === item.id).bullets.push({ id: crypto.randomUUID(), text: "" }); }, "Added achievement")}><Plus size={13} />Add bullet</button>}
          <button onClick={() => duplicate(section.id, item.id)}><Copy size={13} />Duplicate</button>
          <button onClick={() => mutate(next => { const current = next.model.sections.find(row => row.id === section.id); const key = current.groups ? "groups" : "items"; current[key] = current[key].filter(row => row.id !== item.id); }, "Removed entry")}><Trash2 size={13} />Remove</button>
        </div>
      </div>}>
        {item => <button className="rws-document-item-label" onClick={() => select(section.id, item.id + (section.kind === "experience" ? ".role" : section.kind === "education" ? ".school" : section.kind === "skills" ? ".label" : ".title"))}>{item.label}</button>}
      </DocumentList>
      <div className="rws-document-entry-actions">
        {section.kind !== "text" && <button onClick={() => onAddItem(section)}><Plus size={14} />{section.kind === "experience" ? "Add role" : "Add entry"}</button>}
        <button onClick={() => onRemoveSection(section.id)}><Trash2 size={14} />Remove section</button>
      </div>
    </div>;
  };
  const sectionList = (sections, label) => <><h3 className="rws-document-group">{label}</h3><DocumentList label={label} items={sections.map(section => ({ ...section, label: section.heading || "Untitled section" }))} onMove={reorderSections} renderDetails={section => (expanded || group) === section.id && sectionControls(section)}>
    {section => <button className="rws-document-item-label" aria-expanded={(expanded || group) === section.id} aria-current={group === section.id ? "true" : undefined} onClick={() => { if ((expanded || group) === section.id) setExpanded("collapsed"); else select(section.id, section.id + ".heading"); }}><ChevronRight size={13} style={{ transform: (expanded || group) === section.id ? "rotate(90deg)" : undefined }} />{section.label}</button>}
  </DocumentList></>;
  return <section className="rws-document-builder" aria-label="Document structure">
    <div className="rws-panel-heading"><h2>Document</h2><button aria-label="Add a section" onClick={onAddSection}><Plus size={16} /></button></div>
    <h3 className="rws-document-group">Header</h3>
    <button className="rws-document-jump" onClick={() => select("Profile", "name")}>Name and professional title</button>
    <DocumentList label="Contact order" items={contacts} onMove={reorder(next => resumeContactItems(next.model), (next, items) => { next.model.contact.order = items.map(item => item.id); })}>
      {item => <button className="rws-document-item-label" onClick={() => onEditContact(item.fieldId)}>{item.label}</button>}
    </DocumentList>
    <button className="rws-add-row" onClick={onAddContact}><Plus size={14} />Add contact detail</button>
    <button className="rws-document-jump" aria-current={selectedField === "summary" ? "true" : undefined} onClick={() => select("Profile", "summary")}>Profile</button>
    {document.design.layout === "sidebar" ? <>{sectionList(model.sections.filter(section => resumeSectionColumn(section) === "main"), "Main column")}{sectionList(model.sections.filter(section => resumeSectionColumn(section) === "side"), "Side column")}</> : sectionList(model.sections, "Sections")}
  </section>;
}
