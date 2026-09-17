import React, { createContext, useContext, useState } from "react";

export const IconColorContext = createContext(null);

export function recolorIconFile(file, color) {
  const match = /^data:image\/svg\+xml(;base64)?,(.*)$/s.exec(file?.dataURL || "");
  if (!match) throw new Error("The original icon is unavailable. Reinsert it from Icons and try again.");
  const source = match[1] ? new TextDecoder().decode(Uint8Array.from(atob(match[2]), character => character.charCodeAt(0))) : decodeURIComponent(match[2]);
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") throw new Error("The icon SVG could not be read.");
  const root = document.documentElement;
  root.setAttribute("color", color);
  if (!root.hasAttribute("fill")) root.setAttribute("fill", color);
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const property of ["stroke", "fill", "color"]) {
      const paint = element.getAttribute(property);
      if (paint && !/^(none|transparent|url\()/i.test(paint)) element.setAttribute(property, color);
      const style = element.style?.getPropertyValue(property);
      if (style && !/^(none|transparent|url\()/i.test(style)) element.style.setProperty(property, color);
    }
  }
  const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(root));
  return { ...file, id: crypto.randomUUID(), dataURL: "data:image/svg+xml;base64," + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")), created: Date.now() };
}

export function IconColorControls({ NativePicker, palette, topPicks, appState, newElementWith, captureUpdate }) {
  const context = useContext(IconColorContext);
  const [error, setError] = useState("");
  if (!context?.api || context.disabled) return null;
  const { api } = context;
  const selected = api.getSceneElements().filter(element => appState.selectedElementIds[element.id]);
  if (!selected.length || selected.some(element => element.type !== "image" || !element.customData?.studioIcon || element.locked)) return null;
  const colors = new Set(selected.map(element => element.strokeColor));
  function change(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    try {
      const elements = api.getSceneElementsIncludingDeleted(), state = api.getAppState();
      if (state.viewModeEnabled) return;
      const targets = elements.filter(element => state.selectedElementIds[element.id] && !element.isDeleted && !element.locked && element.type === "image" && element.customData?.studioIcon && element.strokeColor !== color);
      const files = api.getFiles(), updates = new Map(targets.map(element => [element.id, recolorIconFile(files[element.fileId], color)]));
      if (!updates.size) return;
      api.updateScene({ elements: elements.map(element => updates.has(element.id) ? newElementWith(element, { fileId: updates.get(element.id).id, strokeColor: color }) : element), captureUpdate });
      api.addFiles([...updates.values()]);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  return <fieldset className="lab-icon-color"><legend>Icon colour</legend>
    <NativePicker type="elementStroke" label="Icon colour" palette={palette} topPicks={topPicks} color={colors.size === 1 ? selected[0].strokeColor : null} onChange={change} elements={api.getSceneElements()} appState={appState} updateData={value => api.updateScene({ appState: value })} />
    {error && <p className="merge-rich-error" role="alert">{error}</p>}
  </fieldset>;
}