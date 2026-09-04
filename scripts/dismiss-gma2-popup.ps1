# Waits for grandMA2 onPC to start, sends Enter to dismiss the fader wing popup,
# then minimises gma2onpc so Chrome kiosk can take the foreground.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
Add-Type -AssemblyName System.Windows.Forms

# Wait up to 60s for gma2onpc to start
$proc = $null
for ($i = 0; $i -lt 60; $i++) {
    $proc = Get-Process -Name 'gma2onpc' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) { break }
    Start-Sleep -Seconds 1
}

if (-not $proc) {
    Write-Host "gma2onpc not detected within 60s - skipping popup dismiss"
    exit 0
}

Write-Host "gma2onpc detected (PID: $($proc.Id)), waiting 15s for popup to appear..."
Start-Sleep -Seconds 15

# Activate the gma2onpc window and send Enter to dismiss the popup
try {
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)
    Start-Sleep -Milliseconds 300
} catch {}

[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-Host "Enter sent to dismiss popup"

# Minimise gma2onpc so the Chrome kiosk can take the foreground
Start-Sleep -Seconds 2
$proc.Refresh()
if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
    [Win32]::ShowWindow($proc.MainWindowHandle, 6) | Out-Null  # SW_MINIMIZE
    Write-Host "gma2onpc minimised"
}

exit 0
