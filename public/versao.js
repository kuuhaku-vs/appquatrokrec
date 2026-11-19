// Aviso de nova versão
// Compara os arquivos que esta página está usando (cache do navegador) com os do
// servidor. Se mudaram, mostra uma faixa com "Atualizar agora". Não precisa trocar
// número de versão à mão: qualquer alteração publicada é detectada.
(() => {
  const ARQUIVOS = ['./', 'app.js', 'app.css', 'conferencia.js', 'impressao.js', 'protheus.js', 'versao.js'];
  const INTERVALO = 10 * 60 * 1000; // confere a cada 10 minutos
  const CHAVE_ADIADA = 'romaneio.versaoAdiada';

  // Hash simples (FNV-1a) — não precisa de criptografia, só detectar mudança
  function hash(txt) {
    let h = 0x811c9dc5;
    for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  }
  async function assinatura(cache) {
    const partes = await Promise.all(ARQUIVOS.map(async (a) => {
      const r = await fetch(a, { cache });
      if (!r.ok) throw new Error(`${a}: ${r.status}`);
      return hash(await r.text());
    }));
    return partes.join('.');
  }

  let emUso = null;     // versão que esta página carregou
  let nova = null;      // versão encontrada no servidor
  let conferindo = false, ultimaConf = 0;

  async function conferir() {
    if (conferindo || !navigator.onLine) return;
    conferindo = true; ultimaConf = Date.now();
    try {
      // 'force-cache' devolve a cópia que o navegador já tem: é o que a página está rodando
      emUso ??= await assinatura('force-cache');
      const servidor = await assinatura('no-store');
      if (servidor !== emUso) { nova = servidor; mostrar(); }
    } catch { /* sem conexão ou arquivo fora do ar: tenta na próxima */ }
    finally { conferindo = false; }
  }

  function mostrar() {
    let adiada = null;
    try { adiada = sessionStorage.getItem(CHAVE_ADIADA); } catch {}
    if (adiada === nova) return;
    let faixa = document.getElementById('novaVersao');
    if (!faixa) {
      faixa = document.createElement('div');
      faixa.id = 'novaVersao';
      faixa.className = 'nova-versao';
      faixa.setAttribute('role', 'status');
      faixa.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/></svg>
        <div class="nv-txt"><b>Nova versão disponível</b><span id="novaVersaoDet">Atualize para usar as últimas melhorias.</span></div>
        <button type="button" class="btn-pri" id="novaVersaoOk">Atualizar agora</button>
        <button type="button" class="btn-sec" id="novaVersaoDepois">Depois</button>`;
      document.body.appendChild(faixa);
      document.getElementById('novaVersaoOk').addEventListener('click', atualizar);
      document.getElementById('novaVersaoDepois').addEventListener('click', () => {
        try { sessionStorage.setItem(CHAVE_ADIADA, nova); } catch {}
        faixa.hidden = true;
      });
    }
    const conf = document.getElementById('confResultado');
    document.getElementById('novaVersaoDet').textContent = conf && !conf.hidden
      ? 'Atualize quando terminar: a conferência aberta será perdida.'
      : 'Atualize para usar as últimas melhorias. A consulta aberta é refeita.';
    faixa.hidden = false;
  }

  async function atualizar() {
    const b = document.getElementById('novaVersaoOk');
    b.disabled = true; b.textContent = 'Atualizando…';
    // Baixa de novo cada arquivo, trocando a cópia guardada pelo navegador
    try { await Promise.all(ARQUIVOS.concat('logo-quatrok.png').map((a) => fetch(a, { cache: 'reload' }))); } catch {}
    try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch {}
    location.reload();
  }

  // Primeira conferência logo depois de abrir; depois a cada 10 min e ao voltar para a aba
  window.addEventListener('load', () => setTimeout(conferir, 3000));
  setInterval(conferir, INTERVALO);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - ultimaConf > 60 * 1000) conferir();
  });

  window.__versao = { conferir, hash };
})();
