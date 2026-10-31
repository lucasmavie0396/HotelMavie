@echo off
setlocal
set "LOGS=%~1"
set "NODE=%~2"
set "ENVFILE=%~3"
if "%LOGS%"=="" set "LOGS=%~dp0..\..\dados\logs"
if "%NODE%"=="" set "NODE=node"
if not exist "%LOGS%" mkdir "%LOGS%"
set "ENVARG="
if not "%ENVFILE%"=="" set ENVARG=--env-file="%ENVFILE%"
cd /d "%~dp0..\..\backend"
set "MAIN=%CD%\dist\main.js"

:inicio
if exist "%LOGS%\api.log" for %%F in ("%LOGS%\api.log") do if %%~zF GTR 10485760 move /y "%LOGS%\api.log" "%LOGS%\api.anterior.log" >nul
echo [%date% %time%] a arrancar >> "%LOGS%\api.log"
"%NODE%" %ENVARG% "%MAIN%" >> "%LOGS%\api.log" 2>&1
echo [%date% %time%] parou com codigo %errorlevel%, reinicia dentro de 10 segundos >> "%LOGS%\api.log"
ping -n 11 127.0.0.1 >nul
goto inicio
