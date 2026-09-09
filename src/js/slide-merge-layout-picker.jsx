import React, { useId } from "react";
import { PROPERTY_LAYOUTS } from "./slide-merge-properties.mjs";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { HoverPreview } from "./slide-merge-hover-preview.jsx";
import { ChoiceTabs } from "./slide-shared-controls.jsx";
import "../../css/slide-merge-layouts.css";

export function LayoutPicker({ layouts = [], tab = "stock", onTab, selected, disabled, onPick, onDelete, onRename, compact = false, error, onRetry }) {
  const id = useId();
  const choices = tab === "stock" ? PROPERTY_LAYOUTS : layouts;
  return <div className="merge-layout-picker">
    <ChoiceTabs id={id} className="merge-layout-tabs" label="Layout collection" options={[["stock", "Stock"], ["user", "My layouts"]]} value={tab} onChange={onTab} />
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
      {tab === "user" && error && <div className="merge-layout-empty" role="status">{error}<button type="button" onClick={onRetry}>Retry</button></div>}
      {tab === "user" && !error && !choices.length && <p className="merge-layout-empty">No saved layouts yet</p>}
      <div className={compact ? "merge-layout-grid" : "merge-layout-choices"}>{choices.map(layout => <div className="merge-layout-item" key={layout.id}>
        <HoverPreview label={layout.name} preview={() => <span className="merge-layout-thumb">{layout.preview ? <img src={layout.preview} alt="" /> : layout.slots?.map((slot, index) => <span key={index} className={slot.kind === "media" ? "is-media" : ""} style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.width}%`, height: `${slot.height}%` }} />)}</span>}><button className="merge-layout-pick" type="button" disabled={disabled} aria-pressed={selected === layout.id} title={layout.name} onClick={() => onPick(layout.id)}>
          <span className="merge-layout-thumb" aria-hidden="true">{layout.preview ? <img src={layout.preview} alt="" /> : layout.slots?.map((slot, index) => <span key={index} className={slot.kind === "media" ? "is-media" : ""} style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${slot.width}%`, height: `${slot.height}%` }} />)}{layout.slots?.length === 0 && <em>Blank</em>}</span>
          <span>{layout.name}</span>
        </button></HoverPreview>
        {tab === "user" && <div className="merge-layout-actions"><button type="button" disabled={disabled} title={`Rename ${layout.name}`} aria-label={`Rename ${layout.name}`} onClick={() => onRename(layout)}>Rename</button><button type="button" disabled={disabled} className="is-danger" title={`Delete ${layout.name}`} aria-label={`Delete ${layout.name}`} onClick={() => onDelete(layout)}><ToolIcon name="trash" /></button></div>}
      </div>)}</div>
    </div>
  </div>;
}