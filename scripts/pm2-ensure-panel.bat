@echo off
REM Ensures play-gloucester-room-one-panel is registered and running under PM2.
REM Usage: pm2-ensure-panel.bat [restart]

setlocal EnableExtensions
set "MODE=%~1"
set "ROOT=%~dp0.."
cd /d "%ROOT%"

REM Ensure node + global npm tools are on PATH (common issue right after install).
if exist "%ProgramFiles%\nodejs\" set "PATH=%ProgramFiles%\nodejs\;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\" set "PATH=%ProgramFiles(x86)%\nodejs\;%PATH%"
if exist "%APPDATA%\npm\" set "PATH=%APPDATA%\npm\;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node not found on PATH. Install Node.js LTS and re-run setup.bat.
  exit /b 1
)

set "PM2="
where pm2 >nul 2>&1
if %errorlevel%==0 (
  for /f "delims=" %%I in ('where pm2 2^>nul') do (
    set "PM2=%%I"
    goto :found_pm2
  )
)
if exist "%APPDATA%\npm\pm2.cmd" set "PM2=%APPDATA%\npm\pm2.cmd"

:found_pm2
if not defined PM2 (
  echo ERROR: pm2 not found. Run: npm install -g pm2
  exit /b 1
)

if not exist "%ROOT%\node_modules\" (
  echo ERROR: node_modules missing. Run: npm install
  exit /b 1
)

if not exist "%ROOT%\ecosystem.config.cjs" (
  echo ERROR: ecosystem.config.cjs not found in %ROOT%
  exit /b 1
)

echo Using PM2: %PM2%
echo Project:  %ROOT%

call "%PM2%" resurrect 2>nul

call "%PM2%" describe play-gloucester-room-one-panel >nul 2>&1
if errorlevel 1 goto :cold_start

if /i "%MODE%"=="restart" (
  call "%PM2%" restart play-gloucester-room-one-panel
  if errorlevel 1 goto :cold_start
  goto :save_ok
)

for /f %%P in ('call "%PM2%" pid play-gloucester-room-one-panel 2^>nul') do (
  if not "%%P"=="" goto :save_ok
)

call "%PM2%" restart play-gloucester-room-one-panel
if errorlevel 1 goto :cold_start
goto :save_ok

:cold_start
call "%PM2%" delete play-gloucester-room-one-panel 2>nul
echo Starting play-gloucester-room-one-panel...
call "%PM2%" start "%ROOT%\ecosystem.config.cjs"
if errorlevel 1 (
  echo.
  echo ERROR: pm2 start failed.
  echo.
  echo Try manually in this folder:
  echo   cd /d "%ROOT%"
  echo   pm2 start ecosystem.config.cjs
  echo   pm2 logs play-gloucester-room-one-panel
  echo.
  exit /b 1
)

:save_ok
call "%PM2%" save 2>nul
call "%PM2%" status
exit /b 0
