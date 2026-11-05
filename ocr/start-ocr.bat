@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0python\python.exe" (
  echo ocr\python not found. Run install-ocr.bat first.
  pause
  exit /b 1
)
"%~dp0python\python.exe" "%~dp0server.py"
pause
