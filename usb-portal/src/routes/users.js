// /api/users — управление профилями (только для администраторов): поиск, создание, редактирование, удаление,
// а также модерация чата: предупреждения и муты.
import { Router } from 'express';
import { db, save, newId, now } from '../db.js';
import { requireAdmin, hashPassword, endUserSessions } from '../auth.js';
import { removeImage } from '../images.js';
import { str, fullName, toPublicUser, validateProfile, loginTaken, activeMute } from '../users.js';
import { bumpChat, warnUser, muteUser, unmuteUser, MAX_MUTE_MINUTES } from '../chat.js';

const router = Router();
router.use(requireAdmin);

const findUser = (id) => db.users.find((u) => u.id === id);

router.get('/', (req, res) => {
  const query = str(req.query.q).toLowerCase();
  const found = query
    ? db.users.filter((u) =>
        [u.login, fullName(u), u.rank, u.position, u.discord].some((v) => v.toLowerCase().includes(query)))
    : db.users;
  const sorted = [...found].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
  res.json({ users: sorted.map(toPublicUser) });
});

router.get('/:id', (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Профиль не найден' });
  res.json({ user: toPublicUser(user) });
});

router.post('/', async (req, res) => {
  const { data, password, errors } = validateProfile(req.body ?? {}, { requirePassword: true });
  if (!errors.length && loginTaken(data.login)) errors.push('Этот логин уже занят.');
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const time = now();
  const user = {
    id: newId(),
    ...data,
    passwordHash: await hashPassword(password),
    avatar: null,
    banner: null,
    createdAt: time,
    updatedAt: time,
  };
  db.users.push(user);
  save();
  res.status(201).json({ user: toPublicUser(user) });
});

router.patch('/:id', async (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Профиль не найден' });

  const body = req.body ?? {};
  const { data, password, errors } = validateProfile({ ...body, role: body.role ?? user.role }, { requirePassword: false });
  if (loginTaken(data.login, user.id)) errors.push('Этот логин уже занят.');
  if (user.role === 'admin' && data.role !== 'admin') {
    if (user.id === req.user.id) errors.push('Нельзя снять права администратора с самого себя.');
    else if (db.users.filter((u) => u.role === 'admin').length <= 1) errors.push('Должен остаться хотя бы один администратор.');
  }
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  Object.assign(user, data);
  if (password) {
    user.passwordHash = await hashPassword(password);
    endUserSessions(user.id, user.id === req.user.id ? req.sessionId : undefined);
  }
  if (body.removeAvatar === true) {
    removeImage(user.avatar);
    user.avatar = null;
  }
  if (body.removeBanner === true) {
    removeImage(user.banner);
    user.banner = null;
  }
  user.updatedAt = now();
  bumpChat();
  save();
  res.json({ user: toPublicUser(user) });
});

/* ---------- Модерация чата ---------- */

/** Цель модерации: существующий сотрудник (не администратор и не сам модератор). */
function moderationTarget(req, res) {
  const user = findUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'Профиль не найден' });
    return null;
  }
  if (user.id === req.user.id || user.role === 'admin') {
    res.status(400).json({ error: 'Предупреждения и муты выдаются только сотрудникам, не администраторам' });
    return null;
  }
  return user;
}

function readReason(body) {
  const reason = str(body?.reason);
  return reason && reason.length <= 200 ? reason : null;
}

router.post('/:id/warn', (req, res) => {
  const user = moderationTarget(req, res);
  if (!user) return;
  const reason = readReason(req.body);
  if (!reason) return res.status(400).json({ error: 'Укажите причину (до 200 символов)' });

  const autoMuted = warnUser(user, { reason, byId: req.user.id });
  save();
  res.json({ user: toPublicUser(user), autoMuted });
});

router.post('/:id/mute', (req, res) => {
  const user = moderationTarget(req, res);
  if (!user) return;
  const reason = readReason(req.body);
  if (!reason) return res.status(400).json({ error: 'Укажите причину мута (до 200 символов)' });
  const minutes = Number(req.body?.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MUTE_MINUTES) {
    return res.status(400).json({ error: 'Срок мута: от 1 минуты до 30 дней' });
  }

  muteUser(user, { minutes, reason, byId: req.user.id });
  save();
  res.json({ user: toPublicUser(user) });
});

router.delete('/:id/mute', (req, res) => {
  const user = moderationTarget(req, res);
  if (!user) return;
  if (!activeMute(user)) return res.status(400).json({ error: 'У сотрудника нет мута' });

  unmuteUser(user);
  save();
  res.json({ user: toPublicUser(user) });
});

router.delete('/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить собственный профиль' });
  const index = db.users.findIndex((u) => u.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Профиль не найден' });

  const [user] = db.users.splice(index, 1);
  removeImage(user.avatar);
  removeImage(user.banner);
  removeImage(user.signature);
  endUserSessions(user.id);
  bumpChat();
  save();
  res.json({ ok: true });
});

export default router;
