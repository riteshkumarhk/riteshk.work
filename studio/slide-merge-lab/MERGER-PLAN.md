# Slide Studio Merger Plan

Status: proposed for owner review, 2026-09-10. This document authorizes no implementation, migration, publishing or deployment.

## Recommendation

Replace Content Studio's slide-editing surface with the lab's editor, not with a link or iframe to the standalone lab. Content Studio remains the owner of case studies, draft persistence, authentication, publishing and application navigation. Extract the lab's reusable editor and presentation renderer behind an explicit host interface.

The result should feel like one Studio: open a case study, choose Slideshow, edit with the new canvas, rehearse, and publish through the existing workflow. The standalone lab can remain a development harness during the transition, but must not become a second production writer for the same deck.

Do not remove the old reader or delete existing slide data when the new editor first mounts. Replacement is complete only after compatibility, privacy, recovery and owner acceptance gates pass.

## What Is Already Shared

- Both editors use the same presentation controller, DJ pad, clocks, laser and native presenter bridge.
- The lab already reuses case-study sections, media, icons and the configured AI provider through adapters.
- The library has its own authenticated synchronization path; it is not deck synchronization.
- The design system is shared in intent and many components, but the lab currently reads published typography independently of Studio's in-memory draft settings.

The largest remaining work is data ownership, legacy compatibility, editor lifecycle and publishing, not rebuilding presenter controls.

## Verified Integration Boundaries

| Boundary | Current state | Required outcome |
| --- | --- | --- |
| Production deck | Case-study data uses `study.slides`; the existing editor rebuilds its stage during `renderL2` | Stable per-case-study editor session, compatible document reader |
| Lab deck | One IndexedDB `draft` in `rk-slide-merge-lab-v1`, with native scenes and files | Host-supplied document and revision; no shared global draft in production |
| Draft size | `saveDraft` serializes the entire Studio document into localStorage | Asset-aware durable storage; no inline scene-file explosion or false Saved status |
| Host DOM | Production currently replaces stage and inspector HTML | A mount point that is not destroyed by routine host status updates |
| Authoring history | Lab canvas/deck history is separate; Studio retains up to 80 whole-document JSON snapshots | One Undo/Redo routing policy, without duplicate history or repeated binary copies |
| Recovery | Owner backup downloads the whole plaintext draft; selective restore replaces case studies by ID | A self-contained private backup, including any sidecar scene assets, and revision-safe restore |
| Visibility | Lab `slidesPublic` is draft intent; its export helper is not a publisher | Existing private/public policy enforced by the actual publish path |
| Public payload | The lab helper rejects native section components and several embed/media cases | Complete validated audience format before public native-scene publication |
| Presentation | Shared controller, different slide renderers | Dispatch by document format; no editor controls or private notes in audience output |

Source anchors: [production editor](../../src/js/admin-studio.js#L6629), [lab saving](../../src/js/slide-merge.jsx#L422), [lab storage](../../src/js/slide-merge-core.mjs#L84), [public payload contract](../../src/js/slide-merge-visibility.mjs#L59), [shared presenter](../../src/js/deck-presenter.mjs#L6).

## The Intended Workspace

- Keep Content Studio's case-study navigation, identity, publishing actions and shared status/footer.
- The new editor owns the available slide workspace: canvas, floating object/slide properties, right-hand slide navigator, native library/content panes, and resizable notes. Preserve the lab's current interaction model rather than keeping both old and new inspectors.
- Show one set of history controls, one Current/All slides switch, one Editing/Rehearse control, one Slide Show action, and one save/visibility/activity status area. Map those actions to the existing Studio bars; do not stack duplicate headers or footers.
- When Slideshow is active, reclaim the old slide navigator/inspector columns for the new workspace. Other Content Studio tabs retain their existing layout. Returning to Story restores its prior selection and scroll position.
- Keep mobile's docked tools and bottom sheets. Test the integrated workspace at 320/390 pixels as well as desktop; fitting the standalone page is not sufficient.
- Use the host's active draft typography, theme, icon registry and component styles. Portal dialogs, native menus, focus/hover/disabled states and real loaded fonts are part of acceptance, not a later cosmetic pass.
- Keep authored font IDs, layout and media independent of UI typography changes. Size the canvas and tools against the available Studio workspace, not the standalone page's viewport assumptions.
- Do not expose a new login, provider setup, save dialog or case-study selection step when the host already supplies that context.

This layout is a proposed choice for review, not permission to rearrange the rest of Content Studio.

## Document And Host Contract

Use a versioned native deck document and an explicit engine-version marker. Keep stable case-study, slide, element, group and asset identities; array indices must not identify an asynchronous save destination.

Choose the precise persisted field names after checking every serializer, encryption branch, backup reader and renderer. A new scene field must never pass through an old publisher as unrecognized plaintext.

The editor needs a small host contract, with names finalized during implementation:

- Mount with a case-study identity, immutable document snapshot, revision and capabilities.
- Emit document changes and transaction boundaries separately from selection, zoom, hover and other session UI state.
- Flush pending text, pointer gestures, notes and queued writes before navigation, preview, publish, backup, import or deck switch. Abort the transition with an actionable error if durable saving fails.
- Reject stale writes when a case study changes, is deleted, is restored from backup or receives a conflicting update. Serialize saves; do not let a late callback overwrite a different deck.
- Supply media picking/resolution, complete eligible section data, icon/layout/library access, active typography, AI access, status reporting and presentation through host adapters.
- Dispose listeners, React roots, observers, native portals, media, pending requests and presenter windows cleanly on unmount.

Content Studio owns production persistence. A per-document recovery cache may supplement it, but cannot silently compete with it. Keep binary media out of a growing localStorage JSON blob; the asset-storage strategy must preserve original bytes and support existing private-media policy before it is adopted.

Recommend a host-owned durable document/asset store with revisioned references in Studio data, reusing existing storage utilities where suitable. A commit must make both document and assets recoverable before reporting Saved. Asset references in history must remain resolvable after reload/restore; garbage collection cannot remove bytes still needed by history, backups or rollback. This is a slide-storage extension, not a rewrite of unrelated Studio storage.

Route editing-field Undo to the field, slide-workspace commands to the editor's transaction coordinator, and other Studio commands to host history. Decouple persistence acknowledgements from history recording so the same gesture is not recorded twice. A host restore must cancel stale saves and replace the active editor document/history before it can emit another change.

Use one authoritative representation per deck. Retain an immutable legacy checkpoint for rollback; do not continually rewrite both legacy and native representations as competing sources of truth.

## Legacy Deck Migration

Migration is copy-first and reviewable. Opening an existing deck for inspection must not rewrite it. Measure actual saved data and prepare representative fixtures before choosing conversion rules.

| Content | Conversion requirement |
| --- | --- |
| Layout slides and freeform blocks | Preserve slide order, IDs, titles, geometry and background; translate percentage-based placement to the fixed scene coordinate system |
| Text | Preserve content, typography, alignment, wrapping and rich formatting; never silently reduce rich text to plain text |
| Shapes and connectors | Preserve fill, stroke, corners, rotation, opacity, stacking, locks, groups and bindings where represented |
| Images and video | Preserve original bytes/URLs, aspect, crop, playback and poster/background behavior; do not flatten or re-encode |
| Native/generated sections | Retain complete interactive components and their referenced media/icons, not an image or first-item approximation |
| Navigation | Preserve hidden slides, section headings, links and slide-jump targets through reorder/duplication/migration |
| Speaker metadata | Preserve notes, their formatting where supported, and per-slide timing budgets independently of public audience content |
| Saved layouts and library | Inventory both stores/formats; retain names and reusable content, with explicit conversion or continued compatibility |

If a feature cannot be faithfully converted, show a precise compatibility report and keep the original editable in the old editor during the transition. Do not mark conversion successful because a screenshot looks similar. A temporary legacy component adapter is acceptable only if its limitations are explicit; it does not count as native editing parity.

An existing standalone lab draft is a separate source. Offer an explicit copy/import into a chosen case study, preserve the source draft, detect duplicates, and never overwrite a case-study deck automatically.

## Privacy, Publishing And Viewing

Private and public behavior must be complete before the replacement becomes the default. A visibility toggle is not enough.

- The current [publish builder](../../src/js/admin-studio.js#L11862) clones the whole draft; [deck encryption](../../src/js/admin-studio.js#L11889) handles `study.slides`, and the public branch leaves those slide objects plaintext. Add a central schema gate for automatic and manual publishing before any pilot document can enter Studio data. It must still apply after the editor is closed. Do not rely on the old branch to remove speaker metadata or protect a new sibling field.
- Preserve the existing owner-only default and encrypted-deck access flow. Authentication/unlock happens in the host; plaintext scenes, notes and private asset references must not leak into public JSON, thumbnails, logs or backups intended for public use.
- Preserve unopened encrypted decks unchanged when publishing a different case study. Verify owner unlock, whole-project protection, revoked access and re-publication without assuming every protected deck has already been decrypted in memory.
- Separate the owner authoring document from the public audience payload. Exclude notes, budgets, hidden/deleted content, history, selection and private provenance unless a field has an explicit approved audience purpose.
- Revalidate all included components and nested media on public export. Review consent cannot be a permanent boolean that remains valid after the document or source changes.
- Extend or replace the lab's narrow public allowlist deliberately. It currently rejects native sections, remote/protected media and some connector features; never bypass those checks simply to make Publish work.
- Ensure private media is not uploaded to the public media store just because it was added to a private deck. Validate media resolution, owner access, encryption and public-cleared copies end to end.
- Publish document metadata and referenced assets as one coherent revision, with failure recovery and cache/version handling. Test failed uploads and missing assets before any live rollout.
- Maintain the distinction between [private owner backup](../../src/js/admin-studio.js#L13149) and public/manual export. Recovery bundles must include all required scene/assets and version metadata, without credentials; selective restore must rehydrate assets before activating the restored deck. Existing backup files remain readable.
- Preserve existing case-study Play entry points and legacy deck viewing. Add a read-only native-scene viewer selected by format; keep live components/media interactive, and keep editing tools and private metadata out of audience mode.
- Keep the large authoring engine off ordinary portfolio and non-slide Studio routes. Lazy-load the editor and any required audience renderer only when their entry point is used.
- Promote native section/media rendering to an explicitly supported runtime rather than depending on lab fixture URLs or demo bootstrap data. Retain useful component iframes where necessary, with validated messages and expected origin/source checks; this is distinct from wrapping the whole editor in an iframe.

Browser launch constraints remain a separate limitation: a normal browser cannot currently satisfy the requested one-click fullscreen plus floating DJ pad plus consent-free live capture. Do not make a manual retry an acceptance substitute. The native Windows path supports the intended automatic presentation flow; real meeting-app acceptance remains a separate gate.

## Delivery Phases

### 1. Inventory And Contract

Trace draft saving, publishing/encryption, backups, public viewing, legacy exports and media handling. Inventory real deck features without changing them. Define schema, migration categories, host capabilities and data-size budgets.

Exit gate: agreed document/host contract, compatibility matrix and a tested backup/restore procedure. Identify unsupported rich text, links, sections or asset cases before promising automatic migration.

### 2. Reusable Core And Recovery

Separate the lab's self-starting page/storage bootstrap from a reusable editor module. Introduce host persistence and lifecycle adapters, stable IDs/revisions, scoped styles and deterministic cleanup. Keep the existing standalone lab working against its current store.

New production decks start empty, not with the lab's two demonstration slides. Loading a document must not automatically persist a migrated version or expose the lab's test globals in production.

Exit gate: mount/edit/flush/unmount/remount on a disposable deck, exact document/asset roundtrip, failed-write recovery and no event/history leakage. No production deck migration or publish-format change yet.

### 3. Content Studio Pilot

Mount the new editor behind a local opt-in for a copied case study. Connect shared bars, host draft data, typography, sections/media/icons, AI and library access. Disable old slide-only handlers while the new editor owns the workspace. The central publish gate must reject unsupported pilot documents rather than leaking them through an otherwise normal publish; publish-capable pilot formats wait for Phase 5.

Exit gate: edit, switch tabs/case studies, reload, Undo/Redo, resize notes/panes and reopen without lost content, duplicate controls or shortcut conflicts. Owner reviews the integrated desktop/mobile workspace before rollout proceeds.

### 4. Compatibility And Migration

Implement legacy conversion and reports against the inventory; add missing compatibility rather than silently discarding features. Support explicit copying of the existing lab draft. Preserve original checkpoints and verify each migrated deck's appearance, editability, metadata and media.

Exit gate: all required legacy features pass roundtrip and editing tests; unresolved cases remain on the legacy path. No bulk overwrite.

### 5. Publish And Audience Integration

Add the approved owner/public serialization, encryption, asset resolution, backup/import and versioned viewer paths. Test public, owner-only and protected-content cases using isolated data. Include native presenter routing and the shared DJ pad/laser.

Exit gate: publish/read/reopen/re-edit roundtrip, privacy tests, original media fidelity, correct public entry points and failed-publish recovery. Any necessary Worker/storage change requires a separately reviewed deployment plan.

### 6. Default Switch And Retirement

After owner approval, switch the existing Slideshow entry point to the new editor. Roll out to copied/pilot decks first, then explicitly migrate the remaining decks. Keep the old reader and restore checkpoints through the agreed rollback window.

Exit gate: real owner workflows accepted, no unsupported decks silently stranded, and a demonstrated rollback. Only then remove the old editor's UI, event handlers and unused CSS. Retaining legacy viewing support is not the same as retaining two competing editors.

## Acceptance Checklist

- Existing decks, empty decks, hidden slides, sections, notes, timing and media survive edit/save/reload/backup/restore exactly where fidelity is required.
- Conversion preserves editable text and shapes; every lossy or unsupported case is reported and blocks automatic cutover.
- Publish includes the latest pending edit; quota failures, offline saves, rapid case switches, deletion, concurrent tabs and restore conflicts cannot lose or misroute edits.
- Native canvas Undo, deck Undo and Studio Undo have clear ownership; input fields retain their normal editing shortcuts.
- Story, Work, media management, settings, live preview, import/export and ordinary publishing still work when the slide editor is mounted and after it closes.
- Public responses and referenced assets contain no owner-only slides, notes, hidden content or protected source data; malformed/stale payloads fail closed.
- Audience mode remains read-only while video, embeds and section controls stay usable. Presenter close/navigation/reset cleans up both windows.
- Desktop, 320/390-pixel mobile, light/dark host contexts, dialogs, keyboard/touch, reduced motion and actual loaded fonts match the design system.
- Measure initial-load cost, mount time, interaction responsiveness, memory/listener cleanup and larger decks against today's lab before setting release budgets.
- Unit/adapter tests, existing slide suites, real-browser integration tests, both builds and generated-asset security checks pass. Real GPU/media and meeting-app checks are explicitly recorded rather than inferred from headless tests.

## Rollback Rules

The pilot is opt-in. Switching it off restores the legacy editor only for untouched legacy documents or a verified pre-migration checkpoint. Never open a newer native document in the old editor and let it save a reduced version.

Preserve post-migration native edits separately before restoring an old checkpoint. Once a new public document format has shipped, rollback must retain its reader/assets or restore a matching older published revision; changing only the editor flag is insufficient.

Do not delete source decks, lab drafts, assets or migration backups as part of the default switch. Agree retention/cleanup separately after acceptance.

## Morning Review

Recommended defaults to approve or revise:

1. One Studio workspace, using the lab's canvas/properties/right-navigator arrangement and the host's shared bars.
2. Direct reusable-module integration, not an iframe wrapper or a rewrite of all Content Studio.
3. Copy-first migration with explicit compatibility reports and no silent flattening or rich-text loss.
4. Existing private/public security policy retained; publishing and backup compatibility are release gates, not deferred cleanup.
5. Staged pilot and owner acceptance before replacing the default editor; old reader/checkpoints retained for rollback.

Implementation starts only after the owner reviews this plan and gives the go-ahead. No background migration, real publish, paid AI call or deployment is part of preparing this document.