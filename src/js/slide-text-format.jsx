import React, { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bold, Italic, Underline, Strikethrough, List, ListFilter, Check, IndentIncrease, IndentDecrease, Minus } from "lucide-react";
import { textFormat, textListLine, textCase } from "./slide-text-format.mjs";

const BULLET_STYLES = [["dot", "Dot", "\u2022  \u2022  \u2022"], ["number", "Number", "1.  2.  3."], ["alphabet", "Alphabet", "a.  b.  c."], ["dash", "Dash", "-  -  -"]];
const CASE_STYLES = [["typed", "As typed", <Minus size={18} strokeWidth={1.75} />], ["upper", "All caps", "AG"], ["lower", "Lowercase", "ag"], ["title", "Title case", "Ag"], ["small-caps", "Small caps", <>A<span style={{ fontSize: ".75em" }}>G</span></>]];

function BulletStylePicker({ value, onChange, Button, Content, useContainer }) {
  const { container } = useContainer();
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  function keyDown(event) {
    if (event.key === "Escape") return;
    event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')];
    const index = buttons.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
  }
  return <><div className="button-separator" /><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><Button ref={trigger} standalone className="properties-trigger" icon={<ListFilter size={18} strokeWidth={1.75} aria-hidden="true" />} title="Bullet style" aria-label="Bullet style" active={value !== "dot"} onClick={() => {}} /></Popover.Trigger>
    {open && <Content container={container} className="properties-content lab-size-picker lab-bullet-picker" style={{ width: "15rem" }} onClose={() => { setOpen(false); if (document.activeElement === container || document.activeElement === document.body) trigger.current?.focus(); }} onKeyDown={keyDown}>
      <div role="menu" aria-label="Bullet styles" className="lab-size-options">
        {BULLET_STYLES.map(([style, label, preview]) => <button type="button" role="menuitemradio" aria-label={label} aria-checked={value === style} key={style} onClick={() => { onChange({ action: "bullet-style", value: style }); setOpen(false); }}><span>{label}</span><span aria-hidden="true">{preview}<Check size={14} strokeWidth={1.75} style={{ visibility: value === style ? "visible" : "hidden" }} /></span></button>)}
      </div>
    </Content>}
  </Popover.Root></>;
}

export function TextFormatControls({ elements, onChange, Button, Content, useContainer }) {
  if (!elements.length) return null;
  const caseKey = event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); };
  const toggle = (key, label, Icon, active) => <Button key={key} icon={<Icon size={20} strokeWidth={1.75} aria-hidden="true" />} title={label} aria-label={label} aria-pressed={active} active={active === true} onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: key, value: active !== true })} />;
  const state = key => elements.every(element => textFormat(element)[key]) ? true : elements.some(element => textFormat(element)[key]) ? "mixed" : false;
  const lines = elements.flatMap(element => (element.originalText ?? element.text).split("\n").filter(line => line.trim()));
  const styles = new Set(lines.map(line => textListLine(line).style));
  const bullets = lines.length > 0 && !styles.has(null);
  return <>
    <fieldset className="lab-text-format"><legend>Text style</legend><div className="buttonList">
      {[["bold", "Bold", Bold], ["italic", "Italic", Italic], ["underline", "Underline", Underline], ["strikethrough", "Strikethrough", Strikethrough]].map(([key, label, Icon]) => toggle(key, label, Icon, state(key)))}
    </div></fieldset>
    <fieldset className="lab-text-format lab-text-case"><legend>Case</legend><div className="buttonList" role="group" aria-label="Text case" onKeyDown={caseKey} onKeyUp={caseKey}>
      {CASE_STYLES.map(([mode, label, preview]) => <Button key={mode} icon={<span aria-hidden="true" style={{ fontSize: 12, fontWeight: 500 }}>{preview}</span>} title={label} aria-label={label} aria-pressed={elements.every(element => textCase(element) === mode)} active={elements.every(element => textCase(element) === mode)} onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: "case", value: mode })} />)}
    </div></fieldset>
    <fieldset className="lab-text-format"><legend>List and indent</legend><div className="FontPicker__container"><div className="buttonList">
      {toggle("bullets", "Bullets", List, bullets)}
      <Button icon={<IndentDecrease size={20} strokeWidth={1.75} aria-hidden="true" />} title="Decrease indent" aria-label="Decrease indent" disabled={!lines.some(line => /^\s/.test(line))} onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: "outdent" })} />
      <Button icon={<IndentIncrease size={20} strokeWidth={1.75} aria-hidden="true" />} title="Increase indent" aria-label="Increase indent" onPointerDown={event => event.preventDefault()} onClick={() => onChange({ action: "indent" })} />
    </div>{bullets && <BulletStylePicker value={styles.size === 1 ? [...styles][0] : null} onChange={onChange} Button={Button} Content={Content} useContainer={useContainer} />}</div></fieldset>
  </>;
}