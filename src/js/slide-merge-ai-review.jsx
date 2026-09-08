import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Trash2, Maximize, RotateCcw, Square } from "lucide-react";
import { sectionPlainText } from "./slide-merge-sections.mjs";
import { compileComposition } from "./slide-merge-composition.mjs";
import { selectedCompositionCatalog } from "./slide-merge-ai.mjs";
import { DEFAULT_SLIDE_FONT } from "./slide-platform-fonts.mjs";
import { requestComposition } from "./slide-merge-ai-client.mjs";
import "../../css/slide-merge-ai.css";

const options = { plain: sectionPlainText, fontFamily: DEFAULT_SLIDE_FONT };

export function CompositionReview({ data, studyId, blocks, onCancel, onApply, renderPreview, existingCount }) {
  const [error, setError] = useState(""), [working, setWorking] = useState(true), [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState(null), [compiled, setCompiled] = useState(null), [index, setIndex] = useState(0), [replace, setReplace] = useState(false);
  const controller = useRef(null), mounted = useRef(true), preview = useRef(null);
  async function generate() {
    controller.current?.abort();
    const pending = new AbortController(); controller.current = pending;
    setWorking(true); setError("");
    try {
      const catalog = await selectedCompositionCatalog(data, studyId, blocks, options);
      pending.signal.throwIfAborted();
      const brief = "Arrange the selected case-study sections into a concise presentation: context, evidence, decisions and outcomes where available. Keep each section intact and use only the supplied sources.";
      const result = await requestComposition(catalog, brief, pending.signal);
      const review = await compileComposition(result, data, options);
      pending.signal.throwIfAborted();
      setProposal(result); setCompiled(review); setIndex(0); setReplace(false);
    } catch (failure) { if (!pending.signal.aborted) setError(failure.message || "Drafting failed. Try again."); }
    finally { if (mounted.current && controller.current === pending) setWorking(false); }
  }
  useEffect(() => { mounted.current = true; generate(); return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  function cancel() { if (!applying) { controller.current?.abort(); onCancel(); } }
  function revise(nextSlides, nextIndex) {
    setProposal({ ...proposal, slides: nextSlides });
    setCompiled({ ...compiled, slides: nextSlides.map(slide => compiled.slides.find(item => item.id === slide.id)) });
    setIndex(Math.max(0, Math.min(nextIndex, nextSlides.length - 1))); setReplace(false);
  }
  function move(direction) {
    const slides = [...proposal.slides], target = index + direction;
    [slides[index], slides[target]] = [slides[target], slides[index]];
    revise(slides, target);
  }
  async function apply(mode) {
    setApplying(true); setError("");
    try { await onApply(proposal, studyId, mode); onCancel(); }
    catch (failure) { if (mounted.current) setError(failure.message || "Could not apply the proposal."); }
    finally { if (mounted.current) setApplying(false); }
  }
  const slide = compiled?.slides[index];
  return <section className="merge-ai" aria-label="AI proposal">
    <div className="merge-section-actions"><button type="button" disabled={applying} onClick={cancel}>{working ? <Square /> : <ArrowLeft />}{working ? "Stop" : "Back to sections"}</button></div>
    {working ? <p role="status">Drafting slides...</p> : proposal ? <>
      <h3>{proposal.title}</h3>
      <div className="merge-ai-preview" ref={preview} key={slide.id}>{renderPreview(slide.elements[0])}</div>
      <div className="merge-ai-slidebar">
        <button type="button" title="Previous proposal slide" aria-label="Previous proposal slide" disabled={applying || index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft /></button>
        <span aria-live="polite">{index + 1} / {proposal.slides.length}</span>
        <button type="button" title="Next proposal slide" aria-label="Next proposal slide" disabled={applying || index === proposal.slides.length - 1} onClick={() => setIndex(index + 1)}><ArrowRight /></button>
        <button type="button" title="Fullscreen proposal slide" aria-label="Fullscreen proposal slide" disabled={applying} onClick={() => preview.current?.requestFullscreen().catch(() => setError("Fullscreen is unavailable in this browser."))}><Maximize /></button>
      </div>
      <p className="merge-ai-caption">{slide.title}</p>
      <div className="merge-ai-slidebar">
        <button type="button" title="Move proposal slide earlier" aria-label="Move proposal slide earlier" disabled={applying || index === 0} onClick={() => move(-1)}><ArrowUp /></button>
        <button type="button" title="Move proposal slide later" aria-label="Move proposal slide later" disabled={applying || index === proposal.slides.length - 1} onClick={() => move(1)}><ArrowDown /></button>
        <button type="button" className="is-danger" title="Remove proposal slide" aria-label="Remove proposal slide" disabled={applying || proposal.slides.length === 1} onClick={() => revise(proposal.slides.filter((_, position) => position !== index), index)}><Trash2 /></button>
      </div>
      {replace ? <><p role="alert">Replace all {existingCount} current slides and their notes? Canvas Undo cannot restore them.</p><div className="merge-section-actions"><button disabled={applying} onClick={() => setReplace(false)}>Keep deck</button><button className="is-danger" disabled={applying} onClick={() => apply("replace")}>Replace deck</button></div></> : <div className="merge-section-actions"><button disabled={applying} onClick={() => apply("append")}>{applying ? "Applying..." : "Append slides"}</button><button disabled={applying} onClick={() => setReplace(true)}>Replace...</button></div>}
    </> : null}
    {error && <p role="alert" className="merge-layout-dialog-error">{error}</p>}
    {!working && !proposal && <div className="merge-section-actions"><button onClick={generate}><RotateCcw />Retry</button></div>}
  </section>;
}