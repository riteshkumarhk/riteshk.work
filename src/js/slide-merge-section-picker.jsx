import React, { useEffect, useState } from "react";
import { DeckDialog } from "./slide-merge-navigator.jsx";
import { availableStudies } from "./slide-merge-sections.mjs";

export function SectionPicker({ onClose, onPick }) {
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
  return <DeckDialog title="Generate from a section" onClose={onClose}>
    <div className="merge-source-controls"><label className="merge-dialog-field">Source<select value={source} onChange={event => setSource(event.target.value)}><option value="published">Published site</option><option value="draft">This browser's draft</option></select></label>
    {!!studies.length && <label className="merge-dialog-field">Case study<select value={studyId} onChange={event => setStudyId(event.target.value)}>{studies.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}</div>
    {loading ? <p className="merge-source-status" role="status">Loading sections...</p> : error ? <div className="merge-source-status" role="alert">{error}<button onClick={() => setRetry(retry + 1)}>Retry</button></div> : !study ? <p className="merge-source-status">No available sections.</p> : <div className="merge-section-choices">{study.blocks.map((block, index) => <button key={index} onClick={() => onPick(block)}><span>{String(index + 1).padStart(2,"0")}</span><strong>{block.heading || block.nav || block.editorName || block.kicker || `Section ${index + 1}`}</strong><small>{block.type || "text"}</small></button>)}</div>}
  </DeckDialog>;
}