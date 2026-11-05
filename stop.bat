@echo off
rem Stop the PHP server on port 8080 (use this if start.bat says the port is in use)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do taskkill /F /PID %%p
rem Also stop the local OCR service on port 8765
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING"') do taskkill /F /PID %%p
echo Done.
pause
