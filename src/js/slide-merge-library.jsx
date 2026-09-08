import React, { useEffect, useRef, useState } from "react";

export function IconLibrary({ onPick, onClose }) {
  const dialog = useRef(null), frame = useRef(null);
  const [icons, setIcons] = useState([]), [query, setQuery] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    dialog.current.showModal();
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) { setLoading(false); setError("Icon library unavailable. Close and try again."); } }, 15000);
    const load = async () => {
      try {
        const registry = frame.current.contentWindow.RK;
        if (!registry?.iconNames || !registry?.iconSvg) throw new Error("Icon library unavailable. Close and try again.");
        let keywords = {};
        try {
          const response = await fetch("https://media.riteshk.work/content.json", { signal: AbortSignal.timeout(5000) });
          if (response.ok) { const data = await response.json(); registry.registerIcons(data.customIcons); keywords = data.iconKeywords || {}; }
        } catch {}
        if (!cancelled) {
          setIcons(registry.iconNames().map(name => ({ name, svg: registry.iconSvg(name), keywords: keywords[name] || [] })));
          setLoading(false); clearTimeout(timeout);
        }
      } catch (failure) { if (!cancelled) { setError(failure.message); setLoading(false); clearTimeout(timeout); } }
    };
    frame.current.addEventListener("load", load);
    frame.current.src = "/studio/slide-lab/native.html?fixture=rich";
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);
  function pick(icon) {
    const svg = new DOMParser().parseFromString(icon.svg, "image/svg+xml").documentElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "96"); svg.setAttribute("height", "96"); svg.setAttribute("stroke", "#27343a"); svg.setAttribute("color", "#27343a");
    onPick(new File([new XMLSerializer().serializeToString(svg)], `${icon.name}.svg`, { type: "image/svg+xml" }));
  }
  const matches = icons.filter(icon => `${icon.name} ${icon.keywords.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog className="merge-library merge-confirm" ref={dialog} onCancel={onClose} aria-labelledby="merge-icon-title">
    <h2 id="merge-icon-title">Icons</h2><input autoFocus type="search" aria-label="Search icons" placeholder="Search icons" value={query} onChange={event => setQuery(event.target.value)} />
    <iframe hidden title="Studio icon renderer" ref={frame} />
    {loading ? <p role="status">Loading icons...</p> : error ? <p role="alert">{error}</p> : <div className="merge-library-grid">{matches.map(icon => <button key={icon.name} type="button" title={icon.name} aria-label={`Insert ${icon.name} icon`} onClick={() => pick(icon)}><span dangerouslySetInnerHTML={{ __html: icon.svg }} /><span>{icon.name}</span></button>)}{!matches.length && <p>No icons found</p>}</div>}
    <footer><button type="button" onClick={onClose}>Close</button></footer>
  </dialog>;
}