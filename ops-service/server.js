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
// early_ack: the first genuinely contextual sentence CC produces for a
// turn (see claudeRunner.js's handleEvent) — spoken to Harvey immediately
// instead of a hardcoded filler phrase while the real work is still in
// progress. Same safe-ALTER pattern as activity_log above.
try { db.exec('ALTER TABLE voice_messages ADD COLUMN early_ack TEXT'); } catch (e) { /* already exists */ }

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
  'Quick verbal acknowledgment: this is a hard mechanical rule, not a judgment call — the ' +
  'moment you decide this turn needs ANY tool call at all (even one quick git/bash/read ' +
  'command, even something that feels trivial like "just confirm the deploy went through"), ' +
  'your very first output must be one short sentence, BEFORE that first tool call, not after ' +
  'it and not interleaved with it. Do not silently run one or more tool calls and only speak ' +
  'once you already have the full answer assembled — a past turn did exactly that (a "just ' +
  'checking in" message got several git/bash calls with zero preceding text), and the result ' +
  'was Harvey hearing the generic fallback phrase (because the real acknowledgment arrived too ' +
  'late to beat the fallback timer) and the queue showing his own raw message as its title ' +
  '(because nothing had been written yet for it to show instead) — both symptoms of the same ' +
  'root cause: silence before the first tool call. Treat "let me investigate a little before ' +
  'answering" as reason enough to trigger this, regardless of how quick or simple the ' +
  'investigation feels — a git fetch or an SSH call can easily take several real seconds, long ' +
  'enough on its own to trip the fallback. That first sentence must genuinely reflect his ' +
  'specific message: a short, plain-language restatement that proves you understood what he ' +
  'actually said (not a generic "I understand" or "got it"), plus — when it is not obvious — a ' +
  'brief note of what you are about to check or do. This also shows up as the queue panel\'s ' +
  'item title, so it has to read like a task ("doing X"), never like an answer to him — do not ' +
  'phrase it as a reply to any small-talk/greeting part of his message either (a real instance ' +
  'of this mistake: replying to "how\'s it going" with "Doing well — I verified..." as the ' +
  'acknowledgment — that is answering him, not describing a task, and it should never have been ' +
  'the acknowledgment sentence in the first place, only the eventual real answer). E.g. if he ' +
  'asks "did the deploy actually go through," a good first line is "Checking the deploy log now ' +
  'to confirm it actually completed" — NOT "Got it, I\'ll get right on that," and NOT "Yes, it ' +
  'went through" (that is the answer, said too early, before you have actually checked). Keep ' +
  'it to one short sentence; the real, ' +
  'complete answer still follows later as your normal final response once you actually have ' +
  'it, exactly as described above — this is only the immediate, spoken-first acknowledgment, ' +
  'not a substitute for it. Skip this only for a turn you can answer directly with genuinely no ' +
  'tool use at all — there, your one real response is both the acknowledgment and the answer, ' +
  'so there is nothing separate to say first.\n\n' +
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

function buildVoicePrompt(mode, text) {
  if (mode === 'execute') {
    return '[Voice instruction from Harvey, sent while away from his desk — proceed with full ' +
      'autonomy using your normal judgement and this project\'s CLAUDE.md conventions. Do not ask ' +
      'clarifying questions — make the most reasonable assumption and note it briefly. He will not ' +
      'hear a spoken reply and is not watching live, but your final answer IS shown to him ' +
      'afterward as text, so make it a real completion summary (what you did/found/decided), not ' +
      'a throwaway line — carry out the task fully.] ' + text;
  }
  return '[Voice message from Harvey, sent from his phone or desktop — he expects a reply. If ' +
    'this turn needs you to check code, logs, git history, or run commands to answer accurately, ' +
    'do that first — he is told immediately that you received this and are working on it, so a ' +
    'longer investigation is fine and expected, not something to shortcut.] ' + text;
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
  function cleanupUpload() { if (req.file) fs.rm(req.file.path, { force: true }, function () {}); }
  if (!trimmed && !req.file) { cleanupUpload(); return res.status(400).json({ error: 'invalid_text' }); }
  if (mode !== 'respond' && mode !== 'execute') { cleanupUpload(); return res.status(400).json({ error: 'invalid_mode' }); }

  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const finalText = trimmed || '(image attached, no caption)';
  stmts.insertVoiceMessage.run(id, mode, finalText, 'pending', now);
  res.json({ id: id, status: 'pending' });

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

  voiceQueue.push({ id: id, mode: mode, text: finalText, imageBlock: imageBlock });
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
