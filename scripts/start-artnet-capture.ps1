param(
  [ValidateRange(32, 2048)]
  [int]$MaximumSizeMb = 256,
  [string]$NodeIp = '2.0.0.1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $root 'logs'
$pointerFile = Join-Path $logDirectory 'artnet-capture-current.txt'
$pingTaskName = 'Play Room 1 ArtNet Node Ping Monitor'

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$status = (& pktmon status 2>&1 | Out-String)
if ($status -notmatch 'not running') {
  throw "Packet Monitor is already running. Stop the existing capture before starting an Art-Net capture.`n$status"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$etlPath = Join-Path $logDirectory "artnet-$timestamp.etl"

& pktmon filter remove | Out-Null
& pktmon filter add 'Art-Net UDP 6454' -t UDP -p 6454 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to create the Art-Net UDP 6454 capture filter.'
}
& pktmon filter add 'Art-Net node ping' -i $NodeIp -t ICMP | Out-Null
if ($LASTEXITCODE -ne 0) {
  & pktmon filter remove | Out-Null
  throw "Unable to create the $NodeIp ICMP capture filter."
}

& pktmon start --capture --comp nics --type all --pkt-size 0 --file-name $etlPath --file-size $MaximumSizeMb --log-mode circular
if ($LASTEXITCODE -ne 0) {
  & pktmon filter remove | Out-Null
  throw 'Unable to start the Art-Net capture.'
}

Set-Content -LiteralPath $pointerFile -Value $etlPath -Encoding UTF8

$pingLogPath = Join-Path $logDirectory "artnet-node-ping-$timestamp.csv"
$watcherPath = Join-Path $PSScriptRoot 'watch-artnet-node.ps1'
$existingPingTask = Get-ScheduledTask -TaskName $pingTaskName -ErrorAction SilentlyContinue
if ($existingPingTask) {
  Stop-ScheduledTask -TaskName $pingTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $pingTaskName -Confirm:$false
}
$watcherArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$watcherPath`" -NodeIp `"$NodeIp`" -LogPath `"$pingLogPath`""
$pingAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $watcherArguments
$pingPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$pingSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $pingTaskName -Action $pingAction -Principal $pingPrincipal -Settings $pingSettings | Out-Null
Start-ScheduledTask -TaskName $pingTaskName

Write-Host ''
Write-Host "Art-Net capture is running on UDP 6454."
Write-Host "Node reachability monitor: $NodeIp"
Write-Host "Ping log: $pingLogPath"
Write-Host "Ping monitor task: $pingTaskName"
Write-Host "Circular capture limit: $MaximumSizeMb MB"
Write-Host "ETL file: $etlPath"
Write-Host 'After the next dropout, run scripts\stop-artnet-capture.ps1 immediately.'
