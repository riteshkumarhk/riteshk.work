import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { BookType, ALargeSmall, Check } from "lucide-react";
import { NumberField } from "./slide-shared-controls.jsx";
import "../../css/slide-font-size.css";

export const FONT_SIZES = [[12, "XS / Caption"], [16, "S"], [20, "M"], [28, "L"], [36, "XL"], [48, "XXL"], [64, "Display"]];

export function FontLibraryIcon() {
  return <BookType size={18} strokeWidth={1.75} />;
}

export function FontSizePicker({ value, onChange, ButtonSelect, Button, Content, useContainer, icons }) {
  const { container } = useContainer();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const preset = FONT_SIZES.find(([size]) => size === value);
  function toggle(next) {
    if (next) setCustom(value ?? "");
    setOpen(next);
  }
  function choose(size) {
    onChange(size);
    setOpen(false);
  }
  function onKeyDown(event) {
    if (event.key === "Escape") return;
    event.stopPropagation();
    if (event.target.tagName === "INPUT") return;
    const buttons = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')];
    const index = buttons.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
  }
  return <fieldset className="lab-font-size">
    <legend>Font size <span className="lab-type-value">{value == null ? "Mixed" : `${preset ? preset[1] + " / " : ""}${Number(value.toFixed(2))}`}</span></legend>
    <div className="FontPicker__container">
      <ButtonSelect group="font-size" options={[16, 20, 28].map((size, index) => ({ value: size, text: ["Small", "Medium", "Large"][index], icon: icons[index], testId: ["fontSize-small", "fontSize-medium", "fontSize-large"][index] }))} value={value} onChange={onChange} />
      <div className="button-separator" />
      <Popover.Root open={open} onOpenChange={toggle}>
        <Popover.Trigger asChild><div><Button standalone className="properties-trigger" icon={<ALargeSmall size={18} strokeWidth={1.75} />} title="More font sizes" active={value != null && ![16, 20, 28].includes(value)} onClick={() => {}} /></div></Popover.Trigger>
        {open && <Content container={container} className="properties-content lab-size-picker" style={{ width: "15rem" }} onClose={() => setOpen(false)} onKeyDown={onKeyDown}>
          <div role="menu" aria-label="Font sizes" className="lab-size-options">
            {FONT_SIZES.map(([size, label]) => <button type="button" role="menuitemradio" aria-checked={value === size} key={size} onClick={() => choose(size)}><span>{label}</span><span>{size}<Check aria-hidden="true" size={14} strokeWidth={1.75} style={{ visibility: value === size ? "visible" : "hidden" }} /></span></button>)}
          </div>
          <form className="lab-size-custom" onSubmit={event => { event.preventDefault(); const size = Number(custom); if (Number.isFinite(size) && size >= 1 && size <= 1000) choose(size); }}>
            <label>Custom <NumberField aria-label="Custom font size" min="1" max="1000" step="any" required value={custom} onChange={event => setCustom(event.target.value)} /></label>
            <button type="submit" title="Apply custom font size" aria-label="Apply custom font size"><Check size={18} strokeWidth={1.75} /></button>
          </form>
        </Content>}
      </Popover.Root>
    </div>
  </fieldset>;
}