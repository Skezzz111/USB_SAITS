// Админ-панель: профили сотрудников (поиск, создание, редактирование, удаление) и новости.
(function () {
  const { api, el, avatar, formatDate, toast, me: mePromise, showPassword, moderate, unmute } = window.Portal;
  const $ = (id) => document.getElementById(id);

  const LOGIN_RE = /^[A-Za-z0-9._-]{3,32}$/;
  const DISCORD_RE = /^[A-Za-z0-9_.]{2,32}$/;
  let me = null;

  /* ---------- Вкладки ---------- */

  const tabs = [...document.querySelectorAll('[role="tab"]')];

  function selectTab(tab, focus) {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
    history.replaceState(null, '', `#${tab.dataset.hash}`);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      selectTab(tabs[(index + step + tabs.length) % tabs.length], true);
    });
  });

  const initialTab = tabs.find((t) => `#${t.dataset.hash}` === location.hash);
  if (initialTab) selectTab(initialTab);

  /* ---------- Подтверждение ---------- */

  function confirmAction(title, text) {
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    dialog.returnValue = '';
    dialog.showModal();
    $('confirm-cancel').focus();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
  }

  $('confirm-ok').addEventListener('click', () => $('confirm-dialog').close('ok'));
  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close(''));

  // Общий диалог подтверждения нужен и разделу документов (admin-docs.js).
  window.AdminUI = { confirmAction };

  /* ---------- Профили: список и поиск ---------- */

  const search = $('user-search');
  const rows = $('user-rows');
  const empty = $('user-empty');

  async function loadUsers() {
    const query = search.value.trim();
    try {
      const { users } = await api(`/users${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (query !== search.value.trim()) return; // пока шёл запрос, поиск уже изменился
      rows.replaceChildren(...users.map(userRow));
      $('user-count').textContent = `Найдено: ${users.length}`;
      empty.textContent = query ? 'По запросу ничего не найдено.' : 'Профилей пока нет.';
      empty.hidden = users.length > 0;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function chatStatus(user) {
    if (user.mute) {
      return el('span', { class: 'tag tag--danger', title: `Причина: ${user.mute.reason}. Выдал: ${user.mute.by}` },
        `Мут до ${formatDate(user.mute.until)}`);
    }
    if (user.warnings.length) return el('span', { class: 'tag tag--muted' }, `Предупреждения: ${user.warnings.length}/3`);
    return el('span', { class: 'cell-dim' }, '—');
  }

  function moderationButtons(user) {
    if (user.role === 'admin') return [];
    const done = () => loadUsers();
    return [
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        'aria-label': `Предупреждение: ${user.fullName}`,
        onclick: () => moderate('warn', user, done),
      }, 'Пред.'),
      user.mute
        ? el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          'aria-label': `Снять мут: ${user.fullName}`,
          onclick: () => unmute(user, done),
        }, 'Снять мут')
        : el('button', {
          class: 'btn btn--danger-ghost btn--sm', type: 'button',
          'aria-label': `Мут: ${user.fullName}`,
          onclick: () => moderate('mute', user, done),
        }, 'Мут'),
    ];
  }

  function userRow(user) {
    const isMe = me && user.id === me.id;
    return el('tr', {},
      el('td', { class: 'cell-main' },
        el('div', { class: 'cell-user' },
          avatar(user, 'avatar--md'),
          el('div', {},
            el('strong', { text: user.fullName }),
            el('small', { text: isMe ? `${user.login} · это вы` : user.login })))),
      el('td', { 'data-label': 'Звание', text: user.rank }),
      el('td', { 'data-label': 'Должность', text: user.position }),
      el('td', { 'data-label': 'Discord', text: user.discord || '—' }),
      el('td', { 'data-label': 'Роль' },
        el('span', {
          class: user.role === 'admin' ? 'tag tag--gold' : 'tag tag--muted',
          text: user.role === 'admin' ? 'Администратор' : 'Сотрудник',
        })),
      el('td', { 'data-label': 'Чат' }, chatStatus(user)),
      el('td', { class: 'cell-actions' },
        el('div', { class: 'row-actions' },
          moderationButtons(user),
          el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            'aria-label': `Изменить профиль: ${user.fullName}`,
            onclick: () => openUserDialog(user),
          }, 'Изменить'),
          isMe ? null : el('button', {
            class: 'btn btn--danger-ghost btn--sm', type: 'button',
            'aria-label': `Удалить профиль: ${user.fullName}`,
            onclick: () => deleteUser(user),
          }, 'Удалить'))));
  }

  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadUsers, 200);
  });

  async function deleteUser(user) {
    const confirmed = await confirmAction(
      'Удалить профиль?',
      `Профиль «${user.fullName}» (${user.login}) будет удалён без возможности восстановления.`,
    );
    if (!confirmed) return;
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      toast('Профиль удалён');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Профили: создание и редактирование ---------- */

  const dialog = $('user-dialog');
  const form = $('user-form');
  const created = $('user-created');
  const formError = $('user-form-error');
  const FIELDS = ['login', 'lastName', 'firstName', 'middleName', 'rank', 'position', 'discord'];
  const field = (name) => $(`f-${name}`);
  let editing = null;

  function openUserDialog(user) {
    editing = user;
    form.reset();
    form.hidden = false;
    created.hidden = true;
    formError.hidden = true;
    dialog.setAttribute('aria-labelledby', 'user-dialog-title');

    $('user-dialog-title').textContent = user ? 'Редактирование профиля' : 'Новый профиль';
    $('user-submit').textContent = user ? 'Сохранить изменения' : 'Создать профиль';

    for (const name of FIELDS) field(name).value = user ? user[name] || '' : '';
    field('role').value = user ? user.role : 'user';

    const isMe = Boolean(user && me && user.id === me.id);
    field('role').disabled = isMe;
    $('f-role-hint').hidden = !isMe;

    field('password').required = !user;
    field('password').placeholder = user ? 'Оставьте пустым, чтобы не менять' : '';
    $('f-password-req').hidden = Boolean(user);
    $('f-password-hint').textContent = user
      ? 'Новый пароль — не менее 8 символов. Пустое поле — пароль не меняется.'
      : 'Не менее 8 символов. Кнопка справа сгенерирует надёжный пароль.';
    showPassword(field('password'), false);

    const hasAvatar = Boolean(user && user.avatarUrl);
    const hasBanner = Boolean(user && user.bannerUrl);
    $('f-images').hidden = !(hasAvatar || hasBanner);
    field('removeAvatar').closest('label').hidden = !hasAvatar;
    field('removeBanner').closest('label').hidden = !hasBanner;

    dialog.showModal();
    field('login').focus();
  }

  function validateUser(payload) {
    if (!LOGIN_RE.test(payload.login)) return 'Логин: 3–32 символа — латиница, цифры, точка, дефис или подчёркивание.';
    if (payload.password !== undefined && (payload.password.length < 8 || payload.password.length > 128)) {
      return 'Пароль: от 8 до 128 символов.';
    }
    if (!payload.lastName) return 'Укажите фамилию.';
    if (!payload.firstName) return 'Укажите имя.';
    if (!payload.rank) return 'Укажите звание.';
    if (!payload.position) return 'Укажите должность.';
    if (!DISCORD_RE.test(payload.discord)) return 'Логин Discord: 2–32 символа — латиница, цифры, точка или подчёркивание.';
    return null;
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
    formError.scrollIntoView({ block: 'nearest' });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.hidden = true;

    const payload = Object.fromEntries(FIELDS.map((name) => [name, field(name).value.trim()]));
    payload.role = field('role').value;
    const password = field('password').value;
    if (password || !editing) payload.password = password;
    if (editing) {
      payload.removeAvatar = field('removeAvatar').checked;
      payload.removeBanner = field('removeBanner').checked;
    }

    const problem = validateUser(payload);
    if (problem) return showFormError(problem);

    const submit = $('user-submit');
    submit.disabled = true;
    try {
      if (editing) {
        await api(`/users/${editing.id}`, { method: 'PATCH', body: payload });
        dialog.close();
        toast('Профиль обновлён');
        if (me && editing.id === me.id) {
          me = (await api('/auth/me')).user;
          window.Portal.setHeaderUser(me);
        }
      } else {
        const { user } = await api('/users', { method: 'POST', body: payload });
        showCreated(user, password);
      }
      loadUsers();
    } catch (err) {
      showFormError(err.message);
    } finally {
      submit.disabled = false;
    }
  });

  function showCreated(user, password) {
    form.hidden = true;
    created.hidden = false;
    dialog.setAttribute('aria-labelledby', 'user-created-title');
    $('c-name').textContent = user.fullName;
    $('c-login').textContent = user.login;
    $('c-password').textContent = password;
    $('c-copy').textContent = 'Скопировать данные';
    $('user-created-title').focus();
  }

  $('c-copy').addEventListener('click', async () => {
    const text = `Портал УСБ УВД по ЦАО\nЛогин: ${$('c-login').textContent}\nПароль: ${$('c-password').textContent}`;
    try {
      await navigator.clipboard.writeText(text);
      $('c-copy').textContent = 'Скопировано';
    } catch {
      $('c-copy').textContent = 'Не удалось — выделите вручную';
    }
  });

  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => {
    form.reset();
    $('c-password').textContent = '';
  });

  function generatePassword(length = 16) {
    const sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%^&*-_=+?'];
    const all = sets.join('');
    const random = (n) => {
      const buffer = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / n) * n;
      do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
      return buffer[0] % n;
    };
    const chars = sets.map((set) => set[random(set.length)]);
    while (chars.length < length) chars.push(all[random(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  $('f-generate').addEventListener('click', () => {
    field('password').value = generatePassword();
    showPassword(field('password'), true);
  });

  $('user-create').addEventListener('click', () => openUserDialog(null));

  /* ---------- Новости ---------- */

  const newsForm = $('news-form');
  const newsTitle = $('news-title');
  const newsBody = $('news-body');
  const newsError = $('news-error');
  const newsList = $('admin-news-list');
  let newsEditing = null;

  const updateCounter = () => { $('news-counter').textContent = `${newsBody.value.length} / 5000`; };
  newsBody.addEventListener('input', updateCounter);

  async function loadNews() {
    try {
      const { news } = await api('/news');
      if (!news.length) {
        newsList.replaceChildren(el('p', { class: 'empty', text: 'Новостей пока нет.' }));
        return;
      }
      newsList.replaceChildren(...news.map(newsItem));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function newsItem(item) {
    return el('article', { class: 'admin-news-item' },
      el('div', { class: 'admin-news-item__main' },
        el('time', { class: 'news-card__date', datetime: item.createdAt, text: formatDate(item.createdAt) }),
        el('h3', { class: 'admin-news-item__title', text: item.title }),
        el('p', { class: 'admin-news-item__text', text: item.body })),
      el('div', { class: 'row-actions' },
        el('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          'aria-label': `Изменить новость: ${item.title}`,
          onclick: () => startNewsEdit(item),
        }, 'Изменить'),
        el('button', {
          class: 'btn btn--danger-ghost btn--sm', type: 'button',
          'aria-label': `Удалить новость: ${item.title}`,
          onclick: () => deleteNews(item),
        }, 'Удалить')));
  }

  function startNewsEdit(item) {
    newsEditing = item;
    newsTitle.value = item.title;
    newsBody.value = item.body;
    updateCounter();
    newsError.hidden = true;
    $('news-form-label').textContent = 'Редактирование новости';
    $('news-submit').textContent = 'Сохранить изменения';
    $('news-cancel').hidden = false;
    newsForm.scrollIntoView({ block: 'start', behavior: 'smooth' });
    newsTitle.focus({ preventScroll: true });
  }

  function resetNewsForm() {
    newsEditing = null;
    newsForm.reset();
    updateCounter();
    newsError.hidden = true;
    $('news-form-label').textContent = 'Новая новость';
    $('news-submit').textContent = 'Опубликовать';
    $('news-cancel').hidden = true;
  }

  $('news-cancel').addEventListener('click', resetNewsForm);

  newsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    newsError.hidden = true;
    const payload = { title: newsTitle.value.trim(), body: newsBody.value.trim() };
    let problem = null;
    if (!payload.title) problem = 'Введите заголовок';
    else if (!payload.body) problem = 'Введите текст новости';
    if (problem) {
      newsError.textContent = problem;
      newsError.hidden = false;
      return;
    }

    $('news-submit').disabled = true;
    try {
      if (newsEditing) {
        await api(`/news/${newsEditing.id}`, { method: 'PATCH', body: payload });
        toast('Новость обновлена');
      } else {
        await api('/news', { method: 'POST', body: payload });
        toast('Новость опубликована');
      }
      resetNewsForm();
      loadNews();
    } catch (err) {
      newsError.textContent = err.message;
      newsError.hidden = false;
    } finally {
      $('news-submit').disabled = false;
    }
  });

  async function deleteNews(item) {
    const confirmed = await confirmAction('Удалить новость?', `Новость «${item.title}» будет удалена без возможности восстановления.`);
    if (!confirmed) return;
    try {
      await api(`/news/${item.id}`, { method: 'DELETE' });
      if (newsEditing && newsEditing.id === item.id) resetNewsForm();
      toast('Новость удалена');
      loadNews();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Запуск ---------- */

  mePromise.then((user) => {
    if (!user || user.role !== 'admin') return;
    me = user;
    loadUsers();
    loadNews();
  });
})();
