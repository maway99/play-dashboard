param(
  [Parameter(Mandatory = $true)]
  [string]$CapturePath
)

$ErrorActionPreference = 'Stop'
$tshark = Join-Path $env:ProgramFiles 'Wireshark\tshark.exe'
$culture = [System.Globalization.CultureInfo]::InvariantCulture

if (-not (Test-Path -LiteralPath $tshark)) {
  throw "TShark was not found at $tshark."
}
if (-not (Test-Path -LiteralPath $CapturePath)) {
  throw "Capture file was not found: $CapturePath"
}

function Read-TsharkRows {
  param(
    [string]$DisplayFilter,
    [string[]]$Fields
  )

  $arguments = @('-r', $CapturePath, '-Y', $DisplayFilter, '-T', 'fields', '-E', 'separator=|', '-E', 'quote=n')
  foreach ($field in $Fields) {
    $arguments += @('-e', $field)
  }

  $rows = & $tshark @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "TShark failed for display filter: $DisplayFilter"
  }
  return $rows
}

$dmxRows = Read-TsharkRows -DisplayFilter 'artnet.header.opcode == 0x5000' -Fields @(
  'frame.number',
  'frame.time_epoch',
  'ip.src',
  'ip.dst',
  'artnet.output.sequence',
  'artnet.output.universe'
)

$dmxPackets = foreach ($row in $dmxRows) {
  $parts = $row -split '\|', 6
  if ($parts.Count -ne 6) { continue }
  [pscustomobject]@{
    Frame = [int]$parts[0]
    Time = [double]::Parse($parts[1], $culture)
    Source = $parts[2]
    Destination = $parts[3]
    Sequence = [int]$parts[4]
    Universe = [int]$parts[5]
  }
}

if (-not $dmxPackets) {
  throw 'No ArtDmx packets were found in the capture.'
}

$universeResults = foreach ($group in ($dmxPackets | Group-Object Universe | Sort-Object { [int]$_.Name })) {
  $ordered = @($group.Group | Sort-Object Time, Frame)
  $maximumGap = 0.0
  $gapStart = $null
  $gapEnd = $null
  $sequenceJumps = 0

  for ($index = 1; $index -lt $ordered.Count; $index++) {
    $previous = $ordered[$index - 1]
    $current = $ordered[$index]
    $gap = $current.Time - $previous.Time
    if ($gap -gt $maximumGap) {
      $maximumGap = $gap
      $gapStart = $previous.Time
      $gapEnd = $current.Time
    }

    $expectedSequence = ($previous.Sequence + 1) % 256
    if ($current.Sequence -ne $expectedSequence) {
      $sequenceJumps++
    }
  }

  [pscustomobject]@{
    Universe = [int]$group.Name
    Packets = $ordered.Count
    First = [DateTimeOffset]::FromUnixTimeMilliseconds([long]($ordered[0].Time * 1000)).ToLocalTime().ToString('HH:mm:ss.fff')
    Last = [DateTimeOffset]::FromUnixTimeMilliseconds([long]($ordered[-1].Time * 1000)).ToLocalTime().ToString('HH:mm:ss.fff')
    MaxGapSeconds = [math]::Round($maximumGap, 3)
    MaxGapStart = if ($null -ne $gapStart) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]($gapStart * 1000)).ToLocalTime().ToString('HH:mm:ss.fff') } else { '' }
    MaxGapEnd = if ($null -ne $gapEnd) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]($gapEnd * 1000)).ToLocalTime().ToString('HH:mm:ss.fff') } else { '' }
    SequenceJumps = $sequenceJumps
  }
}

$pollRows = Read-TsharkRows -DisplayFilter 'artnet.header.opcode == 0x2100 && ip.src == 2.0.0.1 && ip.dst == 2.0.0.10' -Fields @(
  'frame.number',
  'frame.time_epoch'
)
$pollTimes = @($pollRows | ForEach-Object {
  $parts = $_ -split '\|', 2
  [double]::Parse($parts[1], $culture)
})
$maximumPollGap = 0.0
for ($index = 1; $index -lt $pollTimes.Count; $index++) {
  $maximumPollGap = [math]::Max($maximumPollGap, $pollTimes[$index] - $pollTimes[$index - 1])
}

Write-Host "Capture: $CapturePath"
Write-Host "ArtDmx packets: $($dmxPackets.Count)"
Write-Host "Sender: $($dmxPackets[0].Source) -> $($dmxPackets[0].Destination)"
Write-Host ''
$universeResults | Format-Table -AutoSize
Write-Host "Node unicast ArtPollReply packets: $($pollTimes.Count)"
Write-Host "Maximum node reply gap: $([math]::Round($maximumPollGap, 3)) seconds"

