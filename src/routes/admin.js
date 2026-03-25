// src/routes/admin.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireAdmin } = require('../middleware/auth');
const router  = express.Router();

// All routes require admin
router.use(requireAdmin);

// GET all users
router.get('/api/admin/users', (req, res) => {
  const users = db.prepare(`
    SELECT id, login, role, full_name, created_at, last_login, is_active
    FROM users ORDER BY id ASC
  `).all();
  res.json({ ok: true, users });
});

// POST create user
router.post('/api/admin/users', (req, res) => {
  const { login, password, role, full_name } = req.body;
  if (!login || !password) return res.json({ ok: false, error: 'Логин и пароль обязательны' });
  if (password.length < 4)  return res.json({ ok: false, error: 'Пароль минимум 4 символа' });
  if (!['admin','user'].includes(role)) return res.json({ ok: false, error: 'Неверная роль' });

  const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
  if (exists) return res.json({ ok: false, error: 'Логин уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (login, password, role, full_name) VALUES (?, ?, ?, ?)
  `).run(login, hash, role, full_name || login);

  res.json({ ok: true, id: info.lastInsertRowid });
});

// PUT reset/change password for any user
router.put('/api/admin/users/:id/password', (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 4)
    return res.json({ ok: false, error: 'Пароль минимум 4 символа' });

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ ok: true });
});

// PUT update user role / active status
router.put('/api/admin/users/:id', (req, res) => {
  const { role, is_active, full_name } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.json({ ok: false, error: 'Пользователь не найден' });

  // Prevent admin from demoting/deactivating themselves
  if (parseInt(req.params.id) === req.session.user.id && is_active === 0)
    return res.json({ ok: false, error: 'Нельзя деактивировать себя' });

  db.prepare(`
    UPDATE users SET
      role      = COALESCE(?, role),
      is_active = COALESCE(?, is_active),
      full_name = COALESCE(?, full_name)
    WHERE id = ?
  `).run(role ?? null, is_active ?? null, full_name ?? null, req.params.id);

  res.json({ ok: true });
});

// DELETE user
router.delete('/api/admin/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id)
    return res.json({ ok: false, error: 'Нельзя удалить себя' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
