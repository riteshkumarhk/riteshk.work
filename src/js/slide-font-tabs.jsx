import React from "react";
import { FONT_TABS } from "./slide-font-categories.mjs";
import "../../css/slide-font-tabs.css";

export function FontCategoryTabs({ category, onChange, panelId }) {
  function onKeyDown(event) {
    const index = FONT_TABS.findIndex(([value]) => value === category);
    const target = { ArrowRight: (index + 1) % FONT_TABS.length, ArrowLeft: (index + FONT_TABS.length - 1) % FONT_TABS.length, Home: 0, End: FONT_TABS.length - 1 }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onChange(FONT_TABS[target][0]);
      event.currentTarget.querySelectorAll('[role="tab"]')[target].focus();
    } else if (["Enter", " ", "ArrowUp", "ArrowDown"].includes(event.key)) event.stopPropagation();
  }
  return <div className="lab-font-tabs" role="tablist" aria-label="Font category" onKeyDown={onKeyDown}>
    {FONT_TABS.map(([value, label]) => <button key={value} type="button" role="tab" id={`${panelId}-${value}`} aria-controls={panelId} aria-selected={category === value} tabIndex={category === value ? 0 : -1} onClick={() => onChange(value)}>{label}</button>)}
  </div>;
}