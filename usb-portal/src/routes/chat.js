// /api/chat — чат сотрудников. Писать могут все вошедшие без мута; свои сообщения можно менять и удалять,
// администраторы могут менять и удалять любые.
import { Router } from 'express';
import { db, save, now } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { str, activeMute, toAuthor, toPublicMute } from '../users.js';
import { chatState, bumpChat, addMessage, clearChat, KEEP_MESSAGES } from '../chat.js';

const router = Router();
router.use(requireAuth);

const DEFAULT_LIMIT = 50;
const MAX_LENGTH = 1000;
const MIN_INTERVAL_MS = 1000;
const lastPostAt = new Map();

const findUser = (id) => db.users.find((u) => u.id === id);

function toPublicMessage(m, viewer) {
  const isAdmin = viewer.role === 'admin';
  const own = m.authorId === viewer.id;
  const system = m.type === 'system';
  const authorUser = system ? null : findUser(m.authorId);
  const author = toAuthor(authorUser);
  if (author && isAdmin) {
    author.muted = Boolean(activeMute(authorUser));
    author.warnings = (authorUser.warnings || []).length;
  }
  const muted = Boolean(activeMute(viewer));
  return {
    id: m.id,
    type: system ? 'system' : 'user',
    text: m.text,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    editedByAdmin: Boolean(m.editedById && m.editedById !== m.authorId),
    own,
    author,
    canEdit: !system && (isAdmin || (own && !muted)),
    canDelete: isAdmin || (own && !system),
    canModerate: isAdmin && Boolean(authorUser) && authorUser.role === 'user' && authorUser.id !== viewer.id,
  };
}

function validateText(input) {
  const text = str(input);
  if (!text) return { error: 'Сообщение пустое' };
  if (text.length > MAX_LENGTH) return { error: `Сообщение длиннее ${MAX_LENGTH} символов` };
  return { text };
}

function muteError(user) {
  const mute = toPublicMute(user);
  const until = new Date(mute.until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
  return `У вас мут до ${until} (МСК). Причина: ${mute.reason}`;
}

// limit — сколько последних сообщений истории вернуть (клиент увеличивает его, подгружая более ранние).
router.get('/', (req, res) => {
  const version = chatState.version;
  if (Number(req.query.since) === version) return res.json({ version, unchanged: true });
  const requested = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, KEEP_MESSAGES) : DEFAULT_LIMIT;
  res.json({
    version,
    total: db.chat.length,
    hasMore: db.chat.length > limit,
    me: { mute: toPublicMute(req.user), canClear: req.user.role === 'admin' },
    messages: db.chat.slice(-limit).map((m) => toPublicMessage(m, req.user)),
  });
});

router.delete('/', requireAdmin, (req, res) => {
  clearChat(req.user);
  save();
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  if (activeMute(req.user)) return res.status(403).json({ error: muteError(req.user) });

  const last = lastPostAt.get(req.user.id) || 0;
  if (Date.now() - last < MIN_INTERVAL_MS) return res.status(429).json({ error: 'Не так быстро: подождите секунду' });

  const { text, error } = validateText(req.body?.text);
  if (error) return res.status(400).json({ error });

  lastPostAt.set(req.user.id, Date.now());
  addMessage({ type: 'user', text, authorId: req.user.id });
  save();
  res.status(201).json({ ok: true });
});

router.patch('/:id', (req, res) => {
  const message = db.chat.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (message.type === 'system') return res.status(400).json({ error: 'Системные сообщения нельзя изменять' });

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && message.authorId !== req.user.id) return res.status(403).json({ error: 'Можно изменять только свои сообщения' });
  if (!isAdmin && activeMute(req.user)) return res.status(403).json({ error: muteError(req.user) });

  const { text, error } = validateText(req.body?.text);
  if (error) return res.status(400).json({ error });

  Object.assign(message, { text, editedAt: now(), editedById: req.user.id });
  bumpChat();
  save();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const index = db.chat.findIndex((m) => m.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Сообщение не найдено' });

  const message = db.chat[index];
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && (message.type === 'system' || message.authorId !== req.user.id)) {
    return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
  }

  db.chat.splice(index, 1);
  bumpChat();
  save();
  res.json({ ok: true });
});

export default router;
