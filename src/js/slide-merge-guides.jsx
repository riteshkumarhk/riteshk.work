import React, { useEffect, useState } from "react";
import { rulerTicks } from "./slide-merge-inserts.mjs";

export function CanvasGuides({ api, rulers, margins, thirds }) {
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  useEffect(() => api?.onChange((elements, state) => {
    const next = { zoom: state.zoom.value, x: state.scrollX, y: state.scrollY };
    setCamera(previous => previous.zoom === next.zoom && previous.x === next.x && previous.y === next.y ? previous : next);
  }), [api]);
  if (!rulers && !margins && !thirds) return null;
  return <div className="merge-guides" aria-hidden="true" style={{ left: camera.x * camera.zoom, top: camera.y * camera.zoom, width: 1280 * camera.zoom, height: 720 * camera.zoom }}>
    {rulers && <><div className="merge-ruler merge-ruler-x">{rulerTicks(1280).map(value => <span key={value} style={{ left: `${value / 1280 * 100}%` }}>{value}</span>)}</div><div className="merge-ruler merge-ruler-y">{rulerTicks(720).map(value => <span key={value} style={{ top: `${value / 720 * 100}%` }}>{value}</span>)}</div></>}
    {margins && <div className="merge-safe-margin" />}
    {thirds && <>{[1, 2].map(part => <React.Fragment key={part}><div className="merge-guide-x" style={{ left: `${part / 3 * 100}%` }} /><div className="merge-guide-y" style={{ top: `${part / 3 * 100}%` }} /></React.Fragment>)}</>}
  </div>;
}