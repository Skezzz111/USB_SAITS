// Загрузка аватаров и баннеров: тип файла определяется по содержимому, имя генерируется сервером.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { UPLOADS_DIR } from './db.js';

const MB = 1024 * 1024;
export const IMAGE_LIMITS = { avatar: 2 * MB, banner: 5 * MB, signature: 2 * MB };

const STORED_NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;

/** Middleware: принимает один файл из поля «image» с ограничением размера для аватара или баннера. */
export function uploadImage(kind) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMAGE_LIMITS[kind], files: 1, fields: 0 },
  }).single('image');

  return (req, res, next) =>
    upload(req, res, (err) => {
      if (!err) return next();
      const error = err.code === 'LIMIT_FILE_SIZE'
        ? `Файл больше ${IMAGE_LIMITS[kind] / MB} МБ`
        : 'Не удалось загрузить файл';
      res.status(400).json({ error });
    });
}

function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/** Сохраняет изображение и возвращает имя файла, или null, если это не PNG/JPG/GIF/WEBP. */
export function storeImage(buffer) {
  const ext = detectType(buffer);
  if (!ext) return null;
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
  return name;
}

/** Копия загруженного изображения (например, подписи для отправленного документа) или null. */
export function copyImage(name) {
  if (!name || !STORED_NAME_RE.test(name)) return null;
  try {
    return storeImage(fs.readFileSync(path.join(UPLOADS_DIR, name)));
  } catch {
    return null;
  }
}

export function removeImage(name) {
  if (!name || !STORED_NAME_RE.test(name)) return;
  fs.rm(path.join(UPLOADS_DIR, name), { force: true }, () => {});
}
