// Диалоги модерации (предупреждение и мут) — общие для чата на главной и админ-панели.
(function () {
  const { api, el, toast } = window.Portal;
  const WARN_LIMIT = 3;
  const MAX_MINUTES = 30 * 24 * 60;
  const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 };
  const PRESETS = [
    { label: '15 мин', amount: 15, unit: 'minutes' },
    { label: '1 ч', amount: 1, unit: 'hours' },
    { label: '6 ч', amount: 6, unit: 'hours' },
    { label: '1 д', amount: 1, unit: 'days' },
    { label: '7 д', amount: 7, unit: 'days' },
  ];

  let ui = null;
  let state = null;

  function build() {
    const closeIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    const close = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть' });
    close.innerHTML = closeIcon;

    const title = el('h2', { class: 'dialog__title', id: 'mod-title' });
    const info = el('p', { class: 'mod-info', id: 'mod-info' });
    const reason = el('textarea', { class: 'textarea textarea--short', id: 'mod-reason', maxlength: '200', rows: '3', required: true });
    const amount = el('input', { class: 'input', id: 'mod-amount', type: 'number', min: '1', step: '1', inputmode: 'numeric', required: true });
    const unit = el('select', { class: 'select', id: 'mod-unit', 'aria-label': 'Единица срока' },
      el('option', { value: 'minutes' }, 'минут'),
      el('option', { value: 'hours' }, 'часов'),
      el('option', { value: 'days' }, 'дней'));
    const presets = el('div', { class: 'presets', role: 'group', 'aria-label': 'Быстрый выбор срока' },
      PRESETS.map((p) => el('button', {
        class: 'preset', type: 'button',
        onclick: () => { amount.value = p.amount; unit.value = p.unit; },
      }, p.label)));
    const duration = el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'mod-amount' }, 'Срок мута ', el('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
      el('div', { class: 'input-group' }, amount, unit),
      presets,
      el('span', { class: 'field__hint' }, 'От 1 минуты до 30 дней.'));
    const errorBox = el('p', { class: 'alert', role: 'alert', hidden: true });
    const submit = el('button', { class: 'btn btn--danger', type: 'submit' });
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Отмена');

    const form = el('form', { novalidate: true },
      el('div', { class: 'dialog__head' }, title, close),
      el('div', { class: 'dialog__body' },
        info,
        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: 'mod-reason' }, 'Причина ', el('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
          reason),
        duration,
        errorBox),
      el('div', { class: 'dialog__foot' }, cancel, submit));

    const dialog = el('dialog', { class: 'dialog dialog--sm', 'aria-labelledby': 'mod-title', 'aria-describedby': 'mod-info' }, form);
    document.body.append(dialog);

    close.addEventListener('click', () => dialog.close());
    cancel.addEventListener('click', () => dialog.close());
    form.addEventListener('submit', onSubmit);

    return { dialog, title, info, reason, amount, unit, duration, errorBox, submit };
  }

  function showError(message) {
    ui.errorBox.textContent = message;
    ui.errorBox.hidden = false;
  }

  async function onSubmit(event) {
    event.preventDefault();
    ui.errorBox.hidden = true;
    const { kind, target, onDone } = state;

    const reason = ui.reason.value.trim();
    if (!reason) return showError('Укажите причину');

    let body = { reason };
    if (kind === 'mute') {
      const minutes = Number(ui.amount.value) * UNIT_MINUTES[ui.unit.value];
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) return showError('Срок мута: от 1 минуты до 30 дней');
      body = { reason, minutes };
    }

    ui.submit.disabled = true;
    try {
      const result = await api(`/users/${target.id}/${kind}`, { method: 'POST', body });
      ui.dialog.close();
      if (kind === 'mute') toast(`Мут выдан: ${target.fullName}`);
      else toast(result.autoMuted
        ? `${target.fullName}: ${WARN_LIMIT}-е предупреждение, выдан мут на 1 час`
        : `Предупреждение выдано: ${target.fullName}`);
      if (onDone) onDone(result.user);
    } catch (err) {
      showError(err.message);
    } finally {
      ui.submit.disabled = false;
    }
  }

  /**
   * Открывает диалог. kind: 'warn' | 'mute'.
   * target: { id, fullName, warnings } — warnings: число или массив действующих предупреждений.
   */
  function moderate(kind, target, onDone) {
    if (!ui) ui = build();
    state = { kind, target, onDone };
    const warnings = Array.isArray(target.warnings) ? target.warnings.length : Number(target.warnings) || 0;

    ui.reason.value = '';
    ui.amount.value = '1';
    ui.unit.value = 'hours';
    ui.errorBox.hidden = true;
    ui.duration.hidden = kind !== 'mute';

    if (kind === 'warn') {
      ui.title.textContent = 'Предупреждение';
      ui.info.textContent = `${target.fullName}. Сейчас предупреждений: ${warnings} из ${WARN_LIMIT}. `
        + `При ${WARN_LIMIT}-м автоматически выдаётся мут на 1 час.`;
      ui.submit.textContent = 'Выдать предупреждение';
    } else {
      ui.title.textContent = 'Мут в чате';
      ui.info.textContent = `${target.fullName} не сможет писать в чат до окончания срока.`;
      ui.submit.textContent = 'Выдать мут';
    }

    ui.dialog.showModal();
    ui.reason.focus();
  }

  async function unmute(target, onDone) {
    if (!window.confirm(`Снять мут: ${target.fullName}?`)) return;
    try {
      const { user } = await api(`/users/${target.id}/mute`, { method: 'DELETE' });
      toast(`Мут снят: ${target.fullName}`);
      if (onDone) onDone(user);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.Portal.moderate = moderate;
  window.Portal.unmute = unmute;
})();
