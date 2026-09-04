# Close only Chrome instances launched with the Play Gloucester Room One kiosk profile.
$processes = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue
if (-not $processes) { exit 0 }

foreach ($proc in $processes) {
  if ($proc.CommandLine -and $proc.CommandLine -like '*Play Gloucester Room One Panel Chrome*') {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

exit 0
