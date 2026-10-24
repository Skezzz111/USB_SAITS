// /api/auth — вход, выход и данные текущего пользователя.
import { Router } from 'express';
import { db } from '../db.js';
import {
  DUMMY_HASH, verifyPassword, startSession, endSession, requireAuth,
  loginLockedFor, registerLoginFailure, clearLoginFailures,
} from '../auth.js';
import { str, toPublicUser } from '../users.js';

const router = Router();

router.post('/login', async (req, res) => {
  const login = str(req.body?.login);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });

  const key = `${req.ip}|${login.toLowerCase()}`;
  const lockedFor = loginLockedFor(key);
  if (lockedFor) {
    return res.status(429).json({ error: `Слишком много попыток. Повторите через ${Math.ceil(lockedFor / 60000)} мин.` });
  }

  const user = db.users.find((u) => u.login.toLowerCase() === login.toLowerCase());
  const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) {
    registerLoginFailure(key);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  clearLoginFailures(key);
  startSession(res, user.id);
  res.json({ user: toPublicUser(user) });
});

router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

export default router;
