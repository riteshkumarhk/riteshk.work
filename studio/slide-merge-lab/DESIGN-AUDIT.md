# Slide Editor Design Audit

Scope: the isolated merger lab. This is a design-consistency pass, not a complete
accessibility certification or approval to migrate production Studio.

## Corrections

- Slide inspector: replace the raw plus/minus with the shared line chevron,
  expose expanded state and enlarge its header target to 28px.
- Destructive actions: share the danger token, including native object Delete.
  Use a deeper red on light surfaces; keep close controls neutral.
- Layers Add: use the existing ToolMenu for viewport placement, click-away,
  Escape and focus return. Keep the parent panel open when dismissing the menu.
  Menu rows retain 36px height, left alignment and 8px padding.
- Accessibility labels: name Library actions and associate the delete-slide
  confirmation with its heading. The library adapter remains lab-scoped.
- Preserve opacity's native value, fill, geometry and keyboard behavior. Its
   track now uses secondary `--text-dim`; primary sliders use `--accent` gold.
- Read the published typography configuration at startup and window focus,
   with R2-to-Pages fallback. Load the actual active font faces; do not infer
   typography from the historical `--serif` token name. Build-time local faces
   provide the initial snapshot, while external/custom families load at runtime.
- Match narrow and wide Studio dialog variants, including display typography,
   surfaces, equal-width narrow actions and neutral wide close buttons.
- Capture dialog focus before controls become disabled; restore after unmount.
- Theme native body-level portals, not only descendants of the editor root.
   Help retains shortcuts and a neutral Close button, without external links.
- New layouts start with editable "My layout", with Save immediately enabled.
- Editing on/off and Current/All slide controls share a stable 34px height.
- Help omits frame, laser, native image-import, reset-canvas, native theme-toggle
   and view-mode shortcuts not supported by the merger workflow. Supported native
   editing shortcuts remain; this changes documentation, not engine capabilities.

## Coverage

| Surface | Evidence and outcome |
| --- | --- |
| Header, tools, navigation | Existing shared icons and whole-card selection retained; Current/All switching and Editing off checked. |
| Slide inspector | Layout/Background disclosures, transition select, collapse, preset tabs and My layouts empty state checked. |
| Object inspector | Shape, text, alignment, corners, opacity and actions inspected; dark/light danger verified. |
| Color controls | Desktop advanced picker fits; swatches, spectrum, Hex and RGB share the panel treatment. |
| Font controls | Shared font family and quick choices retained; full catalogue interaction needs a separate exhaustive pass. |
| Insert panels | Icons, Text, Badges, Sections, Media and Library opened in the real editor; no horizontal rail overflow, inputs start-aligned. |
| Empty/unavailable states | Empty Library, empty My layouts, no-match icon search and signed-out sync status checked. Forced network/storage failures not exercised. |
| Layers | Real list, disabled controls, Add menu placement/dismissal/focus and corrected row spacing checked. |
| Dialogs | Save layout default and blank-name guard, Cancel focus return, neutral close, delete confirmation and accessible names checked. Native Help portal and mobile visibility confirmation measured. No content deleted. |
| Reading/rehearsal | All slides has two cards; Editing off hides tools and keeps notes; rehearsal controls and viewport fit checked. |
| Responsive | Desktop 1600px, narrow desktop 1024px and phone 390px inspected. Mobile object-sheet screenshots checked in dark/light; naming dialog fits. |

Original media and deck content were not intentionally changed. This pass does
not certify every native engine popup, assistive-technology combination, Safari
fallback, authenticated library sync or real-device video/animation performance.

## Phase 1 Boundary

Visibility is a local draft intention, private by default. It is not a publishing
action and does not change any live slideshow. The future public-payload builder
requires explicit public intent and source-review confirmation; it excludes notes,
skipped slides and owner metadata, rejects protected or unsupported sources, and
preserves supported inline media bytes, including separate original SVG bytes.
Original media may itself contain sensitive content or metadata: automated
filtering is not a substitute for the required review. No production publisher,
Worker or vault integration is included. Later AI/snapping phases remain deferred.

The September 8 follow-up verified real Bureau fonts, narrow dialog screenshots,
mobile 390px bounds, light/dark secondary slider colours, default Save state,
Cancel focus return, and Help's portal/close/link removal. Source parity tests are
regression guards, not proof that every engine popup has been visually audited.

## Preserve And Promote

Ordered by value for a future shared component library, not by rollout approval.

1. **Value-aware slider.** Preserve the visible value, filled track and direct
   manipulation. Useful for opacity, scale and intensity. Retain native keyboard
   semantics; decide shared color tokens separately from the component behavior.
2. **Scrubbable numeric field with steppers.** The corner-radius control supports
   quick adjustment and exact entry in one small field. Reuse for spacing, radius
   and dimensions, retaining min/max, typed entry and non-drag alternatives.
3. **Visual choice groups.** Stroke, alignment and corner options show the result
   instead of making users decode labels. Reuse for small, mutually exclusive
   visual sets, with accessible names, selected state and clear keyboard focus.
4. **Quick palette plus advanced color picker.** Frequent choices stay one tap
   away; spectrum and numeric entry remain available without crowding the panel.
   Reuse for theme and content colors while keeping those two token sets separate.
5. **Preview-first preset pickers.** Layout and text cards make options inspectable
   before insertion. Reuse for section templates and media layouts; keep stable
   previews, short labels, stock/saved tabs and meaningful empty states.
6. **Contextual rail with a mobile sheet.** One predictable region hosts insertion
   and management tools. Reuse the interaction contract: stable header, neutral
   close, scrollable content, focus return and nested-popup dismissal priority.

Supporting patterns worth retaining: inline naming, whole-item selected surfaces,
keyboard-capable reordering, resizable panes and the shared top-layer menu.
These improve repeated work, but should remain patterns rather than mandatory
chrome on every screen. Compact desktop targets are not a universal touch-size
standard. Shared adoption needs light/dark, focus, disabled, error, touch and
reduced-motion variants before production rollout.