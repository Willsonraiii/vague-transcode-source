@echo off
REM ============================================================
REM  Vague — drag a video onto this file to optimise it
REM ============================================================
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo   Drag a video file onto this .bat, or run:
  echo     vague.bat "C:\path\to\video.mp4"
  echo.
  echo   Options: edit the line below to add --patch, --keep-4k, --sdr
  echo.
  pause
  exit /b
)

echo.
node "%~dp0vague.js" "%~1" --platform tiktok
echo.
pause
