param(
  [string]$Address = '2.0.0.10',
  [int]$PrefixLength = 8
)

$ErrorActionPreference = 'Stop'
$matches = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
  Where-Object { $_.IPAddress -eq $Address }

if (-not $matches) {
  Write-Error "No Windows network adapter has $Address/$PrefixLength. Configure the dedicated lighting Ethernet adapter before continuing."
  exit 1
}

$match = $matches | Where-Object { $_.PrefixLength -eq $PrefixLength } | Select-Object -First 1
if (-not $match) {
  $found = ($matches | ForEach-Object { "$($_.InterfaceAlias)/$($_.PrefixLength)" }) -join ', '
  Write-Error "Found $Address on $found, but the required subnet mask is 255.0.0.0 (/$PrefixLength)."
  exit 1
}

$adapter = Get-NetAdapter -InterfaceIndex $match.InterfaceIndex -ErrorAction Stop
if ($adapter.Status -ne 'Up') {
  Write-Error "Lighting adapter '$($match.InterfaceAlias)' has the right address but is not connected."
  exit 1
}

Write-Host "Lighting network OK: $($match.InterfaceAlias) = $Address/$PrefixLength (255.0.0.0)"

$gateway = (Get-NetIPConfiguration -InterfaceIndex $match.InterfaceIndex -ErrorAction SilentlyContinue).IPv4DefaultGateway
if ($gateway) {
  Write-Warning "The lighting adapter has a default gateway ($($gateway.NextHop)). A dedicated MA-Net/Art-Net adapter normally has no gateway."
}

exit 0
