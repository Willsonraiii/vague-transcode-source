@echo off
REM  Lossless container fix - no re-encode, nothing decoded.
REM  moov to front, QuickTime rebrand, edit lists neutralised.
setlocal
cd /d "%~dp0"
if "%~1"=="" ( echo Drag a video onto this file. & pause & exit /b )
echo.
node "%~dp0vague.js" "%~1" --remux-only
echo.
pause
