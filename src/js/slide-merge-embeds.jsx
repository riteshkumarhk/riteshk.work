import React, { useEffect, useRef, useState } from "react";
import { Link, ExternalLink, RotateCw, X } from "lucide-react";
import { embedDescriptor, EMBED_SANDBOX } from "./slide-merge-embeds.mjs";

export function EmbeddedMedia({ value, preview = false }) {
  return <EmbedContent key={value} value={value} preview={preview} />;
}

function EmbedContent({ value, preview }) {
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0), [status, setStatus] = useState("Loading embed");
  const [media] = useState(() => { try { return embedDescriptor(value); } catch (error) { return { error: error.message }; } });
  useEffect(() => {
    if (media.kind !== "frame" && media.kind !== "html") return;
    const timer = setTimeout(() => setStatus(current => current === "Loading embed" ? "Response unconfirmed" : current), 15000);
    return () => clearTimeout(timer);
  }, [revision, media]);
  if (media.error) return <div className="merge-embed-error" role="status">{media.error}</div>;
  const source = media.sourceUrl || (media.url.startsWith("<") ? "" : media.url);
  function retry() { setFailed(false); setStatus("Loading embed"); setRevision(current => current + 1); }
  const tools = <div className="merge-embed-tools"><span role="status">{failed ? "Media unavailable" : status}</span><button type="button" title="Reload embedded content" aria-label="Reload embedded content" onClick={retry}><RotateCw size={16} /></button>{source && <a href={source} target="_blank" rel="noopener noreferrer" title={media.title.startsWith("StatCounter") ? "Source: StatCounter Global Stats" : "Open source"} aria-label={media.title.startsWith("StatCounter") ? "Source: StatCounter Global Stats" : "Open source"}><ExternalLink size={16} /></a>}</div>;
  if (failed) return <div className="merge-embed-surface"><div className="merge-embed-error" role="status">Media unavailable</div>{tools}</div>;
  if (media.kind === "image") return <img className="lab-embed" src={media.src} alt={media.title} onError={() => setFailed(true)} />;
  if (media.kind === "video") return <video className="lab-embed" src={media.src} controls={!preview} muted={preview} playsInline preload="metadata" onLoadedMetadata={event => { if (preview && event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} onError={() => setFailed(true)} />;
  if (media.kind === "audio") return <div className="merge-embed-surface merge-embed-audio"><audio src={media.src} controls={!preview} preload="metadata" onError={() => setFailed(true)} /></div>;
  return <div className="merge-embed-surface"><iframe key={revision} className="lab-embed" src={media.srcDoc ? undefined : media.src} srcDoc={media.srcDoc} title={media.title} allow="fullscreen; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" sandbox={media.trusted ? "allow-scripts allow-same-origin allow-forms allow-presentation" : EMBED_SANDBOX} credentialless="" onLoad={() => setStatus("External content")} onError={() => setFailed(true)} />{!preview && tools}</div>;
}

export function EmbedComposer({ api, onCommit, onCancel, disabled }) {
  const [pending, setPending] = useState(null), [value, setValue] = useState(""), [error, setError] = useState("");
  const [ratio, setRatio] = useState("");
  const latest = useRef({}), finished = useRef(null);
  latest.current = { pending, value, onCommit, disabled, ratio };
  function commit() {
    const current = latest.current;
    if (!current.pending || current.disabled || !current.value.trim() || finished.current === current.pending.id) return;
    try { const media = embedDescriptor(current.value); finished.current = current.pending.id; setError(""); current.onCommit(current.pending.id, media.url, current.ratio || (current.pending.source ? undefined : media.aspectRatio)); }
    catch (failure) { setError(failure.message); }
  }
  useEffect(() => {
    if (!api) return;
    const update = (elements, state) => {
      const element = elements.find(item => !item.isDeleted && item.customData?.pendingEmbed);
      if (!element) { setPending(null); return; }
      const zoom = state.zoom.value;
      const width = Math.min(state.width - 24, Math.max(260, element.width * zoom)), height = Math.min(state.height - 24, Math.max(180, element.height * zoom));
      setPending({ id: element.id, source: element.customData.slideEmbed?.url || "", x: Math.max(12, Math.min(state.width - width - 12, (element.x + state.scrollX) * zoom)), y: Math.max(12, Math.min(state.height - height - 12, (element.y + state.scrollY) * zoom)), width, height });
    };
    update(api.getSceneElements(), api.getAppState());
    return api.onChange(update);
  }, [api]);
  useEffect(() => { setValue(pending?.source || ""); setRatio(""); setError(""); finished.current = null; }, [pending?.id]);
  if (!pending) return null;
  return <form className="merge-embed-composer" data-prevent-outside-click style={{ left: pending.x, top: pending.y, width: pending.width, height: pending.height }} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); commit(); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) commit(); }}>
    <Link size={22} strokeWidth={1.75} /><textarea autoFocus aria-label="Embed media link or code" placeholder="URL or embed code" rows={3} maxLength={100000} spellCheck={false} value={value} disabled={disabled} onChange={event => setValue(event.target.value)} onKeyDown={event => event.stopPropagation()} />
    <select aria-label="Embed aspect ratio" value={ratio} disabled={disabled} onChange={event => setRatio(event.target.value)} onKeyDown={event => event.stopPropagation()}><option value="">Auto ratio</option><option value="16/9">16:9</option><option value="3/2">3:2</option><option value="4/3">4:3</option><option value="1/1">Square</option><option value="4/5">4:5</option><option value="9/16">9:16</option></select>
    <button type="submit" disabled={disabled || !value.trim()}>{pending.source ? "Update embed" : "Embed"}</button>{onCancel && <button type="button" title="Cancel embed editing" aria-label="Cancel embed editing" disabled={disabled} onClick={() => { finished.current = pending.id; onCancel(pending.id); }}><X size={16} /></button>}{error && <span role="alert">{error}</span>}
  </form>;
}