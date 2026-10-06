import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileDown,
  FileText,
  History,
  Info,
  Link,
  List,
  LoaderCircle,
  LockKeyhole,
  Maximize,
  Moon,
  MoreHorizontal,
  PanelsTopLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  ScanText,
  Search,
  Settings2,
  Sun,
  TextCursorInput,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  createResume,
  resumeFields,
  resumeSignature,
  editResumeField,
  resumeText,
  createResumeTask,
  createResumeHistory,
  resumeHistoryCheckpoints,
  applyResumeProposal,
  projectResumeProposal,
  assessResume,
  structureResumeText,
  resumeNeedsSourceRebuild,
} from "./resume-workspace.mjs";
import {
  renderResumeHtml,
  RESUME_FONTS,
  RESUME_RENDER_VERSION,
  resumeHref,
} from "./resume-render.mjs";
import { ResumeDocumentPanel } from "./resume-document-panel.jsx";
import { sampleProposals } from "./resume-sample.mjs";
import { ResumeAccentPicker } from "./resume-accent-picker.jsx";
import { ResumePdfViewer } from "./resume-pdf-viewer.jsx";
import { NumberField } from "./slide-shared-controls.jsx";
import { REVIEW_DECISION_REASONS, reviewPacket, inventoryResumeWithAI, reviewResumeWithAI, canReviseReview, decideResumeFinding, resumeReviewFindings } from "./resume-review.mjs";
import {
  applyStudioTypography,
  typographySystem,
} from "./slide-merge-typography.mjs";
import "../../css/resume-preview.css";
import { createHostedResumeClient, resumeSaveFailureFeedback, observeResumeViewControls, RESUME_CANVAS_STORAGE_KEY, readResumeCanvasMode, saveResumeCanvasMode } from "./resume-hosted.mjs";
import { atsEditorReview } from "./resume-ats.mjs";
import { rebuildResumeWithAI, resumeRebuildPacket, resumeAtsChecks } from "./resume-rebuild.mjs";
import { resumeReviewSections, resumeFindingTargets, observeResumeContext, observeResumeInfo } from "./resume-review-presentation.mjs";
import { ResumeCandidateReview } from "./resume-assessment-ui.jsx";
import { commitAssessmentRevision } from "./resume-assessment-revisions.mjs";

function ReviewInfo({ children }) {
  const button = useRef(null), panel = useRef(null);
  useEffect(() => observeResumeInfo(button.current, panel.current), []);
  return <>
    <button ref={button} className="resume-review-info-button" aria-label="Review information" title="Review information" popoverTarget="resume-review-info"><Info size={18} /></button>
    <section ref={panel} id="resume-review-info" className="resume-review-info" popover="auto" aria-label="Review information">{children}</section>
  </>;
}

const hosted = new URLSearchParams(location.search).has("hosted");
const sampleTools = !hosted && ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) &&
  new URLSearchParams(location.search).get("sampleTools") === "1";
const studioHost = (() => {
  if (!hosted || parent === window) return null;
  try { return parent.location.origin === location.origin ? parent.__RKStudio : null; }
  catch { return null; }
})();
const studioBridge = studioHost?.resume;
const sharedStorageFeedback = hosted && typeof studioBridge?.storageFeedback === "function";
const candidateEnabled = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) &&
  (new URLSearchParams(location.search).get("candidate") === "1" || studioHost && new URLSearchParams(parent.location.search).get("candidate") === "1");
const hostedClient = studioBridge ? createHostedResumeClient({ request: (path, options) => studioBridge.request(path, options, window), ai: studioHost.resumeAI }) : null;
const localKey = suffix => (hosted ? "rk:resume:" : "rk:resume-preview:") + suffix;

const api = async (path, options = {}) => {
  let data;
  if (hosted) {
    if (!hostedClient) throw new Error("Open Resume Studio from the signed-in Studio.");
    data = await hostedClient.api(path, options);
  } else {
    const response = await fetch("/__resume/api/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
    data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "The preview server is unavailable."),
      { status: response.status },
    );
  }
  if (data.transient && data.base64) {
    const { base64, ...entry } = data;
    return { ...entry, blob: new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: "application/pdf" }) };
  }
  return data;
};
const outboxKey = (id) => localKey("pending:" + id);
const time = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const shortTime = (value) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const fileSize = (bytes) =>
  bytes > 1024 * 1024
    ? (bytes / (1024 * 1024)).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / 1024)) + " KB";

function IconButton({ icon: Icon, label, className = "", ...props }) {
  return (
    <button
      type="button"
      className={"rws-icon " + className}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}
function ResumeOptions({ actions, disabled }) {
  const [open, setOpen] = useState(false);
  const host = useRef(null), trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    host.current.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="rws-options" ref={host} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="rws-icon" aria-label="Resume options" title="Resume options" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}><MoreHorizontal size={17} strokeWidth={1.75} /></button>
    {open && <div className="rws-options-menu" role="menu" aria-label="Resume options" onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const index = items.indexOf(document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      {actions.map(({ label, icon: Icon, action }, index) => <button key={label} role="menuitem" className={index === 0 ? "rws-options-download" : ""} onClick={() => { close(); action(); }}><Icon size={20} /><span>{label}</span></button>)}
    </div>}
  </div>;
}
function Dialog({ title, children, actions, onClose, wide = false, headingActions, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement;
    ref.current.showModal();
    return () =>
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
        else document.querySelector('[aria-label="Resume options"]')?.focus();
      });
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={"rws-dialog pass " + (wide ? "pass--wide " : "") + className}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="pass__box">
        <div className="rws-dialog-heading">
          <h2 className="pass__title">{title}</h2>
          {headingActions}
        </div>
        <div className="rws-dialog-body">{children}</div>
        <div className="pass__actions">{actions}</div>
      </div>
    </dialog>
  );
}
function TypographyField({ label, value, min, max, dragStep = 0.01, onChange }) {
  const host = useRef(null), gesture = useRef(null), latest = useRef(null), suppressClick = useRef(false);
  const [preview, setPreview] = useState(null);
  latest.current = { value, onChange };
  const clamp = number => Number(Math.max(min, Math.min(max, number)).toFixed(2));
  const finish = (cancelled = false) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    clearTimeout(current.timer); clearInterval(current.repeat);
    if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    setPreview(null);
    if (!cancelled && current.active && current.value !== current.initial) latest.current.onChange(current.value);
  };
  useEffect(() => {
    const cancel = () => finish(true);
    const key = event => {
      if (!gesture.current || !['Escape', 'Enter'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); finish(event.key === 'Escape');
    };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true);
    return () => { cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); };
  }, []);
  return <label ref={host} className="rws-field rws-typography-field" data-scrubbing={preview !== null || undefined}
    onPointerDown={event => {
      if (event.button !== 0 || gesture.current) return;
      const input = host.current.querySelector('input'), button = event.target.closest('.slide-number-steps button');
      if (button?.disabled || !button && event.target !== input && event.target !== host.current.firstElementChild) return;
      const direction = button ? (button === button.parentElement.firstElementChild ? 1 : -1) : 0;
      suppressClick.current = !!button;
      const current = { initial: latest.current.value, value: latest.current.value, pointerId: event.pointerId, capture: input, x: event.clientX, y: event.clientY, active: !!button, direction };
      gesture.current = current; input.focus(); input.setPointerCapture(event.pointerId);
      if (button) {
        event.preventDefault();
        const step = () => { current.value = clamp(current.value + direction * 0.01); setPreview(current.value); };
        step(); current.timer = setTimeout(() => { current.repeat = setInterval(step, 80); }, 350);
      }
    }}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId || current.direction) return;
      const horizontal = event.clientX - current.x, vertical = event.clientY - current.y;
      if (!current.active && Math.abs(vertical) >= 8 && Math.abs(vertical) > Math.abs(horizontal)) { finish(true); return; }
      if (!current.active && Math.abs(horizontal) < 6) return;
      event.preventDefault(); current.active = true; suppressClick.current = true;
      current.value = clamp(current.initial + Math.trunc(horizontal / 4) * dragStep);
      setPreview(current.value);
    }}
    onPointerUp={event => { if (gesture.current?.pointerId === event.pointerId) finish(); }}
    onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
    onClickCapture={event => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
  ><span>{label}</span><NumberField aria-label={label} title="Drag left or right to adjust" min={min} max={max} step="0.01" value={preview ?? value}
    onBlur={() => finish(true)}
    onChange={event => { const number = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(number) && number >= min && number <= max) onChange(number); }}
  /></label>;
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  selected = false,
  ...props
}) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(value || ""),
    [focused, setFocused] = useState(false);
  const editor = {
    "aria-label": label,
    value: focused ? draft : value || "",
    onFocus: () => {
      setDraft(value || "");
      setFocused(true);
    },
    onBlur: () => setFocused(false),
    onChange: (event) => {
      setDraft(event.target.value);
      onChange(event.target.value);
    },
  };
  useEffect(() => {
    if (selected) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  return (
    <label className={"rws-field " + (selected ? "is-selected" : "")}>
      <span>{label}</span>
      {multiline ? (
        <textarea ref={ref} {...editor} rows={4} {...props} />
      ) : (
        <input ref={ref} type="text" {...editor} {...props} />
      )}
    </label>
  );
}

function PanelResizer({ label, panelId, className, width, preference, minimum, maximum, defaultWidth, direction, onPreview, onCommit, onResizing }) {
  const drag = useRef(null), latest = useRef(null);
  latest.current = { onPreview, onCommit, onResizing };
  const clamp = value => Math.round(Math.max(minimum, Math.min(maximum, value)));
  const finish = cancelled => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    latest.current.onResizing(false);
    if (cancelled) latest.current.onPreview(current.preference);
    else latest.current.onCommit(current.width);
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
  };
  useEffect(() => {
    const cancel = () => finish(true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => { cancel(); window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel); };
  }, []);
  return <div className={className} role="separator" aria-label={label} title={label}
    aria-orientation="vertical" aria-controls={panelId} aria-valuemin={minimum} aria-valuemax={maximum}
    aria-valuenow={width} aria-valuetext={`${width} pixels`} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      drag.current = { x: event.clientX, initial: width, width, preference, pointerId: event.pointerId, target: event.currentTarget };
      onResizing(true); event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.width = clamp(current.initial + direction * (event.clientX - current.x));
      onPreview(current.width);
    }}
    onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
    onDoubleClick={() => onCommit(clamp(defaultWidth))}
    onKeyDown={event => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); finish(true); }
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || drag.current) return;
      event.preventDefault();
      onCommit(clamp(event.key === "Home" ? defaultWidth : event.key === "End" ? maximum : width + direction * (event.key === "ArrowRight" ? 16 : -16)));
    }}
  />;
}

function App() {
  const [fileUrls, setFileUrls] = useState({}), retainedUrls = useRef(new Map());
  const [aiModel, setAiModel] = useState("");
  const [library, setLibrary] = useState([]),
    [sources, setSources] = useState([]),
    [doc, setDoc] = useState(null),
    [version, setVersion] = useState(1);
  const [saveState, setSaveState] = useState("loading"),
    [saveError, setSaveError] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [pdfControlsHost, setPdfControlsHost] = useState(null);
  const pdfViewer = useRef(null), pdfPrintReturn = useRef(false);
  const [pdfReady, setPdfReady] = useState(false), [printingPdf, setPrintingPdf] = useState(false);
  const printDisplayedPdf = async () => {
    if (doc.ats && !doc.ats.layoutAccepted) { setDialog("migration-layout"); return; }
    setPrintingPdf(true);
    try {
      if (!pdfViewer.current) throw new Error("The PDF preview is not available. Reopen it before printing.");
      await pdfViewer.current.print();
    } catch (failure) {
      if (failure.name !== "AbortError") setError(failure.message);
    } finally {
      pdfPrintReturn.current = true;
      setPrintingPdf(false);
    }
  };
  useLayoutEffect(() => {
    if (!printingPdf && pdfPrintReturn.current) {
      pdfPrintReturn.current = false;
      document.querySelector('[aria-label="Print this PDF"]')?.focus();
    }
  }, [printingPdf]);
  const [pane, setPane] = useState("content"),
    [group, setGroup] = useState("Profile"),
    [selectedField, setSelectedField] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false),
    [sheetOpen, setSheetOpen] = useState(false),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false);
  const [mode, setMode] = useState("edit"),
    [sourceId, setSourceId] = useState(""),
    [exported, setExported] = useState(null),
    [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null),
    [input, setInput] = useState(""),
    [targetInput, setTargetInput] = useState(null),
    [imported, setImported] = useState(null);
  const [versions, setVersions] = useState([]),
    [compareVersion, setCompareVersion] = useState(null),
    [proposals, setProposals] = useState([]);
  const [historyPreview, setHistoryPreview] = useState(false), [historyPdf, setHistoryPdf] = useState(null), [historyPdfBusy, setHistoryPdfBusy] = useState(false), [historyPdfError, setHistoryPdfError] = useState("");
  const recordedDownloads = useRef(new Set());
  const downloading = useRef(false);
  const historyDownload = useRef(null);
  const [historyLayoutAccepted, setHistoryLayoutAccepted] = useState(false);
  useEffect(() => setHistoryLayoutAccepted(false), [compareVersion?.number, dialog]);
  const [pageInfo, setPageInfo] = useState({
      width: 794,
      height: 1123,
      pages: 1,
      pageHeight: 1123,
    }),
    [currentPage, setCurrentPage] = useState(1),
    [previewHtml, setPreviewHtml] = useState(""),
    [rendering, setRendering] = useState(false),
    [zoom, setZoom] = useState("fit"),
    [availableWidth, setAvailableWidth] = useState(900),
    [availableHeight, setAvailableHeight] = useState(900);
  const [historyTick, setHistoryTick] = useState(0),
    [conflict, setConflict] = useState(null);
  const [legacyConflict, setLegacyConflict] = useState(false);
  const [libraryView, setLibraryView] = useState(false);
  const rail = libraryView ? "documents" : "sections";
  const [leftPane, setLeftPane] = useState("review");
  const [returnToReview, setReturnToReview] = useState(false);
  const [inlineEditing, setInlineEditing] = useState(false);
  const inlineSession = useRef(null), renderedSignature = useRef(""), inlineNext = useRef(null), pendingInlineEdit = useRef(null);
  const [contactEdit, setContactEdit] = useState(null);
  const contactPanel = useRef(null), contactReturn = useRef(null);
  const [focusedFinding, setFocusedFinding] = useState(null);
  const [previewFieldIds, setPreviewFieldIds] = useState([]);
  const [findingContextOpen, setFindingContextOpen] = useState(false);
  const findingContext = useRef(null);
  const findingContextFocus = useRef(false);
  const pendingFindingFocus = useRef(false);
  const pendingFieldScroll = useRef(null);
  const openReview = () => {
    setLeftPane("review");
    setLibraryOpen(true);
    setSheetOpen(false);
  };
  const [canvasMode, setCanvasMode] = useState(readResumeCanvasMode);
  const [proposalDraft, setProposalDraft] = useState(null);
  const [aiConfiguration, setAiConfiguration] = useState(null);
  const rebuildActive = useRef(false), rebuildReady = useRef(null);
  const [atsChecks, setAtsChecks] = useState([]), [historyTab, setHistoryTab] = useState("versions"), [selectedCheck, setSelectedCheck] = useState(null);
  const [aiConsent, setAiConsent] = useState(false);
  const [aiPacket, setAiPacket] = useState(null);
  const [requirementsConsent, setRequirementsConsent] = useState(false);
  const [evidenceAnswer, setEvidenceAnswer] = useState("");
  const [proposalVisit, setProposalVisit] = useState(null);
  const [findingDecision, setFindingDecision] = useState(null);
  const inspectorContent = useRef(null);
  const proposalReturn = useRef(null);
  const sourceReturn = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [pdfPanelVisible, setPdfPanelVisible] = useState(false);
  const [pdfPanelWidth, setPdfPanelWidth] = useState(340);
  const [resizingPdfPanel, setResizingPdfPanel] = useState(false);
  const pdfPanelMaximum = Math.max(240, Math.min(600, viewportWidth - (viewportWidth > 760 ? 440 : 24)));
  const displayedPdfPanelWidth = Math.min(pdfPanelMaximum, pdfPanelWidth);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("rk:resume-preview:inspector-width");
      const width = Number(saved);
      return saved !== null && Number.isFinite(width) && width >= 290 && width <= 600 ? width : null;
    } catch { return null; }
  });
  const [resizingInspector, setResizingInspector] = useState(false);
  const inspectorDefault = viewportWidth > 1100 ? 316 : 290;
  const inspectorMaximum = Math.max(290, Math.min(600, viewportWidth - (viewportWidth > 1100 ? 340 : 0) - 400));
  const displayedInspectorWidth = Math.max(290, Math.min(inspectorMaximum, inspectorWidth ?? inspectorDefault));
  const storeInspectorWidth = width => {
    const next = Math.max(290, Math.min(inspectorMaximum, width));
    setInspectorWidth(next);
    try { localStorage.setItem("rk:resume-preview:inspector-width", String(next)); } catch {}
  };
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!message || error) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message, error]);
  const live = useRef(null),
    history = useRef(null),
    saveTimer = useRef(null),
    inFlight = useRef(null),
    task = useRef(null),
    sourceRebuild = useRef(null),
    fileInput = useRef(null),
    frame = useRef(null),
    canvas = useRef(null),
    viewTools = useRef(null),
    navigation = useRef(0);

  const refreshLibrary = async () => {
    const data = await api("library");
    setLibrary(data.documents);
    setSources(data.sources);
    return data;
  };
  const install = (record) => {
    task.current?.cancel();
    task.current = null;
    sourceRebuild.current = null;
    setBusy(null);
    const document = structuredClone(record.document);
    live.current = {
      document,
      version: record.version,
      seq: 0,
      saved: 0,
      label: "",
      checkpoint: null,
    };
    history.current = createResumeHistory(document);
    setDoc(document);
    setVersion(record.version);
    setHistoryTick((value) => value + 1);
    setSaveState("saved");
    setSaveError(null);
    setError("");
    setConflict(null);
    setLegacyConflict(false);
    setProposals(document.proposals || []);
    setAiConsent(false);
    setRequirementsConsent(false);
    setEvidenceAnswer("");
    setProposalVisit(null);
    proposalReturn.current = null;
    setSelectedField(null);
    setGroup("Profile");
    setMode("edit");
    setLibraryView(false);
    setLeftPane("review");
    setInlineEditing(false); inlineSession.current = null; inlineNext.current = null; pendingInlineEdit.current = null; contactReturn.current = null; setContactEdit(null);
    setPane("content");
    setFocusedFinding(null);
    setPreviewFieldIds([]);
    setFindingContextOpen(false);
    pendingFieldScroll.current = null;
    setExported(
      record.exports?.findLast(
        (entry) =>
          entry.signature === resumeSignature(document) &&
          entry.renderVersion === RESUME_RENDER_VERSION,
      ) || null,
    );
    setSourceId(document.sourceIds[0] || "");
    setLibraryOpen(false);
    try {
      localStorage.setItem(localKey("selected"), document.id);
    } catch {}
  };
  const persist = async () => {
    clearTimeout(saveTimer.current);
    if (inFlight.current) {
      await inFlight.current;
      if (live.current?.saved !== live.current?.seq) return persist();
      return live.current;
    }
    if (!live.current || live.current.seq === live.current.saved)
      return live.current;
    if (live.current.conflict)
      throw new Error("Resolve the version conflict before saving.");
    const snapshot = structuredClone(live.current.document),
      seq = live.current.seq,
      expected = live.current.version,
      label = live.current.label,
      checkpointKind = live.current.checkpoint;
    setSaveState("saving");
    const operation = (async () => {
      try {
        const record = await api("resumes/" + snapshot.id, {
          method: "PUT",
          headers: { "If-Match": String(expected) },
          body: JSON.stringify({ document: snapshot, label, checkpoint: checkpointKind }),
        });
        if (live.current?.document.id === snapshot.id) {
          live.current.version = record.version;
          live.current.saved = seq;
          setVersion(record.version);
          if (live.current.seq === seq) {
            setSaveState("saved");
            setSaveError(null);
            setError("");
            try {
              localStorage.removeItem(outboxKey(snapshot.id));
            } catch {}
          } else {
            try {
              localStorage.setItem(
                outboxKey(snapshot.id),
                JSON.stringify({
                  document: live.current.document,
                  version: record.version,
                  label: live.current.label,
                  checkpoint: live.current.checkpoint,
                }),
              );
            } catch {}
          }
        }
        setLibrary((rows) =>
          rows.map((row) =>
            row.document.id === snapshot.id
              ? {
                  ...row,
                  document: record.document,
                  version: record.version,
                  versionCount: record.versions.length,
                }
              : row,
          ),
        );
        return record;
      } catch (failure) {
        if (live.current?.document.id === snapshot.id) {
          setSaveState(failure.status === 409 ? "conflict" : "error");
          setSaveError(failure);
          setError(failure.message);
          if (failure.status === 409) {
            setLegacyConflict(failure.code === 'legacy-conflict');
            live.current.conflict = true;
            const remote = await api("resumes/" + snapshot.id).catch(
              () => null,
            );
            setConflict(remote);
          }
        }
        throw failure;
      }
    })();
    inFlight.current = operation;
    try {
      await operation;
    } finally {
      inFlight.current = null;
    }
    if (live.current?.saved !== live.current?.seq) return persist();
    return live.current;
  };
  const change = (next, label = "Edited resume", recordHistory = true, checkpointKind = null) => {
    if (!live.current || next.id !== live.current.document.id) return;
    live.current.document = next;
    live.current.seq++;
    live.current.label = label;
    live.current.checkpoint = checkpointKind;
    if (recordHistory) history.current.record(next);
    else history.current.refresh(next);
    setHistoryTick((value) => value + 1);
    setDoc(next);
    setSaveState(live.current.conflict ? "conflict" : "pending");
    try {
      localStorage.setItem(
        outboxKey(next.id),
        JSON.stringify({ document: next, version: live.current.version, label, checkpoint: checkpointKind }),
      );
    } catch {
      setError(
        "Local recovery storage is unavailable. Keep this tab open until the preview server confirms saving.",
      );
    }
    clearTimeout(saveTimer.current);
    if (!live.current.conflict)
      saveTimer.current = setTimeout(() => persist().catch(() => {}), 500);
  };
  const mutate = (update, label) => {
    const next = structuredClone(live.current.document);
    update(next);
    change(next, label);
  };
  const acceptInlineEdit = data => {
    const session = inlineSession.current;
    if (!session || session.id !== data.fieldId || typeof data.value !== "string") return;
    const field = resumeFields(live.current.document.model).find(field => field.id === session.id);
    const value = data.cancel ? session.original : data.value;
    if (data.cancel && session.recorded) history.current.discard();
    if (field && value !== field.value) {
      change(editResumeField(live.current.document, session.id, value), "Edited " + field.label, !session.recorded && !data.cancel);
      session.recorded = true;
    }
    if (data.type === "resume-edit-end") {
      inlineSession.current = null; inlineNext.current = data.nextField || null;
      setInlineEditing(false);
    }
  };
  const finishInlineEdit = () => {
    if (!inlineSession.current) return;
    const result = frame.current?.contentWindow?.resumeInline?.finish();
    if (result) acceptInlineEdit(result);
  };
  const focusReviewNavigation = (reviewNavigation) => {
    const current = live.current.document, review = current.aiReview;
    if (reviewNavigation?.reviewId !== (current.ats?.reviewId || current.rebuiltFrom?.reviewId) || !reviewNavigation?.finding || review?.kind !== "ats") return;
    const index = review.result?.fixes?.findIndex(finding => JSON.stringify(finding) === JSON.stringify(reviewNavigation.finding)) ?? -1;
    if (index < 0) return;
    const proposal = current.proposals?.find(item => item.findingIndex === index && item.reviewAt === review.at && !current.dismissed?.includes(item.id));
    const targets = resumeFindingTargets(review.findings[index], review, resumeFields(current.model), proposal);
    pendingFindingFocus.current = true; pendingFieldScroll.current = targets[0];
    setFocusedFinding(index); setPreviewFieldIds(targets); setSelectedField(null);
    findingContextFocus.current = true; setFindingContextOpen(true); openReview();
  };
  const load = async (id, initialContext = null) => {
    finishInlineEdit();
    const generation = ++navigation.current;
    try {
      await persist();
      task.current?.cancel();
      setBusy(null);
      const context = initialContext || (hosted ? await studioBridge.initialize(window, id) : {});
      const record = await api("resumes/" + id);
      if (generation !== navigation.current || hosted && !window.frameElement?.isConnected) return;
      install(record);
      let pending;
      try {
        pending = JSON.parse(localStorage.getItem(outboxKey(id)));
      } catch {}
      if (pending?.document?.id === id) {
        change(pending.document, pending.label || "Recovered unsaved local edits", true, pending.checkpoint ?? null);
        if (pending.version !== record.version) {
          clearTimeout(saveTimer.current);
          live.current.conflict = true;
          setConflict(record);
          setSaveState("conflict");
          setError(
            "Recovered local edits differ from the preview server. Compare both versions.",
          );
        } else setMessage("Recovered unsaved edits from this browser.");
      }
      if (context.legacyConflict) {
        clearTimeout(saveTimer.current); live.current.conflict = true;
        setLegacyConflict(true); setConflict(record); setSaveState('conflict'); setDialog('conflict');
        setError('Legacy ATS copies differ. Recover them as separate variants before saving.');
      }
      if (live.current.conflict && context.reviewNavigation?.rebuild) studioBridge?.rebuildProgress?.(window, "input");
      const reviewNavigation = context.reviewNavigation;
      setReturnToReview(!!reviewNavigation?.reviewId);
      if (reviewNavigation?.reviewId && !reviewNavigation.editRole && !live.current.conflict) {
        const data = await refreshLibrary();
        if (generation !== navigation.current) return;
        const current = live.current.document;
        const rebuilt = data.documents.filter(row => !row.document.archived && row.document.rebuiltFrom?.id === id &&
          row.document.rebuiltFrom.signature === resumeSignature(current) && !resumeNeedsSourceRebuild(row.document));
        if (!reviewNavigation.rebuild && rebuilt.length === 1) return load(rebuilt[0].document.id, context);
        if (resumeNeedsSourceRebuild(current)) {
          const answers = new Set((current.evidenceAnswers || []).map(answer => answer.sourceId));
          const originals = data.sources.filter(source => current.sourceIds.includes(source.id) && !answers.has(source.id));
          if (originals.length === 1) await rebuildOriginal(originals[0], reviewNavigation);
          else {
            sourceRebuild.current = { documentId: id, reviewNavigation };
            setDialog("rebuild-source");
            if (reviewNavigation.rebuild) studioBridge?.rebuildProgress?.(window, "input");
          }
          return record;
        }
      }
      if (reviewNavigation?.rebuild && !live.current.conflict) {
        await openFeedbackRebuild();
        return record;
      }
      if (reviewNavigation?.editRole && reviewNavigation.reviewId === live.current.document.ats?.reviewId && !context.legacyConflict) {
        setTargetInput(structuredClone(live.current.document.target));
        setDialog("target");
      }
      focusReviewNavigation(reviewNavigation);
      return record;
    } catch (failure) {
      if (hosted && !window.frameElement?.isConnected) return;
      setError(failure.message);
      if (initialContext?.reviewNavigation?.rebuild) studioBridge?.rebuildProgress?.(window, "error", failure.message);
    }
  };
  useEffect(() => {
    Promise.resolve(studioBridge?.initialize?.(window) || {})
      .then(async context => ({ context, data: await refreshLibrary() }))
      .then(async ({ context, data }) => {
        let saved;
        try {
          saved = localStorage.getItem(localKey("selected"));
        } catch {}
        const selected =
          data.documents.find(
            (row) => row.document.id === (context.resumeId || saved) && !row.document.archived,
          ) || data.documents.find((row) => !row.document.archived);
        if (context.resumeId && !data.documents.some(row => row.document.id === context.resumeId)) throw new Error('The selected ATS resume is unavailable. No other document was opened.');
        if (selected) {
          await load(selected.document.id, context.resumeId ? context : null);
        }
        else setSaveState("saved");
      })
      .catch((failure) => {
        if (hosted && !window.frameElement?.isConnected) return;
        setSaveState("error");
        setError(failure.message);
        studioBridge?.rebuildProgress?.(window, "error", failure.message);
      });
    fetch("/content.json")
      .then((response) => response.json())
      .then((data) =>
        applyStudioTypography(
          typographySystem(data),
          document,
          "published snapshot",
        ),
      )
      .catch(() => {});
    const unload = (event) => {
      if (live.current?.seq !== live.current?.saved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const online = () => persist().catch(() => {});
    window.addEventListener("beforeunload", unload);
    window.addEventListener("online", online);
    return () => {
      clearTimeout(saveTimer.current);
      task.current?.cancel();
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("online", online);
    };
  }, []);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    let transientUrl;
    const source = sources.find(item => item.id === sourceId) || sources.find(item => doc.sourceIds.includes(item.id));
    const files = [];
    if (hostedClient && source) files.push(["sources/" + source.id, source.type === "application/pdf" ? "application/pdf" : "application/octet-stream"]);
    if (exported?.blob) {
      const path = "resumes/" + doc.id + "/exports/" + exported.id;
      transientUrl = URL.createObjectURL(exported.blob);
      retainedUrls.current.set(path, transientUrl);
      setFileUrls(Object.fromEntries(retainedUrls.current));
    } else if (hostedClient && exported) files.push(["resumes/" + doc.id + "/exports/" + exported.id, "application/pdf"]);
    (async () => {
      for (const [path, type] of files) {
        if (retainedUrls.current.has(path)) continue;
        const blob = await hostedClient.file(path, type);
        if (!active) return;
        const url = URL.createObjectURL(blob); retainedUrls.current.set(path, url);
        setFileUrls(Object.fromEntries(retainedUrls.current));
      }
    })().catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; if (transientUrl) { URL.revokeObjectURL(transientUrl); retainedUrls.current.delete("resumes/" + doc.id + "/exports/" + exported.id); } };
  }, [doc?.id, sourceId, sources, exported?.id]);
  useEffect(() => () => { for (const url of retainedUrls.current.values()) URL.revokeObjectURL(url); retainedUrls.current.clear(); }, []);
  const fileHref = (path, download = false) => fileUrls[path] || (hosted ? undefined : (path.startsWith("sources/") ? "/__resume/" : "/__resume/api/") + path + (download ? "?download" : ""));
  useEffect(() => {
    setHistoryPdf(null); setHistoryPdfError(""); setHistoryPdfBusy(false);
    if (dialog !== "versions" || !historyPreview || !compareVersion) return;
    const controller = new AbortController();
    let url;
    setHistoryPdfBusy(true);
    api("resumes/" + doc.id + "/export", { method: "POST", headers: { "If-Match": String(live.current.version) }, body: JSON.stringify({ transient: true, number: compareVersion.number }), signal: controller.signal })
      .then(entry => {
        if (controller.signal.aborted) return;
        if (!entry.blob) throw new Error("The snapshot PDF was not returned.");
        url = URL.createObjectURL(entry.blob);
        setHistoryPdf({ entry, url });
      }).catch(failure => { if (!controller.signal.aborted) setHistoryPdfError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setHistoryPdfBusy(false); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [dialog, historyPreview, compareVersion?.number, doc?.id]);
  useEffect(() => () => historyDownload.current?.abort(), [dialog, compareVersion?.number, doc?.id]);
  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const downloadHistoryPdf = async () => {
    if (!compareVersion || historyPdfBusy) return;
    if (compareVersion.document.ats && !compareVersion.document.ats.layoutAccepted && !historyLayoutAccepted) return;
    const controller = new AbortController(); historyDownload.current = controller;
    setHistoryPdfBusy(true); setHistoryPdfError("");
    try {
      const entry = historyPdf?.entry.version === compareVersion.number ? historyPdf.entry : await api("resumes/" + doc.id + "/export", { method: "POST", headers: { "If-Match": String(live.current.version) }, body: JSON.stringify({ transient: true, number: compareVersion.number }), signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!entry.blob) throw new Error("The snapshot PDF was not returned.");
      downloadBlob(entry.blob, entry.name);
    } catch (failure) { if (!controller.signal.aborted) setHistoryPdfError(failure.message); }
    finally { if (!controller.signal.aborted) setHistoryPdfBusy(false); }
  };
  const downloadOriginal = async (event, source) => {
    if (!hosted) return;
    event.preventDefault();
    try {
      const blob = await hostedClient.file("sources/" + source.id, "application/octet-stream"), url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = source.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) { setError(failure.message); }
  };
  const closeHosted = async () => {
    finishInlineEdit();
    rebuildActive.current = false; rebuildReady.current = null;
    task.current?.cancel(); setBusy(null);
    try { await persist(); studioBridge.close(window); return true; } catch (failure) { setError(failure.message); return false; }
  };
  useEffect(() => studioBridge?.setLeaveHandler?.(window, closeHosted));
  const storageIssue = saveError?.message || (saveState === "conflict" ? error || "Compare both versions before saving." : "");
  const storageFailure = resumeSaveFailureFeedback({ status: saveError?.status, offline: navigator.onLine === false });
  const storageMessage = conflict ? "A newer version was saved. Compare versions before saving." : storageFailure.message;
  const storageActionLabel = conflict ? "Compare versions" : storageFailure.actionLabel;
  const storageBusy = saveState === "saving" || saveState === "pending";
  const storageAction = () => conflict ? setDialog("conflict") : persist();
  useLayoutEffect(() => {
    const viewport = canvas.current, paper = frame.current;
    if (!viewport || !paper || mode !== "edit" || libraryView) return;
    const updatePage = () => {
      const bounds = paper.getBoundingClientRect(), scale = bounds.width / paper.clientWidth;
      const midpoint = viewport.getBoundingClientRect().top + viewport.clientHeight / 2;
      let current = 1;
      paper.contentDocument?.querySelectorAll('.pagedjs_page').forEach((page, index) => {
        if (bounds.top + page.getBoundingClientRect().top * scale <= midpoint) current = index + 1;
      });
      setCurrentPage(current);
    };
    const observer = new ResizeObserver(updatePage);
    observer.observe(viewport);
    observer.observe(paper);
    viewport.addEventListener("scroll", updatePage, { passive: true });
    updatePage();
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", updatePage); };
  }, [doc?.id, mode, libraryView, pageInfo, zoom, availableWidth, availableHeight]);
  useLayoutEffect(() => {
    if (mode === "pdf" && !libraryView) viewTools.current?.querySelector('[aria-label="Close PDF preview"]')?.focus();
  }, [mode, libraryView]);
  useLayoutEffect(() => {
    if (!viewTools.current) return;
    const banners = [...document.querySelectorAll('.rws-flash')];
    if (sharedStorageFeedback) banners.push(...parent.document.querySelectorAll('.resume-save-banner'));
    const controls = observeResumeViewControls(viewTools.current, banners, sharedStorageFeedback ? window.frameElement : null);
    return () => controls.dispose();
  }, [doc?.id, mode, libraryView, storageIssue, error, message]);
  useEffect(() => {
    if (!sharedStorageFeedback) return;
    studioBridge.storageFeedback(window, {
      state: saveState === "pending" ? "saving" : saveState,
      text: !doc ? saveState === "error" ? "Resume unavailable" : saveState === "saved" ? "No active resumes" : "Opening resume..." : saveState === "saved" ? "Saved" : saveState === "conflict" ? "Save conflict" : saveState === "error" ? "Not saved" : "Saving...",
      message: storageIssue ? storageMessage : "",
      detail: storageIssue, actionLabel: storageIssue ? storageActionLabel : "", busy: storageBusy
    }, storageAction);
  });
  const recoverLegacyCopies = async () => {
    if (busy || !live.current) return;
    const id = live.current.document.id;
    setBusy('legacy-recovery'); setError('');
    try {
      const record = await studioBridge.recoverLegacy(id, live.current.version, window);
      if (live.current?.document.id !== id) return;
      live.current.version = record.version; live.current.conflict = false;
      const next = structuredClone(live.current.document);
      next.ats.legacyObserved = record.document.ats.legacyObserved;
      next.ats.recoveredIds = record.document.ats.recoveredIds;
      setConflict(null); setLegacyConflict(false); setDialog(null);
      change(next, 'Retained current edits after legacy recovery');
      await persist(); await refreshLibrary();
      setMessage('Legacy copies are retained as separate recovered resumes. Current edits are saved.');
    } catch (failure) { if (live.current?.document.id === id) setError(failure.message); }
    finally { if (live.current?.document.id === id) setBusy(null); }
  };
  const signature = doc ? resumeSignature(doc) : "";
  const applyCanvasMode = () => {
    if (canvas.current) frame.current?.contentDocument?.documentElement?.style.setProperty("--resume-page-shadow", getComputedStyle(canvas.current).getPropertyValue("--resume-page-shadow"));
  };
  useEffect(() => {
    saveResumeCanvasMode(canvasMode);
    applyCanvasMode();
  }, [canvasMode, rendering, mode]);
  useEffect(() => {
    const sync = event => { if (event.storageArea === localStorage && (event.key === RESUME_CANVAS_STORAGE_KEY || event.key === null)) setCanvasMode(readResumeCanvasMode()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!doc) return;
    if (!["Profile", "Contact"].includes(group) && !doc.model.sections.some(section => section.id === group)) setGroup("Profile");
    if (selectedField && !resumeFields(doc.model).some(field => field.id === selectedField)) setSelectedField(null);
  }, [signature]);
  useEffect(() => {
    if (!doc || inlineEditing) return;
    if (signature === renderedSignature.current && frame.current?.contentWindow?.resumeReady?.signature === signature) {
      setRendering(false);
      if (inlineNext.current) {
        const next = inlineNext.current; inlineNext.current = null;
        requestAnimationFrame(() => frame.current?.contentWindow?.resumeInline?.open(next));
      }
      return;
    }
    setRendering(true);
    const timer = setTimeout(
      () => {
        renderedSignature.current = resumeSignature(doc);
        setPreviewHtml(
          renderResumeHtml(doc, {
            interactive: true,
            base: location.origin + "/",
          }),
        );
      },
      300,
    );
    return () => clearTimeout(timer);
  }, [signature, inlineEditing]);
  useEffect(() => {
    const receive = (event) => {
      if (
        !event.data ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin ||
        event.data.documentId !== live.current?.document.id ||
        event.data.signature !== renderedSignature.current
      )
        return;
      if (event.data.type === "resume-ready") {
        const firstPage = frame.current.contentDocument.querySelector('.pagedjs_page');
        if (!firstPage) {
          const message = "The resume page could not be measured. Reload the preview to try again.";
          setError(message); setRendering(false);
          if (rebuildReady.current) studioBridge?.rebuildProgress?.(window, "error", message);
          return;
        }
        const pageStyle = frame.current.contentWindow.getComputedStyle(firstPage.parentElement);
        setPageInfo({ ...event.data, pageHeight: firstPage.getBoundingClientRect().height + parseFloat(pageStyle.paddingTop) + parseFloat(pageStyle.paddingBottom) });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (renderedSignature.current !== event.data.signature) return;
          setRendering(false);
          if (rebuildReady.current === event.data.signature) {
            rebuildReady.current = null;
            studioBridge?.rebuildProgress?.(window, "ready");
          }
          if (inlineNext.current) {
            const next = inlineNext.current; inlineNext.current = null;
            requestAnimationFrame(() => frame.current?.contentWindow?.resumeInline?.open(next));
          }
        }));
      }
      if (event.data.type === "resume-error") {
        setError(event.data.message);
        setRendering(false);
        if (rebuildReady.current) studioBridge?.rebuildProgress?.(window, "error", event.data.message);
      }
      if (event.data.type === "resume-field") {
        const field = resumeFields(live.current.document.model).find(
          (field) => field.id === event.data.fieldId,
        );
        if (field) {
          setFindingContextOpen(false);
          setGroup(field.group);
          setSelectedField(field.id);
          openContact(field.id);
        }
      }
      if (event.data.type === "resume-edit-start") {
        const field = resumeFields(live.current.document.model).find(field => field.id === event.data.fieldId);
        if (!field || field.value !== event.data.value) { setError("This field changed while the page was updating. Reopen it before editing."); setInlineEditing(false); return; }
        inlineSession.current = { id: field.id, original: field.value, recorded: false };
        setInlineEditing(true); setFindingContextOpen(false); setContactEdit(null);
        setGroup(field.group); setSelectedField(field.id); setSheetOpen(false); setLibraryOpen(false);
        const iframe = frame.current;
        if (iframe.getBoundingClientRect().width / iframe.clientWidth < 0.8) {
          setZoom(0.85);
        }
      }
      if (["resume-edit", "resume-edit-end"].includes(event.data.type)) {
        acceptInlineEdit(event.data);
      }
      if (event.data.type === "resume-undo") undo(event.data.redo);
      if (event.data.type === "resume-edit-exit") document.querySelector(event.data.backwards ? '.rws-workbar button' : '.rws-panel-toggle button[aria-selected="true"]')?.focus();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!frame.current?.parentElement.hidden) {
        setAvailableWidth(entries[0].contentRect.width);
        setAvailableHeight(entries[0].contentRect.height);
      }
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [!!doc]);
  useLayoutEffect(() => {
    if (inlineEditing) frame.current?.contentDocument?.querySelector("[data-inline-field]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [inlineEditing, zoom, availableWidth, availableHeight]);
  useEffect(() => {
    const keyboard = (event) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.target.closest("input,textarea,select,[contenteditable],dialog")
      )
        return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo(event.shiftKey);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  const undo = (redo) => {
    const next = redo ? history.current?.redo() : history.current?.undo();
    if (next) {
      setProposals(next.proposals || []);
      change(next, redo ? "Redo change" : "Undo change", false);
    }
  };
  const openDialog = (name, value = "") => {
    setInput(value);
    setDialog(name);
    setMessage("");
  };
  const create = async (kind = "blank") => {
    try {
      if (!conflict) await persist();
      let next;
      if (kind === "duplicate" || kind === "conflict") {
        next = structuredClone(live.current.document);
        next.id = crypto.randomUUID();
        next.name = kind === "conflict" ? next.name + " / recovered copy" : input.trim() || next.name + " / copy";
        next.archived = false;
        next.assessment = null;
        next.createdAt = Date.now();
        next.updatedAt = Date.now();
      } else
        next = createResume({
          name: input.trim() || "Untitled resume",
          model: {
            name: "Your name",
            title: "Product Designer",
            summary: "",
            contact: { links: [] },
            sections: [],
          },
        });
      const record = await api("resumes", {
        method: "POST",
        body: JSON.stringify({ document: next }),
      });
      if (kind === "conflict") localStorage.removeItem(outboxKey(live.current.document.id));
      install(record);
      await refreshLibrary();
      setDialog(null);
      setMessage("Created " + next.name + ".");
    } catch (failure) {
      setError(failure.message);
    }
  };
  const design = (key, value) =>
    mutate((next) => {
      next.design[key] = value;
    }, "Changed " + key);
  const visitProposal = (proposal, destination, trigger, reference) => {
    const field = resumeFields(live.current.document.model).find(field => field.id === (reference?.fieldId || proposal.fieldId));
    const source = reference && sources.find(source => source.id === reference.sourceId && live.current.document.sourceIds.includes(source.id));
    if (destination === "field" && (!field || proposal.signature !== resumeSignature(live.current.document))) {
      setError("The resume changed. Review a fresh suggestion.");
      return;
    }
    if (destination === "source" && !source) {
      setError("The cited source is no longer available for this resume.");
      return;
    }
    if (Number.isInteger(proposal.findingIndex)) setFocusedFinding(proposal.findingIndex);
    setFindingContextOpen(false);
    setProposalVisit({
      documentId: doc.id, proposalId: proposal.id, findingIndex: trigger.closest("[data-context-finding],[data-review-finding]") ? proposal.findingIndex : undefined, destination,
      trigger: trigger.dataset.proposalNav, mode, group, selectedField, rail, sourceId, libraryOpen,
      inspectorTop: inspectorContent.current.scrollTop,
      canvasTop: canvas.current.scrollTop, canvasLeft: canvas.current.scrollLeft,
      evidenceOpen: trigger.closest(".rws-proposal, .rws-review-finding").querySelector("details").open,
    });
    if (destination === "source") {
      setSourceId(source.id);
      setMode("source");
      setSheetOpen(false);
      setLibraryOpen(false);
    } else {
      pendingFieldScroll.current = field.id;
      pendingInlineEdit.current = field.id;
      selectGroup(field.group);
      setSelectedField(field.id);
    }
  };
  const returnToProposal = () => {
    if (!proposalVisit || proposalVisit.documentId !== live.current.document.id) return;
    finishInlineEdit();
    proposalReturn.current = proposalVisit;
    setMode(proposalVisit.mode);
    setGroup(proposalVisit.group);
    setSelectedField(proposalVisit.selectedField);
    setLibraryView(proposalVisit.rail === "documents");
    setSourceId(proposalVisit.sourceId);
    if (Number.isInteger(proposalVisit.findingIndex)) setFindingContextOpen(true);
    openReview();
    setProposalVisit(null);
  };
  useLayoutEffect(() => {
    if (proposalVisit?.destination === "source") {
      sourceReturn.current?.querySelector("button")?.focus({ preventScroll: true });
      canvas.current.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    const saved = proposalReturn.current;
    if (!saved || leftPane !== "review" || saved.documentId !== doc?.id) return;
    proposalReturn.current = null;
    const proposal = Number.isInteger(saved.findingIndex)
      ? findingContext.current?.querySelector('[data-context-finding="' + saved.findingIndex + '"]')
      : [...inspectorContent.current.querySelectorAll("[data-proposal-id]")].find(element => element.dataset.proposalId === saved.proposalId);
    if (proposal) {
      const details = proposal.querySelector("details"); if (details) details.open = saved.evidenceOpen;
      const trigger = [...proposal.querySelectorAll("[data-proposal-nav]")].find(element => element.dataset.proposalNav === saved.trigger);
      (trigger && !trigger.disabled ? trigger : proposal.querySelector("h4"))?.focus({ preventScroll: true });
    }
    inspectorContent.current.scrollTo({ top: saved.inspectorTop, behavior: "instant" });
    canvas.current.scrollTo({ top: saved.canvasTop, left: saved.canvasLeft, behavior: "instant" });
  }, [leftPane, mode, proposalVisit, findingContextOpen, doc?.id]);
  useLayoutEffect(() => {
    if (!pendingFindingFocus.current || leftPane !== "review" || !doc) return;
    pendingFindingFocus.current = false;
    const finding = inspectorContent.current?.querySelector('[data-review-finding="' + focusedFinding + '"]');
    const group = finding?.closest("details"); if (group) group.open = true;
    finding?.scrollIntoView({ block: "nearest", behavior: "instant" });
    finding?.querySelector("h4")?.focus({ preventScroll: true });
  }, [focusedFinding, leftPane, doc?.id]);
  useEffect(() => {
    if (rendering || mode !== "edit") return;
    const document = frame.current?.contentDocument;
    if (!document) return;
    document.querySelectorAll(".rws-active-field").forEach(field => field.classList.remove("rws-active-field"));
    const ids = selectedField ? [selectedField] : previewFieldIds;
    const fields = ids.flatMap(id => [...document.querySelectorAll('.pagedjs_page [data-field="' + CSS.escape(id) + '"]')]);
    fields.forEach(field => field.classList.add("rws-active-field"));
    if (fields.length && ids.includes(pendingFieldScroll.current)) {
      pendingFieldScroll.current = null;
      fields[0].scrollIntoView({ block: "center", behavior: "instant" });
    }
    if (pendingInlineEdit.current && ids.includes(pendingInlineEdit.current)) {
      const id = pendingInlineEdit.current; pendingInlineEdit.current = null;
      frame.current.contentWindow.resumeInline?.open(id);
    }
  }, [selectedField, previewFieldIds, rendering, mode]);
  useLayoutEffect(() => {
    if (findingContextFocus.current && findingContext.current) {
      findingContextFocus.current = false;
      findingContext.current.focus({ preventScroll: true });
    }
  });
  useLayoutEffect(() => {
    if (!findingContextOpen || mode !== "edit" || rendering || !findingContext.current) return;
    const panel = findingContext.current, stage = panel.parentElement;
    return observeResumeContext(panel, stage, () => {
      const iframe = frame.current;
      const target = previewFieldIds.map(id => iframe?.contentDocument?.querySelector('.pagedjs_page [data-field="' + CSS.escape(id) + '"]')).find(Boolean);
      if (!target) return null;
      const outer = iframe.getBoundingClientRect(), inner = target.getBoundingClientRect();
      const ratio = outer.width / iframe.clientWidth;
      return { left: outer.left + inner.left * ratio, right: outer.left + inner.right * ratio,
        top: outer.top + inner.top * ratio, bottom: outer.top + inner.bottom * ratio };
    }, frame.current?.contentDocument);
  }, [findingContextOpen, focusedFinding, previewFieldIds, mode, rendering, zoom, pageInfo, availableWidth, availableHeight]);
  const reviewProposals = () => setProposals(sampleProposals(live.current.document, sources).map(proposal => ({ ...proposal, impact: projectResumeProposal(live.current.document, proposal, sources) })));
  const openAiReview = async () => {
    if (hosted) { await openAtsCheck(); return; }
    setError(""); setAiConsent(false); setRequirementsConsent(false);
    setAiPacket(null); setAiConfiguration(null);
    setDialog("ai-review");
    try { setAiPacket(reviewPacket(live.current.document)); const configuration = hosted ? await studioBridge.configuration(window) : await api("ai/config"); setAiConfiguration(configuration); setAiModel(configuration.models?.find(model => Number.isFinite(model.pricing?.input) && Number.isFinite(model.pricing?.output))?.id || ""); }
    catch (failure) { setError(failure.message); }
  };
  const cancelAiReview = () => {
    task.current?.cancel(); task.current = null;
    rebuildActive.current = false; rebuildReady.current = null;
    setBusy(null); setDialog(null); setAiConsent(false);
  };
  const runAiReview = async (stage) => {
    if (busy) return;
    if (!aiConfiguration?.available) { setError("The Studio AI session is not connected."); return; }
    if (!aiConsent || !aiPacket || stage === "assessment" && !requirementsConsent) return;
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel(); task.current = currentTask;
    setBusy("ai-" + stage); setError("");
    try {
      const options = {
        provider: aiConfiguration.provider, model: aiConfiguration.model,
        getCurrent: () => task.current === currentTask ? live.current?.document : null,
        signal: currentTask.signal,
        complete: async request => {
          const { signal, ...input } = request;
          const payload = { ...input, provider: aiConfiguration.provider, model: aiConfiguration.model };
          const result = hosted ? await studioBridge.complete(payload, window, signal) : await api("ai/complete", { method: "POST", body: JSON.stringify(payload), signal });
          return result.text;
        },
      };
      if (stage === "requirements") {
        const manifest = await inventoryResumeWithAI(currentTask.snapshot, options);
        if (!currentTask.accept(live.current.document, manifest)) return;
        change({ ...live.current.document, reviewManifest: manifest, reviewManifestOriginal: structuredClone(manifest) }, "Inventoried target requirements", false);
        setRequirementsConsent(false);
      } else if (stage === "assessment") {
        const result = await reviewResumeWithAI(currentTask.snapshot, { ...options, manifest: currentTask.snapshot.reviewManifest, prepareActions: true, sources });
        if (!currentTask.accept(live.current.document, result)) return;
        const nextProposals = [...proposals.filter(proposal => proposal.origin !== "ai"), ...result.actions.filter(action => action?.kind === "revision").map(action => action.proposal)];
        setProposals(nextProposals);
        change({ ...live.current.document, aiReview: result, proposals: nextProposals, aiQuestion: null, aiResolution: null }, "Reviewed role evidence and prepared revisions", false);
        setDialog(null); setFocusedFinding(null); setFindingContextOpen(false); setPreviewFieldIds([]); openReview();
      }
      await persist();
    } catch (failure) { if (task.current === currentTask && !currentTask.signal.aborted) setError(failure.message); }
    finally { if (task.current === currentTask) { setBusy(null); task.current = null; } }
  };
  const canAnswerQuestion = question => {
    const document = live.current.document, review = document.aiReview;
    return !!question && (question.reviewAt === undefined || question.reviewAt === review?.at) && (question.signature === resumeSignature(document) || !!review && question.signature === review.signature && canReviseReview(document, review));
  };
  const saveEvidenceAnswer = async (question = doc.aiQuestion) => {
    if (busy || !evidenceAnswer.trim()) return;
    if (!canAnswerQuestion(question)) { setError("The resume or review changed. Review again before answering this question."); return; }
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel(); task.current = currentTask;
    setBusy("evidence"); setError("");
    try {
      const text = evidenceAnswer.trim();
      const bytes = new TextEncoder().encode(text);
      const source = await api("sources", { method: "POST", signal: currentTask.signal, body: JSON.stringify({ name: "Author evidence.txt", type: "text/plain", text, base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) }) });
      if (task.current !== currentTask || !currentTask.accept(live.current.document, source)) return;
      change({ ...live.current.document, sourceIds: [...new Set([...live.current.document.sourceIds, source.id])], evidenceAnswers: [...(live.current.document.evidenceAnswers || []), { question, sourceId: source.id, at: Date.now() }], aiQuestion: null }, "Added author evidence");
      await persist();
      if (task.current !== currentTask || currentTask.signal.aborted) return;
      await refreshLibrary();
      if (task.current !== currentTask || currentTask.signal.aborted) return;
      setEvidenceAnswer("");
      setMessage("Answer saved. Review again to include this fact in the proposed revisions; your resume wording is unchanged.");
    } catch (failure) { if (task.current === currentTask && !currentTask.signal.aborted) setError(failure.message); }
    finally { if (task.current === currentTask) { setBusy(null); task.current = null; } }
  };
  const saveFindingDecision = async (review, findingIndex, choice) => {
    if (busy) return;
    const documentId = live.current.document.id;
    setBusy("finding-decision"); setError("");
    try {
      change(decideResumeFinding(live.current.document, review, findingIndex, choice), choice.reason === "reopen" ? "Restored archived suggestion" : "Archived review suggestion");
      await persist();
      if (live.current.document.id !== documentId) return;
      setDialog(null); setFindingDecision(null); setFindingContextOpen(false);
      openReview();
      requestAnimationFrame(() => {
        const row = inspectorContent.current?.querySelector('[data-review-finding="' + findingIndex + '"]');
        const group = row?.closest("details"); if (group) group.open = true;
        row?.scrollIntoView({ block: "nearest" });
        row?.querySelector("h4")?.focus({ preventScroll: true });
      });
    } catch (failure) { if (live.current.document.id === documentId) setError(failure.message); }
    finally { if (live.current.document.id === documentId) setBusy(null); }
  };
  const composeProposal = () => {
    const field = resumeFields(live.current.document.model).find(field => field.label === "Achievement") || resumeFields(live.current.document.model).find(field => field.id === "summary");
    setProposalDraft({ fieldId: field.id, after: field.value, sourceId: live.current.document.sourceIds[0] || "", quote: "" });
    setDialog("proposal");
  };
  const previewProposal = () => {
    try {
      const field = resumeFields(live.current.document.model).find(field => field.id === proposalDraft.fieldId);
      const proposal = { id: crypto.randomUUID(), signature: resumeSignature(live.current.document), fieldId: field.id, before: field.value, after: proposalDraft.after, title: "Review " + field.label.toLowerCase() + " revision", reason: "User-authored proposal. Source verification checks the excerpt and numbers; you remain responsible for the meaning of the claim.", evidence: [{ sourceId: proposalDraft.sourceId, quote: proposalDraft.quote }], origin: "manual" };
      proposal.impact = projectResumeProposal(live.current.document, proposal, sources);
      const nextProposals = [...proposals, proposal];
      setProposals(nextProposals);
      change({ ...live.current.document, proposals: nextProposals }, "Prepared a manual revision");
      openReview(); setDialog(null); setError("");
    } catch (failure) { setError(failure.message); }
  };
  const checkpoint = async (label, kind = null, expectedSignature = null) => {
    await persist();
    if (expectedSignature && resumeSignature(live.current.document) !== expectedSignature) throw new Error("The resume changed before download. Preview the current version again.");
    change(structuredClone(live.current.document), label, false, kind);
    await persist();
  };
  const applyProposal = async proposal => {
    if (busy) return;
    const currentTask = createResumeTask(live.current.document);
    setBusy("proposal");
    try {
      applyResumeProposal(live.current.document, proposal, sources);
      await checkpoint("Before suggestion: " + proposal.title);
      if (!currentTask.accept(live.current.document, {})) throw new Error("The resume changed. Review a fresh suggestion.");
      const next = applyResumeProposal(live.current.document, proposal, sources);
      next.proposals = (next.proposals || []).filter(item => item.id !== proposal.id);
      next.assessment = assessResume(next);
      change(next, "Applied: " + proposal.title);
      setProposals(previous => previous.filter(item => item.id !== proposal.id));
      await persist();
      setMessage("Applied the reviewed change. You can Undo to keep the original.");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };
  const applyCandidateRevision = async ({ revision, snapshot, assessment, signal }) => {
    if (busy) throw new Error("Another editor operation is still running.");
    setBusy("candidate-revision"); setError("");
    try {
      const result = await commitAssessmentRevision({ revision, snapshot, assessment, signal, confirmed: true,
        getRecord: () => ({ document: live.current.document, version: live.current.version }),
        checkpoint: async label => {
          await checkpoint(label);
          return { document: live.current.document, version: live.current.version };
        },
        save: async (next, options) => {
          signal.throwIfAborted();
          if (live.current.version !== options.expectedVersion || resumeSignature(live.current.document) !== options.expectedSignature) throw new Error("The resume changed before Apply. Nothing was replaced.");
          change(next, options.label); await persist();
          return { document: live.current.document, version: live.current.version };
        } });
      setMessage("Applied the reviewed candidate revision. The preceding version and claim evidence are saved; recheck explicitly when ready.");
      return result;
    } catch (failure) { setError(failure.message); throw failure; }
    finally { setBusy(null); }
  };
  const openAtsCheck = async () => {
    setAiConsent(false); setError(''); setAiConfiguration(null); setDialog('ats-check');
    try { setAiConfiguration(await studioBridge.configuration(window)); }
    catch (failure) { setError(failure.message); }
  };
  const openFeedbackRebuild = async (prepared = live.current.document) => {
    if (rebuildActive.current) return;
    rebuildActive.current = true; rebuildReady.current = null;
    const pending = { document: structuredClone(prepared), sourceSignature: resumeSignature(live.current.document), review: JSON.stringify(live.current.document.aiReview) };
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel(); task.current = currentTask;
    const current = () => task.current === currentTask && !currentTask.signal.aborted &&
      resumeSignature(live.current.document) === pending.sourceSignature && JSON.stringify(live.current.document.aiReview) === pending.review;
    setBusy("feedback-rebuild"); setError("");
    if (!hosted) setDialog("feedback-rebuild");
    try {
      studioBridge?.rebuildProgress?.(window, "working");
      if (resumeFields(pending.document.model).some(field => /[\u0000\ufffd]/.test(field.value))) {
        const { readResumePdf } = await import("./resume-pdf.mjs");
        const { repairResumeGlyphsFromSource } = await import("./resume-pdf-glyphs.mjs");
        pending.document.atsChecks = resumeAtsChecks({ document: pending.document });
        const answers = new Set((pending.document.evidenceAnswers || []).map(answer => answer.sourceId));
        const originals = [];
        for (const source of sources.filter(source => pending.document.sourceIds.includes(source.id) && !answers.has(source.id) && (source.type === "application/pdf" || /\.pdf$/i.test(source.name)))) {
          let blob;
          if (hosted) blob = await hostedClient.file("sources/" + source.id, source.type, { signal: currentTask.signal });
          else {
            const response = await fetch("/__resume/sources/" + source.id, { signal: currentTask.signal });
            if (!response.ok) throw new Error("The original PDF could not be read to repair its symbols. Your resume is unchanged.");
            blob = await response.blob();
          }
          const extracted = await readResumePdf(new Uint8Array(await blob.arrayBuffer()), { signal: currentTask.signal });
          if (!current()) return;
          originals.push(extracted.text);
        }
        pending.document = repairResumeGlyphsFromSource(pending.document, originals.join("\n\n")).document;
        const unreadable = resumeFields(pending.document.model).reduce((count, field) => count + (field.value.match(/[\u0000\ufffd]/g) || []).length, 0);
        pending.document.importNotes = { ...pending.document.importNotes, unmappedGlyphs: unreadable };
      }
      resumeRebuildPacket(pending.document, sources);
      const configuration = hosted ? await studioBridge.configuration(window) : await api("ai/config");
      if (!current()) return;
      if (!configuration.available) throw new Error("Connect AI in Studio settings, then choose Rebuild again. No AI request was made.");
      if (hosted && (configuration.rebuildResponseVersion !== 2 || !studioBridge.rebuildProgress)) throw new Error("Reopen Studio before rebuilding. No AI request was made.");
      await persist();
      if (!current()) throw new Error("The resume or feedback changed. Reopen Rebuild; nothing was replaced.");
      const result = await rebuildResumeWithAI(pending.document, {
        sources, provider: configuration.provider, model: configuration.model, signal: currentTask.signal,
        getCurrent: () => current() ? pending.document : null,
        complete: async request => {
          const { signal, ...input } = request;
          const payload = { ...input, provider: configuration.provider, model: configuration.model };
          const response = hosted ? await studioBridge.complete(payload, window, signal) : await api("ai/complete", { method: "POST", body: JSON.stringify(payload), signal });
          return response.text;
        },
      });
      if (!current()) throw new Error("The resume or feedback changed. The late rebuild was discarded.");
      result.rebuiltFrom.signature = pending.sourceSignature;
      const record = await api("resumes", { method: "POST", signal: currentTask.signal, body: JSON.stringify({ document: result }) });
      if (!current()) return;
      await refreshLibrary();
      if (!current()) return;
      rebuildReady.current = resumeSignature(record.document);
      rebuildActive.current = false;
      install(record); setLeftPane("none"); setLibraryOpen(false); setSheetOpen(true);
      studioBridge?.rebuildProgress?.(window, "working", "Preparing your rebuilt resume\u2026");
      setDialog(null); setAiConsent(false);
      const unresolved = result.aiRebuild.fixes.filter(fix => fix.status === "needs-fact").length;
      const unreadable = result.importNotes?.unmappedGlyphs || result.importNotes?.unresolvedMarkers || 0;
      setMessage("Resume rebuilt using ATS feedback." + (unresolved ? " " + unresolved + " findings need facts; see Rebuild details." : "") + (unreadable ? " " + unreadable + " unreadable source characters need review." : "") + " Run ATS check when you are ready.");
    } catch (failure) {
      if (task.current === currentTask && !currentTask.signal.aborted) {
        if (!hosted) setDialog(null);
        setError(failure.message);
        studioBridge?.rebuildProgress?.(window, "error", failure.message);
      }
    } finally {
      if (task.current === currentTask) { task.current = null; setBusy(null); rebuildActive.current = false; }
    }
  };
  const runHostedAssessment = async () => {
    if (busy || !aiConsent || !aiConfiguration?.available) return;
    if (aiConfiguration.reviewResponseVersion !== 1) { setError("Studio needs to be reopened before this updated review can run. No AI request was made."); return; }
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel(); task.current = currentTask;
    setBusy('ats-check'); setError('');
    try {
      await persist();
      if (task.current !== currentTask || !currentTask.accept(live.current.document, {})) return;
      const artifact = await api('resumes/' + currentTask.snapshot.id + '/export', { method: 'POST', headers: { 'If-Match': String(live.current.version) }, body: '{"transient":true}', signal: currentTask.signal });
      if (!currentTask.accept(live.current.document, artifact)) return;
      setExported(artifact);
      const { blob, ...entry } = artifact;
      const result = await studioBridge.assess(currentTask.snapshot, { entry, bytes: new Uint8Array(await blob.arrayBuffer()) }, window, currentTask.signal);
      if (!currentTask.accept(live.current.document, result)) return;
      const assessment = assessResume(currentTask.snapshot, { pages: artifact.pages, complete: true, fields: artifact.verification.fields, extractedText: artifact.extractedText, layout: artifact.layout, renderVersion: artifact.renderVersion });
      const aiReview = atsEditorReview(currentTask.snapshot, result, { sources });
      const nextProposals = [...proposals.filter(proposal => proposal.origin !== "ai"), ...(aiReview.actions || []).filter(action => action?.kind === "revision").map(action => action.proposal)];
      setProposals(nextProposals);
      const checked = { ...live.current.document, assessment, aiReview, proposals: nextProposals, aiQuestion: null, aiResolution: null };
      checked.atsChecks = resumeAtsChecks({ document: checked });
      change(checked, 'ATS checked current PDF', false);
      await persist();
      if (task.current !== currentTask || currentTask.signal.aborted) return;
      setDialog(null); setFocusedFinding(null); setFindingContextOpen(false); setPreviewFieldIds([]); openReview(); setMessage('ATS check saved for this resume and target.');
    } catch (failure) { if (task.current === currentTask && !currentTask.signal.aborted) setError(failure.message); }
    finally { if (task.current === currentTask) { task.current = null; setBusy(null); } }
  };
  const prepareCandidateExport = async (signal) => {
    signal.throwIfAborted();
    await persist();
    signal.throwIfAborted();
    const { document, version } = structuredClone(live.current);
    const signature = resumeSignature(document);
    const previewReady = frame.current?.contentWindow?.resumeReady;
    if (previewReady?.signature === signature && !previewReady.hasPlaceholders && previewReady.layoutError) throw new Error(previewReady.layoutError);
    const current = () => {
      signal.throwIfAborted();
      if (live.current.version !== version || resumeSignature(live.current.document) !== signature) throw new Error("The document changed while preparing the PDF. Prepare the current version again.");
    };
    const { blob: exportedBlob, ...entry } = await api("resumes/" + document.id + "/export", {
      method: "POST", headers: { "If-Match": String(version), ...(hosted && previewReady?.signature === signature && !previewReady.hasPlaceholders ? { "X-Resume-Pages": String(pageInfo.pages) } : {}) },
      body: '{"transient":true}', signal,
    });
    current();
    const path = "resumes/" + document.id + "/exports/" + entry.id;
    let blob;
    if (exportedBlob) blob = exportedBlob;
    else if (hosted) blob = await hostedClient.file(path, "application/pdf", { signal });
    else {
      const response = await fetch(fileHref(path), { signal });
      if (!response.ok) throw new Error("The checked PDF could not be read.");
      blob = await response.blob();
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    current();
    return { document, version, entry, bytes };
  };
  const downloadCurrentPdf = async (entry = exported) => {
    if (!entry || downloading.current || busy && busy !== "pdf") return;
    downloading.current = true;
    setError("");
    try {
      if (entry.signature !== resumeSignature(live.current.document)) throw new Error("The resume changed. Preview the current version before downloading.");
      if (!entry.blob) throw new Error("The PDF is no longer available. Preview it again.");
      if (!recordedDownloads.current.has(entry.id)) {
        await checkpoint("PDF exported", "export", entry.signature);
        recordedDownloads.current.add(entry.id);
      }
      if (entry.signature !== resumeSignature(live.current.document)) throw new Error("The resume changed before download. Preview the current version again.");
      downloadBlob(entry.blob, entry.name);
      await refreshLibrary();
    } catch (failure) { setError(failure.message); }
    finally { downloading.current = false; }
  };
  const renderPdf = async (download = false) => {
    let currentTask;
    try {
      await persist();
      currentTask = createResumeTask(live.current.document);
      task.current?.cancel();
      task.current = currentTask;
      setBusy("pdf");
      setError("");
      const previewReady = frame.current?.contentWindow?.resumeReady;
      if (previewReady?.signature === currentTask.signature && !previewReady.hasPlaceholders && previewReady.layoutError) throw new Error(previewReady.layoutError);
      const result = exported?.blob && exported.signature === currentTask.signature && exported.renderVersion === RESUME_RENDER_VERSION ? exported : await api(
        "resumes/" + currentTask.snapshot.id + "/export",
        {
          method: "POST",
          headers: { "If-Match": String(live.current.version), ...(hosted && previewReady?.signature === currentTask.signature && !previewReady.hasPlaceholders ? { "X-Resume-Pages": String(pageInfo.pages) } : {}) },
          body: '{"transient":true}',
          signal: currentTask.signal,
        },
      );
      if (!currentTask.accept(live.current.document, result)) {
        setMessage(
          "The document changed. Export the current version when ready.",
        );
        return;
      }
      setExported(result);
      setMode("pdf");
      setLibraryOpen(false);
      setSheetOpen(false);
      await refreshLibrary();
      if (!currentTask.accept(live.current.document, result)) return;
      const assessment = assessResume(live.current.document, {
        pages: result.pages,
        complete: true,
        fields: result.verification.fields,
        extractedText: result.extractedText,
        layout: result.layout,
        renderVersion: result.renderVersion,
      });
      change(
        { ...live.current.document, assessment },
        "Verified PDF and text layer",
        false,
      );
      if (download && live.current.document.ats && !live.current.document.ats.layoutAccepted) setDialog('migration-layout');
      else if (download) {
        await downloadCurrentPdf(result);
      }
      setMessage(
        result.pages + (result.pages === 1 ? " page verified. " : " pages verified. ") + "Every authored field is present.",
      );
    } catch (failure) {
      if (!currentTask || task.current === currentTask) setError(failure.message);
    } finally {
      if (!currentTask || task.current === currentTask) setBusy(null);
    }
  };
  const showVersions = async () => {
    try {
      await persist();
      const record = await api("resumes/" + doc.id);
      const checkpoints = resumeHistoryCheckpoints(record).reverse();
      const checks = resumeAtsChecks(record);
      setAtsChecks(checks); setSelectedCheck(checks[0] || null); setHistoryTab("versions");
      setVersions(checkpoints);
      setCompareVersion(checkpoints[0] || null);
      setHistoryPreview(false);
      setInput("");
      setDialog("versions");
    } catch (failure) {
      setError(failure.message);
    }
  };
  const restoreVersion = async (number) => {
    try {
      const record = await api("resumes/" + doc.id + "/restore", {
        method: "POST",
        headers: { "If-Match": String(live.current.version) },
        body: JSON.stringify({ number }),
      });
      const restoredHistory = history.current;
      restoredHistory.record(record.document);
      install(record);
      history.current = restoredHistory;
      await refreshLibrary();
      setDialog(null);
      setMessage("Restored checkpoint v" + number + ". You can Undo to return to the previous draft.");
    } catch (failure) {
      setError(failure.message);
    }
  };
  const archive = () => {
    mutate(
      (next) => {
        next.archived = !next.archived;
      },
      doc.archived ? "Restored archived resume" : "Archived resume",
    );
    setDialog(null);
  };
  const addSection = (kind) => {
    const id = crypto.randomUUID(),
      section = {
        id,
        kind,
        heading: {
          experience: "Experience",
          education: "Education",
          skills: "Skills",
          text: "Projects",
          list: "Recognition",
        }[kind],
      };
    if (kind === "skills")
      section.groups = [{ id: crypto.randomUUID(), label: "", items: [] }];
    else if (kind === "text") section.text = "";
    else section.items = [];
    mutate(
      (next) => next.model.sections.push(section),
      "Added " + section.heading,
    );
    setGroup(id);
    setPane("content");
    setDialog(null);
  };
  const addItem = (section) =>
    mutate((next) => {
      const selected = next.model.sections.find(
          (item) => item.id === section.id,
        ),
        id = crypto.randomUUID();
      if (section.kind === "experience")
        selected.items.push({
          id,
          role: "",
          org: "",
          dates: "",
          location: "",
          bullets: [{ id: crypto.randomUUID(), text: "" }],
        });
      else if (section.kind === "education")
        selected.items.push({
          id,
          school: "",
          credential: "",
          dates: "",
          note: "",
        });
      else if (section.kind === "skills")
        selected.groups.push({ id, label: "", items: [] });
      else selected.items.push({ id, title: "", meta: "" });
    }, "Added entry");
  const selectGroup = (id) => {
    setGroup(id);
    setSelectedField(null);
    setPane("content");
    setLibraryView(false);
    setLibraryOpen(false);
    setSheetOpen(false);
    setMode("edit");
  };
  const selectDocumentField = (id, fieldId) => {
    setGroup(id); setSelectedField(fieldId); setFindingContextOpen(false);
    setMode("edit"); pendingFieldScroll.current = fieldId;
  };
  const openContact = (fieldId = null) => {
    const document = live.current.document;
    const field = fieldId && resumeFields(document.model).find(field => field.id === fieldId);
    const link = document.model.contact.links.find(link => fieldId === link.id + ".label" || fieldId === link.id + ".url");
    setFindingContextOpen(false); setSheetOpen(false); setLibraryOpen(false);
    setContactEdit({ fieldId, kind: link ? "link" : field?.group === "Contact" ? field.key : field ? "detail" : ['email', 'phone', 'location'].find(key => !document.model.contact[key]) || "link", linkId: link?.id, label: link?.label || "", value: link?.url || field?.value || "" });
  };
  const saveContact = (remove = false) => {
    try {
      const edit = contactEdit;
      let value = edit.value.trim();
      if (!remove && edit.kind === "link") {
        value = resumeHref(value);
        if (!/^https?:\/\//.test(value)) throw new Error("Enter a valid website address.");
      }
      mutate(next => {
        if (edit.kind === "link") {
          const links = next.model.contact.links;
          if (remove) {
            next.model.contact.links = links.filter(link => link.id !== edit.linkId);
            if (next.model.contact.order) next.model.contact.order = next.model.contact.order.filter(id => id !== edit.linkId);
          } else if (edit.linkId) Object.assign(links.find(link => link.id === edit.linkId), { label: edit.label.trim(), url: value });
          else links.push({ id: crypto.randomUUID(), label: edit.label.trim(), url: value });
        } else if (edit.kind === "detail") {
          const field = resumeFields(next.model).find(field => field.id === edit.fieldId);
          if (!field) throw new Error("This link no longer exists.");
          if (!remove && !/^https?:\/\//.test(resumeHref(value))) throw new Error("Enter a valid website address.");
          field.owner[field.key] = remove ? "" : value;
        } else next.model.contact[edit.kind] = remove ? "" : value;
      }, remove ? "Removed contact detail" : "Updated contact detail");
      contactReturn.current = { fieldId: remove ? null : edit.fieldId };
      setContactEdit(null);
    } catch (failure) { setError(failure.message); }
  };
  const closeContact = () => { contactReturn.current = { fieldId: contactEdit.fieldId }; setContactEdit(null); };
  useLayoutEffect(() => {
    if (contactEdit || rendering || !contactReturn.current || renderedSignature.current !== signature) return;
    const target = [...(frame.current?.contentDocument?.querySelectorAll(".pagedjs_page [data-field]") || [])].find(node => node.dataset.field === contactReturn.current.fieldId);
    contactReturn.current = null;
    (target || document.querySelector('.rws-panel-toggle button[aria-selected="true"]'))?.focus({ preventScroll: true });
  }, [contactEdit, rendering, signature]);
  useLayoutEffect(() => {
    if (!contactEdit || !contactPanel.current) return;
    const panel = contactPanel.current;
    panel.querySelector("input,select")?.focus({ preventScroll: true });
    return observeResumeContext(panel, panel.parentElement, () => {
      const iframe = frame.current, target = [...(iframe?.contentDocument?.querySelectorAll(".pagedjs_page [data-field]") || [])].find(node => node.dataset.field === contactEdit.fieldId);
      if (!target) return null;
      const outer = iframe.getBoundingClientRect(), inner = target.getBoundingClientRect(), ratio = outer.width / iframe.clientWidth;
      return { left: outer.left + inner.left * ratio, right: outer.left + inner.right * ratio, top: outer.top + inner.top * ratio, bottom: outer.top + inner.bottom * ratio };
    }, frame.current?.contentDocument);
  }, [!!contactEdit, contactEdit?.fieldId, rendering, zoom, pageInfo, availableWidth, availableHeight]);
  const importFile = async (file, rebuildFrom = null, reviewNavigation = null) => {
    if (!file) return;
    const currentTask = createResumeTask(live.current.document), generation = navigation.current;
    task.current?.cancel(); task.current = currentTask;
    const isCurrent = () => task.current === currentTask && !currentTask.signal.aborted && navigation.current === generation;
    setBusy("import");
    setError("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error(
          "The sample accepts files up to 20 MB. No content was imported.",
        );
      const bytes = await file.arrayBuffer();
      if (!isCurrent()) return;
      let text = "",
        pages = null, unmappedGlyphs = 0, unresolvedMarkers = 0;
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        const { readResumePdf } = await import("./resume-pdf.mjs");
        const extracted = await readResumePdf(new Uint8Array(bytes));
        pages = extracted.pages.length;
        text = extracted.text;
        unmappedGlyphs = extracted.unmappedGlyphs;
        unresolvedMarkers = extracted.unresolvedMarkers;
      } else if (/\.docx$/i.test(file.name)) {
        const mammoth = await import("mammoth/mammoth.browser.js");
        if (!isCurrent()) return;
        text = (
          await (mammoth.default || mammoth).extractRawText({
            arrayBuffer: bytes,
          })
        ).value;
      } else if (/\.(txt|md)$/i.test(file.name))
        text = new TextDecoder().decode(bytes);
      else
        throw new Error(
          "Choose a text-based PDF, DOCX, TXT or Markdown source.",
        );
      if (!isCurrent()) return;
      if (!text.trim())
        throw new Error(
          "No readable text was found. OCR is not connected in this sample. Your file was not changed.",
        );
      if (text.length > 120000)
        throw new Error(
          "The extracted text exceeds the sample limit. Nothing was silently truncated.",
        );
      const pending = { file, bytes, text, pages, unmappedGlyphs, unresolvedMarkers, structure: structureResumeText(text), documentId: currentTask.snapshot.id, generation, rebuildFrom, reviewNavigation };
      if (reviewNavigation?.rebuild && !resumeNeedsSourceRebuild(pending.structure)) {
        await saveSource(true, pending, true);
        return;
      }
      setImported(pending);
      setDialog("import");
      if (reviewNavigation?.rebuild) studioBridge?.rebuildProgress?.(window, "input");
    } catch (failure) {
      if (isCurrent()) {
        setError(failure.message);
        if (rebuildFrom) setDialog("rebuild-source");
        if (reviewNavigation?.rebuild) studioBridge?.rebuildProgress?.(window, "input");
      }
    } finally {
      if (task.current === currentTask) {
        setBusy(null); task.current = null;
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  };
  const rebuildOriginal = async (source, reviewNavigation = null) => {
    if (busy || !source) return;
    document.getElementById("resume-review-info")?.hidePopover();
    const currentTask = createResumeTask(live.current.document), generation = navigation.current;
    task.current?.cancel(); task.current = currentTask;
    setBusy("rebuild-source"); setError("");
    sourceRebuild.current = { documentId: live.current.document.id, reviewNavigation };
    try {
      await persist();
      let blob;
      if (hosted) blob = await hostedClient.file("sources/" + source.id, source.type, { signal: currentTask.signal });
      else {
        const response = await fetch("/__resume/sources/" + source.id, { signal: currentTask.signal });
        if (!response.ok) throw new Error("The original file could not be read. Your current resume is unchanged.");
        blob = await response.blob();
      }
      if (task.current !== currentTask || currentTask.signal.aborted || navigation.current !== generation || !currentTask.accept(live.current.document, true)) return;
      await importFile(new File([blob], source.name, { type: source.type }), structuredClone(live.current.document), reviewNavigation);
    } catch (failure) {
      if (task.current === currentTask && !currentTask.signal.aborted) { setError(failure.message); setDialog("rebuild-source"); if (reviewNavigation?.rebuild) studioBridge?.rebuildProgress?.(window, "input"); }
    } finally {
      if (task.current === currentTask) { setBusy(null); task.current = null; }
    }
  };
  const cancelImport = () => {
    const returnToReviewer = hosted && (imported?.reviewNavigation?.rebuild || sourceRebuild.current?.reviewNavigation?.rebuild);
    task.current?.cancel(); task.current = null;
    sourceRebuild.current = null;
    setBusy(null); setDialog(null); setImported(null);
    if (returnToReviewer) closeHosted();
  };
  const saveSource = async (createNew, pendingImport = imported, automatic = false) => {
    if (busy && !automatic || !pendingImport || pendingImport.documentId !== live.current.document.id || pendingImport.generation !== navigation.current) return;
    const currentTask = createResumeTask(live.current.document), generation = navigation.current;
    task.current?.cancel(); task.current = currentTask;
    const isCurrent = () => task.current === currentTask && !currentTask.signal.aborted && navigation.current === generation;
    setBusy("import-save"); setError("");
    try {
      if (createNew && pendingImport.rebuildFrom && resumeNeedsSourceRebuild(pendingImport.structure)) {
        throw new Error("This source still has no recognizable sections. Choose a text-based original with section headings; no rebuilt copy was created.");
      }
      let binary = "";
      for (const byte of new Uint8Array(pendingImport.bytes))
        binary += String.fromCharCode(byte);
      const source = await api("sources", {
        method: "POST",
        signal: currentTask.signal,
        body: JSON.stringify({
          name: pendingImport.file.name,
          type: pendingImport.file.type || "text/plain",
          text: pendingImport.text,
          base64: btoa(binary),
        }),
      });
      if (!isCurrent() || !currentTask.accept(live.current.document, source)) return;
      if (createNew) {
        await persist();
        if (!isCurrent()) return;
        const next = createResume({
          name: pendingImport.rebuildFrom ? pendingImport.rebuildFrom.name + " / rebuilt" : pendingImport.file.name.replace(/\.[^.]+$/, ""),
          target: pendingImport.rebuildFrom?.target,
          sourceIds: [source.id],
          design: pendingImport.rebuildFrom ? {} : pendingImport.pages ? { pageLimit: pendingImport.pages } : {},
          model: pendingImport.structure.model,
        });
        next.importNotes = { sourcePages: pendingImport.pages, sourceId: source.id, method: pendingImport.structure.method, warnings: pendingImport.structure.warnings, unmappedGlyphs: pendingImport.unmappedGlyphs, unresolvedMarkers: pendingImport.unresolvedMarkers };
        if (pendingImport.rebuildFrom) {
          const original = pendingImport.rebuildFrom;
          next.rebuiltFrom = { id: original.id, signature: resumeSignature(original), reviewId: original.ats?.reviewId || original.rebuiltFrom?.reviewId };
          if (original.aiReview?.kind === "ats") next.aiReview = atsEditorReview(next, original.aiReview.signals || { res: original.aiReview.result, at: original.aiReview.at }, { historical: true });
        }
        if (pendingImport.reviewNavigation?.rebuild) {
          const original = pendingImport.rebuildFrom;
          const prepared = { ...structuredClone(original), model: next.model, sourceIds: [...new Set([...original.sourceIds, source.id])], importNotes: next.importNotes };
          prepared.atsChecks = resumeAtsChecks({ document: original });
          setImported(null); sourceRebuild.current = null;
          await openFeedbackRebuild(prepared);
          return;
        }
        const record = await api("resumes", {
          method: "POST",
          signal: currentTask.signal,
          body: JSON.stringify({ document: next }),
        });
        if (!isCurrent()) return;
        await refreshLibrary();
        if (!isCurrent()) return;
        install(record);
        if (pendingImport.reviewNavigation?.reviewId) setReturnToReview(true);
        focusReviewNavigation(pendingImport.reviewNavigation);
      } else {
        mutate((next) => {
          if (!next.sourceIds.includes(source.id))
            next.sourceIds.push(source.id);
        }, "Attached original source");
        await persist();
        if (!isCurrent()) return;
        await refreshLibrary();
        if (!isCurrent()) return;
      }
      setSourceId(source.id);
      openReview();
      setDialog(null);
      setImported(null);
      sourceRebuild.current = null;
      setMessage("Original bytes retained. No AI rewrite was applied.");
    } catch (failure) {
      if (isCurrent()) {
        setError(failure.message);
        if (pendingImport.reviewNavigation?.rebuild) studioBridge?.rebuildProgress?.(window, "error", failure.message);
      }
    } finally {
      if (task.current === currentTask) { setBusy(null); task.current = null; }
    }
  };

  if (!doc)
    return (
      <main className="rws-loading">
        {saveState === "loading" && <LoaderCircle className="is-spinning" />}
        <h1>Resume Studio</h1>
        <p>{error || (saveState === "saved" ? "No active resumes" : "Opening Resume Studio...")}</p>
        {saveState === "saved" && <button className="btn btn--primary" onClick={() => create()}><Plus size={16} />Create resume</button>}
        {library.filter(row => row.document.archived).map(row => <button className="btn btn--ghost" key={row.document.id} onClick={() => load(row.document.id)}>{row.document.name}</button>)}
        {hosted && <button className="btn btn--ghost" onClick={() => studioBridge?.close(window)}>Back to Studio</button>}
        {error && (
          <button className="btn" onClick={() => location.reload()}>
            Retry
          </button>
        )}
      </main>
    );
  const fields = resumeFields(doc.model),
    currentSection = doc.model.sections.find((section) => section.id === group);
  const widthScale = Math.min(1, Math.max(1, availableWidth) / pageInfo.width);
  const scale = zoom === "page" ? Math.min(widthScale, Math.max(1, availableHeight) / pageInfo.pageHeight)
    : zoom === "fit" ? widthScale : zoom;
  const fitLabel = zoom === "page" ? "Fit width" : "Fit page";
  const toggleFit = () => {
    setZoom(zoom === "page" ? "fit" : "page");
    canvas.current?.scrollTo(0, 0);
  };
  const linkedSources = sources.filter((source) =>
      doc.sourceIds.includes(source.id),
    ),
    original =
      sources.find((source) => source.id === sourceId) || linkedSources[0];
  const currentRow = library.find((row) => row.document.id === doc.id);
  const answerSources = new Set((doc.evidenceAnswers || []).map(answer => answer.sourceId));
  const originalFiles = linkedSources.filter(source => !answerSources.has(source.id));
  const visibleLibrary = library.filter(
    (row) =>
      !!row.document.archived === archived &&
      (row.document.name + " " + row.document.target.company)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const tabs = [
    ["content", List, "Document"],
    ["design", Settings2, "Design"],
  ];
  const atsReview = doc.aiReview?.kind === "ats" ? doc.aiReview : null;
  const hasAtsScore = typeof atsReview?.score === "number" && Number.isFinite(atsReview.score);
  const reviewedTarget = atsReview?.target || doc.target;
  const scoreContext = reviewedTarget.company || reviewedTarget.role;
  const reviewHeading = (
    <div className="rws-panel-heading rws-review-heading">
      <h2>Review</h2>
      <IconButton icon={X} label="Close navigation" className="rws-small-screen" onClick={() => setLibraryOpen(false)} />
    </div>
  );
  const indicator =
    saveState === "saved" ? (
      <CheckCheck size={15} />
    ) : ["error", "conflict"].includes(saveState) ? (
      <CircleAlert size={15} />
    ) : (
      <LoaderCircle size={15} className="is-spinning" />
    );
  const saveStatus = !sharedStorageFeedback && <div className={"rws-status is-" + saveState + (mode === "pdf" ? " rws-pdf-summary" : "")}>
    <span className="rws-save-status" role="status" aria-live="polite" title={saveState === "error" ? "Edits retained locally. Retry saving before leaving." : saveState === "conflict" ? "Edits retained. Compare versions before leaving." : undefined}>
      {indicator}
      <span>{saveState === "saved" ? "Saved" : saveState === "conflict" ? "Save conflict" : saveState === "error" ? "Not saved" : "Saving..."}</span>
    </span>
  </div>;
  const reviewFindings = resumeReviewFindings(doc);
  const archivedSuggestions = [...(doc.reviewDecisions || [])].sort((first, second) => second.at - first.at);
  const findingProposals = new Map(reviewFindings.map(({ index }) => [
    index, proposals.find(proposal => proposal.findingIndex === index && proposal.reviewAt === doc.aiReview?.at && !doc.dismissed?.includes(proposal.id)),
  ]));
  const contextualProposalIds = new Set([...findingProposals.values()].filter(Boolean).map(proposal => proposal.id));
  const standaloneProposals = proposals.filter(proposal => !doc.dismissed?.includes(proposal.id) && !contextualProposalIds.has(proposal.id));
  const pdfSummary = exported ? `${exported.signature === signature && exported.renderVersion === RESUME_RENDER_VERSION ? "Current" : "Historical"} PDF / v${exported.version} / ${exported.pages} pages / ${fileSize(exported.bytes)} / ${exported.verification.fields} fields verified` : "";
  const reviewSections = resumeReviewSections(reviewFindings.filter(item => !item.decision), doc.aiReview);
  const selectedReviewFinding = reviewFindings.find(item => item.index === focusedFinding);
  const reviewKeywords = doc.aiReview?.result?.keywords;
  const missingSkills = [...new Set((reviewKeywords?.missing || []).filter(term => typeof term === "string" && term.trim()))];
  const coveredSkills = [...new Set((reviewKeywords?.present || []).filter(term => typeof term === "string" && term.trim()))];
  const renderEvidenceQuestion = (question = doc.aiQuestion) => <section className="rws-evidence-question"><h4>A little more context</h4><p>{question.question}</p><p>{question.reason}</p><TextField label="Your answer" multiline value={evidenceAnswer} onChange={setEvidenceAnswer} /><button className="rws-secondary" disabled={!!busy || !evidenceAnswer.trim() || !canAnswerQuestion(question)} onClick={() => saveEvidenceAnswer(question)}><Plus size={13} />Save answer</button></section>;
  const renderSource = source => <article className="rws-source" data-source-id={source.id} key={source.id}>
    <div className="rws-source-heading"><FileText size={19} /><strong>{source.name}</strong></div>
    <small>{fileSize(source.size)} / {source.text.length.toLocaleString()} characters</small>
    <div className="rws-inline-actions">
      <button className="rws-text-button" onClick={() => { document.getElementById("resume-review-info")?.hidePopover(); setSourceId(source.id); setMode("source"); setSheetOpen(false); setLibraryOpen(false); }}>View original<ExternalLink size={13} /></button>
      <button className="rws-text-button" disabled={!!busy} onClick={() => { document.getElementById("resume-review-info")?.hidePopover(); fileInput.current.click(); }}>Reupload source<Upload size={13} /></button>
      <button className="rws-text-button" disabled={!!busy} onClick={() => rebuildOriginal(source)}>Rebuild from original<RefreshCw size={13} /></button>
      <a className="rws-text-button" href={fileHref("sources/" + source.id, true)} onClick={event => downloadOriginal(event, source)} download>Download<Download size={13} /></a>
    </div>
  </article>;
  const renderFinding = ({ finding, index, decision }, contextual = false) => {
    const criterion = doc.aiReview.breakdown.find(part => part.id === finding.criterionId);
    const prepared = doc.aiReview.actions?.[index];
    const resolution = prepared?.kind === "supported" ? prepared : doc.aiResolution?.reviewAt === doc.aiReview.at && doc.aiResolution.findingIndex === index ? doc.aiResolution : null;
    const answered = doc.evidenceAnswers?.some(answer => answer.question?.reviewAt === doc.aiReview.at && answer.question.findingIndex === index);
    const question = !answered && prepared?.kind === "question" ? prepared : doc.aiQuestion?.findingIndex === index ? doc.aiQuestion : null;
    const isAts = doc.aiReview.kind === 'ats';
    const citedFieldIds = isAts ? finding.fieldIds : criterion.evidence.map(excerpt => excerpt.fieldId);
    const proposal = findingProposals.get(index);
    const targets = resumeFindingTargets(finding, doc.aiReview, fields, proposal);
    const focusPassage = () => {
      findingContextFocus.current = true;
      if (focusedFinding !== index) setEvidenceAnswer("");
      setFocusedFinding(index);
      setSelectedField(null);
      setPreviewFieldIds(targets);
      setFindingContextOpen(true);
      setMode("edit");
      setLibraryOpen(false);
      setSheetOpen(false);
      if (!targets.length) {
        if (citedFieldIds.length) setError("The cited passage is no longer available in this resume.");
        return;
      }
      pendingFieldScroll.current = targets[0];
      setMode("edit");
      setLibraryOpen(false);
      setSheetOpen(false);
    };
    const priority = finding.priority === 'high' ? 'high' : finding.priority === 'low' ? 'low' : 'med';
    const findingStatus = decision ? "Archived / " + REVIEW_DECISION_REASONS[decision.reason] : finding.priority + " priority / " + (criterion.status === "absent" ? "not evidenced" : criterion.status);
    if (!contextual) return <section className={"rws-review-finding resume-finding resume-finding--compact" + (focusedFinding === index ? " is-active" : "")} key={index} data-review-finding={index} data-has-passage={targets.length > 0} onClick={event => {
      if (!event.target.closest("button")) focusPassage();
    }}>
      <div className="atsv__ihead"><span className={"atsv__dot atsv__dot--" + priority} aria-hidden="true" /><span className={"atsv__pri atsv__pri--" + priority}>{priority}</span>{decision && <span className="rws-finding-scope">Archived</span>}</div>
      <h4 className="atsv__point" tabIndex={-1}><button className="rws-finding-target" onClick={focusPassage}>{finding.action}</button></h4>
      <p className="atsv__how">{finding.reason || criterion.reason}</p>
      <small className="rws-finding-scope">{targets.length ? "Show passage and next step" : "Whole-resume guidance"}</small>
      {question && <p className="rws-finding-scope">Supporting fact needed</p>}
    </section>;
    return <section className="rws-review-finding resume-finding" data-context-finding={index}>
      {isAts ? <>
        <div className="atsv__ihead"><span className={"atsv__dot atsv__dot--" + priority} aria-hidden="true" /><span className={"atsv__pri atsv__pri--" + priority}>{priority}</span>{decision && <span className="rws-finding-scope">Archived</span>}</div>
        <h4 className="atsv__point" tabIndex={-1}>{finding.action}</h4>
        {(finding.reason || criterion.reason) && <p className="atsv__how">{finding.reason || criterion.reason}</p>}
        {finding.fieldIds.length !== 1 && (finding.anchor?.type === 'none' ? <p className="rws-finding-scope">Overall recommendation / no specific field targeted.</p> : <p className="rws-inline-warning">No unique field match. Choose the relevant field before editing.</p>)}
      </> : <>
        <h4 tabIndex={-1}>{criterion.label}</h4><small>{findingStatus}</small>
        <p className="rws-finding-action">{finding.action}</p>
      </>}
      {prepared?.kind === "guidance" && prepared.reason !== (finding.reason || criterion.reason) && <p>{prepared.reason}</p>}
      {resolution && <div className="rws-review-passage" data-revision-resolution={index}><h4>No revision recommended</h4><p>{resolution.reason}</p>{resolution.signature !== signature && <small>Recommendation recorded before later edits.</small>}</div>}
      {decision && <div className="rws-review-passage"><small>Author decision / {time(decision.at)}</small><p>{REVIEW_DECISION_REASONS[decision.reason]}</p>{decision.note && <p>{decision.note}</p>}{decision.evidence && <blockquote>{decision.evidence.text}</blockquote>}{decision.documentSignature !== signature && <small>Evidence recorded before later edits.</small>}</div>}
      {question && renderEvidenceQuestion(question)}
      {answered && <p role="status">Answer saved. Review again to refresh this suggestion.</p>}
      {proposal && <article className="rws-proposal" data-proposal-id={proposal.id}>
        <div className="rws-diff"><span>Current</span><p>{proposal.before}</p><span>Proposed</span><p>{proposal.after}</p></div>
        {proposal.signature !== signature && <p role="status">Document changed. Review again to refresh this suggestion.</p>}
        <div className="rws-proposal-actions">
          <button className="btn btn--ghost" disabled={!!busy} onClick={() => mutate(next => { next.dismissed = [...(next.dismissed || []), proposal.id]; }, "Kept original wording")}>Keep original</button>
          <button className="btn btn--primary" disabled={!!busy || proposal.signature !== signature} onClick={() => applyProposal(proposal)}>Apply</button>
        </div>
      </article>}
      {doc.aiReview.signature !== signature && <p className="rws-inline-warning" role="status">This review is historical. Recheck the revised document before treating this finding as resolved.</p>}
      {decision && <div className="rws-finding-actions"><button className="rws-text-button" disabled={!!busy} onClick={() => saveFindingDecision(doc.aiReview, index, { reason: "reopen" })}><Undo2 size={13} />Restore suggestion</button></div>}
    </section>;
  };
  const libraryPanel = libraryView && (
    <aside className="rws-library rws-left-panel" aria-label="Resume library">
      <div className="rws-rail-heading">
        <h2>
          {archived ? "Archived" : "My resumes"}
        </h2>
        <IconButton
          icon={Plus}
          label="Create resume"
          onClick={() => openDialog("new")}
        />
      </div>
          <label className="rws-search">
            <Search size={15} />
            <input
              type="text"
              placeholder="Find a resume"
              aria-label="Find a resume"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="rws-library-list">
            {visibleLibrary.map((row) => (
              <button
                key={row.document.id}
                className={
                  "rws-library-row " +
                  (row.document.id === doc.id ? "is-active" : "")
                }
                onClick={() => load(row.document.id)}
              >
                <FileText size={19} />
                <span>
                  <strong>{row.document.name}</strong>
                  <small>
                    {row.document.target.company || "General purpose"}
                    <span>v{row.version}</span>
                  </small>
                  <em>{shortTime(row.document.updatedAt)}</em>
                </span>
              </button>
            ))}
            {!visibleLibrary.length && (
              <p className="rws-empty">No resumes here.</p>
            )}
          </div>
          <div className="rws-library-footer">
            <button onClick={() => fileInput.current.click()}>
              <Upload size={16} />
              Import source
            </button>
            <button onClick={() => setArchived((value) => !value)}>
              <Archive size={16} />
              {archived ? "Active resumes" : "Archived resumes"}
            </button>
            <span className="rws-sample-note">{hosted ? "Private resumes" : "Fictional sample documents"}</span>
          </div>
    </aside>
  );

  const backToResumes = async () => {
    if (!returnToReview && proposalVisit) { returnToProposal(); return; }
    if (!returnToReview && mode === "source") { setMode("edit"); return; }
    if (hosted) { await closeHosted(); return; }
    const request = ++navigation.current;
    try {
      await persist();
      if (request !== navigation.current) return;
      task.current?.cancel();
      setBusy(null);
      setSearch("");
      setLibraryOpen(false);
      setSheetOpen(false);
      setLibraryView(true);
    } catch (failure) { setError(failure.message); }
  };
  const reviewContext = (
    <ReviewInfo>
      <p className="resume-review-info__label">Target role</p>
      <div className="resume-review-target">
        <div><h3>{doc.target.role || "General purpose"}</h3><p>{doc.target.company || "No company selected"}</p></div>
        <button className="btn btn--ghost rws-target" onClick={() => { document.getElementById("resume-review-info")?.hidePopover(); setTargetInput(structuredClone(doc.target)); setDialog("target"); }}>Edit role</button>
      </div>
      <details className="resume-source-options"><summary>Source options</summary>
        <section aria-label="Original files"><h4>Original files</h4>{originalFiles.map(renderSource)}
          {!originalFiles.length && <button className="rws-text-button" disabled={!!busy} onClick={() => { document.getElementById("resume-review-info")?.hidePopover(); fileInput.current.click(); }}><Upload size={14} />Upload source</button>}
        </section>
      </details>
    </ReviewInfo>
  );

  return (
    <div className="adm is-open rws" onPointerDownCapture={finishInlineEdit} data-review-panel={doc.aiRebuild && !doc.aiReview ? "closed" : "open"} data-history={historyTick} data-view={libraryView ? "library" : mode} data-resizing-inspector={resizingInspector ? "true" : undefined} data-resizing-pdf-panel={resizingPdfPanel ? "true" : undefined} data-pdf-panel={pdfPanelVisible ? "open" : "closed"} style={{ "--rws-inspector-width": `${displayedInspectorWidth}px`, "--rws-pdf-panel-width": `${displayedPdfPanelWidth}px` }}>
      {!hosted && <header className="rws-header">
        <div className="rws-brand">
          <span className="rws-monogram">RK</span>
          <span>
            Studio<span className="rws-brand-divider">/</span>
            <strong>Resume</strong>
          </span>
        </div>
        {!hosted && <span className="rws-preview-label">LOCAL PREVIEW</span>}
      </header>}
      {mode !== "pdf" && <div className="adm__workbar rws-workbar">
        <div className="studio-worknav" role="group" aria-label="Workspace navigation">
          <span className="studio-worknav__back" ref={sourceReturn}>
            <IconButton
              icon={ArrowLeft}
              className="adm__hist-btn adm__workback"
              label={returnToReview ? "Back to review" : proposalVisit ? Number.isInteger(proposalVisit.findingIndex) ? "Back to review" : "Back to suggestion" : mode === "source" ? "Back to document" : hosted ? "Back to ATS check" : "Back to resumes"}
              onClick={backToResumes}
            />
          </span>
          <div className="studio-worknav__history rws-history-controls">
            <IconButton
              icon={Undo2}
              label="Undo"
              disabled={!history.current.canUndo}
              onClick={() => undo(false)}
            />
            <IconButton
              icon={Redo2}
              label="Redo"
              disabled={!history.current.canRedo}
              onClick={() => undo(true)}
            />
          </div>
        </div>
        <div className="rws-document-heading">
        <button
          className="rws-document-name"
          onClick={() => openDialog("rename", doc.name)}
          title="Rename resume"
        >
          <span>{doc.name}</span>
          <Pencil size={13} />
        </button>
        {saveStatus}
        </div>
        <div className="rws-workbar-actions">
          <div className="rws-preview-controls">
          {mode === "edit" && <div className="adm__hm-seg rws-panel-toggle" role="tablist" aria-label="Workspace panels">
            {tabs.map(([id, Icon, label], index) => (
              <button
                key={id}
                id={"rws-panel-tab-" + id}
                role="tab"
                aria-label={label}
                title={label}
                aria-selected={pane === id}
                aria-controls="rws-panel-content"
                tabIndex={pane === id ? 0 : -1}
                className={pane === id ? "is-on" : ""}
                onClick={() => { setPane(id); setSheetOpen(true); setLibraryOpen(false); }}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                  setPane(tabs[next][0]); setSheetOpen(true); setLibraryOpen(false);
                  document.getElementById("rws-panel-tab-" + tabs[next][0])?.focus();
                }}
              >
                <Icon size={14} /><span>{label}</span>
              </button>
            ))}
          </div>}
          {hosted && mode === "edit" && <button className="adm__bar-prev" disabled={!!busy} onClick={openAtsCheck}><ScanText size={15} /><span className="adm__bar-prev-tx">ATS check</span></button>}
          <button
            className="adm__bar-prev rws-preview-pdf"
            onClick={() =>
              mode === "edit" ? renderPdf(false) : setMode("edit")
            }
            disabled={busy === "pdf"}
          >
            {busy === "pdf" ? (
              <LoaderCircle size={15} strokeWidth={1.8} className="is-spinning" />
            ) : mode === "edit" ? (
              <FileCheck2 size={15} strokeWidth={1.8} />
            ) : (
              <Pencil size={15} strokeWidth={1.8} />
            )}
            <span className="adm__bar-prev-tx">{mode === "edit" ? "Preview PDF" : "Edit resume"}</span>
          </button>
          </div>
          <ResumeOptions disabled={!!busy} actions={[
            { label: "Download PDF", icon: FileDown, action: () => renderPdf(true) },
            { label: "Rename resume", icon: TextCursorInput, action: () => openDialog("rename", doc.name) },
            { label: "Duplicate resume", icon: Copy, action: () => openDialog("duplicate", doc.name + " / copy") },
            ...(doc.aiReview?.kind === "ats" ? [{ label: "Rebuild using ATS feedback", icon: RefreshCw, action: () => openFeedbackRebuild() }] : []),
            ...(doc.aiRebuild ? [{ label: "Rebuild details", icon: Info, action: () => setDialog("rebuild-details") }] : []),
            ...(originalFiles.length === 1 ? [{ label: "Rebuild from original", icon: RefreshCw, action: () => rebuildOriginal(originalFiles[0]) }] : []),
            { label: doc.archived ? "Restore from archive" : "Archive this resume", icon: Archive, action: () => setDialog("archive") },
            { label: "View version history", icon: History, action: showVersions },
          ]} />
        </div>
      </div>}
      {mode === "pdf" && saveStatus}
      {!sharedStorageFeedback && storageIssue && (
        <div className="rk-flash is-on is-error rws-flash" role="alert" title={storageIssue}>
          <CircleAlert size={16} />
          <span>{storageMessage}</span>
          {storageActionLabel && <button className="rk-flash__action" disabled={storageBusy} onClick={() => Promise.resolve(storageAction()).catch(() => {})}>{storageActionLabel}</button>}
        </div>
      )}
      {!storageIssue && (error || message) && (
        <div
          className={"rk-flash is-on rws-flash " + (error ? "is-error" : "")}
          role={error ? "alert" : "status"}
        >
          {error ? <CircleAlert size={16} /> : <Check size={16} />}
          <span>{error || message}</span>
          {conflict && (
            <button className="rk-flash__action" onClick={() => setDialog("conflict")}>
              Compare versions
            </button>
          )}
          <IconButton
            icon={X}
            label="Dismiss message"
            onClick={() => {
              if (!conflict) setError("");
              setMessage("");
            }}
          />
        </div>
      )}
      <div
        className={
          "rws-body " +
          (mode !== "pdf" && libraryOpen ? "library-open" : "") +
          (mode !== "pdf" && sheetOpen ? " sheet-open" : "")
        }
      >
        {mode !== "pdf" && (libraryOpen || sheetOpen) && (
          <button
            className="rws-sheet-backdrop"
            aria-label="Close side panels"
            onClick={() => {
              setLibraryOpen(false);
              setSheetOpen(false);
            }}
          />
        )}
        {libraryPanel}
        {mode === "pdf" && exported && !libraryView && <aside id="rws-pdf-reading-order" className="rws-pdf-panel" aria-label="Parser reading order" hidden={!pdfPanelVisible}>
          {pdfPanelVisible && <PanelResizer label="Resize reading order panel" panelId="rws-pdf-reading-order" className="rws-pdf-panel-resizer"
            width={displayedPdfPanelWidth} preference={pdfPanelWidth} minimum={240} maximum={pdfPanelMaximum} defaultWidth={340} direction={1}
            onPreview={setPdfPanelWidth} onCommit={setPdfPanelWidth} onResizing={setResizingPdfPanel} />}
          <div className="rws-rail-heading"><h2>Parser reading order</h2></div>
          <div className="rws-reading-order">
            <p>{exported.layout?.itemCount || 0} text fragments</p>
            <p>This is a positional text reconstruction, not a Workday or other vendor acceptance test.</p>
            {exported.layout?.flags.map(flag => <p key={flag.label}>{flag.label}: {flag.note}</p>)}
            <pre>{exported.layout?.linearized || exported.extractedText}</pre>
          </div>
        </aside>}
        <main className="rws-workspace">
          {mode !== "pdf" && <div className={"rws-document-bar" + (mode === "edit" && proposalVisit?.destination !== "source" ? " is-overlay" : "")}>
            {!(proposalVisit && mode === "edit") && (!doc.aiRebuild || doc.aiReview) && <IconButton icon={ScanText} label="Review" className="rws-outline-toggle" onClick={() => { setLibraryOpen(value => !value); setSheetOpen(false); }} />}
            {mode !== "edit" && <div className="rws-canvas-tools">
              {mode === "source" && (
                <span className="rws-verified">
                  <LockKeyhole size={14} />
                  Original bytes
                </span>
              )}
            </div>}
          </div>}
          <div className="rws-document-stage">
              {mode === "pdf" && exported && <div className="resume-view-tools rws-pdf-floaties" ref={viewTools} role="group" aria-label="PDF preview" aria-describedby="rws-pdf-summary">
                <span id="rws-pdf-summary" className="rws-pdf-summary" role="status">{pdfSummary}</span>
                <IconButton icon={pdfPanelVisible ? PanelLeftClose : PanelLeftOpen} label={pdfPanelVisible ? "Hide reading order panel" : "Show reading order panel"} aria-expanded={pdfPanelVisible} aria-controls="rws-pdf-reading-order" onClick={() => setPdfPanelVisible(!pdfPanelVisible)} />
                <div className="rws-pdf-controls-host" ref={setPdfControlsHost} />
                {doc.ats && !doc.ats.layoutAccepted ? <IconButton data-pdf-separator icon={Download} label="Review migrated layout" title="Review migrated layout before downloading" onClick={() => setDialog("migration-layout")} /> : <a
                  data-pdf-separator
                  href={fileHref("resumes/" + doc.id + "/exports/" + exported.id, true)}
                  download={exported.name || true}
                  aria-label="Download this PDF"
                  title={`Download this PDF (${pdfSummary})`}
                  onClick={event => { event.preventDefault(); downloadCurrentPdf(); }}
                ><Download size={16} /></a>}
                <IconButton icon={printingPdf ? LoaderCircle : Printer} label="Print this PDF" title={printingPdf ? "Preparing PDF for printing" : "Print this PDF"} disabled={!pdfReady || printingPdf} aria-busy={printingPdf} onClick={printDisplayedPdf} />
                <IconButton icon={X} label="Close PDF preview" onClick={() => { setMode("edit"); requestAnimationFrame(() => document.querySelector('.rws-preview-pdf')?.focus()); }} />
              </div>}
              {mode === "edit" && contactEdit && <section className="resume-context rws-contact-card" ref={contactPanel} role="dialog" aria-label="Contact detail" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeContact(); } }}>
                <form onSubmit={event => { event.preventDefault(); saveContact(); }}>
                  <div className="rws-panel-heading"><h2>{contactEdit.fieldId ? "Edit detail" : "Add contact detail"}</h2><IconButton icon={X} label="Close contact detail" type="button" onClick={closeContact} /></div>
                  {!contactEdit.fieldId && <label className="rws-field"><span>Type</span><select aria-label="Contact type" value={contactEdit.kind} onChange={event => setContactEdit({ ...contactEdit, kind: event.target.value, value: "", label: "" })}><option value="email" disabled={!!doc.model.contact.email}>Email</option><option value="phone" disabled={!!doc.model.contact.phone}>Phone</option><option value="location" disabled={!!doc.model.contact.location}>Location</option><option value="link">Link</option></select></label>}
                  {contactEdit.kind === "link" && <label className="rws-field"><span>Display label</span><input value={contactEdit.label} onChange={event => setContactEdit({ ...contactEdit, label: event.target.value })} /></label>}
                  <label className="rws-field"><span>{({ email: "Email address", phone: "Phone number", location: "Location", link: "Website address", detail: "Website address" })[contactEdit.kind]}</span><input required type={contactEdit.kind === "email" ? "email" : contactEdit.kind === "phone" ? "tel" : "text"} value={contactEdit.value} onChange={event => setContactEdit({ ...contactEdit, value: event.target.value })} /></label>
                  <div className="rws-inline-actions">
                    {contactEdit.fieldId && <button className="rws-text-button" type="button" onClick={() => saveContact(true)}>Remove</button>}
                    {["link", "detail"].includes(contactEdit.kind) && /^https?:\/\//.test(resumeHref(contactEdit.value)) && <a href={resumeHref(contactEdit.value)} target="_blank" rel="noopener noreferrer">Open link</a>}
                    <button className="btn btn--ghost" type="button" onClick={closeContact}>Cancel</button><button className="btn btn--primary" type="submit">Done</button>
                  </div>
                </form>
              </section>}
              {mode === "edit" && findingContextOpen && selectedReviewFinding && <section
                className="resume-context" ref={findingContext} role="region" aria-label="Finding details" tabIndex={-1}
                onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setFindingContextOpen(false); openReview(); requestAnimationFrame(() => inspectorContent.current?.querySelector('[data-review-finding="' + focusedFinding + '"] button')?.focus()); } }}>
                <div className="resume-context__heading resume-context__tools">
                  {!selectedReviewFinding.decision && <IconButton icon={Archive} label="Archive suggestion" disabled={!!busy} onClick={() => { setError(""); setFindingDecision({ review: doc.aiReview, findingIndex: focusedFinding, reason: "evidenced", fieldId: "", note: "" }); setDialog("finding-decision"); }} />}
                  <IconButton icon={X} label="Close finding details" onClick={() => { setFindingContextOpen(false); openReview(); }} />
                </div>
                {renderFinding(selectedReviewFinding, true)}
              </section>}
              {mode === "edit" && (
                <div className="rws-canvas-tools resume-view-tools" ref={viewTools} role="group" aria-label="Document view" data-fit-mode={zoom === "page" ? "page" : zoom === "fit" ? "width" : "custom"}>
                  <span className="rws-page-count resume-view-tools__count" role="status" aria-busy={rendering}>
                    Page {Math.min(currentPage, pageInfo.pages)} / {pageInfo.pages}
                  </span>
                  <IconButton
                    icon={ZoomOut}
                    label="Zoom out"
                    onClick={() => setZoom(Math.max(0.3, scale - 0.1))}
                  />
                  <IconButton
                    icon={ZoomIn}
                    label="Zoom in"
                    onClick={() => setZoom(Math.min(1.5, scale + 0.1))}
                  />
                  <IconButton
                    icon={Maximize}
                    label={fitLabel}
                    data-view-fit
                    onClick={toggleFit}
                  />
                  <IconButton
                    className="rws-canvas-toggle"
                    icon={canvasMode === "dark" ? Sun : Moon}
                    label="Light canvas"
                    title={canvasMode === "dark" ? "Switch to light canvas" : "Switch to dark canvas"}
                    aria-pressed={canvasMode === "light"}
                    onClick={() => setCanvasMode(value => value === "dark" ? "light" : "dark")}
                  />
                </div>
              )}
          <div className="rws-canvas resume-canvas" data-canvas={canvasMode} ref={canvas}>
            {(mode === "edit" || proposalVisit?.destination === "source") && (
              <div
                className="rws-paper-footprint"
                hidden={mode !== "edit"}
                style={{
                  width: pageInfo.width * scale,
                  height: pageInfo.height * scale,
                }}
              >
                <iframe
                  ref={frame}
                  title="Editable resume canvas"
                  srcDoc={previewHtml}
                  inert={rendering ? "" : undefined}
                  onLoad={applyCanvasMode}
                  className="rws-paper"
                  style={{
                    pointerEvents: rendering ? "none" : undefined,
                    width: pageInfo.width,
                    height: pageInfo.height,
                    transform: "scale(" + scale + ")",
                  }}
                />
              </div>
            )}
            {mode === "pdf" && exported && (
              <div className="rws-pdf-view">
                <ResumePdfViewer ref={pdfViewer} onReadyChange={setPdfReady} label="Verified exported PDF" controls={false} controlsTarget={pdfControlsHost} url={fileHref("resumes/" + doc.id + "/exports/" + exported.id)} />
              </div>
            )}
            {mode === "source" && original && (
              <div className="rws-original-view">
                <div className="rws-artifact-bar">
                  <select
                    aria-label="Original source"
                    value={original.id}
                    onChange={(event) => setSourceId(event.target.value)}
                  >
                    {linkedSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                  <a
                    href={fileHref("sources/" + original.id, true)}
                    onClick={event => downloadOriginal(event, original)}
                    download
                    title="Download original file"
                  >
                    <Download size={16} />
                  </a>
                </div>
                {original.type === "application/pdf" ? (
                  <ResumePdfViewer label="Original source PDF" url={fileHref("sources/" + original.id)} />
                ) : (
                  <pre>{original.text}</pre>
                )}
              </div>
            )}
          </div>
          </div>
        </main>
        <aside className="rws-inspector" id="rws-properties" aria-label="Resume properties">
          <PanelResizer label="Resize properties panel" panelId="rws-properties" className="rws-inspector-resizer"
            width={displayedInspectorWidth} preference={inspectorWidth} minimum={290} maximum={inspectorMaximum} defaultWidth={inspectorDefault} direction={-1}
            onPreview={setInspectorWidth} onCommit={storeInspectorWidth} onResizing={setResizingInspector} />
          <div className="rws-inspector-dismiss rws-small-screen">
            <IconButton
              icon={X}
              label="Close properties"
              className="rws-small-screen"
              onClick={() => setSheetOpen(false)}
            />
          </div>
          <div className="rws-inspector-content" id="rws-panel-content" role="tabpanel" aria-labelledby={"rws-panel-tab-" + pane}>
            {pane === "content" && (
              <ResumeDocumentPanel document={doc} group={group} selectedField={selectedField} onSelect={selectDocumentField} onEditContact={openContact} onAddContact={() => openContact()} onAddSection={() => setDialog("section")} onAddItem={addItem} onRemoveSection={id => { setGroup(id); setDialog("remove-section"); }} mutate={mutate} />
            )}
            {pane === "design" && (
              <>
                <div className="rws-panel-heading">
                  <h2>Document design</h2>
                </div>
                <fieldset>
                  <legend>Typography</legend>
                  <div className="rws-typography-row">
                    <TypographyField key={doc.id + '-body'} label="Body size (pt)" min={8} max={14} dragStep={0.05} value={doc.design.bodySize ?? (doc.design.density === 'compact' ? 9.3 : doc.design.density === 'airy' ? 10.7 : 10)} onChange={value => design("bodySize", value)} />
                    <TypographyField key={doc.id + '-line'} label="Line height" min={1.15} max={1.8} value={doc.design.lineHeight ?? (doc.design.density === 'compact' ? 1.25 : 1.48)} onChange={value => design("lineHeight", value)} />
                  </div>
                  <label className="rws-field">
                    <span>Document font</span>
                    <select
                      value={doc.design.font}
                      onChange={(event) => design("font", event.target.value)}
                    >
                      {Object.entries(RESUME_FONTS).map(([id, font]) => (
                        <option key={id} value={id}>
                          {font.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>
                <fieldset>
                  <legend>Accent</legend>
                  <ResumeAccentPicker color={doc.design.accent} onChange={color => design("accent", color)} onError={setError} />
                </fieldset>
                <fieldset>
                  <legend>Layout</legend>
                  <div className="rws-layout-options">
                    {[
                      ["single", List, "Single column"],
                      ["sidebar", Columns2, "Two columns"],
                      ["hybrid", PanelsTopLeft, "Hybrid"],
                    ].map(([id, Icon, label]) => (
                      <button
                        key={id}
                        aria-pressed={doc.design.layout === id}
                        title={label}
                        onClick={() => design("layout", id)}
                      >
                        <Icon size={24} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  {doc.design.layout !== "single" && (
                    <p className="rws-inline-warning">
                      <CircleAlert size={14} />
                      Columns can mix text in ATS parsers. Check the exported reading order.
                    </p>
                  )}
                  {doc.design.layout === "hybrid" && doc.model.sections.filter(section => section.items && !['experience', 'education'].includes(section.kind)).map(section => (
                    <label className="rws-field" key={section.id}>
                      <span>{section.heading}</span>
                      <select aria-label={section.heading + " columns"} value={section.columns || 1} onChange={event => mutate(next => { next.model.sections.find(item => item.id === section.id).columns = Number(event.target.value); }, "Changed " + section.heading + " columns")}>
                        <option value={1}>One</option><option value={2}>Two</option><option value={3}>Three</option>
                      </select>
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Page</legend>
                  <label className="rws-field"><span>Page limit</span><input type="number" min="1" max="50" step="1" placeholder="No limit" value={doc.design.pageLimit ?? ''} onChange={event => { const value = Number(event.target.value); if (!event.target.value) design("pageLimit", null); else if (Number.isInteger(value) && value >= 1 && value <= 50) design("pageLimit", value); }} /></label>
                  {!!doc.importNotes?.sourcePages && <p className="rws-muted">Original document: {doc.importNotes.sourcePages} pages</p>}
                  <label className="rws-field">
                    <span>Paper size</span>
                    <select
                      aria-label="Paper size"
                      value={doc.design.size}
                      onChange={(event) => design("size", event.target.value)}
                    >
                      <option value="a4">A4 / 210 x 297 mm</option>
                      <option value="letter">US Letter / 8.5 x 11 in</option>
                    </select>
                  </label>
                  <label className="rws-field">
                    <span>Margins</span>
                    <select
                      aria-label="Margins"
                      value={doc.design.margin}
                      onChange={(event) => design("margin", event.target.value)}
                    >
                      <option value="normal">Normal / 15 mm</option>
                      <option value="narrow">Narrow / 10 mm</option>
                    </select>
                  </label>
                  <label className="rws-field">
                    <span>Density</span>
                    <select
                      aria-label="Density"
                      value={doc.design.density}
                      onChange={(event) =>
                        design("density", event.target.value)
                      }
                    >
                      <option value="airy">Airy</option>
                      <option value="normal">Normal</option>
                      <option value="compact">Compact</option>
                    </select>
                  </label>
                  <label className="rws-checkbox">
                    <input
                      type="checkbox"
                      checked={doc.design.keepWhole}
                      onChange={(event) =>
                        design("keepWhole", event.target.checked)
                      }
                    />
                    <span>Keep entries together</span>
                  </label>
                </fieldset>
                <div className="rws-page-summary">
                  <FileText size={18} />
                  <span>
                    {pageInfo.pages} {pageInfo.pages === 1 ? "page" : "pages"}
                    <small>{rendering ? "Paginating current version" : "Preview layout"}</small>
                  </span>
                </div>
                {!rendering && pageInfo.layoutError && <p className="rws-inline-warning" role="status"><CircleAlert size={14} />{pageInfo.layoutError}</p>}
              </>
            )}
          </div>
        </aside>
        <aside className="rws-review-panel rws-left-panel" aria-label="Resume review" hidden={libraryView || mode === "pdf" || leftPane !== "review" || !!doc.aiRebuild && !doc.aiReview}>
          {reviewHeading}
          <div className="rws-inspector-content" ref={inspectorContent}>
                {candidateEnabled && <button className="rws-text-button" disabled={!!busy} onClick={() => setDialog("candidate-assessment")}><ScanText size={13} />Preview candidate assessment</button>}
                <section className={"rws-assessment-section rws-ai-review" + (atsReview ? " rws-ats-review" : "")}>
                  {atsReview ? <>
                    <div className="resume-score-summary">
                      {reviewContext}
                      <div className="ats__ring resume-score-dial" style={{ "--p": hasAtsScore ? Math.max(0, Math.min(100, atsReview.score)) : 0 }} role="img" aria-label={hasAtsScore ? `ATS score ${atsReview.score} out of 100` : "ATS score unavailable"}>
                        <span aria-hidden="true">{hasAtsScore ? atsReview.score : "--"}</span>
                      </div>
                      <div className="resume-score-copy">
                        <h2>{atsReview.band || "ATS assessment"}</h2>
                        <div className="resume-score-context">{scoreContext ? `ATS + ${scoreContext} fit` : "General ATS check"}</div>
                        {atsReview.summary && <p>{atsReview.summary}</p>}
                      </div>
                    </div>
                    <div className="rws-score-actions"><button className="rws-text-button" disabled={!!busy} onClick={hosted ? openAtsCheck : openAiReview}><RefreshCw size={13} />Review again</button><button className="rws-text-button" disabled={!!busy} onClick={() => openFeedbackRebuild()}><Pencil size={13} />Rebuild using feedback</button></div>
                  </> : <><div className="rws-panel-heading"><h3><BookOpen size={17} />Resume review</h3>{reviewContext}</div><button className="rws-text-button" disabled={!!busy} onClick={hosted ? openAtsCheck : openAiReview}><RefreshCw size={13} />{doc.aiReview ? "Review again" : "Review resume"}</button></>}
                  {busy?.startsWith("ai-") && <div className="rws-inline-actions"><span role="status">Review in progress</span><button className="rws-text-button" onClick={cancelAiReview}>Cancel</button></div>}
                  {doc.aiReview ? <>
                    {doc.aiReview.signature !== signature && <p role="status" className="rws-inline-warning">Resume, target or source changed. This review is historical; review again for an updated assessment.</p>}
                    {doc.aiReview.findings.length ? <><p className="rws-review-meta">{reviewFindings.filter(item => !item.decision).length} to consider / {archivedSuggestions.length} archived</p>
                    {reviewSections.suggestions.length > 0 && <div className="resume-review-suggestions" aria-label="Suggestions">
                      {reviewSections.suggestions.map(category => <section className="resume-suggestion-group" key={category.id} data-review-category={category.id}>
                        <h3 className="resume-review-group-heading"><span>{category.suggestionLabel}</span><small>{category.items.length}</small></h3>
                        {category.items.map(item => renderFinding(item))}
                      </section>)}
                    </div>}
                    {reviewSections.assessments.length > 0 && <h3 className="resume-review-section-heading">Deeper review</h3>}
                    {reviewSections.assessments.map(category => <details className="resume-review-category" key={category.id} data-review-category={category.id} open={category.items.some(item => item.index === focusedFinding)}>
                      <summary><span>{category.label}</span><small>{category.items.length}</small></summary>
                      <p className="resume-review-category__intro">{category.detail}</p>
                      {category.items.map(item => renderFinding(item))}
                    </details>)}</> : <p>No consequential revisions identified in this review.</p>}
                    {doc.aiQuestion && !reviewFindings.some(item => item.index === doc.aiQuestion.findingIndex) && renderEvidenceQuestion()}
                    {doc.aiReview.kind !== 'ats' && <details className="resume-review-category"><summary>Deeper checks</summary>{doc.aiReview.breakdown.map(part => <section className="rws-review-passage" key={part.id}><h4>{part.label}</h4><p>{part.reason}</p></section>)}</details>}
                  </> : <p>Not yet evaluated against the target job.</p>}
                {(missingSkills.length > 0 || coveredSkills.length > 0) && <details className="resume-review-category" open data-review-keywords>
                  <summary><span>Job language</span><small>{missingSkills.length} not mentioned</small></summary>
                  <p className="resume-review-category__intro">Add a skill only when your experience supports it.</p>
                  <div className="atsv__kw">
                    {missingSkills.length > 0 && <div className="atsv__kwrow"><span className="atsv__kwlbl">Not mentioned</span>{missingSkills.map(term => <span className="atsv__chip atsv__chip--miss" key={term}>{term}</span>)}</div>}
                    {coveredSkills.length > 0 && <div className="atsv__kwrow"><span className="atsv__kwlbl">Covered</span>{coveredSkills.map(term => <span className="atsv__chip" key={term}>{term}</span>)}</div>}
                  </div>
                </details>}
                {!!doc.aiReview?.result?.checks?.length && <details className="resume-review-category"><summary>Resume essentials</summary>{doc.aiReview.result.checks.map((check, index) => <div className="rws-check-row" key={index}>{check.status === "pass" ? <Check size={14} /> : <CircleAlert size={14} />}<span><strong>{check.label}</strong><small>{check.note}</small></span></div>)}</details>}
                </section>
                {(standaloneProposals.length > 0 || (sampleTools && !doc.aiReview)) && <section className="rws-assessment-section">
                  <div className="rws-suggestions-heading">
                    <h3>Proposed changes</h3>
                    {sampleTools && <div className="rws-suggestion-tools" role="group" aria-label="Suggestion actions">
                      <button className="rws-secondary" title="Propose a revision" disabled={!doc.sourceIds.length} onClick={composeProposal}>
                        <Pencil size={14} />
                        <span>Add revision</span>
                      </button>
                      <button className="rws-secondary" title="Load fictional sample suggestions" onClick={reviewProposals}>
                        <RefreshCw size={14} />
                        <span>Load sample</span>
                      </button>
                    </div>}
                  </div>
                  {standaloneProposals.map((proposal) => (
                      <article className="rws-proposal" key={proposal.id} data-proposal-id={proposal.id}>
                        <h4 tabIndex={-1}>{proposal.title}</h4>
                        <p>{proposal.reason}</p>
                        {proposal.signature !== signature ? <p role="status">Document changed. Review a fresh suggestion.</p> : proposal.impact && <div className="rws-projection"><strong>{proposal.impact.before} to {proposal.impact.after} /100</strong><small>Measured projection, excludes PDF and AI judgment. {Math.abs(proposal.impact.wordDelta)} words {proposal.impact.wordDelta > 0 ? "added" : "removed"}.</small></div>}
                        <div className="rws-diff">
                          <span>Current</span>
                          <p>{proposal.before}</p>
                          <span>Proposed</span>
                          <p>{proposal.after}</p>
                        </div>
                        <button
                          className="rws-text-button"
                          aria-label="Edit suggested field"
                          title="Edit suggested field"
                          data-proposal-nav="field"
                          disabled={!!busy || proposal.signature !== signature || !fields.some(field => field.id === proposal.fieldId)}
                          onClick={event => visitProposal(proposal, "field", event.currentTarget)}
                        >
                          <Pencil size={13} />Edit field
                        </button>
                        <details>
                          <summary>
                            <BookOpen size={13} />
                            View context
                          </summary>
                          {proposal.evidence.map((reference, index) => {
                            const source = linkedSources.find(source => source.id === reference.sourceId);
                            const citedField = fields.find(field => field.id === reference.fieldId);
                            return <div className="rws-proposal-evidence" key={reference.sourceId + ":" + index}>
                              <button
                                className="rws-text-button"
                                aria-label={citedField ? "Open cited field: " + citedField.label : source ? "Open source: " + source.name : "Source unavailable"}
                                title={citedField ? "Open cited field" : source ? "Open original: " + source.name : "Source unavailable"}
                                data-proposal-nav={"source:" + index}
                                disabled={!!busy || (citedField ? proposal.signature !== signature : !source)}
                                onClick={event => visitProposal(proposal, citedField ? "field" : "source", event.currentTarget, reference)}
                              >
                                <ExternalLink size={13} /><span>{citedField ? "Resume / " + citedField.label : source?.name || "Source unavailable"}</span>
                              </button>
                              <blockquote>{reference.quote}</blockquote>
                            </div>;
                          })}
                        </details>
                        <div className="rws-proposal-actions">
                          <button
                            className="btn btn--ghost"
                            onClick={() =>
                              mutate((next) => {
                                next.dismissed = [
                                  ...(next.dismissed || []),
                                  proposal.id,
                                ];
                              }, "Dismissed suggestion")
                            }
                          >
                            Dismiss
                          </button>
                          <button
                            className="btn btn--primary"
                            disabled={!!busy || proposal.signature !== signature}
                            onClick={() => applyProposal(proposal)}
                          >
                            Apply
                          </button>
                        </div>
                      </article>
                    ))}
                  {!standaloneProposals.length && (
                    <p className="rws-muted">
                      No pending proposals.
                    </p>
                  )}
                </section>}
                <details className="rws-set-aside resume-review-category" data-archived-suggestions>
                  <summary><span>Archived suggestions</span><small>{archivedSuggestions.length}</small></summary>
                  {!archivedSuggestions.length && <p className="rws-muted">No archived suggestions yet.</p>}
                  {archivedSuggestions.map((decision, index) => {
                    const current = reviewFindings.find(item => item.decision === decision);
                    return current ? <div key={decision.at + "-" + index}>
                      {renderFinding(current)}
                      <button className="rws-text-button" disabled={!!busy} onClick={() => saveFindingDecision(doc.aiReview, current.index, { reason: "reopen" })}><Undo2 size={13} />Restore suggestion</button>
                    </div> : <section className="rws-review-finding resume-finding" key={decision.at + "-" + index} data-archived-review>
                      <h4>{decision.action}</h4>
                      <small>Earlier review / {time(decision.reviewAt)}</small>
                      {decision.archived?.explanation && <p>{decision.archived.explanation}</p>}
                      <p>{REVIEW_DECISION_REASONS[decision.reason]}</p>
                      {decision.note && <p>{decision.note}</p>}
                      {decision.evidence && <div className="rws-review-passage"><small>{decision.evidence.label} / evidence recorded then</small><blockquote>{decision.evidence.text}</blockquote></div>}
                      {decision.archived?.proposal && <div className="rws-diff"><span>Original</span><p>{decision.archived.proposal.before}</p><span>Proposed then</span><p>{decision.archived.proposal.after}</p></div>}
                      <button className="rws-text-button" disabled={!!busy} onClick={hosted ? openAtsCheck : openAiReview}><RefreshCw size={13} />Review current resume</button>
                    </section>;
                  })}
                </details>
          </div>
        </aside>
      </div>
      <nav className="rws-mobile-panels" aria-label="Mobile workspace panels">
        {[["review", ScanText, "Review"]].map(([id, Icon, label]) => (
          <button key={id} aria-pressed={leftPane === id && libraryOpen} onClick={() => {
            setLeftPane(id);
            setLibraryOpen(current => leftPane === id ? !current : true);
            setSheetOpen(false);
          }}><Icon size={17} /><span>{label}</span></button>
        ))}
        {tabs.map(([id, Icon, label]) => (
          <button
            key={id}
            aria-pressed={pane === id && sheetOpen}
            onClick={() => {
              setPane(id);
              setSheetOpen((current) => (pane === id ? !current : true));
              setLibraryOpen(false);
            }}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        hidden
        onChange={(event) => {
          const recovery = sourceRebuild.current;
          const rebuilding = recovery?.documentId === live.current.document.id;
          importFile(event.target.files[0], rebuilding ? structuredClone(live.current.document) : null, rebuilding ? recovery.reviewNavigation : null);
        }}
      />
      {["rename", "new", "duplicate"].includes(dialog) && (
        <Dialog
          title={
            dialog === "rename"
              ? "Rename resume"
              : dialog === "duplicate"
                ? "Duplicate for another role"
                : "New resume"
          }
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                disabled={!input.trim()}
                onClick={() => {
                  if (dialog === "rename") {
                    mutate((next) => {
                      next.name = input.trim();
                    }, "Renamed resume");
                    setDialog(null);
                  } else create(dialog === "duplicate" ? "duplicate" : "blank");
                }}
              >
                {dialog === "rename" ? "Rename" : "Create"}
              </button>
            </>
          }
        >
          <TextField
            label="Resume name"
            value={input}
            onChange={setInput}
            autoFocus
          />
        </Dialog>
      )}
      {dialog === "target" && (
        <Dialog
          wide
          title="Target role"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  mutate((next) => {
                    next.target = targetInput;
                  }, "Changed target role");
                  setDialog(null);
                }}
              >
                Save target
              </button>
            </>
          }
        >
          <div className="rws-form-pair">
            <TextField
              label="Company"
              value={targetInput.company}
              onChange={(company) =>
                setTargetInput((value) => ({ ...value, company }))
              }
            />
            <TextField
              label="Role"
              value={targetInput.role}
              onChange={(role) =>
                setTargetInput((value) => ({ ...value, role }))
              }
            />
          </div>
          <label className="rws-field">
            <span>Level</span>
            <select
              value={targetInput.level}
              onChange={(event) =>
                setTargetInput((value) => ({
                  ...value,
                  level: event.target.value,
                }))
              }
            >
              <option value="senior">Senior</option>
              <option value="staff">Staff / Principal</option>
              <option value="leader">Design leadership</option>
            </select>
          </label>
          <TextField
            label="Job description snapshot"
            value={targetInput.jd}
            multiline
            rows={12}
            onChange={(jd) => setTargetInput((value) => ({ ...value, jd }))}
          />
          <p className="rws-muted">
            Changing the target marks the current assessment as outdated.
          </p>
        </Dialog>
      )}
      {dialog === "section" && (
        <Dialog
          title="Add a section"
          onClose={() => setDialog(null)}
          actions={
            <button className="btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
          }
        >
          <div className="rws-section-picker">
            {[
              ["experience", "Experience"],
              ["skills", "Skills"],
              ["education", "Education"],
              ["text", "Projects / text"],
              ["list", "Recognition"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => addSection(id)}>
                <Plus size={16} />
                {label}
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === "remove-section" && (
        <Dialog
          title="Remove section?"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" autoFocus onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className="btn rws-danger"
                onClick={() => {
                  mutate((next) => {
                    next.model.sections = next.model.sections.filter(
                      (section) => section.id !== group,
                    );
                  }, "Removed section");
                  setGroup("Profile");
                  setDialog(null);
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <p className="pass__sub">
            {currentSection?.heading} will be removed from this version. Undo
            and saved versions retain it.
          </p>
        </Dialog>
      )}
      {dialog === "archive" && (
        <Dialog
          title={doc.archived ? "Restore resume?" : "Archive resume?"}
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" autoFocus onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={archive}>
                {doc.archived ? "Restore" : "Archive"}
              </button>
            </>
          }
        >
          <p className="pass__sub">
            {doc.name}. Its versions, sources and exports will be retained.
          </p>
        </Dialog>
      )}
      {dialog === 'migration-layout' && <Dialog wide title="Confirm migrated layout" onClose={() => setDialog(null)} actions={<><button className="btn btn--ghost" onClick={() => setDialog(null)}>Keep reviewing</button><button className="btn btn--primary" disabled={!!busy || exported?.signature !== resumeSignature(doc)} onClick={async () => {
        setBusy('migration-layout'); setError('');
        try { mutate(next => { next.ats.layoutAccepted = true; }, 'Accepted migrated PDF layout'); await persist(); setDialog(null); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(null); }
      }}>Accept reviewed layout</button></>}>
        {doc.ats.warnings.map(warning => <p key={warning}>{warning}</p>)}
        <p>The current PDF has been checked for authored text and page bounds. Original files and legacy settings remain unchanged in history.</p>
        {doc.sourceIds.length > 0 && <button className="rws-text-button" onClick={() => { setDialog(null); setMode('source'); setSourceId(doc.sourceIds[0]); }}>Compare original file</button>}
        {error && <p role="alert">{error}</p>}
      </Dialog>}
      {candidateEnabled && <ResumeCandidateReview key={doc.id} open={dialog === "candidate-assessment"} Dialog={Dialog} onClose={() => setDialog(null)}
        document={doc} version={version} sources={originalFiles} getRecord={() => live.current} connection={studioHost?.resumeAI} prepareExport={prepareCandidateExport} applyRevision={applyCandidateRevision}
        readSource={async (source, signal) => {
          if (!source || !/^[a-f0-9]{64}$/.test(source.id)) throw new Error("Select a valid attached original.");
          signal.throwIfAborted();
          let blob;
          if (hosted) blob = await hostedClient.file("sources/" + source.id, source.type, { signal });
          else {
            const response = await fetch("/__resume/sources/" + source.id, { signal });
            if (!response.ok) throw new Error("The original file could not be read.");
            blob = await response.blob();
          }
          const bytes = new Uint8Array(await blob.arrayBuffer()); signal.throwIfAborted(); return bytes;
        }} />}
      {dialog === 'ats-check' && <Dialog wide title="Re-check ATS" onClose={cancelAiReview} actions={<><button className="btn btn--ghost" onClick={cancelAiReview}>Cancel</button><button className="btn btn--primary" disabled={!!busy || !aiConsent || !aiConfiguration?.available} onClick={runHostedAssessment}>Run ATS check</button></>}>
        <p className="pass__sub">{aiConfiguration?.available ? aiConfiguration.provider + ' / ' + aiConfiguration.model : 'Configure AI in Studio before running a check.'}</p>
        <p>The current saved resume will be rendered to PDF and reviewed, with proposed revisions prepared in the same request. Supporting sources can inform revisions, not raise the current resume score. Nothing is applied automatically. Earlier reviews remain in history. This is a paid AI request using your Studio configuration.</p>
        <details><summary>Resume, target and supporting sources sent for review</summary><pre>{resumeText(doc)}</pre><pre>{doc.target.jd || doc.target.level}</pre>{linkedSources.map(source => <details key={source.id}><summary>{source.name}</summary><pre>{source.text}</pre></details>)}</details>
        <label className="chk"><input type="checkbox" checked={aiConsent} disabled={!!busy} onChange={event => setAiConsent(event.target.checked)} />Allow this resume, target and selected supporting sources to be sent for review and proposed revisions.</label>
        {busy && <p role="status">Checking current PDF...</p>}{error && <p role="alert" className="rws-inline-warning">{error}</p>}
      </Dialog>}
      {dialog === "ai-review" && <Dialog wide title="Review target requirements" onClose={cancelAiReview} actions={<>
        <button className="btn btn--ghost" onClick={cancelAiReview}>Cancel</button>
          <button className="btn btn--primary" disabled={!!busy || !aiConfiguration?.available || !aiConsent || !aiPacket || !doc.target.jd.trim()} onClick={() => runAiReview("requirements")}>Build requirements</button>
          {doc.reviewManifest && <button className="btn btn--primary" disabled={!!busy || !aiConfiguration?.available || !requirementsConsent || !aiConsent || !aiPacket} onClick={() => runAiReview("assessment")}>Approve and review</button>}
      </>}>
        <p className="pass__sub">{aiConfiguration?.available ? `${aiConfiguration.provider} / ${aiConfiguration.model}. Remaining reserved budget: $${Number(aiConfiguration.remaining ?? 0).toFixed(2)}.` : "Configure AI in Studio before reviewing."}</p>
        <p>The review also prepares proposed revisions or specific questions where facts are missing. Supporting sources inform revisions, not the current resume score. Nothing is applied automatically.</p>
        {hosted && !aiConfiguration?.available && aiConfiguration?.models && <div className="rws-form-grid"><label className="rws-field"><span>Review model</span><select aria-label="Review model" value={aiModel} onChange={event => setAiModel(event.target.value)}>{aiConfiguration.models.filter(model => Number.isFinite(model.pricing?.input) && Number.isFinite(model.pricing?.output)).map(model => <option key={model.id} value={model.id}>{model.id} / ${model.pricing.input} input, ${model.pricing.output} output per million tokens</option>)}</select></label><button className="btn btn--ghost" disabled={!aiModel || !!busy} onClick={async () => { try { setAiConfiguration(await api("ai/connect", { method: "POST", body: JSON.stringify({ model: aiModel, approved: true }) })); } catch (failure) { setError(failure.message); } }}>Authorize $1 review budget</button></div>}
        <details className="rws-reading-order"><summary>Data sent for this review</summary><h3>Target job</h3><pre>{doc.target.jd}</pre><h3>Resume evidence</h3><pre>{aiPacket?.excerpts.map(excerpt => excerpt.text).join("\n")}</pre><h3>Supporting sources for revisions</h3>{linkedSources.map(source => <details key={source.id}><summary>{source.name}</summary><pre>{source.text}</pre></details>)}</details>
        <label className="chk"><input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} />Allow these job, resume and selected source texts to be sent to this provider. Contact fields are excluded; other text may still contain personal information.</label>
        {doc.reviewManifest && <>
          <h3>Job requirements</h3>{doc.reviewManifest.requirements.map(requirement => <section className="rws-review-finding" key={requirement.id}><h4>{requirement.label}</h4><label className="rws-field"><span>Priority</span><select aria-label={"Priority: " + requirement.label} value={requirement.importance} disabled={!!busy} onChange={event => { const importance = event.target.value; change({ ...live.current.document, reviewManifest: { ...doc.reviewManifest, requirements: doc.reviewManifest.requirements.map(item => item.id === requirement.id ? { ...item, importance } : item) } }, "Corrected requirement priority", false); setRequirementsConsent(false); }}><option value="required">Required</option><option value="responsibility">Responsibility</option><option value="preferred">Preferred</option></select></label><blockquote>{requirement.quote}</blockquote></section>)}
          <details><summary>Non-scoring job context</summary>{doc.reviewManifest.segments.filter(segment => segment.disposition !== "criteria").map(segment => <p key={segment.id}>{segment.id}: {segment.disposition}. {segment.reason}</p>)}</details>
          <label className="chk"><input type="checkbox" checked={requirementsConsent} onChange={event => setRequirementsConsent(event.target.checked)} />I reviewed the requirement inventory against the job description.</label>
        </>}
        {busy && <p role="status">{busy === "ai-requirements" ? "Reading job requirements" : "Assessing resume evidence"}</p>}
        {error && <p role="alert" className="rws-inline-warning">{error}</p>}
      </Dialog>}
      {dialog === "rebuild-details" && doc.aiRebuild && <Dialog title="Rebuild details" onClose={() => setDialog(null)} actions={<button className="btn" onClick={() => setDialog(null)}>Close</button>}>
        <p>{doc.aiRebuild.summary}</p>
        <p>No new ATS check has been run by rebuilding. Choose ATS check when you want fresh results.</p>
        {(doc.importNotes?.unmappedGlyphs > 0 || doc.importNotes?.unresolvedMarkers > 0) && <p className="rws-inline-warning">The original contains unreadable characters. Their replacement markers remain in the resume; review them against your original rather than guessing.</p>}
        {doc.aiRebuild.fixes.map(fix => <section className="rws-review-finding" key={fix.id}><h4>{fix.finding}</h4><p>{fix.status.replaceAll("-", " ")}: {fix.reason}</p></section>)}
      </Dialog>}
      {!hosted && dialog === "feedback-rebuild" && <Dialog title="Rebuilding resume" onClose={cancelAiReview} actions={<>
        <button className="btn" onClick={cancelAiReview}>Cancel</button>
      </>}>
        {busy === "feedback-rebuild" && <p role="status">Rewriting the resume using all feedback. Your original is unchanged.</p>}
        {error && <p className="rws-inline-warning" role="alert">{error}</p>}
      </Dialog>}
      {dialog === "versions" && (
        <Dialog
          wide
          title="Version history"
          className={"rws-history-dialog" + (historyPreview ? " has-preview" : "")}
          headingActions={historyTab === "versions" && <div className="adm__hm-seg rws-history-toggle" role="group" aria-label="Version preview">
            <button className={historyPreview ? "is-on" : ""} aria-pressed={historyPreview} disabled={!compareVersion} onClick={() => setHistoryPreview(true)}>Preview ON</button>
            <button className={!historyPreview ? "is-on" : ""} aria-pressed={!historyPreview} onClick={() => setHistoryPreview(false)}>Preview OFF</button>
          </div>}
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Close
              </button>
              {historyTab === "versions" && <button className="btn" disabled={!compareVersion || historyPdfBusy || compareVersion.document.ats && !compareVersion.document.ats.layoutAccepted && !historyLayoutAccepted} onClick={downloadHistoryPdf}><Download size={15} />Download PDF</button>}
              {historyTab === "versions" && compareVersion && compareVersion.number !== version && (
                <button
                  className="btn btn--primary"
                  onClick={() => restoreVersion(compareVersion.number)}
                >
                  Restore v{compareVersion.number}
                </button>
              )}
            </>
          }
        >
          <div className="adm__hm-seg" role="group" aria-label="History type">
            <button className={historyTab === "versions" ? "is-on" : ""} aria-pressed={historyTab === "versions"} onClick={() => setHistoryTab("versions")}>Versions</button>
            <button className={historyTab === "ats" ? "is-on" : ""} aria-pressed={historyTab === "ats"} onClick={() => { setHistoryTab("ats"); setHistoryPreview(false); }}>ATS checks</button>
          </div>
          {historyTab === "ats" ? <div className="rws-versions-layout">
            <div className="rws-version-list">
              {!atsChecks.length && <p>No ATS checks saved for this resume.</p>}
              {atsChecks.map(check => <button key={check.id} aria-pressed={selectedCheck?.id === check.id} onClick={() => setSelectedCheck(check)}><span><strong>{check.review.score ?? "Unscored"} / {check.review.target?.company || check.review.target?.role || "General ATS check"}</strong><small>{time(check.review.at)}</small></span></button>)}
            </div>
            {selectedCheck && <section aria-label="Historical ATS check">
              <p>This check belongs to its submitted resume, not your current draft. Opening history runs no AI and changes nothing.</p>
              <h3>{selectedCheck.review.score == null ? "Unscored" : selectedCheck.review.score + " / 100"}{selectedCheck.review.band && " - " + selectedCheck.review.band}</h3>
              <p>{selectedCheck.review.summary}</p>
              {selectedCheck.review.findings.map((finding, index) => <section className="rws-review-finding" key={index}><h4>{finding.action}</h4><p>{finding.reason}</p></section>)}
              <details><summary>Checked resume and target</summary><p>{selectedCheck.input?.target?.jd || selectedCheck.review.target?.jd || "No job description."}</p>{selectedCheck.input ? <>{selectedCheck.input.kind === "document-snapshot" && <p>This is the saved document snapshot. The exact extracted PDF text was not retained for this older check.</p>}<pre className="rws-import-text">{selectedCheck.input.text}</pre></> : <p>The exact checked input is not available in this older record. No current draft is substituted.</p>}</details>
            </section>}
          </div> : <>
          <div className="rws-versions-layout">
            <div className="rws-version-sidebar">
            <div className="rws-checkpoint"><TextField label="Restore point name" value={input} onChange={setInput} /><button className="btn" disabled={!input.trim() || !!busy} onClick={async () => { setBusy("checkpoint"); try { await checkpoint(input.trim(), "manual"); setInput(""); await showVersions(); } catch (failure) { setError(failure.message); } finally { setBusy(null); } }}><Plus size={15} />Save restore point</button></div>
            <div className="rws-version-list">
              {!versions.length && <p role="status">No checkpoints yet. Export a PDF or save a restore point.</p>}
              {versions.map((entry) => (
                <button
                  className={
                    compareVersion?.number === entry.number ? "is-active" : ""
                  }
                  key={entry.number}
                  aria-pressed={compareVersion?.number === entry.number}
                  onClick={() => setCompareVersion(entry)}
                >
                  {entry.checkpoint === "export" ? <FileCheck2 size={15} /> : <History size={15} />}
                  <span>
                    <strong>
                      v{entry.number} / {entry.label}
                    </strong>
                    <small>{time(entry.at)}{entry.label !== "PDF exported" && currentRow?.exports?.some(pdf => pdf.version === entry.number) ? " / PDF exported" : ""}</small>
                  </span>
                  {entry.number === version && <Check size={14} />}
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
            </div>
            {historyPreview && <div className="rws-version-preview">
              {historyPdfBusy && <p role="status">Preparing version preview...</p>}
              {historyPdf && historyPdf.entry.version === compareVersion?.number && <ResumePdfViewer url={historyPdf.url} label={"Version " + compareVersion.number + " PDF preview"} controls={false} initialFit="page-fit" />}
            </div>}
          </div>
          <p className="rws-history-note">{compareVersion ? `Saved content and design from version ${compareVersion.number}. Your current draft is unchanged until you choose Restore.` : "Edits are autosaved without adding history checkpoints."}</p>
          {compareVersion?.document.ats && !compareVersion.document.ats.layoutAccepted && <label className="chk"><input type="checkbox" checked={historyLayoutAccepted} disabled={!historyPdf} onChange={event => setHistoryLayoutAccepted(event.target.checked)} />I have reviewed this regenerated migrated layout before downloading.</label>}
          {historyPdfError && <p role="alert" className="rws-inline-warning">{historyPdfError}</p>}
          </>}
          {error && <p role="alert" className="rws-inline-warning">{error}</p>}
        </Dialog>
      )}
      {dialog === "finding-decision" && findingDecision && <Dialog wide title="Archive suggestion" onClose={() => setDialog(null)} actions={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn--primary" disabled={!!busy || findingDecision.reason === "evidenced" && !findingDecision.fieldId} onClick={() => saveFindingDecision(findingDecision.review, findingDecision.findingIndex, findingDecision)}>Archive suggestion</button></>}>
        <p>{findingDecision.review.findings[findingDecision.findingIndex].action}</p>
        <label className="rws-field"><span id="rws-finding-reason">Reason</span><select aria-labelledby="rws-finding-reason" value={findingDecision.reason} onChange={event => setFindingDecision({ ...findingDecision, reason: event.target.value })}>{Object.entries(REVIEW_DECISION_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="rws-field"><span id="rws-finding-evidence">Existing evidence</span><select aria-labelledby="rws-finding-evidence" value={findingDecision.fieldId} onChange={event => setFindingDecision({ ...findingDecision, fieldId: event.target.value })}><option value="">Choose a passage</option>{fields.filter(field => field.id !== "name" && field.group !== "Contact" && field.value.trim()).map(field => <option key={field.id} value={field.id}>{field.label} / {field.value.slice(0, 100)}</option>)}</select></label>
        {findingDecision.fieldId && <div className="rws-review-passage"><blockquote>{fields.find(field => field.id === findingDecision.fieldId)?.value}</blockquote></div>}
        <TextField label="Decision note" multiline value={findingDecision.note} onChange={note => setFindingDecision({ ...findingDecision, note })} />
        <p className="rws-muted">Author decision only. The original AI assessment and ratings remain unchanged.</p>
        {error && <p role="alert" className="rws-inline-warning">{error}</p>}
      </Dialog>}
      {dialog === "proposal" && proposalDraft && <Dialog wide title="Propose a revision" onClose={() => setDialog(null)} actions={<><button className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn btn--primary" disabled={!proposalDraft.after.trim() || !proposalDraft.quote.trim()} onClick={previewProposal}>Review impact</button></>}>
        <label className="rws-field"><span>Target field</span><select aria-label="Target field" value={proposalDraft.fieldId} onChange={event => { const field = fields.find(field => field.id === event.target.value); setProposalDraft({ ...proposalDraft, fieldId: field.id, after: field.value }); }}>{fields.filter(field => field.label === "Achievement" || field.id === "summary" || field.id.endsWith(".text")).map(field => <option key={field.id} value={field.id}>{field.label} / {field.value.slice(0, 60) || "Empty field"}</option>)}</select></label>
        <TextField label="Proposed wording" multiline value={proposalDraft.after} onChange={after => setProposalDraft({ ...proposalDraft, after })} />
        <label className="rws-field"><span>Evidence source</span><select aria-label="Evidence source" value={proposalDraft.sourceId} onChange={event => setProposalDraft({ ...proposalDraft, sourceId: event.target.value, quote: "" })}>{sources.filter(source => doc.sourceIds.includes(source.id)).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
        <details className="rws-reading-order"><summary>Read original evidence</summary><pre>{sources.find(source => source.id === proposalDraft.sourceId)?.text}</pre></details>
        <TextField label="Exact supporting excerpt" multiline value={proposalDraft.quote} onChange={quote => setProposalDraft({ ...proposalDraft, quote })} />
        <p className="rws-muted">No changes are made until you review and apply the proposal.</p>
        {error && <p role="alert" className="rws-inline-warning">{error}</p>}
      </Dialog>}
      {dialog === "conflict" && conflict && (
        <Dialog
          wide
          title="Two versions need your decision"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Keep editing locally
              </button>
              {legacyConflict && <button className="btn btn--primary" disabled={!!busy} onClick={recoverLegacyCopies}>Recover legacy copies</button>}
              <button
                className="btn"
                disabled={legacyConflict || !!busy}
                onClick={() => {
                  try {
                    localStorage.removeItem(outboxKey(doc.id));
                  } catch {}
                  install(conflict);
                  setDialog(null);
                }}
              >
                Use server version
              </button>
              <button
                className="btn btn--primary"
                onClick={() => create("conflict")}
              >
                Keep mine as a copy
              </button>
            </>
          }
        >
          {legacyConflict && <p className="rws-inline-warning">Older ATS copies changed. Recovery creates separate variants and retains this document, its history and your unsaved edits.</p>}
          <div className="rws-conflict-columns">
            <section>
              <h3>This tab / unsaved</h3>
              <pre>{resumeText(doc)}</pre>
            </section>
            <section>
              <h3>{hosted ? "Cloudflare" : "Preview server"} / v{conflict.version}</h3>
              <pre>{resumeText(conflict.document)}</pre>
            </section>
          </div>
        </Dialog>
      )}
      {dialog === "rebuild-source" && (
        <Dialog title="Rebuild from the original source" onClose={cancelImport} actions={
          <>
            <button className="btn" onClick={cancelImport}>Cancel</button>
            <button className="btn btn--primary" disabled={!!busy} onClick={() => fileInput.current.click()}>Choose original file</button>
          </>
        }>
          <p>This saved draft contains an unstructured import. Choose its original PDF, DOCX or text file to recover the name, contacts and sections into a separate copy. Your existing draft and history stay unchanged.</p>
          {originalFiles.map(source => <button className="rws-text-button" key={source.id} disabled={!!busy} onClick={() => rebuildOriginal(source, sourceRebuild.current?.reviewNavigation)}>{source.name}<RefreshCw size={13} /></button>)}
        </Dialog>
      )}
      {dialog === "import" && imported && (
        <Dialog
          wide
          title="Review imported source"
          onClose={cancelImport}
          actions={
            <>
              <button className="btn" onClick={cancelImport}>
                Cancel
              </button>
              <button className="btn" disabled={!!busy || !!imported.rebuildFrom && resumeNeedsSourceRebuild(imported.structure)} onClick={() => saveSource(true)}>
                {imported.reviewNavigation?.rebuild ? "Continue to AI rebuild" : imported.rebuildFrom ? "Create rebuilt copy" : "Create resume from text"}
              </button>
              {!imported.rebuildFrom && <button
                className="btn btn--primary"
                disabled={!!busy}
                onClick={() => saveSource(false)}
              >
                Attach original
              </button>}
            </>
          }
        >
          <div className="rws-import-meta">
            <FileText size={24} />
            <span>
              <strong>{imported.file.name}</strong>
              <small>
                {fileSize(imported.file.size)} /{" "}
                {imported.pages ? imported.pages + " pages / " : ""}
                {imported.text.length.toLocaleString()} characters / no
                truncation
              </small>
            </span>
          </div>
          <p className="rws-muted">
            The original file stays byte-for-byte. Creating a resume imports
            editable text, not the original document's design.
          </p>
          {imported.rebuildFrom && <p>Your current resume, edits and history stay unchanged. {imported.reviewNavigation?.rebuild ? "These recovered fields become the source for the AI rebuild using all ATS feedback. No revised copy is saved until that rebuild succeeds." : "The rebuilt copy retains your target role and original review as historical guidance, with findings matched to the new fields."}</p>}
          {!imported.rebuildFrom && <p>Attaching adds a source without replacing your draft or earlier files. Existing reviews stay tied to their original inputs; review again after attaching a different file.</p>}
          {!!imported.rebuildFrom && resumeNeedsSourceRebuild(imported.structure) && <p className="rws-error" role="alert">This source still has no recognizable sections. No rebuilt copy will be created. Cancel and choose a text-based original with section headings.</p>}
          {!!imported.unmappedGlyphs && <p className="rws-error" role="alert">{imported.unmappedGlyphs} characters have no readable mapping in this PDF. They remain marked in the extracted text and need comparison with the original.</p>}
          {!!imported.unresolvedMarkers && <p className="rws-error" role="alert">{imported.unresolvedMarkers} bullet markers could not be matched to a line. Check their positions against the original.</p>}
          <section aria-label="Recognized profile">
            <p><strong>Name:</strong> {imported.structure.model.name || "Not identified"}</p>
            <p><strong>Professional title:</strong> {imported.structure.model.title || "Not identified"}</p>
            <p><strong>Email:</strong> {imported.structure.model.contact.email || "Not identified"}</p>
            <p><strong>Phone:</strong> {imported.structure.model.contact.phone || "Not identified"}</p>
          </section>
          <ul aria-label="Recognized sections">
            {imported.structure.model.sections.map(section => <li key={section.id}>{section.heading}: {section.kind}{section.items ? ' / ' + section.items.length + ' entries' : ''}</li>)}
          </ul>
          {imported.structure.warnings.map(warning => <p className="rws-muted" key={warning}>{warning}</p>)}
          <pre className="rws-import-text">{imported.text}</pre>
        </Dialog>
      )}
    </div>
  );
}

function CandidateIntake() {
  const [input, setInput] = useState(null), [error, setError] = useState('');
  const close = () => {
    try { studioBridge.close(window); }
    catch (failure) { setError(failure.message); }
  };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      try {
        if (!candidateEnabled || !studioBridge?.candidateInput) throw new Error('Open the local candidate review from ATS setup or the original review.');
        const value = structuredClone(await studioBridge.candidateInput(window, controller.signal));
        if (active) setInput(value);
      } catch (failure) { if (active) setError(failure.message); }
    })();
    return () => { active = false; controller.abort(); };
  }, []);
  if (!candidateEnabled || !studioBridge?.candidateInput) return <main role="alert">Open the local candidate review from ATS setup or the original review.</main>;
  if (error || !input) return <Dialog title="Candidate assessment" onClose={close} actions={<button className="btn btn--ghost" onClick={close}>Close</button>}>
    <p role={error ? 'alert' : 'status'}>{error || 'Opening selected file review...'}</p>
  </Dialog>;
  return <ResumeCandidateReview open Dialog={Dialog} onClose={close} target={input.target} connection={studioHost.resumeAI}
    externalInput={{ label: input.label, read: async signal => structuredClone(await studioBridge.candidateInput(window, signal, true)) }} />;
}

createRoot(document.getElementById("resume-root")).render(new URLSearchParams(location.search).has("intake") ? <CandidateIntake /> : <App />);
