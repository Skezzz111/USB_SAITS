// Общий скрипт всех страниц: запросы к API, данные пользователя в шапке, мобильное меню, уведомления.
document.documentElement.classList.add('js');

// Тема оформления: выбор сохраняется в браузере, без выбора — как в системе. Применяется до отрисовки страницы.
const Theme = (function () {
  const KEY = 'usb-theme';
  const COLORS = { light: '#F5F8EF', dark: '#0E1411' };
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const stored = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const current = () => document.documentElement.dataset.theme;

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = COLORS[theme];
    document.dispatchEvent(new CustomEvent('themechange'));
  }

  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch { /* приватный режим — тема не запомнится */ }
    apply(theme);
  }

  apply(stored() || (systemDark.matches ? 'dark' : 'light'));
  systemDark.addEventListener('change', (event) => {
    if (!stored()) apply(event.matches ? 'dark' : 'light');
  });

  return { current, set };
})();

window.Portal = (function () {
  const isLoginPage = /\/login(\.html)?$/i.test(location.pathname);

  async function api(path, options = {}) {
    const headers = { 'X-Requested-With': 'fetch' };
    let body;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let res;
    try {
      res = await fetch(`/api${path}`, { method: options.method || 'GET', headers, body, credentials: 'same-origin' });
    } catch {
      throw new Error('Нет связи с сервером');
    }

    let data = null;
    try { data = await res.json(); } catch { /* пустой ответ */ }

    if (res.status === 401 && path !== '/auth/login') {
      location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error('Требуется вход в аккаунт');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Ошибка сервера');
    return data;
  }

  /** Создаёт элемент; строки добавляются как текст, поэтому пользовательские данные не исполняются как HTML. */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  function initials(user) {
    const name = (user && user.fullName) || '';
    const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
    return letters.toUpperCase() || '?';
  }

  function avatar(user, className) {
    const box = el('span', { class: `avatar ${className || ''}`.trim() });
    if (user && user.avatarUrl) box.append(el('img', { src: user.avatarUrl, alt: '' }));
    else box.append(el('span', { 'aria-hidden': 'true', text: initials(user) }));
    return box;
  }

  const dateFormat = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const formatDate = (iso) => dateFormat.format(new Date(iso));

  /** Срок в минутах: «1 д 2 ч 30 мин». */
  function formatMinutes(total) {
    const days = Math.floor(total / 1440);
    const hours = Math.floor((total % 1440) / 60);
    const minutes = total % 60;
    return [days && `${days} д`, hours && `${hours} ч`, minutes && `${minutes} мин`].filter(Boolean).join(' ') || '0 мин';
  }

  /** Сколько осталось до момента времени. */
  function formatRemaining(iso) {
    const minutes = Math.ceil((Date.parse(iso) - Date.now()) / 60000);
    return minutes <= 1 ? 'меньше минуты' : formatMinutes(minutes);
  }

  let toastRegion;
  function toast(message, type) {
    if (!toastRegion) {
      toastRegion = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
      document.body.append(toastRegion);
    }
    const item = el('div', { class: `toast${type === 'error' ? ' toast--error' : ''}`, text: message });
    toastRegion.append(item);
    setTimeout(() => item.remove(), 4000);
  }

  function setHeaderUser(user) {
    const slot = document.querySelector('[data-user-actions]');
    if (!slot || !user) return;
    const chip = slot.querySelector('[data-user-chip]');
    chip.querySelector('.avatar')?.remove();
    chip.prepend(avatar(user, 'avatar--sm'));
    slot.querySelector('[data-user-name]').textContent = `${user.lastName} ${user.firstName}`;
    slot.querySelector('[data-admin-only]').hidden = user.role !== 'admin';
    slot.hidden = false;
    document.querySelectorAll('[data-user-fullname]').forEach((node) => { node.textContent = user.fullName; });
  }

  function showPassword(input, visible) {
    input.type = visible ? 'text' : 'password';
    const button = document.querySelector(`[data-toggle-password="${input.id}"]`);
    if (button) {
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
    }
  }

  const me = isLoginPage
    ? Promise.resolve(null)
    : api('/auth/me').then((data) => data.user).catch(() => null);

  return { api, el, avatar, formatDate, formatMinutes, formatRemaining, toast, me, setHeaderUser, showPassword };
})();

document.addEventListener('DOMContentLoaded', () => {
  const { api, el, me, setHeaderUser, showPassword } = window.Portal;

  // Переключатель темы: в шапке рядом с кнопками профиля, на страницах без них — в правом углу шапки.
  const themeHost = document.querySelector('[data-user-actions]') || document.querySelector('.site-header__inner');
  if (themeHost) {
    const ICON_MOON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    const ICON_SUN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    const button = el('button', { class: 'icon-btn theme-toggle', type: 'button' });
    const update = () => {
      const dark = Theme.current() === 'dark';
      const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
      button.innerHTML = dark ? ICON_SUN : ICON_MOON;
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    button.addEventListener('click', () => Theme.set(Theme.current() === 'dark' ? 'light' : 'dark'));
    document.addEventListener('themechange', update);
    update();
    if (themeHost.matches('[data-user-actions]')) themeHost.prepend(button);
    else themeHost.append(button);
  }

  // Мобильное меню
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      nav.classList.toggle('is-open', open);
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    nav.addEventListener('click', (event) => { if (event.target.closest('a')) setOpen(false); });
    window.matchMedia('(min-width: 1280px)').addEventListener('change', (event) => { if (event.matches) setOpen(false); });
  }

  // Показ пароля
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    const input = document.getElementById(button.dataset.togglePassword);
    button.addEventListener('click', () => showPassword(input, input.type === 'password'));
  });

  // Пользователь в шапке и выход
  me.then(setHeaderUser);
  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* всё равно уходим на вход */ }
      location.href = '/login.html';
    });
  });
});
