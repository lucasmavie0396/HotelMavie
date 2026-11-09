@echo off
set "PS=powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
start "" "%PS%" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0novo-hotel.ps1"
