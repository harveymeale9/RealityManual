// Backend for the Reality Manual /db internal content-ops control panel.
// Deliberately separate from the storefront's backend/ — different data,
// different concerns. See CLAUDE.md section 62.
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const PORT = process.env.PORT || 4001;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'ormiston';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://realitymanual.com,https://www.realitymanual.com')
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const STORE_NAMES = ['pieces', 'videos', 'audioTracks', 'settings', 'errors'];
const FILE_STORES = ['videos', 'audioTracks'];
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isValidStore(name) { return STORE_NAMES.indexOf(name) !== -1; }
function isValidId(id) { return typeof id === 'string' && ID_RE.test(id); }

// --- DB setup ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(
  'CREATE TABLE IF NOT EXISTS records (' +
  '  store_name TEXT NOT NULL,' +
  '  id TEXT NOT NULL,' +
  '  data TEXT NOT NULL,' +
  '  updated_at TEXT NOT NULL,' +
  '  PRIMARY KEY (store_name, id)' +
  ');' +
  'CREATE INDEX IF NOT EXISTS idx_records_store ON records(store_name);' +
  'CREATE TABLE IF NOT EXISTS sessions (' +
  '  token TEXT PRIMARY KEY,' +
  '  created_at TEXT NOT NULL,' +
  '  expires_at TEXT NOT NULL' +
  ');'
);

const stmts = {
  getAll: db.prepare('SELECT data FROM records WHERE store_name = ? ORDER BY updated_at ASC'),
  getOne: db.prepare('SELECT data FROM records WHERE store_name = ? AND id = ?'),
  upsert: db.prepare(
    'INSERT INTO records (store_name, id, data, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(store_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  ),
  del: db.prepare('DELETE FROM records WHERE store_name = ? AND id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?')
};

setInterval(function () { stmts.purgeSessions.run(new Date().toISOString()); }, 60 * 60 * 1000);

// --- App setup ---
const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(function (req, res, next) { res.set('Cache-Control', 'no-store'); next(); });

// Serves the /db control panel itself (index.html, quick-add.html,
// migrate.html, app.js, lib/, style.css, manifest/icon) from this same
// origin. GitHub Pages hardcodes `Cache-Control: max-age=600` on every
// file with no way to override it from the repo, which caused browsers to
// silently run a stale build for up to 10 minutes after every deploy —
// serving it from here instead guarantees no-store on every response.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  cacheControl: false
}));

// --- Simple login rate limiting (per-IP, in-memory) ---
const loginAttempts = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, windowStart: now };
  if (now - rec.windowStart > 15 * 60 * 1000) { rec.count = 0; rec.windowStart = now; }
  rec.count += 1;
  loginAttempts.set(ip, rec);
  return rec.count > 10;
}

app.post('/api/login', function (req, res) {
  const ip = req.ip || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || password !== PANEL_PASSWORD) {
    return res.status(401).json({ ok: false });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  stmts.insertSession.run(token, now.toISOString(), expires.toISOString());
  res.cookie('rm_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS
  });
  res.json({ ok: true });
});

app.post('/api/logout', function (req, res) {
  const token = req.cookies && req.cookies.rm_session;
  if (token) stmts.delSession.run(token);
  res.clearCookie('rm_session', { path: '/' });
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.rm_session;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const session = stmts.getSession.get(token);
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/api/me', requireAuth, function (req, res) { res.json({ ok: true }); });
app.get('/api/health', function (req, res) { res.json({ ok: true }); });
app.get('/robots.txt', function (req, res) { res.type('text/plain').send('User-agent: *\nDisallow: /\n'); });

app.use('/api/store', requireAuth);
app.use('/api/files', requireAuth);

app.get('/api/store/:storeName', function (req, res) {
  if (!isValidStore(req.params.storeName)) return res.status(400).json({ error: 'invalid_store' });
  const rows = stmts.getAll.all(req.params.storeName);
  res.json(rows.map(function (r) { return JSON.parse(r.data); }));
});

app.get('/api/store/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (!isValidStore(storeName) || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const row = stmts.getOne.get(storeName, id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(JSON.parse(row.data));
});

app.put('/api/store/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (!isValidStore(storeName) || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'invalid_body' });
  const record = Object.assign({}, req.body, { id: id });
  stmts.upsert.run(storeName, id, JSON.stringify(record), new Date().toISOString());
  res.json(record);
});

app.delete('/api/store/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (!isValidStore(storeName) || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  stmts.del.run(storeName, id);
  if (FILE_STORES.indexOf(storeName) !== -1) {
    const filePath = path.join(UPLOADS_DIR, storeName, id);
    fs.rm(filePath, { force: true }, function () {});
  }
  res.json({ ok: true });
});

// --- File-backed stores (videos, audioTracks) ---
const upload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.post('/api/files/:storeName/:id', upload.single('file'), function (req, res) {
  const { storeName, id } = req.params;
  if (FILE_STORES.indexOf(storeName) === -1 || !isValidId(id)) {
    if (req.file) fs.rm(req.file.path, { force: true }, function () {});
    return res.status(400).json({ error: 'invalid_params' });
  }
  if (!req.file) return res.status(400).json({ error: 'missing_file' });

  let meta = {};
  try { meta = req.body.meta ? JSON.parse(req.body.meta) : {}; }
  catch (e) { meta = {}; }

  const destDir = path.join(UPLOADS_DIR, storeName);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, id);

  fs.rename(req.file.path, destPath, function (err) {
    if (err) return res.status(500).json({ error: 'upload_failed' });
    const record = Object.assign({}, meta, {
      id: id,
      mimeType: req.file.mimetype || 'application/octet-stream'
    });
    stmts.upsert.run(storeName, id, JSON.stringify(record), new Date().toISOString());
    res.json(record);
  });
});

app.get('/api/files/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (FILE_STORES.indexOf(storeName) === -1 || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const filePath = path.join(UPLOADS_DIR, storeName, id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not_found' });
  const row = stmts.getOne.get(storeName, id);
  const meta = row ? JSON.parse(row.data) : {};
  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

app.use(function (err, req, res, next) {
  console.error(err.message);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, function () { console.log('rm-ops-service listening on ' + PORT); });
