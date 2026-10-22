@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="--min" goto run
title SINYAL

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js bulunamadi.
  echo      https://nodejs.org adresinden LTS surumunu kurun, sonra bu dosyayi tekrar calistirin.
  echo.
  pause
  exit /b 1
)

rem Sunucu zaten calisiyorsa yalnizca uygulama penceresini ac.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4400/api/settings | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  start "" msedge --app=http://localhost:4400 --window-size=1440,920
  exit /b 0
)

rem AI brifing icin gereken paket (tek seferlik). Kurulamazsa panel yine calisir.
if not exist "node_modules\@anthropic-ai\sdk" (
  echo  AI brifing paketi kuruluyor ^(tek seferlik^)...
  call npm install --omit=dev --no-fund --no-audit
)

rem Sunucu kucultulmus bir pencerede calisir. Uygulama penceresini kapatinca ya da
rem uygulamadaki Kapat dugmesine basinca kendiliginden durur; o pencere de kapanir.
start "SINYAL sunucu" /min cmd /c ""%~f0" --min"
exit /b 0

:run
title SINYAL sunucu
node server.js --open
if errorlevel 1 (
  echo.
  echo  [!] Sunucu bir hatayla durdu.
  pause
)
