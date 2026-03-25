// src/db/database.js
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/warehouse.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    login       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    full_name   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    emoji TEXT NOT NULL DEFAULT '🌸',
    color TEXT NOT NULL DEFAULT '#c8705a'
  );

  CREATE TABLE IF NOT EXISTS items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sku          TEXT UNIQUE,
    name         TEXT NOT NULL,
    emoji        TEXT DEFAULT '🌸',
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    qty          INTEGER NOT NULL DEFAULT 0,
    min_qty      INTEGER NOT NULL DEFAULT 0,
    price        REAL    NOT NULL DEFAULT 0,
    unit         TEXT    NOT NULL DEFAULT 'шт',
    supplier     TEXT,
    note         TEXT,
    photo        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL,   -- 'in' | 'out' | 'adjust' | 'create' | 'delete'
    qty         INTEGER NOT NULL,
    qty_before  INTEGER NOT NULL,
    qty_after   INTEGER NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_movements_item    ON movements(item_id);
  CREATE INDEX IF NOT EXISTS idx_movements_date    ON movements(created_at);
  CREATE INDEX IF NOT EXISTS idx_items_category    ON items(category_id);
`);

// ── SEED ──────────────────────────────────────────────────────────────────────

function seed() {
  // Admin user: Gulrez / 999999
  const existingAdmin = db.prepare('SELECT id FROM users WHERE login = ?').get('Gulrez');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('999999', 10);
    db.prepare(`
      INSERT INTO users (login, password, role, full_name)
      VALUES (?, ?, 'admin', 'Gulrez (Администратор)')
    `).run('Gulrez', hash);
    console.log('✅ Admin user Gulrez created');
  }

  // Categories
  const cats = [
    { name: 'Срезанные цветы',    emoji: '💐', color: '#c8705a' },
    { name: 'Комнатные растения', emoji: '🌿', color: '#7da87a' },
    { name: 'Горшки и кашпо',     emoji: '🪴', color: '#c9a050' },
    { name: 'Упаковка',           emoji: '📦', color: '#7a9ec9' },
    { name: 'Удобрения',          emoji: '🌱', color: '#8fba6a' },
    { name: 'Аксессуары',         emoji: '🎀', color: '#c97ab0' },
  ];
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, emoji, color) VALUES (?, ?, ?)');
  cats.forEach(c => insertCat.run(c.name, c.emoji, c.color));

  // Sample items
  const catRow = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  const existingItems = db.prepare('SELECT COUNT(*) as c FROM items').get();
  if (existingItems.c === 0) {
    const ins = db.prepare(`
      INSERT INTO items (sku, name, emoji, category_id, qty, min_qty, price, unit, supplier, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const samples = [
      ['FL-001','Роза красная',      '🌹', catRow('Срезанные цветы')?.id,    120, 30, 45,  'шт',  'FloraOpt',   'Голландия 50 см'],
      ['FL-002','Тюльпан белый',     '🌷', catRow('Срезанные цветы')?.id,      8, 20, 35,  'шт',  '',           ''],
      ['FL-003','Хризантема',        '💮', catRow('Срезанные цветы')?.id,      0, 15, 55,  'шт',  'CvetOpt',    ''],
      ['FL-004','Пион розовый',      '🌸', catRow('Срезанные цветы')?.id,     55, 20, 120, 'шт',  '',           ''],
      ['FL-005','Подсолнух',         '🌻', catRow('Срезанные цветы')?.id,     40, 15, 60,  'шт',  '',           ''],
      ['PL-001','Монстера',          '🌿', catRow('Комнатные растения')?.id,  12,  5, 850, 'шт',  'GreenHouse', 'Горшок 15 см'],
      ['PL-002','Кактус микс',       '🌵', catRow('Комнатные растения')?.id,  45, 10, 150, 'шт',  '',           ''],
      ['PT-001','Горшок керам. 14',  '🪴', catRow('Горшки и кашпо')?.id,      30, 10, 120, 'шт',  '',           'Белый матовый'],
      ['PK-001','Крафт-бумага',      '📦', catRow('Упаковка')?.id,             4,  5, 280, 'упак','PackPro',    'Рулон 10 м'],
      ['AC-001','Лента атласная',    '🎀', catRow('Аксессуары')?.id,          25,  5,  60, 'м',   '',           ''],
    ];
    samples.forEach(s => ins.run(...s));
    console.log('✅ Sample items seeded');
  }
}

seed();

module.exports = db;
