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
- Preserve the opacity slider without visual or behavioral changes.

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
| Dialogs | Save layout blank-name guard, Cancel/Escape, neutral close, delete confirmation and accessible names checked. No content deleted. |
| Reading/rehearsal | All slides has two cards; Editing off hides tools and keeps notes; rehearsal controls and viewport fit checked. |
| Responsive | Desktop 1600px, narrow desktop 1024px and phone 390px inspected. Mobile object-sheet screenshots checked in dark/light; naming dialog fits. |

Original media and deck content were not intentionally changed. This pass does
not certify every native engine popup, assistive-technology combination, Safari
fallback, authenticated library sync or real-device video/animation performance.

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