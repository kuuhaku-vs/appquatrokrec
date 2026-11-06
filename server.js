// Consulta de Romaneio
// Servidor do site: entrega as páginas da pasta /public e consulta o Protheus
// pela genericQuery. O navegador nunca fala direto com o Protheus, então não há
// problema de CORS e o usuário/senha ficam só aqui no servidor.
//
// Uso:  node server.js   (Node 18 ou superior, nenhum pacote para instalar)
// Configuração: arquivo .env na mesma pasta (veja .env.exemplo)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------- Lê o arquivo .env (sem dependências) ----------
(function carregarEnv() {
  const arq = path.join(__dirname, '.env');
  if (!fs.existsSync(arq)) return;
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || linha.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const env = (k, padrao) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : padrao);

const CONFIG = {
  porta: Number(env('PORT', 3000)),
  urlGenericQuery: env('PROTHEUS_URL', 'https://protheus.quatroktextil.com.br:6632/rest05/api/framework/v1/genericQuery'),
  usuario: env('PROTHEUS_USER', ''),
  senha: env('PROTHEUS_PASS', ''),
  ignorarSSL: env('PROTHEUS_IGNORE_SSL', '1') !== '0',
  // Campos da SZ5 (confirmados no dicionário SX3)
  tabela: 'SZ5',
  campoFilial: 'Z5_FILIAL',
  campoRomaneio: 'Z5_ROMAN',
  campoProduto: env('CAMPO_PRODUTO', 'Z5_PROD'),
  campoQuantidade: env('CAMPO_QUANTIDADE', 'Z5_PESOATU'),
  campoNumero: 'Z5_NUMERO',
  campoSerie: 'Z5_SERIE',
  campoOP: 'Z5_OP',
  campoPartida: 'Z5_PARTIDA',
  tamanhoPagina: 200,
  maxPaginas: 100,
};

const PUBLICO = path.join(__dirname, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

// ---------- Protheus ----------
class ErroProtheus extends Error {
  constructor(msg, url) { super(msg); this.url = url; }
}

function chamarProtheus(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${CONFIG.usuario}:${CONFIG.senha}`).toString('base64'),
        Accept: 'application/json',
      },
      rejectUnauthorized: !CONFIG.ignorarSSL,
      timeout: 60000,
    }, (res) => {
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (corpo += c));
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('timeout', () => req.destroy(new Error('O Protheus demorou mais de 60s para responder.')));
    req.on('error', reject);
    req.end();
  });
}

async function buscarTudo(tabela, campos, where) {
  const itens = [];
  let primeiraUrl = '';
  for (let pagina = 1; pagina <= CONFIG.maxPaginas; pagina++) {
    const qs = new URLSearchParams({ tables: tabela, fields: campos, where, page: String(pagina), pagesize: String(CONFIG.tamanhoPagina) });
    const url = `${CONFIG.urlGenericQuery}?${qs}`;
    if (pagina === 1) primeiraUrl = url;

    const { status, corpo } = await chamarProtheus(url);
    let dados = null;
    try { dados = JSON.parse(corpo); } catch {}
    if (status === 401) throw new ErroProtheus('O Protheus recusou o usuário ou a senha. Confira PROTHEUS_USER e PROTHEUS_PASS no arquivo .env.', primeiraUrl);
    if (status < 200 || status >= 300) {
      const msg = (dados && (dados.message || dados.errorMessage || dados.detailedMessage)) || corpo.slice(0, 400);
      throw new ErroProtheus(`O Protheus respondeu ${status} na consulta da ${tabela}: ${msg}`, primeiraUrl);
    }
    if (!dados) throw new ErroProtheus(`A resposta da ${tabela} não veio em JSON.`, primeiraUrl);

    const lote = Array.isArray(dados) ? dados : dados.items || dados.Items || [];
    itens.push(...lote);
    if (!(dados.hasNext === true || dados.hasNext === 'true') || lote.length === 0) break;
  }
  return { itens, url: primeiraUrl };
}

// Lê um campo sem diferenciar maiúsculas/minúsculas (a API devolve em minúsculo).
function ler(reg, campo) {
  if (campo in reg) return reg[campo];
  const k = Object.keys(reg).find((x) => x.toUpperCase() === campo.toUpperCase());
  return k ? reg[k] : undefined;
}
const texto = (v) => String(v ?? '').trim();
const num = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(texto(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// ---------- Regras do romaneio ----------
async function consultarRomaneio(params) {
  let numero = texto(params.get('numero')).toUpperCase();
  const filial = texto(params.get('filial'));
  if (!/^[A-Z0-9]{1,8}$/.test(numero)) return { status: 400, dados: { erro: 'Digite um número de romaneio válido, com até 8 dígitos.' } };
  if (/^\d+$/.test(numero)) numero = numero.padStart(8, '0');
  if (!/^[A-Za-z0-9]{0,10}$/.test(filial)) return { status: 400, dados: { erro: 'Filial inválida.' } };

  let where = `${CONFIG.campoRomaneio}='${numero}'`;
  if (filial) where += ` AND ${CONFIG.campoFilial}='${filial}'`;
  const C = CONFIG;
  const campos = [C.campoFilial, C.campoProduto, C.campoQuantidade, C.campoNumero, C.campoSerie, C.campoOP, C.campoPartida].join(',');

  const t0 = Date.now();
  const rolos = await buscarTudo(C.tabela, campos, where);

  const grupos = new Map();
  const filiais = new Set();
  const ops = new Set();
  for (const r of rolos.itens) {
    const cod = texto(ler(r, C.campoProduto));
    let g = grupos.get(cod);
    if (!g) { g = { codigo: cod, descricao: '', rolos: 0, quantidade: 0, itens: [] }; grupos.set(cod, g); }
    const qtd = num(ler(r, C.campoQuantidade));
    g.rolos += 1;
    g.quantidade += qtd;
    const op = texto(ler(r, C.campoOP));
    if (op) ops.add(op);
    const fil = texto(ler(r, C.campoFilial));
    if (fil) filiais.add(fil);
    g.itens.push({
      numero: texto(ler(r, C.campoNumero)),
      serie: texto(ler(r, C.campoSerie)),
      op,
      partida: texto(ler(r, C.campoPartida)),
      quantidade: +qtd.toFixed(3),
    });
  }

  // Descrição vem do cadastro de produtos (SB1)
  let aviso = '';
  const codigos = [...grupos.keys()].filter(Boolean);
  try {
    for (let i = 0; i < codigos.length; i += 40) {
      const lista = codigos.slice(i, i + 40).map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
      const sb1 = await buscarTudo('SB1', 'B1_COD,B1_DESC', `B1_COD IN (${lista})`);
      for (const p of sb1.itens) {
        const g = grupos.get(texto(ler(p, 'B1_COD')));
        if (g && !g.descricao) g.descricao = texto(ler(p, 'B1_DESC'));
      }
    }
  } catch (e) {
    aviso = 'As descrições dos produtos não puderam ser carregadas do cadastro (SB1). Os códigos e quantidades estão corretos.';
  }

  const produtos = [...grupos.values()]
    .map((g) => ({
      ...g,
      quantidade: +g.quantidade.toFixed(3),
      itens: g.itens.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));

  return {
    status: 200,
    dados: {
      numero,
      filial: filial || [...filiais].join(', '),
      totalRolos: rolos.itens.length,
      totalQuantidade: +produtos.reduce((s, p) => s + p.quantidade, 0).toFixed(3),
      totalOPs: ops.size,
      produtos,
      aviso,
      consultadoEm: new Date().toISOString(),
      tempoMs: Date.now() - t0,
    },
  };
}

// Lista os campos da SZ5 pelo dicionário (útil para manutenção): /api/campos
async function listarCampos() {
  const r = await buscarTudo('SX3', 'X3_CAMPO,X3_TITULO,X3_TIPO', `X3_ARQUIVO='${CONFIG.tabela}'`);
  return r.itens.map((x) => ({ campo: texto(ler(x, 'X3_CAMPO')), titulo: texto(ler(x, 'X3_TITULO')), tipo: texto(ler(x, 'X3_TIPO')) }));
}

// ---------- HTTP ----------
function json(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function arquivoEstatico(res, caminho) {
  const alvo = path.normalize(path.join(PUBLICO, caminho === '/' ? 'index.html' : decodeURIComponent(caminho)));
  if (!alvo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) {
      // Qualquer rota desconhecida abre o site (ex.: /romaneio/00529749)
      return arquivoEstatico(res, '/');
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(alvo).pipe(res);
  });
}

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/api/romaneio') {
      const { status, dados } = await consultarRomaneio(u.searchParams);
      return json(res, status, dados);
    }
    if (u.pathname === '/api/campos') return json(res, 200, await listarCampos());
    if (u.pathname === '/api/status') return json(res, 200, { ok: true, configurado: !!(CONFIG.usuario && CONFIG.senha) });
  } catch (e) {
    const msg = e instanceof ErroProtheus ? e.message : `Não foi possível conectar ao Protheus (${e.code || e.message}). Verifique a rede e o endereço em PROTHEUS_URL.`;
    console.error(new Date().toLocaleString('pt-BR'), msg);
    return json(res, 502, { erro: msg });
  }
  if (u.pathname.startsWith('/api/')) return json(res, 404, { erro: 'Rota não encontrada.' });
  arquivoEstatico(res, u.pathname);
});

servidor.listen(CONFIG.porta, '0.0.0.0', () => {
  console.log('');
  console.log('  Consulta de Romaneio');
  console.log(`  Neste computador:  http://localhost:${CONFIG.porta}`);
  for (const lista of Object.values(require('os').networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Na rede:           http://${i.address}:${CONFIG.porta}`);
  }
  if (!CONFIG.usuario || !CONFIG.senha) {
    console.log('');
    console.log('  ATENÇÃO: usuário e senha do Protheus não configurados.');
    console.log('  Copie .env.exemplo para .env e preencha PROTHEUS_USER e PROTHEUS_PASS.');
  }
  console.log('');
});
