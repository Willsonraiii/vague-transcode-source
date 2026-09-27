@echo off
REM  Lossless fix + deliver as plain HDR instead of Dolby Vision.
REM  This is the recommended one for HDR footage going to TikTok.
setlocal
cd /d "%~dp0"
if "%~1"=="" ( echo Drag a video onto this file. & pause & exit /b )
echo.
node "%~dp0vague.js" "%~1" --remux-only --no-dv
echo.
pause
