# Downloads the Windows Carabiner release (Ableton Link bridge) into tools\Carabiner.exe.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts\get-carabiner.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tools = Join-Path $root 'tools'
$version = 'v1.2.0'
$url = "https://github.com/Deep-Symmetry/carabiner/releases/download/$version/Carabiner_Win_x64.zip"
$zip = Join-Path $env:TEMP 'Carabiner_Win_x64.zip'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
Write-Host "Downloading Carabiner $version ..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $tools -Force
Remove-Item $zip -Force
$exe = Get-ChildItem -Path $tools -Filter 'Carabiner*.exe' -Recurse | Select-Object -First 1
if (-not $exe) { throw 'Carabiner.exe not found in the downloaded archive' }
if ($exe.FullName -ne (Join-Path $tools 'Carabiner.exe')) { Move-Item -Force $exe.FullName (Join-Path $tools 'Carabiner.exe') }
Write-Host "Installed $(Join-Path $tools 'Carabiner.exe')"
Write-Host 'Allow it through Windows Firewall (UDP 20808) when prompted, then restart the panel server.'
