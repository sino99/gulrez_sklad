// src/routes/inventory.js
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db/database');
const { apiAuth } = require('../middleware/auth');
const router  = express.Router();

router.use(apiAuth);

// ── MULTER (photo upload) ──────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename:    (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `item_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

// ── CATEGORIES ────────────────────────────────────────────────────────────────

router.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY id').all();
  res.json({ ok: true, categories: rows });
});

// ── ITEMS ─────────────────────────────────────────────────────────────────────

const ITEMS_SQL = `
  SELECT i.*, c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color
  FROM items i LEFT JOIN categories c ON i.category_id = c.id
`;

router.get('/api/items', (req, res) => {
  const { q, category, status } = req.query;
  let sql = ITEMS_SQL;
  const params = [];
  const where = [];

  if (q) {
    where.push(`(i.name LIKE ? OR i.sku LIKE ? OR i.supplier LIKE ?)`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push(`c.name = ?`);
    params.push(category);
  }
  if (status === 'out')  where.push(`i.qty = 0`);
  if (status === 'low')  where.push(`i.qty > 0 AND i.qty <= i.min_qty`);
  if (status === 'ok')   where.push(`i.qty > i.min_qty`);

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY i.name ASC';

  const items = db.prepare(sql).all(...params);
  res.json({ ok: true, items });
});

router.get('/api/items/:id', (req, res) => {
  const item = db.prepare(ITEMS_SQL + ' WHERE i.id = ?').get(req.params.id);
  if (!item) return res.json({ ok: false, error: 'Не найдено' });
  res.json({ ok: true, item });
});

router.post('/api/items', (req, res) => {
  const { name, emoji, category_id, qty, min_qty, price, unit, supplier, note, sku } = req.body;
  if (!name) return res.json({ ok: false, error: 'Название обязательно' });

  const info = db.prepare(`
    INSERT INTO items (sku, name, emoji, category_id, qty, min_qty, price, unit, supplier, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sku||null, name, emoji||'🌸', category_id||null,
         parseInt(qty)||0, parseInt(min_qty)||0,
         parseFloat(price)||0, unit||'шт', supplier||null, note||null);

  // Log creation
  db.prepare(`
    INSERT INTO movements (item_id, user_id, type, qty, qty_before, qty_after, note)
    VALUES (?, ?, 'create', ?, 0, ?, 'Товар добавлен')
  `).run(info.lastInsertRowid, req.session.user.id, parseInt(qty)||0, parseInt(qty)||0);

  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/api/items/:id', (req, res) => {
  const { name, emoji, category_id, qty, min_qty, price, unit, supplier, note, sku } = req.body;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.json({ ok: false, error: 'Не найдено' });

  const newQty = parseInt(qty) ?? item.qty;
  const nowTs = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`
    UPDATE items SET
      sku = ?, name = ?, emoji = ?, category_id = ?,
      qty = ?, min_qty = ?, price = ?, unit = ?,
      supplier = ?, note = ?, updated_at = ?
    WHERE id = ?
  `).run(sku||item.sku, name||item.name, emoji||item.emoji, category_id||item.category_id,
         newQty, parseInt(min_qty)??item.min_qty,
         parseFloat(price)??item.price, unit||item.unit,
         supplier??item.supplier, note??item.note, nowTs, req.params.id);

  if (newQty !== item.qty) {
    db.prepare(`
      INSERT INTO movements (item_id, user_id, type, qty, qty_before, qty_after, note)
      VALUES (?, ?, 'adjust', ?, ?, ?, 'Корректировка при редактировании')
    `).run(req.params.id, req.session.user.id,
           Math.abs(newQty - item.qty), item.qty, newQty);
  }
  res.json({ ok: true });
});

router.delete('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.json({ ok: false, error: 'Не найдено' });
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── MOVEMENT (qty change) ─────────────────────────────────────────────────────

router.post('/api/items/:id/move', (req, res) => {
  const { type, qty, note } = req.body; // type: 'in' | 'out'
  const n = parseInt(qty);
  if (!['in','out'].includes(type) || !n || n <= 0)
    return res.json({ ok: false, error: 'Неверные данные' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.json({ ok: false, error: 'Товар не найден' });

  const before = item.qty;
  let after = type === 'in' ? before + n : Math.max(0, before - n);
  const nowTs = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`UPDATE items SET qty = ?, updated_at = ? WHERE id = ?`)
    .run(after, nowTs, req.params.id);

  db.prepare(`
    INSERT INTO movements (item_id, user_id, type, qty, qty_before, qty_after, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, req.session.user.id, type, n, before, after, note||null);

  res.json({ ok: true, qty_after: after });
});

// ── PHOTO UPLOAD ──────────────────────────────────────────────────────────────

router.post('/api/items/:id/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.json({ ok: false, error: 'Файл не загружен' });
  const url = '/uploads/' + req.file.filename;
  const nowTs = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`UPDATE items SET photo = ?, updated_at = ? WHERE id = ?`)
    .run(url, nowTs, req.params.id);
  res.json({ ok: true, url });
});

// ── STATS / REPORTS ───────────────────────────────────────────────────────────

router.get('/api/stats/summary', (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) as c FROM items').get().c;
  const totalQty= db.prepare('SELECT COALESCE(SUM(qty),0) as s FROM items').get().s;
  const value   = db.prepare('SELECT COALESCE(SUM(qty*price),0) as s FROM items').get().s;
  const lowCount= db.prepare('SELECT COUNT(*) as c FROM items WHERE qty > 0 AND qty <= min_qty').get().c;
  const outCount= db.prepare('SELECT COUNT(*) as c FROM items WHERE qty = 0').get().c;

  res.json({ ok: true, stats: { total, totalQty, value, lowCount, outCount } });
});

router.get('/api/stats/movements', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const rows = db.prepare(`
    SELECT
      date(m.created_at) as day,
      SUM(CASE WHEN m.type='in'  THEN m.qty ELSE 0 END) as income,
      SUM(CASE WHEN m.type='out' THEN m.qty ELSE 0 END) as outcome
    FROM movements m
    WHERE m.created_at >= ?
      AND m.type IN ('in','out')
    GROUP BY date(m.created_at)
    ORDER BY day ASC
  `).all(since);
  res.json({ ok: true, rows });
});

router.get('/api/stats/history', (req, res) => {
  const days   = parseInt(req.query.days) || 30;
  const itemId = req.query.item_id || null;
  const since  = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  let sql = `
    SELECT m.*, i.name as item_name, i.emoji as item_emoji,
           u.login as user_login, u.full_name as user_name
    FROM movements m
    JOIN items i ON i.id = m.item_id
    JOIN users u ON u.id = m.user_id
    WHERE m.created_at >= ?
  `;
  const params = [since];
  if (itemId) { sql += ' AND m.item_id = ?'; params.push(itemId); }
  sql += ' ORDER BY m.created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  res.json({ ok: true, rows });
});

router.get('/api/stats/top', (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.name, i.emoji, i.qty, i.unit, c.name as category
    FROM items i LEFT JOIN categories c ON c.id = i.category_id
    ORDER BY i.qty DESC LIMIT 10
  `).all();
  res.json({ ok: true, rows });
});

router.get('/api/stats/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT c.name, c.emoji, c.color,
           COUNT(i.id) as item_count,
           COALESCE(SUM(i.qty),0) as total_qty,
           COALESCE(SUM(i.qty * i.price),0) as total_value
    FROM categories c LEFT JOIN items i ON i.category_id = c.id
    GROUP BY c.id ORDER BY total_qty DESC
  `).all();
  res.json({ ok: true, rows });
});

module.exports = router;