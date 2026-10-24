// Чат сотрудников и модерация: системные сообщения, предупреждения, муты.
import { db, newId, now } from './db.js';
import { activeMute, fullName } from './users.js';

export const WARN_LIMIT = 3;
export const AUTO_MUTE_MINUTES = 60;
export const MAX_MUTE_MINUTES = 30 * 24 * 60;
export const KEEP_MESSAGES = 5000;

// Версия чата меняется при любом изменении — клиенты по ней понимают, что пора обновить ленту.
export const chatState = { version: Date.now() };
export const bumpChat = () => { chatState.version += 1; };

/** «1 д 2 ч 30 мин» — без склонений, чтобы не зависеть от числа. */
export function formatMinutes(total) {
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  return [days && `${days} д`, hours && `${hours} ч`, minutes && `${minutes} мин`].filter(Boolean).join(' ') || '0 мин';
}

export function addMessage(message) {
  db.chat.push({ id: newId(), createdAt: now(), editedAt: null, ...message });
  if (db.chat.length > KEEP_MESSAGES) db.chat.splice(0, db.chat.length - KEEP_MESSAGES);
  bumpChat();
}

const systemMessage = (text) => addMessage({ type: 'system', text, authorId: null });

/** Выдаёт мут. Автоматический мут не сокращает уже действующий, более долгий. */
export function muteUser(target, { minutes, reason, byId, auto = false }) {
  const until = Date.now() + minutes * 60000;
  const current = activeMute(target);
  if (auto && current && Date.parse(current.until) > until) return;
  target.mute = { until: new Date(until).toISOString(), minutes, reason, byId, auto, createdAt: now() };
  systemMessage(`Мут на ${formatMinutes(minutes)}: ${fullName(target)}. Причина: ${reason}`);
}

/** Выдаёт предупреждение; на третьем — автоматический мут на 1 час, счётчик обнуляется. Возвращает true при автомуте. */
export function warnUser(target, { reason, byId }) {
  target.warnings = [...(target.warnings || []), { id: newId(), reason, byId, createdAt: now() }];
  const count = target.warnings.length;
  systemMessage(`Предупреждение (${count}/${WARN_LIMIT}): ${fullName(target)}. Причина: ${reason}`);
  if (count < WARN_LIMIT) return false;

  target.warnings = [];
  muteUser(target, {
    minutes: AUTO_MUTE_MINUTES,
    reason: `автоматически за ${WARN_LIMIT} предупреждения (последнее: ${reason})`,
    byId,
    auto: true,
  });
  return true;
}

/** Полностью очищает историю чата; остаётся одно системное сообщение о том, кто её очистил. */
export function clearChat(admin) {
  db.chat.length = 0;
  systemMessage(`Чат очищен администратором: ${fullName(admin)}`);
}

export function unmuteUser(target) {
  target.mute = null;
  systemMessage(`Мут снят: ${fullName(target)}`);
}
