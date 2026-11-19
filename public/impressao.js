// Impressão de relatórios (romaneio/OP e divergências)
// Monta o relatório no #relatorio, com o cabeçalho da empresa (logo do Grupo Quatro K),
// espera a logo carregar e imprime só ele. Também atende ao Ctrl+P.
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

  let tituloOriginal = null;
  function limpar() {
    document.body.classList.remove('imprimir-rel');
    const r = document.getElementById('relatorio');
    if (r) { r.className = 'relatorio'; r.innerHTML = ''; }
    if (tituloOriginal != null) { document.title = tituloOriginal; tituloOriginal = null; }
  }

  // Monta o HTML do relatório.
  // o = { titulo, subtitulo, resumo: [[rótulo, valor]], corpo (HTML da tabela), nota, assinaturas: [..], paisagem, arquivo }
  function montar(o) {
    const r = document.getElementById('relatorio');
    const usuario = document.getElementById('usuarioNome')?.textContent.trim();
    r.className = 'relatorio' + (o.paisagem ? ' paisagem' : '');
    r.innerHTML = `
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
      ${o.resumo?.length ? `<div class="rel-resumo">${o.resumo.map(([a, b]) => `<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>` : ''}
      ${o.corpo}
      ${o.nota ? `<p class="rel-nota">${esc(o.nota)}</p>` : ''}
      ${o.assinaturas?.length ? `<div class="rel-assin">${o.assinaturas.map((a) => `<div><i></i><span>${esc(a)}</span></div>`).join('')}</div>` : ''}
      <footer class="rel-rodape"><span>${EMPRESA} · Consulta de Romaneio - Importação</span></footer>`;
    document.body.classList.add('imprimir-rel');
    if (o.arquivo) { tituloOriginal ??= document.title; document.title = o.arquivo; } // nome sugerido do PDF
    return r;
  }

  // Monta, espera a logo e imprime
  async function imprimir(o) {
    const r = montar(o);
    const img = r.querySelector('.rel-logo');
    try { await Promise.race([img.decode ? img.decode() : Promise.resolve(), new Promise((ok) => setTimeout(ok, 1500))]); } catch { img.remove(); }
    try { await document.fonts?.ready; } catch {}
    imprimindoPeloBotao = true;
    window.print();
  }

  // Ctrl+P / menu do navegador: monta o relatório padrão (a tabela do romaneio), se houver
  let imprimindoPeloBotao = false;
  window.addEventListener('beforeprint', () => {
    if (imprimindoPeloBotao || document.body.classList.contains('imprimir-rel')) return;
    const o = Impressao.padrao?.();
    if (o) montar(o);
  });
  window.addEventListener('afterprint', () => { imprimindoPeloBotao = false; limpar(); });

  const Impressao = window.Impressao = { EMPRESA, LOGO, esc, agora, logoPronta, imprimir, padrao: null };
})();
