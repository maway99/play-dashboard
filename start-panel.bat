@echo off
REM Play Gloucester Room One Panel — start everything.
REM Launches grandMA2 onPC and Companion, starts the panel server, then opens Chrome kiosk.
REM Called by Task Scheduler at logon, or run manually to restart everything.

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "ROOT=%CD%"

set "LOGDIR=%ROOT%\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\startup.log"

echo.>>"%LOG%"
echo ==================================================>>="%LOG%"
echo [%date% %time%] start-panel>>"%LOG%"

REM -----------------------------------------------------------------------
REM 1. Launch grandMA2 onPC (if not already running)
REM -----------------------------------------------------------------------
REM Search for gma2onpc.exe under the versioned install folder (e.g. "grandMA2 onPC 3.9.61.5").
set "GMA2="
for /d %%D in ("%ProgramFiles%\MA Lighting Technologies\grandma\grandMA2 onPC*") do (
    if exist "%%D\gma2onpc.exe" set "GMA2=%%D\gma2onpc.exe"
)
if not defined GMA2 (
    for /d %%D in ("%ProgramFiles(x86)%\MA Lighting Technologies\grandma\grandMA2 onPC*") do (
        if exist "%%D\gma2onpc.exe" set "GMA2=%%D\gma2onpc.exe"
    )
)

echo [1/4] grandMA2 onPC...
if not defined GMA2 (
    echo       Not found under Program Files - skipping
    echo [1/4] gma2onpc not found - skipping>>"%LOG%"
    goto :start_companion
)

tasklist /FI "IMAGENAME eq gma2onpc.exe" 2>nul | find /I "gma2onpc.exe" >nul 2>&1
if not errorlevel 1 (
    echo       Already running
    echo [1/4] gma2onpc already running>>"%LOG%"
    goto :start_companion
)

echo       Launching...
echo [1/4] Launching gma2onpc>>"%LOG%"
start "" "%GMA2%"

REM Dismiss the fader wing popup in a parallel minimised window.
REM It waits ~15s for the popup then sends Enter — runs alongside server start.
start "Play Gloucester Room One - Dismiss Popup" /MIN powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\dismiss-gma2-popup.ps1"

:start_companion
REM -----------------------------------------------------------------------
REM 2. Launch Bitfocus Companion (if it is not already serving port 8000)
REM -----------------------------------------------------------------------
echo [2/4] Bitfocus Companion...
echo [2/4] Starting/checking Companion>>"%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start-companion.ps1" >>"%LOG%" 2>&1
if errorlevel 1 (
    echo       WARNING: Companion did not start - Stream Deck controls will reconnect when it is opened
    echo [2/4] WARNING: Companion unavailable>>"%LOG%"
) else (
    echo       Ready on localhost:8000
)

:start_server
REM -----------------------------------------------------------------------
REM 3. Start panel server via PM2 (with direct-node fallback)
REM -----------------------------------------------------------------------
echo [3/4] Starting panel server...
echo [3/4] Starting panel server>>"%LOG%"

set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"
call "%ROOT%\scripts\start-panel-server.bat" logon >>"%LOG%" 2>&1
if errorlevel 1 (
    echo       Server failed to start - check logs\startup.log
    pause
    exit /b 1
)

REM -----------------------------------------------------------------------
REM 4. Launch Chrome in kiosk mode
REM -----------------------------------------------------------------------
echo [4/4] Launching Chrome kiosk...
echo [4/4] Launching Chrome kiosk>>"%LOG%"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
    echo       ERROR: Google Chrome not found. Install it first.
    echo [4/4] ERROR: Chrome not found>>"%LOG%"
    pause
    exit /b 1
)

if exist "%ROOT%\scripts\close-play-gloucester-room-one-chrome.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\close-play-gloucester-room-one-chrome.ps1" >>"%LOG%" 2>&1
)

echo       Opening http://127.0.0.1:3000
start "" "%CHROME%" ^
  --kiosk ^
  --app=http://127.0.0.1:3000/ ^
  --disable-infobars ^
  --noerrdialogs ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-session-crashed-bubble ^
  --disable-restore-session-state ^
  --disable-features=TranslateUI,MediaRouter ^
  --disable-pinch ^
  --overscroll-history-navigation=0 ^
  --user-data-dir="%LOCALAPPDATA%\Play Gloucester Room One Panel Chrome"

echo [4/4] Kiosk started>>"%LOG%"
echo Done.
exit /b 0
