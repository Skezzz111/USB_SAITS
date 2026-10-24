// /api/documents — документооборот: шаблоны (читают все, меняют администраторы) и отправленные документы
// (создают сотрудники, просматривают и удаляют только администраторы).
import { Router } from 'express';
import { db, save, newId, now } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { str, fullName } from '../users.js';
import { copyImage, removeImage } from '../images.js';
import { parseTemplate, DEFAULT_TEMPLATES } from '../doc-templates.js';

const router = Router();
router.use(requireAuth);

const MAX_VALUE = 2000; // описание ситуации и подобные поля бывают длинными
const DAILY_LIMIT_PER_USER = 50;
const NUMBER_FIELD_RE = /^\d{3}-\d{3}-\d+$/;

/**
 * Шаблоны по умолчанию: каждый добавляется в базу один раз (db.seededTemplates помнит какие),
 * а не изменённые администратором — обновляются до текущей версии. Возвращает { added, updated }.
 */
export function seedTemplates() {
  const time = now();
  // В базах до появления списка единственным шаблоном по умолчанию был приказ.
  db.seededTemplates ??= db.templates.length ? ['order'] : [];
  let added = 0;
  let updated = 0;
  for (const { key, previousBodies, ...def } of DEFAULT_TEMPLATES) {
    for (const tpl of db.templates) {
      if (previousBodies.includes(tpl.body)) {
        tpl.body = def.body;
        tpl.updatedAt = time;
        updated += 1;
      }
    }
    if (!db.seededTemplates.includes(key)) {
      db.templates.push({ id: newId(), ...def, createdAt: time, updatedAt: time });
      db.seededTemplates.push(key);
      added += 1;
    }
  }
  if (added || updated) save();
  return { added, updated };
}

const mskDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** Номер документа по правилу «ггд-дмм-X»: год, день, месяц, порядковый номер документа за сегодня. */
function nextNumber() {
  const today = mskDate();
  const [year, month, day] = today.split('-');
  const count = db.documents.filter((d) => mskDate(new Date(d.createdAt)) === today).length;
  return `${year.slice(2)}${day[0]}-${day[1]}${month}-${count + 1}`;
}

const imageUrl = (name) => (name ? `/uploads/${name}` : null);

function authorOf(doc) {
  const u = db.users.find((x) => x.id === doc.authorId);
  return u ? { fullName: fullName(u), rank: u.rank, position: u.position } : null;
}

const toSummary = (doc) => ({
  id: doc.id,
  title: doc.title,
  number: doc.number,
  author: authorOf(doc),
  createdAt: doc.createdAt,
  viewed: Boolean(doc.viewedAt),
});

/* ---------- Шаблоны ---------- */

function validateTemplate(input) {
  const data = { title: str(input?.title), description: str(input?.description), body: typeof input?.body === 'string' ? input.body.replace(/\r/g, '').trim() : '' };
  if (!data.title || data.title.length > 150) return { error: 'Название шаблона: от 1 до 150 символов' };
  if (data.description.length > 300) return { error: 'Описание — до 300 символов' };
  if (!data.body || data.body.length > 20000) return { error: 'Текст шаблона: от 1 до 20 000 символов' };
  if (!parseTemplate(data.body).fields.length) return { error: 'В шаблоне нет ни одного поля в фигурных скобках {…}' };
  return { data };
}

router.get('/templates', (_req, res) => {
  res.json({ templates: db.templates.map(({ id, title, description, body, updatedAt }) => ({ id, title, description, body, updatedAt })) });
});

router.post('/templates', requireAdmin, (req, res) => {
  const { data, error } = validateTemplate(req.body);
  if (error) return res.status(400).json({ error });
  const time = now();
  const tpl = { id: newId(), ...data, createdAt: time, updatedAt: time };
  db.templates.push(tpl);
  save();
  res.status(201).json({ template: tpl });
});

router.patch('/templates/:id', requireAdmin, (req, res) => {
  const tpl = db.templates.find((t) => t.id === req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
  const { data, error } = validateTemplate(req.body);
  if (error) return res.status(400).json({ error });
  Object.assign(tpl, data, { updatedAt: now() });
  save();
  res.json({ template: tpl });
});

router.delete('/templates/:id', requireAdmin, (req, res) => {
  const index = db.templates.findIndex((t) => t.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Шаблон не найден' });
  db.templates.splice(index, 1);
  save();
  res.json({ ok: true });
});

/* ---------- Документы ---------- */

router.get('/meta', (_req, res) => {
  res.json({ nextNumber: nextNumber(), today: mskDate() });
});

router.post('/', (req, res) => {
  const tpl = db.templates.find((t) => t.id === req.body?.templateId);
  if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
  const parsed = parseTemplate(tpl.body);

  const input = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
  const values = {};
  const missing = [];
  for (const key of parsed.fields) {
    const value = str(input[key]);
    if (!value) missing.push(key);
    if (value.length > MAX_VALUE) return res.status(400).json({ error: `Поле «${key}» длиннее ${MAX_VALUE} символов` });
    values[key] = value;
  }
  if (missing.length) return res.status(400).json({ error: `Заполните поля: ${missing.join(', ')}` });

  const dates = Array.isArray(req.body?.dates) ? req.body.dates : [];
  if (dates.length !== parsed.dates || !dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))) {
    return res.status(400).json({ error: 'Некорректные даты документа' });
  }

  if (parsed.signature && !req.user.signature) {
    return res.status(400).json({ error: 'Загрузите подпись в профиле — без неё документ не отправить' });
  }

  const today = mskDate();
  const sentToday = db.documents.filter((d) => d.authorId === req.user.id && mskDate(new Date(d.createdAt)) === today).length;
  if (sentToday >= DAILY_LIMIT_PER_USER) return res.status(429).json({ error: 'Слишком много документов за сутки' });

  // Подпись копируется: если сотрудник потом сменит её в профиле, отправленный документ не изменится.
  const signature = parsed.signature ? copyImage(req.user.signature) : null;
  if (parsed.signature && !signature) return res.status(400).json({ error: 'Не удалось прочитать подпись — загрузите её в профиле заново' });

  const numberKey = parsed.fields.find((key) => NUMBER_FIELD_RE.test(key) || /номер/i.test(key));
  const doc = {
    id: newId(),
    templateId: tpl.id,
    title: tpl.title,
    body: tpl.body, // снимок шаблона: правка шаблона не меняет уже отправленные документы
    values,
    dates,
    number: numberKey ? values[numberKey] : null,
    authorId: req.user.id,
    signature,
    createdAt: now(),
    viewedAt: null,
  };
  db.documents.push(doc);
  save();
  res.status(201).json({ document: toSummary(doc) });
});

router.get('/', requireAdmin, (req, res) => {
  const query = str(req.query.q).toLowerCase();
  const list = [...db.documents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((doc) => {
      if (!query) return true;
      const author = authorOf(doc);
      return [doc.title, doc.number || '', author ? author.fullName : '', ...Object.values(doc.values)]
        .some((v) => v.toLowerCase().includes(query));
    });
  res.json({ documents: list.map(toSummary), unread: db.documents.filter((d) => !d.viewedAt).length });
});

router.get('/:id', requireAdmin, (req, res) => {
  const doc = db.documents.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  if (!doc.viewedAt) {
    doc.viewedAt = now();
    doc.viewedBy = req.user.id;
    save();
  }
  res.json({
    document: {
      ...toSummary(doc),
      body: doc.body,
      values: doc.values,
      dates: doc.dates,
      signatureUrl: imageUrl(doc.signature),
    },
  });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const index = db.documents.findIndex((d) => d.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Документ не найден' });
  const [doc] = db.documents.splice(index, 1);
  removeImage(doc.signature);
  save();
  res.json({ ok: true });
});

export default router;
