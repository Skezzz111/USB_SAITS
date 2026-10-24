// Профили: проверка данных и то, что о пользователе отдаётся в браузер.
import { db } from './db.js';

export const LOGIN_RE = /^[A-Za-z0-9._-]{3,32}$/;
export const DISCORD_RE = /^[A-Za-z0-9_.]{2,32}$/;

export const str = (value) => (typeof value === 'string' ? value.trim() : '');

export const fullName = (u) => [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ');

const imageUrl = (name) => (name ? `/uploads/${name}` : null);

const nameById = (id) => {
  const u = db.users.find((x) => x.id === id);
  return u ? fullName(u) : 'Профиль удалён';
};

/** Действующий мут пользователя или null, если мута нет или он истёк. */
export const activeMute = (u) => (u.mute && Date.parse(u.mute.until) > Date.now() ? u.mute : null);

export function toPublicMute(u) {
  const mute = activeMute(u);
  if (!mute) return null;
  return {
    until: mute.until,
    minutes: mute.minutes,
    reason: mute.reason,
    issuedAt: mute.createdAt,
    auto: Boolean(mute.auto),
    by: nameById(mute.byId),
  };
}

export function toPublicUser(u) {
  return {
    id: u.id,
    login: u.login,
    role: u.role,
    lastName: u.lastName,
    firstName: u.firstName,
    middleName: u.middleName,
    fullName: fullName(u),
    rank: u.rank,
    position: u.position,
    discord: u.discord,
    avatarUrl: imageUrl(u.avatar),
    bannerUrl: imageUrl(u.banner),
    signatureUrl: imageUrl(u.signature),
    mute: toPublicMute(u),
    warnings: (u.warnings || []).map((w) => ({ reason: w.reason, createdAt: w.createdAt, by: nameById(w.byId) })),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/** Короткие сведения об авторе для новостей и чата. */
export function toAuthor(u) {
  return u ? { id: u.id, fullName: fullName(u), rank: u.rank, role: u.role, avatarUrl: imageUrl(u.avatar) } : null;
}

/**
 * Проверяет данные профиля из формы админ-панели.
 * requirePassword: при создании пароль обязателен, при редактировании пустой пароль означает «не менять».
 */
export function validateProfile(input, { requirePassword }) {
  const data = {
    login: str(input.login),
    lastName: str(input.lastName),
    firstName: str(input.firstName),
    middleName: str(input.middleName),
    rank: str(input.rank),
    position: str(input.position),
    discord: str(input.discord),
    role: input.role === 'admin' ? 'admin' : 'user',
  };
  const password = typeof input.password === 'string' ? input.password : '';
  const errors = [];

  if (!LOGIN_RE.test(data.login)) errors.push('Логин: 3–32 символа — латиница, цифры, точка, дефис или подчёркивание.');
  if ((requirePassword || password) && (password.length < 8 || password.length > 128)) {
    errors.push('Пароль: от 8 до 128 символов.');
  }
  if (!data.lastName || data.lastName.length > 40) errors.push('Укажите фамилию (до 40 символов).');
  if (!data.firstName || data.firstName.length > 40) errors.push('Укажите имя (до 40 символов).');
  if (data.middleName.length > 40) errors.push('Отчество — до 40 символов.');
  if (!data.rank || data.rank.length > 60) errors.push('Укажите звание (до 60 символов).');
  if (!data.position || data.position.length > 80) errors.push('Укажите должность (до 80 символов).');
  if (!DISCORD_RE.test(data.discord)) errors.push('Логин Discord: 2–32 символа — латиница, цифры, точка или подчёркивание.');

  return { data, password, errors };
}

export const loginTaken = (login, exceptId) =>
  db.users.some((u) => u.id !== exceptId && u.login.toLowerCase() === login.toLowerCase());
