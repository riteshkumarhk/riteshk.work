import React, { cloneElement, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye } from "lucide-react";
import "../../css/slide-merge-hover-preview.css";

export function HoverPreview({ label, preview, children }) {
  const id = useId(), host = useRef(null), timer = useRef(null);
  const [position, setPosition] = useState(null);
  function close() { clearTimeout(timer.current); setPosition(null); }
  function leave() { clearTimeout(timer.current); timer.current = setTimeout(close, 180); }
  function open() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const anchor = host.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(420, innerWidth - 32), height = width * 9 / 16 + 44;
      const right = anchor.right + 12;
      const left = right + width <= innerWidth - 16 ? right : anchor.left - width - 12 >= 16 ? anchor.left - width - 12 : (innerWidth - width) / 2;
      const top = innerWidth < 600 ? (anchor.bottom + height + 12 <= innerHeight ? anchor.bottom + 12 : anchor.top - height - 12) : anchor.top;
      setPosition({ width, left, top: Math.max(16, Math.min(top, innerHeight - height - 16)) });
    }, 280);
  }
  useEffect(() => {
    const key = event => { if (event.key === "Escape") close(); };
    const outside = event => { if (!host.current?.contains(event.target) && !event.target.closest?.(".merge-hover-preview")) close(); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => { clearTimeout(timer.current); document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); };
  }, []);
  return <span ref={host} className="merge-hover-host" onPointerEnter={event => { if (event.pointerType === "mouse" && !children.props.disabled) open(); }} onPointerLeave={event => { if (event.pointerType === "mouse") leave(); }} onFocus={event => { if (event.target.matches(":focus-visible")) open(); }} onBlur={leave} onClickCapture={event => { if (!event.target.closest(".merge-touch-preview")) close(); }}>
    {cloneElement(children, { "aria-describedby": position ? id : undefined })}
    <button type="button" className="merge-touch-preview" disabled={children.props.disabled} title={`Preview ${label}`} aria-label={`Preview ${label}`} aria-expanded={!!position} onClick={() => position ? close() : open()}><Eye size={16} strokeWidth={1.75} /></button>
    {position && createPortal(<div id={id} role="tooltip" className="merge-hover-preview" style={position} onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}><div className="merge-hover-preview-stage" inert="">{typeof preview === "function" ? preview() : preview}</div><strong>{label}</strong></div>, document.body)}
  </span>;
}