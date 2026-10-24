// Сервер портала: API, проверка доступа к страницам и раздача статики.
import path from 'node:path';
import express from 'express';
import { PUBLIC_DIR, UPLOADS_DIR } from './src/db.js';
import { loadUser } from './src/auth.js';
import { seedAdminsIfNeeded } from './src/seed.js';
import authRoutes from './src/routes/auth.js';
import profileRoutes from './src/routes/profile.js';
import userRoutes from './src/routes/users.js';
import newsRoutes from './src/routes/news.js';
import chatRoutes from './src/routes/chat.js';
import documentRoutes, { seedTemplates } from './src/routes/documents.js';

const PORT = Number(process.env.PORT) || 3000;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use(loadUser);

// Изменяющие запросы к API принимаются только от скриптов самого портала (защита от CSRF).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') {
    return res.status(403).json({ error: 'Запрос отклонён' });
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/users', userRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }));

// Без входа доступны только страница входа и оформление; админ-панель — только администраторам.
app.use((req, res, next) => {
  let pathname;
  try {
    pathname = decodeURIComponent(req.path).toLowerCase();
  } catch {
    return res.status(400).send('Некорректный адрес');
  }

  if (pathname.startsWith('/assets/')) return next();

  if (pathname === '/login' || pathname === '/login.html') {
    if (req.user) return res.redirect('/');
    return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  }

  if (!req.user) {
    if (req.method === 'GET' && (pathname === '/' || pathname.endsWith('.html'))) {
      return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).send('Требуется вход в аккаунт');
  }

  if (pathname.startsWith('/admin') && req.user.role !== 'admin') return res.redirect('/');
  next();
});

app.use('/uploads', express.static(UPLOADS_DIR, { index: false }));
app.use(express.static(PUBLIC_DIR));
app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

app.use((err, req, res, _next) => {
  const status = err.status === 400 || err.type === 'entity.parse.failed' ? 400 : err.status === 413 ? 413 : 500;
  if (status === 500) console.error(err);
  const message = status === 500 ? 'Внутренняя ошибка сервера' : 'Некорректный запрос';
  if (req.path.startsWith('/api/')) res.status(status).json({ error: message });
  else res.status(status).send(message);
});

const templatesSeed = seedTemplates();
if (templatesSeed.added) console.log(`Добавлены шаблоны документов по умолчанию: ${templatesSeed.added}`);
if (templatesSeed.updated) console.log(`Шаблоны документов по умолчанию обновлены до новой версии: ${templatesSeed.updated}`);

const credentialsFile = await seedAdminsIfNeeded();
if (credentialsFile) {
  console.log(`Созданы 4 учётные записи администраторов. Данные для входа: ${credentialsFile}`);
}

app.listen(PORT, () => {
  console.log(`Портал запущен: http://localhost:${PORT}`);
});
