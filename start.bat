@echo off
cd /d "%~dp0"

set "PHP="
set "OPTS="
if exist "%~dp0php\php.exe" (
  set "PHP=%~dp0php\php.exe"
  set OPTS=-c "%~dp0php\php.ini" -d extension_dir="%~dp0php\ext" -d curl.cainfo="%~dp0php\cacert.pem" -d openssl.cafile="%~dp0php\cacert.pem"
)
if not defined PHP (
  where php >nul 2>nul
  if not errorlevel 1 set "PHP=php"
)
if not defined PHP (
  if exist "C:\xampp\php\php.exe" set "PHP=C:\xampp\php\php.exe"
)
if not defined PHP (
  echo PHP not found.
  echo Put a portable PHP in the "php" folder next to this file, or install PHP / XAMPP.
  pause
  exit /b 1
)

echo Journal system: http://localhost:8080/index.php
echo Close this window to stop the server.
start "" http://localhost:8080/index.php
"%PHP%" %OPTS% -S localhost:8080 -t "%~dp0"
pause
