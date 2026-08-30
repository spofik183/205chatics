const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 30 * 1024 * 1024 });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '205chating-change-this-secret-in-production';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultDb() { return { users: [], messages: [] }; }
function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    parsed.users ||= [];
    parsed.messages ||= [];
    return parsed;
  } catch { return defaultDb(); }
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let db = loadDb();

const ADMIN_PHONE = '+77777777777';
const ADMIN_USERNAME = 'админ67';
const ADMIN_PASSWORD = '220419';

function normalizePhone(phone) { return String(phone || '').replace(/[^\d+]/g, ''); }
function normalizeUsername(username) { return String(username || '').trim().replace(/^@/, ''); }
function cleanUser(u) {
  return {
    id: u.id,
    phone: u.phone,
    username: u.username,
    avatarUrl: u.avatarUrl || '',
    isAdmin: !!u.isAdmin,
    verified: !!u.verified,
    online: !!u.online,
    createdAt: u.createdAt
  };
}

async function ensureAdmin() {
  let admin = db.users.find(u => u.isAdmin || u.phone === ADMIN_PHONE || u.username === ADMIN_USERNAME);
  if (!admin) {
    admin = {
      id: crypto.randomUUID(), phone: ADMIN_PHONE, username: ADMIN_USERNAME,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), avatarUrl: '',
      isAdmin: true, verified: true, online: false, createdAt: new Date().toISOString()
    };
    db.users.push(admin);
  } else {
    admin.phone = ADMIN_PHONE;
    admin.username = ADMIN_USERNAME;
    admin.isAdmin = true;
    admin.verified = true;
    admin.avatarUrl ||= '';
    // Do not overwrite the admin password on every restart.
    if (!admin.passwordHash) admin.passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  }
  saveDb();
}

function tokenFor(user) { return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' }); }
function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'Сессия недействительна' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ error: 'Нужно войти' }); }
}
function adminOnly(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Только для администратора' });
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

app.get('/health', (_req, res) => res.status(200).send('ok'));

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
    id: crypto.randomUUID(), phone, username, passwordHash: await bcrypt.hash(password, 10), avatarUrl: '',
    isAdmin: false, verified: false, online: false, createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDb();
  res.json({ token: tokenFor(user), user: cleanUser(user) });
});

app.post('/api/login', async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const normalizedPhone = normalizePhone(login);
  const normalizedUsername = normalizeUsername(login).toLowerCase();
  const user = db.users.find(u => u.phone === normalizedPhone || u.username.toLowerCase() === normalizedUsername);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Неверный логин или пароль' });
  res.json({ token: tokenFor(user), user: cleanUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: cleanUser(req.user) }));
app.patch('/api/profile', auth, (req, res) => {
  const username = normalizeUsername(req.body.username);
  if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) return res.status(400).json({ error: 'Username: 3–24 символа, буквы, цифры или _' });
  if (db.users.some(u => u.id !== req.user.id && u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Этот username уже занят' });
  req.user.username = username;
  saveDb();
  const user = cleanUser(req.user);
  io.emit('user-updated', user);
  res.json({ user });
});

app.post('/api/profile/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Выберите изображение' });
  if (!req.file.mimetype.startsWith('image/')) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Для аватара нужно изображение' });
  }
  req.user.avatarUrl = `/uploads/${req.file.filename}`;
  saveDb();
  const user = cleanUser(req.user);
  io.emit('user-updated', user);
  res.json({ user });
});

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не выбран' });
  const mime = req.file.mimetype || '';
  let type = 'file';
  if (mime.startsWith('image/')) type = 'image';
  else if (mime.startsWith('video/')) type = 'video';
  else if (mime.startsWith('audio/')) type = 'audio';
  if (type === 'file') {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Можно отправлять только фото, видео и голосовые сообщения' });
  }
  res.json({
    url: `/uploads/${req.file.filename}`,
    type,
    mime,
    name: String(req.file.originalname || '').slice(0, 120),
    size: req.file.size
  });
});

app.get('/api/messages', auth, (req, res) => {
  res.json({ messages: db.messages.slice(-300).map(m => serializeMessage(m, req.user)) });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  // Passwords are intentionally never returned. Only secure hashes are stored.
  res.json({ users: db.users.map(cleanUser) });
});
app.patch('/api/admin/users/:id/verified', auth, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.isAdmin) return res.status(400).json({ error: 'Галочка администратора постоянная' });
  user.verified = !!req.body.verified;
  saveDb();
  io.emit('user-updated', cleanUser(user));
  res.json({ user: cleanUser(user) });
});

function serializeMessage(m, viewer) {
  const sender = db.users.find(u => u.id === m.userId);
  const anonymousSender = { id: null, username: 'Аноним', verified: false, isAdmin: false, avatarUrl: '' };
  const visibleSender = sender ? cleanUser(sender) : { id: null, username: 'Удалённый пользователь', verified: false, isAdmin: false, avatarUrl: '' };
  return {
    id: m.id,
    text: m.text || '',
    type: m.type || 'text',
    mediaUrl: m.mediaUrl || '',
    fileName: m.fileName || '',
    mime: m.mime || '',
    createdAt: m.createdAt,
    anonymous: !!m.anonymous,
    mine: viewer.id === m.userId,
    sender: m.anonymous && !viewer.isAdmin ? anonymousSender : visibleSender,
    anonymousRealSender: m.anonymous && viewer.isAdmin && sender ? { id: sender.id, username: sender.username, phone: sender.phone } : null
  };
}

const onlineSockets = new Map();
function broadcastPresence(user) { io.emit('presence', { id: user.id, online: !!user.online }); }

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.id);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  } catch { next(new Error('unauthorized')); }
});

io.on('connection', socket => {
  const user = socket.user;
  onlineSockets.set(user.id, (onlineSockets.get(user.id) || 0) + 1);
  user.online = true;
  saveDb();
  broadcastPresence(user);

  socket.on('typing', isTyping => socket.broadcast.emit('typing', { userId: user.id, username: user.username, isTyping: !!isTyping }));

  socket.on('send-message', payload => {
    const text = String(payload?.text || '').trim().slice(0, 4000);
    const type = ['text', 'image', 'video', 'audio'].includes(payload?.type) ? payload.type : 'text';
    const mediaUrl = String(payload?.mediaUrl || '');
    if (type !== 'text' && !mediaUrl.startsWith('/uploads/')) return;
    if (type === 'text' && !text) return;
    const m = {
      id: crypto.randomUUID(), userId: user.id, text, type,
      mediaUrl: type === 'text' ? '' : mediaUrl,
      fileName: String(payload?.fileName || '').slice(0, 120),
      mime: String(payload?.mime || '').slice(0, 80),
      anonymous: !!payload?.anonymous,
      createdAt: new Date().toISOString()
    };
    db.messages.push(m);
    if (db.messages.length > 5000) db.messages = db.messages.slice(-5000);
    saveDb();
    for (const s of io.sockets.sockets.values()) s.emit('message', serializeMessage(m, s.user));
  });

  socket.on('delete-message', id => {
    const idx = db.messages.findIndex(m => m.id === id);
    if (idx < 0) return;
    const m = db.messages[idx];
    if (m.userId !== user.id && !user.isAdmin) return;
    db.messages.splice(idx, 1);
    saveDb();
    io.emit('message-deleted', id);
  });

  socket.on('disconnect', () => {
    const count = Math.max(0, (onlineSockets.get(user.id) || 1) - 1);
    if (!count) {
      onlineSockets.delete(user.id);
      user.online = false;
      saveDb();
      broadcastPresence(user);
    } else onlineSockets.set(user.id, count);
  });
});

ensureAdmin().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`205chating running on port ${PORT}`));
});
