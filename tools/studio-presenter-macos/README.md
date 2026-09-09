# Studio Presenter for macOS: Developer Preview

Not a privacy-verified release. No macOS download is offered in Studio until real-device acceptance is complete.

## Scope

- macOS 13+, universal Apple Silicon/Intel AppKit + WKWebView app.
- Reuses the web/Windows DJ-pad components, typography, icons and design tokens.
- Separate audience window and floating presenter panel, editable draft notes/budgets, pause/reset/end, slide overview, and saved font/pane preferences.
- One actual audience renderer. A 2 fps WKWebView snapshot supplies the preview; original media is never modified. Snapshot support for video, DRM, WebGL and embedded frames needs hardware testing. Preview pointer motion forwards the laser; use the audience window for media and embedded controls.
- App authentication and drafts use its own WebKit profile, not Safari's. Publish Content Studio changes or export/import Slide Studio decks to move between devices.

## Privacy Boundary

Share ONLY the audience window. Whole-display sharing and recordings can expose the presenter panel. This app does not claim Windows capture-affinity protection, and does not rely on NSWindow sharingType as a universal exclusion mechanism. A startup confirmation states the limitation.

Test the actual outgoing feed with another participant before entering private notes. Check Teams, Zoom, window sharing, display sharing, recordings, multiple displays, fullscreen Spaces, minimization and app switching. Keep the preview away from private content until those checks pass.

## Build

On a Mac with Xcode command-line tools and Node.js, run `npm ci` at the repository root, then `bash tools/studio-presenter-macos/build.sh`. This creates an ad-hoc signed universal app and an explicitly UNVERIFIED zip. It is not Developer ID signed or notarized; do not disable Gatekeeper to work around a security block.

The manually dispatched **macOS Presenter Developer Preview** GitHub workflow compiles both architectures and checks the origin allowlist. Its artifact is for development, not proof of UI, media, fullscreen or capture privacy. A distributable release still needs real Mac testing and Apple signing/notarization credentials supplied through secure CI secrets, never committed to this repository.