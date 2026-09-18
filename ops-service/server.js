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
const claudeRunner = require('./src/claudeRunner');
const elevenlabs = require('./src/elevenlabs');

const DATA_DIR = process.env.DATA_DIR || '/data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const WORK_LOG_PATH = path.join(DATA_DIR, 'work-log.md');
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
  ');' +
  'CREATE TABLE IF NOT EXISTS voice_messages (' +
  '  id TEXT PRIMARY KEY,' +
  '  mode TEXT NOT NULL,' +
  '  transcript TEXT NOT NULL,' +
  '  status TEXT NOT NULL,' +
  '  reply_text TEXT,' +
  '  error_message TEXT,' +
  '  created_at TEXT NOT NULL,' +
  '  completed_at TEXT' +
  ');' +
  'CREATE INDEX IF NOT EXISTS idx_voice_messages_created ON voice_messages(created_at);' +
  'CREATE TABLE IF NOT EXISTS voice_session (' +
  '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
  '  claude_session_id TEXT,' +
  '  updated_at TEXT NOT NULL' +
  ');'
);

// activity_log: JSON array of short strings describing what CC is doing
// while a message is in flight (tool calls, intermediate text) — powers
// the "code-like" live activity pane in the Project Manager tab, separate
// from the clean final reply_text. Added after voice_messages already
// existed in production, so a plain CREATE TABLE IF NOT EXISTS above
// won't retrofit it onto an existing DB file — ALTER TABLE, no-op if the
// column is already there (fresh DB or already migrated).
try { db.exec('ALTER TABLE voice_messages ADD COLUMN activity_log TEXT'); } catch (e) { /* already exists */ }

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
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  insertVoiceMessage: db.prepare('INSERT INTO voice_messages (id, mode, transcript, status, created_at) VALUES (?, ?, ?, ?, ?)'),
  setVoiceMessageStatus: db.prepare('UPDATE voice_messages SET status = ? WHERE id = ?'),
  setVoiceActivityLog: db.prepare('UPDATE voice_messages SET activity_log = ? WHERE id = ?'),
  finishVoiceMessage: db.prepare('UPDATE voice_messages SET status = ?, reply_text = ?, error_message = ?, completed_at = ? WHERE id = ?'),
  getVoiceMessage: db.prepare('SELECT * FROM voice_messages WHERE id = ?'),
  listVoiceMessages: db.prepare('SELECT * FROM voice_messages ORDER BY created_at DESC LIMIT ?'),
  getVoiceSession: db.prepare('SELECT claude_session_id FROM voice_session WHERE id = 1'),
  upsertVoiceSession: db.prepare(
    'INSERT INTO voice_session (id, claude_session_id, updated_at) VALUES (1, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET claude_session_id = excluded.claude_session_id, updated_at = excluded.updated_at'
  ),
  clearVoiceSession: db.prepare('DELETE FROM voice_session WHERE id = 1')
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
app.use('/api/voice', requireAuth);

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

// --- Voice app: talk to a real headless Claude Code agent by voice or text ---
// Separate concern again (own tables, own routes) from the content-ops
// board above — see CLAUDE.md section on the voice app for the full design.
const VOICE_SYSTEM_PROMPT =
  'This session may also be reached through Harvey\'s voice/chat assistant app, in ' +
  'addition to normal interactive sessions. A user message that starts with a bracketed ' +
  'tag like "[Voice message ...]" or "[Voice instruction ...]" is framing added by that ' +
  'app, not something Harvey actually said — follow its instruction but do not quote it ' +
  'back or mention the tag. Two separate things happen on every voice-app turn, and ' +
  'neither replaces the other: (1) your final response text is read aloud to Harvey or ' +
  'shown to him as text — it must actually and completely answer whatever he asked, in ' +
  'plain spoken language, never a vague confirmation like "done" or "logged that"; ' +
  '(2) separately, after finishing, append one line to ' + WORK_LOG_PATH + ' as a ' +
  'housekeeping record formatted "- [ISO timestamp] <one-line summary>" (create the file ' +
  'if it does not exist) — this logging step is for your own future reference only and ' +
  'must never substitute for actually answering Harvey in your final response.';

function buildVoicePrompt(mode, text) {
  if (mode === 'execute') {
    return '[Voice instruction from Harvey, sent while away from his desk — proceed with full ' +
      'autonomy using your normal judgement and this project\'s CLAUDE.md conventions. Do not ask ' +
      'clarifying questions — make the most reasonable assumption and note it briefly. He will not ' +
      'hear a spoken reply and is not watching live, but your final answer IS shown to him ' +
      'afterward as text, so make it a real completion summary (what you did/found/decided), not ' +
      'a throwaway line — carry out the task fully.] ' + text;
  }
  return '[Voice message from Harvey, sent from his phone or desktop — he expects a reply. If it ' +
    'will be read aloud by text-to-speech, keep your final answer short and conversational: no ' +
    'markdown, no bullet points, no headers, no code blocks, just plain spoken sentences. If it ' +
    'needs you to check code, logs, git history, or run commands to answer accurately, do that ' +
    'first.] ' + text;
}

let voiceQueue = [];
let voiceProcessing = false;

function drainVoiceQueue() {
  if (voiceProcessing) return;
  const next = voiceQueue.shift();
  if (!next) return;
  voiceProcessing = true;
  processVoiceMessage(next.id, next.mode, next.text)
    .catch(function (err) {
      stmts.finishVoiceMessage.run('error', null, String((err && err.message) || err).slice(0, 2000), new Date().toISOString(), next.id);
    })
    .finally(function () {
      voiceProcessing = false;
      drainVoiceQueue();
    });
}

async function processVoiceMessage(id, mode, text) {
  stmts.setVoiceMessageStatus.run('running', id);
  const sessionRow = stmts.getVoiceSession.get();
  const sessionId = sessionRow && sessionRow.claude_session_id;
  const prompt = buildVoicePrompt(mode, text);

  // Streamed into the DB as it grows (not held until the run finishes) so
  // the Project Manager tab's right-hand activity pane can poll the same
  // /api/voice/messages/:id row and watch it fill in live.
  let activity = [];
  function onActivity(line) {
    activity.push(line);
    stmts.setVoiceActivityLog.run(JSON.stringify(activity.slice(-200)), id);
  }

  let result = await claudeRunner.runClaude({
    prompt: prompt,
    sessionId: sessionId,
    appendSystemPrompt: VOICE_SYSTEM_PROMPT,
    onActivity: onActivity
  });
  // The resumed session id can go stale (e.g. the CLI's local session store
  // living outside the persisted volume, wiped by a container rebuild) —
  // rather than leave every future message stuck repeating the same
  // failure forever, drop the dead session and retry once as a fresh one.
  if (!result.ok && sessionId && /no conversation found/i.test(result.error || '')) {
    console.error('voice claude session ' + sessionId + ' is gone, starting fresh:', result.error);
    stmts.clearVoiceSession.run();
    activity.push('— previous session was lost, starting a new one —');
    result = await claudeRunner.runClaude({
      prompt: prompt,
      sessionId: null,
      appendSystemPrompt: VOICE_SYSTEM_PROMPT,
      onActivity: onActivity
    });
  }
  const now = new Date().toISOString();
  if (result.sessionId) stmts.upsertVoiceSession.run(result.sessionId, now);
  if (!result.ok) {
    stmts.finishVoiceMessage.run('error', null, String(result.error || 'unknown error').slice(0, 2000), now, id);
    console.error('voice claude run failed:', result.error);
    return;
  }
  stmts.finishVoiceMessage.run('done', (result.replyText || '').slice(0, 8000), null, now, id);
}

app.post('/api/voice/messages', function (req, res) {
  const text = req.body && req.body.text;
  const mode = req.body && req.body.mode;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'invalid_text' });
  if (mode !== 'respond' && mode !== 'execute') return res.status(400).json({ error: 'invalid_mode' });
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const trimmed = text.trim().slice(0, 4000);
  stmts.insertVoiceMessage.run(id, mode, trimmed, 'pending', now);
  res.json({ id: id, status: 'pending' });
  voiceQueue.push({ id: id, mode: mode, text: trimmed });
  drainVoiceQueue();
});

function parseActivityLog(row) {
  if (!row) return row;
  try { row.activity_log = row.activity_log ? JSON.parse(row.activity_log) : []; } catch (e) { row.activity_log = []; }
  return row;
}

app.get('/api/voice/messages', function (req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  res.json(stmts.listVoiceMessages.all(limit).map(parseActivityLog));
});

app.get('/api/voice/messages/:id', function (req, res) {
  const row = stmts.getVoiceMessage.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(parseActivityLog(row));
});

app.post('/api/voice/session/reset', function (req, res) {
  stmts.clearVoiceSession.run();
  res.json({ ok: true });
});

app.get('/api/voice/worklog', function (req, res) {
  fs.readFile(WORK_LOG_PATH, 'utf8', function (err, data) {
    if (err) return res.json({ text: '' });
    const lines = data.split('\n').filter(Boolean);
    res.json({ text: lines.slice(-100).join('\n') });
  });
});

const voiceUpload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/api/voice/transcribe', voiceUpload.single('audio'), function (req, res) {
  if (!req.file) return res.status(400).json({ error: 'missing_audio' });
  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  fs.readFile(filePath, function (err, buf) {
    fs.rm(filePath, { force: true }, function () {});
    if (err) return res.status(500).json({ error: 'read_failed' });
    elevenlabs.transcribeAudio(buf, mimeType)
      .then(function (text) { res.json({ text: text }); })
      .catch(function (e) { console.error('transcribe failed:', e.message); res.status(502).json({ error: 'transcription_failed' }); });
  });
});

app.post('/api/voice/tts', function (req, res) {
  const text = req.body && req.body.text;
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'invalid_text' });
  elevenlabs.synthesizeSpeech(text.trim().slice(0, 4000))
    .then(function (audio) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.send(audio);
    })
    .catch(function (e) { console.error('tts failed:', e.message); res.status(502).json({ error: 'tts_failed' }); });
});

app.use(function (err, req, res, next) {
  console.error(err.message);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, function () { console.log('rm-ops-service listening on ' + PORT); });
