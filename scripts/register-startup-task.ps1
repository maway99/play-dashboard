param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$taskName = 'Play Gloucester Room One Panel'
$launcher = Join-Path $Root 'start-panel.bat'

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  Write-Error "Panel launcher not found: $launcher"
  exit 1
}

$action = New-ScheduledTaskAction `
  -Execute 'cmd.exe' `
  -Argument "/d /c `"$launcher`"" `
  -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal `
  -UserId $userSid `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts grandMA2, Companion, the Play dashboard server and kiosk after operator logon.' |
  Out-Null

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
Write-Host "Task Scheduler: $taskName ($($identity.Name), SID $userSid, state $($task.State))"
exit 0
