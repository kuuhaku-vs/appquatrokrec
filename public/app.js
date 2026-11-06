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

  // ---------- Recentes ----------
  const CHAVE_REC = 'romaneio.recentes';
  function lerRecentes() { try { return JSON.parse(localStorage.getItem(CHAVE_REC) || '[]'); } catch { return []; } }
  function salvarRecente(n) {
    const l = [n, ...lerRecentes().filter((x) => x !== n)].slice(0, 6);
    try { localStorage.setItem(CHAVE_REC, JSON.stringify(l)); } catch {}
    mostrarRecentes();
  }
  function mostrarRecentes() {
    const l = lerRecentes();
    const box = $('recentes');
    box.hidden = !l.length;
    box.innerHTML = l.length ? '<span>Recentes:</span>' + l.map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join('') : '';
  }
  $('recentes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (!b) return;
    $('numero').value = b.dataset.n;
    buscar();
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

  // ---------- Busca ----------
  async function buscar() {
    let numero = $('numero').value.trim().toUpperCase();
    const filial = $('filial').value.trim();
    if (!numero) { $('numero').focus(); return; }
    if (/^\d+$/.test(numero)) numero = numero.padStart(8, '0');
    $('numero').value = numero;

    const id = ++consultaId;
    mostrar('erro', ''); mostrar('aviso', '');
    $('btnBuscar').disabled = true; $('btnBuscar').querySelector('span').textContent = 'Buscando…';
    estado('carregando');

    const url = new URL(location.href);
    url.searchParams.set('r', numero);
    filial ? url.searchParams.set('f', filial) : url.searchParams.delete('f');
    history.replaceState(null, '', url);

    try {
      const resp = await fetch('/api/romaneio?' + new URLSearchParams({ numero, filial }));
      const j = await resp.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
      if (id !== consultaId) return;
      if (resp.status === 401 && j.login) { pendente = numero; mostrarLogin(j.erro); return; }
      if (!resp.ok) { estado(atual ? 'resultado' : 'inicio'); mostrar('erro', j.erro || 'Não foi possível consultar o romaneio.'); return; }
      atual = j;
      abertos.clear();
      $('filtro').value = '';
      salvarRecente(j.numero);
      if (!j.totalRolos) {
        atual = null;
        estado('inicio');
        mostrar('erro', `Nenhum rolo encontrado no romaneio ${j.numero}${filial ? ' na filial ' + filial : ''}. Confira o número.`);
        return;
      }
      if (j.aviso) mostrar('aviso', j.aviso);
      window.romaneioAtual = j;
      document.dispatchEvent(new CustomEvent('romaneio:carregado'));
      renderTudo();
      estado('resultado');
      document.title = `Romaneio ${j.numero} · Consulta de Romaneio`;
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
    $('rNumero').textContent = j.numero;
    const quando = new Date(j.consultadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    $('rMeta').innerHTML = [
      j.filial ? `Filial ${esc(j.filial)}` : '',
      j.totalOPs ? `${int(j.totalOPs)} ${j.totalOPs === 1 ? 'ordem de produção' : 'ordens de produção'}` : '',
      `Consultado em ${esc(quando)}`,
    ].filter(Boolean).map((t) => `<span>${t}</span>`).join('');
    $('sQtd').textContent = kg(j.totalQuantidade);
    $('sRolos').textContent = int(j.totalRolos);
    $('sProdutos').textContent = int(j.produtos.length);
    $('sMedia').textContent = kg(j.totalRolos ? j.totalQuantidade / j.totalRolos : 0);
    renderTabela();
  }

  const SETA = '<svg class="seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderTabela() {
    const lista = produtosVisiveis();
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
          <thead><tr><th>#</th><th>Rolo</th><th>Série</th><th>OP</th><th>Partida</th><th class="n">Qtde atual (kg)</th></tr></thead><tbody>
          ${p.itens.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.numero)}</td><td>${esc(r.serie)}</td><td>${esc(r.op)}</td><td>${esc(r.partida)}</td><td class="n">${kg(r.quantidade)}</td></tr>`).join('')}
          </tbody></table></div></td></tr>`;
      }
    }
    $('corpo').innerHTML = h;

    const filtrado = lista.length !== atual.produtos.length;
    const sRolos = lista.reduce((s, p) => s + p.rolos, 0);
    const sQtd = lista.reduce((s, p) => s + p.quantidade, 0);
    $('rodape').innerHTML = lista.length ? `<tr><td></td><td colspan="2">${filtrado ? `Total filtrado (${lista.length} de ${atual.produtos.length})` : 'Total do romaneio'}</td>
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
  $('btnExpandir').addEventListener('click', () => {
    const lista = produtosVisiveis();
    const todos = lista.every((p) => abertos.has(p.codigo));
    lista.forEach((p) => (todos ? abertos.delete(p.codigo) : abertos.add(p.codigo)));
    renderTabela();
  });

  // ---------- Exportar ----------
  const numTxt = (n) => n.toLocaleString('pt-BR', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 3 });
  function linhasExport() {
    return [['Romaneio', 'Código', 'Produto', 'Rolos', 'Qtde atual (kg)'],
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
    a.href = URL.createObjectURL(blob); a.download = `romaneio-${atual.numero}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('btnImprimir').addEventListener('click', () => window.print());

  // ---------- Atalhos e início ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('numero').select(); }
  });

  $('rodapeSite').textContent = 'Dados da tabela SZ5 (rolos) e SB1 (produtos) do Protheus, consultados na hora da busca.';

  // ---------- Login ----------
  let pendente = null; // romaneio para buscar depois do login
  const CHAVE_USER = 'romaneio.usuario';
  function mostrarLogin(msg) {
    document.body.classList.remove('logado');
    $('usuarioBox').hidden = true;
    ['inicio', 'carregando', 'resultado'].forEach((id) => ($(id).hidden = true));
    mostrar('erro', ''); mostrar('aviso', '');
    $('login').hidden = false;
    mostrar('loginErro', msg || '');
    try { $('loginUsuario').value ||= localStorage.getItem(CHAVE_USER) || ''; } catch {}
    ($('loginUsuario').value ? $('loginSenha') : $('loginUsuario')).focus();
  }
  function entrar(usuario) {
    document.body.classList.add('logado');
    $('login').hidden = true;
    $('usuarioNome').textContent = usuario;
    $('usuarioBox').hidden = false;
    $('loginSenha').value = '';
    mostrarRecentes();
    const q = new URLSearchParams(location.search);
    if (q.get('f')) $('filial').value = q.get('f');
    const n = pendente || q.get('r');
    pendente = null;
    if (n) { $('numero').value = n; buscar(); }
    else { estado(atual ? 'resultado' : 'inicio'); $('numero').focus(); }
  }
  $('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('loginUsuario').value.trim(), senha = $('loginSenha').value;
    if (!usuario || !senha) return;
    $('btnEntrar').disabled = true; $('btnEntrar').textContent = 'Entrando…'; mostrar('loginErro', '');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, senha }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { mostrar('loginErro', j.erro || 'Não foi possível entrar.'); $('loginSenha').select(); return; }
      try { localStorage.setItem(CHAVE_USER, usuario); } catch {}
      entrar(j.usuario);
    } catch {
      mostrar('loginErro', 'O servidor do site não respondeu. Confira se ele está aberto.');
    } finally { $('btnEntrar').disabled = false; $('btnEntrar').textContent = 'Entrar'; }
  });
  $('verSenha').addEventListener('click', () => {
    const s = $('loginSenha'); const ver = s.type === 'password';
    s.type = ver ? 'text' : 'password'; $('verSenha').textContent = ver ? 'Ocultar' : 'Mostrar'; s.focus();
  });
  $('btnSair').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
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
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

  fetch('/api/status').then((r) => r.json()).then((s) => {
    if (!s.configurado) { mostrarLogin('O endereço do Protheus não foi configurado. Preencha PROTHEUS_URL no arquivo .env e reinicie o servidor.'); return; }
    s.logado ? entrar(s.usuario) : mostrarLogin();
  }).catch(() => mostrarLogin('O servidor do site não respondeu. Confira se ele está aberto.'));
})();
