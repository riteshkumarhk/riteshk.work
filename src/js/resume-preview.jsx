import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderOpen,
  History,
  Link,
  List,
  LoaderCircle,
  LockKeyhole,
  Maximize,
  Moon,
  PanelsTopLeft,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  ScanText,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
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
  applyResumeProposal,
  projectResumeProposal,
  assessResume,
  extractResumePdfText,
  structureResumeText,
} from "./resume-workspace.mjs";
import {
  renderResumeHtml,
  RESUME_FONTS,
  RESUME_RENDER_VERSION,
} from "./resume-render.mjs";
import { sampleProposals } from "./resume-sample.mjs";
import { ResumeAccentPicker } from "./resume-accent-picker.jsx";
import { ResumePdfViewer } from "./resume-pdf-viewer.jsx";
import { NumberField } from "./slide-shared-controls.jsx";
import { REVIEW_RUBRIC, REVIEW_DECISION_REASONS, reviewPacket, inventoryResumeWithAI, reviewResumeWithAI, reviseResumeWithAI, canReviseReview, decideResumeFinding, resumeReviewFindings } from "./resume-review.mjs";
import {
  applyStudioTypography,
  typographySystem,
} from "./slide-merge-typography.mjs";
import "../../css/resume-preview.css";
import { createHostedResumeClient } from "./resume-hosted.mjs";
import { atsEditorReview } from "./resume-ats.mjs";

const hosted = new URLSearchParams(location.search).has("hosted");
const studioHost = (() => {
  if (!hosted || parent === window) return null;
  try { return parent.location.origin === location.origin ? parent.__RKStudio : null; }
  catch { return null; }
})();
const studioBridge = studioHost?.resume;
const hostedClient = studioBridge ? createHostedResumeClient({ request: (path, options) => studioBridge.request(path, options, window), ai: studioHost.resumeAI }) : null;
const localKey = suffix => (hosted ? "rk:resume:" : "rk:resume-preview:") + suffix;

const api = async (path, options = {}) => {
  if (hosted) {
    if (!hostedClient) throw new Error("Open Resume Studio from the signed-in Studio.");
    return hostedClient.api(path, options);
  }
  const response = await fetch("/__resume/api/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "The preview server is unavailable."),
      { status: response.status },
    );
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
function Dialog({ title, children, actions, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement;
    ref.current.showModal();
    return () =>
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
      });
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={"rws-dialog pass " + (wide ? "pass--wide" : "")}
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

function App() {
  const [fileUrls, setFileUrls] = useState({}), retainedUrls = useRef(new Map());
  const [aiModel, setAiModel] = useState("");
  const [library, setLibrary] = useState([]),
    [sources, setSources] = useState([]),
    [doc, setDoc] = useState(null),
    [version, setVersion] = useState(1);
  const [saveState, setSaveState] = useState("loading"),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [pane, setPane] = useState("review"),
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
  const [pageInfo, setPageInfo] = useState({
      width: 794,
      height: 1123,
      pages: 1,
    }),
    [previewHtml, setPreviewHtml] = useState(""),
    [rendering, setRendering] = useState(false),
    [zoom, setZoom] = useState("fit"),
    [availableWidth, setAvailableWidth] = useState(900);
  const [historyTick, setHistoryTick] = useState(0),
    [conflict, setConflict] = useState(null);
  const [legacyConflict, setLegacyConflict] = useState(false);
  const [rail, setRail] = useState("documents");
  const [libraryView, setLibraryView] = useState(false);
  const [canvasMode, setCanvasMode] = useState(() => {
    try { return localStorage.getItem("rk:resume-preview:canvas") === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  const [proposalDraft, setProposalDraft] = useState(null);
  const [aiConfiguration, setAiConfiguration] = useState(null);
  const [aiConsent, setAiConsent] = useState(false);
  const [revisionFinding, setRevisionFinding] = useState(null);
  const [aiPacket, setAiPacket] = useState(null);
  const [requirementsConsent, setRequirementsConsent] = useState(false);
  const [evidenceAnswer, setEvidenceAnswer] = useState("");
  const [proposalVisit, setProposalVisit] = useState(null);
  const [findingDecision, setFindingDecision] = useState(null);
  const inspectorContent = useRef(null);
  const proposalReturn = useRef(null);
  const sourceReturn = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("rk:resume-preview:inspector-width");
      const width = Number(saved);
      return saved !== null && Number.isFinite(width) && width >= 290 && width <= 600 ? width : null;
    } catch { return null; }
  });
  const [resizingInspector, setResizingInspector] = useState(false);
  const inspectorDrag = useRef(null);
  const inspectorDefault = viewportWidth > 1100 ? 316 : 290;
  const inspectorMaximum = Math.max(290, Math.min(600, viewportWidth - (viewportWidth > 1100 && !libraryOpen ? 228 : 0) - 400));
  const displayedInspectorWidth = Math.max(290, Math.min(inspectorMaximum, inspectorWidth ?? inspectorDefault));
  const storeInspectorWidth = width => {
    const next = Math.max(290, Math.min(inspectorMaximum, width));
    setInspectorWidth(next);
    try { localStorage.setItem("rk:resume-preview:inspector-width", String(next)); } catch {}
  };
  const cancelInspectorResize = () => {
    if (!inspectorDrag.current) return;
    setInspectorWidth(inspectorDrag.current.preference);
    inspectorDrag.current = null;
    setResizingInspector(false);
  };
  const finishInspectorResize = (event, cancelled = false) => {
    const drag = inspectorDrag.current;
    if (!drag) return;
    if (cancelled) cancelInspectorResize();
    else {
      inspectorDrag.current = null;
      setResizingInspector(false);
      storeInspectorWidth(drag.width);
    }
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) event.currentTarget.releasePointerCapture(drag.pointerId);
  };
  useEffect(() => {
    const resize = () => { cancelInspectorResize(); setViewportWidth(window.innerWidth); };
    window.addEventListener("resize", resize);
    window.addEventListener("blur", cancelInspectorResize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", cancelInspectorResize);
    };
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
    fileInput = useRef(null),
    frame = useRef(null),
    canvas = useRef(null),
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
    setBusy(null);
    const document = structuredClone(record.document);
    live.current = {
      document,
      version: record.version,
      seq: 0,
      saved: 0,
      label: "",
    };
    history.current = createResumeHistory(document);
    setDoc(document);
    setVersion(record.version);
    setHistoryTick((value) => value + 1);
    setSaveState("saved");
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
      label = live.current.label;
    setSaveState("saving");
    const operation = (async () => {
      try {
        const record = await api("resumes/" + snapshot.id, {
          method: "PUT",
          headers: { "If-Match": String(expected) },
          body: JSON.stringify({ document: snapshot, label }),
        });
        if (live.current?.document.id === snapshot.id) {
          live.current.version = record.version;
          live.current.saved = seq;
          setVersion(record.version);
          if (live.current.seq === seq) {
            setSaveState("saved");
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
  const change = (next, label = "Edited resume", recordHistory = true) => {
    if (!live.current || next.id !== live.current.document.id) return;
    live.current.document = next;
    live.current.seq++;
    live.current.label = label;
    if (recordHistory) history.current.record(next);
    else history.current.refresh(next);
    setHistoryTick((value) => value + 1);
    setDoc(next);
    setSaveState(live.current.conflict ? "conflict" : "pending");
    try {
      localStorage.setItem(
        outboxKey(next.id),
        JSON.stringify({ document: next, version: live.current.version }),
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
  const load = async (id, initialContext = null) => {
    const generation = ++navigation.current;
    try {
      await persist();
      task.current?.cancel();
      setBusy(null);
      const context = initialContext || (hosted ? await studioBridge.initialize(window, id) : {});
      const record = await api("resumes/" + id);
      if (generation !== navigation.current) return;
      install(record);
      let pending;
      try {
        pending = JSON.parse(localStorage.getItem(outboxKey(id)));
      } catch {}
      if (pending?.document?.id === id) {
        change(pending.document, "Recovered unsaved local edits");
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
      return record;
    } catch (failure) {
      setError(failure.message);
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
        setSaveState("error");
        setError(failure.message);
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
    if (!hostedClient || !doc) return;
    let active = true;
    const source = sources.find(item => item.id === sourceId) || sources.find(item => doc.sourceIds.includes(item.id));
    const files = [];
    if (source) files.push(["sources/" + source.id, source.type === "application/pdf" ? "application/pdf" : "application/octet-stream"]);
    if (exported) files.push(["resumes/" + doc.id + "/exports/" + exported.id, "application/pdf"]);
    (async () => {
      for (const [path, type] of files) {
        if (retainedUrls.current.has(path)) continue;
        const blob = await hostedClient.file(path, type);
        if (!active) return;
        const url = URL.createObjectURL(blob); retainedUrls.current.set(path, url);
        setFileUrls(Object.fromEntries(retainedUrls.current));
      }
    })().catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [doc?.id, sourceId, sources, exported?.id]);
  useEffect(() => () => { for (const url of retainedUrls.current.values()) URL.revokeObjectURL(url); retainedUrls.current.clear(); }, []);
  const fileHref = (path, download = false) => hosted ? fileUrls[path] : (path.startsWith("sources/") ? "/__resume/" : "/__resume/api/") + path + (download ? "?download" : "");
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
    task.current?.cancel(); setBusy(null);
    try { await persist(); studioBridge.close(window); } catch (failure) { setError(failure.message); }
  };
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
  const applyCanvasMode = () => frame.current?.contentDocument?.documentElement?.style.setProperty("--resume-page-shadow", canvasMode === "light" ? "0 0 0 1px rgba(17,24,39,.04),0 1px 3px rgba(17,24,39,.05),0 18px 30px -18px rgba(17,24,39,.3)" : "0 1px 2px rgba(0,0,0,.2),0 24px 44px -20px rgba(0,0,0,.55)");
  useEffect(() => {
    try { localStorage.setItem("rk:resume-preview:canvas", canvasMode); } catch {}
    applyCanvasMode();
  }, [canvasMode, rendering, mode]);
  useEffect(() => {
    if (!doc) return;
    if (!["Profile", "Contact"].includes(group) && !doc.model.sections.some(section => section.id === group)) setGroup("Profile");
    if (selectedField && !resumeFields(doc.model).some(field => field.id === selectedField)) setSelectedField(null);
  }, [signature]);
  useEffect(() => {
    if (!doc) return;
    setRendering(true);
    const timer = setTimeout(
      () =>
        setPreviewHtml(
          renderResumeHtml(doc, {
            interactive: true,
            base: location.origin + "/",
          }),
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [signature]);
  useEffect(() => {
    const receive = (event) => {
      if (
        !event.data ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin ||
        event.data.documentId !== live.current?.document.id ||
        event.data.signature !== resumeSignature(live.current.document)
      )
        return;
      if (event.data.type === "resume-ready") {
        setPageInfo(event.data);
        setRendering(false);
      }
      if (event.data.type === "resume-error") {
        setError(event.data.message);
        setRendering(false);
      }
      if (event.data.type === "resume-field") {
        const field = resumeFields(live.current.document.model).find(
          (field) => field.id === event.data.fieldId,
        );
        if (field) {
          setPane("content");
          setRail("sections");
          setGroup(field.group);
          setSelectedField(field.id);
          setSheetOpen(true);
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!frame.current?.parentElement.hidden) setAvailableWidth(entries[0].contentRect.width);
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [!!doc]);
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
  const updateField = (fieldId, value) =>
    change(
      editResumeField(live.current.document, fieldId, value),
      "Edited " +
        (resumeFields(live.current.document.model).find(
          (field) => field.id === fieldId,
        )?.label || "text"),
    );
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
    setProposalVisit({
      documentId: doc.id, proposalId: proposal.id, findingIndex: trigger.closest("[data-review-finding]") ? proposal.findingIndex : undefined, destination,
      trigger: trigger.dataset.proposalNav, mode, group, selectedField, rail, sourceId, libraryOpen,
      inspectorTop: inspectorContent.current.scrollTop,
      canvasTop: canvas.current.scrollTop, canvasLeft: canvas.current.scrollLeft,
      evidenceOpen: trigger.closest(".rws-proposal, .rws-review-finding").querySelector("details").open,
    });
    if (destination === "source") {
      setSourceId(source.id);
      setMode("source");
      setSheetOpen(false);
    } else {
      selectGroup(field.group);
      setSelectedField(field.id);
    }
  };
  const returnToProposal = () => {
    if (!proposalVisit || proposalVisit.documentId !== live.current.document.id) return;
    proposalReturn.current = proposalVisit;
    setMode(proposalVisit.mode);
    setGroup(proposalVisit.group);
    setSelectedField(proposalVisit.selectedField);
    setRail(proposalVisit.rail);
    setSourceId(proposalVisit.sourceId);
    setLibraryOpen(proposalVisit.libraryOpen);
    setPane("review");
    setSheetOpen(true);
    setProposalVisit(null);
  };
  useLayoutEffect(() => {
    if (proposalVisit?.destination === "source") {
      sourceReturn.current?.focus({ preventScroll: true });
      canvas.current.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    const saved = proposalReturn.current;
    if (!saved || pane !== "review" || saved.documentId !== doc?.id) return;
    proposalReturn.current = null;
    const proposal = Number.isInteger(saved.findingIndex)
      ? [...inspectorContent.current.querySelectorAll("[data-review-finding]")].find(element => Number(element.dataset.reviewFinding) === saved.findingIndex)
      : [...inspectorContent.current.querySelectorAll("[data-proposal-id]")].find(element => element.dataset.proposalId === saved.proposalId);
    if (proposal) {
      proposal.querySelector("details").open = saved.evidenceOpen;
      const trigger = [...proposal.querySelectorAll("[data-proposal-nav]")].find(element => element.dataset.proposalNav === saved.trigger);
      (trigger && !trigger.disabled ? trigger : proposal.querySelector("h4"))?.focus({ preventScroll: true });
    }
    inspectorContent.current.scrollTo({ top: saved.inspectorTop, behavior: "instant" });
    canvas.current.scrollTo({ top: saved.canvasTop, left: saved.canvasLeft, behavior: "instant" });
  }, [pane, mode, proposalVisit, doc?.id]);
  const reviewProposals = () => setProposals(sampleProposals(live.current.document, sources).map(proposal => ({ ...proposal, impact: projectResumeProposal(live.current.document, proposal, sources) })));
  const openAiReview = async (findingIndex = null) => {
    if (hosted && !Number.isInteger(findingIndex)) { await openAtsCheck(); return; }
    setError(""); setAiConsent(false); setRequirementsConsent(false);
    setRevisionFinding(Number.isInteger(findingIndex) ? findingIndex : null);
    setAiPacket(null); setAiConfiguration(null);
    setDialog("ai-review");
    try { setAiPacket(reviewPacket(live.current.document)); const configuration = hosted ? await studioBridge.configuration(window) : await api("ai/config"); setAiConfiguration(configuration); setAiModel(configuration.models?.find(model => Number.isFinite(model.pricing?.input) && Number.isFinite(model.pricing?.output))?.id || ""); }
    catch (failure) { setError(failure.message); }
  };
  const cancelAiReview = () => {
    task.current?.cancel(); task.current = null;
    setBusy(null); setDialog(null); setAiConsent(false);
  };
  const runAiReview = async (stage, findingIndex) => {
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
        const result = await reviewResumeWithAI(currentTask.snapshot, { ...options, manifest: currentTask.snapshot.reviewManifest });
        if (!currentTask.accept(live.current.document, result)) return;
        change({ ...live.current.document, aiReview: result, aiQuestion: null, aiResolution: null }, "Reviewed role evidence", false);
        setDialog(null); setPane("review"); setSheetOpen(true);
      } else {
        const result = await reviseResumeWithAI(currentTask.snapshot, { ...options, review: currentTask.snapshot.aiReview, findingIndex, sources });
        if (!currentTask.accept(live.current.document, {})) return;
        if (result.kind === "question") {
          change({ ...live.current.document, aiQuestion: result, aiResolution: null }, "Recorded an evidence question", false);
          setEvidenceAnswer("");
        } else if (result.kind === "supported") {
          change({ ...live.current.document, aiResolution: result, aiQuestion: null }, "Recorded a cited no-revision recommendation", false);
        } else {
          const nextProposals = [...proposals.filter(proposal => proposal.findingIndex !== findingIndex || proposal.origin !== "ai"), result.proposal];
          setProposals(nextProposals);
          change({ ...live.current.document, proposals: nextProposals, aiQuestion: null, aiResolution: null }, "Prepared a selective revision", false);
        }
        setDialog(null); setAiConsent(false);
      }
      await persist();
    } catch (failure) { if (task.current === currentTask && !currentTask.signal.aborted) setError(failure.message); }
    finally { if (task.current === currentTask) { setBusy(null); task.current = null; } }
  };
  const saveEvidenceAnswer = async () => {
    if (busy || !evidenceAnswer.trim()) return;
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel(); task.current = currentTask;
    setBusy("evidence"); setError("");
    try {
      const text = evidenceAnswer.trim();
      const bytes = new TextEncoder().encode(text);
      const source = await api("sources", { method: "POST", signal: currentTask.signal, body: JSON.stringify({ name: "Author evidence.txt", type: "text/plain", text, base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")) }) });
      if (task.current !== currentTask || !currentTask.accept(live.current.document, source)) return;
      change({ ...live.current.document, sourceIds: [...new Set([...live.current.document.sourceIds, source.id])], evidenceAnswers: [...(live.current.document.evidenceAnswers || []), { question: currentTask.snapshot.aiQuestion, sourceId: source.id, at: Date.now() }], aiQuestion: null }, "Added author evidence");
      await persist();
      if (task.current !== currentTask || currentTask.signal.aborted) return;
      await refreshLibrary();
      if (task.current !== currentTask || currentTask.signal.aborted) return;
      setEvidenceAnswer("");
      setMessage("Evidence saved. Request a revision for the finding; the earlier review remains historical.");
    } catch (failure) { if (task.current === currentTask && !currentTask.signal.aborted) setError(failure.message); }
    finally { if (task.current === currentTask) { setBusy(null); task.current = null; } }
  };
  const saveFindingDecision = async (review, findingIndex, choice) => {
    if (busy) return;
    const documentId = live.current.document.id;
    setBusy("finding-decision"); setError("");
    try {
      change(decideResumeFinding(live.current.document, review, findingIndex, choice), choice.reason === "reopen" ? "Reopened review finding" : "Recorded author review decision");
      await persist();
      if (live.current.document.id !== documentId) return;
      setDialog(null); setFindingDecision(null);
      requestAnimationFrame(() => {
        const row = inspectorContent.current?.querySelector('[data-review-finding="' + findingIndex + '"]');
        const group = row?.closest(".rws-set-aside"); if (group) group.open = true;
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
      setPane("review"); setSheetOpen(true); setDialog(null); setError("");
    } catch (failure) { setError(failure.message); }
  };
  const checkpoint = async label => {
    await persist();
    change(structuredClone(live.current.document), label, false);
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
      setMessage("Applied the reviewed change. The preceding version is saved in history.");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };
  const openAtsCheck = async () => {
    setAiConsent(false); setError(''); setAiConfiguration(null); setDialog('ats-check');
    try { setAiConfiguration(await studioBridge.configuration(window)); }
    catch (failure) { setError(failure.message); }
  };
  const runHostedAssessment = async () => {
    if (busy || !aiConsent || !aiConfiguration?.available) return;
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel(); task.current = currentTask;
    setBusy('ats-check'); setError('');
    try {
      await persist();
      if (task.current !== currentTask || !currentTask.accept(live.current.document, {})) return;
      const artifact = await api('resumes/' + currentTask.snapshot.id + '/export', { method: 'POST', headers: { 'If-Match': String(live.current.version) }, body: '{}', signal: currentTask.signal });
      if (!currentTask.accept(live.current.document, artifact)) return;
      setExported(artifact);
      const result = await studioBridge.assess(currentTask.snapshot, artifact.id, window, currentTask.signal);
      if (!currentTask.accept(live.current.document, result)) return;
      const assessment = assessResume(currentTask.snapshot, { pages: artifact.pages, complete: true, fields: artifact.verification.fields, extractedText: artifact.extractedText, layout: artifact.layout, renderVersion: artifact.renderVersion });
      const aiReview = { ...atsEditorReview(currentTask.snapshot, result), provider: result.provider, model: result.model };
      change({ ...live.current.document, assessment, aiReview, aiQuestion: null, aiResolution: null }, 'ATS checked current PDF', false);
      await persist();
      if (task.current !== currentTask || currentTask.signal.aborted) return;
      setDialog(null); setPane('review'); setSheetOpen(true); setMessage('ATS check saved for this resume and target.');
    } catch (failure) { if (task.current === currentTask && !currentTask.signal.aborted) setError(failure.message); }
    finally { if (task.current === currentTask) { task.current = null; setBusy(null); } }
  };
  const runAssessment = async () => {
    if (hosted) { await openAtsCheck(); return; }
    const currentTask = createResumeTask(live.current.document);
    task.current?.cancel();
    task.current = currentTask;
    const result = await Promise.resolve(
      assessResume(
        currentTask.snapshot,
        exported?.signature === currentTask.signature && exported.renderVersion === RESUME_RENDER_VERSION
          ? {
              pages: exported.pages,
              complete: exported.verification.complete,
              fields: exported.verification.fields,
              extractedText: exported.extractedText,
              layout: exported.layout,
              renderVersion: exported.renderVersion,
            }
          : null,
      ),
    );
    const accepted = currentTask.accept(live.current.document, result);
    if (accepted) {
      change(
        { ...live.current.document, assessment: accepted },
        "Assessed current version",
        false,
      );
      setMessage("Local checks updated for this version.");
    }
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
      if (previewReady?.signature === currentTask.signature && previewReady.layoutError) throw new Error(previewReady.layoutError);
      const result = await api(
        "resumes/" + currentTask.snapshot.id + "/export",
        {
          method: "POST",
          headers: { "If-Match": String(live.current.version), ...(hosted && frame.current?.contentWindow?.resumeReady?.signature === currentTask.signature ? { "X-Resume-Pages": String(pageInfo.pages) } : {}) },
          body: "{}",
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
        const anchor = document.createElement("a");
        const path = "resumes/" + currentTask.snapshot.id + "/exports/" + result.id;
        const temporary = hosted ? URL.createObjectURL(await hostedClient.file(path, "application/pdf")) : null;
        anchor.href = temporary || fileHref(path, true);
        anchor.download = result.name;
        anchor.click();
        if (temporary) setTimeout(() => URL.revokeObjectURL(temporary), 60000);
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
      setVersions([...record.versions].reverse());
      setCompareVersion(null);
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
      install(record);
      await refreshLibrary();
      setDialog(null);
      setMessage("Restored version " + number + " as a new version.");
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
  const moveSection = (direction) =>
    mutate((next) => {
      const index = next.model.sections.findIndex(
          (section) => section.id === group,
        ),
        target = index + direction;
      if (target < 0 || target >= next.model.sections.length) return;
      const [section] = next.model.sections.splice(index, 1);
      next.model.sections.splice(target, 0, section);
    }, "Reordered section");
  const selectGroup = (id) => {
    setGroup(id);
    setSelectedField(null);
    setPane("content");
    setRail("sections");
    setLibraryOpen(false);
    setSheetOpen(true);
    setMode("edit");
  };
  const moveEntry = (sectionId, entryId, direction) =>
    mutate((next) => {
      const section = next.model.sections.find((item) => item.id === sectionId),
        entries = section.groups || section.items;
      const index = entries.findIndex((item) => item.id === entryId),
        target = index + direction;
      if (index < 0 || target < 0 || target >= entries.length) return;
      const [entry] = entries.splice(index, 1);
      entries.splice(target, 0, entry);
    }, "Reordered entry");
  const removeEntry = (sectionId, entryId) => {
    mutate((next) => {
      const section = next.model.sections.find((item) => item.id === sectionId),
        key = section.groups ? "groups" : "items";
      section[key] = section[key].filter((item) => item.id !== entryId);
    }, "Removed entry");
    setSelectedField(null);
  };
  const importFile = async (file) => {
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
        const pdfjs = await import("pdfjs-dist");
        if (!isCurrent()) return;
        pdfjs.GlobalWorkerOptions.workerSrc =
          "/studio/resume-preview/assets/pdf.worker.mjs";
        const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
        try {
          pages = pdf.numPages;
          const lines = [];
          for (let number = 1; number <= pages; number++) {
            if (!isCurrent()) return;
            const extracted = extractResumePdfText(await (await pdf.getPage(number)).getTextContent());
            lines.push(extracted.text);
            unmappedGlyphs += extracted.unmappedGlyphs;
            unresolvedMarkers += extracted.unresolvedMarkers;
          }
          text = lines.join("\n\n");
        } finally { await pdf.destroy(); }
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
      setImported({ file, bytes, text, pages, unmappedGlyphs, unresolvedMarkers, structure: structureResumeText(text), documentId: currentTask.snapshot.id, generation });
      setDialog("import");
    } catch (failure) {
      if (isCurrent()) setError(failure.message);
    } finally {
      if (task.current === currentTask) {
        setBusy(null); task.current = null;
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  };
  const cancelImport = () => {
    task.current?.cancel(); task.current = null;
    setBusy(null); setDialog(null); setImported(null);
  };
  const saveSource = async (createNew) => {
    if (busy || !imported || imported.documentId !== live.current.document.id || imported.generation !== navigation.current) return;
    const pendingImport = imported, currentTask = createResumeTask(live.current.document), generation = navigation.current;
    task.current?.cancel(); task.current = currentTask;
    const isCurrent = () => task.current === currentTask && !currentTask.signal.aborted && navigation.current === generation;
    setBusy("import-save"); setError("");
    try {
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
          name: pendingImport.file.name.replace(/\.[^.]+$/, ""),
          sourceIds: [source.id],
          design: pendingImport.pages ? { pageLimit: pendingImport.pages } : {},
          model: pendingImport.structure.model,
        });
        next.importNotes = { sourcePages: pendingImport.pages, sourceId: source.id, method: pendingImport.structure.method, warnings: pendingImport.structure.warnings };
        const record = await api("resumes", {
          method: "POST",
          signal: currentTask.signal,
          body: JSON.stringify({ document: next }),
        });
        if (!isCurrent()) return;
        await refreshLibrary();
        if (!isCurrent()) return;
        install(record);
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
      setPane("sources");
      setDialog(null);
      setImported(null);
      setMessage("Original bytes retained. No AI rewrite was applied.");
    } catch (failure) {
      if (isCurrent()) setError(failure.message);
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
    currentSection = doc.model.sections.find((section) => section.id === group),
    assessment = doc.assessment,
    fresh = assessment?.methodVersion === 1 && assessment.signature === signature && (!assessment.pdf || assessment.pdf.renderVersion === RESUME_RENDER_VERSION);
  const scale =
    zoom === "fit"
      ? Math.max(0.25, Math.min(1, (availableWidth - 48) / pageInfo.width))
      : zoom;
  const linkedSources = sources.filter((source) =>
      doc.sourceIds.includes(source.id),
    ),
    original =
      sources.find((source) => source.id === sourceId) || linkedSources[0];
  const currentRow = library.find((row) => row.document.id === doc.id);
  const answerSources = new Set((doc.evidenceAnswers || []).map(answer => answer.sourceId));
  const originalFiles = linkedSources.filter(source => !answerSources.has(source.id));
  const revisionEvidence = linkedSources.filter(source => answerSources.has(source.id));
  const availableSources = sources.filter(source => !doc.sourceIds.includes(source.id));
  const visibleLibrary = library.filter(
    (row) =>
      !!row.document.archived === archived &&
      (row.document.name + " " + row.document.target.company)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const tabs = [
    ["content", List, "Content"],
    ["design", Settings2, "Design"],
    ["review", ScanText, "Review"],
    ["sources", BookOpen, "Sources"],
  ];
  const indicator =
    saveState === "saved" ? (
      <CheckCheck size={15} />
    ) : ["error", "conflict"].includes(saveState) ? (
      <CircleAlert size={15} />
    ) : (
      <LoaderCircle size={15} className="is-spinning" />
    );
  const fieldInput = (field) => (
    <TextField
      key={field.id}
      label={field.label}
      value={field.value}
      onChange={(value) => updateField(field.id, value)}
      multiline={
        ["summary", "Achievement"].includes(
          field.id === "summary" ? field.id : field.label,
        ) ||
        field.id.endsWith(".text") ||
        field.key === "items"
      }
      selected={selectedField === field.id}
      data-field-input={field.id}
    />
  );
  const entryFields = (entry) =>
    fields.filter(
      (field) => field.owner === entry || entry.bullets?.includes(field.owner),
    );
  const reviewFindings = resumeReviewFindings(doc);
  const renderSource = source => <article className="rws-source" data-source-id={source.id} key={source.id}>
    <div className="rws-source-heading"><FileText size={19} /><strong>{source.name}</strong><input type="checkbox" aria-label={"Use evidence from " + source.name} checked={doc.sourceIds.includes(source.id)} onChange={event => {
      const checked = event.target.checked;
      mutate(next => { next.sourceIds = checked ? [...new Set([...next.sourceIds, source.id])] : next.sourceIds.filter(id => id !== source.id); }, "Changed evidence selection");
      requestAnimationFrame(() => {
        const checkbox = inspectorContent.current?.querySelector('[data-source-id="' + source.id + '"] input');
        const library = checkbox?.closest('.rws-available-sources'); if (library) library.open = true;
        checkbox?.focus();
      });
    }} /></div>
    <small>{fileSize(source.size)} / {source.text.length.toLocaleString()} characters</small>
    <div className="rws-inline-actions">
      <button className="rws-text-button" onClick={() => { setSourceId(source.id); setMode("source"); setSheetOpen(false); }}>View original<ExternalLink size={13} /></button>
      <a className="rws-text-button" href={fileHref("sources/" + source.id, true)} onClick={event => downloadOriginal(event, source)} download>Download<Download size={13} /></a>
    </div>
    <details className="rws-source-provenance"><summary>Provenance</summary>
      <p>{answerSources.has(source.id) ? "Author statement" : "Original uploaded file"} / {time(source.at)}</p>
      <span className="rws-hash" title={source.sha256}>SHA-256 {source.sha256}</span>
      {(doc.evidenceAnswers || []).filter(answer => answer.sourceId === source.id).map((answer, index) => <p key={index}>{answer.question?.question}</p>)}
    </details>
  </article>;
  const renderFinding = ({ finding, index, decision }) => {
    const criterion = doc.aiReview.breakdown.find(part => part.id === finding.criterionId);
    const requirement = doc.aiReview.manifest?.requirements.find(item => item.id === finding.criterionId);
    const resolution = doc.aiResolution?.reviewAt === doc.aiReview.at && doc.aiResolution.findingIndex === index ? doc.aiResolution : null;
    return <section className="rws-review-finding" key={index} data-review-finding={index}>
      <h4 tabIndex={-1}>{criterion.label}</h4><small>{decision ? "Set aside / " + REVIEW_DECISION_REASONS[decision.reason] : finding.priority + " priority / " + (criterion.status === "absent" ? "not evidenced" : criterion.status)}</small>
      <p className="rws-finding-action">{finding.action}</p>
      {doc.aiReview.kind === 'ats' && <>{finding.fieldIds.length === 1 ? <button className="rws-text-button" onClick={event => visitProposal({ id: 'finding-' + index, findingIndex: index, signature, fieldId: finding.fieldIds[0] }, 'field', event.currentTarget)}><Pencil size={13} />Edit affected field</button> : <p className="rws-inline-warning">No unique field match. Choose the relevant field before editing.</p>}{finding.replacement && <details><summary>Earlier suggested wording / not applied</summary><p>{finding.replacement}</p></details>}</>}
      <details className="rws-finding-context">
        <summary>Rationale and evidence</summary>
        {requirement && <div className="rws-review-passage"><small>Job requirement</small><blockquote>{requirement.quote}</blockquote></div>}
        <p>{criterion.reason}</p>
        {criterion.evidence.map(excerpt => {
          const field = fields.find(field => field.id === excerpt.fieldId);
          return <div className="rws-review-passage" key={excerpt.id}>
            {excerpt.context?.entry && <small>{excerpt.context.entry}{excerpt.context.organization ? " / " + excerpt.context.organization : ""}</small>}
            <blockquote>{excerpt.text}</blockquote>
            <button className="rws-text-button" data-proposal-nav={"finding:" + excerpt.id} disabled={!field} title={field ? "Open " + field.label : "Cited field is no longer available"} onClick={event => visitProposal({ id: "finding-" + index, findingIndex: index, signature, fieldId: excerpt.fieldId }, "field", event.currentTarget)}><Pencil size={13} />Open cited field</button>
          </div>;
        })}
      </details>
      {resolution && <div className="rws-review-passage" data-revision-resolution={index}><h4>No revision recommended</h4><small>AI follow-up / verify evidence</small><p>{resolution.reason}</p>{resolution.evidence.map(reference => <blockquote key={reference.fieldId}>{reference.quote}</blockquote>)}{resolution.signature !== signature && <small>Recommendation recorded before later edits.</small>}</div>}
      {decision && <div className="rws-review-passage"><small>Author decision / {time(decision.at)}</small>{decision.note && <p>{decision.note}</p>}{decision.evidence && <blockquote>{decision.evidence.text}</blockquote>}{decision.documentSignature !== signature && <small>Evidence recorded before later edits.</small>}</div>}
      <div className="rws-finding-actions">
        {decision ? <button className="rws-text-button" disabled={!!busy} onClick={() => saveFindingDecision(doc.aiReview, index, { reason: "reopen" })}><Undo2 size={13} />Reopen finding</button> : <>
          <button className="rws-secondary" disabled={!!busy || !canReviseReview(doc, doc.aiReview)} title={!canReviseReview(doc, doc.aiReview) ? "Review the current document before preparing a revision" : "Prepare an evidence-backed revision"} onClick={() => openAiReview(index)}><Pencil size={13} />Prepare revision</button>
          <button className="rws-text-button" disabled={!!busy} onClick={() => { setError(""); setFindingDecision({ review: doc.aiReview, findingIndex: index, reason: "evidenced", fieldId: "", note: "" }); setDialog("finding-decision"); }}><Archive size={13} />Set aside</button>
        </>}
      </div>
    </section>;
  };
  const renderFields = (list) =>
    list.map((field) => (
      <React.Fragment key={field.id}>
        {fieldInput(field)}
        {field.label === "Achievement" && (
          <div className="rws-inline-actions">
            <IconButton
              icon={ArrowUp}
              label="Move achievement up"
              disabled={
                currentSection?.items.find((item) =>
                  item.bullets?.some((bullet) => bullet.id === field.id),
                )?.bullets[0]?.id === field.id
              }
              onClick={() =>
                mutate((next) => {
                  for (const section of next.model.sections)
                    for (const item of section.items || []) {
                      const index = item.bullets?.findIndex(
                        (bullet) => bullet.id === field.id,
                      );
                      if (index > 0)
                        [item.bullets[index - 1], item.bullets[index]] = [
                          item.bullets[index],
                          item.bullets[index - 1],
                        ];
                    }
                }, "Reordered achievement")
              }
            />
            <IconButton
              icon={ArrowDown}
              label="Move achievement down"
              disabled={
                currentSection?.items
                  .find((item) =>
                    item.bullets?.some((bullet) => bullet.id === field.id),
                  )
                  ?.bullets.at(-1)?.id === field.id
              }
              onClick={() =>
                mutate((next) => {
                  for (const section of next.model.sections)
                    for (const item of section.items || []) {
                      const index = item.bullets?.findIndex(
                        (bullet) => bullet.id === field.id,
                      );
                      if (index >= 0 && index < item.bullets.length - 1)
                        [item.bullets[index + 1], item.bullets[index]] = [
                          item.bullets[index],
                          item.bullets[index + 1],
                        ];
                    }
                }, "Reordered achievement")
              }
            />
            <IconButton
              icon={Trash2}
              label="Remove achievement"
              onClick={() => {
                mutate((next) => {
                  for (const section of next.model.sections)
                    for (const item of section.items || [])
                      if (item.bullets)
                        item.bullets = item.bullets.filter(
                          (bullet) => bullet.id !== field.id,
                        );
                }, "Removed achievement");
                setSelectedField(null);
              }}
            />
          </div>
        )}
      </React.Fragment>
    ));
  const libraryPanel = (
    <aside className="rws-library" aria-label="Resume library">
      <div
        className="rws-rail-tabs"
        role="tablist"
        aria-label="Resume navigation"
      >
        <button
          role="tab"
          aria-selected={rail === "documents"}
          onClick={() => setRail("documents")}
        >
          <FolderOpen size={15} />
          Resumes
        </button>
        <button
          role="tab"
          aria-selected={rail === "sections"}
          onClick={() => setRail("sections")}
        >
          <List size={15} />
          Sections
        </button>
        <IconButton
          icon={X}
          label="Close library"
          className="rws-small-screen"
          onClick={() => setLibraryOpen(false)}
        />
      </div>
      <div className="rws-rail-heading">
        <h2>
          {rail === "sections"
            ? "Document outline"
            : archived
              ? "Archived"
              : "My resumes"}
        </h2>
        <IconButton
          icon={Plus}
          label={rail === "sections" ? "Add a section" : "Create resume"}
          onClick={() =>
            rail === "sections" ? setDialog("section") : openDialog("new")
          }
        />
      </div>
      {rail === "documents" ? (
        <>
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
        </>
      ) : (
        <nav className="rws-outline" aria-label="Resume sections">
          {[
            { id: "Profile", heading: "Profile" },
            { id: "Contact", heading: "Contact" },
            ...doc.model.sections,
          ].map((section) => (
            <button
              key={section.id}
              aria-current={group === section.id ? "true" : undefined}
              onClick={() => selectGroup(section.id)}
            >
              <FileText size={16} />
              <span>{section.heading || "Untitled section"}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
      )}
    </aside>
  );

  const backToResumes = async () => {
    if (hosted) { await closeHosted(); return; }
    const request = ++navigation.current;
    try {
      await persist();
      if (request !== navigation.current) return;
      task.current?.cancel();
      setBusy(null);
      setRail("documents");
      setSearch("");
      setLibraryOpen(false);
      setSheetOpen(false);
      setLibraryView(true);
    } catch (failure) { setError(failure.message); }
  };

  return (
    <div className="adm is-open rws" data-history={historyTick} data-view={libraryView ? "library" : mode} data-resizing-inspector={resizingInspector ? "true" : undefined} style={{ "--rws-inspector-width": `${displayedInspectorWidth}px` }}>
      <header className="rws-header">
        <div className="rws-brand">
          <span className="rws-monogram">RK</span>
          <span>
            Studio<span className="rws-brand-divider">/</span>
            <strong>Resume</strong>
          </span>
        </div>
        {!hosted && <span className="rws-preview-label">LOCAL PREVIEW</span>}
        <div className="rws-header-actions">
          <span className="rws-private">
            <LockKeyhole size={14} />
            {hosted ? "Private" : "Private sample"}
          </span>
          <IconButton
            icon={FolderOpen}
            label="Resume library"
            onClick={() => setLibraryOpen((value) => !value)}
          />
          {hosted && <IconButton icon={X} label="Back to Studio" onClick={closeHosted} />}
        </div>
      </header>
      <div className="adm__workbar rws-workbar">
        <IconButton
          icon={ArrowLeft}
          label={hosted ? "Back to ATS check" : "Back to resumes"}
          onClick={backToResumes}
        />
        <div className="rws-history-controls">
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
        <button
          className="rws-document-name"
          onClick={() => openDialog("rename", doc.name)}
          title="Rename resume"
        >
          <span>{doc.name}</span>
          <Pencil size={13} />
        </button>
        <div className="rws-workbar-actions">
          <IconButton
            icon={Copy}
            label="Duplicate for another role"
            onClick={() => openDialog("duplicate", doc.name + " / copy")}
          />
          <IconButton
            icon={History}
            label="Version history"
            onClick={showVersions}
          />
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
          <IconButton
            icon={Download}
            label="Export PDF"
            className="rws-download"
            onClick={() => renderPdf(true)}
            disabled={!!busy}
          />
        </div>
      </div>
      {(error || message) && (
        <div
          className={"rk-flash is-on rws-flash " + (error ? "is-error" : "")}
          role={error ? "alert" : "status"}
        >
          {error ? <CircleAlert size={16} /> : <Check size={16} />}
          <span>{error || message}</span>
          {conflict && (
            <button onClick={() => setDialog("conflict")}>
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
          (libraryOpen ? "library-open" : "") +
          (sheetOpen ? " sheet-open" : "")
        }
      >
        {(libraryOpen || sheetOpen) && (
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
        <main className="rws-workspace">
          <div className="rws-document-bar">
            {proposalVisit?.destination === "source" ? (
              <button ref={sourceReturn} className="rws-text-button rws-proposal-return" onClick={returnToProposal}>
                <ArrowLeft size={14} />{Number.isInteger(proposalVisit.findingIndex) ? "Back to review" : "Back to suggestion"}
              </button>
            ) : <div
              className="rws-view-tabs"
              role="tablist"
              aria-label="Document view"
            >
              <button
                role="tab"
                aria-selected={mode === "edit"}
                onClick={() => setMode("edit")}
              >
                Canvas
              </button>
              <button
                role="tab"
                aria-selected={mode === "source"}
                disabled={!original}
                onClick={() => setMode("source")}
              >
                Original
              </button>
              <button
                role="tab"
                aria-selected={mode === "pdf"}
                disabled={!exported}
                onClick={() => setMode("pdf")}
              >
                PDF
              </button>
            </div>}
            <div className="rws-canvas-tools">
              {mode === "edit" && (
                <>
                  <span className="rws-page-count">
                    {rendering ? (
                      <LoaderCircle size={12} className="is-spinning" />
                    ) : (
                      <FileText size={12} />
                    )}
                    {pageInfo.pages} {pageInfo.pages === 1 ? "page" : "pages"}
                  </span>
                  <IconButton
                    icon={ZoomOut}
                    label="Zoom out"
                    onClick={() => setZoom(Math.max(0.3, scale - 0.1))}
                  />
                  <button
                    className="rws-zoom-value"
                    onClick={() => setZoom("fit")}
                    title="Fit page width"
                  >
                    {zoom === "fit" ? "Fit" : Math.round(scale * 100) + "%"}
                  </button>
                  <IconButton
                    icon={ZoomIn}
                    label="Zoom in"
                    onClick={() => setZoom(Math.min(1.5, scale + 0.1))}
                  />
                  <IconButton
                    icon={Maximize}
                    label="Fit page width"
                    onClick={() => setZoom("fit")}
                  />
                  <IconButton
                    className="rws-canvas-toggle"
                    icon={canvasMode === "dark" ? Sun : Moon}
                    label="Light canvas"
                    title={canvasMode === "dark" ? "Switch to light canvas" : "Switch to dark canvas"}
                    aria-pressed={canvasMode === "light"}
                    onClick={() => setCanvasMode(value => value === "dark" ? "light" : "dark")}
                  />
                </>
              )}
              {mode === "pdf" && exported && (
                <span className="rws-verified">
                  <ShieldCheck size={14} />
                  {exported.signature === signature && exported.renderVersion === RESUME_RENDER_VERSION ? "Current PDF" : "Historical PDF"} / v{exported.version}
                </span>
              )}
              {mode === "source" && (
                <span className="rws-verified">
                  <LockKeyhole size={14} />
                  Original bytes
                </span>
              )}
            </div>
          </div>
          <div className="rws-canvas" data-canvas={canvasMode} ref={canvas}>
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
                  onLoad={applyCanvasMode}
                  className="rws-paper"
                  style={{
                    width: pageInfo.width,
                    height: pageInfo.height,
                    transform: "scale(" + scale + ")",
                  }}
                />
              </div>
            )}
            {mode === "pdf" && exported && (
              <div className="rws-pdf-view">
                <div className="rws-artifact-bar">
                  <span>
                    {exported.pages} pages / {fileSize(exported.bytes)} /{" "}
                    {exported.verification.fields} fields verified
                  </span>
                  {doc.ats && !doc.ats.layoutAccepted ? <button className="rws-text-button" onClick={() => setDialog('migration-layout')}><FileCheck2 size={15} />Review migrated layout</button> : <a
                    href={fileHref("resumes/" + doc.id + "/exports/" + exported.id, true)}
                    download
                  >
                    <Download size={15} />
                    Download this PDF
                  </a>}
                </div>
                <ResumePdfViewer label="Verified exported PDF" url={fileHref("resumes/" + doc.id + "/exports/" + exported.id)} />
                <details className="rws-reading-order">
                  <summary>Parser reading order / {exported.layout?.itemCount || 0} text fragments</summary>
                  <p>This is a positional text reconstruction, not a Workday or other vendor acceptance test.</p>
                  {exported.layout?.flags.map(flag => <p key={flag.label}>{flag.label}: {flag.note}</p>)}
                  <pre>{exported.layout?.linearized || exported.extractedText}</pre>
                </details>
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
        </main>
        <aside className="rws-inspector" id="rws-properties" aria-label="Resume properties">
          <div
            className="rws-inspector-resizer"
            role="separator"
            aria-label="Resize properties panel"
            aria-orientation="vertical"
            aria-controls="rws-properties"
            aria-valuemin={290}
            aria-valuemax={inspectorMaximum}
            aria-valuenow={displayedInspectorWidth}
            aria-valuetext={`${displayedInspectorWidth} pixels`}
            tabIndex={0}
            title="Resize properties panel"
            onPointerDown={event => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              inspectorDrag.current = { x: event.clientX, initial: displayedInspectorWidth, width: displayedInspectorWidth, preference: inspectorWidth, pointerId: event.pointerId };
              setResizingInspector(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const drag = inspectorDrag.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              drag.width = Math.round(Math.max(290, Math.min(inspectorMaximum, drag.initial + drag.x - event.clientX)));
              setInspectorWidth(drag.width);
            }}
            onPointerUp={finishInspectorResize}
            onPointerCancel={event => finishInspectorResize(event, true)}
            onLostPointerCapture={cancelInspectorResize}
            onDoubleClick={() => storeInspectorWidth(inspectorDefault)}
            onKeyDown={event => {
              if (event.key === "Escape" && inspectorDrag.current) { event.preventDefault(); finishInspectorResize(event, true); }
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || inspectorDrag.current) return;
              event.preventDefault();
              storeInspectorWidth(event.key === "Home" ? inspectorDefault : event.key === "End" ? inspectorMaximum : displayedInspectorWidth + (event.key === "ArrowLeft" ? 16 : -16));
            }}
          />
          <div
            className="rws-inspector-tabs"
            role="tablist"
            aria-label="Workspace panels"
          >
            {tabs.map(([id, Icon, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={pane === id}
                onClick={() => {
                  if (id === "review" && proposalVisit) { returnToProposal(); return; }
                  setPane(id);
                  setSheetOpen(true);
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
            <IconButton
              icon={X}
              label="Close properties"
              className="rws-small-screen"
              onClick={() => setSheetOpen(false)}
            />
          </div>
          {proposalVisit?.destination === "field" && (
            <div className="rws-proposal-return-bar">
              <button className="rws-text-button rws-proposal-return" onClick={returnToProposal}>
                <ArrowLeft size={14} />{Number.isInteger(proposalVisit.findingIndex) ? "Back to review" : "Back to suggestion"}
              </button>
            </div>
          )}
          <div className="rws-inspector-content" ref={inspectorContent}>
            {pane === "content" && (
              <>
                <div className="rws-panel-heading">
                  <h2>Content</h2>
                  <IconButton
                    icon={Plus}
                    label="Add a section"
                    onClick={() => setDialog("section")}
                  />
                </div>
                <select
                  className="rws-select"
                  aria-label="Resume section"
                  value={group}
                  onChange={(event) => {
                    setGroup(event.target.value);
                    setSelectedField(null);
                  }}
                >
                  <option value="Profile">Profile</option>
                  <option value="Contact">Contact</option>
                  {doc.model.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.heading}
                    </option>
                  ))}
                </select>
                {currentSection && (
                  <div className="rws-section-actions">
                    <span>{currentSection.kind}</span>
                    <IconButton
                      icon={ArrowUp}
                      label="Move section up"
                      disabled={doc.model.sections[0].id === group}
                      onClick={() => moveSection(-1)}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label="Move section down"
                      disabled={doc.model.sections.at(-1).id === group}
                      onClick={() => moveSection(1)}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Remove section"
                      onClick={() => setDialog("remove-section")}
                    />
                  </div>
                )}
                {renderFields(
                  fields.filter(
                    (field) =>
                      field.group === group &&
                      (!currentSection || field.owner === currentSection),
                  ),
                )}
                {currentSection?.items && !['experience', 'education'].includes(currentSection.kind) && <label className="rws-field"><span>Entry columns</span><select aria-label="Entry columns" disabled={doc.design.layout !== "hybrid"} title={doc.design.layout === "hybrid" ? "Columns for this section" : "Available in Hybrid layout"} value={currentSection.columns || 1} onChange={event => mutate(next => { next.model.sections.find(section => section.id === group).columns = Number(event.target.value); }, "Changed entry columns")}><option value={1}>One</option><option value={2}>Two</option><option value={3}>Three</option></select></label>}
                {(currentSection?.groups || currentSection?.items || []).map(
                  (entry, index, entries) => (
                    <fieldset className="rws-entry-fields" key={entry.id}>
                      <legend>
                        {entry.org ||
                          entry.school ||
                          entry.label ||
                          entry.title ||
                          "Entry " + (index + 1)}
                      </legend>
                      <div className="rws-entry-actions">
                        <IconButton
                          icon={ArrowUp}
                          label="Move entry up"
                          disabled={index === 0}
                          onClick={() =>
                            moveEntry(currentSection.id, entry.id, -1)
                          }
                        />
                        <IconButton
                          icon={ArrowDown}
                          label="Move entry down"
                          disabled={index === entries.length - 1}
                          onClick={() =>
                            moveEntry(currentSection.id, entry.id, 1)
                          }
                        />
                        <IconButton
                          icon={Trash2}
                          label="Remove entry"
                          onClick={() =>
                            removeEntry(currentSection.id, entry.id)
                          }
                        />
                      </div>
                      {renderFields(entryFields(entry))}
                    </fieldset>
                  ),
                )}
                {currentSection?.kind === "experience" &&
                  currentSection.items.map((item) => (
                    <button
                      className="rws-add-row"
                      key={item.id}
                      onClick={() =>
                        mutate(
                          (next) =>
                            next.model.sections
                              .find((section) => section.id === group)
                              .items.find((entry) => entry.id === item.id)
                              .bullets.push({
                                id: crypto.randomUUID(),
                                text: "",
                              }),
                          "Added achievement",
                        )
                      }
                    >
                      <Plus size={15} />
                      Achievement / {item.org || "new role"}
                    </button>
                  ))}
                {currentSection && currentSection.kind !== "text" && (
                  <button
                    className="rws-add-row"
                    onClick={() => addItem(currentSection)}
                  >
                    <Plus size={15} />
                    {currentSection.kind === "experience"
                      ? "Add role"
                      : "Add entry"}
                  </button>
                )}
                {group === "Contact" && (
                  <button
                    className="rws-add-row"
                    onClick={() =>
                      mutate(
                        (next) =>
                          next.model.contact.links.push({
                            id: crypto.randomUUID(),
                            label: "",
                            url: "",
                          }),
                        "Added contact link",
                      )
                    }
                  >
                    <Link size={15} />
                    Add link
                  </button>
                )}
                {group === "Contact" && doc.model.contact.links.map(link => <button key={link.id} className="rws-add-row" onClick={() => mutate(next => { next.model.contact.links = next.model.contact.links.filter(item => item.id !== link.id); }, "Removed contact link")}><Trash2 size={15} />Remove {link.label || "link"}</button>)}
              </>
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
            {pane === "review" && (
              <>
                <div className="rws-panel-heading">
                  <h2>Document review</h2>
                  {!hosted && <IconButton icon={BookOpen} label="AI review rubric" onClick={() => setDialog("rubric")} />}
                </div>
                <button
                  className="rws-target"
                  onClick={() => {
                    setTargetInput(structuredClone(doc.target));
                    setDialog("target");
                  }}
                >
                  <span>
                    Target role
                    <strong>{doc.target.role || "General purpose"}</strong>
                    <small>
                      {doc.target.company || "No job description selected"}
                    </small>
                  </span>
                  <Pencil size={14} />
                </button>
                <div className="rws-review-state">
                  <span className={fresh ? "rws-verified" : "rws-muted"}>
                    {fresh ? (
                      <>
                        <Check size={13} />
                        Current version
                      </>
                    ) : assessment ? (
                      <>
                        <Clock3 size={13} />
                        Edited since review
                      </>
                    ) : (
                      "Not yet assessed"
                    )}
                  </span>
                  <button className="rws-text-button" disabled={!!busy} onClick={runAssessment}>
                    <RefreshCw size={13} />
                    {hosted ? 'Re-check ATS' : 'Run checks'}
                  </button>
                </div>
                {doc.ats && <details className="rws-inline-warning" data-ats-migration><summary>Migration and original record</summary>{doc.ats.warnings.map(warning => <p key={warning}>{warning}</p>)}<p>Saved ATS record: {doc.ats.entryId}. Original score: {doc.ats.historicalReview.result?.score ?? 'Not assessed'}.</p>{doc.sourceIds.length ? <button className="rws-text-button" onClick={() => { setMode('source'); setSourceId(doc.sourceIds[0]); setSheetOpen(false); }}>Compare original file</button> : <button className="rws-text-button" onClick={() => fileInput.current.click()}>Attach source file</button>}<button className="rws-text-button" onClick={() => setPane('design')}>Review layout</button></details>}
                <section className="rws-assessment-section rws-ai-review">
                  <div className="rws-panel-heading"><h3><BookOpen size={17} />{hosted ? 'ATS assessment' : 'Role evidence review'}</h3>{!hosted && <button className="rws-text-button" disabled={!!busy} onClick={openAiReview}><RefreshCw size={13} />{doc.aiReview ? "Review again" : "Review with AI"}</button>}</div>
                  {busy?.startsWith("ai-") && <div className="rws-inline-actions"><span role="status">Review in progress</span><button className="rws-text-button" onClick={cancelAiReview}>Cancel</button></div>}
                  {doc.aiReview ? <>
                    <p className="rws-review-meta">{doc.aiReview.method}{doc.aiReview.provider ? ' / ' + doc.aiReview.provider + ' / ' + doc.aiReview.model : ''}</p>
                    {doc.aiReview.kind === 'ats' && <><div className="rws-score"><strong>{doc.aiReview.score}<small>/100</small></strong><span>{doc.aiReview.band}</span></div><p>{doc.aiReview.summary}</p></>}
                    {doc.aiReview.signature !== signature && <p role="status" className="rws-inline-warning">Document or evidence changed. This review is historical.</p>}
                    {doc.aiReview.findings.length ? <><p className="rws-review-meta">{reviewFindings.filter(item => !item.decision).length} active / {reviewFindings.filter(item => item.decision).length} set aside</p>{reviewFindings.filter(item => !item.decision).map(renderFinding)}{reviewFindings.some(item => item.decision) && <details className="rws-set-aside"><summary>Set aside ({reviewFindings.filter(item => item.decision).length})</summary>{reviewFindings.filter(item => item.decision).map(renderFinding)}</details>}</> : <p>No consequential revisions identified in this review.</p>}
                    {doc.aiQuestion && <section className="rws-review-finding"><h4>Evidence needed</h4><p>{doc.aiQuestion.question}</p><p>{doc.aiQuestion.reason}</p><TextField label="Your supporting evidence" multiline value={evidenceAnswer} onChange={setEvidenceAnswer} /><button className="rws-secondary" disabled={!!busy || !evidenceAnswer.trim() || doc.aiQuestion.signature !== signature} onClick={saveEvidenceAnswer}><Plus size={13} />Save evidence</button></section>}
                    {doc.aiReview.kind === 'ats' ? <details><summary>ATS signals and limits</summary>{(doc.aiReview.result?._breakdown || []).map(part => <p key={part.key}>{part.label}: {part.value}</p>)}<p>{doc.aiReview.signals?.semMode || 'Historical semantic mode not recorded'}. Heuristic assessment, not an employer ATS result or hiring probability.</p></details> : <details><summary>Historical rubric / not comparable to ATS</summary>{doc.aiReview.breakdown.map(part => <section className="rws-review-finding" key={part.id}><h4>{part.label}</h4><p>{part.rating === null ? "Unknown" : part.rating + "/4"} / {part.status}</p><p>{part.reason}</p></section>)}<p>{doc.aiReview.score === null ? "Overall not assessed" : "Rubric total: " + doc.aiReview.score + "/100"} / assessed weight {doc.aiReview.coverage}%</p><p>{doc.aiReview.method}</p></details>}
                  </> : <p>Not yet evaluated against the target job.</p>}
                </section>
                <section className="rws-assessment-section">
                  <h3><ScanText size={17} />{hosted ? 'Measured diagnostics' : 'Measured readiness'}</h3>
                  {fresh && assessment.measured ? <details><summary>Local diagnostic breakdown</summary>
                    {!hosted && <div className="rws-score"><strong>{assessment.measured.score}<small>/100</small></strong><span>{assessment.targetBasis}<small>Provisional local score</small></span></div>}
                    <dl className="rws-score-parts">{assessment.measured.breakdown.map(part => <div key={part.key}><dt>{part.key === "semantic" ? "Lexical context" : part.key === "parse" ? "PDF layout heuristic" : part.label}</dt><dd>{part.value}<small>{Math.round(part.weight / assessment.measured.breakdown.reduce((sum, item) => sum + item.weight, 0) * 100)}% weight</small></dd></div>)}</dl>
                    <p>{hosted ? 'Deterministic diagnostics for this version. The ATS assessment above includes AI judgment; missing signals are not assumed to pass.' : 'This local diagnostic excludes AI judgment. Role evidence is reviewed separately above. Unavailable signals are excluded and weights renormalized. This is not a hiring probability or an ATS vendor score.'}</p>
                  </details> : <p>Run checks for the current document and target.</p>}
                </section>
                <section className="rws-assessment-section">
                  <h3>
                    <FileCheck2 size={17} />
                    PDF integrity
                  </h3>
                  <strong>
                    {fresh && assessment.pdf?.complete
                      ? "Text completeness verified"
                      : "Not yet verified"}
                  </strong>
                  <p>
                    {fresh && assessment.pdf?.complete
                      ? assessment.pdf.fields +
                        " authored fields found across " +
                        assessment.pdf.pages +
                        " exported pages."
                      : "Requires an exported PDF. No parse score is assumed."}
                  </p>
                  <button
                    className="rws-text-button"
                    onClick={() => renderPdf(false)}
                    disabled={!!busy}
                  >
                    Inspect PDF
                    <ChevronRight size={13} />
                  </button>
                </section>
                <section className="rws-assessment-section">
                  <h3>
                    <Search size={17} />
                    Role coverage
                  </h3>
                  <strong>
                    {fresh && assessment.matchRate != null
                      ? assessment.matchRate + "% mentioned"
                      : doc.target.jd || doc.target.role
                        ? "Awaiting current check"
                        : "No target job"}
                  </strong>
                  <p>
                    Term coverage is not evidence of expertise or an ATS pass.
                  </p>
                  {fresh && (
                    <div className="rws-keywords">
                      {assessment.coverage.map((term) => (
                        <button
                          key={term.term}
                          disabled={!term.fields.length}
                          onClick={() => { const field = fields.find(field => field.id === term.fields[0]); if (field) { selectGroup(field.group); setSelectedField(field.id); } }}
                          className={
                            term.state === "mentioned" ? "is-mentioned" : ""
                          }
                          title={
                            term.state === "mentioned"
                              ? "Mentioned in resume; verify supporting experience"
                              : "Not evidenced in this resume"
                          }
                        >
                          {term.state === "mentioned" ? (
                            <Check size={10} />
                          ) : (
                            <Plus size={10} />
                          )}
                          {term.term}
                        </button>
                      ))}
                    </div>
                  )}
                  {fresh && <details className="rws-evidence-gaps"><summary>Missing requirements / highest weight first</summary>{assessment.coverage.filter(term => term.state !== "mentioned").map(term => <div key={term.term}><strong>{term.term}</strong><small>Weight {term.weight}. Add only with supporting experience; a missing term is not permission to invent it.</small></div>)}</details>}
                </section>
                <section className="rws-assessment-section">
                  <h3>
                    <List size={17} />
                    Writing & structure
                  </h3>
                  {fresh ? (
                    (assessment.measuredChecks || assessment.checks.map(check => ({ ...check, label: check.title, note: check.detail }))).map((check) => (
                      <div className="rws-check-row" key={check.label}>
                        {check.status === "pass" ? (
                          <Check size={14} />
                        ) : (
                          <CircleAlert size={14} />
                        )}
                        <span>
                          <strong>{check.label}</strong>
                          <small>{check.note}</small>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>Run checks against the current document.</p>
                  )}
                  <p className="rws-muted">
                    Role-fit judgment: not independently evaluated.
                  </p>
                </section>
                <section className="rws-assessment-section">
                  <div className="rws-suggestions-heading">
                    <h3>Suggestions</h3>
                    <div className="rws-suggestion-tools" role="group" aria-label="Suggestion actions">
                      <button className="rws-secondary" title="Propose an evidence-backed revision" disabled={!doc.sourceIds.length} onClick={composeProposal}>
                        <Pencil size={14} />
                        <span>Add revision</span>
                      </button>
                      {!hosted && <button className="rws-secondary" title="Load fictional sample suggestions" onClick={reviewProposals}>
                        <RefreshCw size={14} />
                        <span>Load sample</span>
                      </button>}
                    </div>
                  </div>
                  {proposals
                    .filter((proposal) => !doc.dismissed?.includes(proposal.id))
                    .map((proposal) => (
                      <article className="rws-proposal" key={proposal.id} data-proposal-id={proposal.id}>
                        <span className="rws-method-tag">
                          {proposal.origin === "ai" ? "AI PROPOSAL / VERIFY CLAIMS" : proposal.origin === "manual" ? "USER-AUTHORED PROPOSAL" : "EVIDENCE-BACKED SAMPLE"}
                        </span>
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
                            Supporting evidence
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
                  {!proposals.filter(
                    (proposal) => !doc.dismissed?.includes(proposal.id),
                  ).length && (
                    <p className="rws-muted">
                      No pending proposals.
                    </p>
                  )}
                </section>
              </>
            )}
            {pane === "sources" && (
              <>
                <div className="rws-panel-heading">
                  <h2>Sources</h2>
                  <IconButton
                    icon={Upload}
                    label="Import source file"
                    onClick={() => fileInput.current.click()}
                  />
                </div>
                {doc.sourceAssessment ? <details className="rws-evidence-gaps"><summary>Original source check / {time(doc.sourceAssessment.at)}</summary><p>{doc.sourceAssessment.characters.toLocaleString()} extracted characters. {doc.sourceAssessment.target.role || "No role target"}.</p><p>{doc.sourceAssessment.matchRate == null ? "No JD match measured." : doc.sourceAssessment.matchRate + "% keyword coverage against the captured JD."}</p><p>Extraction and lexical coverage only. Original layout, AI judgment and vendor parsing are not assessed.</p></details> : <button className="rws-text-button" disabled={!originalFiles.length} onClick={() => {
                  const text = originalFiles.map(source => source.text).join("\n");
                  const reference = createResume({ model: { name: "", title: "", summary: text, contact: {}, sections: [] }, target: doc.target });
                  mutate(next => { next.sourceAssessment = { at: Date.now(), sourceIds: originalFiles.map(source => source.id), target: structuredClone(doc.target), characters: text.length, matchRate: assessResume(reference).matchRate }; }, "Captured original source check");
                }}><ScanText size={15} />Capture original source check</button>}
                <section className="rws-assessment-section" aria-label="Original files"><h3>Original files</h3>{originalFiles.map(renderSource)}{!originalFiles.length && <p className="rws-muted">No original files linked.</p>}</section>
                {!!revisionEvidence.length && <section className="rws-assessment-section" aria-label="Revision evidence"><h3>Revision evidence</h3>{revisionEvidence.map(renderSource)}</section>}
                {!!availableSources.length && <details className="rws-available-sources"><summary>Available files ({availableSources.length})</summary>{availableSources.map(renderSource)}</details>}
                <section className="rws-assessment-section">
                  <h3>Export history</h3>
                  {currentRow?.exports
                    ?.slice()
                    .reverse()
                    .map((entry) => (
                      <button
                        className="rws-export-row"
                        key={entry.id}
                        onClick={() => {
                          setExported(entry);
                          setMode("pdf");
                          setSheetOpen(false);
                        }}
                      >
                        <FileCheck2 size={17} />
                        <span>
                          Version {entry.version}
                          <small>
                            {entry.pages} pages / {time(entry.at)}
                          </small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  {!currentRow?.exports?.length && (
                    <p className="rws-muted">No exported versions yet.</p>
                  )}
                </section>
                <button
                  className="rws-text-button rws-archive-action"
                  onClick={() => setDialog("archive")}
                >
                  <Archive size={15} />
                  {doc.archived
                    ? "Restore from archive"
                    : "Archive this resume"}
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
      <nav className="rws-mobile-panels" aria-label="Mobile workspace panels">
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
      <footer className={"adm__statusbar rws-status is-" + saveState}>
        <span className="rws-save-status">
          {indicator}
          <span>
            {saveState === "saved"
              ? (hosted ? "Saved to Cloudflare" : "Saved to preview server")
              : saveState === "conflict"
                ? "Version conflict / edits retained"
                : saveState === "error"
                  ? "Not saved / edits retained locally"
                  : (hosted ? "Saving to Cloudflare..." : "Saving to preview server...")}
          </span>
        </span>
        <span className="rws-status-version">v{version}</span>
        {["error", "conflict"].includes(saveState) && (
          <button
            className="rws-text-button"
            onClick={() =>
              conflict ? setDialog("conflict") : persist().catch(() => {})
            }
          >
            {conflict ? "Compare" : "Retry save"}
          </button>
        )}
        <span className="rws-status-end">
          <LockKeyhole size={14} className="rws-lock" />
          <span>No live changes</span>
          <span className="rws-status-separator" />
          <span>{hosted ? "AI on request" : "AI: 0 tokens"}</span>
        </span>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        hidden
        onChange={(event) => importFile(event.target.files[0])}
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
      {dialog === "rubric" && (
        <Dialog wide title="AI review rubric" onClose={() => setDialog(null)} actions={<button className="btn" onClick={() => setDialog(null)}>Close</button>}>
          <p className="pass__sub">Review with AI uses the rubric below through a configured transport. Run checks remains separate provisional local diagnostics.</p>
          {REVIEW_RUBRIC.map(part => <section className="rws-assessment-section" key={part.id}><h3>{part.label} / {part.weight}%</h3><p>{part.detail}</p></section>)}
          <section className="rws-assessment-section"><h3>Evidence and uncertainty</h3><p>Each criterion has a 0-4 evidence anchor and a reason. Original excerpts are resolved locally from cited IDs. Required gaps remain visible. An unassessable criterion or missing JD leaves the overall score incomplete, not automatically perfect or failed.</p></section>
          <section className="rws-assessment-section"><h3>Separate parsing report</h3><p>Text completeness, reading order, links and fonts are measured on the exported PDF. They do not establish universal ATS acceptance. Employer upload instructions take precedence.</p></section>
          <section className="rws-assessment-section"><h3>Validation limits</h3><p>The model evaluates evidence; code validates citations, ratings, completeness and arithmetic. These checks do not prove semantic truth, impartiality or real-world calibration. No automatic rewrite, fixed score ceiling or guaranteed improvement.</p></section>
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
      {dialog === 'ats-check' && <Dialog wide title="Re-check ATS" onClose={cancelAiReview} actions={<><button className="btn btn--ghost" onClick={cancelAiReview}>Cancel</button><button className="btn btn--primary" disabled={!!busy || !aiConsent || !aiConfiguration?.available} onClick={runHostedAssessment}>Run ATS check</button></>}>
        <p className="pass__sub">{aiConfiguration?.available ? aiConfiguration.provider + ' / ' + aiConfiguration.model : 'Configure AI in Studio before running a check.'}</p>
        <p>The current saved resume will be rendered to PDF and checked against this target. Earlier reviews remain in history. This is a paid AI request using your Studio configuration.</p>
        <details><summary>Resume and target sent for assessment</summary><pre>{resumeText(doc)}</pre><pre>{doc.target.jd || doc.target.level}</pre></details>
        <label className="chk"><input type="checkbox" checked={aiConsent} disabled={!!busy} onChange={event => setAiConsent(event.target.checked)} />Allow this resume and target to be sent for an ATS check.</label>
        {busy && <p role="status">Checking current PDF...</p>}{error && <p role="alert" className="rws-inline-warning">{error}</p>}
      </Dialog>}
      {dialog === "ai-review" && <Dialog wide title={revisionFinding === null ? "Review target requirements" : "Prepare evidence-backed revision"} onClose={cancelAiReview} actions={<>
        <button className="btn btn--ghost" onClick={cancelAiReview}>Cancel</button>
        {revisionFinding !== null ? <button className="btn btn--primary" disabled={!!busy || !aiConfiguration?.available || !aiConsent || !aiPacket || !canReviseReview(doc, doc.aiReview)} onClick={() => runAiReview("revision", revisionFinding)}>Approve revision request</button> : <>
          <button className="btn btn--primary" disabled={!!busy || !aiConfiguration?.available || !aiConsent || !aiPacket || !doc.target.jd.trim()} onClick={() => runAiReview("requirements")}>Build requirements</button>
          {doc.reviewManifest && <button className="btn btn--primary" disabled={!!busy || !aiConfiguration?.available || !requirementsConsent || !aiConsent || !aiPacket} onClick={() => runAiReview("assessment")}>Approve and review</button>}
        </>}
      </>}>
        <p className="pass__sub">{aiConfiguration?.available ? `${aiConfiguration.provider} / ${aiConfiguration.model}. ${hosted ? 'Paid revision request using your Studio configuration.' : 'Remaining reserved budget: $' + Number(aiConfiguration.remaining ?? 0).toFixed(2) + '.'}` : "Configure AI in Studio before requesting a revision."}</p>
        {hosted && !aiConfiguration?.available && aiConfiguration?.models && <div className="rws-form-grid"><label className="rws-field"><span>Review model</span><select aria-label="Review model" value={aiModel} onChange={event => setAiModel(event.target.value)}>{aiConfiguration.models.filter(model => Number.isFinite(model.pricing?.input) && Number.isFinite(model.pricing?.output)).map(model => <option key={model.id} value={model.id}>{model.id} / ${model.pricing.input} input, ${model.pricing.output} output per million tokens</option>)}</select></label><button className="btn btn--ghost" disabled={!aiModel || !!busy} onClick={async () => { try { setAiConfiguration(await api("ai/connect", { method: "POST", body: JSON.stringify({ model: aiModel, approved: true }) })); } catch (failure) { setError(failure.message); } }}>Authorize $1 review budget</button></div>}
        <details className="rws-reading-order"><summary>Data sent for this review</summary><h3>Target job</h3><pre>{doc.target.jd}</pre><h3>Resume evidence</h3><pre>{aiPacket?.excerpts.map(excerpt => excerpt.text).join("\n")}</pre><h3>Supporting sources for revisions</h3>{linkedSources.map(source => <details key={source.id}><summary>{source.name}</summary><pre>{source.text}</pre></details>)}</details>
        <label className="chk"><input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} />Allow these job, resume and selected source texts to be sent to this provider. Contact fields are excluded; other text may still contain personal information.</label>
        {doc.reviewManifest && revisionFinding === null && <>
          <h3>Job requirements</h3>{doc.reviewManifest.requirements.map(requirement => <section className="rws-review-finding" key={requirement.id}><h4>{requirement.label}</h4><label className="rws-field"><span>Priority</span><select aria-label={"Priority: " + requirement.label} value={requirement.importance} disabled={!!busy} onChange={event => { const importance = event.target.value; change({ ...live.current.document, reviewManifest: { ...doc.reviewManifest, requirements: doc.reviewManifest.requirements.map(item => item.id === requirement.id ? { ...item, importance } : item) } }, "Corrected requirement priority", false); setRequirementsConsent(false); }}><option value="required">Required</option><option value="responsibility">Responsibility</option><option value="preferred">Preferred</option></select></label><blockquote>{requirement.quote}</blockquote></section>)}
          <details><summary>Non-scoring job context</summary>{doc.reviewManifest.segments.filter(segment => segment.disposition !== "criteria").map(segment => <p key={segment.id}>{segment.id}: {segment.disposition}. {segment.reason}</p>)}</details>
          <label className="chk"><input type="checkbox" checked={requirementsConsent} onChange={event => setRequirementsConsent(event.target.checked)} />I reviewed the requirement inventory against the job description.</label>
        </>}
        {busy && <p role="status">{busy === "ai-requirements" ? "Reading job requirements" : "Assessing resume evidence"}</p>}
        {error && <p role="alert" className="rws-inline-warning">{error}</p>}
      </Dialog>}
      {dialog === "versions" && (
        <Dialog
          wide
          title="Version history"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Close
              </button>
              {compareVersion && compareVersion.number !== version && (
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
          <div className="rws-checkpoint"><TextField label="Restore point name" value={input} onChange={setInput} /><button className="btn" disabled={!input.trim() || !!busy} onClick={async () => { setBusy("checkpoint"); try { await checkpoint(input.trim()); setInput(""); await showVersions(); } catch (failure) { setError(failure.message); } finally { setBusy(null); } }}><Plus size={15} />Save restore point</button></div>
          <div className="rws-versions-layout">
            <div className="rws-version-list">
              {versions.map((entry) => (
                <button
                  className={
                    compareVersion?.number === entry.number ? "is-active" : ""
                  }
                  key={entry.number}
                  onClick={() => setCompareVersion(entry)}
                >
                  <History size={15} />
                  <span>
                    <strong>
                      v{entry.number} / {entry.label}
                    </strong>
                    <small>{time(entry.at)}</small>
                  </span>
                  {entry.number === version && <Check size={14} />}
                </button>
              ))}
            </div>
            <div className="rws-version-preview">
              {compareVersion ? (
                <>
                  <h3>Version {compareVersion.number}</h3>
                  <p>
                    {compareVersion.document.design.size.toUpperCase()} /{" "}
                    {RESUME_FONTS[compareVersion.document.design.font]?.name} /{" "}
                    {compareVersion.document.design.margin} margins
                  </p>
                  <pre>{resumeText(compareVersion.document)}</pre>
                </>
              ) : (
                <p className="rws-muted">
                  Select a version to inspect its content and design before
                  restoring.
                </p>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {dialog === "finding-decision" && findingDecision && <Dialog wide title="Set aside finding" onClose={() => setDialog(null)} actions={<><button className="btn" disabled={!!busy} onClick={() => setDialog(null)}>Cancel</button><button className="btn btn--primary" disabled={!!busy || findingDecision.reason === "evidenced" && !findingDecision.fieldId} onClick={() => saveFindingDecision(findingDecision.review, findingDecision.findingIndex, findingDecision)}>Set aside</button></>}>
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
              <button className="btn" disabled={!!busy} onClick={() => saveSource(true)}>
                Create resume from text
              </button>
              <button
                className="btn btn--primary"
                disabled={!!busy}
                onClick={() => saveSource(false)}
              >
                Attach original
              </button>
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
          {!!imported.unmappedGlyphs && <p className="rws-error" role="alert">{imported.unmappedGlyphs} characters have no readable mapping in this PDF. They remain marked in the extracted text and need comparison with the original.</p>}
          {!!imported.unresolvedMarkers && <p className="rws-error" role="alert">{imported.unresolvedMarkers} bullet markers could not be matched to a line. Check their positions against the original.</p>}
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

createRoot(document.getElementById("resume-root")).render(<App />);
