using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using PresenterCaptureProbe;

namespace StudioPresenter;

internal static class SelfTest
{
    internal static int ExitCode;
    [DllImport("dwmapi.dll")] private static extern int DwmFlush();
    private static readonly List<string> checks = new();
    internal static void Report(object result)
    {
        var json = JsonSerializer.Serialize(result);
        File.WriteAllText(Path.Combine(Path.GetTempPath(), "rk-native-selftest.json"), json);
        Console.WriteLine(json);
    }

    internal static async Task Run(AudienceWindow audience)
    {
        try
        {
            Check(AudienceWindow.Trusted("https://riteshk.work/studio/", false) && !AudienceWindow.Trusted("https://riteshk.work.evil.test/", false) && !AudienceWindow.Trusted("http://127.0.0.1:5510/", false), "Host origin allowlist");
            await Until(async () => await Script(audience.Browser, "!!window.fixture") == "true", "fixture startup");
            await Script(audience.Browser, "window.fixture.editable=true;window.fixture.start()");
            await Until(async () => audience.Companion?.Interface.CoreWebView2 != null && await Script(audience.Companion.Interface, "document.querySelector('#notes')?.textContent") == "\"Private first note\"", "private notes connected");
            var companion = audience.Companion!;
            Check(companion.Protected && companion.TopMost, "Companion topmost and capture-excluded");
            Check(await Script(audience.Browser, "document.querySelector('[data-pjp-notes]').textContent") == "\"\"", "Audience contains no speaker notes");
            await MirrorInput(audience, "#swatch", false);
            await Until(async () => await Script(audience.Browser, "document.querySelector('.pjp').dataset.pointer") == "\"laser\"", "laser on live preview");
            Check(true, "Preview motion drives audience laser");
            await MirrorInput(audience, "#action");
            await Until(async () => await Script(audience.Browser, "window.fixture.clicks") == "1", "preview click");
            Check(await Script(audience.Browser, "document.querySelector('.pjp__pointer').classList.contains('is-control')") == "true", "Preview click reaches live control with interaction cursor");
            await MirrorInput(audience, "#section");
            await Until(async () => await Script(audience.Browser, "document.querySelector('details').open") == "true", "section expansion");
            Check(true, "Live section expands from preview");
            await MirrorInput(audience, "#seek");
            var sliderBefore = await Script(audience.Browser, "document.querySelector('#seek').value");
            await companion.Interface.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyDown\",\"key\":\"ArrowRight\",\"code\":\"ArrowRight\",\"windowsVirtualKeyCode\":39}");
            await companion.Interface.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", "{\"type\":\"keyUp\",\"key\":\"ArrowRight\",\"code\":\"ArrowRight\",\"windowsVirtualKeyCode\":39}");
            await Until(async () => await Script(audience.Browser, "document.querySelector('#seek').value") != sliderBefore, "slider keyboard input");
            Check(true, "Keyboard input changes live slider without navigating slides");
            await MirrorInput(audience, "#play");
            await Until(async () => await Script(audience.Browser, "document.querySelector('video').paused") == "false", "media play");
            await Script(companion.Interface, "document.querySelector('[data-pp=timer-pause]').click()");
            await Until(async () => await Script(companion.Interface, "document.querySelector('[data-pp-elapsed]').textContent") == "\"paused\"", "timer paused");
            Check(await Script(audience.Browser, "document.querySelector('video').paused") == "false", "Pause freezes clocks without pausing media");
            await Script(companion.Interface, "document.querySelector('[data-pp=timer-reset]').click()");
            await Until(async () => await Script(companion.Interface, "document.querySelector('#timer').textContent") == "\"0:00\"", "timer reset");
            await Script(companion.Interface, "document.querySelector('[data-pp=timer-pause]').click()");
            await MirrorInput(audience, "#play");
            await Until(async () => await Script(audience.Browser, "document.querySelector('video').paused") == "true", "media pause");
            Check(true, "Media play and pause target the single live player");
            await MirrorInput(audience, "iframe", true, 55, 20);
            await Until(async () => await Script(audience.Browser, "!!window.fixture.embeddedClicked") == "true", "cross-origin click");
            Check(true, "Cross-origin embedded controls receive trusted browser input");
            await Script(companion.Interface, "document.querySelector('[data-command=next]').click()");
            await Until(async () => await Script(companion.Interface, "document.querySelector('#notes').textContent") == "\"Private second note\"", "next notes");
            Check(true, "Slide navigation updates real notes");
            await Script(companion.Interface, "(()=>{const notes=document.querySelector('#notes');notes.value='Edited native note';notes.dispatchEvent(new Event('input',{bubbles:true}));const minutes=document.querySelector('[data-pp-minutes]');minutes.value='02:30';minutes.dispatchEvent(new Event('input',{bubbles:true}));})()");
            await Until(async () => await Script(audience.Browser, "window.fixture.slides[1].notes==='Edited native note'&&window.fixture.slides[1].durationMinutes===2.5") == "true", "native metadata saved");
            Check(true, "Native notes and budget edits reach their deck slide");
            await Script(companion.Interface, "document.querySelector('[data-pp=overview]').click()");
            await Until(() => Task.FromResult(companion.MirrorSuppressed), "overview hides mirror");
            Check(await Script(companion.Interface, "document.querySelector('[data-pp-grid] iframe')?.getAttribute('sandbox')") == "\"\"", "Content thumbnails use script-disabled sandbox frames");
            await Script(companion.Interface, "document.querySelector('[data-pp-jump=\"0\"]').click()");
            await Until(async () => !companion.MirrorSuppressed && await Script(companion.Interface, "document.querySelector('#count').textContent") == "\"1 / 2\"", "overview jump");
            Check(true, "Private overview hides mirror and jumps to selected slide");
            await Script(companion.Interface, "document.querySelector('[data-pp=notes-smaller]').click();document.querySelector('[data-pp=notes-larger]').click()");
            await Until(async () => await Script(audience.Browser, "Number(localStorage.getItem('rk:presenter:notes-size'))>=14") == "true", "notes preference persisted");
            Check(true, "Native notes size persists in the app profile");
            companion.ClientSize = new Size(640, 650);
            await MirrorInput(audience, "#action");
            await Until(async () => await Script(audience.Browser, "window.fixture.clicks") == "2", "resized preview click");
            Check(true, "Resized preview retains input alignment");
            using (var composite = companion.CaptureDummyFixtureForTest()) composite.Save(Path.Combine(Path.GetTempPath(), "rk-native-companion-composite.png"), ImageFormat.Png);
            await MirrorPixels(audience);
            using (var screenshot = File.Create(Path.Combine(Path.GetTempPath(), "rk-native-companion-ui.png")))
                await companion.Interface.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, screenshot);
            CaptureProtection.SetWindowDisplayAffinity(companion.Handle, 0);
            await Until(() => Task.FromResult(companion.Concealed), "protection loss");
            Check(companion.Concealed, "Protection loss clears notes and removes mirror");
            Report(new { passed = checks, conferenceRetestRequired = true });
        }
        catch (Exception error)
        {
            ExitCode = 1;
            var audienceState = await Script(audience.Browser, "JSON.stringify({native:window.__RK_NATIVE_PRESENTER,stage:!!document.querySelector('.pjp--native'),size:[innerWidth,innerHeight]})");
            var companionState = audience.Companion?.Interface.CoreWebView2 == null ? "no companion" : await Script(audience.Companion.Interface, "JSON.stringify({url:location.href,ready:document.readyState,notes:document.querySelector('#notes')?.textContent,bridge:!!window.chrome?.webview,body:document.body?.textContent.slice(-200)})");
            Report(new { passed = checks, error = error.ToString(), audienceState, companionState, protectedWindow = audience.Companion?.Protected });
        }
        finally { audience.Close(); }
    }

    private static void Check(bool condition, string name)
    {
        if (!condition) throw new InvalidOperationException(name);
        checks.Add(name);
    }

    private static Task<string> Script(WebView2 browser, string expression) => browser.CoreWebView2.ExecuteScriptAsync(expression);

    private static async Task Until(Func<Task<bool>> condition, string name)
    {
        var deadline = DateTime.UtcNow.AddSeconds(12);
        while (DateTime.UtcNow < deadline) { if (await condition()) return; await Task.Delay(50); }
        throw new TimeoutException(name);
    }

    private static async Task MirrorInput(AudienceWindow audience, string selector, bool click = true, double? offsetX = null, double? offsetY = null)
    {
        var targetJson = await Script(audience.Browser, "(()=>{const rect=document.querySelector(" + JsonSerializer.Serialize(selector) + ").getBoundingClientRect();const frame=document.querySelector('[data-pjp-frame]').getBoundingClientRect();return {x:(rect.left-frame.left+" + (offsetX?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "rect.width/2") + ")/frame.width,y:(rect.top-frame.top+" + (offsetY?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "rect.height/2") + ")/frame.height}})()");
        using var target = JsonDocument.Parse(targetJson);
        var companion = audience.Companion!.Interface;
        var rectJson = await Script(companion, "(()=>{const rect=document.querySelector('#preview').getBoundingClientRect();return {left:rect.left,top:rect.top,width:rect.width,height:rect.height}})()");
        using var rect = JsonDocument.Parse(rectJson);
        var positionX = rect.RootElement.GetProperty("left").GetDouble() + target.RootElement.GetProperty("x").GetDouble() * rect.RootElement.GetProperty("width").GetDouble();
        var positionY = rect.RootElement.GetProperty("top").GetDouble() + target.RootElement.GetProperty("y").GetDouble() * rect.RootElement.GetProperty("height").GetDouble();
        foreach (var kind in click ? new[] { "mouseMoved", "mousePressed", "mouseReleased" } : new[] { "mouseMoved" })
            await companion.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(new { type = kind, x = positionX, y = positionY, button = kind == "mouseMoved" ? "none" : "left", buttons = kind == "mousePressed" ? 1 : 0, clickCount = kind == "mouseMoved" ? 0 : 1 }));
    }

    private static async Task MirrorPixels(AudienceWindow audience)
    {
        using var destination = new Form { Text = "Dummy mirror pixel check", TopMost = true, ClientSize = new Size(640, 360), StartPosition = FormStartPosition.Manual, Location = new Point(20, 40), BackColor = Color.Black };
        destination.Show();
        using var mirror = new LiveMirror(destination.Handle, audience.Handle);
        mirror.Place(destination.ClientRectangle);
        var pointJson = await Script(audience.Browser, "(()=>{const rect=document.querySelector('#swatch').getBoundingClientRect();return {x:(rect.left+rect.width/2)/innerWidth,y:(rect.top+rect.height/2)/innerHeight}})()");
        using var point = JsonDocument.Parse(pointJson);
        var sampleX = (int)(point.RootElement.GetProperty("x").GetDouble() * destination.ClientSize.Width);
        var sampleY = (int)(point.RootElement.GetProperty("y").GetDouble() * destination.ClientSize.Height);
        using var image = new Bitmap(destination.ClientSize.Width, destination.ClientSize.Height);
        foreach (var color in new[] { "rgb(222,69,84)", "rgb(60,190,100)" })
        {
            await Script(audience.Browser, "document.querySelector('#swatch').style.background=" + JsonSerializer.Serialize(color));
            await Until(() =>
            {
                DwmFlush();
                using var graphics = Graphics.FromImage(image);
                graphics.CopyFromScreen(destination.PointToScreen(Point.Empty), Point.Empty, image.Size);
                var sample = image.GetPixel(sampleX, sampleY);
                return Task.FromResult(color.Contains("222") ? sample.R > 180 && sample.G < 110 : sample.G > 150 && sample.R < 100);
            }, "live DWM mirror pixel " + color);
        }
        image.Save(Path.Combine(Path.GetTempPath(), "rk-native-live-mirror.png"), ImageFormat.Png);
        Check(true, "DWM mirror renders live source pixels and subsequent changes");
    }
}