@echo off
setlocal EnableExtensions
title Chanakya AI - translator service
rem Manual start. The application normally starts the translator by itself; use this to see its messages
rem when translation says "unavailable". Keep this window open while you use the app, close it to stop.
set "PD=%~dp0"
if "%PD:~-1%"=="\" set "PD=%PD:~0,-1%"
set "PYTHONNOUSERSITE=1"
set "HF_HUB_OFFLINE=1"
set "TRANSFORMERS_OFFLINE=1"
set "INDICTRANS_MODEL_PATH=%PD%\models"
cd /d "%PD%" || exit /b 1
if not exist "%PD%\python\python.exe" goto :nopython
echo Starting the translator on http://127.0.0.1:8100 - models take 10-30 seconds to load.
"%PD%\python\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8100
pause
exit /b 0
:nopython
echo [X] python\python.exe is missing next to this file. Copy the WHOLE translator folder.
pause
exit /b 1
