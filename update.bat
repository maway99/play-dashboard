@echo off
REM ---------------------------------------------------------------------------
REM  Play Gloucester Room One Panel — update script
REM  Double-click this on the lighting PC to pull latest, rebuild, restart.
REM  On a NEW PC, run setup.bat once first (not update.bat).
REM ---------------------------------------------------------------------------

cd /d "%~dp0"
setlocal

echo === Play Gloucester Room One Panel update ===

where git >nul 2>nul
if %errorlevel% == 0 (
  echo.
  echo [1/4] git pull
  git pull
  if errorlevel 1 (
    echo.
    echo *** git pull failed. Resolve conflicts and re-run update.bat. ***
    pause
    exit /b 1
  )
) else (
  echo [1/4] git not found on PATH - skipping pull. Update files manually.
)

echo.
echo [2/4] npm install
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo [3/4] npm --prefix client install
call npm --prefix client install --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo [3b]  npm --prefix client run build
call npm --prefix client run build
if errorlevel 1 goto :failed

echo.
echo [4/4] pm2 restart (or first-time start if not registered yet)
call "%~dp0scripts\pm2-ensure-panel.bat" restart
if errorlevel 1 goto :failed

echo.
echo === Update complete. Panel will refresh on the next WebSocket reconnect. ===
echo     If anything looks wrong, check:  pm2 logs play-gloucester-room-one-panel
pause
exit /b 0

:failed
echo.
echo *** Update FAILED. Check the output above, fix, and re-run update.bat. ***
echo     On a new PC, run setup.bat as Administrator first.
pause
exit /b 1
