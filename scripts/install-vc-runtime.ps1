param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = 'Stop'
$runtimeKey = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
$runtime = Get-ItemProperty $runtimeKey -ErrorAction SilentlyContinue
if ($runtime.Installed -eq 1) {
  Write-Host "Microsoft Visual C++ x64 runtime already installed ($($runtime.Version))"
  exit 0
}

$installer = Join-Path $Root 'vendor\vc_redist.x64.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  $installer = Join-Path $env:TEMP 'vc_redist.x64.exe'
  Write-Host 'Downloading Microsoft Visual C++ x64 runtime...'
  Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $installer -UseBasicParsing
}

$process = Start-Process -FilePath $installer -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru
if ($process.ExitCode -notin @(0, 1638, 3010)) {
  Write-Error "Visual C++ runtime installer failed with exit code $($process.ExitCode)."
  exit $process.ExitCode
}

Write-Host "Microsoft Visual C++ x64 runtime installed (exit $($process.ExitCode))"
exit 0
