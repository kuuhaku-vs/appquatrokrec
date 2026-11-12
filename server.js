// Consulta de Romaneio
// Servidor do site: entrega as páginas da pasta /public e consulta o Protheus
// pela genericQuery. O navegador nunca fala direto com o Protheus, então não há
// problema de CORS e o usuário/senha ficam só aqui no servidor.
//
// Uso:  node server.js   (Node 18 ou superior, nenhum pacote para instalar)
// Configuração: arquivo .env na mesma pasta (veja .env.exemplo).
// O login é feito na tela do site, com o usuário do Protheus de cada pessoa.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

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
  // Endereço da genericQuery, ex.: https://SEU-SERVIDOR:PORTA/rest/api/framework/v1/genericQuery
  urlGenericQuery: env('PROTHEUS_URL', ''),
  horasSessao: Number(env('HORAS_SESSAO', 10)),
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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ---------- Sessões (login feito na tela do site) ----------
// Cada pessoa entra com o próprio usuário do Protheus. A senha fica só na memória
// deste servidor enquanto a sessão estiver aberta; nada é gravado em disco.
const sessoes = new Map(); // token -> { usuario, senha, expira }
const credencial = new AsyncLocalStorage();
const duracao = () => CONFIG.horasSessao * 3600 * 1000;
function lerCookie(req, nome) {
  for (const p of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = p.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return '';
}
function sessaoDe(req) {
  const t = lerCookie(req, 'sessao');
  const s = t && sessoes.get(t);
  if (!s) return null;
  if (s.expira < Date.now()) { sessoes.delete(t); return null; }
  s.expira = Date.now() + duracao();
  return { token: t, ...s };
}
setInterval(() => { const a = Date.now(); for (const [t, s] of sessoes) if (s.expira < a) sessoes.delete(t); }, 600000).unref();

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 10000) { falha(new Error('Requisição grande demais.')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { falha(new Error('JSON inválido.')); } });
  });
}

// ---------- Protheus ----------
class ErroProtheus extends Error {
  constructor(msg, url, status) { super(msg); this.url = url; this.status = status; }
}

function chamarProtheus(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${(credencial.getStore() || {}).usuario || ''}:${(credencial.getStore() || {}).senha || ''}`).toString('base64'),
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
    if (status === 401) throw new ErroProtheus('O Protheus recusou o usuário ou a senha.', primeiraUrl, 401);
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

// ---------- Regras da consulta: por romaneio (Z5_ROMAN) ou por OP (Z5_OP) ----------
async function consultarRomaneio(params, tipo) {
  const porOP = tipo === 'op';
  let numero = texto(params.get('numero')).toUpperCase();
  const filial = texto(params.get('filial'));
  if (porOP) {
    if (!/^[A-Z0-9]{1,14}$/.test(numero)) return { status: 400, dados: { erro: 'Digite um número de OP válido, só com letras e números.' } };
    if (/^\d+$/.test(numero)) numero = numero.padStart(6, '0');
  } else {
    if (!/^[A-Z0-9]{1,8}$/.test(numero)) return { status: 400, dados: { erro: 'Digite um número de romaneio válido, com até 8 dígitos.' } };
    if (/^\d+$/.test(numero)) numero = numero.padStart(8, '0');
  }
  if (!/^[A-Za-z0-9]{0,10}$/.test(filial)) return { status: 400, dados: { erro: 'Filial inválida.' } };

  const C = CONFIG;
  // OP: busca pelo começo do número, assim "012345" traz todos os itens/sequências (01234501001...)
  const sufixo = filial ? ` AND ${C.campoFilial}='${filial}'` : '';
  const where = (porOP ? `${C.campoOP} LIKE '${numero}%'` : `${C.campoRomaneio}='${numero}'`) + sufixo;
  const campos = [C.campoFilial, C.campoRomaneio, C.campoProduto, C.campoQuantidade, C.campoNumero, C.campoSerie, C.campoOP, C.campoPartida].join(',');

  const t0 = Date.now();
  let rolos;
  try {
    rolos = await buscarTudo(C.tabela, campos, where);
  } catch (e) {
    // Se o Protheus não aceitar LIKE, tenta a OP exata
    if (!porOP || !(e instanceof ErroProtheus) || e.status === 401) throw e;
    rolos = await buscarTudo(C.tabela, campos, `${C.campoOP}='${numero}'` + sufixo);
  }

  const grupos = new Map();
  const filiais = new Set();
  const ops = new Set();
  const romaneios = new Set();
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
    const rom = texto(ler(r, C.campoRomaneio));
    if (rom) romaneios.add(rom);
    g.itens.push({
      numero: texto(ler(r, C.campoNumero)),
      serie: texto(ler(r, C.campoSerie)),
      romaneio: rom,
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
      tipo: porOP ? 'op' : 'romaneio',
      romaneios: [...romaneios].sort(),
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

// Testa usuário e senha com uma consulta mínima no Protheus
async function validarLogin(usuario, senha) {
  const qs = new URLSearchParams({ tables: 'SB1', fields: 'B1_COD', where: "B1_COD='__LOGIN__'", page: '1', pagesize: '1' });
  const { status } = await credencial.run({ usuario, senha }, () => chamarProtheus(`${CONFIG.urlGenericQuery}?${qs}`));
  return status;
}

function cookieSessao(token, maxAge) {
  return `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/api/status') {
      const s = sessaoDe(req);
      return json(res, 200, { ok: true, configurado: !!CONFIG.urlGenericQuery, logado: !!s, usuario: s ? s.usuario : '' });
    }

    if (u.pathname === '/api/login' && req.method === 'POST') {
      if (!CONFIG.urlGenericQuery) return json(res, 500, { erro: 'O endereço do Protheus não foi configurado. Preencha PROTHEUS_URL no arquivo .env e reinicie.' });
      const { usuario, senha } = await lerCorpo(req);
      const user = String(usuario || '').trim();
      if (!user || !senha) return json(res, 400, { erro: 'Informe usuário e senha.' });
      const status = await validarLogin(user, String(senha));
      if (status === 401 || status === 403) {
        await new Promise((r) => setTimeout(r, 800)); // freia tentativas repetidas
        return json(res, 401, { erro: 'Usuário ou senha incorretos.' });
      }
      if (status < 200 || status >= 300) return json(res, 502, { erro: `O Protheus respondeu ${status} ao validar o login. Tente de novo em instantes.` });
      const token = crypto.randomBytes(32).toString('hex');
      sessoes.set(token, { usuario: user, senha: String(senha), expira: Date.now() + duracao() });
      res.setHeader('Set-Cookie', cookieSessao(token, Math.round(duracao() / 1000)));
      console.log(new Date().toLocaleString('pt-BR'), `login: ${user}`);
      return json(res, 200, { ok: true, usuario: user });
    }

    if (u.pathname === '/api/logout' && req.method === 'POST') {
      const s = sessaoDe(req);
      if (s) sessoes.delete(s.token);
      res.setHeader('Set-Cookie', cookieSessao('', 0));
      return json(res, 200, { ok: true });
    }

    if (u.pathname.startsWith('/api/')) {
      const s = sessaoDe(req);
      if (!s) return json(res, 401, { erro: 'Sua sessão expirou. Entre de novo.', login: true });
      const cred = { usuario: s.usuario, senha: s.senha };
      try {
        if (u.pathname === '/api/romaneio' || u.pathname === '/api/op') {
          const tipo = u.pathname === '/api/op' ? 'op' : 'romaneio';
          const { status, dados } = await credencial.run(cred, () => consultarRomaneio(u.searchParams, tipo));
          return json(res, status, dados);
        }
        if (u.pathname === '/api/campos') return json(res, 200, await credencial.run(cred, listarCampos));
      } catch (e) {
        if (e instanceof ErroProtheus && e.status === 401) {
          sessoes.delete(s.token);
          return json(res, 401, { erro: 'O Protheus recusou seu usuário (senha alterada ou bloqueada). Entre de novo.', login: true });
        }
        throw e;
      }
      return json(res, 404, { erro: 'Rota não encontrada.' });
    }
  } catch (e) {
    const msg = e instanceof ErroProtheus ? e.message : `Não foi possível conectar ao Protheus (${e.code || e.message}). Verifique a rede e o endereço em PROTHEUS_URL.`;
    console.error(new Date().toLocaleString('pt-BR'), msg);
    return json(res, 502, { erro: msg });
  }
  arquivoEstatico(res, u.pathname);
});

servidor.listen(CONFIG.porta, '0.0.0.0', () => {
  console.log('');
  console.log('  Consulta de Romaneio');
  console.log(`  Neste computador:  http://localhost:${CONFIG.porta}`);
  for (const lista of Object.values(require('os').networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Na rede:           http://${i.address}:${CONFIG.porta}`);
  }
  if (!CONFIG.urlGenericQuery) {
    console.log('');
    console.log('  ATENÇÃO: endereço do Protheus não configurado.');
    console.log('  Abra o arquivo .env e preencha PROTHEUS_URL (veja .env.exemplo).');
  }
  console.log('');
});
