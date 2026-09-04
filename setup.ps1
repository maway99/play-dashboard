# =============================================================================
#  Play Gloucester Room One Panel — one-shot installer for the lighting PC (Windows).
#  Run via setup.bat (recommended) or:
#    powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
#  Performs:
#    1. Sanity checks (admin, Node, npm, Chrome, project build)
#    2. npm install + client build
#    3. PM2 install + start + save
#    4. Task Scheduler (logon, with delays + retries):
#         a) "Play Gloucester Room One PM2 Resurrect"  — startup-pm2.bat
#         b) "Play Gloucester Room One Chrome Kiosk"   — startup-chrome.bat (waits for server)
#    5. Kiosk-friendly Windows settings (power, screensaver, toasts)
#    6. Smoke test against http://127.0.0.1:3000
# =============================================================================

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Require-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run this script from an elevated PowerShell (Right-click -> Run as Administrator)."
    exit 1
  }
}

function Need-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "$name not found on PATH. Install it before continuing."
    exit 1
  }
}

function Resolve-ChromePath {
  $candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

function Resolve-Pm2Path {
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    return (Get-Command pm2).Source
  }
  $npmPm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
  if (Test-Path $npmPm2) { return $npmPm2 }
  return $null
}

function Set-KioskPowerSettings {
  Write-Host "==> Applying kiosk power settings (plugged in = never sleep)"
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change disk-timeout-ac 0 | Out-Null
}

function Set-KioskUserSettings {
  Write-Host "==> Applying kiosk user settings (screensaver off, toasts off)"
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name ScreenSaveActive -Value '0' -Force
  Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name ScreenSaveTimeOut -Value '0' -Force
  $pushPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications'
  if (-not (Test-Path $pushPath)) {
    New-Item -Path $pushPath -Force | Out-Null
  }
  Set-ItemProperty -Path $pushPath -Name ToastEnabled -Value 0 -Type DWord -Force
}

function Register-PlayGloucesterRoomOneScheduledTask {
  param(
    [string]$Name,
    [string]$BatPath
  )

  # schtasks.exe works on all Windows 10/11 builds with PowerShell 5.1.
  # Avoid New-ScheduledTaskTrigger / CIM APIs (missing -Delay, Enabled, etc.).
  if (-not (Test-Path $BatPath)) {
    Write-Error "Batch file not found: $BatPath"
    exit 1
  }

  $batFull = (Resolve-Path $BatPath).Path
  $runAs = $env:USERNAME
  if ($env:USERDOMAIN -and $env:USERDOMAIN -ne $env:COMPUTERNAME) {
    $runAs = "$env:USERDOMAIN\$env:USERNAME"
  }

  schtasks /Delete /TN $Name /F 2>$null | Out-Null

  $output = schtasks /Create /TN $Name /TR "`"$batFull`"" /SC ONLOGON /RU $runAs /RL LIMITED /F 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host $output
    Write-Error "schtasks failed to create '$Name' (exit $LASTEXITCODE)"
    exit 1
  }

  Write-Host "    Registered: $Name (at logon for $runAs)"
}

function Test-PanelServer {
  param([int]$TimeoutSeconds = 30)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return $true
      }
    }
    catch {
      # not ready yet
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

# --- Main --------------------------------------------------------------------

Write-Host "==> Play Gloucester Room One Panel setup - running in $root" -ForegroundColor Cyan
Require-Admin
Need-Cmd 'node'
Need-Cmd 'npm'

$configPath = Join-Path $root 'config.json'
if (-not (Test-Path $configPath)) {
  Write-Error "config.json not found in $root"
  exit 1
}

$chrome = Resolve-ChromePath
if (-not $chrome) {
  Write-Error "Google Chrome not found. Install Chrome before running setup."
  exit 1
}
Write-Host "    Chrome: $chrome"

Write-Host "==> Installing server dependencies"
npm install --no-audit --no-fund

Write-Host "==> Installing client dependencies"
npm --prefix client install --no-audit --no-fund

Write-Host "==> Building client bundle (client\dist)"
npm --prefix client run build

if (-not (Test-Path (Join-Path $root 'client\dist\index.html'))) {
  Write-Error "Client build failed - client\dist\index.html not found."
  exit 1
}

if (-not (Get-Command 'pm2' -ErrorAction SilentlyContinue)) {
  Write-Host "==> Installing pm2 globally"
  npm install -g pm2
}

# Refresh PATH in this session so pm2 is found immediately after global install.
$npmBin = Join-Path $env:APPDATA 'npm'
$nodeDir = Split-Path (Get-Command node).Source -Parent
$env:Path = "$nodeDir;$npmBin;$env:Path"

$pm2 = Resolve-Pm2Path
if (-not $pm2) {
  Write-Error "pm2 not found after install. Close and reopen PowerShell, then re-run setup.bat."
  exit 1
}
Write-Host "    PM2: $pm2"

Write-Host "==> Starting server under PM2"
$ensureBat = Join-Path $root 'scripts\pm2-ensure-panel.bat'
if (-not (Test-Path $ensureBat)) { Write-Error "Missing $ensureBat"; exit 1 }
$env:Path = "$nodeDir;$npmBin;$env:Path"
cmd /c "`"$ensureBat`" restart"
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "PM2 start failed. Common fixes:" -ForegroundColor Yellow
  Write-Host "  1. Close this window, open a NEW admin PowerShell, run setup.bat again"
  Write-Host "  2. Or manually:  cd `"$root`""
  Write-Host "                 pm2 start ecosystem.config.cjs"
  Write-Host "                 pm2 logs play-gloucester-room-one-panel"
  Write-Error "Failed to start play-gloucester-room-one-panel under PM2."
  exit 1
}

$logsDir = Join-Path $root 'logs'
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

Write-Host "==> Registering Task Scheduler entries"
$pm2Bat = Join-Path $root 'startup-pm2.bat'
$kioskBat = Join-Path $root 'startup-chrome.bat'
if (-not (Test-Path $pm2Bat)) { Write-Error "Missing $pm2Bat"; exit 1 }
if (-not (Test-Path $kioskBat)) { Write-Error "Missing $kioskBat"; exit 1 }

# Remove legacy tasks from older installs.
schtasks /Delete /TN 'Play Gloucester Room One Edge Kiosk' /F 2>$null | Out-Null

Register-PlayGloucesterRoomOneScheduledTask -Name 'Play Gloucester Room One PM2 Resurrect' -BatPath $pm2Bat
Register-PlayGloucesterRoomOneScheduledTask -Name 'Play Gloucester Room One Chrome Kiosk' -BatPath $kioskBat

Set-KioskPowerSettings
Set-KioskUserSettings

Write-Host "==> Verifying panel server responds"
if (Test-PanelServer -TimeoutSeconds 30) {
  Write-Host "    Server OK at http://127.0.0.1:3000" -ForegroundColor Green
}
else {
  Write-Warning "Server did not respond within 30s. Check: pm2 logs play-gloucester-room-one-panel"
}

Write-Host ""
Write-Host "==> Done." -ForegroundColor Green
Write-Host "    Server status:   pm2 status"
Write-Host "    Server logs:     pm2 logs play-gloucester-room-one-panel"
Write-Host "    Startup logs:    $logsDir"
Write-Host "    Open panel now:  http://127.0.0.1:3000"
Write-Host ""
Write-Host "    Reboot test (required before go-live):"
Write-Host "      1. grandMA2 onPC starts (your existing Task Scheduler entry)"
Write-Host "      2. At logon: Play Gloucester Room One PM2 Resurrect (waits 10s, then starts server)"
Write-Host "      3. At logon: Play Gloucester Room One Chrome Kiosk (waits for server, then opens Chrome)"
Write-Host ""
Write-Host "    For a hands-off venue PC, also configure:"
Write-Host "      - Windows auto-logon for the venue user (netplwiz)"
Write-Host "      - Disable Windows Update auto-restart during show hours"
Write-Host "      - Install this project to a fixed path (e.g. C:\play-gloucester-room-one-panel\)"
Write-Host ""
