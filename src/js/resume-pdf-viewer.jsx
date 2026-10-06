import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Columns2, Maximize, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import "pdfjs-dist/web/pdf_viewer.css";

async function printPdf(document, signal) {
  const frame = window.document.createElement("iframe"), urls = [];
  frame.className = "rws-pdf-print-frame";
  frame.title = "Print PDF";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0";
  try {
    await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.throwIfAborted();
      signal.addEventListener("abort", abort, { once: true });
      frame.onload = () => { signal.removeEventListener("abort", abort); resolve(); };
      frame.srcdoc = '<!doctype html><html><head><title>Print PDF</title><style>html,body{margin:0;padding:0}section{break-after:page;overflow:hidden}section:last-child{break-after:auto}img{display:block;width:100%;height:100%}</style></head><body></body></html>';
      window.document.body.append(frame);
    });
    const target = frame.contentDocument, style = target.createElement("style");
    target.head.append(style);
    for (let number = 1; number <= document.numPages; number++) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      signal.throwIfAborted();
      const size = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: 150 / 72 });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const render = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, intent: "print" });
      const cancel = () => render.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      try { await render.promise; } finally { signal.removeEventListener("abort", cancel); }
      signal.throwIfAborted();
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      canvas.width = canvas.height = 0;
      signal.throwIfAborted();
      if (!blob) throw new Error("A PDF page could not be prepared for printing.");
      const url = URL.createObjectURL(blob); urls.push(url);
      const section = target.createElement("section"), image = target.createElement("img");
      style.sheet.insertRule(`@page pdf${number} { size: ${size.width}pt ${size.height}pt; margin: 0; }`);
      section.style.cssText = `page:pdf${number};width:${size.width}pt;height:${size.height}pt`;
      image.alt = `PDF page ${number}`; image.src = url; section.append(image); target.body.append(section);
      await image.decode();
    }
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      const cleanup = () => { frame.contentWindow?.removeEventListener("afterprint", done); signal.removeEventListener("abort", abort); };
      const done = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      frame.contentWindow.addEventListener("afterprint", done, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (failure) { cleanup(); reject(failure); }
    });
  } finally {
    frame.remove();
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}

export const ResumePdfViewer = forwardRef(function ResumePdfViewer({ url, label, controls = true, controlsTarget = null, onReadyChange, initialFit = "page-width" }, ref) {
  const container = useRef(null), pages = useRef(null), active = useRef(null);
  const pdfDocument = useRef(null), printController = useRef(null);
  const spreadModes = useRef(null);
  const [position, setPosition] = useState({ page: 1, total: 0 });
  const [fitMode, setFitMode] = useState("page-width");
  const [twoPage, setTwoPage] = useState(false);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useImperativeHandle(ref, () => ({
    async print() {
      if (!pdfDocument.current) throw new Error("The PDF is not ready to print. Wait for it to load or retry the PDF.");
      if (printController.current) throw new Error("A PDF print is already in progress.");
      const controller = new AbortController(); printController.current = controller;
      try { await printPdf(pdfDocument.current, controller.signal); }
      catch (failure) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw new Error("The PDF could not be prepared for printing. Try again or download this PDF to print it.", { cause: failure });
      } finally { if (printController.current === controller) printController.current = null; }
    },
  }), []);
  useEffect(() => {
    let disposed = false, loading, viewer, observer;
    const controller = new AbortController();
    onReadyChange?.(false);
    setPosition({ page: 1, total: 0 }); setFitMode(initialFit); setTwoPage(false); setError("");
    if (!url) return;
    const open = async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/studio/resume-preview/assets/pdf.worker.mjs";
      const { EventBus, PDFViewer, PDFLinkService, SpreadMode } = await import("pdfjs-dist/web/pdf_viewer.mjs");
      if (disposed) return;
      spreadModes.current = SpreadMode;
      const eventBus = new EventBus();
      const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: "noopener noreferrer" });
      viewer = new PDFViewer({ container: container.current, viewer: pages.current, eventBus, linkService, annotationMode: pdfjs.AnnotationMode.ENABLE, textLayerMode: 1, maxCanvasPixels: 8388608 });
      active.current = viewer; linkService.setViewer(viewer);
      eventBus.on("pagesinit", () => {
        if (disposed) return;
        viewer.currentScaleValue = initialFit;
        setPosition({ page: 1, total: viewer.pagesCount });
      });
      eventBus.on("pagechanging", event => { if (!disposed) setPosition({ page: event.pageNumber, total: viewer.pagesCount }); });
      eventBus.on("scalechanging", () => { if (!disposed) setFitMode(viewer.currentScaleValue); });
      eventBus.on("spreadmodechanged", event => { if (!disposed) setTwoPage(event.mode === SpreadMode.ODD); });
      eventBus.on("pagerendered", event => { if (!disposed && event.error) setError("This PDF page could not be rendered. Retry or download the original file."); });
      observer = new ResizeObserver(() => { if (viewer.pagesCount && ["page-width", "page-fit"].includes(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue; });
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
      // Own the initial request so rapid teardown cannot reject a reset viewer capability.
      await Promise.all([document.getMetadata(), document.getPage(1)]);
      if (disposed) return;
      pdfDocument.current = document; onReadyChange?.(true);
      linkService.setDocument(document); viewer.setDocument(document);
    };
    open().catch(() => { if (!disposed) setError(current => current || "The PDF could not be loaded. Retry or download the original file."); });
    return () => {
      disposed = true; controller.abort(); observer?.disconnect(); active.current = null;
      printController.current?.abort(); pdfDocument.current = null; onReadyChange?.(false);
      viewer?.setDocument(null);
      if (loading) loading.promise.catch(() => {}).then(() => loading.destroy()).catch(() => {});
    };
  }, [url, attempt, onReadyChange, initialFit]);
  const fitLabel = controlsTarget && fitMode !== "page-fit" ? "Fit PDF page" : "Fit PDF width";
  const canSpread = !!controlsTarget && position.total > 1;
  const toolbar = <div className={"rws-pdf-controls" + (controlsTarget ? " resume-view-tools" : "")} role="toolbar" aria-label="PDF controls" data-fit-mode={fitMode} data-two-page={twoPage}>
      <button className="rws-icon" title="Previous PDF page" aria-label="Previous PDF page" disabled={position.page <= (twoPage ? 2 : 1)} onClick={() => { active.current.previousPage(); }}><ChevronLeft size={17} /></button>
      <input type="number" aria-label="PDF page" min="1" max={position.total || 1} value={position.page} disabled={!position.total} onChange={event => { const page = Number(event.target.value); if (Number.isInteger(page) && page > 0 && page <= position.total) active.current.currentPageNumber = page; }} />
      <span>/ {position.total || "..."}</span>
      <button className="rws-icon" title="Next PDF page" aria-label="Next PDF page" disabled={!position.total || position.page >= position.total - (twoPage && position.total % 2 === 0 ? 1 : 0)} onClick={() => { active.current.nextPage(); }}><ChevronRight size={17} /></button>
      <button className="rws-icon" data-pdf-separator title="Zoom PDF out" aria-label="Zoom PDF out" disabled={!position.total} onClick={() => { active.current.currentScale = Math.max(0.25, active.current.currentScale / 1.2); }}><ZoomOut size={17} /></button>
      <button className="rws-icon" title="Zoom PDF in" aria-label="Zoom PDF in" disabled={!position.total} onClick={() => { active.current.currentScale = Math.min(4, active.current.currentScale * 1.2); }}><ZoomIn size={17} /></button>
      {canSpread && <button className="rws-icon" data-spread-toggle data-pdf-separator title={twoPage ? "Switch to single-page view" : "Show two pages side by side"} aria-label="Two-page view" aria-pressed={twoPage} onClick={() => {
        const viewer = active.current;
        const page = viewer.currentPageNumber;
        const scale = ["page-width", "page-fit"].includes(viewer.currentScaleValue) ? viewer.currentScaleValue : "page-fit";
        viewer.spreadMode = twoPage ? spreadModes.current.NONE : spreadModes.current.ODD;
        viewer.currentScaleValue = scale;
        viewer.currentPageNumber = page;
      }}><Columns2 size={17} /></button>}
      <button className="rws-icon" data-pdf-separator={!canSpread || undefined} title={fitLabel} aria-label={fitLabel} disabled={!position.total} onClick={() => { active.current.currentScaleValue = controlsTarget && fitMode !== "page-fit" ? "page-fit" : "page-width"; }}><Maximize size={17} /></button>
    </div>;
  return <section className="rws-pdf-reader" aria-label={label} data-controls={controls && !controlsTarget}>
    {controlsTarget ? createPortal(toolbar, controlsTarget) : controls && toolbar}
    {error && <div className="rws-pdf-error" role="alert"><p>{error}</p><button className="rws-secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} />Retry PDF</button></div>}
    {!error && !position.total && <p className="rws-pdf-loading" role="status">Loading PDF</p>}
    <div ref={container} className="rws-pdf-scroll" tabIndex={0} aria-label="PDF pages"><div ref={pages} className="pdfViewer" /></div>
  </section>;
});