param(
  [switch]$OpenInWireshark
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $root 'logs'
$pointerFile = Join-Path $logDirectory 'artnet-capture-current.txt'
$pingTaskName = 'Play Room 1 ArtNet Node Ping Monitor'

if (-not (Test-Path -LiteralPath $pointerFile)) {
  throw "No active Art-Net capture record was found at $pointerFile."
}

$etlPath = (Get-Content -LiteralPath $pointerFile -Raw).Trim()
if (-not $etlPath -or -not (Test-Path -LiteralPath $etlPath)) {
  throw "The recorded ETL capture does not exist: $etlPath"
}

& pktmon stop | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to stop Packet Monitor cleanly.'
}

& pktmon filter remove | Out-Null

if (Get-ScheduledTask -TaskName $pingTaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $pingTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $pingTaskName -Confirm:$false
}

$pcapPath = [System.IO.Path]::ChangeExtension($etlPath, '.pcapng')
& pktmon etl2pcap $etlPath --out $pcapPath | Out-Host
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pcapPath)) {
  throw 'Packet Monitor stopped, but the capture could not be converted to pcapng.'
}

Write-Host ''
Write-Host "Art-Net capture saved: $pcapPath"
Write-Host 'Wireshark display filter: artnet || udp.port == 6454'

if ($OpenInWireshark) {
  $wireshark = Join-Path $env:ProgramFiles 'Wireshark\Wireshark.exe'
  if (-not (Test-Path -LiteralPath $wireshark)) {
    throw 'Wireshark is not installed in the standard location.'
  }
  Start-Process -FilePath $wireshark -ArgumentList @($pcapPath)
}
