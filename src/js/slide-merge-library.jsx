import React, { useEffect, useRef, useState } from "react";
import { AiRibbonIcon as Sparkles } from "./ai-ribbon.jsx";
import { generateSlideIcon } from "./slide-merge-ai-client.mjs";
import { studioIconRegistry, studioSourceData, saveGeneratedStudioIcon } from "./slide-studio-source.mjs";

export function IconLibrary({ onPick, onClose, embedded = false }) {
  const dialog = useRef(null), request = useRef(null), generated = useRef(null), generateTrigger = useRef(null);
  const [icons, setIcons] = useState([]), [query, setQuery] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false), [description, setDescription] = useState(""), [working, setWorking] = useState(false), [generationError, setGenerationError] = useState("");
  const [preview, setPreview] = useState(null), [adding, setAdding] = useState(false);
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
    const controller = new AbortController();
    request.current = controller; setWorking(true); setGenerationError("");
    try {
      const icon = await generateSlideIcon(description, icons.slice(0, 8).map(icon => ({ name: icon.name, svg: icon.svg })), controller.signal);
      controller.signal.throwIfAborted();
      const svg = new DOMParser().parseFromString(/^\s*<svg\b/i.test(icon.svg) ? icon.svg : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${icon.svg}</svg>`, "image/svg+xml").documentElement;
      if (svg.localName !== "svg" || svg.querySelector("parsererror")) throw new Error("The icon preview could not be read. Try regenerating it.");
      svg.setAttribute("color", getComputedStyle(dialog.current).color);
      generated.current = { icon };
      setPreview({ name: icon.name, url: "data:image/svg+xml," + encodeURIComponent(new XMLSerializer().serializeToString(svg)) });
    } catch (failure) { if (!controller.signal.aborted && failure.name !== "AbortError") setGenerationError(failure.message); }
    finally { if (request.current === controller) { request.current = null; setWorking(false); } }
  }
  async function confirm() {
    if (!generated.current || working) return;
    const controller = new AbortController(), { icon } = generated.current;
    request.current = controller; setWorking(true); setAdding(true); setGenerationError("");
    try {
      const name = generated.current.name || await saveGeneratedStudioIcon(icon, controller.signal), registry = await studioIconRegistry();
      controller.signal.throwIfAborted();
      generated.current.name = name;
      const entry = { ...icon, name, svg: registry.iconSvg(name) };
      setIcons(previous => [...previous.filter(item => item.name !== name), entry]);
      const inserted = await pick(entry);
      controller.signal.throwIfAborted();
      if (!inserted) throw new Error("Icon saved to the list, but insertion did not finish. Retry to add it without generating again.");
      generated.current = null; setPreview(null); setGenerating(false); setDescription(""); setQuery("");
    } catch (failure) { if (!controller.signal.aborted && failure.name !== "AbortError") setGenerationError(failure.message); }
    finally { if (request.current === controller) { request.current = null; setWorking(false); setAdding(false); } }
  }
  function cancelGeneration() {
    request.current?.abort(); request.current = null; generated.current = null; setPreview(null); setWorking(false); setAdding(false); setGenerating(false);
    requestAnimationFrame(() => generateTrigger.current?.focus());
  }
  const matches = icons.filter(icon => `${icon.name} ${icon.keywords.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const Wrapper = embedded ? "div" : "dialog";
  return <Wrapper className={embedded ? "merge-icon-picker" : "merge-library merge-confirm"} ref={dialog} onCancel={onClose} aria-label="Icons">
    {!embedded && <h2>Icons</h2>}<input autoFocus type="search" aria-label="Search icons" placeholder="Search icons" value={query} onChange={event => setQuery(event.target.value)} />
    {loading ? <p role="status">Loading icons...</p> : error ? <p role="alert">{error}</p> : <div className="merge-library-grid">{matches.map(icon => <button key={icon.name} type="button" title={icon.name} aria-label={`Insert ${icon.name} icon`} onClick={() => pick(icon)}><span dangerouslySetInnerHTML={{ __html: icon.svg }} /><span>{icon.name}</span></button>)}{!matches.length && <p>No icons found</p>}</div>}
    <footer className="merge-icon-generate">
      {generating ? <form className="merge-icon-composer" aria-label="Generate an icon" onSubmit={event => { event.preventDefault(); generate(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelGeneration(); } }}>
        <label>Icon description<textarea autoFocus rows={3} value={description} maxLength={1000} disabled={working} onChange={event => { generated.current = null; setPreview(null); setGenerationError(""); setDescription(event.target.value); }} /></label>
        {preview && <div className="merge-icon-preview"><img src={preview.url} alt={`Generated icon preview: ${preview.name}`} /><span>{preview.name}</span></div>}
        {generationError && <p role="alert">{generationError}</p>}
        <div className="merge-icon-composer-actions"><button type="button" onClick={cancelGeneration}>Cancel</button><button type="submit" disabled={working || !description.trim()}><Sparkles size={16} strokeWidth={1.75} />{working && !adding ? "Generating..." : preview ? "Regenerate" : "Generate"}</button></div>
        {preview && <div className="merge-icon-composer-actions"><button type="button" className="merge-icon-confirm" disabled={working} onClick={confirm}>{adding ? "Adding..." : generated.current?.name ? "Retry adding icon" : "Add icon"}</button></div>}
      </form> : <button ref={generateTrigger} type="button" disabled={loading} onClick={() => { setDescription(query); setGenerationError(""); setGenerating(true); }}><Sparkles size={16} strokeWidth={1.75} />Generate an icon</button>}
      {!embedded && <button type="button" onClick={onClose}>Close</button>}
    </footer>
  </Wrapper>;
}