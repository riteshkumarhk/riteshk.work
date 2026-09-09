# Content Studio Chrome

The shared Studio shell keeps Undo/Redo on the left of its working bar. The preview
mode toggle, screen-size (or slide-view) dropdown, and new-tab (or Rehearse) action
form a right-aligned group. Preview mode behavior is unchanged: split, editor-only,
and preview-only.

A full-width 32px footer sits below the editing and preview panes across Studio
tabs and case-study editors. Live status text takes all remaining space, with draft
storage and activity recording on the right in 24px-high controls. Truncated status
messages retain their full text in a tooltip. Status and recording remain available
when preview is hidden or unavailable; preview-specific size controls still hide.

The existing publish-progress indicator and success/error feedback belong to this
footer. Publishing, draft storage, new-tab flushing, and recording handlers remain
shared with the existing Studio implementation.

Focused regression check: `node --test studio-status.test.mjs`.
Build: `npm run build`. Both Studio entry points version the shared admin CSS;
the Studio JavaScript continues to use its dynamic cache version.