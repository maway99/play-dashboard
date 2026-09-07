param(
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

& (Join-Path $root 'scripts\verify-lighting-network.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$task = Get-ScheduledTask -TaskName 'Play Gloucester Room One Panel' -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Error 'The Play Gloucester Room One Panel scheduled task is missing.'
  exit 1
}
Write-Host "Scheduled task OK: $($task.State)"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$panelState = $null
$streamDeckState = $null
while ((Get-Date) -lt $deadline) {
  try {
    $panelState = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/state' -TimeoutSec 3
    $streamDeckState = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/stream-deck/status' -TimeoutSec 3
    if (
      $panelState.ma2 -eq 'connected' -and
      $panelState.config.ma2.ip -eq '127.0.0.1' -and
      $panelState.link.carabiner -eq 'connected' -and
      $streamDeckState.companion.reachable -and
      $streamDeckState.companion.baseUrl -eq 'http://127.0.0.1:8000'
    ) { break }
  } catch {}
  Start-Sleep -Seconds 2
}

if (-not $panelState) {
  Write-Error 'Panel server did not respond on http://127.0.0.1:3000.'
  exit 1
}
if ($panelState.config.ma2.ip -ne '127.0.0.1') {
  Write-Error "Panel runtime MA2 host is '$($panelState.config.ma2.ip)', expected 127.0.0.1."
  exit 1
}
if ($panelState.ma2 -ne 'connected') {
  Write-Error 'Panel server is running, but grandMA2 is not connected on localhost:30000.'
  exit 1
}
if ($panelState.link.carabiner -ne 'connected') {
  Write-Error 'Carabiner Ableton Link bridge is not connected on localhost:17000.'
  exit 1
}
if (-not $streamDeckState.companion.reachable) {
  Write-Error "Companion is not reachable: $($streamDeckState.companion.lastError)"
  exit 1
}
if ($streamDeckState.companion.baseUrl -ne 'http://127.0.0.1:8000') {
  Write-Error "Panel runtime Companion URL is '$($streamDeckState.companion.baseUrl)', expected http://127.0.0.1:8000."
  exit 1
}

$kiosk = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @('chrome.exe', 'msedge.exe') } |
  Where-Object { $_.CommandLine -like '*Play Gloucester Room One Panel Chrome*' } |
  Select-Object -First 1
if (-not $kiosk) {
  Write-Error 'The dedicated Chrome kiosk process is not running.'
  exit 1
}

Write-Host 'Panel server OK: http://127.0.0.1:3000'
Write-Host 'grandMA2 OK: 127.0.0.1:30000'
Write-Host 'Companion OK: http://127.0.0.1:8000'
Write-Host 'Ableton Link bridge OK: 127.0.0.1:17000'
Write-Host 'Chrome kiosk OK'
Write-Host 'INSTALL VERIFIED'
exit 0
