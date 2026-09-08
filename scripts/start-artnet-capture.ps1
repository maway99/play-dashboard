param(
  [ValidateRange(32, 2048)]
  [int]$MaximumSizeMb = 256
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $root 'logs'
$pointerFile = Join-Path $logDirectory 'artnet-capture-current.txt'

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

& pktmon start --capture --comp nics --type all --pkt-size 0 --file-name $etlPath --file-size $MaximumSizeMb --log-mode circular
if ($LASTEXITCODE -ne 0) {
  & pktmon filter remove | Out-Null
  throw 'Unable to start the Art-Net capture.'
}

Set-Content -LiteralPath $pointerFile -Value $etlPath -Encoding UTF8

Write-Host ''
Write-Host "Art-Net capture is running on UDP 6454."
Write-Host "Circular capture limit: $MaximumSizeMb MB"
Write-Host "ETL file: $etlPath"
Write-Host 'After the next dropout, run scripts\stop-artnet-capture.ps1 immediately.'

