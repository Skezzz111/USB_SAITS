// /api/news — читать могут все вошедшие сотрудники, публиковать, менять и удалять — только администраторы.
import { Router } from 'express';
import { db, save, newId, now } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { str, toAuthor } from '../users.js';

const router = Router();

function toPublicNews(item) {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    author: toAuthor(db.users.find((u) => u.id === item.authorId)),
  };
}

function validateNews(input) {
  const data = { title: str(input?.title), body: str(input?.body) };
  if (!data.title || data.title.length > 120) return { error: 'Заголовок: от 1 до 120 символов' };
  if (!data.body || data.body.length > 5000) return { error: 'Текст новости: от 1 до 5000 символов' };
  return { data };
}

router.get('/', requireAuth, (_req, res) => {
  const sorted = [...db.news].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ news: sorted.map(toPublicNews) });
});

router.post('/', requireAdmin, (req, res) => {
  const { data, error } = validateNews(req.body);
  if (error) return res.status(400).json({ error });
  const time = now();
  const item = { id: newId(), ...data, authorId: req.user.id, createdAt: time, updatedAt: time };
  db.news.push(item);
  save();
  res.status(201).json({ news: toPublicNews(item) });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const item = db.news.find((n) => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Новость не найдена' });
  const { data, error } = validateNews(req.body);
  if (error) return res.status(400).json({ error });
  Object.assign(item, data, { updatedAt: now() });
  save();
  res.json({ news: toPublicNews(item) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const index = db.news.findIndex((n) => n.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Новость не найдена' });
  db.news.splice(index, 1);
  save();
  res.json({ ok: true });
});

export default router;
