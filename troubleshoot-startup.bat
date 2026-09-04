@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo === Play Gloucester Room One Panel startup troubleshoot ===
echo Project: %CD%
echo User:    %USERNAME%
echo.

echo --- Scheduled tasks ---
schtasks /Query /TN "Play Gloucester Room One PM2 Resurrect" /FO LIST /V 2>nul
if errorlevel 1 echo Play Gloucester Room One PM2 Resurrect: NOT FOUND
echo.
schtasks /Query /TN "Play Gloucester Room One Chrome Kiosk" /FO LIST /V 2>nul
if errorlevel 1 echo Play Gloucester Room One Chrome Kiosk: NOT FOUND
echo.

echo --- Startup folder shortcuts ---
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
dir /b "%STARTUP%\Play-Gloucester-Room-One-Panel-*" 2>nul || echo No Play Gloucester Room One shortcuts in Startup folder
echo.

echo --- PM2 ---
where pm2 >nul 2>&1 && pm2 status || echo pm2 not on PATH
echo.

echo --- Server ---
curl -sf -o nul http://127.0.0.1:3000/ 2>nul && echo Server: OK || echo Server: NOT responding
echo.
echo --- panel-server.log (last 20 lines) ---
if exist "logs\panel-server.log" (
  powershell -NoProfile -Command "Get-Content 'logs\panel-server.log' -Tail 20"
) else (
  echo logs\panel-server.log not found
)
echo.
echo --- node-direct.log (fallback) ---
if exist "logs\node-direct.log" type "logs\node-direct.log"
echo.

echo --- Recent logs ---
if exist "logs\pm2-startup.log" (
  echo [pm2-startup.log - last 15 lines]
  powershell -NoProfile -Command "Get-Content 'logs\pm2-startup.log' -Tail 15"
) else (
  echo logs\pm2-startup.log not found ^(PM2 task may never have run^)
)
echo.
if exist "logs\kiosk-startup.log" (
  echo [kiosk-startup.log - last 15 lines]
  powershell -NoProfile -Command "Get-Content 'logs\kiosk-startup.log' -Tail 15"
) else (
  echo logs\kiosk-startup.log not found ^(Chrome task may never have run^)
)
echo.

echo --- Manual test ---
echo To start server:    scripts\start-panel-server.bat logon
echo To open kiosk:      startup-chrome.bat
echo To fix auto-start:  setup.bat ^(as Administrator^)
pause
