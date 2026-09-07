@echo off
REM Runs the project-local PM2 using either installed Node or the bundled runtime.
setlocal
set "ROOT=%~dp0.."
if exist "%ROOT%\vendor\node-win-x64\node.exe" set "PATH=%ROOT%\vendor\node-win-x64;%PATH%"
node "%ROOT%\node_modules\pm2\bin\pm2" %*
exit /b %errorlevel%
