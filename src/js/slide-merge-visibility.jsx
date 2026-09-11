import React, { useEffect } from "react";
import { Globe, LockKeyhole } from "lucide-react";
import { ToolMenu } from "./slide-merge-toolbar.jsx";
import { DeckDialog } from "./slide-merge-navigator.jsx";
import { deckVisibility } from "./slide-merge-visibility.mjs";
import "../../css/slide-merge-visibility.css";

export function VisibilityMenu({ deck, disabled, onChange, publication = null }) {
  const isPublic = deckVisibility(deck) === "public";
  const Icon = isPublic ? Globe : LockKeyhole;
  return <div className="merge-visibility">
    <ToolMenu label={`Slideshow visibility: ${isPublic ? "public" : "owner-only"} draft`} icon={<Icon size={18} strokeWidth={1.75} aria-hidden="true" />} disabled={disabled} showChevron={false}>
      <div className="merge-visibility-heading">Draft visibility</div>
      <label className="merge-view-option"><input type="checkbox" checked={isPublic} disabled={disabled} onChange={event => onChange(event.target.checked)} />Public slideshow</label>
      <p>{publication ? isPublic ? "Public after Publish." : "Owner-only after Publish." : isPublic ? "Public on a future Publish. Nothing has been published from this lab." : "Owner-only publishing intent. This lab draft stays on this device."}</p>
      <p className="merge-visibility-status">Live visibility: {publication ? publication.exists ? publication.isPublic ? "public" : "owner-only" : "not published" : "not connected"}</p>
    </ToolMenu>
  </div>;
}

export function VisibilityConfirmation({ onClose, onConfirm, hosted = false }) {
  useEffect(() => () => { requestAnimationFrame(() => document.querySelector(".merge-visibility summary")?.focus()); }, []);
  return <DeckDialog wide={false} title="Allow public slideshow publishing?" onClose={onClose}>
    <div className="merge-visibility-confirm">
      <p>A published public slideshow can be viewed and copied by anyone. Making it private later cannot recall downloaded copies.</p>
      <p>Review all included content for confidential material. Speaker notes and skipped slides must stay out of the public payload.</p>
      <p>{hosted ? "This changes your Studio draft. Publish applies the visibility change to your website." : "This changes the lab draft setting only. Publishing is not connected, and source review will still be required before publication."}</p>
    </div>
    <footer><button type="button" onClick={onClose} autoFocus>Cancel</button><button type="button" className="merge-dialog-primary" onClick={onConfirm}>Set public draft</button></footer>
  </DeckDialog>;
}