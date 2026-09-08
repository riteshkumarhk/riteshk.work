# Slide Merger Lab

Isolated editor experiment at `/studio/slide-merge-lab/`. Production editor,
published content, private decks, authentication and publishing are untouched.

## Interaction model

- Canvas first: native compact contextual properties float on the left.
- Slides occupy the right rail on desktop. Only this rail has a resize handle.
- Drag the rail's left edge, use Left/Right arrow keys, or Home/double-click to reset.
- Rail width persists separately in `rk:slide-merge:rail-width`; mobile uses a horizontal slide strip.
- Add, rename, duplicate, reorder and confirm-delete slides; edit notes; rehearse.
- Canvas edits use engine undo. Switching slides clears that slide's engine history.
- Deck autosave uses isolated IndexedDB `rk-slide-merge-lab-v1`, not production storage.
- Images retain original bytes. Text uses the shared platform-hosted font catalogue.
- One studio toolbar replaces the native tool strip, without its tool lock or More menu.
- Hand, Select, Text, Image, Shapes, Arrow, Line and Draw use native engine tools.
- Icons searches the studio's built-in and published custom icons; insertion retains vector SVG bytes.
- Content inserts editable text, lists, metrics, quotes, badges and a three-card section starter.
- New slide lives in the slide rail: Blank, Title, Two columns and Product flow.
- Notes toggles independently of drawing tools. View groups native grid snapping,
  object snapping, slide-pixel rulers, safe margins, thirds and Fit slide.

## Build and checks

`npm run build:slide-lab` builds both labs into shared assets and scans generated
JavaScript for Google API key patterns. The engine adapter removes upstream Firebase configuration.

`node --test slide-merge.test.mjs` checks immutable slide operations and rail limits.
`node --test slide-merge-inserts.test.mjs` checks content starters and ruler coordinates.
Browser verification covers real rail dragging, keyboard resizing, reload persistence,
floating-left inspector geometry, desktop/mobile screenshots, deck operations and rehearsal.

## Adoption gates

This is not a production replacement. Rich HTML, section and video fixtures are
native-renderer embeds, not fully editable engine objects. SVG thumbnails currently
show placeholders for those embeds. Video playback depends on browser support.
Production-deck conversion, full export/thumbnail fidelity, presenter parity,
private encryption and publishing compatibility remain unimplemented.
Local drafts do not roam across devices. Real-hardware performance remains a user check.
Content and slide layouts are starters, not imports of actual case-study sections.
Icons are SVG image objects, not editable individual paths; unpublished studio icons
are not available. Rulers are read-only, guides are visual overlays (not draggable
or snapping targets), and grid snapping is the engine grid rather than the production
12-column layout grid. View aids and notes-panel visibility are session-only.