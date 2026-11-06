@echo off
REM Desliga o servidor do app que esta rodando em segundo plano.
cd /d "%~dp0"
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host '  Servidor desligado.' } else { Write-Host '  O servidor nao estava ligado.' }"
timeout /t 3 >nul
