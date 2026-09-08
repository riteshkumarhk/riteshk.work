import React, { useEffect, useRef, useState } from "react";
import { DeckDialog } from "./slide-merge-navigator.jsx";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { availableStudies, sectionPlan, sectionPlainText } from "./slide-merge-sections.mjs";

function SectionThumbnail({ plan }) {
  const host = useRef(null), [scale, setScale] = useState(0), [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / 1280));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setFailed(false), [plan?.media?.url]);
  const media = plan?.media, video = media && (/video/i.test(media.kind || "") || /\.(mp4|webm|mov)(?:$|[?#])/i.test(media.url));
  return <span ref={host} className="merge-section-preview" aria-hidden="true">
    {plan ? <span className="merge-section-preview-scene" style={{transform:`scale(${scale})`}}>
      {plan.elements.map(element => <span key={element.id} className="merge-section-preview-text" style={{left:element.x,top:element.y,width:element.width,fontSize:element.fontSize}}>{element.text}</span>)}
      {media && <span className="merge-section-preview-media" style={{left:media.x,top:media.y,width:media.width,height:media.height}}>{failed ? <ToolIcon name="image" /> : video ? <video src={media.url} muted playsInline preload="metadata" onError={() => setFailed(true)} /> : <img src={media.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</span>}
    </span> : <ToolIcon name="section" />}
  </span>;
}

function SectionChoice({ block, index, onPick, multiple = false, selected = false }) {
  let plan;
  try { plan = sectionPlan(block, sectionPlainText, 1, `preview-${index}`); } catch { plan = null; }
  const title = sectionPlainText(block.heading || block.nav || block.editorName || block.kicker || `Section ${index + 1}`);
  return <button role={multiple ? "checkbox" : undefined} aria-checked={multiple ? selected : undefined} onKeyDown={event => { if (multiple && event.key === " ") { event.preventDefault(); event.stopPropagation(); onPick(block); } }} onClick={() => onPick(block)} disabled={!plan} title={plan ? title : "This section has no supported text or media"}>
    {multiple && <span className="merge-section-check" aria-hidden="true" />}
    <SectionThumbnail plan={plan} />
    <span className="merge-section-choice-meta"><span>{String(index + 1).padStart(2,"0")}</span><strong>{title}</strong><small>{block.type || "text"}</small></span>
  </button>;
}

function MediaChoice({ media, onPick }) {
  const [failed, setFailed] = useState(false);
  return <button title={media.title} aria-label={`Insert ${media.kind}: ${media.title}`} onClick={() => onPick(media)}><span className="merge-media-preview">{failed ? <ToolIcon name="image" /> : media.kind === "video" ? <video src={media.url} muted playsInline preload="metadata" onError={() => setFailed(true)} /> : <img src={media.url} alt="" loading="lazy" onError={() => setFailed(true)} />}</span><span>{media.title}</span><small>{media.kind === "video" ? "Video" : /\.svg(?:$|[?#])/i.test(media.url) ? "SVG" : "Image"}</small></button>;
}

export function SectionPicker({ title = "Generate from a section", onClose, onPick, embedded = false, multiple = false, mediaOnly = false, onUpload }) {
  const [selected, setSelected] = useState([]);
  const contextId = new URLSearchParams(location.search).get("study");
  const [studies, setStudies] = useState([]), [studyId, setStudyId] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setStudies([]); setSelected([]);
    (async () => {
      let data;
      const raw = localStorage.getItem("rk:content:draft");
      if (raw) {
        data = JSON.parse(raw);
      } else {
        const response = await fetch("https://media.riteshk.work/content.json", { signal: controller.signal, credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("Could not load published case studies.");
        data = await response.json();
      }
      if (controller.signal.aborted) return;
      const next = availableStudies(data, mediaOnly);
      const remembered = contextId || sessionStorage.getItem("rk:slide-lab:source-study");
      if (contextId && !next.some(item => item.id === contextId)) throw new Error("This case study has no available content.");
      setStudies(next); setStudyId(next.some(item => item.id === remembered) ? remembered : "");
    })().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contextId, retry, mediaOnly]);
  const study = studies.find(item => item.id === studyId);
  const content = <>
    {!contextId && !loading && !error && (study ? <div className="merge-study-context"><span>{study.title}</span><button title="Change case study" aria-label="Change case study" onClick={() => { setStudyId(""); setSelected([]); }}><ToolIcon name="section" /></button></div> : <div className="merge-study-choices" aria-label="Choose a case study">{studies.map(item => <button key={item.id} onClick={() => { setStudyId(item.id); sessionStorage.setItem("rk:slide-lab:source-study", item.id); setSelected([]); }}>{item.title}</button>)}</div>)}
    {multiple && study && <div className="merge-section-actions"><button disabled={loading || !selected.length} onClick={() => onPick(study.blocks.filter((block, index) => selected.includes(index)))}>Generate {selected.length || ""} {selected.length === 1 ? "slide" : "slides"}</button><button disabled={!selected.length} onClick={() => setSelected([])}>Clear</button></div>}
    {loading ? <p className="merge-source-status" role="status">Loading {mediaOnly ? "media" : "sections"}...</p> : error ? <div className="merge-source-status" role="alert">{error}<button onClick={() => setRetry(retry + 1)}>Retry</button></div> : !study ? (!studies.length && <p className="merge-source-status">No available {mediaOnly ? "media" : "sections"}.</p>) : mediaOnly ? <div className="merge-media-choices">{study.media.length ? study.media.map(media => <MediaChoice key={media.url} media={media} onPick={onPick} />) : <p className="merge-source-status">No media in this case study.</p>}</div> : <div className="merge-section-choices">{study.blocks.map((block, index) => <SectionChoice key={`${studyId}-${index}`} block={block} index={index} multiple={multiple} selected={selected.includes(index)} onPick={multiple ? () => setSelected(previous => previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index]) : onPick} />)}</div>}
    {mediaOnly && <footer className="merge-media-upload"><button onClick={onUpload}><ToolIcon name="add" />Upload media</button></footer>}
  </>;
  return embedded ? <div className={`merge-section-picker${mediaOnly ? " merge-media-picker" : ""}`}>{content}</div> : <DeckDialog title={title} onClose={onClose}>{content}</DeckDialog>;
}