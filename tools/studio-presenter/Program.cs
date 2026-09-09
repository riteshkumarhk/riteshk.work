using System.Runtime.InteropServices;
using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using PresenterCaptureProbe;

namespace StudioPresenter;

internal sealed class LiveMirror : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Properties
    {
        public uint Flags;
        public NativeRect Destination, Source;
        public byte Opacity;
        [MarshalAs(UnmanagedType.Bool)] public bool Visible;
        [MarshalAs(UnmanagedType.Bool)] public bool ClientOnly;
    }
    [DllImport("dwmapi.dll")] private static extern int DwmRegisterThumbnail(nint destination, nint source, out nint thumbnail);
    [DllImport("dwmapi.dll")] private static extern int DwmUpdateThumbnailProperties(nint thumbnail, ref Properties properties);
    [DllImport("dwmapi.dll")] private static extern int DwmUnregisterThumbnail(nint thumbnail);
    private nint thumbnail;

    internal LiveMirror(nint destination, nint source) => Marshal.ThrowExceptionForHR(DwmRegisterThumbnail(destination, source, out thumbnail));
    internal void Place(Rectangle rectangle, bool visible = true, Rectangle? source = null)
    {
        var properties = new Properties
        {
            Flags = 1 | 4 | 8 | 16 | (source.HasValue ? 2u : 0u),
            Destination = new NativeRect { Left = rectangle.Left, Top = rectangle.Top, Right = rectangle.Right, Bottom = rectangle.Bottom },
            Opacity = 255, Visible = visible, ClientOnly = true
        };
        if (source.HasValue) properties.Source = new NativeRect { Left = source.Value.Left, Top = source.Value.Top, Right = source.Value.Right, Bottom = source.Value.Bottom };
        Marshal.ThrowExceptionForHR(DwmUpdateThumbnailProperties(thumbnail, ref properties));
    }
    public void Dispose() { if (thumbnail != 0) DwmUnregisterThumbnail(thumbnail); thumbnail = 0; }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new AudienceWindow(args));
        return SelfTest.ExitCode;
    }
}

internal sealed class AudienceWindow : Form
{
    internal readonly WebView2 Browser = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
    private CompanionWindow? companion;
    internal CompanionWindow? Companion => companion;
    private readonly MenuStrip menu = new() { BackColor = Color.FromArgb(20, 20, 23), ForeColor = Color.White };
    private readonly string[] args;
    private Rectangle previousBounds;
    private bool presenting;
    internal bool Testing => args.Contains("--self-test");
    internal bool ActivePresentation => presenting;
    internal double ViewportWidth = 1280, ViewportHeight = 720;
    internal double SlideLeft, SlideTop;
    internal readonly SemaphoreSlim InputGate = new(1, 1);
    internal CoreWebView2Environment? Environment;

    internal AudienceWindow(string[] args)
    {
        this.args = args;
        Text = "Studio Presenter - open a deck, then Present";
        ClientSize = new Size(1280, 800);
        MinimumSize = new Size(800, 500);
        BackColor = Color.Black;
        Controls.Add(Browser);
        var open = new ToolStripMenuItem("Open");
        foreach (var destination in new[] { ("Content Studio", "/studio/"), ("Slide Studio", "/studio/slide-merge-lab/"), ("Published work", "/") })
        {
            var item = new ToolStripMenuItem(destination.Item1);
            item.Click += (_, _) => Browser.CoreWebView2?.Navigate("https://riteshk.work" + destination.Item2);
            open.DropDownItems.Add(item);
        }
        menu.Items.Add(open);
        menu.Items.Add("Reload", null, (_, _) => Browser.Reload());
        Controls.Add(menu);
        MainMenuStrip = menu;
        Shown += async (_, _) => await Initialize();
        FormClosed += (_, _) => companion?.Close();
    }

    internal static bool Trusted(string source, bool testing)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == "https" && uri.Host == "riteshk.work" && uri.IsDefaultPort
            || testing && uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 5510;
    }

    private async Task Initialize()
    {
        try
        {
            var profile = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "RiteshStudioPresenter", Testing ? "test-profile" : "profile");
            Environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await Browser.EnsureCoreWebView2Async(Environment);
            Browser.CoreWebView2.Settings.AreDevToolsEnabled = Testing;
            Browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            Browser.CoreWebView2.NavigationStarting += (_, eventArgs) =>
            {
                if (!Trusted(eventArgs.Uri, Testing)) { eventArgs.Cancel = true; return; }
                EndPresentation();
            };
            Browser.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
            {
                eventArgs.Handled = true;
                if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) && uri.Scheme == "https")
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            };
            Browser.CoreWebView2.ProcessFailed += (_, _) => EndPresentation();
            Browser.CoreWebView2.WebMessageReceived += async (_, eventArgs) =>
            {
                if (!Trusted(eventArgs.Source, Testing)) return;
                try
                {
                    using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
                    var state = message.RootElement;
                    if (!state.TryGetProperty("channel", out var channel) || channel.GetString() != "rk-presenter") return;
                    if (state.GetProperty("type").GetString() == "end") { EndPresentation(); return; }
                    if (state.GetProperty("type").GetString() != "state") return;
                    ViewportWidth = state.GetProperty("width").GetDouble();
                    ViewportHeight = state.GetProperty("height").GetDouble();
                    SlideLeft = state.GetProperty("left").GetDouble();
                    SlideTop = state.GetProperty("top").GetDouble();
                    if (!presenting)
                    {
                        presenting = true;
                        previousBounds = Bounds;
                        menu.Visible = false;
                        FormBorderStyle = FormBorderStyle.None;
                        Bounds = Screen.FromControl(this).Bounds;
                        companion = new CompanionWindow(this);
                        companion.Show();
                        companion.UpdateState(state.GetRawText());
                        await companion.Initialize();
                        return;
                    }
                    companion?.UpdateState(state.GetRawText());
                }
                catch (Exception error) { Fail(error.Message); }
            };
            await Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("if(window===window.top) window.__RK_NATIVE_PRESENTER=true;");
            Browser.CoreWebView2.Navigate(Testing ? "http://127.0.0.1:5510/tools/studio-presenter/fixture.html" : "https://riteshk.work/studio/");
            if (Testing) await SelfTest.Run(this);
        }
        catch (Exception error) { Fail("Microsoft Edge WebView2 Runtime is required. " + error.Message); }
    }

    internal void Command(string command, int? index = null, string? key = null, JsonElement? value = null)
    {
        if (!presenting) return;
        Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { channel = "rk-presenter", command, index, key, value }));
    }

    internal void EndPresentation()
    {
        if (!presenting) return;
        presenting = false;
        companion?.Close();
        companion = null;
        FormBorderStyle = FormBorderStyle.Sizable;
        Bounds = previousBounds;
        menu.Visible = true;
    }

    private void Fail(string message)
    {
        if (Testing) { SelfTest.Report(new { error = message }); SelfTest.ExitCode = 1; Close(); return; }
        EndPresentation();
        MessageBox.Show(this, message, "Studio Presenter", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}

internal sealed class CompanionWindow : Form
{
    private readonly AudienceWindow audience;
    internal readonly WebView2 Interface = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(20, 20, 23), Visible = false };
    private readonly Label status = new() { Dock = DockStyle.Fill, Text = "Checking Windows capture exclusion...", ForeColor = Color.White, Padding = new Padding(24) };
    private readonly System.Windows.Forms.Timer watchdog = new() { Interval = 250 };
    private LiveMirror? mirror;
    private bool ready, faulted, mirrorSuppressed;
    private string? pendingState;
    private Rectangle previewRect;
    internal bool Protected => !faulted && IsHandleCreated && CaptureProtection.Verify(Handle).Allowed;
    internal bool Concealed => faulted && !Interface.Visible && mirror == null && pendingState == null;
    internal bool MirrorSuppressed => mirrorSuppressed;

    internal CompanionWindow(AudienceWindow audience)
    {
        this.audience = audience;
        Text = "Presenter DJ pad";
        TopMost = true;
        ClientSize = new Size(920, 740);
        MinimumSize = new Size(540, 500);
        StartPosition = FormStartPosition.Manual;
        var screen = Screen.FromControl(audience).WorkingArea;
        Location = new Point(screen.Right - Width - 24, screen.Top + 24);
        BackColor = Color.FromArgb(20, 20, 23);
        Controls.Add(Interface);
        Controls.Add(status);
        watchdog.Tick += (_, _) => { if (!Protected) Conceal(); };
        FormClosed += (_, _) => { watchdog.Stop(); mirror?.Dispose(); audience.Command("pointer-leave"); audience.Command("exit"); };
    }

    protected override void OnHandleCreated(EventArgs args)
    {
        base.OnHandleCreated(args);
        if (!CaptureProtection.Enable(Handle).Allowed) Conceal();
    }

    protected override void OnHandleDestroyed(EventArgs args)
    {
        mirror?.Dispose(); mirror = null;
        if (ready) Conceal();
        base.OnHandleDestroyed(args);
    }

    internal async Task Initialize()
    {
        if (!Protected) { Conceal(); return; }
        await Interface.EnsureCoreWebView2Async(audience.Environment);
        Interface.CoreWebView2.Settings.AreDevToolsEnabled = audience.Testing;
        Interface.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        Interface.CoreWebView2.Settings.IsZoomControlEnabled = false;
        var initialDocument = true;
        Interface.CoreWebView2.NavigationStarting += (_, eventArgs) =>
        {
            if (initialDocument) { initialDocument = false; return; }
            if (eventArgs.Uri != "about:blank") eventArgs.Cancel = true;
        };
        Interface.CoreWebView2.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
        Interface.CoreWebView2.WebMessageReceived += async (_, eventArgs) =>
        {
            if (eventArgs.Source != "about:blank" || !Protected) return;
            try
            {
                using var document = JsonDocument.Parse(eventArgs.WebMessageAsJson);
                var message = document.RootElement;
                var type = message.GetProperty("type").GetString();
                if (type == "ready")
                {
                    ready = true;
                    if (pendingState != null) UpdateState(pendingState);
                    var preferences = await audience.Browser.CoreWebView2.ExecuteScriptAsync("Object.fromEntries(['rk:presenter:split','rk:presenter:notes-size'].map(key=>[key,localStorage.getItem(key)]))");
                    Interface.CoreWebView2.PostWebMessageAsJson("{\"type\":\"preferences\",\"values\":" + preferences + "}");
                }
                else if (type == "preference")
                {
                    var key = message.GetProperty("key").GetString();
                    if (key is not ("rk:presenter:split" or "rk:presenter:notes-size")) return;
                    if (!double.TryParse(message.GetProperty("value").GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) || !double.IsFinite(value)) return;
                    value = key == "rk:presenter:split" ? Math.Clamp(value, 40, 75) : Math.Clamp(value, 14, 32);
                    await audience.Browser.CoreWebView2.ExecuteScriptAsync("localStorage.setItem(" + JsonSerializer.Serialize(key) + "," + JsonSerializer.Serialize(value.ToString(System.Globalization.CultureInfo.InvariantCulture)) + ")");
                }
                else if (type == "rect")
                {
                    mirrorSuppressed = message.TryGetProperty("visible", out var visible) && !visible.GetBoolean();
                    var scale = DeviceDpi / 96.0;
                    previewRect = Rectangle.FromLTRB((int)(message.GetProperty("left").GetDouble() * scale), (int)(message.GetProperty("top").GetDouble() * scale), (int)(message.GetProperty("right").GetDouble() * scale), (int)(message.GetProperty("bottom").GetDouble() * scale));
                    PlaceMirror();
                }
                else if (type == "command")
                {
                    var command = message.GetProperty("command").GetString();
                    if (command is "prev" or "next" or "exit" or "timer-reset" or "timer-pause" or "pointer-leave") audience.Command(command);
                    else if (command == "jump" && message.TryGetProperty("index", out var target) && target.TryGetInt32(out var index)) audience.Command(command, index);
                    else if (command == "edit" && message.TryGetProperty("index", out var slide) && slide.TryGetInt32(out var slideIndex) && message.TryGetProperty("key", out var field) && field.GetString() is "notes" or "durationMinutes" && message.TryGetProperty("value", out var value)) audience.Command(command, slideIndex, field.GetString(), value.Clone());
                }
                else if (type == "input") await ForwardInput(message.Clone());
            }
            catch (Exception) { Conceal(); }
        };
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("StudioPresenter.companion.html")!;
        using var reader = new StreamReader(stream);
        Interface.CoreWebView2.NavigateToString(await reader.ReadToEndAsync());
        if (!Protected || IsDisposed) return;
        mirror = new LiveMirror(Handle, audience.Handle);
        status.Visible = false;
        Interface.Visible = true;
        watchdog.Start();
    }

    internal void UpdateState(string state)
    {
        if (!Protected) { Conceal(); return; }
        pendingState = state;
        PlaceMirror();
        if (ready) Interface.CoreWebView2.PostWebMessageAsJson(state);
    }

    private void PlaceMirror()
    {
        var scale = audience.DeviceDpi / 96.0;
        var source = new Rectangle((int)(audience.SlideLeft * scale), (int)(audience.SlideTop * scale), (int)(audience.ViewportWidth * scale), (int)(audience.ViewportHeight * scale));
        if (previewRect.Width > 0 && source.Width > 0)
            mirror?.Place(previewRect, !faulted && !mirrorSuppressed && audience.WindowState != FormWindowState.Minimized, source);
    }

    internal async Task ForwardInput(JsonElement message)
    {
        if (!Protected || !audience.ActivePresentation || audience.WindowState == FormWindowState.Minimized) return;
        var kind = message.GetProperty("kind").GetString();
        if (kind is not ("mouseMoved" or "mousePressed" or "mouseReleased" or "mouseWheel" or "keyDown" or "keyUp")) return;
        if (kind == "mouseMoved" && audience.InputGate.CurrentCount == 0) return;
        await audience.InputGate.WaitAsync();
        try
        {
            if (!Protected || !audience.ActivePresentation) return;
            if (kind is "keyDown" or "keyUp")
            {
                var key = message.GetProperty("key").GetString() ?? "";
                if (key.Length > 30) return;
                var code = message.GetProperty("code").GetString() ?? "";
                var virtualKey = Math.Clamp(message.GetProperty("keyCode").GetInt32(), 0, 255);
                await audience.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new { type = kind, key, code, windowsVirtualKeyCode = virtualKey, text = kind == "keyDown" && key.Length == 1 ? key : "" }));
                return;
            }
            var normalizedX = message.GetProperty("x").GetDouble();
            var normalizedY = message.GetProperty("y").GetDouble();
            if (!double.IsFinite(normalizedX) || !double.IsFinite(normalizedY)) return;
            var positionX = audience.SlideLeft + Math.Clamp(normalizedX, 0, 1) * audience.ViewportWidth;
            var positionY = audience.SlideTop + Math.Clamp(normalizedY, 0, 1) * audience.ViewportHeight;
            audience.Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { channel = "rk-presenter", command = "pointer", x = positionX, y = positionY }));
            var buttons = message.TryGetProperty("buttons", out var pressed) ? pressed.GetInt32() & 1 : 0;
            var payload = new Dictionary<string, object?>
            {
                ["type"] = kind, ["x"] = positionX, ["y"] = positionY,
                ["button"] = kind is "mousePressed" or "mouseReleased" || buttons == 1 ? "left" : "none",
                ["buttons"] = buttons, ["clickCount"] = kind is "mousePressed" or "mouseReleased" ? 1 : 0
            };
            if (kind == "mouseWheel")
            {
                payload["deltaX"] = Math.Clamp(message.GetProperty("deltaX").GetDouble(), -2000, 2000);
                payload["deltaY"] = Math.Clamp(message.GetProperty("deltaY").GetDouble(), -2000, 2000);
            }
            await audience.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(payload));
        }
        finally { audience.InputGate.Release(); }
    }

    internal void Conceal()
    {
        faulted = true; pendingState = null;
        Interface.Visible = false;
        mirror?.Dispose(); mirror = null;
        status.Text = "Notes hidden: capture exclusion or the presentation connection failed. Close this window and start Present again.";
        status.Visible = true;
        if (Interface.CoreWebView2 != null) Interface.CoreWebView2.NavigateToString("<!doctype html><title>Notes hidden</title>");
    }

    internal Bitmap CaptureDummyFixtureForTest()
    {
        if (!audience.Testing) throw new InvalidOperationException("Fixture-only capture");
        watchdog.Stop();
        try
        {
            CaptureProtection.SetWindowDisplayAffinity(Handle, 0);
            using var screenshot = new Bitmap(ClientSize.Width, ClientSize.Height);
            using var graphics = Graphics.FromImage(screenshot);
            graphics.CopyFromScreen(PointToScreen(Point.Empty), Point.Empty, ClientSize);
            return (Bitmap)screenshot.Clone();
        }
        finally { if (!CaptureProtection.Enable(Handle).Allowed) Conceal(); watchdog.Start(); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { watchdog.Dispose(); mirror?.Dispose(); }
        base.Dispose(disposing);
    }
}