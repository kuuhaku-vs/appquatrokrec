# Cria o atalho "Consulta de Romaneio" na area de trabalho e no menu Iniciar.
$pasta = $PSScriptRoot
$sh = New-Object -ComObject WScript.Shell
$destinos = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($destino in $destinos) {
  $lnk = $sh.CreateShortcut((Join-Path $destino 'Consulta de Romaneio.lnk'))
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments = '"' + (Join-Path $pasta 'abrir-app.vbs') + '"'
  $lnk.WorkingDirectory = $pasta
  $lnk.IconLocation = (Join-Path $pasta 'public\icone.ico') + ',0'
  $lnk.Description = 'Consulta de Romaneio'
  $lnk.Save()
}
Write-Host ''
Write-Host '  Atalho "Consulta de Romaneio" criado na area de trabalho e no menu Iniciar.'
Write-Host ''
