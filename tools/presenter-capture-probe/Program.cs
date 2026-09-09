using System.Text.Json;

namespace PresenterCaptureProbe;

internal sealed class ProbeWindow : Form
{
    private readonly Func<nint, (bool Allowed, string Status)> enable;
    private readonly Label status = new() { Dock = DockStyle.Top, Height = 62, Padding = new Padding(20, 12, 20, 4) };
    private readonly Label notes = new() { Dock = DockStyle.Fill, Padding = new Padding(20), Font = new Font("Segoe UI", 17), Visible = false };
    private readonly System.Windows.Forms.Timer watchdog = new() { Interval = 250 };
    private bool allowed;
    private int slide = 1;
    private readonly DateTime started = DateTime.UtcNow;

    internal bool NotesVisible => notes.Visible;
    internal bool NotesEmpty => notes.Text.Length == 0;

    internal ProbeWindow(Func<nint, (bool Allowed, string Status)>? enable = null)
    {
        this.enable = enable ?? CaptureProtection.Enable;
        Text = "Presenter capture test - dummy notes only";
        TopMost = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(640, 430);
        MinimumSize = new Size(500, 380);
        BackColor = Color.FromArgb(20, 20, 23);
        ForeColor = Color.FromArgb(236, 231, 225);
        Font = new Font("Segoe UI", 11);
        var warning = new Label
        {
            Dock = DockStyle.Bottom, Height = 76, Padding = new Padding(20, 8, 20, 8),
            Text = "Dummy content only. Windows acceptance is not a privacy guarantee.\nVerify from a second participant during whole-screen sharing."
        };
        var controls = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 56, Padding = new Padding(16, 6, 16, 6) };
        foreach (var label in new[] { "Previous", "Next", "Recheck", "Close" })
        {
            var button = new Button { Text = label, AutoSize = true, Height = 34, FlatStyle = FlatStyle.Flat, Padding = new Padding(8, 0, 8, 0) };
            button.Click += (_, _) =>
            {
                if (label == "Close") Close();
                else if (label == "Recheck") Protect();
                else if (allowed) { slide = label == "Next" ? Math.Min(3, slide + 1) : Math.Max(1, slide - 1); RenderNotes(); }
            };
            controls.Controls.Add(button);
        }
        Controls.Add(notes);
        Controls.Add(controls);
        Controls.Add(warning);
        Controls.Add(status);
        watchdog.Tick += (_, _) => CheckProtection();
        Shown += (_, _) => watchdog.Start();
    }

    protected override void OnHandleCreated(EventArgs args)
    {
        base.OnHandleCreated(args);
        Protect();
    }

    protected override void OnHandleDestroyed(EventArgs args)
    {
        Conceal();
        base.OnHandleDestroyed(args);
    }

    private void Conceal()
    {
        allowed = false;
        notes.Visible = false;
        notes.Text = "";
    }

    private void Protect()
    {
        Conceal();
        var result = enable(Handle);
        allowed = result.Allowed;
        status.Text = result.Status;
        status.ForeColor = allowed ? Color.FromArgb(128, 210, 167) : Color.FromArgb(255, 143, 143);
        if (allowed) { RenderNotes(); notes.Visible = true; }
    }

    internal void CheckProtection()
    {
        if (!allowed || !IsHandleCreated) return;
        var result = CaptureProtection.Verify(Handle);
        if (!result.Allowed)
        {
            Conceal();
            status.Text = "Notes hidden. " + result.Status;
            status.ForeColor = Color.FromArgb(255, 143, 143);
        }
        else RenderNotes();
    }

    private void RenderNotes()
    {
        notes.Text = $"PRIVATE TEST NOTES - {slide} / 3\n\n" +
            new[] { "Introduce the problem.\nPause before explaining the decision.", "Point to the slide.\nThese notes should stay above it locally.", "Summarize the outcome.\nAsk the other participant what they can see." }[slide - 1] +
            $"\n\nElapsed: {(DateTime.UtcNow - started):mm\\:ss}";
    }

    internal void RecreateForTest() => RecreateHandle();

    protected override void Dispose(bool disposing)
    {
        if (disposing) watchdog.Dispose();
        base.Dispose(disposing);
    }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (!args.Contains("--self-test")) { Application.Run(new ProbeWindow()); return 0; }
        var checks = new List<string>();
        try
        {
            using (var window = new ProbeWindow())
            {
                window.Show();
                Application.DoEvents();
                Require(window.NotesVisible && window.TopMost && CaptureProtection.Verify(window.Handle).Allowed, "Native exclusion and topmost enabled");
                window.RecreateForTest();
                Application.DoEvents();
                Require(window.NotesVisible && CaptureProtection.Verify(window.Handle).Allowed, "Recreated handle is protected");
                Require(CaptureProtection.SetWindowDisplayAffinity(window.Handle, 0), "Test can revoke affinity");
                window.CheckProtection();
                Require(!window.NotesVisible && window.NotesEmpty, "Notes cleared when affinity is lost");
                window.Close();
            }
            using (var denied = new ProbeWindow(_ => (false, "Simulated Windows rejection")))
            {
                denied.Show();
                Application.DoEvents();
                Require(!denied.NotesVisible && denied.NotesEmpty, "Denied protection never reveals notes");
                denied.Close();
            }
            Console.WriteLine(JsonSerializer.Serialize(new { passed = checks, captureAppVerified = false }));
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { passed = checks, error = error.Message }));
            return 1;
        }
        void Require(bool condition, string name)
        {
            if (!condition) throw new InvalidOperationException(name);
            checks.Add(name);
        }
    }
}