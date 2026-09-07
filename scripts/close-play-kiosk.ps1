# Close only browser processes launched with the dedicated panel profile.
$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -in @('chrome.exe', 'msedge.exe') }

foreach ($proc in $processes) {
  if ($proc.CommandLine -and $proc.CommandLine -like '*Play Gloucester Room One Panel Chrome*') {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

exit 0
