// Impressão de relatórios (romaneio/OP e divergências)
// - Janela de opções com prévia ao vivo antes de imprimir (título, observação,
//   o que incluir, orientação, tamanho da letra). As escolhas ficam guardadas.
// - Monta o relatório no #relatorio, com o cabeçalho da empresa (logo do Grupo
//   Quatro K), espera a logo carregar e imprime só ele. Também atende ao Ctrl+P.
(() => {
  const EMPRESA = 'Quatro K Textil LTDA';
  const LOGO = 'logo-quatrok.png';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agora = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  // Logo carregada uma vez no início (fica em cache e pronta para o PNG em canvas)
  const logo = new Image();
  logo.src = LOGO;
  const logoPronta = (logo.decode ? logo.decode() : new Promise((ok, erro) => { logo.onload = ok; logo.onerror = erro; }))
    .then(() => logo).catch(() => null);

  // ---------- HTML do relatório ----------
  // o = { titulo, subtitulo, observacao, resumo: [[rótulo, valor]], corpo (HTML), nota,
  //       assinaturas: [..], paisagem, fonte: 'p'|'n'|'g', arquivo }
  const classes = (o) => 'relatorio' + (o.paisagem ? ' paisagem' : '') + (o.fonte && o.fonte !== 'n' ? ` rel-fonte-${o.fonte}` : '');
  function html(o) {
    const usuario = document.getElementById('usuarioNome')?.textContent.trim();
    return `
      <header class="rel-cab">
        <img class="rel-logo" src="${LOGO}" alt="Grupo Quatro K">
        <div class="rel-tit">
          <h1>${esc(o.titulo)}</h1>
          ${o.subtitulo ? `<div class="rel-sub">${o.subtitulo}</div>` : ''}
        </div>
        <dl class="rel-meta">
          <div><dt>Emitido em</dt><dd>${esc(agora())}</dd></div>
          ${usuario ? `<div><dt>Emitido por</dt><dd>${esc(usuario)}</dd></div>` : ''}
        </dl>
      </header>
      ${o.observacao ? `<div class="rel-obs"><b>Observação</b><p>${esc(o.observacao).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${o.resumo?.length ? `<div class="rel-resumo">${o.resumo.map(([a, b]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>` : ''}
      ${o.corpo}
      ${o.nota ? `<p class="rel-nota">${esc(o.nota)}</p>` : ''}
      ${o.assinaturas?.length ? `<div class="rel-assin">${o.assinaturas.map((a) => `<div><i></i><span>${esc(a)}</span></div>`).join('')}</div>` : ''}
      <footer class="rel-rodape"><span>${EMPRESA} · Consulta de Romaneio - Importação</span></footer>`;
  }

  let tituloOriginal = null;
  function limpar() {
    document.body.classList.remove('imprimir-rel');
    const r = document.getElementById('relatorio');
    if (r) { r.className = 'relatorio'; r.innerHTML = ''; }
    if (tituloOriginal != null) { document.title = tituloOriginal; tituloOriginal = null; }
  }
  function montar(o) {
    const r = document.getElementById('relatorio');
    r.className = classes(o);
    r.innerHTML = html(o);
    document.body.classList.add('imprimir-rel');
    if (o.arquivo) { tituloOriginal ??= document.title; document.title = o.arquivo; } // nome sugerido do PDF
    return r;
  }

  // Monta, espera a logo e imprime
  let imprimindoPeloBotao = false;
  async function imprimir(o) {
    const r = montar(o);
    const img = r.querySelector('.rel-logo');
    try { await Promise.race([img.decode ? img.decode() : Promise.resolve(), new Promise((ok) => setTimeout(ok, 1500))]); } catch { img.remove(); }
    try { await document.fonts?.ready; } catch {}
    imprimindoPeloBotao = true;
    window.print();
  }

  // ---------- Opções de impressão ----------
  // cfg = { chave, janela, tituloPadrao, paisagem, campos: [...], gerar: (op) => o }
  // campo = { id, tipo: 'texto'|'area'|'radio'|'check'|'checks', rotulo, padrao, opcoes: [[valor, rótulo, desativado]], salvar }
  function campos(cfg) {
    return [
      { id: 'titulo', tipo: 'texto', rotulo: 'Título', padrao: cfg.tituloPadrao, salvar: false, secao: 'Cabeçalho' },
      { id: 'observacao', tipo: 'area', rotulo: 'Observação', dica: 'Sai abaixo do título. Opcional.', padrao: '', salvar: false },
      ...cfg.campos.map((c, i) => (i === 0 ? { secao: 'Conteúdo', ...c } : c)),
      { id: 'resumo', tipo: 'check', rotulo: 'Quadro de totais', padrao: true },
      { id: 'assinaturas', tipo: 'check', rotulo: 'Linhas de assinatura', padrao: true },
      { id: 'orientacao', tipo: 'radio', rotulo: 'Orientação', padrao: cfg.paisagem ? 'paisagem' : 'retrato', secao: 'Página', linha: true,
        opcoes: [['retrato', 'Em pé'], ['paisagem', 'Deitado']] },
      { id: 'fonte', tipo: 'radio', rotulo: 'Tamanho da letra', padrao: 'n', linha: true,
        opcoes: [['p', 'Pequena'], ['n', 'Normal'], ['g', 'Grande']] },
    ];
  }
  const chaveSalva = (cfg) => `romaneio.impressao.${cfg.chave}`;
  function lerSalvas(cfg) { try { return JSON.parse(localStorage.getItem(chaveSalva(cfg)) || '{}') || {}; } catch { return {}; } }

  // Valores iniciais: padrão de cada campo, trocados pelos guardados quando ainda valem
  function opcoesSalvas(cfg) {
    const salvas = lerSalvas(cfg), op = {};
    for (const c of campos(cfg)) {
      let v = c.salvar === false ? undefined : salvas[c.id];
      const validos = c.opcoes?.filter((x) => !x[2]).map((x) => x[0]);
      if (c.tipo === 'radio' && !validos.includes(v)) v = undefined;
      if (c.tipo === 'checks') v = Array.isArray(v) ? v.filter((x) => validos.includes(x)) : undefined;
      if (c.tipo === 'check' && typeof v !== 'boolean') v = undefined;
      op[c.id] = v ?? c.padrao;
    }
    return op;
  }
  function guardar(cfg, op) {
    const s = {};
    for (const c of campos(cfg)) if (c.salvar !== false) s[c.id] = op[c.id];
    try { localStorage.setItem(chaveSalva(cfg), JSON.stringify(s)); } catch {}
  }

  // Aplica as opções comuns sobre o relatório gerado
  function preparar(cfg, op) {
    const o = cfg.gerar(op);
    o.titulo = op.titulo?.trim() || o.titulo;
    o.observacao = op.observacao?.trim() || '';
    o.paisagem = op.orientacao === 'paisagem';
    o.fonte = op.fonte;
    if (!op.resumo) o.resumo = [];
    if (!op.assinaturas) o.assinaturas = [];
    return o;
  }

  function campoHtml(c, v) {
    const sec = c.secao ? `<h3 class="imp-secao">${esc(c.secao)}</h3>` : '';
    const dica = c.dica ? `<small>${esc(c.dica)}</small>` : '';
    if (c.tipo === 'texto') return `${sec}<label class="imp-campo"><span>${esc(c.rotulo)}</span><input type="text" name="${c.id}" value="${esc(v)}" maxlength="120"></label>`;
    if (c.tipo === 'area') return `${sec}<label class="imp-campo"><span>${esc(c.rotulo)}</span><textarea name="${c.id}" rows="2" maxlength="600">${esc(v)}</textarea>${dica}</label>`;
    if (c.tipo === 'check') return `${sec}<label class="imp-opc"><input type="checkbox" name="${c.id}" ${v ? 'checked' : ''}> ${esc(c.rotulo)}</label>`;
    const tipo = c.tipo === 'radio' ? 'radio' : 'checkbox';
    const marcado = (val) => (tipo === 'radio' ? v === val : v.includes(val));
    return `${sec}<fieldset class="imp-grupo${c.linha ? ' em-linha' : ''}"><legend>${esc(c.rotulo)}</legend><div>${c.opcoes.map(([val, rot, desat]) =>
      `<label class="imp-opc${desat ? ' desat' : ''}"><input type="${tipo}" name="${c.id}" value="${esc(val)}" ${marcado(val) && !desat ? 'checked' : ''} ${desat ? 'disabled' : ''}> ${esc(rot)}</label>`).join('')}</div>${dica}</fieldset>`;
  }
  function lerForm(cfg, form) {
    const op = {};
    for (const c of campos(cfg)) {
      if (c.tipo === 'texto' || c.tipo === 'area') op[c.id] = form.elements[c.id].value;
      else if (c.tipo === 'check') op[c.id] = form.elements[c.id].checked;
      else if (c.tipo === 'radio') op[c.id] = form.querySelector(`input[name="${c.id}"]:checked`)?.value ?? c.padrao;
      else op[c.id] = [...form.querySelectorAll(`input[name="${c.id}"]:checked`)].map((i) => i.value);
    }
    return op;
  }

  let dlg = null, cfgAtual = null, tPrevia = 0;
  function criarJanela() {
    dlg = document.createElement('dialog');
    dlg.className = 'imp-dlg';
    dlg.setAttribute('aria-labelledby', 'impTit');
    dlg.innerHTML = `
      <form class="imp-form" novalidate>
        <header class="imp-cab">
          <h2 id="impTit"></h2>
          <button type="button" class="imp-x" data-acao="cancelar" aria-label="Fechar">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="imp-corpo">
          <div class="imp-opcoes"></div>
          <div class="imp-previa">
            <div class="imp-previa-rot">Prévia <small id="impPaginas"></small></div>
            <div class="imp-previa-area"><div class="imp-folha-wrap"><div class="imp-folha"></div></div></div>
          </div>
        </div>
        <footer class="imp-rodape">
          <button type="button" class="btn-sec" data-acao="restaurar">Restaurar padrão</button>
          <span class="imp-esp">Em seguida abre a tela do navegador para escolher a impressora ou "Salvar como PDF".</span>
          <button type="button" class="btn-sec" data-acao="cancelar">Cancelar</button>
          <button type="submit" class="btn-pri">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 14h10v6H7z"/></svg>
            Continuar
          </button>
        </footer>
      </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    form.addEventListener('input', agendarPrevia);
    form.addEventListener('change', agendarPrevia);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const op = lerForm(cfgAtual, form);
      guardar(cfgAtual, op);
      const o = preparar(cfgAtual, op);
      dlg.close();
      imprimir(o);
    });
    dlg.addEventListener('click', (e) => {
      const acao = e.target.closest('[data-acao]')?.dataset.acao;
      if (acao === 'cancelar') dlg.close();
      if (acao === 'restaurar') {
        try { localStorage.removeItem(chaveSalva(cfgAtual)); } catch {}
        preencher(cfgAtual, opcoesSalvas(cfgAtual));
      }
      if (e.target === dlg) dlg.close(); // clique fora da janela
    });
    window.addEventListener('resize', () => dlg.open && escalarPrevia());
  }
  function preencher(cfg, op) {
    dlg.querySelector('.imp-opcoes').innerHTML = campos(cfg).map((c) => campoHtml(c, op[c.id])).join('');
    previa();
  }
  function agendarPrevia() { clearTimeout(tPrevia); tPrevia = setTimeout(previa, 120); }
  function previa() {
    const op = lerForm(cfgAtual, dlg.querySelector('form'));
    const o = preparar(cfgAtual, op);
    const folha = dlg.querySelector('.imp-folha');
    folha.classList.toggle('paisagem', !!o.paisagem);
    folha.innerHTML = `<div class="${classes(o)}">${html(o)}</div>`;
    escalarPrevia();
  }
  // Encaixa a folha (tamanho real em mm) na largura da área de prévia
  function escalarPrevia() {
    const area = dlg.querySelector('.imp-previa-area'), wrap = dlg.querySelector('.imp-folha-wrap'), folha = dlg.querySelector('.imp-folha');
    folha.style.transform = 'none';
    const s = Math.min(1, (area.clientWidth - 32) / folha.offsetWidth);
    folha.style.transform = `scale(${s})`;
    wrap.style.width = folha.offsetWidth * s + 'px';
    wrap.style.height = folha.offsetHeight * s + 'px';
    // Estimativa de páginas: altura do conteúdo ÷ altura útil da folha
    const util = (folha.classList.contains('paisagem') ? 210 - 23 : 297 - 26) * 96 / 25.4;
    const conteudo = folha.firstElementChild.getBoundingClientRect().height / s;
    const n = Math.max(1, Math.ceil(conteudo / util));
    document.getElementById('impPaginas').textContent = `· cerca de ${n} ${n === 1 ? 'página' : 'páginas'}`;
  }

  function abrirOpcoes(cfg) {
    if (!cfg) return;
    if (!dlg) criarJanela();
    if (typeof dlg.showModal !== 'function') { imprimir(preparar(cfg, opcoesSalvas(cfg))); return; } // navegador antigo
    cfgAtual = cfg;
    dlg.querySelector('#impTit').textContent = cfg.janela;
    dlg.showModal();
    preencher(cfg, opcoesSalvas(cfg));
    dlg.querySelector('.imp-form button[type="submit"]').focus();
  }

  // Ctrl+P / menu do navegador: monta o relatório padrão (romaneio) com as últimas opções
  window.addEventListener('beforeprint', () => {
    if (imprimindoPeloBotao || document.body.classList.contains('imprimir-rel')) return;
    if (dlg?.open) dlg.close();
    const cfg = Impressao.padrao?.();
    if (cfg) montar(preparar(cfg, opcoesSalvas(cfg)));
  });
  window.addEventListener('afterprint', () => { imprimindoPeloBotao = false; limpar(); });

  const Impressao = window.Impressao = { EMPRESA, LOGO, esc, agora, logoPronta, imprimir, abrirOpcoes, opcoesSalvas, preparar, padrao: null };
})();
