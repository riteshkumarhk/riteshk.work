using System.ComponentModel;
using System.Runtime.InteropServices;

namespace PresenterCaptureProbe;

internal static class CaptureProtection
{
    internal const uint ExcludeFromCapture = 0x11;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetWindowDisplayAffinity(nint window, uint affinity);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowDisplayAffinity(nint window, out uint affinity);
    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmIsCompositionEnabled([MarshalAs(UnmanagedType.Bool)] out bool enabled);

    internal static (bool Allowed, string Status) Enable(nint window)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
            return (false, "Windows 10 version 2004 or later is required.");
        if (DwmIsCompositionEnabled(out var enabled) != 0 || !enabled)
            return (false, "Desktop composition is unavailable.");
        if (!SetWindowDisplayAffinity(window, ExcludeFromCapture))
            return (false, "Windows rejected capture exclusion: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        return Verify(window);
    }

    internal static (bool Allowed, string Status) Verify(nint window)
    {
        if (DwmIsCompositionEnabled(out var enabled) != 0 || !enabled)
            return (false, "Desktop composition is unavailable.");
        if (!GetWindowDisplayAffinity(window, out var affinity))
            return (false, "Cannot verify capture exclusion: " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        return affinity == ExcludeFromCapture
            ? (true, "Windows capture exclusion enabled (0x11)")
            : (false, $"Capture exclusion is not enabled (0x{affinity:X}).");
    }
}