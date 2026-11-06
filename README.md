# Consulta de Romaneio

App interno para consultar romaneios no Protheus (TOTVS) e conferir com o packing list.

- Digite o número do romaneio e veja cada **produto** com a **quantidade de rolos** e a
  **quantidade atual em kg** (`Z5_PESOATU`), com os totais. Clique num produto para ver os rolos
  um a um (número, série, OP, partida e quantidade).
- **Conferência com packing list**: envie o PDF, o print, a imagem ou a planilha do cliente e o app compara,
  produto a produto, os rolos e o **TOTAL N.W.** com o sistema, mostrando a divergência em kg.
- Login com o **usuário e senha do Protheus** de cada pessoa, na própria tela do app.
- Abre como **aplicativo** pelo atalho na área de trabalho.

## Instalar (Windows)

1. Instale o **Node.js** (versão LTS): https://nodejs.org
2. Baixe este projeto (botão **Code → Download ZIP** no GitHub) e descompacte numa pasta fixa,
   por exemplo `C:\ConsultaRomaneio`.
3. Copie `.env.exemplo` para `.env` e preencha `PROTHEUS_URL` com o endereço da genericQuery
   (o mesmo usado no Postman, sem os parâmetros depois do `?`).
4. Dê dois cliques em **`criar-atalho.bat`**.
   Ele cria o atalho **Consulta de Romaneio** na área de trabalho e no menu Iniciar e já abre o app.

A partir daí é só usar o atalho. Ele liga o servidor em segundo plano (sem janela preta) e abre
o app numa janela própria do Edge ou do Chrome. Na primeira vez, entre com o seu usuário do Protheus.

| Arquivo | Para quê |
|---|---|
| `criar-atalho.bat` | cria o atalho na área de trabalho e no menu Iniciar |
| `abrir-app.vbs` | o que o atalho executa: liga o servidor (se preciso) e abre o app |
| `parar-servidor.bat` | desliga o servidor que roda em segundo plano |
| `iniciar.bat` | alternativa: roda o servidor numa janela visível (útil para ver erros) |

### Instalar pelo navegador

Com o servidor ligado, abra `http://localhost:3000` no Edge ou no Chrome e clique em
**Instalar app** (no topo do app ou no ícone de instalar na barra de endereço).

### Outros computadores da rede

Um computador roda o servidor; os outros abrem o endereço **Na rede** que aparece no `iniciar.bat`
(ex.: `http://192.168.0.25:3000`). Libere a porta 3000 no Firewall do Windows desse computador.
Para virar app nos outros computadores: no Edge, menu **⋯ → Aplicativos → Instalar este site como aplicativo**;
no Chrome, menu **⋮ → Transmitir, salvar e compartilhar → Criar atalho** (marque *Abrir como janela*).

## Login

- Cada pessoa entra com o **próprio usuário do Protheus**. O app testa o login no Protheus na hora.
- A senha não é gravada em disco: fica só na memória do servidor enquanto a sessão estiver aberta.
- A sessão encerra depois de `HORAS_SESSAO` horas sem uso (padrão 10) ou ao clicar em **Sair**.
  Reiniciar o servidor também encerra todas as sessões.

## Conferir com o packing list

Depois de buscar o romaneio, desça até **Conferir com packing list** e envie a planilha:

- **PDF** (recomendado): no Excel, *Arquivo → Salvar como → PDF*. O PDF do Excel traz o texto,
  então os números são lidos **exatos, sem OCR**. PDF escaneado também funciona (usa OCR);
- **Print**: copie o print da tabela e aperte **Ctrl+V** na página;
- **Imagem** (PNG/JPG) ou **planilha** (XLSX/CSV): arraste para a área tracejada;
- **Texto**: copie as linhas no Excel e aperte Ctrl+V.

| Coluna | Significado |
|---|---|
| Situação | OK, Divergente, Falta na planilha ou Falta no sistema |
| Dif. rolos | rolos da planilha − rolos do sistema |
| Divergência (kg) | N.W. da planilha − Qtde atual do sistema. Positivo: o sistema está com menos peso |
| Ajustar sistema para | o valor da planilha, para lançar no Protheus |

- Aceita planilhas com ou sem as colunas COLOR, LOTE e G.W.; o peso comparado é sempre o **TOTAL N.W.**
- Os números lidos ficam nas **células azuis** e podem ser corrigidos ali; a comparação refaz na hora.
- Se a linha "Total" da planilha não bater com a soma das linhas lidas, aparece um aviso.
- Tolerância padrão de 0,05 kg (arredondamento da planilha, que vem com 1 casa decimal).
- **Copiar divergências** / **Baixar divergências (CSV)** levam só o que precisa de ajuste.
- PDF, imagem e .xlsx são lidos no próprio navegador (pdf.js, Tesseract.js e SheetJS, baixados
  da internet na primeira vez). O arquivo não é enviado a nenhum servidor.

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `PROTHEUS_URL` | — | endereço da genericQuery (obrigatório) |
| `PROTHEUS_IGNORE_SSL` | `1` | aceita o certificado interno do Protheus |
| `PORT` | `3000` | porta do app |
| `HORAS_SESSAO` | `10` | horas sem uso até pedir login de novo |
| `CAMPO_PRODUTO` | `Z5_PROD` | campo do produto na SZ5 |
| `CAMPO_QUANTIDADE` | `Z5_PESOATU` | campo da quantidade atual na SZ5 |

## Como funciona

```
App (navegador)  →  server.js (este computador)  →  Protheus genericQuery
```

O navegador conversa só com o `server.js`, que faz as consultas no Protheus com o login da sessão.

| Tabela | Campos | Para quê |
|---|---|---|
| SZ5 | `Z5_FILIAL, Z5_PROD, Z5_PESOATU, Z5_NUMERO, Z5_SERIE, Z5_OP, Z5_PARTIDA` filtrado por `Z5_ROMAN` | rolos do romaneio |
| SB1 | `B1_COD, B1_DESC` | descrição dos produtos |

Rotas: `GET /api/romaneio?numero=…&filial=…`, `GET /api/campos` (lista os campos da SZ5 pelo SX3),
`GET /api/status`, `POST /api/login`, `POST /api/logout`.

Sem dependências: só Node.js 18+.

## Problemas comuns

- **"Usuário ou senha incorretos"**: é o login do Protheus; teste o mesmo usuário no Postman.
- **"Não foi possível conectar ao Protheus"**: o computador do servidor precisa alcançar o endereço
  de `PROTHEUS_URL` (teste a mesma URL no Postman nesse computador).
- **O atalho não abre**: rode `iniciar.bat` para ver a mensagem de erro, ou veja `servidor.log`.
- **Porta 3000 ocupada**: mude `PORT` no `.env`.
