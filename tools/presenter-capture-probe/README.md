# Presenter Capture Probe

Phase 1 of the Windows presenter companion: an always-on-top, app-owned window
with dummy notes and `WDA_EXCLUDEFROMCAPTURE`. No Studio connection, credentials,
real notes, network listener, installer, startup registration or elevation.
The production presenter remains unchanged.

Requires Windows 10 version 2004 or later with desktop composition enabled.
The portable self-contained build does not require installing .NET.

## Build And Check

With the .NET 10 SDK on Windows:

```powershell
dotnet build tools/presenter-capture-probe -c Release
dotnet tools/presenter-capture-probe/bin/Release/net10.0-windows/PresenterCaptureProbe.dll --self-test
dotnet publish tools/presenter-capture-probe -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o tools/presenter-capture-probe/dist
```

Run `dist/PresenterCaptureProbe.exe`. It is an unsigned development build; do not
disable Windows security protections to run it. Distribution signing is deferred.
Build outputs are ignored by Git. No installation or admin rights are needed.

## Acceptance Test On The Presenting PC

1. Open the probe. Confirm the green status says Windows exclusion is enabled.
2. Start a meeting in your usual Teams, Zoom or Meet setup. Use a second device or
   participant to observe the actual outgoing feed, not just your local preview.
3. Share the entire display containing the probe. Keep slides or another visible
   window underneath it. Click that underlying window and move the probe around.
4. Locally, the notes must stay on top. Remotely, neither the notes nor probe window
   should appear; the underlying content should remain visible. A black rectangle
   is a partial failure, not the desired result.
5. Test resize, minimize/restore, another display if used, and a meeting recording.
   Record Windows version, meeting app/browser version and sharing mode.
6. If anything leaks, stop. Do not put real notes into this prototype. Close it
   when finished; nothing is saved.

The automated self-test verifies the actual Windows affinity, topmost property,
handle recreation, clearing notes after affinity loss, and a simulated denied
request. It does NOT prove any conferencing application's capture behavior.

Protection is requested and read back before dummy content is shown. A 250ms
watchdog clears content if verification subsequently fails; this is not an atomic
guarantee against a capture during a protection change. Failure never silently
falls back to an unprotected notes window.

Windows explicitly does not promise universal capture protection. Alternate
capture paths, remote-desktop software and cameras can bypass it. This is not DRM
or a security boundary. Repeat acceptance checks after significant OS/app updates.

Only after this test passes on the real presenting machine should the next phase
host the shared presenter UI in WebView2 and add a paired local Studio connection.
An API-success status must never be presented as verified meeting privacy.

[Microsoft API documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)