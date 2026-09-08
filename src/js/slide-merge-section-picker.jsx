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

function SectionChoice({ block, index, onPick }) {
  let plan;
  try { plan = sectionPlan(block, sectionPlainText, 1, `preview-${index}`); } catch { plan = null; }
  const title = sectionPlainText(block.heading || block.nav || block.editorName || block.kicker || `Section ${index + 1}`);
  return <button onClick={() => onPick(block)} disabled={!plan} title={plan ? title : "This section has no supported text or media"}>
    <SectionThumbnail plan={plan} />
    <span className="merge-section-choice-meta"><span>{String(index + 1).padStart(2,"0")}</span><strong>{title}</strong><small>{block.type || "text"}</small></span>
  </button>;
}

export function SectionPicker({ title = "Generate from a section", onClose, onPick, embedded = false }) {
  const [source, setSource] = useState("published"), [studies, setStudies] = useState([]), [studyId, setStudyId] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setStudies([]);
    (async () => {
      let data;
      if (source === "draft") {
        const raw = localStorage.getItem("rk:content:draft");
        if (!raw) throw new Error("No saved Studio draft in this browser.");
        data = JSON.parse(raw);
      } else {
        const response = await fetch("https://media.riteshk.work/content.json", { signal: controller.signal, credentials: "omit", cache: "no-store" });
        if (!response.ok) throw new Error("Could not load published case studies.");
        data = await response.json();
      }
      if (controller.signal.aborted) return;
      const next = availableStudies(data);
      setStudies(next); setStudyId(next[0]?.id || "");
    })().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [source, retry]);
  const study = studies.find(item => item.id === studyId);
  const content = <>
    <div className="merge-source-controls"><label className="merge-dialog-field">Source<select value={source} onChange={event => setSource(event.target.value)}><option value="published">Published site</option><option value="draft">This browser's draft</option></select></label>
    {!!studies.length && <label className="merge-dialog-field">Case study<select value={studyId} onChange={event => setStudyId(event.target.value)}>{studies.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}</div>
    {loading ? <p className="merge-source-status" role="status">Loading sections...</p> : error ? <div className="merge-source-status" role="alert">{error}<button onClick={() => setRetry(retry + 1)}>Retry</button></div> : !study ? <p className="merge-source-status">No available sections.</p> : <div className="merge-section-choices">{study.blocks.map((block, index) => <SectionChoice key={`${studyId}-${index}`} block={block} index={index} onPick={onPick} />)}</div>}
  </>;
  return embedded ? <div className="merge-section-picker">{content}</div> : <DeckDialog title={title} onClose={onClose}>{content}</DeckDialog>;
}