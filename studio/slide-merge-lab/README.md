# Slide Merger Lab

Isolated editor experiment at `/studio/slide-merge-lab/`. Published content,
private decks and publishing are untouched. The library uses
the existing owner session through a new, narrowly scoped Worker route.

See [the design audit](DESIGN-AUDIT.md) for consistency corrections, verification
coverage and components proposed for a future shared design-system update.

## Shared presentation mode

Rehearse uses the production Studio presentation controller and styles from
`src/js/deck-presenter.mjs` and `css/deck-presenter.css`. Production keeps its
HTML slide renderer; the lab mounts a live, read-only Excalidraw canvas with
native sections and original media. No screenshot flattening or media re-encoding
is used. Hidden slides are skipped and rehearsal starts at the selected visible
slide, or the next visible slide when the selection is hidden.

Both players share progress navigation, previous/next, Home/End, Space/Page keys,
Escape, the P notes overlay, elapsed timer/reset, clock, next-slide preview and
the separate private presenter window. Navigation and timer reset synchronize
between windows. Closing the presenter window returns to the audience view;
End closes both. Share only the audience window to keep speaker notes private.
On supported desktop browsers, the presenter button uses Document Picture-in-Picture:
the notes window stays above the audience window even when the slides take focus.
The browser controls its placement and size. Unsupported browsers or denied requests
fall back to a normal popup, which is not always-on-top. Popup permissions still
apply; if blocked, allow popups and click again. Closing the slideshow also closes
the floating window, including when its opening request was still pending.
Always-on-top is not capture protection: share the slides tab/window rather than
the whole screen, and verify the meeting application's sharing preview.

The lab retains None, Fade, Push and Magic Move transitions with reduced-motion
support. Presentation scenes are cloned, editor controls stay hidden on phones,
and canvas pan/zoom stays fitted. Thumbnail previews include embedded content
and preserve the slide's surface color. The draft is unchanged on exit.

Real-browser regression checks use `playwright-core` with an installed browser:

```powershell
$env:SLIDE_LAB_URL = 'http://127.0.0.1:5510'
node --test slide-presenter.browser.test.mjs
```

The default executable is installed Windows Edge. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` for another Chromium executable. The suite skips
when the URL or browser is unavailable. Checks cover desktop/390px/320px chrome
parity, actual canvas pixels, media playback, transition navigation, hidden slides,
draft integrity, and real popup navigation/reset/cleanup. Real-device animation
smoothness and external providers' playback policies remain device-dependent.

## AI composition foundation

`src/js/slide-merge-composition.mjs` defines a versioned contract and capability
registry. `compositionCatalog(data, { plain, fontFamily })` returns eligible
section references and bounded text evidence, without media URLs. New AI drafts
use version 2: editable headlines, kickers, body copy and notes, with source IDs
and intact component references. Five deterministic layouts are supported:
opening, statement, split, comparison and evidence. Version 1 remains readable
for legacy section-order proposals but cannot pass as a new authored draft.
`compileComposition(proposal, data, options)` resolves every reference again and
returns deterministic text and whole-section component elements with original
nested content/media, notes, referenced custom icons, provenance and review
warnings. Both functions are async.

References include case-study identity, section position and SHA-256 content
fingerprints. Changed, moved, missing or protected sources reject the proposal;
unknown fields and capabilities are rejected. Compilation snapshots inputs and
does not mutate a deck, fetch media, contact an AI provider or publish anything.
Nested protection markers and protected URLs exclude the entire source section.

Authoring can combine or split source ideas and rewrite presentation copy, but
must not invent facts, outcomes, metrics or contributions. Every non-text source
and every text source containing media must remain an intact component at least
once in the initial proposal. Generated `gen` sections retain complete versioned
specs for RKGen. Original media is not transformed. Text is measured with loaded
canvas fonts, wrapped without truncation and reduced no lower than 18px; an
unreadably dense result fails instead of overflowing. Notes and provenance persist.
Limits: 24 slides, 8 sources per slide, 120 catalog entries and 48 required
components per request. Larger cases need selected batches. These are bounded
authored layouts, not arbitrary AI-generated canvas code.

### Contextual AI drafting

In Add a slide, choose Add sections as slides for direct insertion with zero AI
calls. Select sections there and choose Draft with AI for a selected-source story,
or choose Draft entire deck with AI to use the entire current case study. No new
mandatory brief dialog, sign-in screen or AI settings flow is added.

The request sends eligible source titles and bounded plain-text evidence to the
configured Studio writing provider. Unselected and protected
sections, media payloads and generated code/specs are not sent to the model.
The model writes source-grounded copy and chooses among the five supported layouts.
Source IDs are validated, but factual accuracy still requires human review.

The same pane shows a live component review with previous/next, fullscreen,
reorder and remove controls. Back or closing the pane cancels a pending request.
Append preserves current slides and notes. Replace requires an explicit warning
confirmation and is not reversible through canvas Undo. Apply rechecks fresh
source fingerprints, prepares all slides, and persists the next deck before
changing the editor. Invalid responses, stale sources and storage errors leave
the current deck in place. Nothing is published.

The lab lazily loads the existing Studio bundle without opening Studio and calls
its narrow `draftSlides` operation. Provider configuration, model fallback,
Cloudflare auth and token accounting stay in the existing helpers. A deterministic
preference list ranks suitable models returned by the configured provider, with
fallback only for model availability/access errors. Custom endpoints retain their
explicit configured model. This is a routing heuristic, not a quality benchmark.
Reasoning models use compatible completion parameters. Local-key
providers do not acquire a new sign-in requirement; Cloudflare retains its real
session requirement. Configuration is origin-local: localhost cannot read a
session or keys saved on the production origin. No credentials are copied or
stored by the lab. The Studio bundle retains its existing Date.now cache policy.

`slide-merge-ai.test.mjs` covers selection boundaries, strict model output,
cancellation and immutable apply planning. Isolated browser checks use mocked
provider responses through the actual shared helper, not real credentials or
paid calls; live model output quality remains an owner acceptance check.

Run the `slide-*.test.mjs` suites with Node's test runner. Current release: 146
tests pass; both lab and shared bundles build. Browser checks cover authored
editable text/components, model discovery with intercepted responses, desktop
hover/keyboard previews, 390px tap previews, font/RGB steppers, move/resize/undo,
multi-object custom-guide snapping and guide save/reload. No real paid model call
was made; live model quality and real-device motion remain owner review items.

### Shared interactions

Layout, section and media choices have delayed hover/focus previews. Escape,
outside click and scrolling dismiss them; hovering the preview keeps it open.
Touch and narrow screens have an explicit preview-eye action. Previews are inert
and never insert content. Full section previews use the native component renderer.

Snapping runs inside the pinned engine's move/resize/create pipeline, not as a
post-drag correction. Targets include slide edges/centres, enabled object alignment
and spacing, the visible grid spacing, 100px ruler ticks, margin/third presets and
custom guides. Ctrl/Cmd temporarily toggles snapping. Configuration is scoped to
registered slide frames via WeakMap; ordinary engine documents are unchanged.
Build-time patch anchors fail closed if Excalidraw changes.

Shared select, numeric-field and tab controls now serve the lab's slide view,
transition, layout, custom font-size and RGB controls. Numeric buttons use house
chevrons, clamp to limits, and keep native keyboard input. RGB popup height follows
the actual canvas bounds, including resized notes. This is not a production-wide
design-system migration. The secondary opacity slider remains unchanged.

## Interaction model

- The top working bar keeps native Undo/Redo at left, with Editing, Current/All slides,
    and the gold Rehearse glyph grouped at right (also right-aligned on the phone's second row).
    The bottom document-status bar replaces the static Local draft
    label with live save/activity feedback, followed by visibility and activity recording controls.
    Slide position stays at the right. Recording retains its red REC state and
    stopping opens the activity log; the visibility menu opens upward from the bottom edge.
    Compact 24px-high controls fit a single 32px bar on desktop and phones.
    Feedback takes all remaining width, pushing visibility and recording toward the right-hand count.
    Long feedback is ellipsized with the full message in its tooltip.
    Library sync appears only at the bottom of the native Library panel, with its existing
    retry/sign-in action. Closing the panel does not stop synchronization. It tracks reusable
    slide objects, not the deck or content draft. Draft/save status remains global.
    Phone modal panels share the immersive case-study bottom-sheet treatment: rounded
    top corners, centered title and handle, elevated surface, dimmed blurred backdrop,
    safe-area padding and reduced-motion-aware entrance. The sheet reaches the bottom
    edge; backdrop/Close/Escape dismissal remains unchanged. Speaker notes remain inline.
- Editing off hides the insertion toolbar, properties, guides and slide-management
    controls, plus zoom, Fit, notes-toggle and help buttons. The resizable notes editor
    remains visible and editable on desktop and phone; its editing-mode open state is
    preserved. The read-only slide fits inside an elevated frame with 48px desktop or
    24px mobile clearance, capped at native size. Its border and shadow match Studio's
    device preview, without a device selector or size badge. Panning and zooming cannot
    move it out of that fit. Slide-list cards gain a neutral hover/focus highlight with
    no layout movement; selection fills and outlines the same whole card, including
    its action row, with the selected accent.
    Wheel down/right and ArrowDown/ArrowRight advance; wheel up/left and
    ArrowUp/ArrowLeft go back. Navigation stops at deck boundaries, includes all slides
    in rail order, and consumes at most one step per wheel gesture (220ms idle resets
    it). Wheel navigation is scoped to the canvas; the rail and All slides keep normal
    scrolling. Keyboard navigation defers to fields, separators, dialogs and rehearsal.
    Slide navigation and rehearsal remain available. Turning editing
    on/off keeps the same engine instance and history. Loading another slide respects
    the current editing toggle rather than the scene's saved view-mode flag.
- All slides opens a thumbnail sorter with open, move, duplicate, skip and delete
    actions. Opening a slide returns to Current slide. Editing off removes the sorter
    actions but keeps navigation available. This replaces the proposed Split view;
    there is no second preview canvas.
- Activity recording uses independent local storage `rk:slide-merge:log`, never
    Studio's `rk:elog`. Stop opens Activity log with Copy and Record again. Events
    include scene-change categories, slide/notes metadata edits, navigation, rehearsal,
    save outcomes and redacted errors. Scene changes coalesce at pointer release or
    after 600ms idle. At most 2,000 events are retained; text, notes, names, URLs and
    media bytes are omitted. This is a diagnostic summary, not a full replay stream.
- Canvas first: native compact contextual properties float on the left on desktop.
- Dropdowns share theme-aware surfaces, spacing, selected rows and line chevrons via
    customizable selects where supported; other browsers retain native pickers. Slide properties
    reuse the native inspector surface, labels and group spacing without collapse controls.
- Slides occupy the right rail on desktop, with a resize handle on its left edge.
- Drag the rail's left edge, use Left/Right arrow keys, or Home/double-click to reset.
- Rail width persists separately in `rk:slide-merge:rail-width`; mobile uses a collapsible horizontal slide strip, initially closed.
- Speaker notes have a draggable top edge, capped at half the editor height. The slide
    automatically refits as the pane grows or shrinks, leaving room for canvas controls.
    Up/Down resize, Home/End select minimum/maximum, and double-click resets to 116px.
    Notes height persists independently in `rk:slide-merge:notes-height`; text is unchanged.
- At widths up to 900px, a two-row toolbar is docked above the canvas, without a slide-title row.
    Properties and Library use bottom sheets. Notes opens a resizable pane below the canvas,
    reserving space rather than covering the slide. All panels are closed by default.
    Properties shows slide settings for an empty selection or the native object inspector
    for selected objects, including Excalidraw's different phone/tablet inspector layouts.
    Close, backdrop and Escape dismiss the sheet; nested pickers consume Escape first.
    Drawing Line is available in Draw on mobile. Guides and Fit use the actual canvas bounds.
- Each thumbnail has move up/down, insert above, duplicate, skip/include and immediate delete controls.
    Delete or Backspace on a focused slide card removes that slide in the navigator or All slides,
    without a confirmation dialog. Focus moves to the remaining selected slide. Text fields
    and canvas objects keep their own deletion behavior. The final slide can also be removed.
    Clicking a thumbnail restores its focus as loading finishes, before the next keypress.
    Empty decks persist across reloads and show Add blank, Add a layout, Add sections as slides,
    and Draft entire deck with AI directly on the canvas; the Add a slide dropdown is disabled.
    Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y restore/re-delete slides,
    including the final slide. Deletion history retains up to 20 operations for this editor session;
    reloading clears history, not the saved deck. Restores include notes, content and media references
    without overwriting other slides. New edits clear deletion Redo. Native canvas history takes
    precedence over deletion history; text fields retain their own keyboard Undo.
- Each insertion gap offers Add slide or Start section inline. On phones the choices temporarily
    occupy the adjacent thumbnail footprint, keeping both actions inside the strip.
- Start a section here sits beside the top Add a slide icon and adds a named navigator divider
    to the selected slide. Names are edited inline: Enter or blur applies a nonblank name,
    Escape cancels, and the Remove section bin removes the grouping without deleting slides.
    Blank edits leave an existing name unchanged. There is no section dialog.
- Drag a thumbnail to reorder a slide, or a section's grip to move all slides up to the
    next section together. A slide dropped into another group joins that section; moving
    its first slide keeps the heading with the remaining group. Unsectioned opening slides
    stay before named sections. Empty sections disappear. Hidden slides move with their group.
    Selection, notes and media are preserved and the order autosaves. Mouse uses a 6px threshold;
    touch uses a 200ms hold. Keyboard: Space/Enter picks up and drops, arrows move, Escape cancels.
    Drop markers follow the vertical desktop rail or horizontal mobile strip. Dragging is disabled
    while naming, busy or Editing off. Duplicate does not copy the section marker.
- Skipped slides remain editable and saved but are omitted from rehearsal. Rehearsal starts at the
    selected or next included slide, wrapping to the first included slide if needed. All skipped disables Rehearse.
- Canvas edits use engine undo. Switching to a different slide clears engine history;
    opening the already-current slide from All slides does not. Deck operations and
    notes do not share the native canvas undo stack yet.
- Selection borders and resize-handle centers use true element/group bounds, matching snap
    guides without the engine's extra selection padding. Mouse/touch hit target sizes remain
    unchanged. This is a guarded adapter for the pinned engine, not a change to slide geometry.
- Deck autosave uses isolated IndexedDB `rk-slide-merge-lab-v1`, not production storage.
- Images retain original bytes. SVG files additionally retain `originalDataURL` because the native
    engine normalizes its SVG rendering copy. No vector rasterization or media re-encoding occurs.
    Text uses the shared platform-hosted font catalogue.
- One studio toolbar replaces the native tool strip, without its tool lock or More menu.
    On desktop it is centred in the available canvas, uses its full width with 16px side gutters,
    and wraps only when the tools cannot fit on one row. Resizing the right rail adjusts that space.
- The native hamburger is hidden; View > Help opens the native Help dialog.
- Hand, Select, Text, Shapes, Arrow, Line and Draw use native engine tools. Shapes includes eight
    editable diagram presets: Start / End, Rounded process, Input / Output, Predefined process,
    Database, Connector, Triangle and Hexagon. Multi-part symbols are grouped and support native Undo.
- Manage layers, in the Actions group of slide properties, opens the shared right panel.
    The list shows front-to-back order with thumbnails, selection, rename, reorder,
    duplicate/delete, hide/show and lock/unlock. Shift/Ctrl/Cmd-click selects multiple layers.
    Drag a selected row to move the complete selection together, preserving its relative order.
    Bound labels and group members travel with their associated unit. A drop line marks the
    destination and the drag preview counts explicitly selected rows, not attached companions.
    Mouse uses a six-pixel threshold;
    touch uses a 200ms hold. Space/Enter picks up or drops, Up/Down moves, Escape cancels.
    Each completed reorder is one native Undo step. Hover, focus and selection highlight the
    whole row and reveal its actions; touch keeps the actions visible. Hidden/locked status
    indicators remain visible even on unselected rows.
    Group and Ungroup use native grouping, including bound text. Grouping an existing group
    with another layer preserves the inner group; Ungroup removes the outer group only.
    Select any member in the layer list to ungroup its outer group. Both actions support Undo.
    Add offers text, shapes and media. The left native inspector stays available for editing.
    Mobile uses the existing panel sheet. The slide frame is excluded from layer actions.
    Native reorder/duplicate/delete preserve bindings and Undo; hiding retains original opacity
    and lock state. Renaming a shape does not rename its bound text. Changes autosave with the deck.
- Slide Background > Image or video opens that same Media pane for background selection,
    including Upload media. Picking replaces only the background, keeps existing objects/notes,
    and supports native Undo. Opening Media from the toolbar still inserts a normal object.
    Hosted videos keep their original URL; uploaded images/videos retain their original bytes.
- Media opens the shared pane with the case study's images and direct videos, including covers,
    overview media and nested section assets. Upload media stays pinned below the scrolling gallery.
    Upload accepts PNG, JPEG, WebP, GIF, AVIF, SVG, MP4, WebM, MOV and Ogg video. Original uploaded
    videos persist as data URLs; hosted videos keep their original URL. Playback depends on browser codecs.
- Icons, Text, Badges, Sections and Library are direct toolbar buttons. On desktop, all insert panels
    replace the Slides list in its existing resizable right rail without changing the canvas width.
    Each uses the Slides header styling, with its title on the left and Close in the Add slide position.
    Close restores Slides at the same width. The rail edge stays draggable while a panel is open;
    its native outside-click exemption prevents resizing from dismissing the panel.
    In the lab, outside-click dismissal is limited to the canvas. Undo/Redo, notes and other
    editor controls keep the panel open; explicit Close and mobile sheet dismissal still work.
    Native Library search tabs and docking controls are hidden;
    Library content, import and insertion remain native. Mobile retains its existing bottom sheets.
    Library content uses the site's muted section labels, compact spacing, neutral menu/add controls,
    and secondary Browse action instead of native accent headings and a filled primary button.
    The duplicate top-right Library trigger is hidden, including its focusable checkbox.
- Icons searches the studio's built-in and published custom icons; insertion retains vector SVG bytes.
- Text offers editable text blocks, bulleted lists, metrics, quotes and a three-card section starter.
- Badges offers Proposed, In progress, Completed, Shipped, Concept, Under review, Released,
    Work in progress, Planned, On hold, Blocked and Key insight, plus a custom label (40 characters).
    Every insert is an independent editable shape with bound text and native Undo. Desktop panes
    stay open for repeated inserts; mobile uses the existing dismissable bottom sheet and closes
    after choosing an item. Picker controls are disabled while an insertion is running.
- Sections opens the site-section picker and inserts into the current slide as a selected component.
    Existing objects, title, background and speaker notes stay unchanged. Native Undo removes the insertion;
    move and resize the complete component on the canvas. Its internal content stays
    a case-study component, not separate native text/image shapes. This does not create a new slide.
- Add a slide offers Add blank, Add a layout, Add sections as slides, and Draft entire deck with AI.
    Per-slide controls sit below thumbnails, never over the preview.
- Both layout selectors share Stock (nine built-in layouts) and My layouts tabs, including
    keyboard tab navigation. Slide properties > Save as layout names an editable snapshot of
    the current composition, whether manually edited or generated. Text, shapes, groups,
    connections, backgrounds and original media are retained; speaker notes are not included.
    Saved previews use a fixed light canvas, independent of the surrounding UI theme.
    My layouts supports rename and confirmed deletion. Deleting a template never changes slides.
- Saved layouts live in independent IndexedDB `rk-slide-layouts-v1`, shared across slideshows
    on this browser and site origin, not inside a deck. Reload and deck replacement retain them.
    They are not yet synced across devices and are removed if browser site data is cleared.
    Storage failures keep the naming dialog open with an error; no success is reported early.
- Choosing a saved layout from Add a layout creates an independent slide with fresh element,
    group and binding IDs. Applying one from Slide properties confirms replacement of the current
    content/background, keeps speaker notes, and supports one-step native Undo. Stock layouts
    retain their existing content-reflow behavior.
- Empty media and main-content layout slots show Text, Media, Section and Icon insert buttons.
    These open the existing pickers and replace only the chosen slot, fitting content within its
    bounds in one undoable update. Controls follow zoom/pan, wrap on mobile, and stay out of rehearsal.
    Title and caption text remain directly editable without insert buttons.
- Add a layout and Add sections as slides use the same right pane (mobile bottom sheet),
    not dialogs. Their distinct headings preserve new-slide intent: choosing creates and selects
    new slides, then closes the pane. Closing without choosing leaves the deck unchanged.
    The toolbar's Sections pane still inserts into the current slide.
- Media and section pickers automatically use this browser's saved Studio draft when present,
    otherwise the published site. A `?study=<work-id>` handoff fixes the case-study context and removes
    source controls. The standalone lab shares one remembered study choice, with a compact change action.
    Production Work-tab navigation is not changed by this isolated lab release.
- Add sections as slides supports one or more selections, Space to toggle, and Clear. Add creates
    one slide per selected section in source order, retaining full prose in notes. All sections prepare
    successfully before any new slide is added; failure preserves selection and leaves the deck unchanged.
    This never modifies source content. Locked, encrypted-stub,
    vault and disabled sections are excluded. No vault resolution or decryption runs.
- Both section entry points preserve a complete source snapshot, including all items,
    nested cells, media, component settings, generated specs and referenced custom icons.
    Resting thumbnails are compact; hover/focus or the preview-eye action shows the full component.
- Section components render through the same `RK.renderStudyBlock` and `RK.enhanceBlocks`
    APIs used by Studio, with shared case-study styles, typography, R2 media resolution and
    RKGen runtime. Carousels, comparison controls, workflows, focus views, device mockups,
    media and generated interactions remain components. No rasterization, source rewriting
    or media re-encoding occurs. A fixed design-width component fits its canvas box as
    media loads; its complete snapshot survives save/reload and rehearsal.
    Protected nested content is rejected rather than silently omitted. Unknown future
    section types show a renderer-update error rather than an empty successful insertion.
    New generated specs work when supported by the shared RKGen runtime, not arbitrary code.
    External embeds and video playback retain their provider/browser permissions and codec
    requirements. Image zoom requests fullscreen when allowed; otherwise its lightbox stays
    within the component frame. Existing flattened slides cannot recover omitted source data;
    reinsert their source section to get the full component.
- Notes sits beside Help at the bottom right of the canvas and toggles independently of drawing tools.
    Mobile Slides and Properties controls sit at the bottom left. Slide titles remain in the navigator.
    Images and embedded videos share Sharp, Round and Squircle edges with an adjustable corner radius.
    Canvas, SVG thumbnails and live video clipping use the same geometry; source media stays unchanged.
    View groups native grid snapping,
    object snapping, slide-pixel rulers, safe margins and thirds.
- Fit slide is an icon button between the desktop zoom controls and Undo/Redo, using native
    footer styling. It is no longer in View. Phones retain it in the bottom-left canvas controls.
- Typography keeps three font families and S/M/L sizes upfront. The fourth buttons open the
    font library (book-type icon) and size menu (small/large type icon), using identical native controls.
    Sizes are XS/Caption 12, S16, M20, L28, XL36, XXL48, Display64 and custom values from 1 to 1000
    canvas units. Current values and mixed selections remain visible. The native size action retains
    text reflow, bound-label resizing and Undo; existing text is not migrated to presets.
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
- The editing workspace outside the slide uses the isometric case-study component's exact theme-aware
    radial gradients. A slide-shaped cutout follows pan and zoom; slide content, thumbnails and rehearsal
    retain their own backgrounds. The workspace decoration is not stored in the scene.
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
`node --test slide-merge-layers.test.mjs` checks layer ordering, frame protection, bound-text
visibility, lock restoration and independent naming. Browser checks cover native bound-shape
duplication/deletion and Undo, reorder, multi-selection, saved names and desktop/mobile placement.
`node --test slide-merge-layouts.test.mjs` checks editable template capture, original media,
independent instances and reference remapping. Browser checks cover IndexedDB persistence,
cross-deck reuse, rename/delete, storage failure, one-step Undo and both tabbed selectors.
`node --test slide-lab-selection-bounds.test.mjs` checks native outline and handle alignment
at 25/50/100/200% zoom, unchanged pointer hit sizes and fail-closed upstream patch anchors.
`node --test slide-lab-typography.test.mjs` checks native size-action preservation, selection
resolution and guarded patch anchors. Browser checks cover presets, custom validation, Undo,
font selection, keyboard navigation and light/desktop plus dark/mobile popup geometry.
`node --test slide-merge-sections.test.mjs` checks source privacy filters, conversion, full notes,
text excerpts, original media URLs and R2 path normalization.
`node --test slide-merge-inserts.test.mjs` checks content starters and ruler coordinates.
It also checks all badge presets, custom-label limits and slide-local sizing.
`node --test slide-merge-diagrams.test.mjs` checks native diagram geometry, IDs and grouping.
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