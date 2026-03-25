// src/middleware/auth.js

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ ok: false, error: 'Доступ запрещён. Только для администраторов.' });
}

function apiAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ ok: false, error: 'Не авторизован' });
}

module.exports = { requireLogin, requireAdmin, apiAuth };
