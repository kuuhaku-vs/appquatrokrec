// Camada de acesso aos dados.
// Dois modos, escolhidos sozinhos ao abrir o app:
//  - "servidor": o app foi aberto pelo server.js (atalho/rede interna). As consultas
//    passam pelo servidor, como antes.
//  - "direto": o app está num site estático (GitHub Pages). O navegador consulta a
//    genericQuery do Protheus direto. Exige CORS liberado no REST do Protheus.
(() => {
  const CHAVE_URL = 'romaneio.protheusUrl';
  // Endereço usado quando a pessoa ainda não informou outro (já vem preenchido na tela de login)
  const URL_PADRAO = 'https://protheus.quatroktextil.com.br:6632/rest05/api/framework/v1/genericQuery';
  const CHAVE_AUTH = 'romaneio.auth';
  const CFG = {
    tabela: 'SZ5', campoFilial: 'Z5_FILIAL', campoRomaneio: 'Z5_ROMAN', campoProduto: 'Z5_PROD',
    campoQuantidade: 'Z5_PESOATU', campoNumero: 'Z5_NUMERO', campoSerie: 'Z5_SERIE', campoOP: 'Z5_OP',
    campoPartida: 'Z5_PARTIDA', tamanhoPagina: 200, maxPaginas: 100,
  };

  let modo = null; // 'servidor' | 'direto'

  // ---------- armazenamento seguro (pode falhar em janela anônima) ----------
  const ler = (st, k) => { try { return st.getItem(k); } catch { return null; } };
  const gravar = (st, k, v) => { try { v == null ? st.removeItem(k) : st.setItem(k, v); } catch {} };

  // Aceita a URL inteira da genericQuery (até com ?parâmetros) ou só a base do REST
  function normalizarUrl(u) {
    let s = String(u || '').trim().replace(/\?.*$/, '').replace(/\/+$/, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    if (!/genericQuery$/i.test(s)) s += '/api/framework/v1/genericQuery';
    return s;
  }

  function auth() {
    const v = ler(sessionStorage, CHAVE_AUTH) || ler(localStorage, CHAVE_AUTH);
    try { return v ? JSON.parse(v) : null; } catch { return null; }
  }

  class ErroAPI extends Error {
    constructor(msg, status, login) { super(msg); this.status = status; this.login = login; }
  }

  const origem = location.origin;
  function msgConexao() {
    return `O navegador não conseguiu falar com o Protheus. Os motivos mais comuns:\n` +
      `• O CORS não está liberado no REST do Protheus (a TI precisa liberar ${origem} no appserver.ini).\n` +
      `• O certificado do servidor do Protheus não é confiável neste computador.\n` +
      `• Este computador não alcança o servidor (rede/VPN).`;
  }

  async function chamar(url, cred) {
    let r;
    try {
      r = await fetch(url, {
        headers: { Authorization: 'Basic ' + cred, Accept: 'application/json' },
        credentials: 'omit', cache: 'no-store',
      });
    } catch {
      throw new ErroAPI(msgConexao(url), 0);
    }
    const corpo = await r.text();
    return { status: r.status, corpo };
  }

  async function buscarTudo(base, cred, tabela, campos, where) {
    const itens = [];
    for (let pagina = 1; pagina <= CFG.maxPaginas; pagina++) {
      const qs = new URLSearchParams({ tables: tabela, fields: campos, where, page: String(pagina), pagesize: String(CFG.tamanhoPagina) });
      const { status, corpo } = await chamar(`${base}?${qs}`, cred);
      let dados = null;
      try { dados = JSON.parse(corpo); } catch {}
      if (status === 401) throw new ErroAPI('O Protheus recusou seu usuário (senha alterada ou bloqueada). Entre de novo.', 401, true);
      if (status < 200 || status >= 300) {
        const msg = (dados && (dados.message || dados.errorMessage || dados.detailedMessage)) || corpo.slice(0, 300);
        throw new ErroAPI(`O Protheus respondeu ${status} na consulta da ${tabela}: ${msg}`, 502);
      }
      if (!dados) throw new ErroAPI(`A resposta da ${tabela} não veio em JSON.`, 502);
      const lote = Array.isArray(dados) ? dados : dados.items || dados.Items || [];
      itens.push(...lote);
      if (!(dados.hasNext === true || dados.hasNext === 'true') || lote.length === 0) break;
    }
    return itens;
  }

  const campo = (reg, c) => {
    if (c in reg) return reg[c];
    const k = Object.keys(reg).find((x) => x.toUpperCase() === c.toUpperCase());
    return k ? reg[k] : undefined;
  };
  const texto = (v) => String(v ?? '').trim();
  const num = (v) => {
    if (typeof v === 'number') return v;
    const n = Number(texto(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  // Mesma regra do server.js
  async function consultarDireto(numero, filial) {
    const a = auth();
    const base = normalizarUrl((ler(localStorage, CHAVE_URL) || URL_PADRAO));
    if (!a || !base) throw new ErroAPI('Entre com seu usuário do Protheus.', 401, true);
    numero = texto(numero).toUpperCase();
    filial = texto(filial);
    if (!/^[A-Z0-9]{1,8}$/.test(numero)) throw new ErroAPI('Digite um número de romaneio válido, com até 8 dígitos.', 400);
    if (/^\d+$/.test(numero)) numero = numero.padStart(8, '0');
    if (!/^[A-Za-z0-9]{0,10}$/.test(filial)) throw new ErroAPI('Filial inválida.', 400);

    const C = CFG;
    let where = `${C.campoRomaneio}='${numero}'`;
    if (filial) where += ` AND ${C.campoFilial}='${filial}'`;
    const campos = [C.campoFilial, C.campoProduto, C.campoQuantidade, C.campoNumero, C.campoSerie, C.campoOP, C.campoPartida].join(',');
    const t0 = Date.now();
    const rolos = await buscarTudo(base, a.basic, C.tabela, campos, where);

    const grupos = new Map(), filiais = new Set(), ops = new Set();
    for (const r of rolos) {
      const cod = texto(campo(r, C.campoProduto));
      let g = grupos.get(cod);
      if (!g) { g = { codigo: cod, descricao: '', rolos: 0, quantidade: 0, itens: [] }; grupos.set(cod, g); }
      const qtd = num(campo(r, C.campoQuantidade));
      g.rolos += 1; g.quantidade += qtd;
      const op = texto(campo(r, C.campoOP)); if (op) ops.add(op);
      const fil = texto(campo(r, C.campoFilial)); if (fil) filiais.add(fil);
      g.itens.push({ numero: texto(campo(r, C.campoNumero)), serie: texto(campo(r, C.campoSerie)), op, partida: texto(campo(r, C.campoPartida)), quantidade: +qtd.toFixed(3) });
    }
    let aviso = '';
    const codigos = [...grupos.keys()].filter(Boolean);
    try {
      for (let i = 0; i < codigos.length; i += 40) {
        const lista = codigos.slice(i, i + 40).map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
        const sb1 = await buscarTudo(base, a.basic, 'SB1', 'B1_COD,B1_DESC', `B1_COD IN (${lista})`);
        for (const p of sb1) {
          const g = grupos.get(texto(campo(p, 'B1_COD')));
          if (g && !g.descricao) g.descricao = texto(campo(p, 'B1_DESC'));
        }
      }
    } catch (e) {
      if (e.login) throw e;
      aviso = 'As descrições dos produtos não puderam ser carregadas do cadastro (SB1). Os códigos e quantidades estão corretos.';
    }
    const produtos = [...grupos.values()]
      .map((g) => ({ ...g, quantidade: +g.quantidade.toFixed(3), itens: g.itens.sort((x, y) => x.numero.localeCompare(y.numero, 'pt-BR', { numeric: true })) }))
      .sort((x, y) => x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true }));
    return {
      numero, filial: filial || [...filiais].join(', '), totalRolos: rolos.length,
      totalQuantidade: +produtos.reduce((s, p) => s + p.quantidade, 0).toFixed(3),
      totalOPs: ops.size, produtos, aviso, consultadoEm: new Date().toISOString(), tempoMs: Date.now() - t0,
    };
  }

  // ---------- API usada pela página ----------
  async function detectarModo() {
    if (modo) return modo;
    try {
      const r = await fetch('api/status', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      modo = j && j.ok === true ? 'servidor' : 'direto';
    } catch { modo = 'direto'; }
    return modo;
  }

  const resposta = (ok, status, j) => ({ ok, status, j });

  window.API = {
    get modo() { return modo; },
    servidorSalvo: () => ler(localStorage, CHAVE_URL) || URL_PADRAO,

    async status() {
      if ((await detectarModo()) === 'servidor') {
        const r = await fetch('api/status', { cache: 'no-store' });
        return r.json();
      }
      const a = auth();
      const url = (ler(localStorage, CHAVE_URL) || URL_PADRAO);
      return { ok: true, direto: true, configurado: true, servidor: url || '', logado: !!(a && url), usuario: a ? a.usuario : '' };
    },

    async login(usuario, senha, servidor, lembrar) {
      if ((await detectarModo()) === 'servidor') {
        const r = await fetch('api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha }) });
        return resposta(r.ok, r.status, await r.json().catch(() => ({})));
      }
      const base = normalizarUrl(servidor);
      if (!base) return resposta(false, 400, { erro: 'Informe o endereço do Protheus.' });
      const basic = btoa(unescape(encodeURIComponent(`${usuario}:${senha}`)));
      const qs = new URLSearchParams({ tables: 'SB1', fields: 'B1_COD', where: "B1_COD='__LOGIN__'", page: '1', pagesize: '1' });
      try {
        const { status } = await chamar(`${base}?${qs}`, basic);
        if (status === 401 || status === 403) return resposta(false, 401, { erro: 'Usuário ou senha incorretos.' });
        if (status === 404) return resposta(false, 404, { erro: 'Endereço do Protheus não encontrado (404). Confira o endereço: use o mesmo do Postman, até /genericQuery.' });
        if (status < 200 || status >= 300) return resposta(false, status, { erro: `O Protheus respondeu ${status} ao validar o login.` });
      } catch (e) {
        return resposta(false, 0, { erro: e.message });
      }
      gravar(localStorage, CHAVE_URL, servidor.trim());
      const valor = JSON.stringify({ usuario, basic });
      gravar(sessionStorage, CHAVE_AUTH, valor);
      gravar(localStorage, CHAVE_AUTH, lembrar ? valor : null);
      return resposta(true, 200, { ok: true, usuario });
    },

    async logout() {
      if ((await detectarModo()) === 'servidor') { try { await fetch('api/logout', { method: 'POST' }); } catch {} return; }
      gravar(sessionStorage, CHAVE_AUTH, null);
      gravar(localStorage, CHAVE_AUTH, null);
    },

    async romaneio(numero, filial) {
      if ((await detectarModo()) === 'servidor') {
        const r = await fetch('api/romaneio?' + new URLSearchParams({ numero, filial }));
        return resposta(r.ok, r.status, await r.json().catch(() => ({ erro: 'Resposta inválida do servidor.' })));
      }
      try {
        return resposta(true, 200, await consultarDireto(numero, filial));
      } catch (e) {
        if (e.login) { gravar(sessionStorage, CHAVE_AUTH, null); gravar(localStorage, CHAVE_AUTH, null); }
        return resposta(false, e.status || 502, { erro: e.message, login: !!e.login });
      }
    },
  };
})();
