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
            await SectionInteractions(audience);
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
            var companionState = audience.Companion?.Interface.CoreWebView2 == null ? "no companion" : await Script(audience.Companion.Interface, "JSON.stringify({url:location.href,ready:document.readyState,notes:document.querySelector('#notes')?.textContent,focus:document.activeElement?.id,bridge:!!window.chrome?.webview,body:document.body?.textContent.slice(-200)})");
            var sectionState = await Script(audience.Browser, "(()=>{const doc=document.querySelector('#native-section-test')?.contentDocument;return {keys:window.fixture?.embeddedKeys,focus:document.activeElement?.id,sectionFocus:doc?.activeElement?.id,expanded:!!doc?.querySelector('.pjp__expanded'),dismissType:typeof window.RK?.dismissSlideMedia};})()");
            if (audience.Companion?.Protected == true)
                using (var image = audience.Companion.CaptureDummyFixtureForTest()) image.Save(Path.Combine(Path.GetTempPath(), "rk-native-selftest-failure.png"), ImageFormat.Png);
            Report(new { passed = checks, error = error.ToString(), audienceState, companionState, sectionState, protectedWindow = audience.Companion?.Protected });
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

    private static async Task MirrorInput(AudienceWindow audience, string selector, bool click = true, double? offsetX = null, double? offsetY = null, string[]? kinds = null)
    {
        var targetJson = await Script(audience.Browser, "(()=>{const rect=document.querySelector(" + JsonSerializer.Serialize(selector) + ").getBoundingClientRect();const frame=document.querySelector('[data-pjp-frame]').getBoundingClientRect();return {x:(rect.left-frame.left+" + (offsetX?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "rect.width/2") + ")/frame.width,y:(rect.top-frame.top+" + (offsetY?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "rect.height/2") + ")/frame.height}})()");
        using var target = JsonDocument.Parse(targetJson);
        var companion = audience.Companion!.Interface;
        var rectJson = await Script(companion, "(()=>{const rect=document.querySelector('#preview').getBoundingClientRect();return {left:rect.left,top:rect.top,width:rect.width,height:rect.height}})()");
        using var rect = JsonDocument.Parse(rectJson);
        var positionX = rect.RootElement.GetProperty("left").GetDouble() + target.RootElement.GetProperty("x").GetDouble() * rect.RootElement.GetProperty("width").GetDouble();
        var positionY = rect.RootElement.GetProperty("top").GetDouble() + target.RootElement.GetProperty("y").GetDouble() * rect.RootElement.GetProperty("height").GetDouble();
        foreach (var kind in kinds ?? (click ? new[] { "mouseMoved", "mousePressed", "mouseReleased" } : new[] { "mouseMoved" }))
            await companion.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(new { type = kind, x = positionX, y = positionY, button = kind == "mouseMoved" ? "none" : "left", buttons = kind == "mousePressed" || kind == "mouseMoved" && kinds?.Contains("mouseReleased") == true ? 1 : 0, clickCount = kind == "mouseMoved" ? 0 : 1 }));
    }

    private static async Task SectionInteractions(AudienceWindow audience)
    {
        const string section = "document.querySelector('#native-section-test')";
        await Script(audience.Browser, "(()=>{const frame=document.createElement('iframe');frame.id='native-section-test';frame.style.cssText='position:absolute;inset:10%;width:80%;height:80%;border:0;z-index:5';frame.src='/studio/slide-runtime/component.html';document.querySelector('[data-pjp-frame]').append(frame);})()");
        await Until(async () => await Script(audience.Browser, section + ".contentWindow.RK?.renderSectionComponent!==undefined") == "true", "production section runtime");
        await Script(audience.Browser, section + ".contentWindow.RK.renderSectionComponent({appearance:'dark',block:{type:'workflow',heading:'Native live workflow',graph:{version:1,nodes:[{id:'start',position:{x:0,y:0},data:{title:'Start'}},{id:'end',position:{x:280,y:120},data:{title:'End'}}],edges:[{id:'path',source:'start',sourceHandle:'r',target:'end',targetHandle:'l',data:{kind:'main',route:'elbow'}}]}}})");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelectorAll('.react-flow__edge-path').length>0") == "true", "production workflow graph");
        await SectionInput(audience, "[aria-label='Expand diagram']");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('dialog.wf-explorer')?.open===true") == "true", "workflow expansion from native DJ");
        await Until(async () => await Script(audience.Browser, "Math.abs(" + section + ".getBoundingClientRect().width-document.querySelector('[data-pjp-frame]').getBoundingClientRect().width)<2") == "true", "expanded workflow fills audience slide");
        var previewJson = await Script(audience.Companion!.Interface, "(()=>{const rect=document.querySelector('#preview').getBoundingClientRect();return {x:rect.left+rect.width*.03,y:rect.top+rect.height*.5};})()");
        using var previewPoint = JsonDocument.Parse(previewJson);
        await Until(() =>
        {
            DwmFlush();
            using var image = audience.Companion.CaptureDummyFixtureForTest();
            var scale = audience.Companion.DeviceDpi / 96.0;
            var pixel = image.GetPixel((int)(previewPoint.RootElement.GetProperty("x").GetDouble() * scale), (int)(previewPoint.RootElement.GetProperty("y").GetDouble() * scale));
            if (pixel.R >= 35 || pixel.G >= 35 || pixel.B >= 35) return Task.FromResult(false);
            image.Save(Path.Combine(Path.GetTempPath(), "rk-native-workflow-expanded.png"), ImageFormat.Png);
            return Task.FromResult(true);
        }, "DJ mirror displays expanded Workflow pixels beyond original section bounds");
        Check(true, "Native DJ mirror visibly follows Workflow expansion");
        var flowBefore = await Script(audience.Browser, section + ".contentDocument.querySelector('dialog .react-flow__viewport').style.transform");
        await SectionDrag(audience, "dialog .react-flow__pane", 110, 150);
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('dialog .react-flow__viewport').style.transform") != flowBefore, "expanded workflow pans from native DJ");
        Check(true, "Native DJ pans the expanded production Workflow");
        await PreviewKey(audience, "Escape", 27);
        await Until(async () => await Script(audience.Browser, "!" + section + ".contentDocument.querySelector('dialog.wf-explorer[open]')") == "true", "Escape closes expanded workflow");
        await Until(async () => await Script(audience.Browser, "Math.abs(" + section + ".getBoundingClientRect().width-document.querySelector('[data-pjp-frame]').getBoundingClientRect().width*.8)<2") == "true", "Workflow restores authored section bounds");
        Check(audience.ActivePresentation, "Native DJ Escape closes Workflow expansion without ending slideshow");
        await Script(audience.Browser, "(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');context.fillStyle='#dc3040';context.fillRect(0,0,640,360);const beforeSrc=canvas.toDataURL();context.fillStyle='#10b990';context.fillRect(0,0,640,360);" + section + ".contentWindow.RK.renderSectionComponent({appearance:'dark',block:{type:'compare',heading:'Native comparison',beforeSrc,afterSrc:canvas.toDataURL()}});})()");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('.pjb__cmp-base')?.naturalWidth>0") == "true", "comparison image ready");
        await Script(audience.Browser, section + ".contentDocument.addEventListener('pointerdown',()=>window.nativeComparisonPressed=true,{once:true})");
        await SectionInput(audience, "[data-cmp]", new[] { "mouseMoved", "mousePressed" });
        await Until(async () => await Script(audience.Browser, "window.nativeComparisonPressed===true") == "true", "comparison native pointer-down");
        await SectionInput(audience, "[data-cmp]", new[] { "mouseMoved", "mouseReleased" }, 140);
        await Until(async () => await Script(audience.Browser, "parseFloat(" + section + ".contentDocument.querySelector('.pjb__cmp').style.getPropertyValue('--pos'))>60") == "true", "comparison drag from native DJ");
        Check(true, "Native DJ drag updates the single production comparison control");
        using (var image = audience.Companion!.CaptureDummyFixtureForTest()) image.Save(Path.Combine(Path.GetTempPath(), "rk-native-comparison-updated.png"), ImageFormat.Png);
        await SectionDrag(audience, "[data-cmp]", -200);
        await Until(async () => await Script(audience.Browser, "parseFloat(" + section + ".contentDocument.querySelector('.pjb__cmp').style.getPropertyValue('--pos'))<50") == "true", "reacquire the moved comparison grip");
        Check(true, "Native DJ reacquires the moved comparison grip");
        await Script(audience.Browser, "(()=>{const doc=" + section + ".contentDocument;const wrapper=doc.createElement('div');wrapper.className='pjb__frame';wrapper.style.cssText='position:absolute;inset:10%;width:80%;height:80%;z-index:10';const embed=doc.createElement('iframe');embed.id='native-embedded-test';embed.src=document.querySelector('.controls iframe').src+'?native-keys='+Date.now();embed.style.cssText='width:100%;height:100%;border:0';wrapper.append(embed);doc.body.append(wrapper);window.nativeEmbeddedWindow=embed.contentWindow;window.fixture.embeddedClicked=false;window.fixture.embeddedKeys=[];doc.defaultView.addEventListener('message',event=>{if(event.source!==embed.contentWindow||event.origin!==new URL(embed.src).origin)return;if(event.data==='embedded-clicked')window.fixture.embeddedClicked=true;if(event.data?.type==='embedded-key')window.fixture.embeddedKeys.push(event.data);});})()");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('.pjb__frame [data-slide-expand]')!==null") == "true", "embedded expansion control ready");
        await SectionInput(audience, ".pjb__frame [data-slide-expand]");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('.pjp__expanded')!==null") == "true", "embedded content expands from native DJ");
        await SectionInput(audience, "[data-expand=plus]");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('#native-embedded-test').style.transform.includes('scale(1.4)')") == "true", "embedded content zoom");
        await SectionDrag(audience, "[data-expand-pan]", 110);
        await Until(async () => await Script(audience.Browser, "new DOMMatrix(" + section + ".contentDocument.querySelector('#native-embedded-test').style.transform).e>50") == "true", "expanded embedded content pan");
        await SectionInput(audience, "[data-expand=reset]");
        await Until(async () => await Script(audience.Browser, section + ".contentDocument.querySelector('#native-embedded-test').style.transform.includes('scale(1)')") == "true", "embedded content reset");
        Check(true, "Native DJ expands, zooms, pans and resets embedded content");
        var embeddedJson = await Script(audience.Browser, "(()=>{const rect=" + section + ".contentDocument.querySelector('#native-embedded-test').getBoundingClientRect();return {x:rect.left+55,y:rect.top+20};})()");
        using var embeddedPoint = JsonDocument.Parse(embeddedJson);
        await MirrorInput(audience, "#native-section-test", offsetX: embeddedPoint.RootElement.GetProperty("x").GetDouble(), offsetY: embeddedPoint.RootElement.GetProperty("y").GetDouble());
        await Until(async () => await Script(audience.Browser, "window.fixture.embeddedClicked===true") == "true", "trusted click inside expanded cross-origin embed");
        await PreviewKey(audience, "r", 82);
        await PreviewKey(audience, "k", 75);
        await PreviewKey(audience, "ArrowRight", 39);
        await Until(async () => await Script(audience.Browser, "['r','k','ArrowRight'].every(key=>window.fixture.embeddedKeys.some(event=>event.key===key&&event.event==='keydown'&&event.trusted))") == "true", "prototype reset, custom and arrow keys reach cross-origin frame");
        Check(await Script(audience.Browser, "document.querySelector('[data-pjp-count]').textContent") == "\"1 / 2\"", "Prototype keyboard actions do not navigate slideshow");
        await PreviewKey(audience, "x", 88, 2);
        await PreviewKey(audience, "R", 82, 8);
        await Until(async () => await Script(audience.Browser, "window.fixture.embeddedKeys.some(event=>event.key==='x'&&event.code==='KeyX'&&event.ctrl&&event.event==='keydown')&&window.fixture.embeddedKeys.some(event=>event.key==='R'&&event.code==='KeyR'&&event.shift&&event.event==='keyup')") == "true", "prototype modifiers and physical key codes preserved");
        await PreviewKey(audience, "Tab", 9);
        await Until(async () => await Script(audience.Browser, "window.fixture.embeddedKeys.some(event=>event.key==='Tab'&&event.event==='keydown')") == "true", "prototype receives Tab from focused preview");
        Check(true, "Native DJ preserves prototype modifiers, key codes, keyup and Tab");
        await PreviewKey(audience, "Escape", 27);
        await Until(async () => await Script(audience.Browser, "!" + section + ".contentDocument.querySelector('.pjp__expanded')") == "true", "Escape closes expansion after cross-origin focus");
        Check(audience.ActivePresentation && await Script(audience.Browser, section + ".contentDocument.querySelector('#native-embedded-test').contentWindow===window.nativeEmbeddedWindow") == "true", "Native DJ Escape restores the same cross-origin embed without ending slideshow");
        await PreviewKey(audience, "ArrowRight", 39);
        await Until(async () => await Script(audience.Companion.Interface, "document.querySelector('#notes').textContent") == "\"Private second note\"", "Right after leaving prototype navigates slideshow");
        await PreviewKey(audience, "ArrowLeft", 37);
        await Until(async () => await Script(audience.Companion.Interface, "document.querySelector('#notes').textContent") == "\"Private first note\"", "Left navigates slideshow back");
        Check(true, "Native DJ Left and Right navigate slides outside the prototype");
        await Script(audience.Browser, section + "?.remove()");
    }

    private static async Task SectionDrag(AudienceWindow audience, string selector, double deltaX, double offsetY = 0)
    {
        await Script(audience.Browser, "window.nativeSectionPressed=false;document.querySelector('#native-section-test').contentDocument.addEventListener('pointerdown',()=>window.nativeSectionPressed=true,{once:true})");
        await SectionInput(audience, selector, new[] { "mouseMoved", "mousePressed" }, deltaY: offsetY);
        await Until(async () => await Script(audience.Browser, "window.nativeSectionPressed===true") == "true", "native section drag starts");
        await SectionInput(audience, selector, new[] { "mouseMoved", "mouseReleased" }, deltaX, offsetY);
    }

    private static async Task SectionInput(AudienceWindow audience, string selector, string[]? kinds = null, double deltaX = 0, double deltaY = 0)
    {
        await Until(async () => await Script(audience.Browser, "(()=>{const doc=document.querySelector('#native-section-test').contentDocument,target=doc.querySelector(" + JsonSerializer.Serialize(selector) + ");if(!target)return false;const bounds=target.getBoundingClientRect();return bounds.width>0&&bounds.height>0&&bounds.left+bounds.width/2>=0&&bounds.left+bounds.width/2<doc.defaultView.innerWidth&&bounds.top+bounds.height/2>=0&&bounds.top+bounds.height/2<doc.defaultView.innerHeight;})()") == "true", "native section target is within visible iframe: " + selector);
        var coordinates = await Script(audience.Browser, "(()=>{const bounds=document.querySelector('#native-section-test').contentDocument.querySelector(" + JsonSerializer.Serialize(selector) + ").getBoundingClientRect();return {x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};})()");
        using var point = JsonDocument.Parse(coordinates);
        await MirrorInput(audience, "#native-section-test", offsetX: point.RootElement.GetProperty("x").GetDouble() + deltaX, offsetY: point.RootElement.GetProperty("y").GetDouble() + deltaY, kinds: kinds);
    }

    private static async Task PreviewKey(AudienceWindow audience, string key, int keyCode, int modifiers = 0)
    {
        foreach (var kind in new[] { "keyDown", "keyUp" })
            await audience.Companion!.Interface.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new { type = kind, key, code = key.Length == 1 ? "Key" + key.ToUpperInvariant() : key, windowsVirtualKeyCode = keyCode, modifiers }));
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