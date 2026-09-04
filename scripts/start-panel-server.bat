@echo off
REM Start play-gloucester-room-one-panel server. Use: start-panel-server.bat [setup|logon]
REM   setup  - PM2 restart/register (during install)
REM   logon  - fresh PM2 start at boot + verify URL + node fallback

setlocal EnableExtensions EnableDelayedExpansion
set "MODE=%~1"
if "%MODE%"=="" set "MODE=logon"
set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "LOGDIR=%ROOT%\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\panel-server.log"

echo.>>"%LOG%"
echo ==================================================>>"%LOG%"
echo [%date% %time%] start-panel-server mode=%MODE%>>"%LOG%"

set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%PATH%"

set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do set "NODE_EXE=%%N" & goto :have_node
:have_node
if not defined NODE_EXE (
  echo ERROR: node.exe not on PATH>>"%LOG%"
  exit /b 1
)

set "PM2=%APPDATA%\npm\pm2.cmd"
if not exist "%PM2%" set "PM2=pm2"

if not exist "%ROOT%\node_modules\" (
  echo ERROR: run npm install in %ROOT%>>"%LOG%"
  exit /b 1
)
if not exist "%ROOT%\ecosystem.config.cjs" (
  echo ERROR: ecosystem.config.cjs missing>>"%LOG%"
  exit /b 1
)

echo NODE=%NODE_EXE%>>"%LOG%"
echo PM2=%PM2%>>"%LOG%"

if /i "%MODE%"=="setup" (
  call "%~dp0pm2-ensure-panel.bat" restart >>"%LOG%" 2>&1
  call :wait_for_server
  if !errorlevel! equ 0 exit /b 0
  echo setup: PM2 up but no HTTP response, trying node fallback>>"%LOG%"
  goto :node_fallback
)

REM --- logon: PM2 resurrect is unreliable on Windows; always cold-start ---
call "%PM2%" ping >>"%LOG%" 2>&1
call "%PM2%" delete play-gloucester-room-one-panel >>"%LOG%" 2>&1
call "%PM2%" start "%ROOT%\ecosystem.config.cjs" >>"%LOG%" 2>&1
set "PM2_ERR=!errorlevel!"
call "%PM2%" save >>"%LOG%" 2>&1

if !PM2_ERR! neq 0 (
  echo pm2 start failed - will try node fallback>>"%LOG%"
  goto :node_fallback
)

call :wait_for_server
if !errorlevel! equ 0 (
  echo Server OK via PM2>>"%LOG%"
  exit /b 0
)

echo PM2 started but server not responding>>"%LOG%"

:node_fallback
echo Starting node server.js directly...>>"%LOG%"
start "play-gloucester-room-one-panel-direct" /MIN "%NODE_EXE%" "%ROOT%\server.js" >>"%LOGDIR%\node-direct.log" 2>&1

call :wait_for_server
if !errorlevel! equ 0 (
  echo Server OK via direct node>>"%LOG%"
  exit /b 0
)

echo ERROR: server did not respond on port 3000>>"%LOG%"
exit /b 1

:wait_for_server
set "TRIES=0"
:wait_loop
curl -sf -o nul http://127.0.0.1:3000/ 2>nul
if !errorlevel! equ 0 exit /b 0
set /a TRIES+=1
if !TRIES! geq 45 exit /b 1
timeout /t 2 /nobreak >nul
goto :wait_loop
