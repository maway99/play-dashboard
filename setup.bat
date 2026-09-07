@echo off
REM Play Gloucester Room One Panel — first-time installer.
REM Right-click this file -> Run as Administrator.
REM On a new PC, run this once. For updates, use update.bat.

setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"

echo.
echo === Play Gloucester Room One Panel setup ===
echo     Folder: %ROOT%
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo ERROR: Run as Administrator ^(right-click setup.bat^).
    pause
    exit /b 1
)

set "PATH=%ROOT%\vendor\node-win-x64;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"

where node >nul 2>&1 || (echo ERROR: Node.js not found and the offline runtime is missing. & pause & exit /b 1)
where npm  >nul 2>&1 || (echo ERROR: npm not found and the offline runtime is incomplete. & pause & exit /b 1)

if not exist "%ROOT%\config.json" (
    echo ERROR: config.json not found in %ROOT%
    pause
    exit /b 1
)

set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" (
    echo ERROR: Neither Google Chrome nor Microsoft Edge was found.
    pause
    exit /b 1
)
echo     Kiosk browser: %BROWSER%

echo.
echo [1/8] Verify lighting network
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\verify-lighting-network.ps1"
if errorlevel 1 goto :fail

echo.
echo [2/8] npm install ^(server^)
if exist "%ROOT%\node_modules\express\package.json" if exist "%ROOT%\node_modules\ws\package.json" if exist "%ROOT%\node_modules\pm2\package.json" (
    echo     Using bundled production dependencies
) else (
    call npm install --no-audit --no-fund
    if errorlevel 1 goto :fail
)

echo.
echo [3/8] npm install ^(client^)
if exist "%ROOT%\client\dist\index.html" (
    echo     Using bundled production client
) else (
    call npm --prefix client install --no-audit --no-fund
    if errorlevel 1 goto :fail
)

echo.
echo [4/8] Build client
if exist "%ROOT%\client\dist\index.html" (
    echo     Prebuilt client ready
) else (
    call npm --prefix client run build
    if errorlevel 1 goto :fail
)
if not exist "%ROOT%\client\dist\index.html" goto :fail

echo.
echo [5/8] Verify local PM2
if not exist "%ROOT%\node_modules\pm2\bin\pm2" (
    echo ERROR: Local PM2 dependency missing.
    goto :fail
)
call "%ROOT%\scripts\pm2-local.cmd" --version
if errorlevel 1 goto :fail

if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

echo.
echo [6/8] Install Ableton Link bridge
if not exist "%ROOT%\tools\Carabiner.exe" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\get-carabiner.ps1"
    if errorlevel 1 goto :fail
) else (
    echo     Carabiner.exe already installed
)
netsh advfirewall firewall delete rule name="Play Gloucester Ableton Link" >nul 2>&1
netsh advfirewall firewall add rule name="Play Gloucester Ableton Link" dir=in action=allow program="%ROOT%\tools\Carabiner.exe" protocol=UDP localport=20808 profile=any enable=yes >nul
if errorlevel 1 goto :fail

echo.
echo [7/8] Verify Bitfocus Companion
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start-companion.ps1"
if errorlevel 1 goto :fail

echo.
echo [8/8] Register Task Scheduler ^(runs start-panel.bat interactively at logon^)

set "RUNAS=%USERNAME%"
if /i not "%USERDOMAIN%"=="%COMPUTERNAME%" set "RUNAS=%USERDOMAIN%\%USERNAME%"

REM Remove any legacy tasks from older installs.
schtasks /Delete /TN "Trilogy PM2 Resurrect" /F >nul 2>&1
schtasks /Delete /TN "Trilogy Chrome Kiosk"  /F >nul 2>&1
schtasks /Delete /TN "Trilogy Edge Kiosk"    /F >nul 2>&1
schtasks /Delete /TN "Trilogy Panel"         /F >nul 2>&1
schtasks /Delete /TN "Play Gloucester Room One Chrome Kiosk"   /F >nul 2>&1
schtasks /Delete /TN "Play Gloucester Room One PM2 Resurrect" /F >nul 2>&1
schtasks /Delete /TN "Play Gloucester Room One Edge Kiosk"     /F >nul 2>&1
schtasks /Delete /TN "Play Gloucester Room One Panel"          /F >nul 2>&1

schtasks /Create /TN "Play Gloucester Room One Panel" /TR "%ROOT%\start-panel.bat" /SC ONLOGON /RU "%RUNAS%" /RL LIMITED /IT /F
if errorlevel 1 (
    echo ERROR: Could not register Task Scheduler task.
    goto :fail
)
echo     Task Scheduler: Play Gloucester Room One Panel ^(runs at logon for %RUNAS%^)

REM Remove any legacy Startup folder shortcuts.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
del /F /Q "%STARTUP%\Trilogy-Panel-PM2.bat"   >nul 2>&1
del /F /Q "%STARTUP%\Trilogy-Panel-Kiosk.bat" >nul 2>&1
del /F /Q "%STARTUP%\Play-Gloucester-Room-One-Panel-PM2.bat"   >nul 2>&1
del /F /Q "%STARTUP%\Play-Gloucester-Room-One-Panel-Kiosk.bat" >nul 2>&1

REM Kiosk power / display settings.
powercfg /change standby-timeout-ac 0      >nul 2>&1
powercfg /change monitor-timeout-ac 0      >nul 2>&1
powercfg /change hibernate-timeout-ac 0    >nul 2>&1
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f >nul 2>&1
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveTimeOut /t REG_SZ /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" /v ToastEnabled /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\TabletTip\1.7" /v EnableDesktopModeAutoInvoke /t REG_DWORD /d 0 /f >nul 2>&1

echo.
echo === Installation complete - starting live services ===
echo.
echo Starting panel now (grandMA2 onPC + server + Chrome kiosk)...
echo After any reboot, start-panel.bat runs automatically at logon.
echo.
call "%ROOT%\start-panel.bat"
if errorlevel 1 goto :fail

echo.
echo Verifying the live installation ^(up to 2 minutes^)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\verify-install.ps1"
if errorlevel 1 goto :fail

echo.
echo All production checks passed.
pause
exit /b 0

:fail
echo.
echo === Setup FAILED ===
pause
exit /b 1
