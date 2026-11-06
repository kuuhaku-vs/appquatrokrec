' Consulta de Romaneio - abre o app
' Liga o servidor em segundo plano (se ainda não estiver ligado) e abre o site
' numa janela própria do Edge ou do Chrome, como um aplicativo.
Option Explicit
Dim sh, fso, pasta, porta, url, f, l, i, nav, caminhos, c
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta

' Porta do .env (padrão 3000)
porta = "3000"
If fso.FileExists(pasta & "\.env") Then
  Set f = fso.OpenTextFile(pasta & "\.env", 1)
  Do Until f.AtEndOfStream
    l = Trim(f.ReadLine)
    If LCase(Left(l, 5)) = "port=" And Len(Trim(Mid(l, 6))) > 0 Then porta = Trim(Mid(l, 6))
  Loop
  f.Close
End If
url = "http://localhost:" & porta & "/"

Function Rodando()
  Dim x
  Rodando = False
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 1000, 1000, 1000, 1500
  x.open "GET", url & "api/status", False
  x.send
  If Err.Number = 0 Then Rodando = (x.status = 200)
  Err.Clear
  On Error GoTo 0
End Function

If Not Rodando() Then
  If Not fso.FileExists(pasta & "\.env") And fso.FileExists(pasta & "\.env.exemplo") Then
    fso.CopyFile pasta & "\.env.exemplo", pasta & "\.env"
  End If
  sh.Run "cmd /c node server.js >> servidor.log 2>&1", 0, False
  For i = 1 To 60
    WScript.Sleep 250
    If Rodando() Then Exit For
  Next
  If Not Rodando() Then
    MsgBox "Não consegui ligar o servidor do app." & vbCrLf & vbCrLf & _
      "Confira se o Node.js está instalado (https://nodejs.org) e veja o arquivo servidor.log na pasta:" & vbCrLf & pasta, _
      16, "Consulta de Romaneio"
    WScript.Quit 1
  End If
End If

' Abre como app (janela própria, sem barra de endereço)
caminhos = Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
  sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe")
nav = ""
For Each c In caminhos
  If nav = "" And fso.FileExists(c) Then nav = c
Next
If nav <> "" Then
  sh.Run """" & nav & """ --app=" & url, 1, False
Else
  sh.Run url, 1, False
End If
