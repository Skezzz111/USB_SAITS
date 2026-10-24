// Мой профиль: просмотр данных, аватар, баннер, подпись для документов, смена пароля.
(function () {
  const { api, el, avatar, formatDate, formatMinutes, formatRemaining, toast, me, setHeaderUser } = window.Portal;

  const MB = 1024 * 1024;
  const LIMITS = { avatar: 2 * MB, banner: 5 * MB, signature: 2 * MB };
  const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const SAVED = { avatar: 'Аватар обновлён', banner: 'Баннер обновлён', signature: 'Подпись сохранена' };
  const REMOVED = { avatar: 'Аватар удалён', banner: 'Баннер удалён', signature: 'Подпись удалена' };

  const $ = (id) => document.getElementById(id);

  function render(user) {
    const banner = $('profile-banner');
    banner.querySelector(':scope > img')?.remove();
    if (user.bannerUrl) banner.prepend(el('img', { src: user.bannerUrl, alt: '' }));

    $('profile-avatar').replaceChildren(avatar(user, 'avatar--xl'));
    $('profile-name').textContent = user.fullName;
    $('profile-rank').textContent = user.rank;
    $('profile-position').textContent = user.position;

    $('info-name').textContent = user.fullName;
    $('info-rank').textContent = user.rank;
    $('info-position').textContent = user.position;
    $('info-discord').textContent = user.discord || 'Не указан';
    $('info-login').textContent = user.login;
    $('info-role').textContent = user.role === 'admin' ? 'Администратор' : 'Сотрудник';
    $('info-created').textContent = formatDate(user.createdAt);

    $('avatar-remove').hidden = !user.avatarUrl;
    $('banner-remove').hidden = !user.bannerUrl;
    $('signature-remove').hidden = !user.signatureUrl;
    $('signature-preview').replaceChildren(user.signatureUrl
      ? el('img', { src: user.signatureUrl, alt: 'Ваша подпись' })
      : el('span', { class: 'signature-paper__empty', text: 'Подпись ещё не добавлена' }));
    renderChatStatus(user);
    setHeaderUser(user);
  }

  function renderChatStatus(user) {
    const mute = user.mute;
    $('chat-mute').replaceChildren(mute
      ? el('div', { class: 'mute-card', role: 'status' },
        el('strong', { text: `Мут в чате до ${formatDate(mute.until)}` }),
        el('span', { text: `Срок: ${formatMinutes(mute.minutes)}, осталось ${formatRemaining(mute.until)}` }),
        el('span', { text: `Причина: ${mute.reason}` }),
        el('span', { text: `Выдал: ${mute.by}${mute.auto ? ' (автоматически)' : ''}, ${formatDate(mute.issuedAt)}` }))
      : el('p', { class: 'ok-card', text: 'Ограничений нет — вы можете писать в чат.' }));

    $('warn-title').textContent = `Предупреждения: ${user.warnings.length} из 3`;
    $('warn-list').replaceChildren(...user.warnings.map((w) => el('li', {},
      el('span', { text: w.reason }),
      el('small', { text: `${w.by}, ${formatDate(w.createdAt)}` }))));
  }

  function setBusy(busy) {
    document.querySelectorAll('[data-upload], #avatar-remove, #banner-remove, #signature-remove, #signature-draw, #signature-save')
      .forEach((b) => { b.disabled = busy; });
  }

  async function upload(kind, file) {
    if (!TYPES.includes(file.type)) return toast('Поддерживаются только PNG, JPG, WEBP и GIF', 'error');
    if (file.size > LIMITS[kind]) return toast(`Файл больше ${LIMITS[kind] / MB} МБ`, 'error');

    const form = new FormData();
    form.append('image', file);
    setBusy(true);
    try {
      const { user } = await api(`/profile/${kind}`, { method: 'POST', form });
      render(user);
      toast(SAVED[kind]);
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind) {
    setBusy(true);
    try {
      const { user } = await api(`/profile/${kind}`, { method: 'DELETE' });
      render(user);
      toast(REMOVED[kind]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  for (const kind of ['avatar', 'banner', 'signature']) {
    const input = $(`${kind}-input`);
    document.querySelectorAll(`[data-upload="${kind}"]`).forEach((button) => {
      button.addEventListener('click', () => input.click());
    });
    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = '';
      if (file) upload(kind, file);
    });
    $(`${kind}-remove`).addEventListener('click', () => remove(kind));
  }

  /* ---------- Рисование подписи ---------- */

  const padDialog = $('signature-dialog');
  const pad = $('signature-pad');
  const pen = pad.getContext('2d');
  let drawing = false;
  let hasInk = false;
  let last = null;

  function clearPad() {
    pen.clearRect(0, 0, pad.width, pad.height);
    hasInk = false;
  }

  const padPoint = (event) => {
    const rect = pad.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * pad.width, y: ((event.clientY - rect.top) / rect.height) * pad.height };
  };

  pad.addEventListener('pointerdown', (event) => {
    drawing = true;
    last = padPoint(event);
    try { pad.setPointerCapture(event.pointerId); } catch { /* указатель уже отпущен — рисуем без захвата */ }
    pen.beginPath();
    pen.arc(last.x, last.y, 2.6, 0, Math.PI * 2);
    pen.fillStyle = '#10204a';
    pen.fill();
    hasInk = true;
  });

  pad.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const point = padPoint(event);
    const mid = { x: (last.x + point.x) / 2, y: (last.y + point.y) / 2 };
    pen.strokeStyle = '#10204a';
    pen.lineWidth = 5;
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    pen.beginPath();
    pen.moveTo(last.x, last.y);
    pen.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    pen.lineTo(point.x, point.y);
    pen.stroke();
    last = point;
  });

  const stopDrawing = () => { drawing = false; };
  pad.addEventListener('pointerup', stopDrawing);
  pad.addEventListener('pointercancel', stopDrawing);

  /** Обрезает пустые поля холста, чтобы подпись в документе была нужного размера. */
  function croppedSignature() {
    const { data, width, height } = pen.getImageData(0, 0, pad.width, pad.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad8 = 12;
    const out = document.createElement('canvas');
    out.width = maxX - minX + pad8 * 2;
    out.height = maxY - minY + pad8 * 2;
    out.getContext('2d').drawImage(pad, minX - pad8, minY - pad8, out.width, out.height, 0, 0, out.width, out.height);
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  $('signature-draw').addEventListener('click', () => {
    clearPad();
    padDialog.showModal();
  });
  $('signature-clear').addEventListener('click', clearPad);
  padDialog.querySelectorAll('[data-signature-close]').forEach((b) => b.addEventListener('click', () => padDialog.close()));
  $('signature-save').addEventListener('click', async () => {
    if (!hasInk) return toast('Сначала распишитесь в поле', 'error');
    const blob = await croppedSignature();
    if (!blob) return toast('Сначала распишитесь в поле', 'error');
    const saved = await upload('signature', new File([blob], 'signature.png', { type: 'image/png' }));
    if (saved) padDialog.close();
  });

  // Смена пароля
  const form = $('password-form');
  const errorBox = $('pw-error');
  const success = $('pw-success');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    success.hidden = true;

    const currentPassword = $('pw-current').value;
    const newPassword = $('pw-new').value;
    let problem = null;
    if (!currentPassword) problem = 'Введите текущий пароль';
    else if (newPassword.length < 8 || newPassword.length > 128) problem = 'Новый пароль: от 8 до 128 символов';
    else if (newPassword !== $('pw-repeat').value) problem = 'Новые пароли не совпадают';
    if (problem) {
      errorBox.textContent = problem;
      errorBox.hidden = false;
      return;
    }

    $('pw-submit').disabled = true;
    try {
      await api('/profile/password', { method: 'POST', body: { currentPassword, newPassword } });
      form.reset();
      success.hidden = false;
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      $('pw-submit').disabled = false;
    }
  });

  me.then((user) => { if (user) render(user); });
})();
