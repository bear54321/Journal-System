@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0python\python.exe" (
  echo ocr\python already exists. Delete the python folder first if you want to reinstall.
  pause
  exit /b 0
)
echo Downloading portable Python 3.11 (about 11 MB) ...
powershell -NoProfile -Command "Invoke-WebRequest https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip -OutFile py.zip; Expand-Archive py.zip -DestinationPath python -Force; Remove-Item py.zip"
powershell -NoProfile -Command "(Get-Content python\python311._pth) -replace '^#import site','import site' | Set-Content python\python311._pth"
echo Downloading pip ...
powershell -NoProfile -Command "Invoke-WebRequest https://bootstrap.pypa.io/get-pip.py -OutFile get-pip.py"
python\python.exe get-pip.py --no-warn-script-location
del get-pip.py
echo Installing OCR packages (about 300 MB) ...
python\python.exe -m pip install --no-warn-script-location rapidocr onnxruntime opencv-python-headless
echo Downloading OCR models (first run) ...
python\python.exe -c "from rapidocr import RapidOCR; RapidOCR()"
echo Done. Start the system with start.bat
pause
