// Consulta de Romaneio — lógica da página
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kg = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = (n) => n.toLocaleString('pt-BR');
  const pct = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

  let atual = null;           // última resposta da API
  let ordem = { col: 'codigo', asc: true };
  const abertos = new Set();  // códigos com detalhe aberto
  let consultaId = 0;

  // ---------- Histórico ----------
  const CHAVE_HIST = 'romaneio.historico';
  const fmtData = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  function lerHistorico() {
    try {
      const l = JSON.parse(localStorage.getItem(CHAVE_HIST) || '[]');
      return Array.isArray(l) ? l.filter((x) => x && x.n).map((x) => ({ ...x, tipo: x.tipo === 'op' ? 'op' : 'romaneio' })) : [];
    } catch { return []; }
  }
  function salvarHistorico(n, tipo) {
    const l = [{ n, tipo, t: Date.now() }, ...lerHistorico().filter((x) => !(x.n === n && x.tipo === tipo))].slice(0, 20);
    try { localStorage.setItem(CHAVE_HIST, JSON.stringify(l)); } catch {}
    mostrarHistorico();
  }
  function mostrarHistorico() {
    const l = lerHistorico();
    $('historico').hidden = !l.length;
    $('historicoQtd').textContent = l.length ? `(${l.length})` : '';
    $('historicoLista').innerHTML = l.map((x) => `<li><button type="button" data-n="${esc(x.n)}" data-tipo="${x.tipo}"><span class="h-num"><span class="h-tipo">${x.tipo === 'op' ? 'OP' : 'ROM'}</span>${esc(x.n)}</span><span class="h-data">${esc(fmtData(x.t))}</span></button></li>`).join('');
    if (!l.length) abrirHistorico(false);
  }
  function abrirHistorico(abrir) {
    $('historicoPainel').hidden = !abrir;
    $('btnHistorico').setAttribute('aria-expanded', String(!!abrir));
  }
  $('btnHistorico').addEventListener('click', (e) => { e.stopPropagation(); abrirHistorico($('historicoPainel').hidden); });
  $('historicoLista').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    abrirHistorico(false);
    definirTipo(b.dataset.tipo);
    $('numero').value = b.dataset.n;
    buscar();
  });
  $('historicoLimpar').addEventListener('click', () => { try { localStorage.removeItem(CHAVE_HIST); } catch {} mostrarHistorico(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#historico')) abrirHistorico(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrirHistorico(false); });

  // ---------- Tema claro / escuro ----------
  const CHAVE_TEMA = 'romaneio.tema';
  function aplicarTema(t) {
    document.documentElement.dataset.tema = t;
    $('btnTemaTxt').textContent = t === 'escuro' ? 'Tema claro' : 'Tema escuro';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'escuro' ? '#0a1222' : '#0f2340');
  }
  aplicarTema(document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro');
  $('btnTema').addEventListener('click', () => {
    const t = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
    try { localStorage.setItem(CHAVE_TEMA, t); } catch {}
    aplicarTema(t);
  });

  // ---------- Mensagens ----------
  function mostrar(el, txt) { $(el).textContent = txt || ''; $(el).hidden = !txt; }
  let toastT;
  function toast(txt) {
    const t = $('toast'); t.textContent = txt; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200);
  }
  window.mostrarToast = toast;
  function estado(qual) {
    $('inicio').hidden = qual !== 'inicio';
    $('carregando').hidden = qual !== 'carregando';
    $('resultado').hidden = qual !== 'resultado';
  }

  // ---------- Tipo de busca: romaneio ou OP ----------
  const TIPOS = {
    romaneio: { nome: 'Romaneio', artigo: 'o romaneio', de: 'do romaneio', digitos: 8, max: 8, param: 'r', placeholder: 'Digite o número do romaneio...' },
    op: { nome: 'OP', artigo: 'a OP', de: 'da OP', digitos: 6, max: 14, param: 'op', placeholder: 'Digite o número da OP...' },
  };
  const tipoAtual = () => (document.querySelector('input[name="tipoBusca"]:checked')?.value === 'op' ? 'op' : 'romaneio');
  function definirTipo(tipo) {
    tipo = tipo === 'op' ? 'op' : 'romaneio';
    const T = TIPOS[tipo];
    document.querySelector(`input[name="tipoBusca"][value="${tipo}"]`).checked = true;
    $('numero').maxLength = T.max;
    $('numero').placeholder = T.placeholder;
    $('numero').setAttribute('aria-label', `Número ${T.de}`);
  }
  document.querySelectorAll('input[name="tipoBusca"]').forEach((r) => r.addEventListener('change', () => {
    definirTipo(tipoAtual());
    $('numero').value = '';
    $('numero').focus();
  }));
  definirTipo(tipoAtual()); // o navegador pode restaurar a opção marcada ao recarregar

  // ---------- Busca ----------
  async function buscar() {
    const tipo = tipoAtual(), T = TIPOS[tipo];
    let numero = $('numero').value.trim().toUpperCase();
    const filial = '';
    if (!numero) { $('numero').focus(); return; }
    if (/^\d+$/.test(numero)) numero = numero.padStart(T.digitos, '0');
    $('numero').value = numero;

    const id = ++consultaId;
    mostrar('erro', ''); mostrar('aviso', '');
    $('btnBuscar').disabled = true; $('btnBuscar').querySelector('span').textContent = 'Buscando…';
    estado('carregando');

    const url = new URL(location.href);
    url.searchParams.delete('r'); url.searchParams.delete('op');
    url.searchParams.set(T.param, numero);
    url.searchParams.delete('f');
    history.replaceState(null, '', url);

    try {
      const resp = tipo === 'op' ? await API.op(numero, filial) : await API.romaneio(numero, filial);
      const j = resp.j;
      if (id !== consultaId) return;
      if (resp.status === 401 && j.login) { pendente = { n: numero, tipo }; mostrarLogin(j.erro); return; }
      if (!resp.ok) { estado(atual ? 'resultado' : 'inicio'); mostrar('erro', j.erro || `Não foi possível consultar ${T.artigo}.`); return; }
      j.tipo = tipo;
      atual = j;
      abertos.clear();
      $('filtro').value = '';
      if (!j.totalRolos) {
        atual = null;
        window.romaneioAtual = null;
        document.dispatchEvent(new CustomEvent('romaneio:carregado'));
        estado('inicio');
        mostrar('erro', tipo === 'op' ? `Nenhum rolo encontrado para a OP ${j.numero}. Confira o número.` : `Nenhum rolo encontrado no romaneio ${j.numero}. Confira o número.`);
        return;
      }
      salvarHistorico(j.numero, tipo);
      if (j.aviso) mostrar('aviso', j.aviso);
      // A conferência com packing list vale só para romaneio
      window.romaneioAtual = tipo === 'romaneio' ? j : null;
      $('conferencia').hidden = tipo !== 'romaneio';
      document.dispatchEvent(new CustomEvent('romaneio:carregado'));
      renderTudo();
      estado('resultado');
      document.title = `${T.nome} ${j.numero} · Consulta de Romaneio - Importação`;
    } catch (e) {
      if (id !== consultaId) return;
      estado(atual ? 'resultado' : 'inicio');
      mostrar('erro', 'O servidor do site não respondeu. Confira se a janela do servidor (iniciar.bat) está aberta.');
    } finally {
      if (id === consultaId) { $('btnBuscar').disabled = false; $('btnBuscar').querySelector('span').textContent = 'Buscar'; }
    }
  }
  $('busca').addEventListener('submit', (e) => { e.preventDefault(); buscar(); });

  // ---------- Render ----------
  function produtosVisiveis() {
    const f = $('filtro').value.trim().toLowerCase();
    let l = atual.produtos.filter((p) => !f || p.codigo.toLowerCase().includes(f) || p.descricao.toLowerCase().includes(f));
    const { col, asc } = ordem;
    l = l.slice().sort((a, b) => {
      const r = typeof a[col] === 'number' ? a[col] - b[col] : String(a[col]).localeCompare(String(b[col]), 'pt-BR', { numeric: true });
      return asc ? r : -r;
    });
    return l;
  }

  function renderTudo() {
    const j = atual;
    const porOP = j.tipo === 'op';
    $('rRotulo').textContent = TIPOS[j.tipo].nome;
    $('rNumero').textContent = j.numero;
    $('thPart').textContent = porOP ? '% da OP' : '% do romaneio';
    const quando = new Date(j.consultadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const roms = porOP ? (j.romaneios || []) : [];
    $('rMeta').innerHTML = (roms.length ? `<span>${roms.length === 1 ? 'Romaneio' : `${roms.length} romaneios`}: ${roms.map((r) => `<a href="?r=${encodeURIComponent(r)}" data-rom="${esc(r)}">${esc(r)}</a>`).join(', ')}</span> · ` : '')
      + `<span>Consultado em ${esc(quando)}</span>`;
    $('sQtd').textContent = kg(j.totalQuantidade);
    $('sRolos').textContent = int(j.totalRolos);
    $('sProdutos').textContent = int(j.produtos.length);
    $('sMedia').textContent = kg(j.totalRolos ? j.totalQuantidade / j.totalRolos : 0);
    renderTabela();
  }

  const SETA = '<svg class="seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderTabela() {
    const lista = produtosVisiveis();
    const porOP = atual.tipo === 'op';
    const total = atual.totalQuantidade || 1;
    const maior = Math.max(...atual.produtos.map((p) => p.quantidade), 1);

    document.querySelectorAll('.tabela thead th[data-ordem]').forEach((th) => {
      th.querySelector('.seta-ord')?.remove();
      th.removeAttribute('aria-sort');
      if (th.dataset.ordem === ordem.col) {
        th.insertAdjacentHTML('beforeend', `<span class="seta-ord">${ordem.asc ? '▲' : '▼'}</span>`);
        th.setAttribute('aria-sort', ordem.asc ? 'ascending' : 'descending');
      }
    });

    let h = '';
    if (!lista.length) h = '<tr class="vazio"><td colspan="6">Nenhum produto corresponde ao filtro.</td></tr>';
    for (const p of lista) {
      const aberto = abertos.has(p.codigo);
      const share = (p.quantidade / total) * 100;
      h += `<tr class="prod" tabindex="0" data-cod="${esc(p.codigo)}" aria-expanded="${aberto}">
        <td class="col-seta">${SETA}</td>
        <td class="cod">${p.codigo ? esc(p.codigo) : '<span class="sem">sem código</span>'}</td>
        <td class="desc">${p.descricao ? esc(p.descricao) : '<span class="sem">sem descrição</span>'}</td>
        <td class="n">${int(p.rolos)}</td>
        <td class="n">${kg(p.quantidade)}</td>
        <td class="col-part"><div class="part"><div class="part-barra"><i style="width:${((p.quantidade / maior) * 100).toFixed(1)}%"></i></div><span class="part-num">${pct(share)}</span></div></td>
      </tr>`;
      if (aberto) {
        h += `<tr class="detalhe"><td colspan="6"><div style="overflow-x:auto"><table class="rolos">
          <thead><tr><th>#</th><th>Rolo</th><th>Série</th>${porOP ? '<th>Romaneio</th>' : ''}<th>OP</th><th>Partida</th><th class="n">Qtde atual (kg)</th></tr></thead><tbody>
          ${p.itens.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.numero)}</td><td>${esc(r.serie)}</td>${porOP ? `<td>${esc(r.romaneio)}</td>` : ''}<td>${esc(r.op)}</td><td>${esc(r.partida)}</td><td class="n">${kg(r.quantidade)}</td></tr>`).join('')}
          </tbody></table></div></td></tr>`;
      }
    }
    $('corpo').innerHTML = h;

    const filtrado = lista.length !== atual.produtos.length;
    const sRolos = lista.reduce((s, p) => s + p.rolos, 0);
    const sQtd = lista.reduce((s, p) => s + p.quantidade, 0);
    $('rodape').innerHTML = lista.length ? `<tr><td></td><td colspan="2">${filtrado ? `Total filtrado (${lista.length} de ${atual.produtos.length})` : `Total ${TIPOS[atual.tipo].de}`}</td>
      <td class="n">${int(sRolos)}</td><td class="n">${kg(sQtd)}</td><td class="col-part"><span class="part-num" style="width:auto">${pct((sQtd / total) * 100)}</span></td></tr>` : '';
    $('btnExpandir').textContent = abertos.size && lista.every((p) => abertos.has(p.codigo)) ? 'Fechar todos' : 'Abrir todos';
  }

  function alternar(cod) { abertos.has(cod) ? abertos.delete(cod) : abertos.add(cod); renderTabela(); }
  $('corpo').addEventListener('click', (e) => { const tr = e.target.closest('tr.prod'); if (tr) alternar(tr.dataset.cod); });
  $('corpo').addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr.prod');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); alternar(tr.dataset.cod); document.querySelector(`tr.prod[data-cod="${CSS.escape(tr.dataset.cod)}"]`)?.focus(); }
  });
  document.querySelector('.tabela thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-ordem]'); if (!th) return;
    const col = th.dataset.ordem;
    ordem = { col, asc: ordem.col === col ? !ordem.asc : !(col === 'rolos' || col === 'quantidade') };
    renderTabela();
  });
  $('filtro').addEventListener('input', renderTabela);
  // Na busca por OP, clicar num romaneio do cabeçalho abre esse romaneio
  $('rMeta').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-rom]'); if (!a) return;
    e.preventDefault();
    definirTipo('romaneio'); $('numero').value = a.dataset.rom; buscar();
  });
  $('btnExpandir').addEventListener('click', () => {
    const lista = produtosVisiveis();
    const todos = lista.every((p) => abertos.has(p.codigo));
    lista.forEach((p) => (todos ? abertos.delete(p.codigo) : abertos.add(p.codigo)));
    renderTabela();
  });

  // ---------- Exportar ----------
  const numTxt = (n) => n.toLocaleString('pt-BR', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 3 });
  function linhasExport() {
    return [[TIPOS[atual.tipo].nome, 'Código', 'Produto', 'Rolos', 'Qtde atual (kg)'],
      ...produtosVisiveis().map((p) => [atual.numero, p.codigo, p.descricao, String(p.rolos), numTxt(p.quantidade)])];
  }
  $('btnCopiar').addEventListener('click', async () => {
    const tsv = linhasExport().map((l) => l.join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); toast('Tabela copiada. Cole no Excel com Ctrl+V.'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = tsv; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Tabela copiada. Cole no Excel com Ctrl+V.'); } catch { toast('Não foi possível copiar.'); }
      ta.remove();
    }
  });
  $('btnCsv').addEventListener('click', () => {
    const csv = linhasExport().map((l) => l.map((c) => /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${atual.tipo === 'op' ? 'op' : 'romaneio'}-${atual.numero}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('btnImprimir').addEventListener('click', () => window.print());

  // ---------- Atalhos e início ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('numero').select(); }
  });

  $('rodapeSite').textContent = 'Consulta de Romaneio - Importação - Quatro K Textil LTDA';

  // ---------- Login ----------
  let pendente = null; // consulta { n, tipo } para refazer depois do login
  const CHAVE_USER = 'romaneio.usuario';
  function mostrarLogin(msg) {
    document.body.classList.remove('logado');
    $('usuarioBox').hidden = true;
    ['inicio', 'carregando', 'resultado'].forEach((id) => ($(id).hidden = true));
    mostrar('erro', ''); mostrar('aviso', '');
    $('login').hidden = false;
    $('boasVindas').hidden = true;
    reanimar($('formLogin'), 'entrada');
    mostrar('loginErro', msg || '');
    try { $('loginUsuario').value ||= localStorage.getItem(CHAVE_USER) || ''; } catch {}
    const direto = API.modo === 'direto';
    $('loginServidorBox').hidden = true; // endereço do Protheus fica oculto (vem preenchido)
    $('lembrarBox').hidden = !direto;
    if (direto) $('loginServidor').value ||= API.servidorSalvo();
    (direto && !$('loginServidor').value ? $('loginServidor') : $('loginUsuario').value ? $('loginSenha') : $('loginUsuario')).focus();
  }
  // Reinicia uma animação CSS no elemento
  function reanimar(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  const semAnimacao = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const espera = (ms) => new Promise((ok) => setTimeout(ok, semAnimacao() ? 0 : ms));

  // Login aprovado pelo formulário: o cartão sai, aparece "Bem-vindo" e a tela entra
  async function entrarAnimado(usuario) {
    $('formLogin').classList.add('saida');
    await espera(260);
    $('login').hidden = true;
    $('formLogin').classList.remove('saida');
    $('boasVindasNome').textContent = usuario;
    $('boasVindas').hidden = false;
    reanimar($('boasVindas'), 'mostrar');
    await espera(1100);
    $('boasVindas').hidden = true;
    entrar(usuario);
  }

  function entrar(usuario) {
    document.body.classList.add('logado');
    reanimar(document.body, 'revelar');
    $('login').hidden = true;
    $('usuarioNome').textContent = usuario;
    $('usuarioBox').hidden = false;
    $('loginSenha').value = '';
    mostrarHistorico();
    const q = new URLSearchParams(location.search);
    const alvo = pendente || (q.get('op') ? { n: q.get('op'), tipo: 'op' } : q.get('r') ? { n: q.get('r'), tipo: 'romaneio' } : null);
    pendente = null;
    if (alvo) { definirTipo(alvo.tipo); $('numero').value = alvo.n; buscar(); }
    else { estado(atual ? 'resultado' : 'inicio'); $('numero').focus(); }
  }
  $('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('loginUsuario').value.trim(), senha = $('loginSenha').value;
    if (!usuario || !senha) return;
    if (API.modo === 'direto' && !$('loginServidor').value.trim()) { mostrar('loginErro', 'Informe o endereço do Protheus.'); $('loginServidor').focus(); return; }
    $('btnEntrar').disabled = true; $('btnEntrar').textContent = 'Entrando…'; mostrar('loginErro', '');
    try {
      const r = await API.login(usuario, senha, $('loginServidor').value, $('lembrar').checked);
      const j = r.j;
      if (!r.ok) { mostrar('loginErro', j.erro || 'Não foi possível entrar.'); $('loginSenha').select(); return; }
      try { localStorage.setItem(CHAVE_USER, usuario); } catch {}
      await entrarAnimado(j.usuario);
    } catch {
      mostrar('loginErro', API.modo === 'direto' ? 'Não foi possível entrar.' : 'O servidor do site não respondeu. Confira se ele está aberto.');
    } finally { $('btnEntrar').disabled = false; $('btnEntrar').textContent = 'Entrar'; }
  });
  $('verSenha').addEventListener('click', () => {
    const s = $('loginSenha'); const ver = s.type === 'password';
    s.type = ver ? 'text' : 'password'; $('verSenha').textContent = ver ? 'Ocultar' : 'Mostrar'; s.focus();
  });
  $('btnSair').addEventListener('click', async () => {
    await API.logout();
    atual = null; window.romaneioAtual = null;
    document.dispatchEvent(new CustomEvent('romaneio:carregado'));
    history.replaceState(null, '', location.pathname);
    mostrarLogin();
  });

  // ---------- Instalar como app ----------
  let pedidoInstalar = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalar = e; $('btnInstalar').hidden = false; });
  window.addEventListener('appinstalled', () => { $('btnInstalar').hidden = true; toast('App instalado. Procure "Consulta de Romaneio" na área de trabalho ou no menu Iniciar.'); });
  $('btnInstalar').addEventListener('click', async () => { if (!pedidoInstalar) return; pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; $('btnInstalar').hidden = true; });
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});

  API.status().then((s) => {
    if (!s.configurado) { mostrarLogin('O endereço do Protheus não foi configurado. Preencha PROTHEUS_URL no arquivo .env e reinicie o servidor.'); return; }
    s.logado ? entrar(s.usuario) : mostrarLogin();
  }).catch(() => mostrarLogin('O servidor do site não respondeu. Confira se ele está aberto.'));
})();
