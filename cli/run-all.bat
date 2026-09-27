@echo off
REM Runs the unit test suites on Windows.
cd /d "%~dp0\.."
echo.
echo   UNIT
for %%T in ("core\test.js" "test\probe-test.mjs" "test\remux-test.mjs" ^
            "test\bypass-test.mjs" "test\rebrand-test.mjs" "test\stripdv-test.mjs") do (
  echo   --- %%~T
  node %%~T | findstr /C:"passed"
)
echo.
pause
