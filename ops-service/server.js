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
const videoAnalysis = require('./src/videoAnalysis');
const youtubeAuth = require('./src/youtubeAuth');
const tiktokAuth = require('./src/tiktokAuth');

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
  ');' +
  // Single-row (id=1) — this panel has exactly one admin/one connected
  // YouTube channel, same "one row" pattern as voice_session above.
  // Tokens live here and nowhere else — never returned to the browser
  // (see GET /api/youtube/status, which only exposes connected/channelTitle).
  'CREATE TABLE IF NOT EXISTS youtube_oauth (' +
  '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
  '  channel_id TEXT,' +
  '  channel_title TEXT,' +
  '  access_token TEXT,' +
  '  refresh_token TEXT,' +
  '  expires_at TEXT,' +
  '  updated_at TEXT NOT NULL' +
  ');' +
  // Same single-row pattern as youtube_oauth above, for the one
  // connected TikTok account.
  'CREATE TABLE IF NOT EXISTS tiktok_oauth (' +
  '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
  '  open_id TEXT,' +
  '  display_name TEXT,' +
  '  access_token TEXT,' +
  '  refresh_token TEXT,' +
  '  expires_at TEXT,' +
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
// early_ack: the first genuinely contextual sentence CC produces for a
// turn (see claudeRunner.js's handleEvent) — spoken to Harvey immediately
// instead of a hardcoded filler phrase while the real work is still in
// progress. Same safe-ALTER pattern as activity_log above.
try { db.exec('ALTER TABLE voice_messages ADD COLUMN early_ack TEXT'); } catch (e) { /* already exists */ }
// reply_to_id: an earlier voice_messages.id this message is explicitly
// replying to — set when Harvey taps "Reply" on one of CC's messages in
// the UI, so a short follow-up ("yes do that") is unambiguous even after
// several different things have been discussed in the same thread. Same
// safe-ALTER pattern as the columns above.
try { db.exec('ALTER TABLE voice_messages ADD COLUMN reply_to_id TEXT'); } catch (e) { /* already exists */ }

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
  insertVoiceMessage: db.prepare('INSERT INTO voice_messages (id, mode, transcript, status, created_at, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)'),
  setVoiceMessageStatus: db.prepare('UPDATE voice_messages SET status = ? WHERE id = ?'),
  setVoiceActivityLog: db.prepare('UPDATE voice_messages SET activity_log = ? WHERE id = ?'),
  setVoiceEarlyAck: db.prepare('UPDATE voice_messages SET early_ack = ? WHERE id = ?'),
  finishVoiceMessage: db.prepare('UPDATE voice_messages SET status = ?, reply_text = ?, error_message = ?, completed_at = ? WHERE id = ?'),
  getVoiceMessage: db.prepare('SELECT * FROM voice_messages WHERE id = ?'),
  listVoiceMessages: db.prepare('SELECT * FROM voice_messages ORDER BY created_at DESC LIMIT ?'),
  getInflightVoiceMessages: db.prepare("SELECT * FROM voice_messages WHERE status IN ('pending','running') ORDER BY created_at ASC"),
  getVoiceSession: db.prepare('SELECT claude_session_id FROM voice_session WHERE id = 1'),
  upsertVoiceSession: db.prepare(
    'INSERT INTO voice_session (id, claude_session_id, updated_at) VALUES (1, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET claude_session_id = excluded.claude_session_id, updated_at = excluded.updated_at'
  ),
  clearVoiceSession: db.prepare('DELETE FROM voice_session WHERE id = 1'),
  getYoutubeAuth: db.prepare('SELECT * FROM youtube_oauth WHERE id = 1'),
  upsertYoutubeAuth: db.prepare(
    'INSERT INTO youtube_oauth (id, channel_id, channel_title, access_token, refresh_token, expires_at, updated_at) ' +
    'VALUES (1, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, channel_title = excluded.channel_title, ' +
    'access_token = excluded.access_token, refresh_token = excluded.refresh_token, ' +
    'expires_at = excluded.expires_at, updated_at = excluded.updated_at'
  ),
  clearYoutubeAuth: db.prepare('DELETE FROM youtube_oauth WHERE id = 1'),
  getTiktokAuth: db.prepare('SELECT * FROM tiktok_oauth WHERE id = 1'),
  upsertTiktokAuth: db.prepare(
    'INSERT INTO tiktok_oauth (id, open_id, display_name, access_token, refresh_token, expires_at, updated_at) ' +
    'VALUES (1, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET open_id = excluded.open_id, display_name = excluded.display_name, ' +
    'access_token = excluded.access_token, refresh_token = excluded.refresh_token, ' +
    'expires_at = excluded.expires_at, updated_at = excluded.updated_at'
  ),
  clearTiktokAuth: db.prepare('DELETE FROM tiktok_oauth WHERE id = 1')
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
//
// Served from the live git working tree (CLAUDE_REPO_DIR, bind-mounted at
// /repo in production — the exact directory the Project Manager's own
// Claude Code session edits and commits from), not a copy baked into the
// Docker image at build time. This is deliberate: it means a frontend-only
// change is visible on next page load the instant it's saved to disk, with
// no rebuild and no container restart — which otherwise kills whatever
// voice/chat turn is running mid-task every single time (see CLAUDE.md,
// "Project Manager kills itself on every ops-service push"). Falls back to
// the image-baked ./public for any environment without that mount (e.g.
// running server.js directly outside the container).
const REPO_PUBLIC_DIR = process.env.CLAUDE_REPO_DIR
  ? path.join(process.env.CLAUDE_REPO_DIR, 'ops-service', 'public')
  : null;
const STATIC_DIR = (REPO_PUBLIC_DIR && fs.existsSync(REPO_PUBLIC_DIR))
  ? REPO_PUBLIC_DIR
  : path.join(__dirname, 'public');
app.use(express.static(STATIC_DIR, {
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
app.use('/api/youtube', requireAuth);
app.use('/api/tiktok', requireAuth);

// --- YouTube OAuth (Google) — see src/youtubeAuth.js for the token
// exchange itself. Placeholder-until-configured: YOUTUBE_OAUTH_CLIENT_ID/
// SECRET/REDIRECT_URI aren't set yet as of 2026-09-20 (Harvey supplying
// them shortly), so /oauth/start correctly 500s with a clear message
// until then rather than crashing — the "Connect YouTube" button in
// Settings can exist and be clicked before the real credentials land.
app.get('/api/youtube/status', function (req, res) {
  const row = stmts.getYoutubeAuth.get();
  res.json({
    configured: youtubeAuth.isConfigured(),
    connected: !!(row && row.refresh_token),
    channelTitle: row ? row.channel_title : null
  });
});

app.get('/api/youtube/oauth/start', function (req, res) {
  if (!youtubeAuth.isConfigured()) {
    return res.status(500).send('YouTube OAuth is not configured yet — missing YOUTUBE_OAUTH_CLIENT_ID / ' +
      'YOUTUBE_OAUTH_CLIENT_SECRET / YOUTUBE_OAUTH_REDIRECT_URI on the server. Ask Harvey for status.');
  }
  // CSRF protection: a short-lived httpOnly cookie holding the same nonce
  // sent in the `state` param, checked back on the callback below —
  // standard OAuth state-parameter pattern, nothing app-specific.
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('yt_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 10 * 60 * 1000 });
  res.redirect(youtubeAuth.buildAuthUrl(state));
});

app.get('/api/youtube/oauth/callback', function (req, res) {
  if (!youtubeAuth.isConfigured()) {
    return res.status(500).send('YouTube OAuth is not configured yet.');
  }
  const expectedState = req.cookies && req.cookies.yt_oauth_state;
  res.clearCookie('yt_oauth_state', { path: '/' });
  if (req.query.error) {
    return res.redirect('/#settings');
  }
  if (!req.query.state || req.query.state !== expectedState) {
    return res.status(400).send('OAuth state did not match — please try connecting YouTube again from Content Settings.');
  }
  Promise.resolve()
    .then(function () { return youtubeAuth.exchangeCode(req.query.code); })
    .then(function (tokens) {
      return youtubeAuth.fetchChannelInfo(tokens.access_token).then(function (channel) {
        const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
        stmts.upsertYoutubeAuth.run(
          channel ? channel.channelId : null,
          channel ? channel.channelTitle : null,
          tokens.access_token,
          tokens.refresh_token || null,
          expiresAt,
          new Date().toISOString()
        );
      });
    })
    .then(function () { res.redirect('/#settings'); })
    .catch(function (err) {
      console.error('YouTube OAuth callback failed:', err.message);
      res.status(500).send('YouTube connection failed: ' + err.message);
    });
});

app.post('/api/youtube/disconnect', function (req, res) {
  stmts.clearYoutubeAuth.run();
  res.json({ ok: true });
});

// --- TikTok OAuth (Login Kit) — see src/tiktokAuth.js for the token
// exchange/publish calls themselves. Same placeholder-until-configured
// shape as the YouTube routes above.
app.get('/api/tiktok/status', function (req, res) {
  const row = stmts.getTiktokAuth.get();
  res.json({
    configured: tiktokAuth.isConfigured(),
    connected: !!(row && row.refresh_token),
    displayName: row ? row.display_name : null
  });
});

app.get('/api/tiktok/oauth/start', function (req, res) {
  if (!tiktokAuth.isConfigured()) {
    return res.status(500).send('TikTok OAuth is not configured yet — missing TIKTOK_CLIENT_KEY / ' +
      'TIKTOK_CLIENT_SECRET / TIKTOK_REDIRECT_URI on the server. Ask Harvey for status.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('tt_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 10 * 60 * 1000 });
  res.redirect(tiktokAuth.buildAuthUrl(state));
});

app.get('/api/tiktok/oauth/callback', function (req, res) {
  if (!tiktokAuth.isConfigured()) {
    return res.status(500).send('TikTok OAuth is not configured yet.');
  }
  const expectedState = req.cookies && req.cookies.tt_oauth_state;
  res.clearCookie('tt_oauth_state', { path: '/' });
  if (req.query.error) {
    return res.redirect('/#settings');
  }
  if (!req.query.state || req.query.state !== expectedState) {
    return res.status(400).send('OAuth state did not match — please try connecting TikTok again from Content Settings.');
  }
  Promise.resolve()
    .then(function () { return tiktokAuth.exchangeCode(req.query.code); })
    .then(function (tokens) {
      return tiktokAuth.fetchUserInfo(tokens.access_token).then(function (user) {
        const expiresAt = new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString();
        stmts.upsertTiktokAuth.run(
          user ? user.openId : (tokens.open_id || null),
          user ? user.displayName : null,
          tokens.access_token,
          tokens.refresh_token || null,
          expiresAt,
          new Date().toISOString()
        );
      });
    })
    .then(function () { res.redirect('/#settings'); })
    .catch(function (err) {
      console.error('TikTok OAuth callback failed:', err.message);
      res.status(500).send('TikTok connection failed: ' + err.message);
    });
});

app.post('/api/tiktok/disconnect', function (req, res) {
  stmts.clearTiktokAuth.run();
  res.json({ ok: true });
});

async function getValidTiktokAccessToken() {
  const row = stmts.getTiktokAuth.get();
  if (!row || !row.refresh_token) throw new Error('TikTok is not connected — connect it in Content Settings first.');
  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expiresAtMs > Date.now() + 60000) return row.access_token;
  const tokens = await tiktokAuth.refreshAccessToken(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString();
  // TikTok may issue a new refresh_token on refresh — persist whatever
  // came back rather than assuming it's unchanged (unlike Google, which
  // normally keeps the same one).
  stmts.upsertTiktokAuth.run(row.open_id, row.display_name, tokens.access_token, tokens.refresh_token || row.refresh_token, newExpiresAt, new Date().toISOString());
  return tokens.access_token;
}

// access_token is short-lived (~1hr) — refresh proactively whenever it's
// within a minute of expiring, using the stored refresh_token (which
// Google doesn't rotate on a normal refresh, so it's kept as-is).
async function getValidYoutubeAccessToken() {
  const row = stmts.getYoutubeAuth.get();
  if (!row || !row.refresh_token) throw new Error('YouTube is not connected — connect it in Content Settings first.');
  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expiresAtMs > Date.now() + 60000) return row.access_token;
  const tokens = await youtubeAuth.refreshAccessToken(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  stmts.upsertYoutubeAuth.run(row.channel_id, row.channel_title, tokens.access_token, row.refresh_token, newExpiresAt, new Date().toISOString());
  return tokens.access_token;
}

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

// --- Uploader tool: transcribe a freshly-uploaded video, match it to the
// right "Uploaded"-stage outline, and pull title candidates from it. See
// src/videoAnalysis.js for the actual work; this route just validates,
// responds immediately (the same "kick off the real work, respond 202,
// let the client poll the piece record" pattern the voice app already
// uses for its own long-running turns), and owns the one place that
// touches the `pieces` DB record before/during/after.
function getPieceRecord(id) {
  const row = stmts.getOne.get('pieces', id);
  return row ? JSON.parse(row.data) : null;
}
function savePieceRecord(piece) {
  stmts.upsert.run('pieces', piece.id, JSON.stringify(piece), new Date().toISOString());
}

async function runVideoAnalysis(id) {
  const piece = getPieceRecord(id);
  if (!piece) return; // deleted before analysis started — nothing to do
  piece.analysisStatus = 'running';
  savePieceRecord(piece);

  const videoPath = path.join(UPLOADS_DIR, 'videos', id);

  // Some uploads (iPhone HEVC recordings in particular) use a video codec
  // Chrome/Chromium can't decode at all — confirmed directly against a
  // real HEVC test upload: readyState reports HAVE_ENOUGH_DATA and
  // duration is known, but videoWidth/videoHeight stay 0 forever (no
  // amount of seeking/waiting fixes it), so canvas frame capture silently
  // produces a blank image and native <video> playback is unreliable too
  // — this is what was actually behind "Use this frame did nothing for
  // the vertical video," not anything orientation-specific, and it would
  // have equally broken Final Check's own video preview for the same
  // upload. Not fixable client-side (no JS trick makes a browser decode a
  // codec it doesn't support) — normalized to H.264 here, once, right
  // after upload, so every downstream consumer (inline frame picker,
  // Final Check preview, the final spliced video) just works without
  // needing its own codec-awareness.
  try {
    const compat = await videoAnalysis.ensureBrowserCompatibleVideo(videoPath);
    if (compat.transcoded) console.log('normalized video ' + id + ' from ' + compat.codec + ' to h264 for browser compatibility');
  } catch (e) {
    console.error('video codec normalization failed for ' + id + ':', e.message);
  }

  let transcript = '';
  try {
    const tmpDir = path.join(DATA_DIR, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    transcript = await videoAnalysis.transcribeVideo(videoPath, tmpDir);
  } catch (e) {
    console.error('video transcription failed for ' + id + ':', e.message);
  }

  try {
    const candidates = stmts.getAll.all('pieces')
      .map(function (r) { try { return JSON.parse(r.data); } catch (e) { return null; } })
      .filter(function (p) { return p && p.stage === 'uploaded'; })
      .map(function (p) {
        const probe = (p.notesHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return { id: p.id, seq: p.seq, title: p.title, notesSnippet: probe.slice(0, 400) };
      });
    const result = await videoAnalysis.matchAndGenerateTitles(transcript, candidates);

    const latest = getPieceRecord(id);
    if (!latest) return; // deleted while this was running
    latest.transcript = transcript;
    latest.analysisStatus = 'done';
    latest.analysisMatchedPieceId = result.matchedPieceId || '';
    if (result.titleOptions.length) latest.ytTitles = result.titleOptions;
    if (result.workingTitle) latest.title = result.workingTitle;
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  } catch (e) {
    console.error('video title/outline matching failed for ' + id + ':', e.message);
    const latest = getPieceRecord(id);
    if (!latest) return;
    latest.transcript = transcript;
    latest.analysisStatus = 'error';
    latest.analysisError = String(e.message || e).slice(0, 500);
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  }
}

app.post('/api/videos/:id/analyze', function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const filePath = path.join(UPLOADS_DIR, 'videos', id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'video_not_found' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  res.json({ ok: true, status: 'running' });
  runVideoAnalysis(id).catch(function (e) { console.error('unhandled video analysis error for ' + id + ':', e.message); });
});

// --- Building the actual final video (audio spliced in) before a piece
// is allowed into Final Check — Harvey's rule: the Final Check preview
// has to already be the real thing, audio and all, not the raw upload,
// so the piece stays in Processing until this finishes. The output lives
// at a separate `<id>-final` id in the same `videos` store (never
// overwriting the raw upload) specifically so re-running this later
// (Harvey picks a different audio track and sends it again) always
// splices from the untouched original, not from a previous splice.
const FINAL_VIDEO_SUFFIX = '-final';

async function runBuildFinalVideo(id) {
  const piece = getPieceRecord(id);
  if (!piece) return; // deleted before this started — nothing to do
  piece.finalBuildStatus = 'running';
  savePieceRecord(piece);

  try {
    const videoPath = path.join(UPLOADS_DIR, 'videos', id);
    let audioPath = null;
    if (piece.audioTrackId && piece.audioTrackId !== '__none__') {
      const candidate = path.join(UPLOADS_DIR, 'audioTracks', piece.audioTrackId);
      if (fs.existsSync(candidate)) audioPath = candidate;
      // A missing/deleted track just falls back to no-music (remux only)
      // rather than failing the whole build over it.
    }
    const finalId = id + FINAL_VIDEO_SUFFIX;
    const outPath = path.join(UPLOADS_DIR, 'videos', finalId);
    await videoAnalysis.buildFinalVideo(videoPath, audioPath, outPath);

    const stat = fs.statSync(outPath);
    const finalRecord = { id: finalId, fileName: 'final.mp4', sizeBytes: stat.size, mimeType: 'video/mp4', createdAt: new Date().toISOString() };
    stmts.upsert.run('videos', finalId, JSON.stringify(finalRecord), new Date().toISOString());

    const latest = getPieceRecord(id);
    if (!latest) return; // deleted while this was running
    latest.finalBuildStatus = 'done';
    latest.stage = 'final_check';
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  } catch (e) {
    console.error('final video build failed for ' + id + ':', e.message);
    const latest = getPieceRecord(id);
    if (!latest) return;
    latest.finalBuildStatus = 'error';
    latest.finalBuildError = String(e.message || e).slice(0, 500);
    // Deliberately NOT touching stage here — it stays in Processing so
    // Harvey can just try again (e.g. pick a different track) rather
    // than getting stuck on a stage that doesn't have a real video yet.
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  }
}

app.post('/api/videos/:id/build-final', function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const filePath = path.join(UPLOADS_DIR, 'videos', id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'video_not_found' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  res.json({ ok: true, status: 'running' });
  runBuildFinalVideo(id).catch(function (e) { console.error('unhandled final-build error for ' + id + ':', e.message); });
});

// --- Real YouTube publish: the actual videos.insert-equivalent, using the
// token stored by the OAuth connect flow above (src/youtubeAuth.js). Same
// "respond immediately, run the real work in the background, let the
// client poll the piece record" pattern as analyze/build-final — a real
// upload can take a while and there's no reason to hold the HTTP request
// open for it. Always uploads the built final video (`<id>-final`, audio
// already spliced in per Harvey's Final Check rule) if it exists, falling
// back to the raw upload only if it somehow doesn't — a piece can't
// actually reach Final Check without the final build having succeeded, so
// this fallback should never really trigger in practice.
async function runYoutubePublish(id, opts) {
  const piece = getPieceRecord(id);
  if (!piece) return; // deleted before this started
  piece.youtubePublishStatus = 'running';
  piece.youtubePublishError = '';
  savePieceRecord(piece);

  try {
    const finalPath = path.join(UPLOADS_DIR, 'videos', id + FINAL_VIDEO_SUFFIX);
    const rawPath = path.join(UPLOADS_DIR, 'videos', id);
    const useFinal = fs.existsSync(finalPath);
    const videoPath = useFinal ? finalPath : rawPath;
    if (!fs.existsSync(videoPath)) throw new Error('video file not found on disk');

    const videoRow = stmts.getOne.get('videos', useFinal ? (id + FINAL_VIDEO_SUFFIX) : id);
    const videoMeta = videoRow ? JSON.parse(videoRow.data) : {};
    const mimeType = videoMeta.mimeType || 'video/mp4';

    const accessToken = await getValidYoutubeAccessToken();
    const result = await youtubeAuth.uploadVideo(accessToken, videoPath, mimeType, {
      title: opts.title || piece.title || 'Untitled',
      description: opts.description || '',
      privacyStatus: opts.privacyStatus
    });

    const latest = getPieceRecord(id);
    if (!latest) return; // deleted while this was running
    latest.stage = 'live';
    latest.youtubePublishStatus = 'done';
    latest.youtubeVideoId = result.videoId;
    latest.youtubeUrl = 'https://www.youtube.com/watch?v=' + result.videoId;
    latest.postedAt = new Date().toISOString();
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  } catch (e) {
    console.error('YouTube publish failed for ' + id + ':', e.message);
    const latest = getPieceRecord(id);
    if (!latest) return;
    latest.youtubePublishStatus = 'error';
    latest.youtubePublishError = String(e.message || e).slice(0, 500);
    // Deliberately not touching stage — stays in Final Check so Harvey can
    // just try again, same convention as a failed final-video build.
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  }
}

app.post('/api/youtube/publish/:id', function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  const row = stmts.getYoutubeAuth.get();
  if (!row || !row.refresh_token) return res.status(400).json({ error: 'not_connected' });
  const body = req.body || {};
  const opts = {
    title: typeof body.title === 'string' ? body.title : '',
    description: typeof body.description === 'string' ? body.description : '',
    privacyStatus: typeof body.privacyStatus === 'string' ? body.privacyStatus : 'private'
  };
  res.json({ ok: true, status: 'running' });
  runYoutubePublish(id, opts).catch(function (e) { console.error('unhandled youtube publish error for ' + id + ':', e.message); });
});

// --- Real TikTok publish — same shape as the YouTube job above, using
// the token stored by the TikTok OAuth connect flow. Always uploads the
// built final video (`<id>-final`) if it exists, same reasoning as
// YouTube's version. Known limitation, not built: if a single piece is
// ever tagged for *both* ytlong and tiktok at once, this job and
// runYoutubePublish both read-modify-write the same piece record
// concurrently with no locking between them, so one could clobber the
// other's fields in a real (if narrow) race. Not fixed here since
// Harvey's actual test plan is one platform per piece (a separate video
// for each) — worth adding a per-piece lock if simultaneous multi-
// platform publishing from one piece is ever actually used.
async function runTiktokPublish(id, opts) {
  const piece = getPieceRecord(id);
  if (!piece) return; // deleted before this started
  piece.tiktokPublishStatus = 'running';
  piece.tiktokPublishError = '';
  savePieceRecord(piece);

  try {
    const finalPath = path.join(UPLOADS_DIR, 'videos', id + FINAL_VIDEO_SUFFIX);
    const rawPath = path.join(UPLOADS_DIR, 'videos', id);
    const useFinal = fs.existsSync(finalPath);
    const videoPath = useFinal ? finalPath : rawPath;
    if (!fs.existsSync(videoPath)) throw new Error('video file not found on disk');

    const videoRow = stmts.getOne.get('videos', useFinal ? (id + FINAL_VIDEO_SUFFIX) : id);
    const videoMeta = videoRow ? JSON.parse(videoRow.data) : {};
    const mimeType = videoMeta.mimeType || 'video/mp4';

    const accessToken = await getValidTiktokAccessToken();
    const result = await tiktokAuth.publishVideo(accessToken, videoPath, mimeType, {
      title: opts.title || piece.title || 'Untitled'
    });

    const latest = getPieceRecord(id);
    if (!latest) return; // deleted while this was running
    latest.stage = 'live';
    latest.tiktokPublishStatus = 'done';
    latest.tiktokPublishId = result.publishId;
    latest.tiktokPrivacyLevel = result.privacyLevel;
    latest.postedAt = new Date().toISOString();
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  } catch (e) {
    console.error('TikTok publish failed for ' + id + ':', e.message);
    const latest = getPieceRecord(id);
    if (!latest) return;
    latest.tiktokPublishStatus = 'error';
    latest.tiktokPublishError = String(e.message || e).slice(0, 500);
    // Deliberately not touching stage — same convention as a failed
    // YouTube publish or a failed final-video build.
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
  }
}

app.post('/api/tiktok/publish/:id', function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  const row = stmts.getTiktokAuth.get();
  if (!row || !row.refresh_token) return res.status(400).json({ error: 'not_connected' });
  const body = req.body || {};
  const opts = { title: typeof body.title === 'string' ? body.title : '' };
  res.json({ ok: true, status: 'running' });
  runTiktokPublish(id, opts).catch(function (e) { console.error('unhandled tiktok publish error for ' + id + ':', e.message); });
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
  'neither replaces the other: (1) your final response text is shown to Harvey as text in ' +
  'the chat, and — for a quick turn only, see below — may also be read aloud; it must ' +
  'actually and completely answer whatever he asked, never a vague confirmation like ' +
  '"done" or "logged that"; (2) separately, after finishing, append one line to ' +
  WORK_LOG_PATH + ' as a housekeeping record formatted "- [ISO timestamp] <one-line ' +
  'summary>" (create the file if it does not exist) — this logging step is for your own ' +
  'future reference only and must never substitute for actually answering Harvey in your ' +
  'final response.\n\n' +
  'Formatting: the chat renders proper markdown (including fenced code blocks with a copy ' +
  'button), and the app itself strips markdown down to plain spoken text before anything is ' +
  'converted to speech — so use markdown normally, especially a fenced code block for any ' +
  'shell command, config, or anything Harvey would copy-paste. Never spell out or verbally ' +
  'narrate a command in prose (e.g. do not write "run ssh dash i tilde slash..." as ' +
  'sentences) — put it in a code block instead and just refer to it in your own words ' +
  '("run the command below").\n\n' +
  'IMPORTANT — action marker: check this on every single voice-app reply, it is easy to ' +
  'forget. If Harvey has to actually do something physical after reading your response — ' +
  'type/run a command himself, open a link, approve or decide something, hand you a ' +
  'missing value — start the response with the literal text "[NEEDS_ACTION]" then a ' +
  'newline, then the real content. This includes something as small as "here is a command ' +
  'for you to run" — giving him a command to run himself always qualifies, every time, no ' +
  'exceptions, even a short one-liner. It does NOT apply when you already ran the command ' +
  'yourself and are just reporting the result. Examples of a reply that NEEDS the marker:\n' +
  '[NEEDS_ACTION]\n' +
  'Run this to see the last 3 commits:\n' +
  '```\n' +
  'git log -3\n' +
  '```\n' +
  'Example that does NOT need it (you already ran it yourself): "The last 3 commits are: ' +
  'A, B, C." When in doubt about a borderline case, include the marker rather than omit it.\n\n' +
  'Quick verbal acknowledgment — UNCONDITIONAL, no exceptions, read this whole paragraph ' +
  'every single voice-app turn: your very first output, before doing anything else at all — ' +
  'before any tool call, before deciding whether you even need one — must be one short, ' +
  'genuine, specific sentence in your own words describing what you are about to go check or ' +
  'do for this exact message, said the way you would say it out loud to a colleague. Do NOT ' +
  'write any label, prefix, or meta-commentary describing this instruction itself — never ' +
  'output words like "task-style sentence," "acknowledgment sentence," or anything similar ' +
  'before your actual sentence. This exact leak (literally echoing this instruction\'s own ' +
  'wording back as visible text) has happened repeatedly across separate turns despite being ' +
  'flagged and supposedly fixed each time — Harvey has explicitly and emphatically asked for ' +
  'it to stop for good, so treat any urge to describe or label the sentence, rather than just ' +
  'saying it, as the exact mistake to avoid. This used ' +
  'to have an exception for "a turn you can answer directly with no tool use" and that ' +
  'exception is exactly what kept failing in practice: turns that felt partly conversational ' +
  '(a check-in, a quick question) but also involved real work got treated as "just answer ' +
  'directly," so no acknowledgment sentence was ever written, and the investigation/tool calls ' +
  'that followed happened in silence with no lead-in at all. Harvey has now reported this ' +
  'exact failure mode — the queue title showing his own raw spoken message, or a stray ' +
  'mid-task fragment that does not even summarize the actual request — repeatedly, across ' +
  'multiple separate turns, despite this paragraph already existing and already being tightened ' +
  'once before. Do not make the judgment call "does this turn need one" again; the rule is: ' +
  'every turn gets one, full stop, even a turn you are about to answer in one sentence anyway ' +
  '— in that case the acknowledgment and the final answer will look similar, which is fine and ' +
  'not a problem to solve around. This also shows up as the queue panel\'s item title, so it ' +
  'has to read like a task ("doing X" / "checking Y"), never like an answer to him and never ' +
  'like a reply to any small-talk/greeting part of his message (a real instance of that ' +
  'mistake: replying to "how\'s it going" with "Doing well — I verified..." — that answers ' +
  'him, it does not describe a task). E.g. if he asks "did the deploy actually go through," a ' +
  'good first line is "Checking the deploy log now to confirm it actually completed" — NOT ' +
  '"Got it, I\'ll get right on that," and NOT "Yes, it went through" (the answer, said before ' +
  'you have actually checked). Keep it to one short sentence; the real, complete answer still ' +
  'follows later as your normal final response once you actually have it — this is only the ' +
  'immediate acknowledgment, never a substitute for the real answer.\n\n' +
  'Two different reply shapes, depending on what Harvey actually said — decide which one ' +
  'this turn is and shape the acknowledgment accordingly: (1) He asked a question or wants ' +
  'you to look something up/check something — once you have the real answer, just give it ' +
  'to him plainly; if the turn genuinely needed no tool calls at all, the app speaks your ' +
  'whole final answer out loud automatically, so there is nothing extra to add on top of the ' +
  'acknowledgment sentence. (2) He gave you an instruction to go do something (fix a bug, ' +
  'edit a file, deploy, change a setting, etc.) — for this kind, the app only ever speaks ' +
  'your one acknowledgment sentence out loud, never the full result, so that sentence has to ' +
  'actually say you are going to go do the work and will report back in the chat once it is ' +
  'done — worded fresh each time, in your own words, based on what the task actually is (for ' +
  'example "I\'ll get that deploy script fixed and let you know here once it\'s live" or ' +
  '"Going to update the shipping rates now — I\'ll confirm in the chat once that\'s saved"), ' +
  'never the same phrase twice, and never a vague "I\'ll get right on that." Your real, full ' +
  'completion summary still gets written as the normal final response either way — that part ' +
  'is unchanged — this paragraph is only about what the one spoken acknowledgment sentence ' +
  'should say.\n\n' +
  'Task list (TodoWrite): only create a todo list at all when this turn is a genuine, ' +
  'multi-step actionable task. A remark, observation, question, or comment that doesn\'t ' +
  'require you to go do something (e.g. "nice work", "what do you think about X", a quick ' +
  'lookup you can just answer directly) should NOT get a todo list manufactured for it — ' +
  'just reply normally. When you do use one, do not paste Harvey\'s message into a todo ' +
  'item verbatim — each item should be a short, plain-language summary of what that step ' +
  'accomplishes (e.g. "Check recent order errors in the ops panel"), the same way you would ' +
  'title a task for a colleague, not a transcript of what he said.\n\n' +
  'Host access: you are running inside the rm-ops-service Docker container, which only ' +
  'contains this one service — for anything outside it (managing other Docker containers ' +
  'including rebuilding/redeploying this very one, nginx, systemd, or anything else on the ' +
  'actual VPS), reach the host directly: ' +
  '`ssh ubuntu@host.docker.internal \'<command>\'` (passwordless sudo is available there — ' +
  'use `sudo <command>` inside the ssh call for anything privileged). This is the same VPS ' +
  'this container itself runs on, reached the same way an interactive Claude Code terminal ' +
  'session on that machine would operate — use it freely for real infrastructure work, not ' +
  'just as a last resort. One real caveat: rebuilding/restarting rm-ops-service itself over ' +
  'that connection kills your own current process mid-command, so that specific final step ' +
  'never gets to report success back to you in the same turn — it is not a distinguished ' +
  'context you should decline to enter, just: log the actual state clearly in the work log ' +
  'immediately before you trigger it if the task will not otherwise be obvious on resume, ' +
  'then proceed normally, the same as any of your commands could.';

// Reminder tacked onto every single prompt, not just the system prompt —
// re-injected fresh right next to the actual content on every turn, which
// gets followed far more reliably in practice than the same rule sitting
// only in VOICE_SYSTEM_PROMPT (set once, at the start of a long-running
// resumed session). See VOICE_SYSTEM_PROMPT's "Quick verbal
// acknowledgment" paragraph for the full rule this is reinforcing.
const ACK_REMINDER = ' Before anything else, before any tool call: say, in one short sentence ' +
  'and your own words, what you are about to go check or do for this specific message — no ' +
  'exceptions, even if you expect to answer in one sentence anyway. Output ONLY that sentence ' +
  'itself. Do not prefix it with any label or description of this instruction (e.g. never write ' +
  '"task-style sentence" or similar) — that exact leak has happened repeatedly and Harvey has ' +
  'asked for it to stop for good.';

function buildVoicePrompt(mode, text) {
  if (mode === 'execute') {
    return '[Voice instruction from Harvey, sent while away from his desk — proceed with full ' +
      'autonomy using your normal judgement and this project\'s CLAUDE.md conventions. Do not ask ' +
      'clarifying questions — make the most reasonable assumption and note it briefly. He will not ' +
      'hear a spoken reply and is not watching live, but your final answer IS shown to him ' +
      'afterward as text, so make it a real completion summary (what you did/found/decided), not ' +
      'a throwaway line — carry out the task fully.' + ACK_REMINDER + '] ' + text;
  }
  return '[Voice message from Harvey, sent from his phone or desktop — he expects a reply. If ' +
    'this turn needs you to check code, logs, git history, or run commands to answer accurately, ' +
    'do that first — he is told immediately that you received this and are working on it, so a ' +
    'longer investigation is fine and expected, not something to shortcut.' + ACK_REMINDER + '] ' + text;
}

let voiceQueue = [];
let voiceProcessing = false;

function drainVoiceQueue() {
  if (voiceProcessing) return;
  const next = voiceQueue.shift();
  if (!next) return;
  voiceProcessing = true;
  processVoiceMessage(next.id, next.mode, next.text, next.imageBlock)
    .catch(function (err) {
      stmts.finishVoiceMessage.run('error', null, String((err && err.message) || err).slice(0, 2000), new Date().toISOString(), next.id);
    })
    .finally(function () {
      voiceProcessing = false;
      drainVoiceQueue();
    });
}

// Read on every fresh-session start (see buildSystemPromptForSession below)
// so a session with zero memory of anything Harvey said before — first
// message ever, "New conversation" was hit, or the previous session was
// lost — isn't starting completely blind, especially right after an
// unplanned restart (see recoverInflightVoiceMessages). This is the
// "self-healing" half of that: the *queue* recovers itself mechanically,
// this is what lets the *agent* understand what it was doing when it gets
// a fresh start rather than silently losing that thread.
function readRecentWorkLog(maxLines) {
  try {
    const lines = fs.readFileSync(WORK_LOG_PATH, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-(maxLines || 15)).join('\n');
  } catch (e) {
    return '';
  }
}

function buildSystemPromptForSession(sessionId) {
  if (sessionId) return VOICE_SYSTEM_PROMPT;
  const recentLog = readRecentWorkLog(15);
  if (!recentLog) return VOICE_SYSTEM_PROMPT;
  return VOICE_SYSTEM_PROMPT + '\n\nThis is a fresh session with no memory of anything before this message ' +
    '(the previous one ended, was reset, or was lost — e.g. a redeploy). Recent entries from your own work ' +
    'log, for context on what you and Harvey were doing recently:\n' + recentLog;
}

async function processVoiceMessage(id, mode, text, imageBlock) {
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
  // Written the instant it's available (well before the turn finishes) so
  // the client can speak it immediately instead of a hardcoded filler —
  // see claudeRunner.js's handleEvent for where this actually comes from.
  function onEarlyAck(ackText) {
    stmts.setVoiceEarlyAck.run(ackText.slice(0, 2000), id);
  }

  let result = await claudeRunner.runClaude({
    prompt: prompt,
    sessionId: sessionId,
    appendSystemPrompt: buildSystemPromptForSession(sessionId),
    onActivity: onActivity,
    onEarlyAck: onEarlyAck,
    imageBlock: imageBlock
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
      appendSystemPrompt: buildSystemPromptForSession(null),
      onActivity: onActivity,
      onEarlyAck: onEarlyAck,
      imageBlock: imageBlock
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

// Images pasted/dropped/attached into the chat (desktop paste-and-drop,
// mobile's attach button) — multipart so a text field and an optional
// file can arrive together in one request.
const voiceMessageUpload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 15 * 1024 * 1024 } });

app.post('/api/voice/messages', voiceMessageUpload.single('image'), function (req, res) {
  const rawText = (req.body && req.body.text) || '';
  const mode = req.body && req.body.mode;
  const trimmed = rawText.trim().slice(0, 4000);
  const rawReplyToId = (req.body && req.body.replyToId) || null;
  const replyToId = (typeof rawReplyToId === 'string' && rawReplyToId.trim()) ? rawReplyToId.trim().slice(0, 64) : null;
  function cleanupUpload() { if (req.file) fs.rm(req.file.path, { force: true }, function () {}); }
  if (!trimmed && !req.file) { cleanupUpload(); return res.status(400).json({ error: 'invalid_text' }); }
  if (mode !== 'respond' && mode !== 'execute') { cleanupUpload(); return res.status(400).json({ error: 'invalid_mode' }); }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const finalText = trimmed || '(image attached, no caption)';
  stmts.insertVoiceMessage.run(id, mode, finalText, 'pending', now, replyToId);
  res.json({ id: id, status: 'pending', reply_to_id: replyToId });

  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  let imageBlock = null;
  if (req.file && SUPPORTED_IMAGE_TYPES.indexOf(req.file.mimetype) !== -1) {
    try {
      imageBlock = { mediaType: req.file.mimetype, base64: fs.readFileSync(req.file.path).toString('base64') };
    } catch (e) { console.error('failed to read attached image:', e.message); }
  } else if (req.file) {
    console.error('unsupported attached image type: ' + req.file.mimetype);
  }
  cleanupUpload();

  // Reply-to context is woven into the prompt CC actually sees (not into
  // the stored transcript — that stays exactly what Harvey typed/said, for
  // the chat UI) so a short follow-up like "yes do that" is unambiguous
  // even after several different things have come up in the same thread.
  let promptText = finalText;
  if (replyToId) {
    const replyTarget = stmts.getVoiceMessage.get(replyToId);
    if (replyTarget) {
      const quoted = (replyTarget.reply_text || replyTarget.transcript || '').slice(0, 500);
      promptText = 'Harvey is replying directly to your specific earlier message quoted below — treat his new message as being about that one, not necessarily whatever was discussed most recently. Your earlier message: "' +
        quoted + '"\n\nHis reply: ' + finalText;
    }
  }

  voiceQueue.push({ id: id, mode: mode, text: promptText, imageBlock: imageBlock });
  drainVoiceQueue();
});

function hydrateVoiceMessageRow(row) {
  if (!row) return row;
  try { row.activity_log = row.activity_log ? JSON.parse(row.activity_log) : []; } catch (e) { row.activity_log = []; }
  // reply_to_snippet: resolved server-side (rather than left for the client
  // to cross-reference against whatever it happens to already have loaded)
  // so the quoted preview renders correctly even after a page reload, on a
  // device that never saw the original message, or once it's scrolled out
  // of the client's fetch window.
  if (row.reply_to_id) {
    const target = stmts.getVoiceMessage.get(row.reply_to_id);
    row.reply_to_snippet = target ? (target.reply_text || target.transcript || '').slice(0, 200) : null;
  } else {
    row.reply_to_snippet = null;
  }
  return row;
}

app.get('/api/voice/messages', function (req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  res.json(stmts.listVoiceMessages.all(limit).map(hydrateVoiceMessageRow));
});

app.get('/api/voice/messages/:id', function (req, res) {
  const row = stmts.getVoiceMessage.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(hydrateVoiceMessageRow(row));
});

app.post('/api/voice/session/reset', function (req, res) {
  stmts.clearVoiceSession.run();
  claudeRunner.resetSession();
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

// Recovers the voice queue after any restart (a normal redeploy included —
// this runs every single time the process starts, not just after a crash).
// The in-memory voiceQueue array and currentSession are always lost on
// restart even though the DB rows survive it: a 'pending' row never
// actually reached Claude, so it's simply safe to run from scratch: a
// 'running' row's actual completion state is unknown (the process could
// have died a moment before or after finishing the real work), so it's
// marked as an error instead of silently re-run — duplicating a git push
// or a file edit would be worse than asking Harvey to resend it. Without
// this, a message caught mid-flight by a redeploy sat in "running" forever
// and cluttered the Project Manager's queue view indefinitely — exactly
// what Harvey saw and flagged.
function recoverInflightVoiceMessages() {
  const rows = stmts.getInflightVoiceMessages.all();
  if (!rows.length) return;
  const now = new Date().toISOString();
  let requeued = 0;
  let errored = 0;
  rows.forEach(function (row) {
    if (row.status === 'pending') {
      voiceQueue.push({ id: row.id, mode: row.mode, text: row.transcript, imageBlock: null });
      requeued++;
    } else {
      stmts.finishVoiceMessage.run('error', null,
        'Service restarted while this was in progress (redeploy or crash) — completion status unknown, please resend if it still needs doing.',
        now, row.id);
      errored++;
    }
  });
  console.log('voice queue recovery: requeued ' + requeued + ', errored ' + errored);
  fs.appendFile(WORK_LOG_PATH,
    '- [' + now + '] SERVICE RESTARTED — recovered voice queue: ' + requeued + ' pending message(s) requeued, ' +
    errored + ' interrupted message(s) marked as error.\n',
    function () {});
  if (requeued) drainVoiceQueue();
}

app.listen(PORT, function () {
  console.log('rm-ops-service listening on ' + PORT);
  recoverInflightVoiceMessages();
});
