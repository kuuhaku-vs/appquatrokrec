@echo off
chcp 65001 >nul
title Consulta de Romaneio (servidor)
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

if not exist ".env" (
  copy ".env.exemplo" ".env" >nul
  echo.
  echo   Criei o arquivo .env. Preencha PROTHEUS_URL com o endereco da genericQuery.
  echo.
  notepad ".env"
)

start "" http://localhost:3000
node server.js
pause
