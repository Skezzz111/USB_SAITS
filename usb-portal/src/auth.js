// Пароли (bcrypt), сеансы (случайный токен в httpOnly-cookie, в базе хранится только его хеш) и проверка прав.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, save } from './db.js';

const COOKIE_NAME = 'usb_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

// Сравнение выполняется и для несуществующего логина, чтобы по времени ответа нельзя было узнать, есть ли такой аккаунт.
export const DUMMY_HASH = bcrypt.hashSync('timing-placeholder', BCRYPT_ROUNDS);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // повреждённая cookie — пропускаем
    }
  }
  return cookies;
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === '1',
  path: '/',
});

export function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const time = Date.now();
  db.sessions = db.sessions.filter((s) => s.expiresAt > time);
  db.sessions.push({ id: sha256(token), userId, expiresAt: time + SESSION_TTL_MS });
  save();
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function endSession(req, res) {
  if (req.sessionId) {
    db.sessions = db.sessions.filter((s) => s.id !== req.sessionId);
    save();
  }
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/** Завершает все сеансы пользователя, кроме указанного (после смены пароля или удаления профиля). */
export function endUserSessions(userId, exceptSessionId) {
  db.sessions = db.sessions.filter((s) => s.userId !== userId || s.id === exceptSessionId);
}

export function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const id = sha256(token);
    const session = db.sessions.find((s) => s.id === id && s.expiresAt > Date.now());
    const user = session && db.users.find((u) => u.id === session.userId);
    if (user) {
      req.user = user;
      req.sessionId = id;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Требуется вход в аккаунт' });
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав' });
  next();
}

// Защита от перебора паролей: после 5 неудачных попыток вход блокируется на 15 минут.
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map();

export function loginLockedFor(key) {
  const entry = attempts.get(key);
  return entry && entry.lockedUntil > Date.now() ? entry.lockedUntil - Date.now() : 0;
}

export function registerLoginFailure(key) {
  const time = Date.now();
  let entry = attempts.get(key);
  if (!entry || (entry.lockedUntil && entry.lockedUntil <= time)) entry = { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = time + LOCK_MS;
  attempts.set(key, entry);
}

export const clearLoginFailures = (key) => attempts.delete(key);
