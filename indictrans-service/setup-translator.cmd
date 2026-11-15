@echo off
setlocal EnableExtensions
title Chanakya AI - translator (IndicTrans2) setup

set "SD=%~dp0"
if "%SD:~-1%"=="\" set "SD=%SD:~0,-1%"
cd /d "%SD%" || goto :fail

echo.
echo ============================================================
echo  Chanakya AI - translator setup
echo  Folder: %SD%
echo ============================================================
echo.

if not exist "%SD%\models\en-indic" goto :nomodels
if not exist "%SD%\app\main.py" goto :noapp

rem ---- 1. find Python (3.12 was used for testing; 3.10 / 3.11 also fine)
set "PY="
py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
if not defined PY py -3.11 --version >nul 2>&1 && set "PY=py -3.11"
if not defined PY py -3.10 --version >nul 2>&1 && set "PY=py -3.10"
if not defined PY python --version >nul 2>&1 && set "PY=python"
if not defined PY goto :nopython
echo [1/5] Python found: %PY%
%PY% --version

rem ---- 2. virtual environment (a .venv copied from another PC never works, so it is rebuilt)
if exist "%SD%\.venv\Scripts\python.exe" "%SD%\.venv\Scripts\python.exe" -c "import sys" >nul 2>&1 || rmdir /s /q "%SD%\.venv"
if not exist "%SD%\.venv\Scripts\python.exe" %PY% -m venv "%SD%\.venv" || goto :fail
echo [2/5] Virtual environment ready.

rem ---- 3. packages (uses the 'wheels' folder next to this file when it exists = no internet needed)
"%SD%\.venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1
if exist "%SD%\wheels" goto :offline
echo [3/5] Installing packages from the internet (torch is large, please wait)...
"%SD%\.venv\Scripts\python.exe" -m pip install -r "%SD%\requirements.txt" || goto :fail
goto :verify
:offline
echo [3/5] Installing packages from the local wheels folder (offline)...
"%SD%\.venv\Scripts\python.exe" -m pip install --no-index --find-links "%SD%\wheels" -r "%SD%\requirements.txt" || goto :fail

:verify
"%SD%\.venv\Scripts\python.exe" -c "import torch, transformers, IndicTransToolkit, fastapi, uvicorn; print('imports OK')" || goto :fail

rem ---- 4. .env with the model path of THIS PC
set "MP=%SD%\models"
set "MP=%MP:\=/%"
> "%SD%\.env" echo INDICTRANS_HOST=127.0.0.1
>> "%SD%\.env" echo INDICTRANS_PORT=8100
>> "%SD%\.env" echo INDICTRANS_MODEL_PATH=%MP%
>> "%SD%\.env" echo TRANSLATION_DEVICE=auto
>> "%SD%\.env" echo INDICTRANS_MAX_CHARS=5000
echo [4/5] .env written (models: %MP%)

rem ---- 5. tell the installed app where this folder is
setx INDICTRANS_SERVICE_DIR "%SD%" >nul
echo [5/5] INDICTRANS_SERVICE_DIR set to %SD%

echo.
echo ============================================================
echo  DONE.
echo  Close Chanakya AI completely and open it again. The app starts the
echo  translator by itself (first load takes about 10-30 seconds).
echo  If it still says "unreachable", restart Windows once, then open the app.
echo  Check:  curl http://127.0.0.1:8100/health   (status should be ok)
echo ============================================================
pause
exit /b 0

:nomodels
echo [X] The models folder is missing: %SD%\models
echo     Copy the WHOLE indictrans-service folder (with models\en-indic, indic-en, indic-indic).
goto :fail
:noapp
echo [X] app\main.py is missing in %SD%
echo     Copy the WHOLE indictrans-service folder from the other PC.
goto :fail
:nopython
echo [X] Python was not found. Install Python 3.12 (64-bit) from python.org,
echo     tick "Add python.exe to PATH", then run this file again.
goto :fail
:fail
echo.
echo [X] Setup stopped. Scroll up for the first error.
pause
exit /b 1
