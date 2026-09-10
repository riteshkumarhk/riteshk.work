import React, { useEffect, useRef, useState } from "react";
import { Link, ExternalLink } from "lucide-react";
import { embedDescriptor } from "./slide-merge-embeds.mjs";

export function EmbeddedMedia({ value, preview = false }) {
  const [failed, setFailed] = useState(false);
  let media;
  try { media = embedDescriptor(value); } catch (error) { return <div className="merge-embed-error" role="status">{error.message}</div>; }
  if (failed) return <div className="merge-embed-error" role="status">Media unavailable<a href={media.url} target="_blank" rel="noopener noreferrer">Open source<ExternalLink size={16} /></a></div>;
  if (media.kind === "image") return <img className="lab-embed" src={media.src} alt={media.title} onError={() => setFailed(true)} />;
  if (media.kind === "video") return <video className="lab-embed" src={media.src} controls={!preview} muted={preview} playsInline preload="metadata" onLoadedMetadata={event => { if (preview && event.currentTarget.duration > 0) event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} onError={() => setFailed(true)} />;
  return <iframe className="lab-embed" src={media.src} title={media.title} allow="fullscreen; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" sandbox={media.trusted ? "allow-scripts allow-same-origin allow-forms allow-presentation" : "allow-scripts allow-forms allow-presentation"} onError={() => setFailed(true)} />;
}

export function EmbedComposer({ api, onCommit, disabled }) {
  const [pending, setPending] = useState(null), [value, setValue] = useState(""), [error, setError] = useState("");
  const latest = useRef({}), finished = useRef(null);
  latest.current = { pending, value, onCommit, disabled };
  function commit() {
    const current = latest.current;
    if (!current.pending || current.disabled || !current.value.trim() || finished.current === current.pending.id) return;
    try { const media = embedDescriptor(current.value); finished.current = current.pending.id; setError(""); current.onCommit(current.pending.id, media.url); }
    catch (failure) { setError(failure.message); }
  }
  useEffect(() => {
    if (!api) return;
    const update = (elements, state) => {
      const element = elements.find(item => !item.isDeleted && item.customData?.pendingEmbed);
      if (!element) { setPending(null); return; }
      if (latest.current.pending?.id === element.id && !state.selectedElementIds[element.id]) commit();
      const zoom = state.zoom.value;
      const width = Math.min(state.width - 24, Math.max(260, element.width * zoom)), height = Math.max(112, element.height * zoom);
      setPending({ id: element.id, x: Math.max(12, Math.min(state.width - width - 12, (element.x + state.scrollX) * zoom)), y: Math.max(12, Math.min(state.height - height - 12, (element.y + state.scrollY) * zoom)), width, height });
    };
    update(api.getSceneElements(), api.getAppState());
    return api.onChange(update);
  }, [api]);
  useEffect(() => { setValue(""); setError(""); finished.current = null; }, [pending?.id]);
  if (!pending) return null;
  return <form className="merge-embed-composer" data-prevent-outside-click style={{ left: pending.x, top: pending.y, width: pending.width, height: pending.height }} onSubmit={event => { event.preventDefault(); commit(); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) commit(); }}>
    <Link size={22} strokeWidth={1.75} /><input autoFocus type="url" aria-label="Embed media link" placeholder="https://" value={value} disabled={disabled} onChange={event => setValue(event.target.value)} onKeyDown={event => event.stopPropagation()} />
    <button type="submit" disabled={disabled || !value.trim()}>Embed</button>{error && <span role="alert">{error}</span>}
  </form>;
}