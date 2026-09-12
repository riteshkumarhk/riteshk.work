import React, { useEffect, useRef, useState } from "react";
import { AiRibbonIcon as Sparkles } from "./ai-ribbon.jsx";
import { DeckDialog } from "./slide-merge-navigator.jsx";
import { generateSlideIcon } from "./slide-merge-ai-client.mjs";
import { studioIconRegistry, studioSourceData, saveGeneratedStudioIcon } from "./slide-studio-source.mjs";

export function IconLibrary({ onPick, onClose, embedded = false }) {
  const dialog = useRef(null), request = useRef(null), generated = useRef(null);
  const [icons, setIcons] = useState([]), [query, setQuery] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false), [description, setDescription] = useState(""), [working, setWorking] = useState(false), [generationError, setGenerationError] = useState("");
  useEffect(() => {
    if (!embedded) dialog.current.showModal();
    let cancelled = false;
    const load = async () => {
      try {
        const registry = await studioIconRegistry();
        if (!registry?.iconNames || !registry?.iconSvg) throw new Error("Icon library unavailable. Close and try again.");
        const data = await studioSourceData(); registry.registerIcons(data.customIcons || {});
        const keywords = data.iconKeywords || {};
        if (!cancelled) {
          setIcons(registry.iconNames().filter(name => !data.iconsRetired?.[name]).map(name => ({ name, svg: registry.iconSvg(name), keywords: keywords[name] || [] })));
          setLoading(false);
        }
      } catch (failure) { if (!cancelled) { setError(failure.message); setLoading(false); } }
    };
    load(); window.addEventListener("focus", load); window.addEventListener("storage", load); window.addEventListener("rk:studio-draft", load);
    return () => { cancelled = true; request.current?.abort(); window.removeEventListener("focus", load); window.removeEventListener("storage", load); window.removeEventListener("rk:studio-draft", load); };
  }, []);
  function pick(icon) {
    const svg = new DOMParser().parseFromString(icon.svg, "image/svg+xml").documentElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "96"); svg.setAttribute("height", "96"); svg.setAttribute("stroke", "#27343a"); svg.setAttribute("color", "#27343a");
    return onPick(new File([new XMLSerializer().serializeToString(svg)], `${icon.name}.svg`, { type: "image/svg+xml" }));
  }
  async function generate() {
    if (!description.trim() || working) return;
    request.current = new AbortController(); setWorking(true); setGenerationError("");
    try {
      const icon = generated.current?.icon || await generateSlideIcon(description, icons.slice(0, 8).map(icon => ({ name: icon.name, svg: icon.svg })), request.current.signal);
      generated.current ||= { icon };
      request.current.signal.throwIfAborted();
      const name = generated.current.name || await saveGeneratedStudioIcon(icon, request.current.signal), registry = await studioIconRegistry();
      request.current.signal.throwIfAborted();
      generated.current.name = name;
      const entry = { ...icon, name, svg: registry.iconSvg(name) };
      setIcons(previous => [...previous.filter(item => item.name !== name), entry]);
      const inserted = await pick(entry);
      if (!inserted) throw new Error("Icon saved to the list, but insertion did not finish. Retry to add it without generating again.");
      generated.current = null; setGenerating(false); setDescription(""); setQuery("");
    } catch (failure) { if (failure.name !== "AbortError") setGenerationError(failure.message); }
    finally { setWorking(false); }
  }
  const matches = icons.filter(icon => `${icon.name} ${icon.keywords.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const Wrapper = embedded ? "div" : "dialog";
  return <Wrapper className={embedded ? "merge-icon-picker" : "merge-library merge-confirm"} ref={dialog} onCancel={onClose} aria-label="Icons">
    {!embedded && <h2>Icons</h2>}<input autoFocus type="search" aria-label="Search icons" placeholder="Search icons" value={query} onChange={event => setQuery(event.target.value)} />
    {loading ? <p role="status">Loading icons...</p> : error ? <p role="alert">{error}</p> : <div className="merge-library-grid">{matches.map(icon => <button key={icon.name} type="button" title={icon.name} aria-label={`Insert ${icon.name} icon`} onClick={() => pick(icon)}><span dangerouslySetInnerHTML={{ __html: icon.svg }} /><span>{icon.name}</span></button>)}{!matches.length && <p>No icons found</p>}</div>}
    <footer className="merge-icon-generate"><button type="button" disabled={loading} onClick={() => { setDescription(query); setGenerationError(""); setGenerating(true); }}><Sparkles size={16} strokeWidth={1.75} />Generate an icon</button>{!embedded && <button type="button" onClick={onClose}>Close</button>}</footer>
    {generating && <DeckDialog title="Generate an icon" wide={false} onClose={() => { request.current?.abort(); setGenerating(false); }}><form onSubmit={event => { event.preventDefault(); generate(); }}><label className="merge-dialog-field">Icon description<input value={description} maxLength={1000} disabled={working} onChange={event => { generated.current = null; setDescription(event.target.value); }} /></label>{generationError && <p role="alert">{generationError}</p>}<footer><button type="button" onClick={() => { request.current?.abort(); setGenerating(false); }}>Close</button><button type="submit" className="merge-dialog-primary" disabled={working || !description.trim()}>{working ? "Generating..." : generated.current ? "Retry adding icon" : "Generate and add"}</button></footer></form></DeckDialog>}
  </Wrapper>;
}