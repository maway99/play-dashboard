param(
  [string]$NodeIp = '2.0.0.1',
  [Parameter(Mandatory = $true)]
  [string]$LogPath
)

$ErrorActionPreference = 'Stop'
$ping = [System.Net.NetworkInformation.Ping]::new()

Set-Content -LiteralPath $LogPath -Value 'timestamp,status,roundTripMs' -Encoding UTF8

try {
  while ($true) {
    $timestamp = [DateTimeOffset]::Now.ToString('o')
    try {
      $reply = $ping.Send($NodeIp, 900)
      if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
        Add-Content -LiteralPath $LogPath -Value "$timestamp,success,$($reply.RoundtripTime)"
      } else {
        Add-Content -LiteralPath $LogPath -Value "$timestamp,$($reply.Status),"
      }
    } catch {
      Add-Content -LiteralPath $LogPath -Value "$timestamp,error,"
    }
    Start-Sleep -Milliseconds 1000
  }
} finally {
  $ping.Dispose()
}
