// /api/profile — действия пользователя со своим профилем: аватар, баннер, подпись для документов, смена пароля.
import { Router } from 'express';
import { save, now } from '../db.js';
import { requireAuth, verifyPassword, hashPassword, endUserSessions } from '../auth.js';
import { uploadImage, storeImage, removeImage } from '../images.js';
import { toPublicUser } from '../users.js';
import { bumpChat } from '../chat.js';

const router = Router();
router.use(requireAuth);

router.post('/password', async (req, res) => {
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!(await verifyPassword(current, req.user.passwordHash))) {
    return res.status(400).json({ error: 'Текущий пароль указан неверно' });
  }
  if (next.length < 8 || next.length > 128) {
    return res.status(400).json({ error: 'Новый пароль: от 8 до 128 символов' });
  }

  req.user.passwordHash = await hashPassword(next);
  req.user.updatedAt = now();
  endUserSessions(req.user.id, req.sessionId);
  save();
  res.json({ ok: true });
});

for (const kind of ['avatar', 'banner', 'signature']) {
  router.post(`/${kind}`, uploadImage(kind), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });
    const name = storeImage(req.file.buffer);
    if (!name) return res.status(400).json({ error: 'Поддерживаются только PNG, JPG, WEBP и GIF' });

    removeImage(req.user[kind]);
    req.user[kind] = name;
    req.user.updatedAt = now();
    if (kind === 'avatar') bumpChat();
    save();
    res.json({ user: toPublicUser(req.user) });
  });

  router.delete(`/${kind}`, (req, res) => {
    removeImage(req.user[kind]);
    req.user[kind] = null;
    req.user.updatedAt = now();
    if (kind === 'avatar') bumpChat();
    save();
    res.json({ user: toPublicUser(req.user) });
  });
}

export default router;
