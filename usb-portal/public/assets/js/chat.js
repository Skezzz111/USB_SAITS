// Чат сотрудников на главной: история с подгрузкой, отправка, правка и удаление,
// модерация и очистка чата для администраторов.
(function () {
  const { api, el, avatar, toast, me: mePromise, moderate, unmute, formatDate, formatRemaining } = window.Portal;
  const root = document.querySelector('[data-chat]');
  if (!root) return;

  const list = root.querySelector('[data-chat-list]');
  const empty = root.querySelector('[data-chat-empty]');
  const form = root.querySelector('[data-chat-form]');
  const input = root.querySelector('[data-chat-input]');
  const send = root.querySelector('[data-chat-send]');
  const counter = root.querySelector('[data-chat-counter]');
  const muteBox = root.querySelector('[data-chat-mute]');
  const totalLabel = root.querySelector('[data-chat-total]');
  const clearButton = root.querySelector('[data-chat-clear]');

  const POLL_MS = 3000;
  const PAGE = 50;
  const MAX_LENGTH = 1000;
  const ICONS = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    unmute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  };

  let version = null;
  let limit = PAGE;          // сколько последних сообщений истории показываем
  let messages = [];
  let total = 0;
  let hasMore = false;
  let myMute = null;
  let editingId = null;
  let firstRender = true;
  let loadingOlder = false;
  let muteTimer = null;
  const cache = new Map();   // ключ элемента ленты → { sig, node }

  /* ---------- Загрузка ---------- */

  async function load(force, options = {}) {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (!force && version !== null) params.set('since', String(version));
      const data = await api(`/chat?${params}`);
      if (data.unchanged) return;
      // Пришли новые сообщения — расширяем окно, чтобы уже подгруженная история не исчезала сверху.
      if (total && data.total > total && data.hasMore) {
        limit += data.total - total;
        total = data.total;
        return load(true, options);
      }
      version = data.version;
      messages = data.messages;
      total = data.total;
      hasMore = data.hasMore;
      myMute = data.me.mute;
      clearButton.hidden = !data.me.canClear;
      totalLabel.textContent = `В истории: ${total}`;
      renderMute();
      if (editingId === null) render(options);
    } catch {
      // сеть недоступна — попробуем при следующем опросе
    }
  }

  // Подгружает более ранние сообщения и сохраняет положение прокрутки.
  async function loadOlder() {
    if (loadingOlder || !hasMore || editingId !== null) return;
    loadingOlder = true;
    const prevHeight = list.scrollHeight;
    const prevTop = list.scrollTop;
    limit += PAGE;
    await load(true, { keepPosition: true });
    list.scrollTop = list.scrollHeight - prevHeight + prevTop;
    loadingOlder = false;
  }

  /* ---------- Отрисовка ---------- */

  const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

  function dayLabel(date) {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (dayKey(date) === dayKey(today)) return 'Сегодня';
    if (dayKey(date) === dayKey(yesterday)) return 'Вчера';
    return dayFormat.format(date);
  }

  function iconButton(label, icon, onclick, danger) {
    const button = el('button', {
      class: `msg__action${danger ? ' msg__action--danger' : ''}`, type: 'button', 'aria-label': label, title: label, onclick,
    });
    button.innerHTML = `<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`;
    return button;
  }

  function actions(m) {
    const a = m.author;
    const buttons = [];
    if (m.canEdit) buttons.push(iconButton('Изменить сообщение', ICONS.edit, () => startEdit(m)));
    if (m.canDelete) buttons.push(iconButton('Удалить сообщение', ICONS.trash, () => removeMessage(m), true));
    if (m.canModerate && a) {
      buttons.push(iconButton(`Предупреждение: ${a.fullName}`, ICONS.warn, () => moderate('warn', a, () => load(true))));
      buttons.push(a.muted
        ? iconButton(`Снять мут: ${a.fullName}`, ICONS.unmute, () => unmute(a, () => load(true)))
        : iconButton(`Мут: ${a.fullName}`, ICONS.mute, () => moderate('mute', a, () => load(true)), true));
    }
    return buttons.length ? el('div', { class: 'msg__actions' }, buttons) : null;
  }

  function editForm(m) {
    const area = el('textarea', { class: 'input msg__edit-input', maxlength: String(MAX_LENGTH), 'aria-label': 'Текст сообщения' });
    area.value = m.text;
    const save = () => saveEdit(m, area.value);
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
    });
    return el('div', { class: 'msg__edit' },
      area,
      el('div', { class: 'msg__edit-actions' },
        el('button', { class: 'btn btn--sm', type: 'button', onclick: save }, 'Сохранить'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: cancelEdit }, 'Отмена'),
        el('span', { class: 'msg__hint' }, 'Enter — сохранить, Esc — отмена')));
  }

  function messageNode(m) {
    const time = el('time', { class: 'msg__time', datetime: m.createdAt, title: formatDate(m.createdAt), text: timeFormat.format(new Date(m.createdAt)) });
    if (m.type === 'system') {
      return el('div', { class: 'msg msg--system' }, el('span', { class: 'msg__system-text', text: m.text }), time, actions(m));
    }
    const a = m.author;
    return el('article', { class: `msg${m.own ? ' msg--own' : ''}` },
      avatar(a, 'avatar--md'),
      el('div', { class: 'msg__body' },
        el('div', { class: 'msg__meta' },
          el('strong', { class: 'msg__name', text: a ? a.fullName : 'Профиль удалён' }),
          a && a.rank ? el('span', { class: 'msg__rank', text: a.rank }) : null,
          a && a.role === 'admin' ? el('span', { class: 'msg__badge', text: 'админ' }) : null,
          a && a.muted ? el('span', { class: 'msg__badge msg__badge--muted', text: 'мут' }) : null,
          time,
          m.editedAt ? el('span', { class: 'msg__edited', text: m.editedByAdmin ? 'изменено администратором' : 'изменено' }) : null),
        m.id === editingId ? editForm(m) : el('p', { class: 'msg__text', text: m.text })),
      actions(m));
  }

  function historyNode() {
    if (!hasMore) return el('p', { class: 'chat__history chat__history--start' }, 'Начало истории чата');
    return el('div', { class: 'chat__history' },
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: loadOlder }, 'Показать более ранние сообщения'));
  }

  // Элементы ленты: кнопка истории, разделители дней и сообщения. Неизменившиеся узлы переиспользуются,
  // чтобы лента не «прыгала» и экранные дикторы не перечитывали её целиком.
  function items() {
    const result = [{ key: 'history', sig: `history:${hasMore}`, build: historyNode }];
    let lastDay = null;
    for (const m of messages) {
      const date = new Date(m.createdAt);
      const day = dayKey(date);
      if (day !== lastDay) {
        const label = dayLabel(date);
        result.push({ key: `day:${day}`, sig: label, build: () => el('div', { class: 'chat__day', role: 'separator' }, el('span', { text: label })) });
        lastDay = day;
      }
      result.push({ key: m.id, sig: JSON.stringify(m) + (m.id === editingId ? ':edit' : ''), build: () => messageNode(m) });
    }
    return result;
  }

  function render(options = {}) {
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    const seen = new Set();
    const nodes = items().map((item) => {
      let entry = cache.get(item.key);
      if (!entry || entry.sig !== item.sig) {
        entry = { sig: item.sig, node: item.build() };
        cache.set(item.key, entry);
      }
      seen.add(item.key);
      return entry.node;
    });
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);

    nodes.forEach((node, i) => {
      if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
    });
    while (list.children.length > nodes.length) list.lastElementChild.remove();

    empty.hidden = messages.length > 0;
    if (!options.keepPosition && (firstRender || nearBottom)) list.scrollTop = list.scrollHeight;
    firstRender = false;
  }

  function renderMute() {
    clearTimeout(muteTimer);
    const muted = Boolean(myMute && Date.parse(myMute.until) > Date.now());
    muteBox.hidden = !muted;
    input.disabled = muted;
    send.disabled = muted;
    input.placeholder = muted ? 'Отправка сообщений недоступна' : 'Напишите сообщение…';
    if (!muted) return;

    muteBox.replaceChildren(
      el('strong', { text: `У вас мут до ${formatDate(myMute.until)} — осталось ${formatRemaining(myMute.until)}` }),
      el('span', { text: `Причина: ${myMute.reason}` }),
      el('span', { text: `Выдал: ${myMute.by}${myMute.auto ? ' (автоматически)' : ''}` }));
    // Обновляем остаток раз в минуту и снимаем блокировку, как только мут истечёт.
    muteTimer = setTimeout(() => load(true), Math.min(Date.parse(myMute.until) - Date.now() + 500, 60000));
  }

  /* ---------- Действия ---------- */

  function startEdit(m) {
    editingId = m.id;
    render({ keepPosition: true });
    const area = list.querySelector('.msg__edit-input');
    if (area) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }

  function cancelEdit() {
    editingId = null;
    load(true, { keepPosition: true });
  }

  async function saveEdit(m, value) {
    const text = value.trim();
    if (!text) return toast('Сообщение не может быть пустым', 'error');
    try {
      await api(`/chat/${m.id}`, { method: 'PATCH', body: { text } });
      editingId = null;
      await load(true, { keepPosition: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removeMessage(m) {
    if (!window.confirm('Удалить сообщение?')) return;
    try {
      await api(`/chat/${m.id}`, { method: 'DELETE' });
      if (editingId === m.id) editingId = null;
      await load(true, { keepPosition: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  clearButton.addEventListener('click', async () => {
    if (!window.confirm(`Очистить чат? Будут удалены все сообщения (${total}) без возможности восстановления.`)) return;
    clearButton.disabled = true;
    try {
      await api('/chat', { method: 'DELETE' });
      editingId = null;
      limit = PAGE;
      total = 0;
      await load(true);
      toast('Чат очищен');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      clearButton.disabled = false;
    }
  });

  list.addEventListener('scroll', () => {
    if (list.scrollTop < 40) loadOlder();
  });

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    counter.textContent = `${input.value.length}/${MAX_LENGTH}`;
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    try {
      await api('/chat', { method: 'POST', body: { text } });
      input.value = '';
      autosize();
      await load(true);
      list.scrollTop = list.scrollHeight;
    } catch (err) {
      toast(err.message, 'error');
      load(true);
    } finally {
      send.disabled = input.disabled;
      input.focus();
    }
  });

  /* ---------- Запуск ---------- */

  mePromise.then((user) => {
    if (!user) return;
    load(true);
    setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  });
})();
