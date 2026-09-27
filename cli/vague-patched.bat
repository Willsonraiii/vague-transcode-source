@echo off
REM  Optimise + duration patch.
REM  WARNING: the patch has been observed to BREAK TikTok uploads
REM  (00:00 shown, file refused). If that happens, use vague.bat instead.
setlocal
cd /d "%~dp0"
if "%~1"=="" ( echo Drag a video onto this file. & pause & exit /b )
echo.
node "%~dp0vague.js" "%~1" --platform tiktok --patch
echo.
pause
