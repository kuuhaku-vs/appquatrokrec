// Conferência do romaneio com o packing list do cliente/fornecedor.
// Lê a tabela de uma imagem (OCR com Tesseract.js), de uma planilha (.xlsx/.csv)
// ou de texto colado do Excel, e compara por código: rolos e TOTAL N.W. (kg)
// contra os rolos e a Qtde atual (Z5_PESOATU) do sistema.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kg = (n) => (n == null ? '–' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const kgSinal = (n) => (n == null ? '–' : (n > 0 ? '+' : '') + kg(n));
  const int = (n) => (n == null ? '–' : n.toLocaleString('pt-BR'));

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let itensPL = [];          // linhas lidas do packing list
  let totalPL = null;        // linha "Total" lida do packing list, se houver
  let origem = '';
  let imagemUrl = null;
  let zoom = 100;

  // ---------- Utilidades de leitura ----------
  function numero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v ?? '').trim().replace(/\s/g, '');
    if (!/^-?\d[\d.,]*$/.test(s)) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  // Chave de comparação do código: ignora O/0 e I/L/1, que o OCR confunde.
  const chave = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const pareceCodigo = (t) => {
    const s = t.replace(/[^A-Za-z0-9]/g, '');
    return s.length >= 9 && s.length <= 16 && (s.match(/\d/g) || []).length >= 7;
  };
  function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Uma linha de texto (OCR ou colada): COLOR  CÓDIGO  DESCRIÇÃO  ROLL  LOTE  N.W.  G.W.
  // As colunas vêm separadas por 2 ou mais espaços. Lemos de trás para frente:
  // os dois últimos números são N.W. e G.W.; antes deles, lote e rolos.
  const limpa = (t) => t.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, '');
  const ehNum = (t) => /^\d[\d.,]*$/.test(limpa(t)) && numero(limpa(t)) != null;
  function lerLinha(texto) {
    const linha = texto.replace(/[|[\]{}]/g, '  ');
    let cels = linha.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // Sem espaçamento de colunas (texto colado numa linha só): cada palavra vira uma célula
    const porPalavra = cels.length < 3;
    if (porPalavra) cels = linha.split(/\s+/).filter(Boolean);

    // Números no fim da linha (até 5). Célula curta sem dígito entre eles é um
    // número mal lido pelo OCR (o lote "1" às vezes vira "i", "." ou "’").
    const nums = [];
    let i = cels.length - 1;
    while (i >= 0 && nums.length < 5) {
      if (ehNum(cels[i])) nums.unshift(numero(limpa(cels[i--])));
      else if (nums.length && cels[i].length <= 2 && !/\d/.test(cels[i])) { nums.unshift(null); i--; }
      else break;
    }
    while (nums.length && nums[0] == null) { nums.shift(); i++; }
    if (nums.length < 2 || nums[nums.length - 1] == null) return null;

    // Colunas numéricas: ROLOS, [LOTE], N.W., [G.W.]
    let rolos, pesos;
    if (!porPalavra) {
      // Colunas separadas: o primeiro número é a quantidade de rolos
      rolos = nums[0];
      pesos = nums.slice(1).filter((v) => v != null);
      // Lote: número pequeno (até a qtde de rolos) antes do peso
      if (pesos.length >= 2 && Number.isInteger(pesos[0]) && pesos[0] <= Math.max(rolos, 1) && pesos[0] * 2 < pesos[1]) pesos.shift();
    } else {
      // Tudo numa linha: lê de trás para frente (peso, [peso], [lote], rolos)
      const v = nums.filter((x) => x != null);
      const u = v[v.length - 1], p = v[v.length - 2];
      pesos = p != null && p >= u * 0.8 && p <= u ? [p, u] : [u];
      const resto = v.slice(0, v.length - pesos.length);
      rolos = resto.length >= 2 && resto[resto.length - 1] < resto[resto.length - 2] ? resto[resto.length - 2] : resto[resto.length - 1];
    }
    if (!pesos.length) return null;
    // O OCR às vezes perde a vírgula ("769,5" vira "7695"): corrige quando o
    // peso por rolo fica impossível.
    let corrigido = false;
    const fixa = (w) => {
      if (w != null && Number.isInteger(w) && rolos && w / rolos > 80 && w / rolos / 10 >= 3) { corrigido = true; return w / 10; }
      return w;
    };
    let nw = fixa(pesos[0]);
    let gw = pesos.length > 1 ? fixa(pesos[1]) : null;
    if (gw != null && (gw < nw * 0.95 || gw > nw * 1.3)) gw = null; // G.W. mal lido: ignora
    const textos = cels.slice(0, i + 1).filter((c) => /[A-Za-z0-9]/.test(c));

    if (/total/i.test(textos.join(' ')) || (!textos.length && nums.length >= 3)) return { total: true, rolos, nw };
    if (!textos.length) return null;
    const cod = textos.find(pareceCodigo);
    const desc = textos.filter((t) => /[A-Za-z]{3,}/.test(t)).sort((a, b) => b.length - a.length)[0] || '';
    return {
      codigo: cod ? limpa(cod).toUpperCase() : '',
      descricao: desc,
      textos,
      rolos: rolos == null ? null : Math.round(rolos),
      nw, gw, corrigido,
    };
  }

  // Linhas em colunas (planilha ou texto colado do Excel)
  function lerTabela(linhas) {
    const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let h = -1, col = {};
    for (let i = 0; i < Math.min(linhas.length, 30); i++) {
      const c = linhas[i].map(norm);
      const cod = c.findIndex((x) => x.includes('CODIGO') || x === 'COD' || x === 'PRODUTO');
      const nw = c.findIndex((x) => /(^|TOTAL)NW|PESOLIQ|LIQUIDO|NETWEIGHT/.test(x));
      if (cod >= 0 && nw >= 0 && cod !== nw) {
        h = i;
        col = {
          cod, nw,
          desc: c.findIndex((x) => x.includes('DESCRI')),
          rolos: c.findIndex((x) => x.includes('ROLL') || x.includes('ROLO')),
          gw: c.findIndex((x) => /(^|TOTAL)GW|PESOBRU|GROSS/.test(x)),
        };
        break;
      }
    }
    const itens = [];
    let total = null;
    if (h < 0) {
      for (const l of linhas) { const r = lerLinha(l.join('   ')); r && (r.total ? (total = r) : itens.push(r)); }
      return { itens, total };
    }
    for (const l of linhas.slice(h + 1)) {
      const codTxt = String(l[col.cod] ?? '').trim();
      const linhaTxt = l.join(' ');
      const nw = numero(l[col.nw]);
      if (/total/i.test(linhaTxt) && !pareceCodigo(codTxt)) {
        if (nw != null) total = { total: true, rolos: col.rolos >= 0 ? numero(l[col.rolos]) : null, nw };
        continue;
      }
      if (!codTxt || nw == null) continue;
      itens.push({
        codigo: codTxt.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
        descricao: col.desc >= 0 ? String(l[col.desc] ?? '').trim() : '',
        textos: [codTxt, col.desc >= 0 ? String(l[col.desc] ?? '') : ''].filter(Boolean),
        rolos: col.rolos >= 0 ? numero(l[col.rolos]) : null,
        nw,
        gw: col.gw >= 0 ? numero(l[col.gw]) : null,
      });
    }
    return { itens, total };
  }

  // ---------- Carregar bibliotecas sob demanda ----------
  const carregando = {};
  function script(url) {
    return (carregando[url] ||= new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = url; s.onload = ok;
      s.onerror = () => { delete carregando[url]; falha(new Error('Não consegui baixar o leitor. Este computador precisa de internet para ler imagens e planilhas.')); };
      document.head.appendChild(s);
    }));
  }

  // ---------- Entrada: imagem, planilha ou texto ----------
  function progresso(txt, frac) {
    $('confProg').hidden = !txt;
    $('confProgTxt').textContent = txt || '';
    $('confProgBarra').style.width = `${Math.round((frac || 0) * 100)}%`;
  }
  function erro(txt) { $('confErro').textContent = txt || ''; $('confErro').hidden = !txt; }

  async function prepararImagem(fonte = imagemUrl) {
    const img = typeof fonte !== 'string' ? fonte : await new Promise((ok, falha) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('Não consegui abrir essa imagem.'));
      i.src = fonte;
    });
    // 1) Tons de cinza no tamanho original
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const base = document.createElement('canvas'); base.width = w; base.height = h;
    const gb = base.getContext('2d', { willReadFrequently: true });
    gb.fillStyle = '#fff'; gb.fillRect(0, 0, w, h); gb.drawImage(img, 0, 0);
    const d = gb.getImageData(0, 0, w, h), px = d.data;
    const cinza = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; j < cinza.length; i += 4, j++) cinza[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    // 2) Apaga as linhas da grade da tabela (linhas/colunas com mais da metade dos pixels escuros):
    //    com a grade o OCR mistura as colunas.
    const linhas = [], colunas = [];
    for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (cinza[y * w + x] < 140) n++; if (n > 0.5 * w) linhas.push(y); }
    for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) if (cinza[y * w + x] < 140) n++; if (n > 0.5 * h) colunas.push(x); }
    for (const y of linhas) cinza.fill(255, y * w, y * w + w);
    for (const x of colunas) for (let y = 0; y < h; y++) cinza[y * w + x] = 255;
    for (let i = 0, j = 0; j < cinza.length; i += 4, j++) { px[i] = px[i + 1] = px[i + 2] = cinza[j]; px[i + 3] = 255; }
    gb.putImageData(d, 0, 0);
    // 3) Amplia (até 3x): números pequenos de print ficam legíveis para o OCR
    const escala = Math.max(1, Math.min(3, 4200 / w));
    const c = document.createElement('canvas');
    c.width = Math.round(w * escala); c.height = Math.round(h * escala);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(base, 0, 0, c.width, c.height);
    // 4) Preto e branco: o OCR separa melhor as colunas
    const e = g.getImageData(0, 0, c.width, c.height), q = e.data;
    for (let i = 0; i < q.length; i += 4) { const v = q[i] > 160 ? 255 : 0; q[i] = q[i + 1] = q[i + 2] = v; }
    g.putImageData(e, 0, 0);
    return c;
  }

  async function ocr(fonte) {
    progresso('Preparando o leitor de imagem…', 0.02);
    await script(TESSERACT_URL);
    const canvas = await prepararImagem(fonte);
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') progresso('Lendo a tabela da imagem…', 0.15 + m.progress * 0.85);
        else if (/loading|initializ/.test(m.status)) progresso('Preparando o leitor de imagem…', 0.05 + (m.progress || 0) * 0.1);
      },
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(canvas);
      return lerLinhasTexto(data.text.split(/\r?\n/));
    } finally { await worker.terminate(); }
  }
  function lerLinhasTexto(linhas) {
    const r = { itens: [], total: null };
    for (const l of linhas) {
      const x = lerLinha(l);
      if (x) x.total ? (r.total = x) : r.itens.push(x);
    }
    return r;
  }

  async function lerImagem(arquivo) {
    if (imagemUrl) URL.revokeObjectURL(imagemUrl);
    imagemUrl = URL.createObjectURL(arquivo);
    mostrarImagem();
    return ocr(imagemUrl);
  }

  // ---------- PDF ----------
  // PDF gerado pelo Excel traz o texto de verdade: lemos direto, sem OCR (exato).
  // PDF escaneado (só imagem): renderiza a página em alta resolução e passa no OCR.
  async function lerPdf(arquivo) {
    progresso('Abrindo o PDF…', 0.05);
    if (!window.pdfjsLib) await script(PDFJS_URL);
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;

    const linhas = [];
    const paginas = [];
    let caracteres = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const pag = await doc.getPage(n);
      paginas.push(pag);
      const tc = await pag.getTextContent();
      const itens = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({
        s: it.str, x: it.transform[4], y: it.transform[5], w: it.width,
        h: Math.hypot(it.transform[2], it.transform[3]) || it.height || 8,
      }));
      caracteres += itens.reduce((t, it) => t + it.s.trim().length, 0);
      // Agrupa por linha (mesmo y) e ordena da esquerda para a direita
      itens.sort((a, b) => b.y - a.y || a.x - b.x);
      const grupos = [];
      for (const it of itens) {
        const g = grupos[grupos.length - 1];
        if (g && Math.abs(g.y - it.y) < Math.max(g.h, it.h) * 0.5) g.itens.push(it);
        else grupos.push({ y: it.y, h: it.h, itens: [it] });
      }
      for (const g of grupos) {
        g.itens.sort((a, b) => a.x - b.x);
        let txt = '', fim = null;
        for (const it of g.itens) {
          if (fim != null) {
            const vao = it.x - fim;
            txt += vao > it.h * 0.8 ? '   ' : vao > it.h * 0.12 ? ' ' : '';
          }
          txt += it.s; fim = it.x + it.w;
        }
        linhas.push(txt);
      }
    }

    // Imagem das páginas para ficar fixada na tela
    const escalaVer = 2;
    const telas = [];
    for (const pag of paginas.slice(0, 5)) {
      const vp = pag.getViewport({ scale: escalaVer });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pag.render({ canvasContext: g, viewport: vp }).promise;
      telas.push(c);
    }
    const junta = document.createElement('canvas');
    junta.width = Math.max(...telas.map((c) => c.width)); junta.height = telas.reduce((t, c) => t + c.height, 0);
    const gj = junta.getContext('2d'); gj.fillStyle = '#fff'; gj.fillRect(0, 0, junta.width, junta.height);
    let y = 0; for (const c of telas) { gj.drawImage(c, 0, y); y += c.height; }
    if (imagemUrl) URL.revokeObjectURL(imagemUrl);
    imagemUrl = URL.createObjectURL(await new Promise((ok) => junta.toBlob(ok, 'image/png')));
    mostrarImagem();

    if (caracteres > 30) {
      const r = lerLinhasTexto(linhas);
      if (r.itens.length) { r.comoTexto = true; return r; }
    }
    // Sem texto (escaneado): usa a imagem embutida na resolução original (lê melhor
    // que a página renderizada); se não achar, renderiza a página.
    progresso('O PDF é uma imagem. Lendo com OCR…', 0.1);
    const r = { itens: [], total: null };
    for (const pag of paginas) {
      let c = await imagemEmbutida(pag).catch(() => null);
      if (!c) {
        const v1 = pag.getViewport({ scale: 1 });
        const vp = pag.getViewport({ scale: 1200 / v1.width });
        c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await pag.render({ canvasContext: g, viewport: vp }).promise;
      }
      const p = await ocr(c);
      r.itens.push(...p.itens); if (p.total) r.total = p.total;
    }
    return r;
  }

  // Maior imagem da página, no tamanho em que foi gravada no PDF
  async function imagemEmbutida(pag) {
    const ops = await pag.getOperatorList();
    const O = pdfjsLib.OPS;
    let melhor = null;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn !== O.paintImageXObject && fn !== O.paintJpegXObject) continue;
      const nome = ops.argsArray[i][0];
      const objs = String(nome).startsWith('g_') ? pag.commonObjs : pag.objs;
      const img = await new Promise((ok) => { try { objs.get(nome, ok); } catch { ok(null); } });
      if (!img || !img.width || !img.height) continue;
      if (melhor && img.width * img.height <= melhor.width * melhor.height) continue;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const out = g.createImageData(img.width, img.height), d = out.data, src = img.data, n = img.width * img.height;
        if (src.length === n * 4) d.set(src);
        else if (src.length === n * 3) for (let p = 0, q = 0; p < n; p++, q += 3) { d[p * 4] = src[q]; d[p * 4 + 1] = src[q + 1]; d[p * 4 + 2] = src[q + 2]; d[p * 4 + 3] = 255; }
        else continue; // formato de 1 bit: deixa para a renderização
        g.putImageData(out, 0, 0);
      } else continue;
      melhor = c;
    }
    return melhor && melhor.width >= 300 ? melhor : null;
  }

  async function lerPlanilha(arquivo) {
    progresso('Lendo a planilha…', 0.3);
    await script(XLSX_URL);
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    let melhor = { itens: [], total: null };
    for (const nome of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' });
      const r = lerTabela(linhas);
      if (r.itens.length > melhor.itens.length) melhor = r;
    }
    return melhor;
  }

  function lerTexto(txt) {
    const linhas = txt.split(/\r?\n/).filter((l) => l.trim());
    const colunas = linhas.some((l) => l.split('\t').length > 3);
    return colunas ? lerTabela(linhas.map((l) => l.split('\t'))) : lerTabela(linhas.map((l) => [l]));
  }

  async function receber(fonte) {
    if (!window.romaneioAtual) { erro('Busque o romaneio primeiro e depois envie o packing list.'); return; }
    erro('');
    try {
      let r;
      if (fonte instanceof File && (fonte.type === 'application/pdf' || /\.pdf$/i.test(fonte.name))) {
        r = await lerPdf(fonte);
        origem = r.comoTexto ? 'pdf' : 'imagem';
      }
      else if (fonte instanceof File && fonte.type.startsWith('image/')) { origem = 'imagem'; r = await lerImagem(fonte); }
      else if (fonte instanceof File) {
        origem = 'planilha';
        if (imagemUrl) { URL.revokeObjectURL(imagemUrl); imagemUrl = null; }
        mostrarImagem();
        r = /\.(csv|txt|tsv)$/i.test(fonte.name) ? lerTexto(await fonte.text()) : await lerPlanilha(fonte);
      } else { origem = 'texto'; if (imagemUrl) { URL.revokeObjectURL(imagemUrl); imagemUrl = null; } mostrarImagem(); r = lerTexto(fonte); }
      progresso('');
      if (!r.itens.length) {
        erro(origem === 'imagem'
          ? 'Não encontrei linhas com código e peso nessa imagem. Tente um print mais nítido, só da tabela, ou cole as linhas copiadas do Excel.'
          : 'Não encontrei linhas com código e peso. Confira se a planilha tem as colunas CÓDIGO e TOTAL N.W.');
        return;
      }
      // Junta códigos repetidos
      const porCod = new Map();
      let semCod = 0;
      for (const it of r.itens) {
        const k = it.codigo ? chave(it.codigo) : 'linha' + semCod++;
        const j = porCod.get(k);
        if (j) { j.rolos = (j.rolos || 0) + (it.rolos || 0); j.nw = (j.nw || 0) + (it.nw || 0); }
        else porCod.set(k, { ...it });
      }
      itensPL = [...porCod.values()];
      totalPL = r.total;
      $('confResultado').hidden = false;
      renderConferencia();
      $('confResultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      progresso('');
      erro(e.message || 'Não foi possível ler o arquivo.');
    }
  }

  // ---------- Imagem fixada ----------
  function mostrarImagem() {
    const tem = !!imagemUrl;
    $('confImgBox').hidden = !tem;
    $('confLayout').classList.toggle('com-img', tem);
    if (tem) { $('confImg').src = imagemUrl; $('confImgLink').href = imagemUrl; aplicarZoom(); }
  }
  function aplicarZoom() { $('confImg').style.width = zoom + '%'; $('confZoomTxt').textContent = zoom + '%'; }
  $('confZoomMais').addEventListener('click', () => { zoom = Math.min(300, zoom + 25); aplicarZoom(); });
  $('confZoomMenos').addEventListener('click', () => { zoom = Math.max(50, zoom - 25); aplicarZoom(); });
  $('confFixar').checked = window.innerWidth >= 1500;
  $('confLayout').classList.toggle('lado', $('confFixar').checked);
  $('confFixar').addEventListener('change', (e) => $('confLayout').classList.toggle('lado', e.target.checked));

  // ---------- Comparação ----------
  // Texto normalizado para comparar: ignora espaços e as trocas típicas do OCR.
  const normal = (t) => String(t || '').toUpperCase().replace(/\$/g, 'S').replace(/[^A-Z0-9]/g, '')
    .replace(/[OQ]/g, '0').replace(/[IL]/g, '1');
  // Distância relativa (0 = igual) entre um texto lido e um texto do sistema
  function dif(a, b) {
    a = normal(a); b = normal(b);
    if (!a || !b) return 1;
    return distancia(a, b) / Math.max(a.length, b.length);
  }
  // Procura o texto mais curto dentro do mais longo, aceitando poucos erros
  // (o OCR às vezes junta o código ilegível com a descrição na mesma coluna).
  function difDentro(a, b) {
    a = normal(a); b = normal(b);
    const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
    if (curto.length < 8) return 1;
    let ant = new Array(longo.length + 1).fill(0), lin;
    for (let i = 1; i <= curto.length; i++) {
      lin = [i];
      for (let j = 1; j <= longo.length; j++)
        lin[j] = Math.min(ant[j] + 1, lin[j - 1] + 1, ant[j - 1] + (curto[i - 1] === longo[j - 1] ? 0 : 1));
      ant = lin;
    }
    return Math.min(...ant) / curto.length;
  }
  function custo(it, p) {
    let melhor = 1;
    const ok = (c, lim) => { if (c <= lim && c < melhor) melhor = c; };
    if (it.codigo) ok(dif(it.codigo, p.codigo), 0.2);
    for (const t of it.textos || [it.descricao]) {
      ok(dif(t, p.codigo), 0.2);
      if (p.descricao) { ok(dif(t, p.descricao), 0.2); ok(difDentro(t, p.descricao), 0.1); }
    }
    return melhor;
  }

  function comparar() {
    const tol = Math.max(0, numero($('confTol').value) ?? 0.05);
    const sistema = window.romaneioAtual.produtos;
    // Calcula a semelhança de cada linha lida com cada produto e casa os pares mais parecidos primeiro.
    const cand = [];
    itensPL.forEach((it, a) => sistema.forEach((p, b) => { const c = custo(it, p); if (c < 1) cand.push([c, a, b]); }));
    cand.sort((x, y) => x[0] - y[0]);
    const usadoA = new Set(), usadoB = new Set();
    const pares = new Map();
    for (const [c, a, b] of cand) {
      if (usadoA.has(a) || usadoB.has(b)) continue;
      usadoA.add(a); usadoB.add(b);
      pares.set(sistema[b].codigo, { it: itensPL[a], aprox: c > 0 });
    }
    const restantes = itensPL.filter((_, a) => !usadoA.has(a));

    const linhas = sistema.map((p) => {
      const par = pares.get(p.codigo);
      const it = par?.it;
      const dRolos = it && it.rolos != null ? it.rolos - p.rolos : null;
      const dPeso = it && it.nw != null ? +(it.nw - p.quantidade).toFixed(2) : null;
      let status = 'ok';
      if (!it) status = 'so-sistema';
      else if (it.nw == null) status = 'sem-peso';
      else if (Math.abs(dPeso) > tol + 1e-9 || (dRolos != null && dRolos !== 0)) status = 'divergente';
      return { p, it, aprox: par?.aprox, dRolos, dPeso, status };
    });
    for (const it of restantes) linhas.push({ p: null, it, status: 'so-planilha', dRolos: null, dPeso: null });
    return { linhas, tol };
  }

  const STATUS = {
    ok: ['OK', 'ok'],
    divergente: ['Divergente', 'div'],
    'so-sistema': ['Falta na planilha', 'falta'],
    'so-planilha': ['Falta no sistema', 'falta'],
    'sem-peso': ['Sem peso lido', 'falta'],
  };
  let ultima = null;

  function renderConferencia() {
    const { linhas, tol } = (ultima = comparar());
    const so = $('confSoDiv').checked;
    const visiveis = so ? linhas.filter((l) => l.status !== 'ok') : linhas;
    const nDiv = linhas.filter((l) => l.status === 'divergente').length;
    const nFalta = linhas.filter((l) => ['so-sistema', 'so-planilha', 'sem-peso'].includes(l.status)).length;
    const nOk = linhas.filter((l) => l.status === 'ok').length;
    const somaPL = itensPL.reduce((s, i) => s + (i.nw || 0), 0);
    const somaRolPL = itensPL.reduce((s, i) => s + (i.rolos || 0), 0);
    const sis = window.romaneioAtual;
    const dTotal = +(somaPL - sis.totalQuantidade).toFixed(2);

    $('confStatus').className = 'conf-veredito ' + (nDiv || nFalta ? 'tem-div' : 'tudo-ok');
    $('confStatus').innerHTML = nDiv || nFalta
      ? `<strong>${nDiv + nFalta} ${nDiv + nFalta === 1 ? 'produto precisa' : 'produtos precisam'} de ajuste</strong><span>${nOk} de ${linhas.length} conferem (tolerância de ${kg(tol)} kg)</span>`
      : `<strong>Tudo confere</strong><span>Os ${nOk} produtos batem com o sistema (tolerância de ${kg(tol)} kg)</span>`;

    $('confTotais').innerHTML = `
      <div><span class="rotulo">Rolos planilha / sistema</span><b>${int(somaRolPL)} / ${int(sis.totalRolos)}</b>${somaRolPL !== sis.totalRolos ? `<em class="neg">${somaRolPL - sis.totalRolos > 0 ? '+' : ''}${somaRolPL - sis.totalRolos}</em>` : ''}</div>
      <div><span class="rotulo">N.W. planilha</span><b>${kg(somaPL)} kg</b></div>
      <div><span class="rotulo">Qtde atual sistema</span><b>${kg(sis.totalQuantidade)} kg</b></div>
      <div><span class="rotulo">Diferença total</span><b class="${Math.abs(dTotal) > tol ? 'neg' : ''}">${kgSinal(dTotal)} kg</b></div>`;

    let avisoTotal = '';
    if (totalPL && totalPL.nw != null && Math.abs(totalPL.nw - somaPL) > 0.5) {
      avisoTotal = `A linha "Total" da planilha diz ${kg(totalPL.nw)} kg, mas a soma das linhas lidas dá ${kg(somaPL)} kg. Alguma linha pode ter sido lida errado ou ficado de fora: confira a imagem.`;
    }
    $('confAvisoTotal').textContent = avisoTotal; $('confAvisoTotal').hidden = !avisoTotal;
    $('confOrigem').textContent = `${itensPL.length} linhas lidas ${{ imagem: 'da imagem (OCR)', pdf: 'do PDF (texto exato, sem OCR)', planilha: 'da planilha', texto: 'do texto colado' }[origem] || ''}${origem === 'imagem' ? '. Confira os números lidos: dá para corrigir direto nas células azuis.' : '.'}`;

    let h = '';
    if (!visiveis.length) h = '<tr class="vazio"><td colspan="10">Nenhuma divergência.</td></tr>';
    visiveis.forEach((l) => {
      const idx = l.it ? itensPL.indexOf(l.it) : -1;
      const [rot, cls] = STATUS[l.status];
      const cod = l.p ? l.p.codigo : l.it.codigo;
      const lido = (l.it && l.p && l.aprox && l.status !== 'ok' ? `<div class="lido">lido como “${esc(l.it.codigo || l.it.descricao)}”</div>` : '')
        + (l.it?.corrigido ? '<div class="lido">vírgula do peso corrigida, confira na imagem</div>' : '');
      const ed = (campo, v, casas) => (idx >= 0
        ? `<input class="ed" data-i="${idx}" data-c="${campo}" inputmode="decimal" value="${v == null ? '' : casas ? v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : v}" aria-label="${campo === 'nw' ? 'N.W. da planilha' : 'Rolos da planilha'} de ${esc(cod)}">`
        : '–');
      h += `<tr class="st-${cls}">
        <td><span class="pill pill-${cls}">${rot}</span></td>
        <td class="cod">${esc(cod)}${lido}</td>
        <td class="desc">${esc(l.p ? l.p.descricao : l.it.descricao)}</td>
        <td class="n">${ed('rolos', l.it?.rolos, false)}</td>
        <td class="n">${l.p ? int(l.p.rolos) : '–'}</td>
        <td class="n ${l.dRolos ? 'neg' : ''}">${l.dRolos == null ? '–' : l.dRolos === 0 ? '0' : (l.dRolos > 0 ? '+' : '') + l.dRolos}</td>
        <td class="n">${ed('nw', l.it?.nw, true)}</td>
        <td class="n">${l.p ? kg(l.p.quantidade) : '–'}</td>
        <td class="n div-col ${l.status === 'divergente' && Math.abs(l.dPeso) > tol + 1e-9 ? 'neg forte' : ''}">${l.dPeso == null ? '–' : kgSinal(l.dPeso)}</td>
        <td class="n">${l.p && l.it?.nw != null ? kg(l.it.nw) : '–'}</td>
      </tr>`;
    });
    $('confCorpo').innerHTML = h;
  }

  $('confCorpo').addEventListener('change', (e) => {
    const inp = e.target.closest('input.ed'); if (!inp) return;
    const it = itensPL[+inp.dataset.i]; if (!it) return;
    const v = numero(inp.value);
    it[inp.dataset.c] = inp.dataset.c === 'rolos' && v != null ? Math.round(v) : v;
    renderConferencia();
  });
  $('confCorpo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input.ed')) { e.preventDefault(); e.target.blur(); }
  });
  $('confSoDiv').addEventListener('change', renderConferencia);
  $('confTol').addEventListener('change', renderConferencia);

  // ---------- Exportar divergências ----------
  const n2 = (n) => (n == null ? '' : n.toLocaleString('pt-BR', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 3 }));
  function linhasDiv() {
    const rows = ultima.linhas.filter((l) => l.status !== 'ok');
    return [['Romaneio', 'Situação', 'Código', 'Produto', 'Rolos planilha', 'Rolos sistema', 'Dif. rolos', 'N.W. planilha (kg)', 'Qtde atual sistema (kg)', 'Divergência (kg)', 'Ajustar sistema para (kg)'],
      ...rows.map((l) => [window.romaneioAtual.numero, STATUS[l.status][0], l.p ? l.p.codigo : l.it.codigo, l.p ? l.p.descricao : l.it.descricao,
        l.it?.rolos ?? '', l.p?.rolos ?? '', l.dRolos ?? '', n2(l.it?.nw), n2(l.p?.quantidade), n2(l.dPeso), l.p && l.it?.nw != null ? n2(l.it.nw) : ''].map(String))];
  }
  $('confCopiar').addEventListener('click', async () => {
    const tsv = linhasDiv().map((l) => l.join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); window.mostrarToast?.('Divergências copiadas. Cole no Excel com Ctrl+V.'); }
    catch { window.mostrarToast?.('Não foi possível copiar.'); }
  });
  $('confCsv').addEventListener('click', () => {
    const csv = linhasDiv().map((l) => l.map((c) => /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `divergencias-romaneio-${window.romaneioAtual.numero}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('confLimpar').addEventListener('click', limpar);

  function limpar() {
    itensPL = []; totalPL = null; ultima = null;
    if (imagemUrl) { URL.revokeObjectURL(imagemUrl); imagemUrl = null; }
    mostrarImagem();
    $('confResultado').hidden = true; erro(''); progresso('');
  }

  // ---------- Recebendo arquivos ----------
  const zona = $('confZona');
  $('confArquivo').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) receber(f); e.target.value = ''; });
  zona.addEventListener('click', (e) => { if (!e.target.closest('textarea, button')) $('confArquivo').click(); });
  zona.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === zona) { e.preventDefault(); $('confArquivo').click(); } });
  ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
  ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove('sobre')));
  zona.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) receber(f); });

  // Ctrl+V em qualquer lugar da página: print (imagem) ou linhas copiadas do Excel
  document.addEventListener('paste', (e) => {
    if (!window.romaneioAtual || e.target.closest('input.ed, #filtro, #numero, #filial, #confTol')) return;
    const itens = [...(e.clipboardData?.items || [])];
    const img = itens.find((i) => i.type.startsWith('image/'));
    if (img) { e.preventDefault(); const f = img.getAsFile(); receber(new File([f], 'print.png', { type: f.type })); return; }
    const txt = e.clipboardData.getData('text/plain');
    if (txt && txt.split('\n').length > 1) { e.preventDefault(); receber(txt); }
  });

  // Novo romaneio buscado: limpa a conferência anterior
  document.addEventListener('romaneio:carregado', limpar);

  // Para testes
  window.__conferencia = { imagemEmbutida, lerPdf, prepararImagem, lerLinha, lerTabela, lerTexto, numero, receber, custo, comparar: () => comparar(), set itens(v) { itensPL = v; } };
})();
