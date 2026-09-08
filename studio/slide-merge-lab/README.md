# Slide Merger Lab

Isolated editor experiment at `/studio/slide-merge-lab/`. Production editor,
published content, private decks and publishing are untouched. The library uses
the existing owner session through a new, narrowly scoped Worker route.

## Interaction model

- Canvas first: native compact contextual properties float on the left on desktop.
- Slides occupy the right rail on desktop. Only this rail has a resize handle.
- Drag the rail's left edge, use Left/Right arrow keys, or Home/double-click to reset.
- Rail width persists separately in `rk:slide-merge:rail-width`; mobile uses a collapsible horizontal slide strip, initially closed.
- At widths up to 900px, a two-row toolbar is docked below the slide title, outside the canvas.
    Properties, Library and Notes share one bottom-sheet interaction, closed by default.
    Properties shows slide settings for an empty selection or the native object inspector
    for selected objects, including Excalidraw's different phone/tablet inspector layouts.
    Close, backdrop and Escape dismiss the sheet; nested pickers consume Escape first.
    Drawing Line is available in Draw on mobile. Guides and Fit use the actual canvas bounds.
- Each thumbnail has move up/down, insert above, duplicate, skip/include and confirm-delete controls.
- Insert blank slides between existing slides or append through Add a slide.
- Start a section here adds a named navigator divider to the selected slide; click it to rename/remove.
    The divider moves with its slide and is not copied when duplicating a slide.
- Skipped slides remain editable and saved but are omitted from rehearsal. Rehearsal starts at the
    selected or next included slide, wrapping to the first included slide if needed. All skipped disables Rehearse.
- Canvas edits use engine undo. Switching slides clears that slide's engine history.
- Deck autosave uses isolated IndexedDB `rk-slide-merge-lab-v1`, not production storage.
- Images retain original bytes. Text uses the shared platform-hosted font catalogue.
- One studio toolbar replaces the native tool strip, without its tool lock or More menu.
- The native hamburger is hidden; View > Help opens the native Help dialog.
- Hand, Select, Text, Image, Shapes, Arrow, Line and Draw use native engine tools.
- Icons searches the studio's built-in and published custom icons; insertion retains vector SVG bytes.
- Content inserts editable text, lists, metrics, quotes, badges and a three-card section starter.
- Content > Section opens the section picker and inserts into the current slide as a selected group.
    Existing objects, title, background and speaker notes stay unchanged. Native Undo removes the insertion;
    ungroup to edit individual objects. This does not create a new slide.
- Add a slide offers Add blank, Add a layout (nine existing layouts), Generate from a section,
    and Start a section here. Per-slide controls sit below thumbnails, never over the preview.
- Generate from a section reads the published site or, only when selected, this browser's saved Studio
    draft. Choose a case study and section; this never modifies source content. Locked, encrypted-stub,
    vault and disabled sections are excluded. No vault resolution or decryption runs.
- Both section entry points share content thumbnails showing converted text and the first supported
    image/video, with a section name and type. Desktop uses two columns; phones use one. These are
    previews of the conversion, not screenshots of the original interactive case-study block.
- Text, statements, metrics, quotes and lists become native editable text. Long body text is excerpted
    on the slide; generating a new slide retains full source prose in notes, while current-slide insertion
    preserves existing notes. The first direct image/video is copied as
    original image bytes or a hosted video embed. Uploaded media paths use the site's R2 normalization.
    Unsupported/failed media aborts insertion with an error, not a partially generated slide.
- Notes toggles independently of drawing tools. View groups native grid snapping,
  object snapping, slide-pixel rulers, safe margins, thirds and Fit slide.
- Empty selection shows Slide properties: nine layouts, background swatches/custom
    colour, original-byte image/video backgrounds, and None/Fade/Push/Magic Move transitions.
- Slide background uses the same native fill picker: palette, shades, shared custom
    colours, hex, spectrum, RGB and desktop eyedropper. Colour edits keep the popup open.
- Eyedropper sampling includes the current decoded frame of direct video embeds and
    videos inside same-origin lab iframes, even when the player is inactive. It does not
    seek, play, pause or re-encode media. Cross-origin media requires readable CORS pixels;
    inaccessible third-party players and undecoded frames cannot be sampled. Player
    controls are not part of the video frame. Mapping respects scaling and object-fit.
- Layouts reposition free text/images, preserve grouped/locked objects and bound labels,
    and replace untouched placeholders. Select a media placeholder then use Image to fill it.
- Drag from the top/left ruler to insert horizontal/vertical guides. Drag to move;
    arrow keys adjust, Shift increases the step, and Delete removes the focused guide.
    Clear guides removes custom guides and preset overlays. Guide snapping uses a six-screen-pixel threshold.
- Layout, background, transition and guide settings use the slide frame's metadata,
    native Undo and isolated local autosave. Reduced motion disables rehearsal transitions.
- Merger chrome consumes the site's CSS tokens at build time, including native
    inspectors, flyouts and dialogs. Artwork colours remain independent.
- Appearance follows the site's `rk:theme` preference (system by default; day, night,
    or local time when explicitly chosen). OS and cross-tab changes update live.
    Automatic canvas backgrounds, rehearsal, slide thumbnails and section previews use
    the active site palette. Native dark rendering keeps automatic-slide artwork readable
    without rewriting objects or media. Explicit slide backgrounds retain authored colours.

## Build and checks

`node --test slide-library.test.mjs` checks real Worker authentication, size limits,
revision conflicts, cross-device merges, deletion, in-flight changes and offline reload.

`npm run build:slide-lab` builds both labs into shared assets and scans generated
JavaScript for Google API key patterns. The engine adapter removes upstream Firebase configuration.

`node --test slide-merge.test.mjs` checks immutable slide operations and rail limits.
`node --test slide-merge-sections.test.mjs` checks source privacy filters, conversion, full notes,
text excerpts, original media URLs and R2 path normalization.
`node --test slide-merge-inserts.test.mjs` checks content starters and ruler coordinates.
`node --test slide-merge-properties.test.mjs` checks layouts, selection ownership,
transition matching, guide positioning and snapping.
Browser verification covers real rail dragging, keyboard resizing, reload persistence,
floating-left inspector geometry, desktop/mobile screenshots, deck operations and rehearsal.
Background-picker checks cover hex/RGB editing without dismissal, Escape, Undo,
reload persistence, native fill parity and popup stacking above the toolbar on mobile.

## Roaming library

The native Library is shared across decks and devices signed into the same owner's
Studio on the same site origin. Browse returns to this lab through the official
`useHandleLibrary` hook. External imports are restricted to HTTPS `.excalidrawlib`
files under `libraries.excalidraw.com/libraries/`; native local import/export remains available.
Only library items are synced, never the current slide, deck or speaker notes.
Library elements themselves can contain text, links and custom metadata; anything
deliberately added to Library is included. Preserve applicable third-party licence
notices and asset-specific terms. Downloading a library contacts its host; reusing
an already-saved item does not need that catalogue request.

- Dedicated private R2 bucket `rk-slide-libraries`, binding `SLIDE_LIBRARIES`.
- One object `owner/library.json`; no public route or public bucket URL.
- `GET /admin/slide-library` returns `{revision, items}`; authenticated `POST`
    accepts the same envelope. Both require the existing unexpired owner session.
- R2 conditional writes prevent lost updates. A 409 triggers a fresh read and
    three-way merge: only local changes/removals override the remote version;
    unrelated remote additions remain. A stale unchanged item cannot undo a remote
    deletion. Simultaneous changes to the SAME item use the last successful local edit.
- 10 MB request limit, 1000 items and 20000 elements. Errors remain visible in the
    status-bar sync control, which can retry or open the normal Studio sign-in tab.
- IndexedDB `rk-slide-library-v1` stores the last cloud baseline plus local edits.
    It survives reload/offline use and retries after edits, reconnection, tab focus,
    visibility changes, sign-in in another tab or an explicit sync click.
- This is not live collaboration or end-to-end encryption. The private cache is
    available to this browser profile, including after sign-out; cloud requests still
    require sign-in. Localhost and the live site have separate browser caches/sessions.
- The existing NDA vault and public media bucket are not used or modified.

Worker setup: create `rk-slide-libraries` with public access disabled, then run
`wrangler deploy` from `worker/` after approval. No new secrets or KV index needed.
The production slideshow editor has not been replaced; this integration is currently
active in the merger lab only.

## Adoption gates

This is not a production replacement. Rich HTML, section and video fixtures are
native-renderer embeds, not fully editable engine objects. SVG thumbnails currently
show placeholders for those embeds. Video playback depends on browser support.
Production-deck conversion, full export/thumbnail fidelity, presenter parity,
private encryption and publishing compatibility remain unimplemented.
Local drafts do not roam across devices. Real-hardware performance remains a user check.
Section generation maps content, not a visual clone of the original block. Interactive/nested sections,
YouTube/web embeds and multi-image galleries do not have full conversion parity. Only the first media
item/metric/quote is used; hosted video playback and export fidelity retain the existing embed limitations.
Custom saved production layouts and production deck import are not part of this lab.
Icons are SVG image objects, not editable individual paths; unpublished studio icons
are not available. Video-background thumbnails omit playback; video renders beneath
artwork in the editor and rehearsal. Magic Move matches object IDs, text and image IDs;
unmatched incoming objects fade in. It is not full production presenter parity.
Grid snapping is the engine grid rather than the production 12-column layout grid.
Custom guides persist per slide; preset visibility and notes-panel visibility are session-only.