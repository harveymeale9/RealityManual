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
const { Readable } = require('stream');
const Database = require('better-sqlite3');
const claudeRunner = require('./src/claudeRunner');
const codexRunner = require('./src/codexRunner');
const elevenlabs = require('./src/elevenlabs');
const ttsRouter = require('./src/ttsRouter');
const speechText = require('./src/speechText');
const videoAnalysis = require('./src/videoAnalysis');
const youtubeAuth = require('./src/youtubeAuth');
const tiktokAuth = require('./src/tiktokAuth');
const ideationService = require('./src/ideationService');
const manuscriptService = require('./src/manuscriptService');
const mailboxService = require('./src/mailboxService');
const namecheapMailbox = require('./src/namecheapMailbox');
const agentUsage = require('./src/agentUsage');
const recordConcurrency = require('./src/recordConcurrency');

const DATA_DIR = process.env.DATA_DIR || '/data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const WORK_LOG_PATH = path.join(DATA_DIR, 'work-log.md');
// Despite the name, this is the shared host-side data dir both Codex's and
// Claude's host-side runners resolve attached-image paths against (both
// read from the same bind-mounted DATA_DIR, just from outside the
// container) — kept as CODEX_HOST_DATA_DIR to avoid an unrelated env-var
// rename on the live host.
const CODEX_HOST_DATA_DIR = process.env.CODEX_HOST_DATA_DIR || '/root/ops-service-data';
const PORT = process.env.PORT || 4001;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'ormiston';
// A second, much more narrowly-scoped password — for Google's YouTube API
// Compliance Audit reviewers, who (per Google's own requirement) need a
// demo account with genuine hands-on access to the actual product, not
// just a demo video. Logs into the *same* main control panel
// (ops.realitymanual.com), but the session this password grants is
// structurally separate from a real admin session (its own table/cookie,
// see reviewer_sessions/rm_reviewer_session below) and is restricted,
// route by route and field by field, to exactly the Content Ops surface
// relevant to producing and publishing a YouTube video: Content Pipeline
// (read-only for anything they didn't create themselves), Content
// Production, and Content Settings (YouTube fields only — TikTok/
// Instagram/Facebook/transcription fields are disabled client-side and
// redacted/write-blocked server-side). Never reaches Project Manager (a
// real agent with host SSH access) or TikTok. See requireAuthOrReviewer
// and every `req.sessionRole === 'youtube-reviewer'` check below.
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD || '';
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
  // Deliberately a completely separate table from sessions above — a
  // reviewer token must never be checkable against, or confusable with, a
  // real admin session token, even though (unlike the first version of
  // this table) it now grants access to real product surface, not just a
  // handful of YouTube-connect routes. See REVIEWER_PASSWORD/
  // requireAuthOrReviewer.
  'CREATE TABLE IF NOT EXISTS reviewer_sessions (' +
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
  'CREATE TABLE IF NOT EXISTS voice_preferences (' +
  '  id INTEGER PRIMARY KEY CHECK (id = 1),' +
  "  selected_agent TEXT NOT NULL DEFAULT 'claude'," +
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
// Existing history predates the agent selector and therefore belongs to
// Claude. New rows record their destination so both UIs can label/color the
// response correctly and restart recovery can dispatch it to the same agent.
try { db.exec("ALTER TABLE voice_messages ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude'"); } catch (e) { /* already exists */ }
// Claude and Codex maintain independent resumable conversations. Keeping
// both ids in the one existing single-row session record lets "New
// conversation" reset both without affecting the persistent agent choice.
try { db.exec('ALTER TABLE voice_session ADD COLUMN codex_session_id TEXT'); } catch (e) { /* already exists */ }

const stmts = {
  getAll: db.prepare('SELECT data, updated_at FROM records WHERE store_name = ? ORDER BY updated_at ASC'),
  getOne: db.prepare('SELECT data, updated_at FROM records WHERE store_name = ? AND id = ?'),
  upsert: db.prepare(
    'INSERT INTO records (store_name, id, data, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(store_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  ),
  del: db.prepare('DELETE FROM records WHERE store_name = ? AND id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)'),
  getSession: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  insertReviewerSession: db.prepare('INSERT INTO reviewer_sessions (token, created_at, expires_at) VALUES (?, ?, ?)'),
  getReviewerSession: db.prepare('SELECT * FROM reviewer_sessions WHERE token = ?'),
  delReviewerSession: db.prepare('DELETE FROM reviewer_sessions WHERE token = ?'),
  purgeReviewerSessions: db.prepare('DELETE FROM reviewer_sessions WHERE expires_at < ?'),
  insertVoiceMessage: db.prepare('INSERT INTO voice_messages (id, mode, transcript, status, created_at, reply_to_id, agent) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  setVoiceMessageStatus: db.prepare('UPDATE voice_messages SET status = ? WHERE id = ?'),
  setVoiceActivityLog: db.prepare('UPDATE voice_messages SET activity_log = ? WHERE id = ?'),
  setVoiceEarlyAck: db.prepare('UPDATE voice_messages SET early_ack = ? WHERE id = ?'),
  finishVoiceMessage: db.prepare('UPDATE voice_messages SET status = ?, reply_text = ?, error_message = ?, completed_at = ? WHERE id = ?'),
  getVoiceMessage: db.prepare('SELECT * FROM voice_messages WHERE id = ?'),
  listVoiceMessages: db.prepare('SELECT * FROM voice_messages ORDER BY created_at DESC LIMIT ?'),
  getInflightVoiceMessages: db.prepare("SELECT * FROM voice_messages WHERE status IN ('pending','running') ORDER BY created_at ASC"),
  getVoiceSession: db.prepare('SELECT claude_session_id, codex_session_id FROM voice_session WHERE id = 1'),
  upsertVoiceSession: db.prepare(
    'INSERT INTO voice_session (id, claude_session_id, updated_at) VALUES (1, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET claude_session_id = excluded.claude_session_id, updated_at = excluded.updated_at'
  ),
  upsertCodexSession: db.prepare(
    'INSERT INTO voice_session (id, codex_session_id, updated_at) VALUES (1, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET codex_session_id = excluded.codex_session_id, updated_at = excluded.updated_at'
  ),
  clearVoiceSession: db.prepare('DELETE FROM voice_session WHERE id = 1'),
  getVoicePreference: db.prepare('SELECT selected_agent FROM voice_preferences WHERE id = 1'),
  upsertVoicePreference: db.prepare(
    'INSERT INTO voice_preferences (id, selected_agent, updated_at) VALUES (1, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET selected_agent = excluded.selected_agent, updated_at = excluded.updated_at'
  ),
  getLastAgentMessageBefore: db.prepare(
    "SELECT created_at FROM voice_messages WHERE agent = ? AND id != ? AND status IN ('done','error') AND created_at < ? ORDER BY created_at DESC LIMIT 1"
  ),
  listOtherAgentMessagesSince: db.prepare(
    "SELECT agent, transcript, reply_text, created_at FROM voice_messages WHERE agent != ? AND status = 'done' AND created_at > ? AND created_at < ? ORDER BY created_at ASC LIMIT 12"
  ),
  listRecentOtherAgentMessages: db.prepare(
    "SELECT agent, transcript, reply_text, created_at FROM voice_messages WHERE agent != ? AND status = 'done' AND created_at < ? ORDER BY created_at DESC LIMIT 12"
  ),
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

setInterval(function () {
  stmts.purgeSessions.run(new Date().toISOString());
  stmts.purgeReviewerSessions.run(new Date().toISOString());
}, 60 * 60 * 1000);

// --- App setup ---
const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
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

// A single login endpoint handling both credentials — the reviewer logs
// into the exact same ops.realitymanual.com the admin does, not a separate
// page, so which session type they get is decided purely by which
// password matched. Whichever branch matches wins outright rather than
// falling through, so the two passwords can never both apply to the same
// login attempt.
app.post('/api/login', function (req, res) {
  const ip = req.ip || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  const password = req.body && req.body.password;
  if (typeof password !== 'string') return res.status(401).json({ ok: false });
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  if (password === PANEL_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    stmts.insertSession.run(token, now.toISOString(), expires.toISOString());
    res.cookie('rm_session', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS });
    return res.json({ ok: true, role: 'admin' });
  }
  if (REVIEWER_PASSWORD && password === REVIEWER_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    stmts.insertReviewerSession.run(token, now.toISOString(), expires.toISOString());
    res.cookie('rm_reviewer_session', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS });
    return res.json({ ok: true, role: 'youtube-reviewer' });
  }
  res.status(401).json({ ok: false });
});

// Clears whichever session cookie(s) are actually present — a browser
// only ever holds one in practice, but clearing both is harmless and
// avoids needing the client to know which kind of session it has.
app.post('/api/logout', function (req, res) {
  const token = req.cookies && req.cookies.rm_session;
  if (token) stmts.delSession.run(token);
  res.clearCookie('rm_session', { path: '/' });
  const reviewerToken = req.cookies && req.cookies.rm_reviewer_session;
  if (reviewerToken) stmts.delReviewerSession.run(reviewerToken);
  res.clearCookie('rm_reviewer_session', { path: '/' });
  res.json({ ok: true });
});

function hasValidSession(req) {
  const token = req.cookies && req.cookies.rm_session;
  if (!token) return false;
  const session = stmts.getSession.get(token);
  return !!(session && new Date(session.expires_at).getTime() >= Date.now());
}
function hasValidReviewerSession(req) {
  const token = req.cookies && req.cookies.rm_reviewer_session;
  if (!token) return false;
  const session = stmts.getReviewerSession.get(token);
  return !!(session && new Date(session.expires_at).getTime() >= Date.now());
}
function getSessionRole(req) {
  if (hasValidSession(req)) return 'admin';
  if (hasValidReviewerSession(req)) return 'youtube-reviewer';
  return null;
}

function requireAuth(req, res, next) {
  if (!hasValidSession(req)) return res.status(401).json({ error: 'unauthorized' });
  req.sessionRole = 'admin';
  next();
}

// Accepts EITHER a real admin session OR a reviewer session, and attaches
// req.sessionRole so downstream route handlers can tell which — used on
// every route a reviewer might legitimately reach (Content Ops/Production/
// Settings data, the uploader pipeline, YouTube connect+publish). Routes
// that never check req.sessionRole and just call next() are implicitly
// admin-only in effect for anything reviewer-sensitive, but the real
// enforcement for pieces/settings/videos ownership happens inside each
// handler below, not just at this gate — a reviewer session reaching a
// route is necessary, not sufficient, for it to be allowed to act.
function requireAuthOrReviewer(req, res, next) {
  const role = getSessionRole(req);
  if (!role) return res.status(401).json({ error: 'unauthorized' });
  req.sessionRole = role;
  next();
}

app.get('/api/me', function (req, res) {
  const role = getSessionRole(req);
  if (!role) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, role: role });
});
app.get('/api/health', function (req, res) { res.json({ ok: true }); });
app.get('/robots.txt', function (req, res) { res.type('text/plain').send('User-agent: *\nDisallow: /\n'); });

// /api/store and /api/files now admit a reviewer session too — the fine-
// grained ownership/field checks are inside each route handler below, not
// just this gate. /api/voice (Project Manager) and /api/tiktok stay
// requireAuth-only, full stop — a reviewer session can never reach either,
// regardless of anything else.
app.use('/api/store', requireAuthOrReviewer);
app.use('/api/files', requireAuthOrReviewer);
app.use('/api/voice', requireAuth);
app.use('/api/tiktok', requireAuth);
// Content Ideation is an admin-only authoring/agent surface. It has its
// own normalized tables but transfers accepted work into the existing
// pieces record/Kanban model.
const ideation = ideationService.setup(db);
app.use('/api/ideation', requireAuth, ideation.router);
// Desktop manuscript reader: page text plus restart-safe, AI-ranked
// semantic search. Admin-only because it exposes the complete book text.
const manuscript = manuscriptService.setup(db);
app.use('/api/manuscript', requireAuth, manuscript.router);
// Admin-only mailbox shell. Its durable local store/UI are usable before a
// mail provider is chosen; the transport itself is deliberately injected
// later so mailbox credentials never enter the browser or repository.
const mailboxTransport = namecheapMailbox.fromEnv(process.env);
const mailbox = mailboxService.setup(db, {
  dataDir: DATA_DIR,
  address: process.env.MAILBOX_ADDRESS || 'info@realitymanual.com',
  transport: mailboxTransport
});
app.use('/api/mailbox', requireAuth, mailbox.router);

// --- YouTube OAuth (Google) — see src/youtubeAuth.js for the token
// exchange itself. Placeholder-until-configured: YOUTUBE_OAUTH_CLIENT_ID/
// SECRET/REDIRECT_URI aren't set yet as of 2026-09-20 (Harvey supplying
// them shortly), so /oauth/start correctly 500s with a clear message
// until then rather than crashing — the "Connect YouTube" button in
// Settings can exist and be clicked before the real credentials land.
app.get('/api/youtube/status', requireAuthOrReviewer, function (req, res) {
  const row = stmts.getYoutubeAuth.get();
  res.json({
    configured: youtubeAuth.isConfigured(),
    connected: !!(row && row.refresh_token),
    channelTitle: row ? row.channel_title : null
  });
});

app.get('/api/youtube/oauth/start', requireAuthOrReviewer, function (req, res) {
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

// Both an admin and a reviewer session land back on the same main panel
// (#settings) once this finishes — there's no separate reviewer page to
// route back to anymore (see CLAUDE.md on why reviewer.html was retired).
app.get('/api/youtube/oauth/callback', requireAuthOrReviewer, function (req, res) {
  if (!youtubeAuth.isConfigured()) {
    return res.status(500).send('YouTube OAuth is not configured yet.');
  }
  const expectedState = req.cookies && req.cookies.yt_oauth_state;
  const returnTo = '/#settings';
  res.clearCookie('yt_oauth_state', { path: '/' });
  if (req.query.error) {
    return res.redirect(returnTo);
  }
  if (!req.query.state || req.query.state !== expectedState) {
    return res.status(400).send('OAuth state did not match — please try connecting YouTube again.');
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
    .then(function () { res.redirect(returnTo); })
    .catch(function (err) {
      console.error('YouTube OAuth callback failed:', err.message);
      res.status(500).send('YouTube connection failed: ' + err.message);
    });
});

app.post('/api/youtube/disconnect', requireAuthOrReviewer, function (req, res) {
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

// --- Reviewer access control for /api/store and /api/files. A reviewer
// session (see requireAuthOrReviewer/req.sessionRole) can read broadly —
// nothing in `pieces`/`videos`/`audioTracks` is secret — but writes are
// restricted piece-by-piece to whatever it created itself, `errors` is
// off-limits entirely (internal error detail, not relevant to a YouTube
// demo), `audioTracks` writes are admin-only (ambient library management,
// not something a reviewer needs to do — they can still pick from
// existing tracks), and `settings` writes are merged through an allowlist
// so a raw API call can never touch another platform's real caption text
// or API keys even though the UI already disables those fields for
// exactly this reason.
const REVIEWER_FORBIDDEN_STORES = ['errors'];
// Only these exact dotted paths inside the shared `settings` record can be
// changed by a reviewer session's PUT — everything else in the request
// body is silently ignored (the existing value is kept), not merged in.
const REVIEWER_SETTINGS_WRITE_PATHS = [
  ['captions', 'shortform', 'ytshort'],
  ['captions', 'longform', 'ytlong']
];
function redactSettingsForReviewer(settings) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (out.apiKeys && typeof out.apiKeys === 'object') {
    Object.keys(out.apiKeys).forEach(function (k) { out.apiKeys[k] = ''; });
  }
  return out;
}
function mergeReviewerSettingsWrite(existing, incoming) {
  const merged = JSON.parse(JSON.stringify(existing || {}));
  REVIEWER_SETTINGS_WRITE_PATHS.forEach(function (segPath) {
    let src = incoming;
    for (let i = 0; i < segPath.length && src && typeof src === 'object'; i++) src = src[segPath[i]];
    if (typeof src !== 'string') return;
    let dst = merged;
    for (let i = 0; i < segPath.length - 1; i++) {
      if (!dst[segPath[i]] || typeof dst[segPath[i]] !== 'object') dst[segPath[i]] = {};
      dst = dst[segPath[i]];
    }
    dst[segPath[segPath.length - 1]] = src;
  });
  return merged;
}
// videos/audioTracks records are keyed by the same id as their owning
// piece (final-build files use "<pieceId>-final") — this resolves either
// back to the piece id so ownership can be checked against it.
function ownerPieceIdFor(storeName, id) {
  return storeName === 'videos' ? id.replace(/-final$/, '') : id;
}
function pieceOwnedByReviewer(pieceId) {
  const row = stmts.getOne.get('pieces', pieceId);
  if (!row) return true; // doesn't exist yet — nothing to protect, creation is allowed
  const piece = JSON.parse(row.data);
  return piece.createdBy === 'youtube-reviewer';
}

app.get('/api/store/:storeName', function (req, res) {
  if (!isValidStore(req.params.storeName)) return res.status(400).json({ error: 'invalid_store' });
  if (req.sessionRole === 'youtube-reviewer' && REVIEWER_FORBIDDEN_STORES.indexOf(req.params.storeName) !== -1) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const rows = stmts.getAll.all(req.params.storeName);
  let records = rows.map(function (r) { return req.params.storeName === 'pieces' ? recordConcurrency.decodeRow(r) : JSON.parse(r.data); });
  if (req.sessionRole === 'youtube-reviewer' && req.params.storeName === 'settings') {
    records = records.map(redactSettingsForReviewer);
  }
  res.json(records);
});

app.get('/api/store/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (!isValidStore(storeName) || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  if (req.sessionRole === 'youtube-reviewer' && REVIEWER_FORBIDDEN_STORES.indexOf(storeName) !== -1) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const row = stmts.getOne.get(storeName, id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  let record = storeName === 'pieces' ? recordConcurrency.decodeRow(row) : JSON.parse(row.data);
  if (req.sessionRole === 'youtube-reviewer' && storeName === 'settings') record = redactSettingsForReviewer(record);
  res.json(record);
});

// Real bug, confirmed against a live stuck piece (2026-09-20): this route
// has always been a full-record replace, and the client's own pieces
// object is a single shared in-memory value it mutates and PUTs whole any
// time *anything* about that piece changes (an audio-track pick, a
// platform checkbox, a title edit) — not just when something analysis-
// related changes. `maybeStartAnalysisPolling()`'s 3-second interval
// (client, app.js) is what's supposed to keep that local copy in sync
// with these server-computed fields, but there's a real window — from the
// moment a video is uploaded until that poller's first tick — where the
// client's copy is stale. An edit inside that window (an audio pick, a
// platform toggle) PUTs the piece with the old analysisStatus still
// attached, silently reverting whatever runVideoAnalysis had already
// written — which is exactly what left a real piece stuck showing
// analysisStatus: 'pending' forever despite its analysis having actually
// run. These fields are never legitimately set by a plain client edit
// once a piece already exists (only by runVideoAnalysis itself, or by the
// client at creation time, when there's nothing yet to clobber), so on
// any update to an existing video piece the current DB value always wins.
// Deliberately NOT including finalBuildStatus/finalBuildError here even
// though they're also server-written — the client legitimately sets
// finalBuildStatus: 'pending' itself on every "Send to final check"
// click, including a retry after a failure, and protecting it would
// silently break that reset.
const SERVER_OWNED_PIECE_FIELDS = [
  'analysisStatus', 'analysisError', 'analysisMatchedPieceId', 'stage'
];
app.put('/api/store/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (!isValidStore(storeName) || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'invalid_body' });

  let existingPiece = null;
  let existingPieceRow = null;
  if (storeName === 'pieces') {
    const existingRow = stmts.getOne.get('pieces', id);
    existingPieceRow = existingRow || null;
    if (existingRow) {
      const existing = JSON.parse(existingRow.data);
      existingPiece = existing;
      const versionCheck = recordConcurrency.preparePieceWrite(existingRow, req.body, id);
      if (versionCheck.conflict) {
        return res.status(409).json({
          error: 'stale_write',
          message: 'This card changed on another device. Your stale change was not saved, and the newest version was kept.',
          latest: versionCheck.latest
        });
      }
      if (existing.hasVideo) {
        SERVER_OWNED_PIECE_FIELDS.forEach(function (f) {
          if (Object.prototype.hasOwnProperty.call(existing, f)) req.body[f] = existing[f];
          else delete req.body[f];
        });
      }
    }
    // A browser tab opened before §185 still constructs new planning cards
    // with the retired implicit `short` default. Do not let that stale client
    // recreate the value after the migration. The current UI marks a genuine
    // user choice explicitly, so deliberately selecting Short is preserved.
    const earlyPlanningStage = ['archived', 'ideation', 'big_ideas'].indexOf(req.body.stage) !== -1;
    const existingWasUnselected = existingPiece && !existingPiece.contentType;
    if (!req.body.hasVideo && earlyPlanningStage && req.body.contentType === 'short' &&
        req.body.contentTypeSelectionExplicit !== true && (!existingPiece || existingWasUnselected)) {
      req.body.contentType = '';
      req.body.contentTypeSelectionExplicit = false;
    }
  }

  if (req.sessionRole === 'youtube-reviewer') {
    if (REVIEWER_FORBIDDEN_STORES.indexOf(storeName) !== -1 || storeName === 'audioTracks') {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (storeName === 'settings') {
      const existingRow = stmts.getOne.get(storeName, id);
      const existing = existingRow ? JSON.parse(existingRow.data) : {};
      const merged = mergeReviewerSettingsWrite(existing, req.body);
      merged.id = id;
      stmts.upsert.run(storeName, id, JSON.stringify(merged), new Date().toISOString());
      return res.json(redactSettingsForReviewer(merged));
    }
    if (storeName === 'pieces' || storeName === 'videos') {
      if (!pieceOwnedByReviewer(ownerPieceIdFor(storeName, id))) return res.status(403).json({ error: 'forbidden' });
      // Force this regardless of what the client sent — a reviewer
      // session can never claim/relabel an existing record as its own,
      // or hand its own creation off to look admin-authored.
      if (storeName === 'pieces') req.body.createdBy = 'youtube-reviewer';
    }
  }

  const record = storeName === 'pieces'
    ? recordConcurrency.preparePieceWrite(existingPieceRow, req.body, id).record
    : Object.assign({}, req.body, { id: id });
  stmts.upsert.run(storeName, id, JSON.stringify(record), new Date().toISOString());
  if (storeName === 'pieces' && req.sessionRole !== 'youtube-reviewer' && record.stage === 'big_ideas') {
    try {
      ideation.recordBigIdeaPiece(record, existingPiece ? existingPiece.stage : null);
    } catch (error) {
      console.error('[ideation] failed to record Big Ideas curation signal for piece', id, error.message);
    }
  }
  res.json(record);
});

app.delete('/api/store/:storeName/:id', function (req, res) {
  const { storeName, id } = req.params;
  if (!isValidStore(storeName) || !isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  if (req.sessionRole === 'youtube-reviewer') {
    if (REVIEWER_FORBIDDEN_STORES.indexOf(storeName) !== -1 || storeName === 'settings' || storeName === 'audioTracks') {
      return res.status(403).json({ error: 'forbidden' });
    }
    if ((storeName === 'pieces' || storeName === 'videos') && !pieceOwnedByReviewer(ownerPieceIdFor(storeName, id))) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  if (storeName === 'pieces') {
    const existingRow = stmts.getOne.get(storeName, id);
    if (existingRow) {
      const current = recordConcurrency.decodeRow(existingRow);
      if (!recordConcurrency.matchesPieceVersion(existingRow, req.get('x-record-version'))) {
        return res.status(409).json({
          error: 'stale_write',
          message: 'This card changed on another device. The newer version was kept instead of deleting it.',
          latest: current
        });
      }
    }
  }
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
  if (req.sessionRole === 'youtube-reviewer') {
    if (storeName === 'audioTracks' || !pieceOwnedByReviewer(ownerPieceIdFor(storeName, id))) {
      if (req.file) fs.rm(req.file.path, { force: true }, function () {});
      return res.status(403).json({ error: 'forbidden' });
    }
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
  return row ? recordConcurrency.decodeRow(row) : null;
}
function savePieceRecord(piece) {
  recordConcurrency.stampServerWrite(piece);
  stmts.upsert.run('pieces', piece.id, JSON.stringify(piece), new Date().toISOString());
}

// Analysis (runVideoAnalysis, triggered right after upload) and the final
// audio-splice build (runBuildFinalVideo, triggered by "Send to final
// check") are two independent background jobs on the same piece, started
// at different times, with no coordination between them. Before this,
// runBuildFinalVideo alone decided when a piece reached Final Check — so
// if Harvey clicked "Send to final check" before analysis had finished
// (routine, since analysis/transcription genuinely takes real seconds and
// he often moves faster than that), the piece became fully interactive
// (playable video, real UI) in Final Check while analysis kept running
// underneath it. The client's poller (maybeStartAnalysisPolling) has no
// way to know a piece is "done enough to touch" vs. "still has a job
// running" — it just re-renders the whole board every 3s for as long as
// *either* job is pending, tearing down and rebuilding the <video> element
// each time. That's what Harvey saw as the thumbnail/video repeatedly
// vanishing and reappearing while he tried to interact with it — not a
// stuck job this time (§146), a genuinely still-processing one that
// simply hadn't been gated from view.
//
// Fix: a piece only ever reaches Final Check once *both* jobs have
// settled — finalBuildStatus is 'done' AND analysisStatus is no longer
// 'pending'/'running' (i.e. 'done' or 'error' — analysis failing doesn't
// block Final Check, only analysis still being *in progress* does).
// Called from the completion of both jobs, in both their success and
// error paths, so whichever job finishes second is the one that actually
// flips the stage — the common case (analysis already resolved by the
// time Harvey finishes editing and clicks send) behaves exactly as
// before, zero added delay.
function maybeAdvanceToFinalCheck(id) {
  const piece = getPieceRecord(id);
  if (!piece) return;
  if (piece.stage !== 'processed') return; // already moved on, or never got this far
  if (piece.finalBuildStatus !== 'done') return;
  if (piece.analysisStatus === 'pending' || piece.analysisStatus === 'running') return;
  piece.stage = 'final_check';
  piece.updatedAt = new Date().toISOString();
  savePieceRecord(piece);
}

// A hung analysis job (transcription or the Claude Code matching call
// never resolving — confirmed happening for real, not hypothetical, see
// CLAUDE.md §146/§149) would otherwise block a piece from ever reaching
// Final Check under the new gating above, even though the actual video
// build succeeded. 90s is comfortably longer than any real transcription/
// matching call observed so far, short enough that a genuine hang doesn't
// leave Harvey wondering why a piece won't advance.
const ANALYSIS_TIMEOUT_MS = 90 * 1000;
function withAnalysisTimeout(promise) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('analysis timed out after ' + (ANALYSIS_TIMEOUT_MS / 1000) + 's')); }, ANALYSIS_TIMEOUT_MS);
    })
  ]);
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
    transcript = await withAnalysisTimeout(videoAnalysis.transcribeVideo(videoPath, tmpDir));
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
    const result = await withAnalysisTimeout(videoAnalysis.matchAndGenerateTitles(transcript, candidates));

    const latest = getPieceRecord(id);
    if (!latest) return; // deleted while this was running
    latest.transcript = transcript;
    latest.analysisStatus = 'done';
    latest.analysisMatchedPieceId = result.matchedPieceId || '';
    if (result.titleOptions.length) latest.ytTitles = result.titleOptions;
    if (result.workingTitle) latest.title = result.workingTitle;
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
    maybeAdvanceToFinalCheck(id);
  } catch (e) {
    console.error('video title/outline matching failed for ' + id + ':', e.message);
    const latest = getPieceRecord(id);
    if (!latest) return;
    latest.transcript = transcript;
    latest.analysisStatus = 'error';
    latest.analysisError = String(e.message || e).slice(0, 500);
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
    maybeAdvanceToFinalCheck(id);
  }
}

// requireAuthOrReviewer added here (this route previously had no auth
// guard at all, relying on nothing — a real pre-existing gap, closed
// while touching this route for the reviewer-access work rather than a
// deliberate design choice worth keeping).
app.post('/api/videos/:id/analyze', requireAuthOrReviewer, function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const filePath = path.join(UPLOADS_DIR, 'videos', id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'video_not_found' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  if (req.sessionRole === 'youtube-reviewer' && piece.createdBy !== 'youtube-reviewer') {
    return res.status(403).json({ error: 'forbidden' });
  }
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
    // Stage only actually advances once analysis has also settled — see
    // maybeAdvanceToFinalCheck's own comment. In the common case (analysis
    // already finished by the time this build completes) this behaves
    // exactly like the old unconditional `latest.stage = 'final_check'`
    // did; it only actually holds back the transition when analysis is
    // still genuinely in progress.
    latest.updatedAt = new Date().toISOString();
    savePieceRecord(latest);
    maybeAdvanceToFinalCheck(id);
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

// Same pre-existing missing-auth gap closed as /api/videos/:id/analyze
// above.
app.post('/api/videos/:id/build-final', requireAuthOrReviewer, function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const filePath = path.join(UPLOADS_DIR, 'videos', id);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'video_not_found' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  if (req.sessionRole === 'youtube-reviewer' && piece.createdBy !== 'youtube-reviewer') {
    return res.status(403).json({ error: 'forbidden' });
  }
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

// Google's own review requirement for a YouTube API Compliance Audit is
// that the demo account can genuinely publish, not just watch a video of
// someone else doing it — so a reviewer session IS allowed to hit this
// route now, but only for a piece it created itself (checked below,
// exactly the same ownership rule as writing to /api/store/pieces/:id).
// A reviewer can never publish anything Harvey made.
app.post('/api/youtube/publish/:id', requireAuthOrReviewer, function (req, res) {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid_params' });
  const piece = getPieceRecord(id);
  if (!piece) return res.status(404).json({ error: 'piece_not_found' });
  if (req.sessionRole === 'youtube-reviewer' && piece.createdBy !== 'youtube-reviewer') {
    return res.status(403).json({ error: 'forbidden' });
  }
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
      title: opts.title || piece.title || 'Untitled',
      brandedContent: !!opts.brandedContent
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
  const opts = {
    title: typeof body.title === 'string' ? body.title : '',
    brandedContent: !!body.brandedContent
  };
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

const CODEX_VISIBILITY_REMINDER = '\n\n[Project Manager visibility: for a genuine multi-step task, use your ' +
  'normal task tracker and send concise user-facing progress updates when you begin a major phase, ' +
  'when the plan changes, or when a long-running phase completes. These updates are shown in the ' +
  'Activity panel and beneath the active Task List item. Do not expose private chain-of-thought or ' +
  'turn a simple question into a manufactured plan. Tool and command events are surfaced automatically.]';

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

function normalizeVoiceAgent(value) {
  return value === 'codex' ? 'codex' : 'claude';
}

// Both agents keep their own native resumable thread, but the browser shows
// one shared Project Manager conversation. When Harvey switches agents,
// bridge any completed exchanges handled by the other agent since this one
// last spoke so the newly-selected agent is not blind to the visible thread.
function buildCrossAgentContext(agent, id, createdAt) {
  const lastOwn = stmts.getLastAgentMessageBefore.get(agent, id, createdAt);
  let rows;
  if (lastOwn) {
    rows = stmts.listOtherAgentMessagesSince.all(agent, lastOwn.created_at, createdAt);
  } else {
    rows = stmts.listRecentOtherAgentMessages.all(agent, createdAt).reverse();
  }
  if (!rows.length) return '';
  const lines = rows.map(function (row) {
    const name = normalizeVoiceAgent(row.agent) === 'codex' ? 'Codex' : 'Claude';
    return 'Harvey: ' + String(row.transcript || '').slice(0, 1200) + '\n' +
      name + ': ' + String(row.reply_text || '').slice(0, 2400);
  });
  return '[Shared Project Manager thread context from the other agent since you last handled a message. Use it as conversation context; do not repeat it unless needed.]\n' +
    lines.join('\n\n') + '\n[End shared context]\n\n';
}

let voiceQueue = [];
let voiceProcessing = false;

function drainVoiceQueue() {
  if (voiceProcessing) return;
  const next = voiceQueue.shift();
  if (!next) return;
  voiceProcessing = true;
  const work = next.recoverAgent
    ? recoverAgentVoiceMessage(next.id, next.recoverAgent)
    : processVoiceMessage(next.id, next.mode, next.text, next.agent, next.imagePath);
  work
    .catch(function (err) {
      stmts.finishVoiceMessage.run('error', null, String((err && err.message) || err).slice(0, 2000), new Date().toISOString(), next.id);
    })
    .finally(function () {
      if (next.uploadPath) fs.rm(next.uploadPath, { force: true }, function () {});
      voiceProcessing = false;
      drainVoiceQueue();
    });
}

// Shared by both agents: each has its own host-side durable journal
// (codexRunner.recoverCodexRun / claudeRunner.recoverClaudeRun) that this
// reconnects to after a service restart, in place of the old blind
// "completion status unknown" bounce.
async function recoverAgentVoiceMessage(id, agent) {
  const row = stmts.getVoiceMessage.get(id);
  if (!row) return;
  let activity;
  try { activity = row.activity_log ? JSON.parse(row.activity_log) : []; } catch (e) { activity = []; }
  function onActivity(line) {
    activity.push(line);
    stmts.setVoiceActivityLog.run(JSON.stringify(activity.slice(-200)), id);
  }
  function onEarlyAck(text) {
    if (!row.early_ack && text) stmts.setVoiceEarlyAck.run(text.slice(0, 2000), id);
  }

  const result = agent === 'codex'
    ? await codexRunner.recoverCodexRun({ runKey: id, onActivity: onActivity, onEarlyAck: onEarlyAck })
    : await claudeRunner.recoverClaudeRun({ runKey: id, onActivity: onActivity, onEarlyAck: onEarlyAck });
  const now = new Date().toISOString();
  if (!result) {
    stmts.finishVoiceMessage.run('error', null,
      'The service restarted and could not reconnect to this ' + (agent === 'codex' ? 'Codex' : 'Claude') +
      ' task. Please resend it if it still needs doing.', now, id);
    return;
  }
  if (result.sessionId) {
    if (agent === 'codex') stmts.upsertCodexSession.run(result.sessionId, now);
    else stmts.upsertVoiceSession.run(result.sessionId, now);
  }
  if (result.ok) {
    stmts.finishVoiceMessage.run('done', (result.replyText || '').slice(0, 8000), null, now, id);
    agentUsage.invalidate();
  } else {
    stmts.finishVoiceMessage.run('error', null, String(result.error || 'unknown error').slice(0, 2000), now, id);
  }
  if (agent === 'codex') codexRunner.cleanupRun(id); else claudeRunner.cleanupRun(id);
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

async function processVoiceMessage(id, mode, text, agent, imagePath) {
  stmts.setVoiceMessageStatus.run('running', id);
  agent = normalizeVoiceAgent(agent);
  const messageRow = stmts.getVoiceMessage.get(id);
  const sessionRow = stmts.getVoiceSession.get();
  const sessionId = sessionRow && (agent === 'codex' ? sessionRow.codex_session_id : sessionRow.claude_session_id);
  const sharedContext = buildCrossAgentContext(agent, id, messageRow ? messageRow.created_at : new Date().toISOString());
  const prompt = buildVoicePrompt(mode, sharedContext + text) + (agent === 'codex' ? CODEX_VISIBILITY_REMINDER : '');

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

  const runSelectedAgent = function (resumeId) {
    if (agent === 'codex') {
      return codexRunner.runCodex({
        prompt: prompt,
        sessionId: resumeId,
        ownerKey: 'project-manager',
        runKey: id,
        onActivity: onActivity,
        onEarlyAck: onEarlyAck,
        imagePath: imagePath
      });
    }
    return claudeRunner.runClaude({
      prompt: prompt,
      sessionId: resumeId,
      ownerKey: 'project-manager',
      runKey: id,
      appendSystemPrompt: buildSystemPromptForSession(resumeId),
      onActivity: onActivity,
      onEarlyAck: onEarlyAck,
      imagePath: imagePath
    });
  };

  let result = await runSelectedAgent(sessionId);
  // The resumed session id can go stale (e.g. the CLI's local session store
  // living outside the persisted volume, wiped by a container rebuild) —
  // rather than leave every future message stuck repeating the same
  // failure forever, drop the dead session and retry once as a fresh one.
  const missingSession = agent === 'codex'
    ? /thread|session|rollout/i.test(result.error || '') && /not found|no .*found|unknown|missing/i.test(result.error || '')
    : /no conversation found/i.test(result.error || '');
  const writerConflict = agent === 'codex' && /active writer|thread-store conflict/i.test(result.error || '');
  if (!result.ok && sessionId && (missingSession || writerConflict)) {
    console.error('voice ' + agent + ' session ' + sessionId + ' cannot be resumed, starting fresh:', result.error);
    if (agent === 'codex') stmts.upsertCodexSession.run(null, new Date().toISOString());
    else {
      stmts.upsertVoiceSession.run(null, new Date().toISOString());
      claudeRunner.resetSession();
    }
    activity.push(writerConflict
      ? '— previous Codex writer was still attached; isolated it and started a clean session —'
      : '— previous session was lost, starting a new one —');
    result = await runSelectedAgent(null);
  }
  const now = new Date().toISOString();
  if (result.sessionId) {
    if (agent === 'codex') stmts.upsertCodexSession.run(result.sessionId, now);
    else stmts.upsertVoiceSession.run(result.sessionId, now);
  }
  if (!result.ok) {
    stmts.finishVoiceMessage.run('error', null, String(result.error || 'unknown error').slice(0, 2000), now, id);
    if (agent === 'codex') codexRunner.cleanupRun(id); else claudeRunner.cleanupRun(id);
    console.error('voice ' + agent + ' run failed:', result.error);
    return;
  }
  stmts.finishVoiceMessage.run('done', (result.replyText || '').slice(0, 8000), null, now, id);
  if (agent === 'codex') codexRunner.cleanupRun(id); else claudeRunner.cleanupRun(id);
  // The next dashboard open/poll should reflect the turn that just consumed
  // allowance. Invalidating is enough; it avoids running usage subprocesses
  // when nobody has the dashboard open.
  agentUsage.invalidate();
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
  const preference = stmts.getVoicePreference.get();
  const agent = normalizeVoiceAgent((req.body && req.body.agent) || (preference && preference.selected_agent));
  function cleanupUpload() { if (req.file) fs.rm(req.file.path, { force: true }, function () {}); }
  if (!trimmed && !req.file) { cleanupUpload(); return res.status(400).json({ error: 'invalid_text' }); }
  if (mode !== 'respond' && mode !== 'execute') { cleanupUpload(); return res.status(400).json({ error: 'invalid_mode' }); }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const finalText = trimmed || '(image attached, no caption)';
  stmts.insertVoiceMessage.run(id, mode, finalText, 'pending', now, replyToId, agent);
  stmts.upsertVoicePreference.run(agent, now);
  res.json({ id: id, status: 'pending', reply_to_id: replyToId, agent: agent });

  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  let imagePath = null;
  if (req.file && SUPPORTED_IMAGE_TYPES.indexOf(req.file.mimetype) !== -1) {
    // Both agents now run on the VPS host, not in-process — an uploaded
    // image is handed to either as a host-reachable path (Codex via its
    // native `-i` flag, Claude via a Read-tool pointer in the prompt; see
    // claudeRunner.js) rather than inlined base64.
    const relativeUploadPath = path.relative(DATA_DIR, req.file.path);
    if (!relativeUploadPath.startsWith('..')) imagePath = path.join(CODEX_HOST_DATA_DIR, relativeUploadPath);
  } else if (req.file) {
    console.error('unsupported attached image type: ' + req.file.mimetype);
  }
  if (!imagePath) cleanupUpload();

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

  voiceQueue.push({
    id: id,
    mode: mode,
    text: promptText,
    agent: agent,
    imagePath: imagePath,
    uploadPath: imagePath && req.file ? req.file.path : null
  });
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

app.get('/api/voice/agent', function (req, res) {
  const row = stmts.getVoicePreference.get();
  res.json({ agent: normalizeVoiceAgent(row && row.selected_agent) });
});

app.put('/api/voice/agent', function (req, res) {
  const requested = req.body && req.body.agent;
  if (requested !== 'claude' && requested !== 'codex') return res.status(400).json({ error: 'invalid_agent' });
  stmts.upsertVoicePreference.run(requested, new Date().toISOString());
  res.json({ agent: requested });
});

app.get('/api/voice/usage', async function (req, res) {
  try {
    res.json(await agentUsage.getUsage({ force: req.query.refresh === '1' }));
  } catch (err) {
    console.error('agent usage dashboard failed:', err.message);
    res.status(502).json({ error: 'usage_unavailable' });
  }
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

app.post('/api/voice/tts', async function (req, res) {
  const requestedAgent = req.body && req.body.agent;
  const messageId = req.body && req.body.messageId;
  const messageRow = typeof messageId === 'string' ? stmts.getVoiceMessage.get(messageId) : null;
  // A persisted message's recorded identity always wins over the browser's
  // claim. This also makes Play buttons from a slightly stale client route
  // correctly as long as they send the message ID.
  let agent = messageRow
    ? normalizeVoiceAgent(messageRow.agent)
    : (requestedAgent === 'claude' || requestedAgent === 'codex' ? requestedAgent : null);
  let text = req.body && req.body.text;

  // Never default an ambiguous TTS request to Claude/ElevenLabs. Older
  // pre-agent browser tabs sent text alone; failing closed prevents a Codex
  // reply from being spoken by ElevenLabs while that stale tab is open.
  if (!agent) return res.status(400).json({ error: 'tts_agent_required' });

  // Codex may speak completed user-facing replies only. Resolve the text
  // from the canonical DB row so browser code cannot accidentally send an
  // early acknowledgment, command, reasoning event, log, or Activity line
  // to OpenAI TTS. Claude deliberately keeps its existing browser-supplied
  // text path so its ElevenLabs early-ack/final behavior stays unchanged.
  if (agent === 'codex') {
    if (!messageRow || messageRow.status !== 'done' || !messageRow.reply_text) {
      return res.status(400).json({ error: 'codex_tts_requires_completed_message' });
    }
    text = speechText.stripMarkdownForSpeech(messageRow.reply_text);
  }

  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'invalid_text' });
  res.setHeader('X-RM-TTS-Provider', ttsRouter.providerForAgent(agent));
  try {
    const audio = await ttsRouter.synthesizeSpeech(agent, text.trim().slice(0, 4096));
    res.setHeader('Content-Type', audio.contentType);
    res.setHeader('X-RM-TTS-Streaming', audio.streaming ? '1' : '0');
    if (Buffer.isBuffer(audio.body)) return res.send(audio.body);
    res.flushHeaders();
    const stream = Readable.fromWeb(audio.body);
    stream.on('error', function (err) {
      console.error('tts stream failed:', err.message);
      if (!res.destroyed) res.destroy(err);
    });
    res.on('close', function () { if (!stream.destroyed) stream.destroy(); });
    stream.pipe(res);
  } catch (e) {
    console.error('tts failed (' + ttsRouter.providerForAgent(agent) + '):', e.message);
    if (!res.headersSent) {
      const status = e.code === 'openai_tts_not_configured' ? 503 : 502;
      res.status(status).json({ error: e.code || 'tts_failed' });
    }
  }
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
  let reconnecting = 0;
  rows.forEach(function (row) {
    if (row.status === 'pending') {
      voiceQueue.push({
        id: row.id,
        mode: row.mode,
        text: row.transcript,
        agent: normalizeVoiceAgent(row.agent),
        imagePath: null,
        uploadPath: null
      });
      requeued++;
    } else if (normalizeVoiceAgent(row.agent) === 'codex' && codexRunner.hasRecoverableRun(row.id)) {
      voiceQueue.push({ id: row.id, recoverAgent: 'codex' });
      reconnecting++;
    } else if (normalizeVoiceAgent(row.agent) === 'claude' && claudeRunner.hasRecoverableRun(row.id)) {
      voiceQueue.push({ id: row.id, recoverAgent: 'claude' });
      reconnecting++;
    } else {
      stmts.finishVoiceMessage.run('error', null,
        'Service restarted while this was in progress (redeploy or crash) — completion status unknown, please resend if it still needs doing.',
        now, row.id);
      errored++;
    }
  });
  console.log('voice queue recovery: requeued ' + requeued + ', reconnecting ' + reconnecting + ', errored ' + errored);
  fs.appendFile(WORK_LOG_PATH,
    '- [' + now + '] SERVICE RESTARTED — recovered voice queue: ' + requeued + ' pending message(s) requeued, ' +
    reconnecting + ' Codex message(s) reconnected, ' + errored + ' interrupted message(s) marked as error.\n',
    function () {});
  if (requeued || reconnecting) drainVoiceQueue();
}

// Same self-healing pattern as recoverInflightVoiceMessages() above, now
// applied to video analysis/build jobs too (2026-09-20 — Harvey reported
// a Final Check card's video repeatedly disappearing/reappearing).
// Real root cause, traced end to end rather than guessed: a piece whose
// `analysisStatus`/`finalBuildStatus` gets left at 'pending'/'running' by
// a mid-flight service restart (this container gets rebuilt/restarted
// for every backend deploy, §93) never gets picked back up by
// anything — nothing server-side ever resumes it. The client's own
// `maybeStartAnalysisPolling()` therefore keeps that one piece in its
// "still waiting" list *forever*, polling it every 3s indefinitely, and
// every tick re-renders the whole Kanban board (since nothing about the
// stuck piece ever actually changes to stop the loop) — which is what
// Harvey was actually seeing as a repeating flicker on whatever card he
// happened to be looking at, unrelated to anything he'd clicked. Marking
// these as a clear, terminal error on startup (instead of leaving them
// stuck) is what actually stops the client from ever polling them again.
function recoverInflightVideoJobs() {
  const now = new Date().toISOString();
  let fixed = 0;
  stmts.getAll.all('pieces').forEach(function (row) {
    let piece;
    try { piece = JSON.parse(row.data); } catch (e) { return; }
    if (!piece || !piece.hasVideo) return;
    let changed = false;
    if (piece.analysisStatus === 'pending' || piece.analysisStatus === 'running') {
      piece.analysisStatus = 'error';
      piece.analysisError = 'Service restarted while this was in progress — retry if a transcript/title match is still needed.';
      changed = true;
    }
    if (piece.finalBuildStatus === 'pending' || piece.finalBuildStatus === 'running') {
      piece.finalBuildStatus = 'error';
      piece.finalBuildError = 'Service restarted while this was in progress — try "Send to final check" again.';
      changed = true;
    }
    if (changed) {
      piece.updatedAt = now;
      savePieceRecord(piece);
      fixed++;
    }
  });
  if (fixed) {
    console.log('video job recovery: marked ' + fixed + ' stuck piece(s) as error');
    fs.appendFile(WORK_LOG_PATH,
      '- [' + now + '] SERVICE RESTARTED — recovered ' + fixed + ' stuck video analysis/build job(s), marked as error.\n',
      function () {});
  }
}

app.listen(PORT, function () {
  console.log('rm-ops-service listening on ' + PORT);
  recoverInflightVoiceMessages();
  recoverInflightVideoJobs();
});
