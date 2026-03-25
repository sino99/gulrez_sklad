// src/routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const router  = express.Router();

// GET /login
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile('login.html', { root: require('path').join(__dirname, '../../public') });
});

// POST /api/auth/login
router.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password)
    return res.json({ ok: false, error: 'Заполните все поля' });

  const user = db.prepare('SELECT * FROM users WHERE login = ? AND is_active = 1').get(login);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.json({ ok: false, error: 'Неверный логин или пароль' });

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now, user.id);

  req.session.user = { id: user.id, login: user.login, role: user.role, full_name: user.full_name };
  res.json({ ok: true, role: user.role });
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/api/auth/me', requireLogin, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

// POST /api/auth/change-password
router.post('/api/auth/change-password', requireLogin, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.json({ ok: false, error: 'Заполните все поля' });
  if (new_password.length < 4)
    return res.json({ ok: false, error: 'Пароль минимум 4 символа' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(current_password, user.password))
    return res.json({ ok: false, error: 'Неверный текущий пароль' });

  db.prepare('UPDATE users SET password = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

module.exports = router;