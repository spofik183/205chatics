const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '205chating-change-this-secret-in-production';
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultDb() { return { users: [], messages: [] }; }
function loadDb() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return defaultDb(); }
}
function saveDb(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
let db = loadDb();

const ADMIN_PHONE = '+77777777777';
const ADMIN_USERNAME = 'админ67';
const ADMIN_PASSWORD = '220419';

function normalizePhone(phone) { return String(phone || '').replace(/[^\d+]/g, ''); }
function normalizeUsername(username) { return String(username || '').trim().replace(/^@/, ''); }
function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    username: user.username,
    isAdmin: !!user.isAdmin,
    verified: !!user.verified,
    online: !!user.online,
    createdAt: user.createdAt
  };
}

async function ensureAdmin() {
  let admin = db.users.find(u => u.isAdmin || u.phone === ADMIN_PHONE || u.username === ADMIN_USERNAME);
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  if (!admin) {
    admin = {
      id: crypto.randomUUID(), phone: ADMIN_PHONE, username: ADMIN_USERNAME,
      passwordHash: hash, isAdmin: true, verified: true, online: false,
      createdAt: new Date().toISOString()
    };
    db.users.push(admin);
  } else {
    Object.assign(admin, { phone: ADMIN_PHONE, username: ADMIN_USERNAME, passwordHash: hash, isAdmin: true, verified: true });
  }
  saveDb(db);
}

function tokenFor(user) { return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' }); }
function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'Сессия недействительна' });
    req.user = user; next();
  } catch { return res.status(401).json({ error: 'Нужно войти' }); }
}
function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Только для администратора' });
  next();
}

app.post('/api/register', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const username = normalizeUsername(req.body.username);
  const password = String(req.body.password || '');
  if (!/^\+7\d{10}$/.test(phone)) return res.status(400).json({ error: 'Введите номер в формате +7XXXXXXXXXX' });
  if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) return res.status(400).json({ error: 'Username: 3–24 символа, буквы, цифры или _' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (db.users.some(u => u.phone === phone)) return res.status(409).json({ error: 'Этот номер уже зарегистрирован' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Этот username уже занят' });
  const user = {
    id: crypto.randomUUID(), phone, username,
    passwordHash: await bcrypt.hash(password, 10), isAdmin: false, verified: false, online: false,
    createdAt: new Date().toISOString()
  };
  db.users.push(user); saveDb(db);
  res.json({ token: tokenFor(user), user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const normalizedPhone = normalizePhone(login);
  const normalizedUsername = normalizeUsername(login).toLowerCase();
  const user = db.users.find(u => u.phone === normalizedPhone || u.username.toLowerCase() === normalizedUsername);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Неверный логин или пароль' });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/messages', auth, (req, res) => {
  const msgs = db.messages.slice(-300).map(m => serializeMessage(m, req.user));
  res.json({ messages: msgs });
});
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json({ users: db.users.map(publicUser) });
});
app.patch('/api/admin/users/:id/verified', auth, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.isAdmin) return res.status(400).json({ error: 'Галочка администратора постоянная' });
  user.verified = !!req.body.verified;
  saveDb(db);
  io.emit('user-updated', publicUser(user));
  res.json({ user: publicUser(user) });
});

function serializeMessage(m, viewer) {
  const sender = db.users.find(u => u.id === m.userId);
  return {
    id: m.id,
    text: m.text,
    createdAt: m.createdAt,
    anonymous: !!m.anonymous,
    mine: viewer.id === m.userId,
    sender: m.anonymous && !viewer.isAdmin
      ? { id: null, username: 'Аноним', verified: false, isAdmin: false }
      : { id: sender?.id || null, username: sender?.username || 'Удалённый пользователь', verified: !!sender?.verified, isAdmin: !!sender?.isAdmin },
    anonymousRealSender: m.anonymous && viewer.isAdmin ? { id: sender?.id, username: sender?.username, phone: sender?.phone } : null
  };
}

const onlineSockets = new Map();
function broadcastPresence(user) {
  io.emit('presence', { id: user.id, online: !!user.online });
}

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.id);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user; next();
  } catch { next(new Error('unauthorized')); }
});

io.on('connection', socket => {
  const user = socket.user;
  const count = (onlineSockets.get(user.id) || 0) + 1;
  onlineSockets.set(user.id, count);
  user.online = true; saveDb(db); broadcastPresence(user);

  socket.on('typing', isTyping => socket.broadcast.emit('typing', { userId: user.id, username: user.username, isTyping: !!isTyping }));

  socket.on('send-message', payload => {
    const text = String(payload?.text || '').trim().slice(0, 4000);
    if (!text) return;
    const m = { id: crypto.randomUUID(), userId: user.id, text, anonymous: !!payload?.anonymous, createdAt: new Date().toISOString() };
    db.messages.push(m);
    if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
    saveDb(db);
    for (const s of io.sockets.sockets.values()) s.emit('message', serializeMessage(m, s.user));
  });

  socket.on('delete-message', id => {
    const idx = db.messages.findIndex(m => m.id === id);
    if (idx < 0) return;
    const m = db.messages[idx];
    if (m.userId !== user.id && !user.isAdmin) return;
    db.messages.splice(idx, 1); saveDb(db); io.emit('message-deleted', id);
  });

  socket.on('disconnect', () => {
    const next = Math.max(0, (onlineSockets.get(user.id) || 1) - 1);
    if (next === 0) { onlineSockets.delete(user.id); user.online = false; saveDb(db); broadcastPresence(user); }
    else onlineSockets.set(user.id, next);
  });
});

ensureAdmin().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`205chating running on port ${PORT}`);
    });
});
