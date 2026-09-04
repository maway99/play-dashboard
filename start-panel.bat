@echo off
cd /d "%~dp0"
echo Starting play-gloucester-room-one-panel server...
call "%~dp0scripts\start-panel-server.bat" logon
if errorlevel 1 (
  echo Failed. See logs\panel-server.log
  pause
  exit /b 1
)
echo Server running at http://127.0.0.1:3000
pause
exit /b 0
