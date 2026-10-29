@echo off
cd /d "%~dp0"
if "%PRINT_AGENT_ORIGINS%"=="" set PRINT_AGENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
node agent.mjs
