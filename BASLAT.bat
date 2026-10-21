@echo off
setlocal
cd /d "%~dp0"
title SINYAL - Ses ve Muzik Teknolojisi Radari

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js bulunamadi.
  echo      https://nodejs.org adresinden LTS surumunu kurun, sonra bu dosyayi tekrar calistirin.
  echo.
  pause
  exit /b 1
)

rem Sunucu zaten calisiyorsa yalnizca paneli ac.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4400/api/settings | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo  SINYAL zaten calisiyor, uygulama penceresi aciliyor...
  start "" msedge --app=http://localhost:4400 --window-size=1440,920
  exit /b 0
)

rem AI brifing icin gereken paket (tek seferlik). Kurulamazsa panel yine calisir.
if not exist "node_modules\@anthropic-ai\sdk" (
  echo  AI brifing paketi kuruluyor ^(tek seferlik^)...
  call npm install --omit=dev --no-fund --no-audit
)

echo.
node server.js --open
echo.
echo  Sunucu durdu. Bu pencereyi kapatabilirsiniz.
pause
