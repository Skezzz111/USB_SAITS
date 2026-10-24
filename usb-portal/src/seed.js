// Первый запуск: создаёт 4 учётные записи администраторов со случайными логинами и паролями.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, save, newId, now, DATA_DIR } from './db.js';
import { hashPassword } from './auth.js';

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';

const pick = (set) => set[crypto.randomInt(set.length)];

function generatePassword(length = 20) {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateLogin() {
  let login = 'adm.';
  for (let i = 0; i < 10; i++) login += pick(LOWER + UPPER + DIGITS);
  return login;
}

/** Создаёт администраторов, если их ещё нет. Возвращает путь к файлу с данными для входа или null. */
export async function seedAdminsIfNeeded(count = 4) {
  if (db.users.some((u) => u.role === 'admin')) return null;

  const created = now();
  const entries = [];
  for (let i = 1; i <= count; i++) {
    const login = generateLogin();
    const password = generatePassword();
    db.users.push({
      id: newId(),
      login,
      passwordHash: await hashPassword(password),
      role: 'admin',
      lastName: 'Администратор',
      firstName: String(i),
      middleName: '',
      rank: 'Не указано',
      position: 'Администратор портала',
      discord: '',
      avatar: null,
      banner: null,
      createdAt: created,
      updatedAt: created,
    });
    entries.push(`Администратор ${i}\n  Логин:  ${login}\n  Пароль: ${password}`);
  }
  save();

  const file = path.join(DATA_DIR, 'admin-credentials.txt');
  const header = [
    'Учётные записи администраторов портала УСБ УВД по ЦАО',
    `Создано: ${created}`,
    'Передайте данные администраторам по защищённому каналу и удалите этот файл.',
    'В базе пароли хранятся только в виде хешей, восстановить их оттуда нельзя.',
  ].join('\n');
  fs.writeFileSync(file, `${header}\n\n${entries.join('\n\n')}\n`, { mode: 0o600 });
  return file;
}
