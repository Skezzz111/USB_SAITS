// Хранилище в JSON-файле: данные держатся в памяти, каждое изменение атомарно записывается на диск.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function load() {
  const empty = { users: [], news: [], sessions: [], chat: [], templates: [], documents: [] };
  try {
    return { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return empty;
    throw err;
  }
}

export const db = load();

export function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
