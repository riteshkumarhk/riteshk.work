# Studio Presenter (Windows Preview)

Portable Windows x64 companion for riteshk.work. Opens Content Studio or Slide Studio in its own WebView2 audience window. Starting Present/Rehearse opens an always-on-top, capture-excluded notes window.

## Use

1. Download StudioPresenter.exe from Studio > More on the actual presenting PC. Requires Windows 10 2004+ or Windows 11 and Microsoft Edge WebView2 Runtime. The self-contained executable needs no separate .NET install and does not request administrator access.
2. Sign in within the app. It has its own persistent profile, separate from Edge/Chrome, and does not inherit unsaved browser drafts. Open existing saved work or export/import a Slide Studio deck. Do not publish private or unreviewed work just to transfer it. Use Open > Slide Studio for that editor.
3. Start Present/Rehearse. Keep the audience window open and not minimized. Place it on the display you share. Move or resize the companion as needed.
4. The companion preview is a live DWM mirror of the slide itself, not a second renderer. Content uses a laser, enabled controls use a pointing hand and supported canvas drags use a panning hand. Click, drag, wheel and keyboard input target the live WebView2 presentation. Leave the preview to use the normal cursor on notes and controls.
5. Verify the outgoing feed with another participant before using private notes. Share the whole display: the companion should be absent, with slides normally visible underneath. Also verify recordings and each display/capture configuration you use.

Unsigned preview build: do not disable Windows security to run it. Report any block. The app does not attach to a presentation already open in another browser. Browser presenter windows remain ordinary, capturable windows.

## DJ Updates (0.3.2)

This version adds a laser over media and expanded dialogs, a pointing hand over enabled controls, and a panning hand during supported canvas drags. Cover depth recovers after late decoding and slide navigation. Native next-slide previews include case-study section snapshots inside a script-disabled sandbox. Workflow no longer displays the optional React Flow attribution label.

Owner Work-card launches now use the draft-saving editor path. Notes and slide names can be edited without Publish; the action beside Next slide opens an editable overview inside the notes area while retaining the live mirror. Renaming changes slide metadata, not authored slide artwork.

Private metadata sync uses an owner-only endpoint, conditional field saves, a durable local pending queue and explicit local/cloud conflict comparison. Wait for the private sync acknowledgement before relying on another profile. Only edits made in the DJ for matching native decks enter this sync path. Existing editor notes are not automatically uploaded; regular editor changes, legacy decks, media and unpublished decks are not transferred. Matching case/slide IDs are required. Offline edits remain on the current device until sync succeeds.

Native checks cover DWM pixels, input, notes/name edits, overview, sync command round trips, focused-field deferral, conflict resolution and protection-loss cleanup. Native sync tests use a synthetic callback; separate browser/Miniflare tests cover private storage and independent profiles. Actual authenticated Figma and meeting privacy still require acceptance on the presenting GPU PC. The 0.3.1 notes below are historical; 0.3.2 keeps the live mirror visible while the notes-area overview is open.

## Presenter DJ Pad (0.3.1)

The web and Windows presenter share the same panel components and design tokens. The Windows shell remains WinForms/WebView2; this release does not migrate to WinUI 3.

- Rehearse opens the pad automatically. Windows opens a borderless audience window with a live mirror; browsers still require capture approval and may require the fullscreen retry button after opening always-on-top PiP.
- Pause/resume affects elapsed and per-slide clocks only, never media playback. Reset restarts both clocks. Budgets are optional, do not auto-advance slides, and warn when time runs out.
- Notes and slide-minute budgets save to the corresponding deck draft when launched from an editor. Slide content remains read-only. Slide Studio's Prepare mode permits these metadata edits, including the timing button on each slide.
- Click the count for the private thumbnail overview. In Windows the DWM mirror hides while the overview is open. Notes size and pane split persist in the app profile.
- End closes the pad and exits the audience presentation. Browser capture loss leaves static thumbnails and an explicit reconnect action.

### Live Interaction and Keyboard

- The Windows current-slide preview mirrors the actual audience window, including Workflow expansion/panning, image and embedded-media zoom, comparison dragging, and the moved comparison grip. It needs no browser-tab capture permission.
- With the preview focused, prototype keys such as R, custom keys, arrows, modifier combinations, key-up events and Tab reach the focused embedded content. Unhandled Left/Right keys outside the prototype navigate slides; editable fields and controls retain their own keys.
- Escape closes the surrounding expanded-media view, even after focus enters a cross-origin prototype. The iframe instance is retained. Workflow uses its own Escape dismissal without ending the slideshow.
- Windows-reserved shortcuts remain OS-controlled. Actual authenticated Figma behavior and each meeting app's outgoing feed/recordings still require acceptance on the presenting PC; synthetic cross-origin tests do not prove these.

## Protection and Boundaries

- Uses the same WDA_EXCLUDEFROMCAPTURE (0x11) mechanism as the probe that the owner verified in Teams whole-display sharing. The integrated WebView2 app requires a fresh Teams acceptance check; this is not a universal privacy guarantee.
- The native top-level companion is protected before notes appear. Readback/DWM checks run every 250 ms. Failure conceals its UI, clears pending notes, and removes the mirror. Handle destruction also conceals. This watchdog is not atomic protection against every capture method.
- No localhost server, socket, extension, remote debugging port or system-wide input hook. Commands stay inside this process and the owned WebView2. Production navigation/messages are restricted to https://riteshk.work. The bundled companion UI uses textContent for notes, not arbitrary note HTML.
- Browser authentication/drafts live in %LOCALAPPDATA%/RiteshStudioPresenter/profile. Notes are transferred in memory, not logged by the native app. Normal Studio publishing/storage behavior is unchanged.
- Native media and cross-origin iframe input are forwarded through WebView2's Input protocol, not synthetic DOM clicks. Provider autoplay/DRM/network restrictions still apply. External links open in the default browser and are outside the mirrored presentation.
- Windows capture affinity does not block every capture implementation, remote desktop path, or external camera. Never rely solely on the green status.

## Build and Check

Requires .NET 10 SDK and Node.js with the repository dependencies installed for development only. The project regenerates the embedded shared panel before every build.

```powershell
dotnet build tools/studio-presenter/StudioPresenter.csproj
node --test presenter-native.browser.test.mjs
dotnet run --project tools/studio-presenter/StudioPresenter.csproj -- --self-test
dotnet publish tools/studio-presenter/StudioPresenter.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o tools/studio-presenter/dist
```

Start serve.py on port 5510 before the browser/native tests. The browser test bundles the fixture first. The native --self-test uses an isolated test profile and dummy notes; it alone temporarily disables protection to capture a dummy screenshot, then restores it. Production code cannot invoke that screenshot helper. Results: %TEMP%/rk-native-selftest.json. Binary and generated fixture output are ignored by git.