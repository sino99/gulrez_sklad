// public/js/app.js
'use strict';

// ── ТАДЖИКСКОЕ ВРЕМЯ (UTC+5) ────────────────────────────────────────────────
function parseUTCtoTajikDate(utcString) {
  // строка вида "2025-03-25 12:34:56"
  return new Date(utcString + 'Z'); // добавляем 'Z' для явного указания UTC
}

function formatTajikDate(date, withSeconds = false) {
  const options = {
    timeZone: 'Asia/Dushanbe',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (withSeconds) options.second = '2-digit';
  return date.toLocaleString('ru-RU', options);
}

// ── ESCAPE HTML ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let currentUser  = null;
let items        = [];
let categories   = [];
let editItemId   = null;
let moveItemId   = null;
let moveType     = 'in';
let resetUserId  = null;
let sortField    = 'name';
let sortDir      = 1;
let activeCat    = '';
let currentView  = 'table';
let reportPeriod = 7;
let pendingPhotoFile = null;
let isMobile = window.innerWidth <= 768;

// ── MOBILE DETECTION ─────────────────────────────────────────────────────────
function checkMobile() {
  const newIsMobile = window.innerWidth <= 768;
  if (newIsMobile !== isMobile) {
    isMobile = newIsMobile;
    if (isMobile && currentView !== 'grid') {
      setView('grid');
    }
  }
}

window.addEventListener('resize', () => {
  checkMobile();
  if (window.innerWidth > 768 && document.getElementById('sidebar').classList.contains('open')) {
    document.getElementById('sidebar').classList.remove('open');
  }
});

// Закрытие сайдбара при клике на контент (на мобильных)
document.addEventListener('click', (e) => {
  if (isMobile && document.getElementById('sidebar').classList.contains('open')) {
    if (!e.target.closest('.sidebar') && !e.target.closest('.menu-btn')) {
      document.getElementById('sidebar').classList.remove('open');
    }
  }
});

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await api('/api/auth/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  currentUser = res.user;

  document.getElementById('user-name').textContent = currentUser.full_name || currentUser.login;
  document.getElementById('user-role').textContent = currentUser.role === 'admin' ? '👑 Администратор' : '👤 Сотрудник';
  document.getElementById('user-avatar').textContent = (currentUser.login[0] || 'U').toUpperCase();

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  await loadCategories();
  updateClock();
  setInterval(updateClock, 30000);
  checkMobile();
  if (isMobile && currentView !== 'grid') {
    setView('grid');
  }
  showPage('dashboard');
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return await res.json();
  } catch (e) {
    toast('Ошибка соединения', 'error');
    return { ok: false };
  }
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${name}"]`)?.classList.add('active');
  const titles = { dashboard:'Дашборд', inventory:'Склад', report:'Отчёты', users:'Пользователи' };
  document.getElementById('topbar-title').textContent = titles[name] || '';

  if (name === 'dashboard') renderDashboard();
  if (name === 'inventory') renderInventory();
  if (name === 'report')    { populateReportFilter(); renderReport(); }
  if (name === 'users')     renderUsers();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    showPage(btn.dataset.page);
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('open');
  });
});

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── CATEGORIES ────────────────────────────────────────────────────────────────
async function loadCategories() {
  const res = await api('/api/categories');
  if (!res.ok) return;
  categories = res.categories;

  // Populate filter
  const fcat = document.getElementById('f-cat');
  fcat.innerHTML = '<option value="">Все категории</option>' +
    categories.map(c => `<option value="${c.name}"><i class="fas fa-tag"></i> ${c.name}</option>`).join('');

  // Populate item form
  const ficat = document.getElementById('fi-cat');
  ficat.innerHTML = categories.map(c => `<option value="${c.id}"><i class="fas fa-tag"></i> ${c.name}</option>`).join('');

  // Category tabs
  const tabs = document.getElementById('cat-tabs');
  tabs.innerHTML = `<button class="cat-btn active" onclick="setActiveCat('',this)">Все</button>` +
    categories.map(c => `<button class="cat-btn" onclick="setActiveCat('${c.name}',this)"><i class="fas fa-tag"></i> ${c.name}</button>`).join('');
}

function setActiveCat(cat, btn) {
  activeCat = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('f-cat').value = '';
  renderInventory();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const [sumRes, movRes, topRes, histRes] = await Promise.all([
    api('/api/stats/summary'),
    api('/api/stats/movements?days=7'),
    api('/api/stats/top'),
    api('/api/stats/history?days=3'),
  ]);

  if (sumRes.ok) {
    const s = sumRes.stats;
    document.getElementById('k-total').textContent = s.total;
    document.getElementById('k-qty').textContent   = s.totalQty;
    document.getElementById('k-val').textContent   = s.value.toLocaleString('ru') + ' ₽';
    document.getElementById('k-low').textContent   = s.lowCount + s.outCount;
  }

  if (movRes.ok) renderWeekChart('week-chart', movRes.rows, 7);
  if (topRes.ok) renderTopList('top-items', topRes.rows);
  if (histRes.ok) renderFeed('activity-feed', histRes.rows);
  renderCatBreakdown();
  renderPromo();
}

function renderWeekChart(elId, rows, days) {
  const el = document.getElementById(elId);
  const map = {};
  rows.forEach(r => { map[r.day] = r; });

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const dd = d.getDate() + '/' + (d.getMonth() + 1);
    result.push({ lbl: dd, in: map[key]?.income || 0, out: map[key]?.outcome || 0 });
  }
  const maxV = Math.max(...result.map(r => r.in + r.out), 1);
  el.innerHTML = result.map(r => {
    const inH  = Math.round((r.in  / maxV) * 100);
    const outH = Math.round((r.out / maxV) * 100);
    return `<div class="bar-col">
      <div class="bar-stack">
        <div class="b-in"  style="height:${inH}px"></div>
        <div class="b-out" style="height:${outH}px"></div>
      </div>
      <div class="b-lbl">${r.lbl}</div>
    </div>`;
  }).join('');
}

function renderTopList(elId, rows) {
  const max = rows[0]?.qty || 1;
  document.getElementById(elId).innerHTML = rows.slice(0, 6).map((r, i) => `
    <div class="top-item">
      <div class="top-rank">${i + 1}</div>
      <div class="top-emoji"><i class="fas fa-flower"></i></div>
      <div class="top-info"><div class="top-name">${escapeHtml(r.name)}</div><div class="top-cat">${r.category || '—'}</div></div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${Math.round(r.qty / max * 100)}%"></div></div>
      <div class="top-val">${r.qty}</div>
    </div>`).join('') || '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Нет данных</div>';
}

function renderFeed(elId, rows) {
  const typeMap = { in:['in','Принято'], out:['out','Выдано'], add:['add','Добавлен'], delete:['del','Удалён'], adjust:['in','Корректировка'], create:['add','Создан'] };
  document.getElementById(elId).innerHTML = rows.slice(0, 8).map(h => {
    const [cls, lbl] = typeMap[h.type] || ['add', h.type];
    const sign = h.type === 'in' || h.type === 'create' || h.type === 'add' ? '+' : '−';
    return `<div class="feed-item">
      <div class="fdot ${cls}"></div>
      <div class="feed-text"><i class="fas fa-box"></i> <b>${escapeHtml(h.item_name)}</b> — ${lbl} ${sign}${h.qty}</div>
      <div class="feed-time">${timeAgo(h.created_at)}</div>
    </div>`;
  }).join('') || '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Нет действий</div>';
}

async function renderCatBreakdown() {
  const res = await api('/api/stats/categories');
  if (!res.ok) return;
  const max = res.rows[0]?.total_qty || 1;
  document.getElementById('cat-chart').innerHTML = res.rows.map(r => `
    <div class="top-item">
      <div class="top-emoji"><i class="fas fa-tag"></i></div>
      <div class="top-info"><div class="top-name">${r.name}</div><div class="top-cat">${r.item_count} позиций</div></div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${Math.round(r.total_qty / max * 100)}%;background:var(--sage)"></div></div>
      <div class="top-val">${r.total_qty}</div>
    </div>`).join('') || '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Нет данных</div>';
}

function renderPromo() {
  const month = new Date().getMonth();
  const tips = [
    ['🌹', 'Январь — закупайте розы',   'Подготовка к 14 февраля. Цены растут — берите оптом заранее.'],
    ['💝', 'Февраль — сезон роз',        '14 февраля спрос вырастет в 4–5 раз. Проверьте остатки!'],
    ['🌷', 'Март — тюльпаны и мимоза',   '8 Марта главный праздник. Тюльпаны, нарциссы, хризантемы.'],
    ['🌸', 'Апрель — пионы и сирень',    'Сезон пионов. Спрос на нежные пастельные оттенки.'],
    ['💐', 'Май — свадебный сезон',      'Сезон свадеб начинается. Белые розы, пионы, эустома.'],
    ['🌻', 'Июнь — подсолнухи в тренде', 'Лето! Подсолнухи, гортензии, ромашки хорошо продаются.'],
    ['☀️', 'Июль — берегите цветы',      'Жара: храните в холодильнике, сократите нежные запасы.'],
    ['🌺', 'Август — яркие оттенки',     'Конец лета — георгины, гладиолусы, астры.'],
    ['🍂', 'Сентябрь — хризантемы',      'Осень. Хризантемы, астры. 1 сентября — букеты для школы!'],
    ['🎃', 'Октябрь — осенние букеты',   'Тёплые осенние тона. Сухоцветы и декоративные ветки.'],
    ['❄️', 'Ноябрь — готовьтесь к зиме', 'Подготовка к новогоднему сезону. Закупайте декор.'],
    ['🎄', 'Декабрь — праздничный сезон', 'Новый год: еловые ветки, пуансеттия, амариллис.'],
  ];
  const [icon, title, text] = tips[month];
  document.getElementById('promo-icon').innerHTML = `<i class="fas fa-calendar-alt"></i>`;
  document.getElementById('promo-title').textContent = title;
  document.getElementById('promo-text').textContent  = text;
}

// ── INVENTORY ─────────────────────────────────────────────────────────────────
async function renderInventory() {
  const q    = document.getElementById('search').value;
  const cat  = document.getElementById('f-cat').value || activeCat;
  const stat = document.getElementById('f-status').value;
  const params = new URLSearchParams();
  if (q)    params.set('q', q);
  if (cat)  params.set('category', cat);
  if (stat) params.set('status', stat);

  const res = await api('/api/items?' + params);
  if (!res.ok) return;
  items = res.items;

  // Sort
  items.sort((a, b) => {
    let av = a[sortField], bv = b[sortField];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return av < bv ? -sortDir : av > bv ? sortDir : 0;
  });

  renderAlerts();
  if (currentView === 'table') renderTable();
  else renderCards();
}

function renderAlerts() {
  const lowItems = items.filter(i => i.qty === 0 || i.qty <= i.min_qty);
  document.getElementById('inv-alerts').innerHTML = lowItems.slice(0, 3).map(i =>
    `<div class="alert-item"><i class="fas fa-exclamation-triangle"></i> <b>${escapeHtml(i.name)}</b> — ${i.qty === 0 ? 'нет в наличии' : `осталось ${i.qty} ${i.unit} (мин: ${i.min_qty})`}</div>`
  ).join('');
}

function renderTable() {
  const tbody = document.getElementById('tbody');
  if (!items.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-seedling fa-3x"></i><div>Товары не найдены</div></div></td></tr>`; return; }
  tbody.innerHTML = items.map(i => {
    const [cls, lbl] = statusLabel(i);
    const thumb = i.photo
      ? `<div class="item-thumb" onclick="viewPhoto('${i.photo}','${i.name}')"><img src="${i.photo}" alt=""></div>`
      : `<div class="item-thumb"><i class="fas fa-flower"></i></div>`;
    return `<tr>
      <td><div class="item-name-cell">${thumb}<div><div class="item-name">${escapeHtml(i.name)}</div><div class="item-sku">${i.sku || '—'}${i.supplier ? ' · ' + escapeHtml(i.supplier) : ''}</div></div></div></td>
      <td style="color:var(--muted)"><i class="fas fa-tag"></i> ${i.category_name || '—'}</td>
      <td><div class="qty-cell">
        <button class="qty-btn" onclick="quickMove('${i.id}','out')"><i class="fas fa-minus"></i></button>
        <span class="qty-num">${i.qty}</span>
        <button class="qty-btn" onclick="quickMove('${i.id}','in')"><i class="fas fa-plus"></i></button>
        <span class="qty-unit">${i.unit}</span>
      </div></td>
      <td style="color:var(--gold2)">${i.price ? i.price + ' ₽' : '—'}</td>
      <td style="color:var(--muted)">${i.min_qty} ${i.unit}</td>
      <td><span class="badge ${cls}">${lbl}</span></td>
      <td><div class="act-btns">
        <button class="act-btn edit" onclick="openEditItem(${i.id})" title="Редактировать"><i class="fas fa-edit"></i></button>
        <button class="act-btn move" onclick="openMove(${i.id})" title="Приход/Расход"><i class="fas fa-exchange-alt"></i></button>
        <button class="act-btn del"  onclick="deleteItem(${i.id})" title="Удалить"><i class="fas fa-trash-alt"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

function renderCards() {
  const grid = document.getElementById('view-grid');
  if (!items.length) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-seedling fa-3x"></i><div>Товары не найдены</div></div>`; return; }
  grid.innerHTML = items.map(i => {
    const [cls, lbl] = statusLabel(i);
    const imgEl = i.photo ? `<img src="${i.photo}" alt="">` : `<i class="fas fa-flower" style="font-size:48px; color:var(--rose)"></i>`;
    return `<div class="item-card" onclick="openEditItem(${i.id})">
      <div class="item-card-img">${imgEl}<div class="item-card-badge"><span class="badge ${cls}" style="font-size:10px">${lbl}</span></div></div>
      <div class="item-card-body">
        <div class="item-card-name">${escapeHtml(i.name)}</div>
        <div class="item-card-cat">${i.category_name || '—'}</div>
        <div class="item-card-foot">
          <div class="item-card-qty">${i.qty} <span style="font-size:11px;color:var(--muted);font-weight:400">${i.unit}</span></div>
          <div class="item-card-price">${i.price ? i.price + ' ₽' : '—'}</div>
        </div>
        <div class="item-card-actions">
          <button class="act-btn move" onclick="event.stopPropagation(); openMove(${i.id})" title="Приход/Расход"><i class="fas fa-exchange-alt"></i></button>
          <button class="act-btn edit" onclick="event.stopPropagation(); openEditItem(${i.id})" title="Редактировать"><i class="fas fa-edit"></i></button>
          <button class="act-btn del" onclick="event.stopPropagation(); deleteItem(${i.id})" title="Удалить"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function statusLabel(i) {
  if (i.qty === 0)          return ['badge-red', '<i class="fas fa-ban"></i> Нет'];
  if (i.qty <= i.min_qty)   return ['badge-yellow', '<i class="fas fa-exclamation-triangle"></i> Мало'];
  return ['badge-green', '<i class="fas fa-check-circle"></i> Есть'];
}

function setView(v) {
  if (isMobile && v === 'table') {
    toast('На телефоне доступен только плиточный вид', 'info');
    return;
  }
  currentView = v;
  document.getElementById('view-table').style.display = v === 'table' ? '' : 'none';
  document.getElementById('view-grid').style.display  = v === 'grid'  ? '' : 'none';
  document.getElementById('vt-table').classList.toggle('active', v === 'table');
  document.getElementById('vt-grid').classList.toggle('active',  v === 'grid');
  renderInventory();
}
function sortBy(f) { sortField === f ? sortDir *= -1 : (sortField = f, sortDir = 1); renderInventory(); }

// ── ITEM CRUD ─────────────────────────────────────────────────────────────────
function openAddItem() {
  editItemId = null; pendingPhotoFile = null;
  document.getElementById('item-modal-title').textContent = 'Добавить товар';
  clearItemForm();
  document.getElementById('fi-sku').value = 'FL-' + String(items.length + 1).padStart(3, '0');
  openModal('modal-item');
}
async function openEditItem(id) {
  editItemId = id; pendingPhotoFile = null;
  const res = await api(`/api/items/${id}`);
  if (!res.ok) return;
  const i = res.item;
  document.getElementById('item-modal-title').textContent = 'Редактировать товар';
  document.getElementById('fi-name').value     = i.name;
  document.getElementById('fi-emoji').value    = i.emoji || '';
  document.getElementById('fi-cat').value      = i.category_id || '';
  document.getElementById('fi-sku').value      = i.sku || '';
  document.getElementById('fi-qty').value      = i.qty;
  document.getElementById('fi-min').value      = i.min_qty;
  document.getElementById('fi-price').value    = i.price || '';
  document.getElementById('fi-unit').value     = i.unit || 'шт';
  document.getElementById('fi-supplier').value = i.supplier || '';
  document.getElementById('fi-note').value     = i.note || '';
  if (i.photo) setPhotoPreview(i.photo);
  else resetPhotoPreview();
  openModal('modal-item');
}
function clearItemForm() {
  ['fi-name','fi-emoji','fi-sku','fi-qty','fi-min','fi-price','fi-supplier','fi-note'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fi-unit').value = 'шт';
  resetPhotoPreview();
}

async function saveItem() {
  const name = document.getElementById('fi-name').value.trim();
  const qty  = parseInt(document.getElementById('fi-qty').value);
  const min  = parseInt(document.getElementById('fi-min').value);
  if (!name) { toast('Введите название', 'error'); return; }
  if (isNaN(qty) || qty < 0) { toast('Неверное количество', 'error'); return; }

  const body = {
    name, emoji:     document.getElementById('fi-emoji').value || '🌸',
    category_id:     parseInt(document.getElementById('fi-cat').value) || null,
    sku:             document.getElementById('fi-sku').value.trim(),
    qty,
    min_qty:         isNaN(min) ? 0 : min,
    price:           parseFloat(document.getElementById('fi-price').value) || 0,
    unit:            document.getElementById('fi-unit').value,
    supplier:        document.getElementById('fi-supplier').value.trim(),
    note:            document.getElementById('fi-note').value.trim(),
  };

  let res;
  if (editItemId) {
    res = await api(`/api/items/${editItemId}`, { method:'PUT', body });
  } else {
    res = await api('/api/items', { method:'POST', body });
  }
  if (!res.ok) { toast(res.error || 'Ошибка', 'error'); return; }

  // Upload photo if selected
  const itemId = editItemId || res.id;
  if (pendingPhotoFile && itemId) {
    const form = new FormData();
    form.append('photo', pendingPhotoFile);
    await fetch(`/api/items/${itemId}/photo`, { method:'POST', body: form });
  }

  toast(editItemId ? 'Сохранено ✓' : 'Товар добавлен ✓', 'success');
  closeModal('modal-item');
  renderInventory();
}

async function deleteItem(id) {
  const item = items.find(i => i.id === id);
  if (!item || !confirm(`Удалить "${item.name}"?`)) return;
  const res = await api(`/api/items/${id}`, { method:'DELETE' });
  if (res.ok) { toast('Удалено', 'info'); renderInventory(); }
  else toast(res.error, 'error');
}

// ── QUICK MOVE (±1) ───────────────────────────────────────────────────────────
async function quickMove(id, type) {
  const res = await api(`/api/items/${id}/move`, { method:'POST', body:{ type, qty:1 } });
  if (res.ok) {
    const item = items.find(i => String(i.id) === String(id));
    if (item) { item.qty = res.qty_after; renderTable(); }
    toast(type === 'in' ? '+1 принято' : '−1 выдано', 'success');
  }
}

// ── MOVE MODAL ────────────────────────────────────────────────────────────────
function openMove(id) {
  moveItemId = id; moveType = 'in';
  const item = items.find(i => i.id === id);
  document.getElementById('move-title').textContent = `${item?.emoji || ''} ${item?.name || 'Товар'}`;
  document.getElementById('move-qty').value  = '';
  document.getElementById('move-note').value = '';
  setMoveType('in');
  openModal('modal-move');
}
function setMoveType(t) {
  moveType = t;
  document.getElementById('move-in-btn').classList.toggle('active',  t === 'in');
  document.getElementById('move-out-btn').classList.toggle('active', t === 'out');
}
async function doMove() {
  const qty  = parseInt(document.getElementById('move-qty').value);
  const note = document.getElementById('move-note').value;
  if (!qty || qty <= 0) { toast('Введите количество', 'error'); return; }
  const res = await api(`/api/items/${moveItemId}/move`, { method:'POST', body:{ type:moveType, qty, note } });
  if (res.ok) {
    toast(moveType === 'in' ? `Принято +${qty}` : `Выдано −${qty}`, 'success');
    closeModal('modal-move');
    renderInventory();
  } else toast(res.error, 'error');
}

// ── PHOTO ─────────────────────────────────────────────────────────────────────
function handlePhotoSelect(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Файл до 5 МБ', 'error'); return; }
  pendingPhotoFile = file;
  const reader = new FileReader();
  reader.onload = e => setPhotoPreview(e.target.result);
  reader.readAsDataURL(file);
}
function setPhotoPreview(src) {
  document.getElementById('photo-preview').innerHTML =
    `<img src="${src}" style="max-height:80px;border-radius:8px;max-width:100%"><div style="font-size:12px;color:var(--muted);margin-top:6px">Нажмите чтобы изменить</div>`;
}
function resetPhotoPreview() {
  document.getElementById('photo-preview').innerHTML =
    `<div style="font-size:36px;margin-bottom:8px"><i class="fas fa-camera"></i></div><div style="font-size:13px;color:var(--muted)">Нажмите чтобы загрузить фото<br><small style="color:var(--muted2)">JPG, PNG, WEBP до 5 МБ</small></div>`;
}
function viewPhoto(url, name) {
  document.getElementById('photo-view-img').src = url;
  document.getElementById('photo-view-title').textContent = name;
  openModal('modal-photo');
}

// ── REPORT ────────────────────────────────────────────────────────────────────
async function populateReportFilter() {
  const res = await api('/api/items');
  if (!res.ok) return;
  const sel = document.getElementById('r-item-filter');
  sel.innerHTML = '<option value="">Все товары</option>' +
    res.items.map(i => `<option value="${i.id}"><i class="fas fa-box"></i> ${escapeHtml(i.name)}</option>`).join('');
}

async function setPeriod(days, btn) {
  reportPeriod = days;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderReport();
}

async function renderReport() {
  const itemId = document.getElementById('r-item-filter')?.value || '';
  const [movRes, histRes, catRes] = await Promise.all([
    api(`/api/stats/movements?days=${reportPeriod}`),
    api(`/api/stats/history?days=${reportPeriod}${itemId ? '&item_id=' + itemId : ''}`),
    api('/api/stats/categories'),
  ]);

  if (histRes.ok) {
    const h = histRes.rows;
    document.getElementById('r-ops').textContent = h.length;
    document.getElementById('r-out').textContent = h.filter(x => x.type === 'out').reduce((s, x) => s + x.qty, 0);
    document.getElementById('r-in').textContent  = h.filter(x => x.type === 'in').reduce((s, x) => s + x.qty, 0);
    renderHistoryTable(h);
    renderHistoryCards(h);
  }
  if (movRes.ok) renderWeekChart('report-chart', movRes.rows, reportPeriod);
  if (catRes.ok) {
    const max = catRes.rows[0]?.total_qty || 1;
    document.getElementById('r-cat-chart').innerHTML = catRes.rows.map(r => `
      <div class="top-item">
        <div class="top-emoji"><i class="fas fa-tag"></i></div>
        <div class="top-info"><div class="top-name">${r.name}</div></div>
        <div class="top-bar"><div class="top-bar-fill" style="width:${Math.round(r.total_qty / max * 100)}%"></div></div>
        <div class="top-val">${r.total_qty}</div>
      </div>`).join('');
  }
}

function renderHistoryTable(rows) {
  const typeMap = { in:'📥 Приход', out:'📤 Выдача', adjust:'⚙️ Корр.', create:'✨ Создан', delete:'🗑️ Удалён' };
  document.getElementById('history-tbody').innerHTML = rows.slice(0, 100).map(r => {
    const dt = parseUTCtoTajikDate(r.created_at);
    const formatted = formatTajikDate(dt, true);
    const cls = r.type === 'in' || r.type === 'create' ? 'mov-in' : 'mov-out';
    const sign = r.type === 'in' || r.type === 'create' ? '+' : '−';
    return `<tr>
      <td style="color:var(--muted);white-space:nowrap">${formatted}</td>
      <td><i class="fas fa-box"></i> <b>${escapeHtml(r.item_name)}</b></td>
      <td style="white-space:nowrap">${typeMap[r.type] || r.type}</td>
      <td class="${cls}">${sign}${r.qty}</td>
      <td style="color:var(--muted)">${r.qty_before}</td>
      <td style="color:var(--muted)">${r.qty_after}</td>
      <td style="color:var(--muted)"><i class="fas fa-user"></i> ${escapeHtml(r.user_login)}</td>
      <td style="color:var(--muted)">${r.note || '—'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--muted2)">Нет данных за период</td></tr>`;
}

function renderHistoryCards(rows) {
  const container = document.getElementById('history-cards-view');
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-history fa-3x"></i><div>Нет данных за период</div></div>';
    return;
  }
  container.innerHTML = rows.slice(0, 100).map(r => {
    const dt = parseUTCtoTajikDate(r.created_at);
    const formatted = formatTajikDate(dt, true);
    const typeIcon = {
      'in': 'fa-arrow-down',
      'out': 'fa-arrow-up',
      'adjust': 'fa-sliders-h',
      'create': 'fa-plus-circle',
      'delete': 'fa-trash-alt'
    }[r.type] || 'fa-exchange-alt';
    const typeLabel = {
      'in': 'Приход',
      'out': 'Выдача',
      'adjust': 'Коррекция',
      'create': 'Создание',
      'delete': 'Удаление'
    }[r.type] || r.type;
    const qtyClass = r.type === 'in' || r.type === 'create' ? 'in' : 'out';
    const sign = r.type === 'in' || r.type === 'create' ? '+' : '−';
    
    return `
      <div class="history-card">
        <div class="history-card-header">
          <div class="history-card-icon"><i class="fas ${typeIcon}"></i></div>
          <div class="history-card-title">
            <div class="history-card-name">${escapeHtml(r.item_name)}</div>
            <div class="history-card-type">${typeLabel}</div>
          </div>
          <div class="history-card-date">${formatted}</div>
        </div>
        <div class="history-card-details">
          <div class="history-card-qty ${qtyClass}">${sign}${r.qty} ${r.unit || ''}</div>
          <div class="history-card-before-after">${r.qty_before} → ${r.qty_after}</div>
        </div>
        <div class="history-card-user">
          <i class="fas fa-user"></i> ${escapeHtml(r.user_login)}
        </div>
        ${r.note ? `<div class="history-card-note"><i class="fas fa-comment"></i> ${escapeHtml(r.note)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ── USERS ─────────────────────────────────────────────────────────────────────
async function renderUsers() {
  const res = await api('/api/admin/users');
  if (!res.ok) return;
  const users = res.users;
  // Таблица (десктоп)
  document.getElementById('users-tbody').innerHTML = users.map(u => {
    const roleBadge = u.role === 'admin' ? '<span class="badge badge-admin">👑 Админ</span>' : '<span class="badge badge-user">👤 Сотрудник</span>';
    const statusBadge = u.is_active ? '<span class="badge badge-green">Активен</span>' : '<span class="badge badge-off">Отключён</span>';
    const created = u.created_at ? formatTajikDate(parseUTCtoTajikDate(u.created_at), false) : '—';
    const last = u.last_login ? formatTajikDate(parseUTCtoTajikDate(u.last_login), false) : '—';
    
    return `<tr>
      <td style="color:var(--muted)">${u.id}</td>
      <td><b>${escapeHtml(u.login)}</b></td>
      <td style="color:var(--muted)">${escapeHtml(u.full_name || '—')}</td>
      <td>${roleBadge}</td>
      <td style="color:var(--muted)">${created}</td>
      <td style="color:var(--muted)">${last}</td>
      <td>${statusBadge}</td>
      <td><div class="act-btns">
        <button class="act-btn pass" onclick="openResetPass(${u.id},'${escapeHtml(u.login)}')" title="Сбросить пароль"><i class="fas fa-key"></i></button>
        <button class="act-btn edit" onclick="toggleActive(${u.id},${u.is_active})" title="${u.is_active ? 'Деактивировать' : 'Активировать'}"><i class="fas ${u.is_active ? 'fa-lock' : 'fa-lock-open'}"></i></button>
        <button class="act-btn del"  onclick="deleteUser(${u.id},'${escapeHtml(u.login)}')" title="Удалить"><i class="fas fa-trash-alt"></i></button>
      </div></td>
    </tr>`;
  }).join('');
  // Карточки (мобильные)
  renderUsersCards(users);
}

function renderUsersCards(users) {
  const container = document.getElementById('users-cards-view');
  if (!users.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users fa-3x"></i><div>Пользователи не найдены</div></div>';
    return;
  }
  container.innerHTML = users.map(u => {
    const roleBadge = u.role === 'admin' 
      ? '<span class="badge badge-admin"><i class="fas fa-crown"></i> Админ</span>' 
      : '<span class="badge badge-user"><i class="fas fa-user"></i> Сотрудник</span>';
    const statusBadge = u.is_active 
      ? '<span class="badge badge-green"><i class="fas fa-check-circle"></i> Активен</span>' 
      : '<span class="badge badge-off"><i class="fas fa-ban"></i> Отключён</span>';
    const created = u.created_at ? formatTajikDate(parseUTCtoTajikDate(u.created_at), false) : '—';
    const last = u.last_login ? formatTajikDate(parseUTCtoTajikDate(u.last_login), false) : '—';
    const initials = (u.full_name || u.login).substring(0, 2).toUpperCase();
    
    return `
      <div class="user-card">
        <div class="user-card-header">
          <div class="user-avatar-card">${initials}</div>
          <div class="user-info-card">
            <div class="user-login-card">${escapeHtml(u.login)}</div>
            <div class="user-name-card">${escapeHtml(u.full_name || '—')}</div>
          </div>
        </div>
        <div class="user-badges">
          ${roleBadge} ${statusBadge}
        </div>
        <div class="user-details">
          <div class="user-detail-item">
            <span class="user-detail-label"><i class="fas fa-calendar"></i> Создан</span>
            <span class="user-detail-value">${created}</span>
          </div>
          <div class="user-detail-item">
            <span class="user-detail-label"><i class="fas fa-sign-in-alt"></i> Последний вход</span>
            <span class="user-detail-value">${last}</span>
          </div>
        </div>
        <div class="user-actions-card">
          <button class="act-btn pass" onclick="openResetPass(${u.id},'${escapeHtml(u.login)}')" title="Сбросить пароль"><i class="fas fa-key"></i></button>
          <button class="act-btn edit" onclick="toggleActive(${u.id},${u.is_active})" title="${u.is_active ? 'Деактивировать' : 'Активировать'}"><i class="fas ${u.is_active ? 'fa-lock' : 'fa-lock-open'}"></i></button>
          <button class="act-btn del" onclick="deleteUser(${u.id},'${escapeHtml(u.login)}')" title="Удалить"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

function openAddUser() {
  ['u-login','u-name','u-pass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('u-role').value = 'user';
  document.getElementById('user-modal-title').textContent = 'Добавить пользователя';
  openModal('modal-user');
}
async function saveUser() {
  const login = document.getElementById('u-login').value.trim();
  const pass  = document.getElementById('u-pass').value;
  const role  = document.getElementById('u-role').value;
  const name  = document.getElementById('u-name').value.trim();
  if (!login || !pass) { toast('Заполните логин и пароль', 'error'); return; }
  const res = await api('/api/admin/users', { method:'POST', body:{ login, password:pass, role, full_name:name } });
  if (res.ok) { toast('Пользователь создан ✓', 'success'); closeModal('modal-user'); renderUsers(); }
  else toast(res.error, 'error');
}

function openResetPass(id, login) {
  resetUserId = id;
  document.getElementById('reset-pass-title').textContent = `Сброс пароля: ${login}`;
  document.getElementById('rp-new').value = '';
  openModal('modal-reset-pass');
}
async function doResetPassword() {
  const np = document.getElementById('rp-new').value;
  if (!np || np.length < 4) { toast('Минимум 4 символа', 'error'); return; }
  const res = await api(`/api/admin/users/${resetUserId}/password`, { method:'PUT', body:{ new_password:np } });
  if (res.ok) { toast('Пароль сброшен ✓', 'success'); closeModal('modal-reset-pass'); }
  else toast(res.error, 'error');
}

async function toggleActive(id, current) {
  const res = await api(`/api/admin/users/${id}`, { method:'PUT', body:{ is_active: current ? 0 : 1 } });
  if (res.ok) { renderUsers(); toast(current ? 'Пользователь деактивирован' : 'Пользователь активирован', 'info'); }
  else toast(res.error, 'error');
}
async function deleteUser(id, login) {
  if (!confirm(`Удалить пользователя "${login}"?`)) return;
  const res = await api(`/api/admin/users/${id}`, { method:'DELETE' });
  if (res.ok) { toast('Удалено', 'info'); renderUsers(); }
  else toast(res.error, 'error');
}

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
function openChangePassword() {
  ['cp-current','cp-new','cp-confirm'].forEach(id => document.getElementById(id).value = '');
  openModal('modal-pass');
}
async function doChangePassword() {
  const cur = document.getElementById('cp-current').value;
  const np  = document.getElementById('cp-new').value;
  const nc  = document.getElementById('cp-confirm').value;
  if (!cur || !np) { toast('Заполните все поля', 'error'); return; }
  if (np !== nc)   { toast('Пароли не совпадают', 'error'); return; }
  if (np.length < 4) { toast('Минимум 4 символа', 'error'); return; }
  const res = await api('/api/auth/change-password', { method:'POST', body:{ current_password:cur, new_password:np } });
  if (res.ok) { toast('Пароль изменён ✓', 'success'); closeModal('modal-pass'); }
  else toast(res.error, 'error');
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function exportCSV() {
  const rows = [['Название','Категория','Артикул','Кол-во','Ед.','Цена','Мин.','Поставщик','Статус','Примечание']];
  items.forEach(i => {
    const s = i.qty === 0 ? 'Нет' : i.qty <= i.min_qty ? 'Мало' : 'Есть';
    rows.push([i.name, i.category_name||'', i.sku||'', i.qty, i.unit, i.price, i.min_qty, i.supplier||'', s, i.note||'']);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'склад_' + new Date().toLocaleDateString('ru') + '.csv';
  a.click();
  toast('Экспорт готов 📥', 'success');
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
async function doLogout() {
  await api('/api/auth/logout', { method:'POST' });
  window.location.href = '/login';
}

// ── MODAL HELPERS ─────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(o => closeModal(o.id));
});

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' }[type] || 'fa-info';
  el.innerHTML = `<i class="fas ${icon}"></i> ${msg}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── CLOCK ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const formatted = now.toLocaleString('ru-RU', {
    timeZone: 'Asia/Dushanbe',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  document.getElementById('clock').textContent = formatted;
}
function timeAgo(str) {
  const diff = Date.now() - new Date(str + 'Z').getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} д назад`;
}

// ── SEARCH EVENTS ─────────────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input',   () => renderInventory());
document.getElementById('f-cat').addEventListener('change',  () => { activeCat = ''; document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.cat-btn')[0]?.classList.add('active'); renderInventory(); });
document.getElementById('f-status').addEventListener('change', () => renderInventory());

// Drag & Drop photo
document.addEventListener('DOMContentLoaded', () => {
  const area = document.getElementById('photo-area');
  if (!area) return;
  area.addEventListener('dragover', e => { e.preventDefault(); area.style.borderColor = 'var(--rose)'; });
  area.addEventListener('dragleave', () => { area.style.borderColor = ''; });
  area.addEventListener('drop', e => {
    e.preventDefault(); area.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      pendingPhotoFile = file;
      const r = new FileReader();
      r.onload = ev => setPhotoPreview(ev.target.result);
      r.readAsDataURL(file);
    }
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
init();