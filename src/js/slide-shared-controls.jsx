import React, { useRef } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import "../../css/slide-shared-controls.css";

export function SelectControl({ className = "", children, ...props }) {
  return <select {...props} className={`slide-select ${className}`}>{children}</select>;
}

export function NumberField({ onChange, onStep, ...props }) {
  const input = useRef(null);
  function step(direction) {
    const element = input.current;
    const amount = props.step === "any" ? 1 : Number(props.step || 1);
    const value = Math.min(Number(props.max ?? Infinity), Math.max(Number(props.min ?? -Infinity), (Number(element.value) || 0) + direction * amount));
    const next = String(Number(value.toFixed(8)));
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
    onStep?.(next);
  }
  return <span className="slide-number"><input {...props} ref={input} type="number" onChange={onChange} /><span className="slide-number-steps">{[1, -1].map(direction => <button key={direction} type="button" disabled={props.disabled || (props.value !== "" && (direction > 0 ? Number(props.value) >= Number(props.max ?? Infinity) : Number(props.value) <= Number(props.min ?? -Infinity)))} tabIndex={-1} aria-label={`${direction > 0 ? "Increase" : "Decrease"} ${props["aria-label"] || "value"}`} title={direction > 0 ? "Increase" : "Decrease"} onPointerDown={event => event.preventDefault()} onClick={() => step(direction)}>{direction > 0 ? <ChevronUp /> : <ChevronDown />}</button>)}</span></span>;
}

export function ChoiceTabs({ id, label, options, value, onChange, className = "" }) {
  const host = useRef(null);
  function choose(key) { onChange(key); host.current?.querySelector(`[data-choice="${key}"]`)?.focus(); }
  return <div ref={host} className={className} role="tablist" aria-label={label}>{options.map(([key, title]) => <button type="button" role="tab" key={key} id={`${id}-${key}`} data-choice={key} aria-controls={`${id}-panel`} aria-selected={value === key} tabIndex={value === key ? 0 : -1} onClick={() => onChange(key)} onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = options.findIndex(([choice]) => choice === value);
    choose(options[event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length][0]);
  }}>{title}</button>)}</div>;
}