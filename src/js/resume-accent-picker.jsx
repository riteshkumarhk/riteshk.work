import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LabColorPicker, LabColorPickerContainer, LabColorPickerDevice, LabColorPickerStateProvider, useLabColorPickerAtom, LAB_BACKGROUND_PALETTE, labActiveEyeDropperAtom } from "@excalidraw/excalidraw";
import { openScreenEyeDropper } from "./slide-lab-eyedropper.mjs";
import "@excalidraw/excalidraw/index.css";
import "../../css/slide-lab.css";
import "../../css/slide-merge-theme.css";

export function ResumeAccentPicker({ color, onChange, onError }) {
  return <LabColorPickerStateProvider><AccentPicker color={color} onChange={onChange} onError={onError} /></LabColorPickerStateProvider>;
}

function AccentPicker({ color, onChange, onError }) {
  const [container, setContainer] = useState(null);
  const triggerRoot = useRef(null);
  const [state, setState] = useState({ openPopup: null });
  const [mobile, setMobile] = useState(() => innerWidth < 760);
  useEffect(() => {
    const resize = () => setMobile(innerWidth < 760);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    const restore = wasOpen.current && !state.openPopup;
    wasOpen.current = !!state.openPopup;
    if (restore) {
      const frame = requestAnimationFrame(() => triggerRoot.current?.querySelector('.active-color')?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [state.openPopup, container]);
  const [eyeDropper, setEyeDropper] = useLabColorPickerAtom(labActiveEyeDropperAtom);
  useEffect(() => {
    if (!eyeDropper) return;
    const finish = () => { setEyeDropper(null); triggerRoot.current?.querySelector('.active-color')?.focus(); };
    if (typeof window.EyeDropper !== "function") {
      finish(); setState({ openPopup: null }); onError("Screen colour picking is unavailable. Use the spectrum or a colour value."); return;
    }
    return openScreenEyeDropper({
      onSelect: value => { eyeDropper.onSelect(value); finish(); },
      onCancel: finish,
      onError: () => { finish(); onError("Screen colour picking is unavailable. Use the spectrum or a colour value."); }
    }, window);
  }, [eyeDropper, container, setEyeDropper]);
  useEffect(() => () => setEyeDropper(null), [setEyeDropper]);
  return <><div className="rws-accent excalidraw excalidraw-container theme--dark" ref={triggerRoot}>
    <LabColorPickerContainer.Provider value={{ container, id: "resume-accent" }}>
      <LabColorPickerDevice.Provider value={{ editor: { isMobile: mobile }, viewport: { isMobile: mobile, isLandscape: false }, isTouchScreen: mobile }}>
      <LabColorPicker type="elementBackground" label="Accent" color={color} elements={[]} palette={LAB_BACKGROUND_PALETTE} appState={state} updateData={setState} onChange={value => { if (/^#[0-9a-f]{6}$/i.test(value)) onChange(value); }} />
      </LabColorPickerDevice.Provider>
    </LabColorPickerContainer.Provider>
  </div>{createPortal(<div className="rws-picker-portal adm excalidraw excalidraw-container theme--dark" ref={setContainer} />, document.body)}</>;
}