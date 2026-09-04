@echo off
REM Play Gloucester Room One Panel — full installer (no setup.ps1 required).
REM Right-click this file -> Run as administrator

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

set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"

where node >nul 2>&1 || (echo ERROR: Node.js not found. Install Node.js LTS. & pause & exit /b 1)
where npm >nul 2>&1 || (echo ERROR: npm not found. Reinstall Node.js. & pause & exit /b 1)

if not exist "%ROOT%\config.json" (
  echo ERROR: config.json not found in %ROOT%
  pause
  exit /b 1
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo ERROR: Google Chrome not found. Install Chrome first.
  pause
  exit /b 1
)
echo     Chrome: %CHROME%

echo.
echo [1/7] npm install ^(server^)
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [2/7] npm install ^(client^)
call npm --prefix client install --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [3/7] npm run build ^(client^)
call npm --prefix client run build
if errorlevel 1 goto :fail
if not exist "%ROOT%\client\dist\index.html" (
  echo ERROR: client\dist\index.html missing after build.
  goto :fail
)

where pm2 >nul 2>&1
if errorlevel 1 (
  echo.
  echo [4/7] npm install -g pm2
  call npm install -g pm2
  if errorlevel 1 goto :fail
  set "PATH=%APPDATA%\npm;%PATH%"
) else (
  echo.
  echo [4/7] pm2 already installed
)

if not exist "%ROOT%\scripts\pm2-ensure-panel.bat" (
  echo ERROR: Missing scripts\pm2-ensure-panel.bat — incomplete project folder.
  echo Run:  cd /d %ROOT%
  echo        git pull
  goto :fail
)

echo.
echo [5/7] Start panel server
call "%ROOT%\scripts\start-panel-server.bat" setup
if errorlevel 1 (
  echo.
  echo Server failed to start. Check: logs\panel-server.log
  echo   pm2 logs play-gloucester-room-one-panel
  goto :fail
)

if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"

echo.
echo [6/7] Register Task Scheduler ^(schtasks^)

set "RUNAS=%USERNAME%"
if /i not "%USERDOMAIN%"=="%COMPUTERNAME%" set "RUNAS=%USERDOMAIN%\%USERNAME%"

schtasks /Delete /TN "Play Gloucester Room One Edge Kiosk" /F >nul 2>&1

call :RegisterTask "Play Gloucester Room One PM2 Resurrect" "%ROOT%\startup-pm2.bat"
if errorlevel 1 goto :fail
call :RegisterTask "Play Gloucester Room One Chrome Kiosk" "%ROOT%\startup-chrome.bat"
if errorlevel 1 goto :fail

call :InstallStartupShortcut "Play-Gloucester-Room-One-Panel-PM2.bat" "%ROOT%\startup-pm2.bat"
call :InstallStartupShortcut "Play-Gloucester-Room-One-Panel-Kiosk.bat" "%ROOT%\startup-chrome.bat"

echo.
echo [7/7] Kiosk power / display settings
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f >nul 2>&1
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveTimeOut /t REG_SZ /d 0 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" /v ToastEnabled /t REG_DWORD /d 0 /f >nul 2>&1

echo.
echo Checking http://127.0.0.1:3000/ ...
set "TRIES=0"
:wait_server
curl -sf -o nul http://127.0.0.1:3000/ 2>nul && goto :server_ok
set /a TRIES+=1
if %TRIES% lss 15 (
  timeout /t 2 /nobreak >nul
  goto :wait_server
)
echo WARNING: Server not responding yet. Check: pm2 logs play-gloucester-room-one-panel
goto :done

:server_ok
echo     Server OK at http://127.0.0.1:3000

:done
echo.
echo === Setup complete ===
echo     pm2 status
echo     pm2 logs play-gloucester-room-one-panel
echo     Logs: %ROOT%\logs
echo     troubleshoot-startup.bat  ^(if kiosk does not open at logon^)
echo.
echo Opening Chrome kiosk now...
call "%ROOT%\startup-chrome.bat"
echo.
echo After reboot, kiosk also starts via Startup folder + Task Scheduler.
pause
exit /b 0

:RegisterTask
schtasks /Delete /TN %~1 /F >nul 2>&1
schtasks /Create /TN %~1 /TR "%~2" /SC ONLOGON /RU %RUNAS% /RL LIMITED /F
if errorlevel 1 (
  echo ERROR: schtasks failed for %~1
  exit /b 1
)
echo     Task Scheduler: %~1
exit /b 0

:InstallStartupShortcut
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\%~1"
(
  echo @echo off
  echo call "%~2"
) > "%SHORTCUT%"
echo     Startup folder: %~1
exit /b 0

:fail
echo.
echo === Setup FAILED ===
echo If files are missing, run from the full project folder:
echo   git clone https://github.com/maway99/play-gloucester-room-one-panel.git
echo   cd play-gloucester-room-one-panel
echo   setup.bat
pause
exit /b 1
