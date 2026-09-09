# Studio Presenter (Windows Preview)

Portable Windows x64 companion for riteshk.work. Opens Content Studio or Slide Studio in its own WebView2 audience window. Starting Present/Rehearse opens an always-on-top, capture-excluded notes window.

## Use

1. Download StudioPresenter.exe from Studio > More on the actual presenting PC. Requires Windows 10 2004+ or Windows 11 and Microsoft Edge WebView2 Runtime. The self-contained executable needs no separate .NET install and does not request administrator access.
2. Sign in within the app. It has its own persistent profile, separate from Edge/Chrome: publish Content Studio browser edits first, or export/import a Slide Studio deck. Use Open > Slide Studio for that editor.
3. Start Present/Rehearse. Keep the audience window open and not minimized. Place it on the display you share. Move or resize the companion as needed.
4. The companion preview is a live DWM mirror of the slide itself, not a second renderer. Mouse motion shows a laser; controls/media/embedded content show an arrow. Click, drag, wheel and keyboard input target the live WebView2 presentation. Leave the preview to use the normal cursor on notes and controls.
5. Verify the outgoing feed with another participant before using private notes. Share the whole display: the companion should be absent, with slides normally visible underneath. Also verify recordings and each display/capture configuration you use.

Unsigned preview build: do not disable Windows security to run it. Report any block. The app does not attach to a presentation already open in another browser. Browser presenter windows remain ordinary, capturable windows.

## Presenter DJ Pad (0.3.0)

The web and Windows presenter share the same panel components and design tokens. The Windows shell remains WinForms/WebView2; this release does not migrate to WinUI 3.

- Rehearse opens the pad automatically. Windows opens a borderless audience window with a live mirror; browsers still require capture approval and may require the fullscreen retry button after opening always-on-top PiP.
- Pause/resume affects elapsed and per-slide clocks only, never media playback. Reset restarts both clocks. Budgets are optional, do not auto-advance slides, and warn when time runs out.
- Notes and slide-minute budgets save to the corresponding deck draft when launched from an editor. Slide content remains read-only. Slide Studio's Prepare mode permits these metadata edits, including the timing button on each slide.
- Click the count for the private thumbnail overview. In Windows the DWM mirror hides while the overview is open. Notes size and pane split persist in the app profile.
- End closes the pad and exits the audience presentation. Browser capture loss leaves static thumbnails and an explicit reconnect action.

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