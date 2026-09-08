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

## Build and checks

`npm run build:slide-lab` builds both labs into shared assets and scans generated
JavaScript for Google API key patterns. The engine adapter removes upstream Firebase configuration.

`node --test slide-merge.test.mjs` checks immutable slide operations and rail limits.
Browser verification covers real rail dragging, keyboard resizing, reload persistence,
floating-left inspector geometry, desktop/mobile screenshots, deck operations and rehearsal.

## Adoption gates

This is not a production replacement. Rich HTML, section and video fixtures are
native-renderer embeds, not fully editable engine objects. SVG thumbnails currently
show placeholders for those embeds. Video playback depends on browser support.
Production-deck conversion, full export/thumbnail fidelity, presenter parity,
private encryption and publishing compatibility remain unimplemented.
Local drafts do not roam across devices. Real-hardware performance remains a user check.