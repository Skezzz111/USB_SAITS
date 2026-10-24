// Админ-панель: документооборот (отправленные документы) и шаблоны документов.
(function () {
  const { api, el, toast, formatDate, me } = window.Portal;
  const R = window.DocRender;
  const { confirmAction } = window.AdminUI;
  const $ = (id) => document.getElementById(id);

  /* ---------- Документооборот ---------- */

  const docSearch = $('doc-search');
  const docRows = $('doc-rows');
  const docEmpty = $('doc-empty');
  const docDialog = $('doc-dialog');
  let openDoc = null;

  async function loadDocuments() {
    const query = docSearch.value.trim();
    try {
      const { documents, unread } = await api(`/documents${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (query !== docSearch.value.trim()) return;
      docRows.replaceChildren(...documents.map(docRow));
      $('doc-count').textContent = `Документов: ${documents.length}`;
      docEmpty.textContent = query ? 'По запросу ничего не найдено.' : 'Сотрудники ещё не отправляли документы.';
      docEmpty.hidden = documents.length > 0;
      const badge = $('docs-unread');
      badge.textContent = String(unread);
      badge.hidden = !unread;
      badge.setAttribute('aria-label', `новых: ${unread}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function docRow(doc) {
    const author = doc.author;
    return el('tr', {},
      el('td', { class: 'cell-main' },
        el('div', { class: 'doc-cell' },
          el('strong', { text: doc.title }),
          doc.viewed ? null : el('span', { class: 'tag doc-new', text: 'Новый' }))),
      el('td', { class: 'doc-number', 'data-label': 'Номер', text: doc.number ? `№ ${doc.number}` : '—' }),
      el('td', { 'data-label': 'Автор' },
        el('span', { text: author ? author.fullName : 'Профиль удалён' }),
        author ? el('small', { class: 'cell-sub', text: [author.rank, author.position].filter(Boolean).join(', ') }) : null),
      el('td', { 'data-label': 'Отправлен', text: formatDate(doc.createdAt) }),
      el('td', { class: 'cell-actions' },
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn btn--sm', type: 'button', onclick: () => openDocument(doc.id), 'aria-label': `Открыть: ${doc.title}` }, 'Открыть'),
          el('button', { class: 'btn btn--danger-ghost btn--sm', type: 'button', onclick: () => deleteDocument(doc), 'aria-label': `Удалить: ${doc.title}` }, 'Удалить'))));
  }

  const docData = (doc) => ({ body: doc.body, values: doc.values, dates: doc.dates, signatureUrl: doc.signatureUrl });

  async function openDocument(id) {
    try {
      const { document: doc } = await api(`/documents/${id}`);
      openDoc = doc;
      $('doc-dialog-title').textContent = `${doc.title}${doc.number ? ` № ${doc.number}` : ''}`;
      $('doc-dialog-meta').textContent = `${doc.author ? doc.author.fullName : 'Профиль удалён'} · ${formatDate(doc.createdAt)}`;
      const box = $('doc-dialog-preview');
      box.replaceChildren(el('p', { class: 'status', text: 'Загрузка…' }));
      docDialog.showModal();
      const width = Math.min(box.clientWidth || 760, 900);
      const pages = await R.render({ ...docData(doc), scale: (width / R.PAGE_W) * (window.devicePixelRatio || 1) });
      pages.forEach((p) => { p.className = 'doc-page'; });
      box.replaceChildren(...pages);
      loadDocuments();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteDocument(doc) {
    const ok = await confirmAction('Удалить документ?', `«${doc.title}»${doc.number ? ` № ${doc.number}` : ''} будет удалён без возможности восстановления.`);
    if (!ok) return;
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      if (openDoc && openDoc.id === doc.id) docDialog.close();
      toast('Документ удалён');
      loadDocuments();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  $('doc-dialog-download').addEventListener('click', async () => {
    if (!openDoc) return;
    const blob = await R.toPngBlob(docData(openDoc));
    R.download(blob, `${openDoc.title}${openDoc.number ? ` № ${openDoc.number}` : ''}.png`.replace(/[\\/:*?"<>|]/g, '_'));
  });
  $('doc-dialog-delete').addEventListener('click', () => openDoc && deleteDocument(openDoc));
  docDialog.querySelectorAll('[data-doc-close]').forEach((b) => b.addEventListener('click', () => docDialog.close()));

  let searchTimer;
  docSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadDocuments, 250);
  });

  /* ---------- Шаблоны ---------- */

  const tplList = $('tpl-list');
  const tplDialog = $('tpl-dialog');
  const tplForm = $('tpl-form');
  const tplBody = $('tpl-body');
  const tplError = $('tpl-error');
  let editingTemplate = null;
  let templates = [];

  async function loadTemplates() {
    try {
      ({ templates } = await api('/documents/templates'));
      if (!templates.length) {
        tplList.replaceChildren(el('p', { class: 'empty', text: 'Шаблонов пока нет.' }));
        return;
      }
      tplList.replaceChildren(...templates.map((tpl) => {
        const parsed = R.parse(tpl.body);
        return el('article', { class: 'admin-news-item' },
          el('div', { class: 'admin-news-item__main' },
            el('h3', { class: 'admin-news-item__title', text: tpl.title }),
            tpl.description ? el('p', { class: 'admin-news-item__text', text: tpl.description }) : null,
            el('p', { class: 'cell-sub', text: `Полей: ${parsed.fields.length} · дат: ${parsed.dates.length}${parsed.signature ? ' · с подписью' : ''} · изменён ${formatDate(tpl.updatedAt)}` })),
          el('div', { class: 'row-actions' },
            el('a', { class: 'btn btn--ghost btn--sm', href: `/constructor.html?t=${encodeURIComponent(tpl.id)}` }, 'В конструкторе'),
            el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => openTemplate(tpl) }, 'Изменить'),
            el('button', { class: 'btn btn--danger-ghost btn--sm', type: 'button', onclick: () => deleteTemplate(tpl) }, 'Удалить')));
      }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  let previewFrame = null;
  function schedulePreview() {
    cancelAnimationFrame(previewFrame);
    previewFrame = requestAnimationFrame(async () => {
      const box = $('tpl-preview');
      const width = box.clientWidth || 420;
      try {
        const pages = await R.render({ body: tplBody.value, highlight: true, scale: (width / R.PAGE_W) * (window.devicePixelRatio || 1) });
        pages.forEach((p) => { p.className = 'doc-page'; });
        box.replaceChildren(...pages);
      } catch {
        // некорректная разметка во время набора — просто не обновляем предпросмотр
      }
    });
  }

  function openTemplate(tpl) {
    editingTemplate = tpl;
    tplForm.reset();
    tplError.hidden = true;
    $('tpl-dialog-title').textContent = tpl ? 'Изменение шаблона' : 'Новый шаблон';
    $('tpl-title').value = tpl ? tpl.title : '';
    $('tpl-description').value = tpl ? tpl.description || '' : '';
    tplBody.value = tpl ? tpl.body : '';
    tplDialog.showModal();
    schedulePreview();
    $('tpl-title').focus();
  }

  async function deleteTemplate(tpl) {
    const ok = await confirmAction('Удалить шаблон?', `Шаблон «${tpl.title}» исчезнет из конструктора. Уже отправленные документы не изменятся.`);
    if (!ok) return;
    try {
      await api(`/documents/templates/${tpl.id}`, { method: 'DELETE' });
      toast('Шаблон удалён');
      loadTemplates();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  tplBody.addEventListener('input', schedulePreview);
  $('tpl-create').addEventListener('click', () => openTemplate(null));
  tplDialog.querySelectorAll('[data-tpl-close]').forEach((b) => b.addEventListener('click', () => tplDialog.close()));

  tplForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    tplError.hidden = true;
    const payload = { title: $('tpl-title').value.trim(), description: $('tpl-description').value.trim(), body: tplBody.value };
    const submit = $('tpl-submit');
    submit.disabled = true;
    try {
      if (editingTemplate) await api(`/documents/templates/${editingTemplate.id}`, { method: 'PATCH', body: payload });
      else await api('/documents/templates', { method: 'POST', body: payload });
      tplDialog.close();
      toast(editingTemplate ? 'Шаблон сохранён' : 'Шаблон добавлен');
      loadTemplates();
    } catch (err) {
      tplError.textContent = err.message;
      tplError.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  /* ---------- Запуск ---------- */

  me.then((user) => {
    if (!user || user.role !== 'admin') return;
    loadDocuments();
    loadTemplates();
  });
})();
