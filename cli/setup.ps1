# ============================================================
#  Vague - Windows setup
#  Right-click -> "Run with PowerShell", or:
#     powershell -ExecutionPolicy Bypass -File setup.ps1
# ============================================================
$ErrorActionPreference = "Continue"
function Ok($m){ Write-Host "  [ok]   $m" -ForegroundColor Green }
function Bad($m){ Write-Host "  [--]   $m" -ForegroundColor Red }
function Warn($m){ Write-Host "  [!]    $m" -ForegroundColor Yellow }
function Step($m){ Write-Host "`n$m" -ForegroundColor White; Write-Host ("-"*54) }

Write-Host "`nVague - Windows setup" -ForegroundColor White
Set-Location $PSScriptRoot

Step "1. winget"
if (Get-Command winget -ErrorAction SilentlyContinue) { Ok "winget found" }
else { Bad "winget missing - install 'App Installer' from the Microsoft Store"; }

Step "2. Node.js"
if (Get-Command node -ErrorAction SilentlyContinue) { Ok "node $(node --version)" }
else {
  Warn "not installed"
  if ((Read-Host "Install Node.js now? (y/N)") -eq 'y') { winget install -e --id OpenJS.NodeJS.LTS }
}

Step "3. ffmpeg"
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Ok "ffmpeg found" }
else {
  Warn "not installed"
  if ((Read-Host "Install ffmpeg (full build) now? (y/N)") -eq 'y') {
    winget install -e --id Gyan.FFmpeg
    Warn "Close this window and open a NEW terminal so PATH refreshes."
  }
}

Step "4. dovi_tool  (needed for Dolby Vision)"
if (Get-Command dovi_tool -ErrorAction SilentlyContinue) { Ok "dovi_tool found" }
else {
  Warn "not installed"
  if ((Read-Host "Download dovi_tool to this folder? (y/N)") -eq 'y') {
    try {
      $rel = Invoke-RestMethod "https://api.github.com/repos/quietvoid/dovi_tool/releases/latest"
      $url = ($rel.assets | Where-Object { $_.name -like "*x86_64-pc-windows-msvc.zip" } |
              Select-Object -First 1).browser_download_url
      if (-not $url) { throw "no Windows asset found" }
      Write-Host "  $url"
      Invoke-WebRequest $url -OutFile "$env:TEMP\dovi.zip"
      Expand-Archive "$env:TEMP\dovi.zip" -DestinationPath $PSScriptRoot -Force
      Remove-Item "$env:TEMP\dovi.zip"
      if (Test-Path "$PSScriptRoot\dovi_tool.exe") { Ok "dovi_tool.exe placed next to the scripts" }
    } catch { Bad "download failed: $_" }
  }
}

Step "5. MP4Box  (GPAC - fixes B-frame timing after transcode)"
if (Get-Command MP4Box -ErrorAction SilentlyContinue) { Ok "MP4Box found" }
else {
  Warn "not installed (only needed for the full transcode path)"
  if ((Read-Host "Install GPAC now? (y/N)") -eq 'y') { winget install -e --id GPAC.GPAC }
}

Step "6. Verify"
if (Get-Command node -ErrorAction SilentlyContinue) { node "$PSScriptRoot\doctor.js" }
else { Bad "node missing - cannot run Doctor" }

Write-Host "`nWhen Doctor is green:" -ForegroundColor White
Write-Host "   Vague.bat          - desktop app (opens in your browser)"
Write-Host "   drag a video onto  vague.bat / remux-only.bat"
Write-Host ""
