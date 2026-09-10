# Slide Editor Comparison

Assessment date: 2026-09-10. Baseline: release `89f5e57`.

Implementation follow-up: the requested lab work now adds rich speaker notes,
full-deck session history, external embed placement, Studio icon generation,
draft resources/saved-layout compatibility, contextual text improvement and
complete component/video navigator previews. The findings below describe the
original baseline, not the current implementation status. Actual publishing,
full legacy deck migration and backup/import remain merger work; native slide
text still does not have mixed rich-text formatting.

## Verdict

The lab is the better foundation for the merged drawing workspace, but it is not yet a drop-in replacement for Content Studio's slide editor. Its main deficits are document lifecycle and recovery, rich authoring, and several presentation-specific controls. Similar-looking canvases do not imply compatible documents or identical editing behavior.

This is a research report, not approval to implement the merger. The existing [merger plan](MERGER-PLAN.md) remains pending review.

## Evidence And Limits

- Read the current application code, not just the older lab adoption notes.
- Used visible Playwright checks on the existing lab tab to inspect text properties, context actions and the keyboard-opened Properties panel. Restored selection and verified the authored document was unchanged.
- Opened a separate local origin on port 5511 for a disposable Content Studio sample. Inspected real rich-text/notes, icon properties and bulk slide controls. External non-read requests were blocked; no publishing, paid AI requests or private-deck decryption was performed.
- Compared real reorder/Undo behavior in both editors on disposable decks: Content Studio restored the original order; the lab offered only disabled "Undo slide deletion" after reorder.
- Ran synthetic checks of the lab public payload: notes were omitted, element links were stripped, native sections were rejected, and hosted video export was rejected.
- This is not exhaustive visual parity for every saved deck, third-party embed, media codec or AI output. Findings labeled partial need targeted acceptance work rather than an assumption of equivalence.

## Replacement Blockers

### 1. Production Deck Lifecycle And Migration

Content Studio manages `study.slides` per case study and reads its encrypted counterpart. The lab stores one native-scene deck under one IndexedDB `draft` key. There is no implemented adapter that opens existing production decks or their saved layouts as equivalent native scenes.

Required: versioned per-case-study documents, copy-first conversion, stable identities, explicit unsupported-feature reports, and host-owned save/flush/conflict handling. Do not overwrite the production data or the standalone lab draft.

Evidence: [Content Studio legacy conversion](../../src/js/admin-studio.js#L6805), [lab deck store](../../src/js/slide-merge-core.mjs#L84), [lab startup and saving](../../src/js/slide-merge.jsx).

### 2. Publishing, Private Access And Public Viewing

Content Studio has the publishing pipeline, owner-only deck encryption/unlock and case-study Play entry point. The lab's visibility setting explicitly describes a future publishing intent; it is not a connected publisher or access-control implementation. Its shared library sync does not synchronize or secure decks.

The lab's public export helper is intentionally incomplete: native section components, remote video media and fixed elbow segments are rejected. Element hyperlinks are set to null. It cannot currently ship all content the lab can author.

Required: separate owner and audience documents, complete allowlisted component/media rendering, private asset handling, authorization and public/native-scene viewing before default replacement. Do not remove protective checks to make export succeed.

Evidence: [lab visibility UI](../../src/js/slide-merge-visibility.jsx), [public payload](../../src/js/slide-merge-visibility.mjs), [production publisher](../../src/js/admin-studio.js#L11862), [public Play availability](../../src/js/project.js#L2132).

### 3. Full-Deck Backup, Restore And Portability

Content Studio can download a private full-content JSON backup and restore selected case studies. The lab has no corresponding user-facing full-deck backup/import/restore workflow. Local library import/export and PNG/SVG clipboard output are not editable deck backups.

Required: a versioned document-plus-original-assets roundtrip, including notes, budgets, hidden slides, components and custom data; existing Content Studio backups must remain readable.

Evidence: [owner backup](../../src/js/admin-studio.js#L13149), [selective restore](../../src/js/admin-studio.js#L13248), [lab engine options and entry point](../../src/js/slide-merge.jsx).

### 4. Full Deck-Level Undo/Redo

Content Studio snapshots the whole draft. In the lab, native history covers the active canvas and a separate 20-entry history covers slide deletion. Reorder, add/duplicate, skip/include, section-name changes and metadata are not integrated into the same deck history. Loading another slide clears native canvas history.

This is directly observable: reorder two slides, then try Undo. The current editor restores them; the lab's deletion Undo remains disabled. Good object-level Undo does not close this gap.

Required: explicit document transactions and coherent history routing, without recording every gesture twice or duplicating binary assets in snapshots.

Evidence: [production history](../../src/js/admin-studio.js#L522), [lab history routing](../../src/js/slide-merge-bar.jsx#L10), [deletion history](../../src/js/slide-merge-history.mjs), [lab deck operations](../../src/js/slide-merge.jsx#L481).

### 5. Rich Slide Text And Speaker Notes

The current editor supports mixed bold/italic/strikethrough, muted spans, structured bullets/numbering and indentation, inline images and contextual Improve with AI. It also exposes line height, tracking, vertical alignment, and text-box background/padding/corners.

The lab's native text is a plain string with element-wide font, size, color and alignment. Its list starter inserts bullet characters, not a structured rich-text list. Speaker notes use a textarea; the lab presenter escapes their contents as text. Pasting legacy HTML into that model is not a migration solution.

Required: preserve rich content as editable content or provide an explicitly approved compatible component. Do not silently strip formatting or flatten text to an image. Mixed formatting and rich notes are independent of how many font families are available.

Evidence: [rich toolbar](../../src/js/admin-studio.js#L1682), [rich notes](../../src/js/admin-studio.js#L6375), [text inspector](../../src/js/admin-studio.js#L7571), [plain list starter](../../src/js/slide-merge-inserts.mjs#L31), [lab notes rendering](../../src/js/slide-merge.jsx#L247).

## Other Missing Or Partial Capabilities

| Capability | Content Studio today | Lab today | Assessment |
| --- | --- | --- | --- |
| Standalone external media | Source URL field; renderer recognizes YouTube/Vimeo, Figma, PDF and Office/OneDrive embeds | Media pane offers eligible case-study image/video or file upload; direct media import accepts image/video types and embed validation is lab-specific | Missing equivalent URL/embed authoring. Whole section components may contain embeds, which is not the same workflow |
| Slide-jump actions | Any freeform element can open a URL or jump to a numbered slide | Native Add link and Copy link to object exist, but no deck-aware slide-jump control/adapter | Ordinary URLs are present; slide navigation actions are missing |
| Editable icons | Icon identity plus Change icon and color controls | Library SVG is serialized with explicit ink and imported as an image | Original SVG bytes remain; semantic recolor/replace-icon editing does not |
| Effects and media styling | Soft/medium/strong shadows; media border and corner controls; text-box padding/background | Shape fills, opacity, custom rectangle corners and image cropping exist; no corresponding general shadow or text/media style controls | Partial, with migration fidelity risk |
| Multi-slide operations | Ctrl/Cmd selection; bulk Duplicate, Hide/Show and Delete | One selected slide; per-slide actions and section drag | Bulk slide selection/actions missing. Object/layer multiselect is a different capability |
| Collapsible slide sections | Named sections can collapse/expand in the navigator | Sections can be named, renamed and dragged as groups, but not collapsed | Missing navigation convenience |
| Align/fill/match shortcuts | Align one item to slide; Fill slide; same width/height as first selected | Native align/distribute and geometry tools exist; no matching explicit slide-relative/ref-item commands found | Partial workflow; assess desired parity, not a claim that geometry editing is absent |
| Contextual text AI | Improve selected text/notes from the rich editor | Grounded whole/selected-case deck drafting and review, not inline text improvement | Missing focused writing action despite stronger deck composition |
| Reusable layouts | `data.slideLayouts` in Studio data; legacy layout snapshots make placeholders | Separate local layout DB; native snapshots retain actual elements and referenced media | Feature exists, but storage, semantics and existing layouts are not interchangeable |
| Current Studio draft context | In-memory case study, current icons and draft settings | Section/AI loaders prefer a local draft; typography and icon registry refresh from published data | Partial context parity; unpublished fonts/icons/settings can disagree |
| Protected source content | Host can unlock protected content and uses existing vault/media mechanisms | Source eligibility deliberately excludes locked/protected studies, sections and media | Authorized owner workflow must be integrated; do not bypass the guards |
| Navigator media thumbnails | HTML media/component rendering | Ordinary slide thumbnails use SVG export; presenter thumbnails add live embed layers separately | Direct video/embed thumbnail fidelity needs completion, not just presenter parity |
| Grid semantics | 12-column layout grid | Native pixel grid/object snapping, rulers and saved guides | Different systems, not a missing generic grid. Decide whether the 12-column option must also survive |

Source anchors: [legacy object controls](../../src/js/admin-studio.js#L7483), [media renderer](../../src/js/project.js#L86), [lab media import](../../src/js/slide-merge.jsx#L729), [icon insertion](../../src/js/slide-merge-library.jsx#L29), [production bulk/sections](../../src/js/admin-studio.js#L6492), [lab navigator](../../src/js/slide-merge-navigator.jsx#L39), [saved layouts](../../src/js/slide-merge-layouts.mjs), [source eligibility](../../src/js/slide-merge-sections.mjs#L7), [typography source](../../src/js/slide-merge-typography.mjs#L7).

## Already Present Or Stronger In The Lab

- All nine named stock layout families, background colors/media and None/Fade/Push/Magic Move transitions are represented. This is feature-level parity, not pixel-identical conversion.
- Complete eligible case-study sections can be inserted and remain interactive. Neither editor automatically keeps the copied component synchronized with future source edits. The old in-place Replace section/mirror workflow still needs parity review.
- The shared Slide Show controller, DJ pad, clocks, notes/budgets, laser and native bridge already exist in both; do not rebuild them as a merger task.
- The lab is stronger in drawing tools, connector editing, shape variety, custom corners, color picker, native grouping/bindings, detailed layers and multi-layer drag.
- Copy/paste styles, flip, grouping, locking, native hyperlinks and PNG/SVG clipboard output are present in the native context menu. They should not be listed as absent merely because the old inspector shows them elsewhere.
- Numeric position/rotation controls are accessible through the native Properties/Stats panel via Alt+/. They are not absent, but their discoverability and integration differ from the old always-present inspector.
- The lab adds a richer authored font catalogue, saved native layouts, authenticated reusable-library sync, measured-fit grounded deck drafting, hover previews and an editing-off rehearsal workspace. Actual model output quality was not evaluated in this study.
- The lab has a dedicated phone/touch workflow; that is an advantage over the legacy desktop-centered editor, not proof that every phone control/state is fully accepted.

## Important Shared Caveats

1. **Public notes privacy:** the existing production publisher clones full slide objects and skips encryption for public decks; it does not strip their notes at that branch. "Not drawn on the audience slide" is not "absent from public JSON." No live private-content exposure audit was performed here. The merger must use an explicit audience-only payload rather than reproduce this behavior.
2. **One-click browser launch:** both use the shared controller. Fullscreen, floating presenter activation and capture consent remain the same browser restriction; this is not a lab-only regression.
3. **Export expectations:** PNG/SVG clipboard output, a full editable deck backup, and PPTX/PDF export are different products. Office/PDF viewing in the old media renderer is not native editable PowerPoint roundtrip/export support. Do not describe PPTX export as a legacy capability lost by the lab without separate evidence.
4. **Original media:** native image bytes are preserved, but storage/export/preview semantics can still differ. Byte fidelity alone does not establish equivalent cropping, borders, playback, captions or thumbnail rendering.

## Recommended Order

1. Agree the authoring document, original-asset store, private/public audience contract and faithful legacy conversion.
2. Close rich-text/rich-notes and full deck-history gaps before broad migration.
3. Restore presentation-oriented authoring: external media URLs, slide-jump actions, semantic icons and required object styles.
4. Add bulk slide management and reconcile layouts, active draft context, authorized sources and precise-layout shortcuts.
5. Pilot copied decks inside Content Studio, then validate real owner workflows and publish/read/reopen roundtrips before replacing the default editor.

The recommendation is to proceed with the lab as the foundation, but not to remove the old editor yet. Preserve the old reader and recovery checkpoints until the required capabilities have passed acceptance or an intentional difference has been explicitly approved.