@echo off
setlocal EnableExtensions
title Chanakya AI - install translator
rem Copies this translator folder next to Chanakya AI.exe, where the application looks for it.
rem Usage:  Install-Translator.cmd                          looks in "%ProgramFiles%\Chanakya AI"
rem         Install-Translator.cmd "D:\Apps\Chanakya AI"    any folder that contains Chanakya AI.exe
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
set "TARGET=%~1"
if not defined TARGET if exist "%ProgramFiles%\Chanakya AI\Chanakya AI.exe" set "TARGET=%ProgramFiles%\Chanakya AI"
if not defined TARGET set /p "TARGET=Folder that contains Chanakya AI.exe: "
if not defined TARGET goto :nofolder
if not exist "%TARGET%\Chanakya AI.exe" goto :nofolder
if /I "%TARGET%\translator"=="%SRC%" goto :already
if exist "%TARGET%\translator" goto :exists
echo Copying to %TARGET%\translator
echo About 4-5 GB: this can take several minutes.
robocopy "%SRC%" "%TARGET%\translator" /E /NFL /NDL /NP /R:1 /W:1 /XF Install-Translator.cmd
if errorlevel 8 goto :copyfailed
:done
echo.
echo DONE. Close Chanakya AI completely and open it again; it starts the translator by itself.
echo To check it on this PC run Verify-Translator.cmd inside the translator folder next to Chanakya AI.exe.
pause
exit /b 0
:already
echo The translator folder is already next to Chanakya AI.exe.
goto :done
:exists
echo [X] A translator folder already exists next to Chanakya AI.exe. Delete or rename it yourself first. Nothing was changed.
goto :fail
:nofolder
echo [X] Chanakya AI.exe was not found. Give the folder that contains it, for example:
echo     Install-Translator.cmd "C:\Program Files\Chanakya AI"
goto :fail
:copyfailed
echo [X] Copy failed. If the message above says Access is denied, right-click this file and choose Run as administrator.
:fail
pause
exit /b 1
