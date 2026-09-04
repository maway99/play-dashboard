@echo off
REM Play Gloucester Room One Panel — update script.
REM Double-click on the lighting PC to pull latest code, rebuild, and restart.
REM On a NEW PC, run setup.bat as Administrator first.

cd /d "%~dp0"
setlocal

echo === Play Gloucester Room One Panel update ===

where git >nul 2>&1
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
    echo [1/4] git not on PATH - skipping pull, update files manually.
)

echo.
echo [2/4] npm install ^(server^)
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo [3/4] npm install + build ^(client^)
call npm --prefix client install --no-audit --no-fund
if errorlevel 1 goto :failed
call npm --prefix client run build
if errorlevel 1 goto :failed

echo.
echo [4/4] Restart panel server
call "%~dp0scripts\pm2-ensure-panel.bat" restart
if errorlevel 1 goto :failed

echo.
echo === Update complete. Panel will refresh on the next WebSocket reconnect. ===
echo     If anything looks wrong: pm2 logs play-gloucester-room-one-panel
pause
exit /b 0

:failed
echo.
echo *** Update FAILED. Check the output above, fix, and re-run update.bat. ***
echo     On a new PC, run setup.bat as Administrator first.
pause
exit /b 1
