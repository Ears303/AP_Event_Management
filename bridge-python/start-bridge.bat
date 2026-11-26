@echo off
title AP Timing live bridge
cd /d "%~dp0"

rem Find Python: the "py" launcher first, then "python".
set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" where python >nul 2>nul && set PY=python
if "%PY%"=="" (
  echo Python is not installed on this PC.
  echo Install it from https://www.python.org/downloads/ - tick "Add python.exe to PATH" - then run this again.
  pause
  exit /b 1
)

:run
echo Starting the AP Timing live bridge. Leave this window open all day. Close it or press Ctrl+C to stop.
echo.
%PY% live_bridge.py
echo.
echo The bridge stopped. If this was not on purpose, read the message above.
choice /c RQ /m "Press R to restart or Q to quit"
if errorlevel 2 exit /b 0
goto run
