@echo off
setlocal EnableExtensions
title Chanakya AI - verify translator
set "PD=%~dp0"
if "%PD:~-1%"=="\" set "PD=%PD:~0,-1%"
set "PYTHONNOUSERSITE=1"
if not exist "%PD%\python\python.exe" goto :nopython
echo Checking the translator pack in %PD%
echo Reading about 3.3 GB to verify the models, then loading them: allow 1-3 minutes.
"%PD%\python\python.exe" "%PD%\selftest.py" %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" goto :ok
echo [X] The translator pack did NOT pass. Send the lines above and the log file it names.
pause
exit /b %RC%
:ok
echo Translator pack is OK on this PC.
pause
exit /b 0
:nopython
echo [X] python\python.exe is missing next to this file. Copy the WHOLE translator folder.
pause
exit /b 1
