import React from "react";
import { Bold, Italic, Underline, Strikethrough, List, IndentIncrease, IndentDecrease } from "lucide-react";
import { textFormat } from "./slide-text-format.mjs";

export function TextFormatControls({ elements, onChange, Button }) {
  if (!elements.length) return null;
  const toggle = (key, label, Icon, active) => <Button key={key} icon={<Icon size={20} strokeWidth={1.75} aria-hidden="true" />} title={label} aria-label={label} aria-pressed={active} active={active === true} onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: key, value: active !== true })} />;
  const state = key => elements.every(element => textFormat(element)[key]) ? true : elements.some(element => textFormat(element)[key]) ? "mixed" : false;
  const lines = elements.flatMap(element => (element.originalText ?? element.text).split("\n").filter(line => line.trim()));
  const bullets = lines.length > 0 && lines.every(line => /^\s*\u2022 /.test(line));
  return <>
    <fieldset className="lab-text-format"><legend>Text style</legend><div className="buttonList">
      {[["bold", "Bold", Bold], ["italic", "Italic", Italic], ["underline", "Underline", Underline], ["strikethrough", "Strikethrough", Strikethrough]].map(([key, label, Icon]) => toggle(key, label, Icon, state(key)))}
    </div></fieldset>
    <fieldset className="lab-text-format"><legend>List and indent</legend><div className="buttonList">
      {toggle("bullets", "Bullets", List, bullets)}
      <Button icon={<IndentDecrease size={20} strokeWidth={1.75} aria-hidden="true" />} title="Decrease indent" aria-label="Decrease indent" disabled={!lines.some(line => /^\s/.test(line))} onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: "outdent" })} />
      <Button icon={<IndentIncrease size={20} strokeWidth={1.75} aria-hidden="true" />} title="Increase indent" aria-label="Increase indent" onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: "indent" })} />
    </div></fieldset>
  </>;
}