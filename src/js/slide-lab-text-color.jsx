import React, { createContext, useContext, useRef, useEffect } from "react";

export const LabTextColorContext = createContext(null);

export function LabStrokeLink({ type }) {
  const state = useContext(LabTextColorContext);
  const checkbox = useRef(null);
  const mixed = !!state?.labels.some(label => label.linked) && !state.linked;
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = mixed; }, [mixed]);
  if (type !== "elementStroke" || !state?.labels.length) return null;
  return <label className="lab-stroke-link" onKeyDown={event => {
    if (event.key !== "Escape") event.stopPropagation();
  }}><input ref={checkbox} type="checkbox" checked={state.linked} disabled={state.busy}
    onChange={event => state.changeLabelColor(event.target.checked ? null : "unlink")} />Link stroke to text</label>;
}

export function LabTextColorControls({ NativePicker, palette, topPicks, appState }) {
  const state = useContext(LabTextColorContext);
  if (!state?.labels.length || state.linked) return null;
  const colors = new Set(state.labels.map(label => label.color));
  return <div className="lab-label-color">
    <h3>Text colour</h3>
    <NativePicker type="labText" label="Text colour" palette={palette} topPicks={topPicks}
      color={colors.size === 1 ? state.labels[0].color : null}
      onChange={state.changeLabelColor} elements={state.api.getSceneElements()}
      appState={appState} updateData={value => state.api.updateScene({ appState: value })} />
  </div>;
}