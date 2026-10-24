// Страница входа.
(function () {
  const { api } = window.Portal;
  const form = document.getElementById('login-form');
  const loginInput = document.getElementById('login');
  const passwordInput = document.getElementById('password');
  const errorBox = document.getElementById('login-error');
  const submit = document.getElementById('login-submit');

  // Возвращаем на исходную страницу, но только внутри портала.
  function nextUrl() {
    const next = new URLSearchParams(location.search).get('next');
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !/^\/login/i.test(next)) {
      return next;
    }
    return '/';
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;

    const login = loginInput.value.trim();
    const password = passwordInput.value;
    if (!login || !password) {
      showError('Введите логин и пароль');
      (login ? passwordInput : loginInput).focus();
      return;
    }

    submit.disabled = true;
    try {
      await api('/auth/login', { method: 'POST', body: { login, password } });
      location.replace(nextUrl());
    } catch (err) {
      showError(err.message);
      passwordInput.value = '';
      passwordInput.focus();
      submit.disabled = false;
    }
  });

  loginInput.focus();
})();
