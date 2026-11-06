@echo off
title Consulta de Romaneio - criar atalho
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   O Node.js nao esta instalado neste computador.
  echo   Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist ".env" copy ".env.exemplo" ".env" >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-atalho.ps1"
if errorlevel 1 (
  echo   Nao consegui criar o atalho.
  pause
  exit /b 1
)
echo   Abrindo o app...
wscript.exe "%~dp0abrir-app.vbs"
timeout /t 3 >nul
