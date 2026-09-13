import React, { useEffect, useRef, useState } from "react";
import { DeckDialog } from "./slide-merge-navigator.jsx";
import { ToolIcon } from "./slide-merge-toolbar.jsx";
import { availableStudies, sectionPlan, sectionPlainText } from "./slide-merge-sections.mjs";
import { sectionComponentPlan } from "./slide-merge-section-component.mjs";
import { ListX, Link, Lock } from "lucide-react";
import { AiRibbonIcon as Sparkles } from "./ai-ribbon.jsx";
import { CompositionReview } from "./slide-merge-ai-review.jsx";
import { HoverPreview } from "./slide-merge-hover-preview.jsx";
import { studioSourceData, studioSectionSources, sectionAccessState } from "./slide-studio-source.mjs";

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

function SectionChoice({ block, index, onPick, multiple = false, selected = false, renderPreview, resources, unlocked = false }) {
  let plan, component, available = true;
  const protectedSource = !!(block.locked || block.encStub || block.vaultBlock);
  try { component = sectionComponentPlan(block, sectionPlainText, `preview-${index}`, resources); } catch { available = false; }
  try { plan = sectionPlan(block, sectionPlainText, 1, `preview-${index}`); } catch { plan = null; }
  const title = protectedSource && !unlocked ? "Protected section" : sectionPlainText(block.heading || block.nav || block.editorName || block.kicker || `Section ${index + 1}`);
  return <HoverPreview label={title} preview={() => available && renderPreview ? renderPreview(sectionComponentPlan(block, sectionPlainText, `hover-${index}`, resources)) : <SectionThumbnail plan={plan} />}><button role={multiple ? "checkbox" : undefined} aria-checked={multiple ? selected : undefined} onKeyDown={event => { if (multiple && event.key === " ") { event.preventDefault(); event.stopPropagation(); onPick(block); } }} onClick={() => onPick(block)} disabled={!available} title={available ? title : "This section contains unavailable content"}>
    {multiple && <span className="merge-section-check" aria-hidden="true" />}
    {available && renderPreview ? <span className="merge-section-preview" aria-hidden="true" inert="">{renderPreview(component)}</span> : <SectionThumbnail plan={plan} />}
    <span className="merge-section-choice-meta"><span>{String(index + 1).padStart(2,"0")}</span><strong>{protectedSource && !unlocked && <Lock size={14} strokeWidth={1.75} aria-hidden="true" />} {title}</strong><small>{block.type || "text"}</small></span>
  </button></HoverPreview>;
}

function MediaChoice({ media, onPick }) {
  const [failed, setFailed] = useState(false);
  return <HoverPreview label={media.title} preview={() => media.kind === "video" ? <video src={media.url} muted playsInline autoPlay loop /> : <img src={media.url} alt="" />}><button title={media.title} aria-label={`Insert ${media.kind}: ${media.title}`} onClick={() => onPick(media)}><span className="merge-media-preview">{failed ? <ToolIcon name="image" /> : media.kind === "video" ? <video src={media.url} muted playsInline preload="metadata" onError={() => setFailed(true)} /> : <img src={media.url} alt="" loading="lazy" onError={() => setFailed(true)} />}</span><span>{media.title}</span><small>{media.kind === "video" ? "Video" : /\.svg(?:$|[?#])/i.test(media.url) ? "SVG" : "Image"}</small></button></HoverPreview>;
}

export function SectionPicker({ title = "Generate from a section", sourceStudyId, onClose, onPick, embedded = false, multiple = false, mediaOnly = false, onUpload, onEmbed, composition }) {
  const [selected, setSelected] = useState([]);
  const [sourceData, setSourceData] = useState(null), [drafting, setDrafting] = useState(false);
  const [resources, setResources] = useState({});
  const contextId = sourceStudyId || new URLSearchParams(location.search).get("study");
  const [studies, setStudies] = useState([]), [studyId, setStudyId] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [accessRevision, setAccessRevision] = useState(0);
  useEffect(() => {
    const update = () => setAccessRevision(value => value + 1);
    window.addEventListener("rk:section-access", update);
    return () => window.removeEventListener("rk:section-access", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setStudies([]); setSelected([]);
    (async () => {
      const remembered = contextId || studyId || sessionStorage.getItem("rk:slide-lab:source-study");
      const data = mediaOnly ? await studioSourceData(controller.signal) : await studioSectionSources(controller.signal, remembered);
      if (controller.signal.aborted) return;
      setSourceData(data);
      setResources({ customIcons: data.customIcons || {}, caseStudyId: remembered });
      const next = availableStudies(data, mediaOnly, !mediaOnly);
      if (contextId && !next.some(item => item.id === contextId)) throw new Error("This case study has no available content.");
      setStudies(next); setStudyId(next.some(item => item.id === remembered) ? remembered : "");
    })().catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contextId, retry, mediaOnly, accessRevision]);
  const study = studies.find(item => item.id === studyId);
  const unlocked = sectionAccessState(studyId).unlocked;
  const authorable = (study?.blocks || []).filter((block, index) => (!selected.length || selected.includes(index)) && !block.locked && !block.encStub && !block.vaultBlock);
  useEffect(() => { if (composition?.autoStart && study && !loading && authorable.length) setDrafting(true); }, [composition?.autoStart, studyId, loading, authorable.length]);
  if (drafting && study && composition) return <CompositionReview data={sourceData} studyId={studyId} blocks={authorable} {...composition} onCancel={() => setDrafting(false)} />;
  const content = <>
    {!contextId && !loading && !error && (study ? <div className="merge-study-context"><span>{study.title}</span><button title="Change case study" aria-label="Change case study" onClick={() => { setStudyId(""); sessionStorage.removeItem("rk:slide-lab:source-study"); setSelected([]); }}><ToolIcon name="section" /></button></div> : <div className="merge-study-choices" aria-label="Choose a case study">{studies.map(item => <button key={item.id} onClick={() => { setStudyId(item.id); sessionStorage.setItem("rk:slide-lab:source-study", item.id); setSelected([]); setRetry(value => value + 1); }}>{item.title}</button>)}</div>)}
    {multiple && study && <div className={`merge-section-actions${composition ? " merge-section-actions--ai" : ""}`}><button disabled={loading || !selected.length} onClick={() => onPick(study.blocks.filter((block, index) => selected.includes(index)), resources)}>Add {selected.length || ""} {selected.length === 1 ? "slide" : "slides"}</button><button className="merge-section-clear" disabled={!selected.length} title="Clear selection" aria-label="Clear selection" onClick={() => setSelected([])}><ListX size={15} strokeWidth={1.75} /></button>{composition && <button disabled={loading || !authorable.length} title={selected.length ? "Author a deck from selected public sections" : "Author a deck from public case-study sections"} onClick={() => setDrafting(true)}><Sparkles size={15} strokeWidth={1.75} />{selected.length ? "Draft with AI" : "Draft entire deck"}</button>}</div>}
    {loading ? <p className="merge-source-status" role="status">Loading {mediaOnly ? "media" : "sections"}...</p> : error ? <div className="merge-source-status" role="alert">{error}<button onClick={() => setRetry(retry + 1)}>Retry</button></div> : !study ? (!studies.length && <p className="merge-source-status">No available {mediaOnly ? "media" : "sections"}.</p>) : mediaOnly ? <div className="merge-media-choices">{study.media.length ? study.media.map(media => <MediaChoice key={media.url} media={media} onPick={onPick} />) : <p className="merge-source-status">No media in this case study.</p>}</div> : <div className="merge-section-choices">{study.blocks.map((block, index) => <SectionChoice key={`${studyId}-${block.sectionId || index}`} block={block} index={index} renderPreview={composition?.renderPreview} resources={resources} unlocked={unlocked} multiple={multiple} selected={selected.includes(index)} onPick={multiple ? () => setSelected(previous => previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index]) : chosen => onPick(chosen, resources)} />)}</div>}
    {mediaOnly && <footer className="merge-media-upload"><button onClick={onUpload}><ToolIcon name="add" />Upload media</button>{onEmbed && <button onClick={onEmbed}><Link size={18} strokeWidth={1.75} />Embed link</button>}</footer>}
  </>;
  return embedded ? <div className={`merge-section-picker${mediaOnly ? " merge-media-picker" : ""}`}>{content}</div> : <DeckDialog title={title} onClose={onClose}>{content}</DeckDialog>;
}