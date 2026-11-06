# Consulta de Romaneio

Site interno para consultar um romaneio no Protheus. Digite o número e ele mostra:

- cada **produto** do romaneio (código e descrição);
- a **quantidade de rolos** de cada produto;
- a **quantidade atual em kg** (`Z5_PESOATU`) de cada produto e o total;
- ao clicar num produto, a **lista de rolos** dele (número, série, OP, partida e quantidade).

Também dá para filtrar, ordenar as colunas, copiar para o Excel, baixar CSV e imprimir.

## Conferir com o packing list

Depois de buscar o romaneio, desça até **Conferir com packing list** e envie a planilha do
cliente/fornecedor de um destes jeitos:

- **PDF** (recomendado): no Excel, *Arquivo → Salvar como → PDF* e arraste o PDF para a página.
  O PDF do Excel traz o texto de verdade, então os números são lidos **exatos, sem OCR**.
  PDF escaneado (só imagem) também funciona: o site extrai a imagem e usa o OCR;
- **Print**: tire o print da tabela e aperte **Ctrl+V** na página;
- **Imagem**: arraste um PNG/JPG para a área tracejada, ou clique em "Escolher arquivo";
- **Planilha**: arraste o .xlsx ou .csv (é o jeito mais preciso);
- **Texto**: copie as linhas no Excel e aperte Ctrl+V na página.

O site lê cada linha (código, descrição, TOTAL QUANTITY ROLL e **TOTAL N.W.**) e compara com
o sistema produto a produto:

| Coluna | Significado |
|---|---|
| Situação | OK, Divergente, Falta na planilha ou Falta no sistema |
| Dif. rolos | rolos da planilha − rolos do sistema |
| Divergência (kg) | N.W. da planilha − Qtde atual do sistema. Positivo: o sistema está com menos peso |
| Ajustar sistema para | o valor da planilha, para lançar no Protheus |

- Funciona com planilhas em formatos diferentes (com ou sem as colunas COLOR, LOTE e G.W.):
  o peso comparado é sempre o TOTAL N.W.
- Os números lidos da imagem ficam nas **células azuis**: se o OCR ler algo errado, corrija ali
  e a comparação refaz na hora. Confira olhando a imagem, que fica fixada na tela.
- Se a linha "Total General" da imagem não bater com a soma das linhas lidas, aparece um aviso.
- A tolerância padrão é 0,05 kg (só o arredondamento da planilha, que vem com 1 casa decimal). Dá para mudar na tela.
- "Copiar divergências" e "Baixar divergências (CSV)" levam só o que precisa de ajuste.
- A leitura de PDF, imagem e .xlsx baixa o leitor (pdf.js / Tesseract.js / SheetJS) da internet na primeira
  vez, então o computador precisa de acesso à internet. A imagem é lida no próprio navegador
  e não é enviada a nenhum servidor.
- O código do produto nem sempre sai legível num print pequeno. Por isso o site casa cada linha
  com o produto pelo código **ou** pela descrição, o que bater melhor.

## Como rodar no Windows

1. Instale o **Node.js** (versão LTS) em https://nodejs.org, se ainda não tiver.
2. Descompacte esta pasta onde quiser.
3. Dê dois cliques em **`iniciar.bat`**.
   - Na primeira vez, ele cria o arquivo `.env` e abre o Bloco de Notas.
     Preencha `PROTHEUS_USER` e `PROTHEUS_PASS` (o mesmo login do Postman), salve e feche.
   - Rode o `iniciar.bat` de novo.
4. O navegador abre em **http://localhost:3000**. Deixe a janela preta aberta enquanto usar o site.

## Usar em outros computadores da rede

Ao iniciar, a janela mostra um endereço "Na rede", por exemplo `http://192.168.0.25:3000`.
Qualquer computador da mesma rede pode abrir esse endereço. Se não abrir, libere a porta
3000 no Firewall do Windows do computador que roda o servidor.

Para deixar sempre ligado, rode o servidor num computador que fique ligado (ou num servidor
da empresa) e coloque o `iniciar.bat` na inicialização do Windows.

## Link direto para um romaneio

`http://localhost:3000/?r=00529749` já abre com o romaneio consultado. Dá para mandar esse link
para alguém da rede (troque `localhost` pelo endereço "Na rede").

## Como funciona

```
Navegador  →  server.js (este computador)  →  Protheus genericQuery
```

O navegador conversa só com o `server.js`. O servidor faz as consultas no Protheus com o
login do `.env`, então a senha não fica exposta na página.

Consultas feitas a cada busca:

| Tabela | Campos | Para quê |
|---|---|---|
| SZ5 | `Z5_FILIAL, Z5_PROD, Z5_PESOATU, Z5_NUMERO, Z5_SERIE, Z5_OP, Z5_PARTIDA` filtrado por `Z5_ROMAN` | rolos do romaneio |
| SB1 | `B1_COD, B1_DESC` | descrição dos produtos |

## Arquivos

| Arquivo | O que é |
|---|---|
| `server.js` | servidor do site e consultas no Protheus |
| `public/` | páginas do site (HTML, CSS e JavaScript) |
| `.env.exemplo` | modelo de configuração; copie para `.env` |
| `iniciar.bat` | inicia o site no Windows |
| `iniciar.sh` | inicia o site no Linux ou Mac |

## Problemas comuns

- **"O Protheus recusou o usuário ou a senha"**: confira `PROTHEUS_USER` e `PROTHEUS_PASS` no `.env`.
- **"Não foi possível conectar ao Protheus"**: o computador precisa alcançar
  `protheus.quatroktextil.com.br:6632` (teste a mesma URL no Postman nesse computador).
- **"O servidor do site não respondeu"**: a janela do `iniciar.bat` foi fechada. Abra de novo.
- **Porta 3000 ocupada**: mude `PORT` no `.env`.
- **Conferir campos da SZ5**: com o site rodando, abra `http://localhost:3000/api/campos`
  para ver a lista do dicionário (SX3).
