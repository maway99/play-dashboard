param(
  [switch]$Install,
  [switch]$VerifyOnly,
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = 'Stop'
$taskName = 'Play Dashboard Disable Windows Update'
$scriptPath = $MyInvocation.MyCommand.Path
$logs = Join-Path $Root 'logs'
$policyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
$auPolicyPath = Join-Path $policyPath 'AU'
$serviceNames = @('wuauserv', 'UsoSvc', 'WaaSMedicSvc', 'DoSvc', 'InstallService', 'uhssvc')
$taskPaths = @(
  '\Microsoft\Windows\WindowsUpdate\',
  '\Microsoft\Windows\UpdateOrchestrator\',
  '\Microsoft\Windows\WaaSMedic\',
  '\Microsoft\Windows\InstallService\'
)

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated Administrator session.'
  }
}

function Get-UpdateState {
  $windowsUpdate = Get-ItemProperty $policyPath -ErrorAction SilentlyContinue
  $automaticUpdate = Get-ItemProperty $auPolicyPath -ErrorAction SilentlyContinue
  [ordered]@{
    capturedAt = (Get-Date).ToString('o')
    policies = [ordered]@{
      DisableWindowsUpdateAccess = $windowsUpdate.DisableWindowsUpdateAccess
      DoNotConnectToWindowsUpdateInternetLocations = $windowsUpdate.DoNotConnectToWindowsUpdateInternetLocations
      SetDisableUXWUAccess = $windowsUpdate.SetDisableUXWUAccess
      NoAutoUpdate = $automaticUpdate.NoAutoUpdate
      AUOptions = $automaticUpdate.AUOptions
    }
    services = @($serviceNames | ForEach-Object {
      $service = Get-CimInstance Win32_Service -Filter "Name='$_'" -ErrorAction SilentlyContinue
      if ($service) {
        [ordered]@{
          name = $service.Name
          state = $service.State
          startMode = $service.StartMode
          registryStart = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$($service.Name)" -ErrorAction SilentlyContinue).Start
        }
      }
    })
    scheduledTasks = @($taskPaths | ForEach-Object {
      Get-ScheduledTask -TaskPath $_ -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{ path = $_.TaskPath; name = $_.TaskName; state = $_.State.ToString(); enabled = $_.Settings.Enabled }
      }
    })
  }
}

function Test-UpdateLock {
  $windowsUpdate = Get-ItemProperty $policyPath -ErrorAction SilentlyContinue
  $automaticUpdate = Get-ItemProperty $auPolicyPath -ErrorAction SilentlyContinue
  $service = Get-Service wuauserv -ErrorAction SilentlyContinue
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $policyLocked =
    $windowsUpdate.DisableWindowsUpdateAccess -eq 1 -and
    $windowsUpdate.DoNotConnectToWindowsUpdateInternetLocations -eq 1 -and
    $windowsUpdate.SetDisableUXWUAccess -eq 1 -and
    $automaticUpdate.NoAutoUpdate -eq 1
  $serviceLocked = $service -and $service.Status -eq 'Stopped' -and $service.StartType -eq 'Disabled'
  $taskReady = $task -and $task.State -in @('Ready', 'Running')
  [ordered]@{ policyLocked = $policyLocked; updateServiceLocked = $serviceLocked; enforcementTaskReady = $taskReady }
}

Assert-Administrator

if ($VerifyOnly) {
  $verification = Test-UpdateLock
  $verification | ConvertTo-Json
  if (-not ($verification.policyLocked -and $verification.updateServiceLocked -and $verification.enforcementTaskReady)) {
    throw 'Windows Update lock verification failed.'
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null
$stateBackup = Join-Path $logs 'windows-update-before-lock.json'
if ($Install -and -not (Test-Path $stateBackup)) {
  Get-UpdateState | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateBackup -Encoding UTF8
  Write-Host "Saved the original Windows Update state to $stateBackup"
}

New-Item -Path $policyPath -Force | Out-Null
New-Item -Path $auPolicyPath -Force | Out-Null
foreach ($entry in @{
  DisableWindowsUpdateAccess = 1
  DoNotConnectToWindowsUpdateInternetLocations = 1
  SetDisableUXWUAccess = 1
}.GetEnumerator()) {
  New-ItemProperty -Path $policyPath -Name $entry.Key -Value $entry.Value -PropertyType DWord -Force | Out-Null
}
foreach ($entry in @{ NoAutoUpdate = 1; AUOptions = 2 }.GetEnumerator()) {
  New-ItemProperty -Path $auPolicyPath -Name $entry.Key -Value $entry.Value -PropertyType DWord -Force | Out-Null
}

foreach ($name in $serviceNames) {
  if (-not (Get-Service $name -ErrorAction SilentlyContinue)) { continue }
  try { Stop-Service $name -Force -ErrorAction Stop } catch { Write-Warning "Could not stop protected service $name now: $($_.Exception.Message)" }
  & sc.exe config $name start= disabled | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "Could not set protected service $name to Disabled (sc.exe exit $LASTEXITCODE)." }
}

foreach ($taskPath in $taskPaths) {
  Get-ScheduledTask -TaskPath $taskPath -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Disable-ScheduledTask -InputObject $_ -ErrorAction Stop | Out-Null
    } catch {
      Write-Warning "Could not disable protected task $($_.TaskPath)$($_.TaskName): $($_.Exception.Message)"
    }
  }
}

if ($Install) {
  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Root `"$Root`"" `
    -WorkingDirectory $Root
  $triggers = @(
    New-ScheduledTaskTrigger -AtStartup
    New-ScheduledTaskTrigger -Daily -At '03:00'
  )
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggers `
    -Principal $principal `
    -Settings $settings `
    -Description 'Re-applies the venue Windows Update lock at startup and daily.' `
    -Force | Out-Null
}

$verification = Test-UpdateLock
$verification | ConvertTo-Json
if (-not ($verification.policyLocked -and $verification.updateServiceLocked)) {
  throw 'Core Windows Update policy/service lock did not apply.'
}
if ($Install -and -not $verification.enforcementTaskReady) {
  throw 'The Windows Update enforcement task was not registered.'
}

Write-Host 'Windows Update lock applied. Reboot was not required.'
exit 0
