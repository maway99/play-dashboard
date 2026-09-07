param(
  [int]$Port = 8000,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

function Test-CompanionPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(750)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (Test-CompanionPort) {
  Write-Host "Companion is already available on 127.0.0.1:$Port"
  exit 0
}

$candidates = @(
  (Join-Path $env:ProgramFiles 'Companion\Companion.exe'),
  (Join-Path $env:ProgramFiles 'Bitfocus Companion\Companion.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\companion\Companion.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Bitfocus Companion\Companion.exe')
)

if (${env:ProgramFiles(x86)}) {
  $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Companion\Companion.exe')
  $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Bitfocus Companion\Companion.exe')
}

$uninstallRoots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

foreach ($root in $uninstallRoots) {
  Get-ItemProperty $root -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*Companion*' } |
    ForEach-Object {
      if ($_.DisplayIcon) {
        $candidates += (($_.DisplayIcon -replace ',\d+$','').Trim('"'))
      }
      if ($_.InstallLocation) {
        $candidates += (Join-Path $_.InstallLocation 'Companion.exe')
      }
    }
}

$executable = $candidates |
  Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1

if ($executable) {
  Write-Host "Starting Companion: $executable"
  Start-Process -FilePath $executable
} else {
  $shortcut = Get-ChildItem @(
      (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
      (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
    ) -Filter '*Companion*.lnk' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if (-not $shortcut) {
    Write-Error 'Bitfocus Companion is not installed in a recognised location.'
    exit 1
  }

  Write-Host "Starting Companion shortcut: $($shortcut.FullName)"
  Start-Process -FilePath $shortcut.FullName
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  if (Test-CompanionPort) {
    Write-Host "Companion is ready on 127.0.0.1:$Port"
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Error "Companion did not open port $Port within $TimeoutSeconds seconds."
exit 1
