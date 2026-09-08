import React, { useEffect, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { normalizeHex, hexToRgb, rgbToHex, customColorList } from "./slide-lab-color.mjs";

const STORAGE_KEY = "rk:slide-lab:custom-colors";

export function useLabCustomColors(color, sceneColors, palette) {
  const [saved, setSaved] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(stored) ? customColorList(stored) : [];
    } catch { return []; }
  });
  useEffect(() => {
    const presets = Object.values(palette).flat();
    if (!customColorList([color], presets).length) return;
    setSaved(previous => {
      const next = customColorList([color, ...previous]);
      if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [color, palette]);
  return customColorList([...saved, ...sceneColors], Object.values(palette).flat());
}

export function LabRichColor({ color, onChange }) {
  const [draft, setDraft] = useState(normalizeHex(color) || "#ffffff");
  const [channels, setChannels] = useState(() => hexToRgb(draft).map(String));
  const gesture = useRef(null);
  const latest = useRef(draft);
  useEffect(() => {
    if (gesture.current) return;
    const next = normalizeHex(color) || "#ffffff";
    latest.current = next;
    setDraft(next);
    setChannels(hexToRgb(next).map(String));
  }, [color]);
  function preview(next) {
    latest.current = next;
    setDraft(next);
    setChannels(hexToRgb(next).map(String));
    if (!gesture.current) onChange(next);
  }
  function finish(cancel = false) {
    const start = gesture.current;
    if (!start) return;
    gesture.current = null;
    if (cancel) {
      latest.current = start;
      setDraft(start);
      setChannels(hexToRgb(start).map(String));
    } else if (latest.current !== normalizeHex(color)) onChange(latest.current);
  }
  function commitRgb() {
    const next = rgbToHex(channels);
    if (next) {
      preview(next);
    } else setChannels(hexToRgb(draft).map(String));
  }
  return <div className="lab-rich-color" onKeyDown={event => {
    if (event.key === "Escape") { finish(true); return; }
    event.stopPropagation();
  }}>
    <div className="color-picker__heading">Spectrum</div>
    <div className="lab-spectrum" onPointerDownCapture={event => {
      if (event.button !== 0) return;
      gesture.current = draft;
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()}>
      <HexColorPicker color={draft} onChange={preview} />
    </div>
    <div className="lab-rgb" role="group" aria-label="RGB color">
      {["R", "G", "B"].map((label, index) => <label key={label}>{label}<input
        aria-label={{ R: "Red", G: "Green", B: "Blue" }[label]} type="number" min="0" max="255" step="1"
        value={channels[index]} onChange={event => setChannels(previous => previous.map((channel, position) => position === index ? event.target.value : channel))}
        onBlur={commitRgb} onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { setChannels(hexToRgb(draft).map(String)); event.stopPropagation(); }
        }} /></label>)}
    </div>
  </div>;
}