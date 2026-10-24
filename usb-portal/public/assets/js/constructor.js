// Конструктор документов: выбор шаблона, заполнение полей, предпросмотр, PNG и отправка в документооборот.
(function () {
  const { api, el, toast, me: mePromise } = window.Portal;
  const R = window.DocRender;
  const $ = (id) => document.getElementById(id);

  const select = $('tpl-select');
  const form = $('doc-form');
  const preview = $('doc-preview');
  const highlightBox = $('doc-highlight');
  const sendButton = $('doc-send');
  const downloadButton = $('doc-download');
  const errorBox = $('doc-error');

  let user = null;
  let meta = null;
  let templates = [];
  let current = null;
  let model = null;
  let values = {};
  let dates = [];
  let sentSnapshot = null;

  /* ---------- Подстановка данных автора ---------- */

  const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');

  function initials(u) {
    const letters = [u.firstName, u.middleName].filter(Boolean).map((p) => `${p.charAt(0).toUpperCase()}.`).join('');
    return `${letters} ${u.lastName}`.trim();
  }

  /** Своё значение по названию поля: номер документа, ФИО, звание, должность, инициалы. */
  function prefill(key) {
    const k = key.trim().toLowerCase();
    if (R.isNumberField(key)) return meta.nextNumber;
    if (k === 'фамилия имя отчество' || k === 'фио') return user.fullName;
    if (k === 'звание') return lowerFirst(user.rank);
    if (k === 'должность') return lowerFirst(user.position);
    if (k === 'инициалы') return initials(user);
    return '';
  }

  const labelFor = (key) => (R.NUMBER_RE.test(key.trim()) ? 'Номер документа' : key);
  // Длинные поля (описание ситуации и т. п.) — многострочные.
  const isLongField = (key) => key.length > 40 || /описани/i.test(key);

  /* ---------- Форма ---------- */

  function missing() {
    return model.fields.filter((key) => !String(values[key] || '').trim());
  }

  const signatureMissing = () => model.signature && !user.signatureUrl;

  function updateStatus() {
    const left = missing();
    $('doc-progress').textContent = left.length
      ? `Заполнено ${model.fields.length - left.length} из ${model.fields.length}`
      : 'Все поля заполнены';
    const blocked = left.length > 0 || signatureMissing();
    sendButton.disabled = blocked;
    downloadButton.disabled = blocked;
  }

  function buildFields() {
    $('doc-fields').replaceChildren(...model.fields.map((key, i) => {
      const id = `fld-${i}`;
      const input = isLongField(key)
        ? el('textarea', { class: 'textarea', id, rows: '4', maxlength: '2000' })
        : el('input', { class: 'input', id, type: 'text', maxlength: '500', autocomplete: 'off' });
      input.value = values[key] || '';
      input.addEventListener('input', () => {
        values[key] = input.value;
        updateStatus();
        scheduleRender();
      });
      const auto = prefill(key);
      let hint = null;
      if (R.isNumberField(key)) hint = 'Проставлен автоматически по правилу ггд-дмм-X (год, день, месяц, номер за сегодня).';
      else if (auto) hint = 'Подставлено из профиля — при необходимости исправьте.';
      return el('div', { class: 'field' },
        el('label', { class: 'field__label', for: id }, labelFor(key)),
        input,
        hint ? el('span', { class: 'field__hint', text: hint }) : null);
    }));

    const datesBox = $('doc-dates-box');
    datesBox.hidden = !model.dates.length;
    $('doc-dates').replaceChildren(...model.dates.map((date, i) => {
      const id = `date-${i}`;
      const input = el('input', { class: 'input', id, type: 'date', value: dates[i] });
      input.addEventListener('change', () => {
        dates[i] = input.value || meta.today;
        scheduleRender();
      });
      return el('div', { class: 'field' },
        el('label', { class: 'field__label', for: id }, `Дата ${i + 1}`),
        input,
        el('span', { class: 'field__hint', text: `В образце: ${date.sample}` }));
    }));

    const sig = $('doc-signature');
    if (!model.signature) {
      sig.replaceChildren();
    } else if (user.signatureUrl) {
      sig.replaceChildren(el('div', { class: 'doc-signature' },
        el('span', { class: 'signature-thumb' }, el('img', { src: user.signatureUrl, alt: 'Ваша подпись' })),
        el('span', {}, 'Подпись из профиля будет поставлена автоматически. ',
          el('a', { class: 'text-link', href: '/profile.html' }, 'Изменить'))));
    } else {
      sig.replaceChildren(el('p', { class: 'alert' },
        'В профиле нет подписи — без неё документ не отправить. ',
        el('a', { class: 'text-link', href: '/profile.html' }, 'Загрузить или нарисовать подпись')));
    }
    updateStatus();
  }

  function selectTemplate(id) {
    current = templates.find((t) => t.id === id) || templates[0];
    model = R.parse(current.body);
    values = {};
    for (const key of model.fields) {
      const auto = prefill(key);
      if (auto) values[key] = auto;
    }
    dates = model.dates.map(() => meta.today);
    select.value = current.id;
    $('tpl-desc').textContent = current.description || '';
    errorBox.hidden = true;
    form.hidden = false;
    buildFields();
    scheduleRender();
  }

  /* ---------- Предпросмотр ---------- */

  let frame = null;
  let renderToken = 0;
  function scheduleRender() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderPreview);
  }

  async function renderPreview() {
    if (!model) return;
    const token = ++renderToken;
    const width = preview.clientWidth || R.PAGE_W;
    const pages = await R.render({
      model, values, dates, signatureUrl: user.signatureUrl,
      highlight: highlightBox.checked,
      scale: (width / R.PAGE_W) * (window.devicePixelRatio || 1),
    });
    if (token !== renderToken) return;
    pages.forEach((page, i) => {
      page.className = 'doc-page';
      page.setAttribute('role', 'img');
      page.setAttribute('aria-label', `Страница ${i + 1} документа «${current.title}»`);
    });
    preview.replaceChildren(...pages);
  }

  highlightBox.addEventListener('change', scheduleRender);
  new ResizeObserver(() => scheduleRender()).observe(preview);

  /* ---------- Скачивание и отправка ---------- */

  function fileName(snapshot) {
    const numberKey = snapshot.model.fields.find((k) => R.isNumberField(k));
    const number = numberKey ? snapshot.values[numberKey] : '';
    return `${snapshot.title}${number ? ` № ${number}` : ''}.png`.replace(/[\\/:*?"<>|]/g, '_');
  }

  const snapshot = () => ({ title: current.title, model, values: { ...values }, dates: [...dates], signatureUrl: user.signatureUrl });

  async function downloadPng(data) {
    const blob = await R.toPngBlob(data);
    R.download(blob, fileName(data));
  }

  downloadButton.addEventListener('click', () => downloadPng(snapshot()));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    if (sendButton.disabled) return;
    sendButton.disabled = true;
    try {
      const data = snapshot();
      const { document: doc } = await api('/documents', { method: 'POST', body: { templateId: current.id, values: data.values, dates: data.dates } });
      sentSnapshot = data;
      $('sent-text').textContent = `Документ «${doc.title}»${doc.number ? ` № ${doc.number}` : ''} передан в документооборот — его увидят администраторы.`;
      $('sent-dialog').showModal();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      updateStatus();
    }
  });

  $('sent-download').addEventListener('click', () => sentSnapshot && downloadPng(sentSnapshot));
  $('sent-new').addEventListener('click', async () => {
    $('sent-dialog').close();
    meta = await api('/documents/meta');
    selectTemplate(current.id);
  });

  select.addEventListener('change', () => selectTemplate(select.value));

  /* ---------- Запуск ---------- */

  mePromise.then(async (u) => {
    if (!u) return;
    user = u;
    try {
      const [list, info] = await Promise.all([api('/documents/templates'), api('/documents/meta')]);
      templates = list.templates;
      meta = info;
      if (!templates.length) {
        select.replaceChildren(el('option', {}, 'Шаблонов пока нет'));
        preview.replaceChildren(el('p', { class: 'status', text: 'Администраторы ещё не добавили шаблоны документов.' }));
        return;
      }
      select.replaceChildren(...templates.map((t) => el('option', { value: t.id }, t.title)));
      select.disabled = false;
      const wanted = new URLSearchParams(location.search).get('t');
      selectTemplate(wanted && templates.some((t) => t.id === wanted) ? wanted : templates[0].id);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
})();
