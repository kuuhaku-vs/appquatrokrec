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
  const selecionados = new Set(); // códigos marcados para imprimir
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
      selecionados.clear();
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
    return ordenar(atual.produtos.filter((p) => !f || p.codigo.toLowerCase().includes(f) || p.descricao.toLowerCase().includes(f)));
  }
  function ordenar(l) {
    const { col, asc } = ordem;
    return l.slice().sort((a, b) => {
      const r = typeof a[col] === 'number' ? a[col] - b[col] : String(a[col]).localeCompare(String(b[col]), 'pt-BR', { numeric: true });
      return asc ? r : -r;
    });
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
    if (!lista.length) h = '<tr class="vazio"><td colspan="7">Nenhum produto corresponde ao filtro.</td></tr>';
    for (const p of lista) {
      const aberto = abertos.has(p.codigo);
      const share = (p.quantidade / total) * 100;
      h += `<tr class="prod${selecionados.has(p.codigo) ? ' sel' : ''}" tabindex="0" data-cod="${esc(p.codigo)}" aria-expanded="${aberto}">
        <td class="col-sel"><label><input type="checkbox" class="sel" ${selecionados.has(p.codigo) ? 'checked' : ''} aria-label="Selecionar ${esc(p.codigo || p.descricao)} para imprimir"></label></td>
        <td class="col-seta">${SETA}</td>
        <td class="cod">${p.codigo ? esc(p.codigo) : '<span class="sem">sem código</span>'}</td>
        <td class="desc">${p.descricao ? esc(p.descricao) : '<span class="sem">sem descrição</span>'}</td>
        <td class="n">${int(p.rolos)}</td>
        <td class="n">${kg(p.quantidade)}</td>
        <td class="col-part"><div class="part"><div class="part-barra"><i style="width:${((p.quantidade / maior) * 100).toFixed(1)}%"></i></div><span class="part-num">${pct(share)}</span></div></td>
      </tr>`;
      if (aberto) {
        h += `<tr class="detalhe"><td colspan="7"><div style="overflow-x:auto"><table class="rolos">
          <thead><tr><th>#</th><th>RG</th>${porOP ? '<th>Romaneio</th>' : ''}<th>OP</th><th>Partida</th><th>Endereço</th><th class="n">Qtde atual (kg)</th></tr></thead><tbody>
          ${p.itens.map((r, i) => `<tr><td>${i + 1}</td><td class="rg">${esc(r.rg ?? `${r.serie || ''}${r.numero || ''}`)}</td>${porOP ? `<td>${esc(r.romaneio)}</td>` : ''}<td>${esc(r.op)}</td><td>${esc(r.partida)}</td><td>${r.endereco ? esc(r.endereco) : '<span class="sem">sem endereço</span>'}</td><td class="n">${kg(r.quantidade)}</td></tr>`).join('')}
          </tbody></table></div></td></tr>`;
      }
    }
    $('corpo').innerHTML = h;

    const filtrado = lista.length !== atual.produtos.length;
    const sRolos = lista.reduce((s, p) => s + p.rolos, 0);
    const sQtd = lista.reduce((s, p) => s + p.quantidade, 0);
    $('rodape').innerHTML = lista.length ? `<tr><td class="col-sel"></td><td></td><td colspan="2">${filtrado ? `Total filtrado (${lista.length} de ${atual.produtos.length})` : `Total ${TIPOS[atual.tipo].de}`}</td>
      <td class="n">${int(sRolos)}</td><td class="n">${kg(sQtd)}</td><td class="col-part"><span class="part-num" style="width:auto">${pct((sQtd / total) * 100)}</span></td></tr>` : '';
    $('btnExpandir').textContent = abertos.size && lista.every((p) => abertos.has(p.codigo)) ? 'Fechar todos' : 'Abrir todos';
    atualizarSelecao();
  }

  // ---------- Seleção para imprimir ----------
  function atualizarSelecao() {
    if (!atual) return;
    const lista = produtosVisiveis();
    const marcados = lista.filter((p) => selecionados.has(p.codigo)).length;
    const todos = $('selTodos');
    todos.checked = !!lista.length && marcados === lista.length;
    todos.indeterminate = marcados > 0 && marcados < lista.length;
    $('selInfo').hidden = !selecionados.size;
    $('selQtd').textContent = selecionados.size === 1 ? '1 selecionado' : `${int(selecionados.size)} selecionados`;
    $('btnImprimir').textContent = selecionados.size ? `Imprimir seleção (${int(selecionados.size)})` : 'Imprimir';
  }
  $('corpo').addEventListener('change', (e) => {
    if (!e.target.matches('input.sel')) return;
    const tr = e.target.closest('tr.prod');
    e.target.checked ? selecionados.add(tr.dataset.cod) : selecionados.delete(tr.dataset.cod);
    tr.classList.toggle('sel', e.target.checked);
    atualizarSelecao();
  });
  $('selTodos').addEventListener('change', (e) => {
    produtosVisiveis().forEach((p) => (e.target.checked ? selecionados.add(p.codigo) : selecionados.delete(p.codigo)));
    renderTabela();
  });
  $('selLimpar').addEventListener('click', () => { selecionados.clear(); renderTabela(); });

  function alternar(cod) { abertos.has(cod) ? abertos.delete(cod) : abertos.add(cod); renderTabela(); }
  $('corpo').addEventListener('click', (e) => { if (e.target.closest('.col-sel')) return; const tr = e.target.closest('tr.prod'); if (tr) alternar(tr.dataset.cod); });
  $('corpo').addEventListener('keydown', (e) => {
    if (e.target.matches('input')) return;
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
  // ---------- Imprimir ----------
  // Relatório próprio para papel: cabeçalho com a logo, totais e tabela de produtos.
  // As opções (seleção, rolos, colunas...) vêm da janela de impressão.
  function relatorioRomaneio(op) {
    const j = atual, T = TIPOS[j.tipo], porOP = j.tipo === 'op';
    const visiveis = produtosVisiveis();
    const soSel = op.produtos === 'selecionados' && selecionados.size;
    const lista = soSel ? ordenar(j.produtos.filter((p) => selecionados.has(p.codigo))) : visiveis;
    const total = j.totalQuantidade || 1;
    const filtro = $('filtro').value.trim();
    const parcial = lista.length !== j.produtos.length;
    const comPct = op.pct !== false;
    const comRolos = (p) => op.rolos === 'todos' || (op.rolos === 'abertos' && abertos.has(p.codigo));
    const sRolos = lista.reduce((s, p) => s + p.rolos, 0);
    const sQtd = lista.reduce((s, p) => s + p.quantidade, 0);
    const quando = new Date(j.consultadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const roms = porOP ? (j.romaneios || []) : [];
    const sub = [
      roms.length ? `${roms.length === 1 ? 'Romaneio' : 'Romaneios'}: ${esc(roms.join(', '))}` : '',
      `Consultado no Protheus em ${esc(quando)}`,
      soSel ? `Seleção: ${int(lista.length)} de ${int(j.produtos.length)} produtos`
        : parcial ? `Filtro “${esc(filtro)}”: ${int(lista.length)} de ${int(j.produtos.length)} produtos` : '',
    ].filter(Boolean).join(' · ');

    const nCols = comPct ? 5 : 4;
    let linhas = '';
    for (const p of lista) {
      linhas += `<tr class="prod">
        <td class="cod">${esc(p.codigo || '–')}</td>
        <td>${esc(p.descricao || 'sem descrição')}</td>
        <td class="n">${int(p.rolos)}</td>
        <td class="n dest">${kg(p.quantidade)}</td>
        ${comPct ? `<td class="n">${pct((p.quantidade / total) * 100)}</td>` : ''}</tr>`;
      if (comRolos(p) && p.itens?.length) {
        // Cada rolo é uma linha da tabela principal: a lista quebra de página
        // normalmente, sem empurrar o bloco inteiro para a folha seguinte
        const g = porOP ? 'grid-op' : '';
        const n = p.itens.length;
        linhas += `<tr class="rolo rolo-cab"><td colspan="${nCols}"><div class="rel-rolo ${g}"><span class="n">#</span><span>RG</span>${porOP ? '<span>Romaneio</span>' : ''}<span>OP</span><span>Partida</span><span>Endereço</span><span class="n">Qtde (kg)</span></div></td></tr>`;
        linhas += p.itens.map((r, i) => `<tr class="rolo${i === n - 1 ? ' rolo-fim' : ''}"><td colspan="${nCols}"><div class="rel-rolo ${g}"><span class="n">${i + 1}</span><span class="cod">${esc(r.rg ?? `${r.serie || ''}${r.numero || ''}`)}</span>${porOP ? `<span>${esc(r.romaneio)}</span>` : ''}<span>${esc(r.op)}</span><span>${esc(r.partida)}</span><span>${esc(r.endereco || '–')}</span><span class="n">${kg(r.quantidade)}</span></div></td></tr>`).join('');
      }
    }
    if (!lista.length) linhas = `<tr><td colspan="${nCols}">Nenhum produto para imprimir.</td></tr>`;
    const nenhumAberto = op.rolos === 'abertos' && !lista.some((p) => abertos.has(p.codigo));

    return {
      titulo: `${T.nome} ${j.numero}`,
      subtitulo: sub,
      resumo: [
        ['Qtde atual', `${kg(sQtd)} kg`],
        ['Rolos', int(sRolos)],
        ['Produtos', int(lista.length)],
        ['Média por rolo', `${kg(sRolos ? sQtd / sRolos : 0)} kg`],
      ],
      corpo: `<table class="rel-tab rel-tab-rom">
        <colgroup><col style="width:17%"><col><col style="width:8%"><col style="width:15%">${comPct ? '<col style="width:12%">' : ''}</colgroup>
        <thead><tr><th>Código</th><th>Produto</th><th class="n">Rolos</th><th class="n dest">Qtde atual (kg)</th>${comPct ? `<th class="n">${porOP ? '% da OP' : '% do romaneio'}</th>` : ''}</tr></thead>
        <tbody>${linhas}</tbody>
        ${lista.length ? `<tfoot><tr><td colspan="2">${soSel ? `Total da seleção (${int(lista.length)} de ${int(j.produtos.length)})` : parcial ? `Total filtrado (${int(lista.length)} de ${int(j.produtos.length)})` : `Total ${T.de}`}</td><td class="n">${int(sRolos)}</td><td class="n dest">${kg(sQtd)}</td>${comPct ? `<td class="n">${pct((sQtd / total) * 100)}</td>` : ''}</tr></tfoot>` : ''}
      </table>`,
      nota: nenhumAberto ? 'Os rolos não foram listados porque nenhum produto está aberto na tela. Para listar, escolha "De todos os produtos" em "Rolos de cada produto".' : '',
      assinaturas: ['Conferido por', 'Data'],
      arquivo: `${porOP ? 'op' : 'romaneio'}-${j.numero}`,
    };
  }
  // Opções da janela de impressão do romaneio / OP
  function opcoesRomaneio() {
    if (!atual || $('resultado').hidden) return null;
    const T = TIPOS[atual.tipo], n = produtosVisiveis().length, k = selecionados.size;
    const filtrado = n !== atual.produtos.length;
    return {
      chave: 'romaneio',
      janela: `Imprimir ${T.nome === 'OP' ? 'OP' : 'romaneio'} ${atual.numero}`,
      tituloPadrao: `${T.nome} ${atual.numero}`,
      paisagem: false,
      campos: [
        { id: 'produtos', tipo: 'radio', rotulo: 'Produtos', salvar: false, padrao: k ? 'selecionados' : 'visiveis',
          opcoes: [['visiveis', filtrado ? `Os da tela, com o filtro (${int(n)})` : `Todos (${int(n)})`], ['selecionados', k ? `Só os selecionados (${int(k)})` : 'Só os selecionados (marque na tabela)', !k]] },
        { id: 'rolos', tipo: 'radio', rotulo: 'Rolos de cada produto', padrao: 'abertos',
          opcoes: [['nao', 'Não listar'], ['abertos', `Só dos produtos abertos na tela (${int(abertos.size)})`], ['todos', 'De todos os produtos']] },
        { id: 'pct', tipo: 'check', rotulo: `Coluna "${atual.tipo === 'op' ? '% da OP' : '% do romaneio'}"`, padrao: true },
      ],
      gerar: relatorioRomaneio,
    };
  }
  window.Impressao.padrao = opcoesRomaneio;
  $('btnImprimir').addEventListener('click', () => window.Impressao.abrirOpcoes(opcoesRomaneio()));

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
