// src/server.js
const express        = require('express');
const session        = require('express-session');
const path           = require('path');
const SqliteStore    = require('connect-sqlite3')(session);

const authRoutes      = require('./routes/auth');
const adminRoutes     = require('./routes/admin');
const inventoryRoutes = require('./routes/inventory');
const { requireLogin } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
  store:             new SqliteStore({ db: 'sessions.db', dir: path.join(__dirname, '../data') }),
  secret:            'flower-shop-secret-key-2024',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use(authRoutes);
app.use(adminRoutes);
app.use(inventoryRoutes);

// Protected SPA — serve index.html for all non-API routes
app.get('*', requireLogin, (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '../public') });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌸 Flower Shop Warehouse запущен`);
  console.log(`   ➜  http://localhost:${PORT}`);
  console.log(`   📋 Логин: Gulrez | Пароль: 999999\n`);
});