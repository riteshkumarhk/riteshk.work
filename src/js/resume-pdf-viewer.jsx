import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import "pdfjs-dist/web/pdf_viewer.css";

export function ResumePdfViewer({ url, label }) {
  const container = useRef(null), pages = useRef(null), active = useRef(null);
  const [position, setPosition] = useState({ page: 1, total: 0 });
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false, loading, viewer, observer;
    const controller = new AbortController();
    setPosition({ page: 1, total: 0 }); setError("");
    if (!url) return;
    const open = async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/studio/resume-preview/assets/pdf.worker.mjs";
      const { EventBus, PDFViewer, PDFLinkService } = await import("pdfjs-dist/web/pdf_viewer.mjs");
      if (disposed) return;
      const eventBus = new EventBus();
      const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
      viewer = new PDFViewer({ container: container.current, viewer: pages.current, eventBus, linkService, annotationMode: pdfjs.AnnotationMode.ENABLE, textLayerMode: 1, maxCanvasPixels: 8388608 });
      active.current = viewer; linkService.setViewer(viewer);
      eventBus.on("pagesinit", () => {
        if (disposed) return;
        viewer.currentScaleValue = "page-width";
        setPosition({ page: 1, total: viewer.pagesCount });
      });
      eventBus.on("pagechanging", event => { if (!disposed) setPosition({ page: event.pageNumber, total: viewer.pagesCount }); });
      eventBus.on("pagerendered", event => { if (!disposed && event.error) setError("This PDF page could not be rendered. Retry or download the original file."); });
      observer = new ResizeObserver(() => { if (viewer.pagesCount && viewer.currentScaleValue === "page-width") viewer.currentScaleValue = "page-width"; });
      observer.observe(container.current);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('PDF download failed.');
      const data = new Uint8Array(await response.arrayBuffer());
      if (disposed) return;
      loading = pdfjs.getDocument({ data, isEvalSupported: false });
      loading.onPassword = update => {
        if (!disposed) setError("This PDF requires a password. Download the original file to open it securely.");
        update(new Error('Password-protected PDF requires an external reader.'));
      };
      const document = await loading.promise;
      await document.getMetadata();
      if (disposed) return;
      linkService.setDocument(document); viewer.setDocument(document);
    };
    open().catch(() => { if (!disposed) setError(current => current || "The PDF could not be loaded. Retry or download the original file."); });
    return () => {
      disposed = true; controller.abort(); observer?.disconnect(); active.current = null;
      viewer?.setDocument(null);
      if (loading) loading.promise.catch(() => {}).then(() => loading.destroy()).catch(() => {});
    };
  }, [url, attempt]);
  return <section className="rws-pdf-reader" aria-label={label}>
    <div className="rws-pdf-controls" role="toolbar" aria-label="PDF controls">
      <button className="rws-icon" title="Previous PDF page" aria-label="Previous PDF page" disabled={position.page <= 1} onClick={() => { active.current.currentPageNumber--; }}><ChevronLeft size={17} /></button>
      <input type="number" aria-label="PDF page" min="1" max={position.total || 1} value={position.page} disabled={!position.total} onChange={event => { const page = Number(event.target.value); if (Number.isInteger(page) && page > 0 && page <= position.total) active.current.currentPageNumber = page; }} />
      <span>/ {position.total || "..."}</span>
      <button className="rws-icon" title="Next PDF page" aria-label="Next PDF page" disabled={!position.total || position.page >= position.total} onClick={() => { active.current.currentPageNumber++; }}><ChevronRight size={17} /></button>
      <button className="rws-icon" title="Zoom PDF out" aria-label="Zoom PDF out" disabled={!position.total} onClick={() => { active.current.currentScale = Math.max(0.25, active.current.currentScale / 1.2); }}><ZoomOut size={17} /></button>
      <button className="rws-icon" title="Zoom PDF in" aria-label="Zoom PDF in" disabled={!position.total} onClick={() => { active.current.currentScale = Math.min(4, active.current.currentScale * 1.2); }}><ZoomIn size={17} /></button>
      <button className="rws-icon" title="Fit PDF width" aria-label="Fit PDF width" disabled={!position.total} onClick={() => { active.current.currentScaleValue = "page-width"; }}><Maximize size={17} /></button>
    </div>
    {error && <div className="rws-pdf-error" role="alert"><p>{error}</p><button className="rws-secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} />Retry PDF</button></div>}
    {!error && !position.total && <p className="rws-pdf-loading" role="status">Loading PDF</p>}
    <div ref={container} className="rws-pdf-scroll" tabIndex={0} aria-label="PDF pages"><div ref={pages} className="pdfViewer" /></div>
  </section>;
}