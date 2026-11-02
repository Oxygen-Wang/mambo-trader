@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\@resvg\resvg-js" call npm.cmd ci --ignore-scripts
if errorlevel 1 goto end
node server.mjs
:end
pause
