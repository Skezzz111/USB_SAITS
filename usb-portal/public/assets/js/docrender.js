// Отрисовка документа по шаблону на холсте (лист A4): общий код для конструктора, админ-панели и PNG.
// Разметка шаблона описана в src/doc-templates.js.
window.DocRender = (function () {
  const PAGE_W = 794; // A4 при 96 dpi
  const PAGE_H = 1123;
  const MARGIN = { top: 76, right: 57, bottom: 76, left: 113 };
  const MM = 96 / 25.4;
  const PT = 96 / 72;
  const BASE = 14 * PT;
  const TITLE = 18 * PT;
  const SMALL = 12 * PT;
  const LINE = 1.15;
  // Если документ чуть не помещается на один лист, интервал сжимается по этим шагам (как «сократить на страницу»).
  const FIT_LINES = [1.12, 1.09, 1.06];
  const INDENT = 47; // 1,25 см
  const FONT = '"Times New Roman", "PT Serif", Times, serif';
  const SIG_H = 62;
  const STAMP = 150;
  const STAMP_URL = '/assets/img/docs/stamp-uvd-cao.png';
  const EMBLEM_H = 60; // ≈ 1,6 см
  const EMBLEM_GAP = 6;
  const EMBLEM_TOP = 38; // знак в начале документа печатается в верхнем поле, ≈ 1 см от края листа
  const EMBLEM_URL = '/assets/img/docs/emblem-mvd.png';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const TOKEN = /\*\*|__|\{([^{}\n]+)\}|\[([^[\]\n]+)\]/g;
  const EMBLEM_RE = /^герб(?:\s+(\d+(?:[.,]\d+)?)\s*мм)?$/;
  const NUMBER_RE = /^\d{3}-\d{3}-\d+$/;

  /** Поле номера документа: образец вида 262-410-5 или поле «Номер» / «Номер документа». */
  const isNumberField = (key) => NUMBER_RE.test(key.trim()) || /^номер(\s+документа)?$/i.test(key.trim());

  /* ---------- Разбор разметки ---------- */

  function detectDateFormat(sample) {
    const s = sample.trim();
    if (/«\s*\d{1,2}\s*»/.test(s)) return 'quoted';
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(s)) return 'numeric';
    if (/года$/.test(s)) return 'long-year';
    if (/г\.?$/.test(s)) return 'long-g';
    return 'long';
  }

  function formatDate(iso, format) {
    const [y, m, d] = iso.split('-').map(Number);
    const pad = (n) => String(n).padStart(2, '0');
    const month = MONTHS[m - 1];
    switch (format) {
      case 'quoted': return `«${pad(d)}» ${month} ${y} г.`;
      case 'numeric': return `${pad(d)}.${pad(m)}.${y}`;
      case 'long-g': return `${d} ${month} ${y} г.`;
      case 'long': return `${d} ${month} ${y}`;
      default: return `${d} ${month} ${y} года`;
    }
  }

  const toNumber = (s) => parseFloat(s.replace(',', '.'));

  function parseInline(text, ctx, baseBold) {
    const runs = [];
    let bold = baseBold;
    let italic = false;
    let last = 0;
    for (const m of text.matchAll(TOKEN)) {
      if (m.index > last) runs.push({ kind: 'text', text: text.slice(last, m.index), bold, italic });
      if (m[0] === '**') {
        bold = !bold;
      } else if (m[0] === '__') {
        italic = !italic;
      } else if (m[1] !== undefined) {
        const key = m[1].trim();
        runs.push({ kind: 'field', key, bold, italic });
        if (!ctx.fields.includes(key)) ctx.fields.push(key);
      } else {
        const inner = m[2].trim();
        const lower = inner.toLowerCase();
        const emblem = lower.match(EMBLEM_RE);
        if (lower === 'подпись') {
          runs.push({ kind: 'signature' });
          ctx.signature = true;
        } else if (lower === 'печать') {
          runs.push({ kind: 'stamp' });
        } else if (emblem) {
          runs.push({ kind: 'emblem', height: emblem[1] ? Math.min(toNumber(emblem[1]), 80) * MM : EMBLEM_H });
        } else {
          runs.push({ kind: 'date', index: ctx.dates.length, bold, italic });
          ctx.dates.push({ sample: inner, format: detectDateFormat(inner) });
        }
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push({ kind: 'text', text: text.slice(last), bold, italic });
    return runs;
  }

  function parseLine(raw, ctx) {
    if (!raw.trim()) return { type: 'blank' };
    let line = raw;
    let align = 'justify';
    let indent = true;
    let size = BASE;
    let bold = false;
    if (line.startsWith('#')) {
      line = line.replace(/^#+\s*/, '');
      align = 'center';
      indent = false;
      size = TITLE;
      bold = true;
    } else {
      // Префиксы строки в любом порядке: ~ — мелкий шрифт, ^ > < — выравнивание.
      const prefix = line.match(/^[~^<>]+/);
      if (prefix) {
        for (const ch of prefix[0]) {
          if (ch === '~') {
            size = SMALL;
          } else {
            align = ch === '^' ? 'center' : ch === '>' ? 'right' : 'left';
            indent = false;
          }
        }
        line = line.slice(prefix[0].length).replace(/^\s/, '');
      }
    }
    if (line.includes('|')) {
      return { type: 'row', size, cells: line.split('|').map((cell) => parseInline(cell.trim(), ctx, bold)) };
    }
    return { type: 'para', align, indent, size, runs: parseInline(line, ctx, bold) };
  }

  /** Доли ширины колонок: заданные проценты, остаток поровну между остальными. */
  function fractions(widths, count) {
    const given = widths.slice(0, count);
    const rest = count - given.length;
    const sum = given.reduce((a, b) => a + b, 0);
    const all = [...given, ...Array(rest).fill(Math.max((100 - sum) / (rest || 1), 1))];
    const total = all.reduce((a, b) => a + b, 0);
    return all.map((w) => w / total);
  }

  const clampMargin = (mm) => Math.min(Math.max(mm, 5), 50) * MM;

  /** Разбирает тело шаблона: блоки для отрисовки, поля листа, поля для заполнения, даты, нужна ли подпись. */
  function parse(body) {
    const ctx = { fields: [], dates: [], signature: false };
    const margin = { ...MARGIN };
    const blocks = [];
    let group = null; // открытый блок колонок
    for (const raw of String(body || '').replace(/\r/g, '').split('\n')) {
      const directive = raw.match(/^:::\s*(.*)$/);
      if (!directive) {
        const block = parseLine(raw, ctx);
        (group ? group.columns[group.columns.length - 1].blocks : blocks).push(block);
        continue;
      }
      const words = directive[1].trim().toLowerCase();
      const numbers = (words.match(/\d+(?:[.,]\d+)?/g) || []).map(toNumber);
      if (words.startsWith('поля')) {
        if (numbers.length) {
          const [top, right = top, bottom = top, left = right] = numbers;
          Object.assign(margin, { top: clampMargin(top), right: clampMargin(right), bottom: clampMargin(bottom), left: clampMargin(left) });
        }
      } else if (words.startsWith('колонки')) {
        group = { type: 'columns', widths: numbers, columns: [{ valign: 'top', blocks: [] }] };
        blocks.push(group);
      } else if (words.startsWith('конец')) {
        group = null;
      } else if (group) {
        group.columns.push({ valign: /центр/.test(words) ? 'middle' : /низ/.test(words) ? 'bottom' : 'top', blocks: [] });
      }
    }
    for (const block of blocks) {
      if (block.type === 'columns') block.fractions = fractions(block.widths, block.columns.length);
    }
    return { blocks, margin, fields: ctx.fields, dates: ctx.dates, signature: ctx.signature };
  }

  /* ---------- Вёрстка ---------- */

  const fontOf = (piece, size) => `${piece.empty || piece.italic ? 'italic ' : ''}${piece.bold ? 'bold ' : ''}${size}px ${FONT}`;
  let lineFactor = LINE; // меняется только синхронно внутри render()
  const lineHeight = (size) => size * lineFactor;
  const isImage = (kind) => kind === 'signature' || kind === 'stamp' || kind === 'emblem';
  const isMark = (w) => w.image === 'signature' || w.image === 'stamp';

  function toWords(ctx, runs, data, size, capitalize) {
    const items = [];
    let atStart = capitalize;
    for (const run of runs) {
      if (isImage(run.kind)) {
        items.push({ image: run.kind, height: run.height });
        continue;
      }
      let text;
      let empty = false;
      if (run.kind === 'text') {
        text = run.text;
      } else if (run.kind === 'field') {
        text = data.values[run.key] || '';
        if (!text) {
          text = run.key;
          empty = true;
        }
      } else {
        text = formatDate(data.dates[run.index] || data.today, data.model.dates[run.index].format);
      }
      if (atStart && text.trim()) {
        if (run.kind !== 'text' && !empty) text = text.charAt(0).toUpperCase() + text.slice(1);
        atStart = false;
      }
      for (const part of text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) items.push({ space: true });
        else items.push({ text: part, bold: run.bold, italic: run.italic, kind: run.kind, empty });
      }
    }

    const words = [];
    let current = null;
    for (const item of items) {
      if (item.space) { current = null; continue; }
      if (item.image) { words.push({ image: item.image, height: item.height }); current = null; continue; }
      if (!current) { current = { pieces: [] }; words.push(current); }
      current.pieces.push(item);
    }
    for (const word of words) {
      if (word.image === 'signature') {
        const img = data.signature;
        word.width = img ? Math.min((img.naturalWidth / img.naturalHeight) * SIG_H, 200) : 120;
      } else if (word.image === 'stamp') {
        word.width = 0;
      } else if (word.image === 'emblem') {
        const img = data.emblem;
        word.width = img ? (img.naturalWidth / img.naturalHeight) * word.height : word.height * 1.7;
      } else {
        word.width = 0;
        for (const piece of word.pieces) {
          ctx.font = fontOf(piece, size);
          piece.width = ctx.measureText(piece.text).width;
          word.width += piece.width;
        }
      }
    }
    return words;
  }

  function spaceWidth(ctx, size) {
    ctx.font = `${size}px ${FONT}`;
    return ctx.measureText(' ').width;
  }

  function breakLines(words, maxWidth, firstIndent, space) {
    const lines = [];
    let line = [];
    let width = 0;
    let limit = maxWidth - firstIndent;
    for (const word of words) {
      const add = line.length ? space + word.width : word.width;
      if (line.length && width + add > limit) {
        lines.push({ words: line, width });
        line = [word];
        width = word.width;
        limit = maxWidth;
      } else {
        line.push(word);
        width += add;
      }
    }
    lines.push({ words: line, width });
    return lines;
  }

  /**
   * Раскладывает блок на элементы с высотой в пределах рамки frame = { x, width }.
   * signed — блок содержит подпись или печать, blank — пустая строка.
   */
  function blockOps(ctx, block, data, frame) {
    if (block.type === 'blank') return { ops: [{ type: 'space', height: lineHeight(BASE) }], blank: true };
    if (block.type === 'columns') return columnsOps(ctx, block, data, frame);
    const space = spaceWidth(ctx, block.size);
    const lh = lineHeight(block.size);

    if (block.type === 'para') {
      const words = toWords(ctx, block.runs, data, block.size, true);
      const indent = block.indent ? INDENT : 0;
      const lines = breakLines(words, frame.width, indent, space);
      const ops = lines.map((line, i) => {
        let height = lh;
        const emblems = line.words.filter((w) => w.image === 'emblem');
        if (line.words.some((w) => w.image === 'signature')) height = Math.max(height, SIG_H);
        if (emblems.length) height = Math.max(height, Math.max(...emblems.map((w) => w.height)) + EMBLEM_GAP);
        return {
          type: 'line', line, size: block.size, space, align: block.align,
          x: frame.x + (i === 0 ? indent : 0), width: frame.width - (i === 0 ? indent : 0),
          last: i === lines.length - 1, height, emblem: emblems.length > 0,
        };
      });
      return { ops, signed: lines.some((l) => l.words.some(isMark)) };
    }

    // Строка из колонок: левая, центральная и правая части выровнены по нижнему краю.
    const count = block.cells.length;
    const cellWidth = frame.width / count;
    const cells = block.cells.map((runs, i) => {
      const words = toWords(ctx, runs, data, block.size, false);
      const align = count === 1 ? 'left' : i === 0 ? 'left' : i === count - 1 ? 'right' : 'center';
      return { lines: breakLines(words, cellWidth, 0, space), align, x: frame.x + i * cellWidth };
    });
    const textHeight = Math.max(...cells.map((c) => c.lines.length)) * lh;
    const hasSignature = cells.some((c) => c.lines.some((l) => l.words.some((w) => w.image === 'signature')));
    const height = Math.max(textHeight, hasSignature ? SIG_H + lh * 0.35 : 0);
    const signed = cells.some((c) => c.lines.some((l) => l.words.some(isMark)));
    return { ops: [{ type: 'row', cells, size: block.size, space, cellWidth, height, lh }], signed };
  }

  /** Блок колонок: каждая колонка — отдельный столбец строк, весь блок не разрывается между листами. */
  function columnsOps(ctx, block, data, frame) {
    let x = frame.x;
    let signed = false;
    const cols = block.columns.map((col, i) => {
      const colFrame = { x, width: frame.width * block.fractions[i] };
      x += colFrame.width;
      const ops = [];
      let y = 0;
      for (const inner of col.blocks) {
        const item = blockOps(ctx, inner, data, colFrame);
        signed = signed || Boolean(item.signed);
        for (const op of item.ops) {
          op.y = y;
          ops.push(op);
          y += op.height;
        }
      }
      return { ops, height: y, valign: col.valign };
    });
    const height = Math.max(0, ...cols.map((c) => c.height));
    for (const col of cols) {
      const shift = col.valign === 'middle' ? (height - col.height) / 2 : col.valign === 'bottom' ? height - col.height : 0;
      col.ops.forEach((op) => { op.y += shift; });
    }
    return { ops: [{ type: 'columns', cols, height }], signed };
  }

  function layout(ctx, data) {
    const { margin } = data;
    const frame = { x: margin.left, width: PAGE_W - margin.left - margin.right };
    const items = data.model.blocks.map((block) => blockOps(ctx, block, data, frame));
    // Блок подписи не отрывается от предыдущего абзаца (обычно — должности подписывающего, до пустой строки).
    items.forEach((item, i) => {
      if (!item.signed) return;
      let seenText = false;
      for (let j = i - 1; j >= 0; j--) {
        if (items[j].blank && seenText) break;
        items[j].keep = true;
        if (!items[j].blank) seenText = true;
      }
    });

    const pages = [[]];
    const limit = PAGE_H - margin.bottom;
    let y = margin.top;
    const newPage = () => { pages.push([]); y = margin.top; };

    items.forEach((item, i) => {
      if (item.blank && !pages[pages.length - 1].length) return;
      // Цепочка «держать вместе» переносится целиком, если помещается на чистую страницу.
      if (i === 0 || !items[i - 1].keep) {
        let chain = 0;
        for (let j = i; j < items.length; j++) {
          chain += items[j].ops.reduce((sum, op) => sum + op.height, 0);
          if (!items[j].keep) break;
        }
        if (y + chain > limit && pages[pages.length - 1].length && chain <= limit - margin.top) newPage();
      }
      for (const op of item.ops) {
        if (y + op.height > limit && pages[pages.length - 1].length) newPage();
        if (op.type === 'space' && !pages[pages.length - 1].length) continue;
        // Герб первой строкой листа поднимается в верхнее поле, текст начинается сразу под ним.
        if (op.emblem && !pages[pages.length - 1].length) y = Math.min(y, EMBLEM_TOP);
        op.y = y;
        pages[pages.length - 1].push(op);
        y += op.height;
      }
    });
    return pages;
  }

  /* ---------- Рисование ---------- */

  function drawWord(ctx, word, x, baseline, size, data) {
    if (word.image === 'emblem') {
      // Знак занимает строку целиком: верх строки = базовая линия − высота строки + высота текста.
      const top = baseline - size * 0.93 + lineHeight(size) - word.height - EMBLEM_GAP;
      if (data.emblem) ctx.drawImage(data.emblem, x, top, word.width, word.height);
      return;
    }
    if (word.image === 'stamp') {
      if (data.stamp) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.9;
        ctx.drawImage(data.stamp, x - STAMP * 0.75, baseline - SIG_H / 2 - STAMP / 2, STAMP, STAMP);
        ctx.restore();
      }
      return;
    }
    if (word.image === 'signature') {
      const top = baseline - SIG_H + size * 0.35;
      if (data.signature) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply'; // белый фон подписи не виден на листе
        ctx.drawImage(data.signature, x, top, word.width, SIG_H);
        ctx.restore();
      } else if (data.highlight) {
        ctx.save();
        ctx.strokeStyle = '#C9A227';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x, top + 6, word.width, SIG_H - 12);
        ctx.fillStyle = '#9A7B12';
        ctx.font = `italic ${size * 0.8}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('подпись', x + word.width / 2, top + SIG_H / 2 + 4);
        ctx.restore();
      }
      return;
    }
    let px = x;
    for (const piece of word.pieces) {
      if (data.highlight && piece.kind !== 'text') {
        ctx.fillStyle = piece.empty ? 'rgba(255, 214, 102, 0.55)' : piece.kind === 'date' ? 'rgba(150, 205, 160, 0.4)' : 'rgba(255, 230, 140, 0.45)';
        ctx.fillRect(px - 1, baseline - size * 0.82, piece.width + 2, size * 1.08);
      }
      ctx.font = fontOf(piece, size);
      ctx.fillStyle = piece.empty ? '#8A6D0B' : '#000';
      ctx.fillText(piece.text, px, baseline);
      px += piece.width;
    }
  }

  function drawLine(ctx, line, x, width, baseline, align, last, size, space, data) {
    const count = line.words.length;
    let gap = space;
    let cursor = x;
    if (align === 'justify' && !last && count > 1) gap = space + (width - line.width) / (count - 1);
    else if (align === 'center') cursor = x + (width - line.width) / 2;
    else if (align === 'right') cursor = x + width - line.width;
    // Печать рисуется первой, чтобы подпись и текст ложились поверх неё.
    let probe = cursor;
    for (const word of line.words) {
      if (word.image === 'stamp') drawWord(ctx, word, probe, baseline, size, data);
      probe += word.width + gap;
    }
    for (const word of line.words) {
      if (word.image !== 'stamp') drawWord(ctx, word, cursor, baseline, size, data);
      cursor += word.width + gap;
    }
  }

  function drawOp(ctx, op, top, data) {
    if (op.type === 'line') {
      const baseline = top + op.height - lineHeight(op.size) + op.size * 0.93;
      drawLine(ctx, op.line, op.x, op.width, baseline, op.align, op.last, op.size, op.space, data);
    } else if (op.type === 'row') {
      for (const cell of op.cells) {
        const cellTop = top + op.height - cell.lines.length * op.lh;
        cell.lines.forEach((line, i) => {
          const baseline = cellTop + i * op.lh + op.size * 0.93;
          drawLine(ctx, line, cell.x, op.cellWidth, baseline, cell.align, true, op.size, op.space, data);
        });
      }
    } else if (op.type === 'columns') {
      for (const col of op.cols) {
        for (const inner of col.ops) drawOp(ctx, inner, top + inner.y, data);
      }
    }
  }

  function drawPage(ops, index, total, scale, data) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_W * scale);
    canvas.height = Math.round(PAGE_H * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'alphabetic';

    for (const op of ops) drawOp(ctx, op, op.y, data);

    if (total > 1) {
      ctx.font = `${11 * PT}px ${FONT}`;
      ctx.fillStyle = '#555';
      ctx.textAlign = 'right';
      ctx.fillText(`Стр. ${index + 1}`, PAGE_W - data.margin.right, PAGE_H - data.margin.bottom / 2);
      ctx.textAlign = 'left';
    }
    return canvas;
  }

  /* ---------- Загрузка ресурсов ---------- */

  const imageCache = new Map();
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }));
    }
    return imageCache.get(url);
  }

  let fontsReady = null;
  function ensureFonts() {
    if (!fontsReady) {
      fontsReady = document.fonts
        ? Promise.all([`${BASE}px "PT Serif"`, `bold ${BASE}px "PT Serif"`, `italic ${BASE}px "PT Serif"`].map((f) => document.fonts.load(f).catch(() => null)))
        : Promise.resolve();
    }
    return fontsReady;
  }

  const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  /**
   * Рисует документ. options: { body | model, values, dates (ISO), signatureUrl, highlight, scale }.
   * Возвращает массив холстов (по странице на холст).
   */
  async function render(options) {
    await ensureFonts();
    const model = options.model || parse(options.body);
    const [signature, stamp, emblem] = await Promise.all([loadImage(options.signatureUrl), loadImage(STAMP_URL), loadImage(EMBLEM_URL)]);
    const data = {
      model,
      margin: model.margin || MARGIN,
      values: options.values || {},
      dates: options.dates || [],
      today: todayIso(),
      signature,
      stamp,
      emblem,
      highlight: Boolean(options.highlight),
    };
    const measure = document.createElement('canvas').getContext('2d');
    const scale = options.scale || 1;
    try {
      lineFactor = LINE;
      let pages = layout(measure, data);
      if (pages.length === 2) {
        for (const factor of FIT_LINES) {
          lineFactor = factor;
          const fitted = layout(measure, data);
          if (fitted.length === 1) { pages = fitted; break; }
        }
        if (pages.length > 1) {
          lineFactor = LINE;
          pages = layout(measure, data);
        }
      }
      return pages.map((ops, i) => drawPage(ops, i, pages.length, scale, data));
    } finally {
      lineFactor = LINE;
    }
  }

  /** PNG всего документа: страницы одна под другой. */
  async function toPngBlob(options) {
    const pages = await render({ ...options, highlight: false, scale: 2 });
    const gap = 24;
    const canvas = document.createElement('canvas');
    canvas.width = pages[0].width;
    canvas.height = pages.reduce((sum, p) => sum + p.height, 0) + gap * (pages.length - 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#D5D9D0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const page of pages) {
      ctx.drawImage(page, 0, y);
      y += page.height + gap;
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { parse, render, toPngBlob, download, todayIso, formatDate, isNumberField, NUMBER_RE, PAGE_W, PAGE_H };
})();
