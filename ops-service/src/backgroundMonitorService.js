'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 100000); }
function json(value, fallback) { try { return JSON.parse(value); } catch (error) { return fallback; } }
function now() { return new Date().toISOString(); }

function validateRequest(input) {
  input = input || {};
  const kind = clean(input.kind, 80);
  if (['github_release_asset', 'http', 'file', 'time'].indexOf(kind) === -1) throw new Error('unsupported_monitor_kind');
  const title = clean(input.title, 300);
  const continuation = clean(input.continuationPrompt, 6000);
  if (!title || !continuation) throw new Error('monitor_title_and_continuation_required');
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  if (kind === 'github_release_asset' && (!clean(config.owner, 150) || !clean(config.repo, 150) || !clean(config.tag, 200) || !clean(config.asset, 500))) {
    throw new Error('github_monitor_config_required');
  }
  if (kind === 'http' && !/^https:\/\//i.test(clean(config.url, 2000))) throw new Error('https_monitor_url_required');
  if (kind === 'file' && !clean(config.path, 2000).startsWith('/data/')) throw new Error('file_monitor_path_must_be_under_data');
  if (kind === 'time' && !Number.isFinite(new Date(config.at).getTime())) throw new Error('valid_monitor_time_required');
  return {
    id: /^[a-f0-9-]{16,64}$/i.test(String(input.id || '')) ? String(input.id) : crypto.randomUUID(),
    kind: kind, title: title, continuationPrompt: continuation,
    agent: input.agent === 'claude' ? 'claude' : 'codex', config: config,
    intervalSeconds: Math.max(15, Math.min(86400, Number(input.intervalSeconds) || 60)),
    minWeeklyRemaining: Math.max(0, Math.min(100, Number(input.minWeeklyRemaining) || 15)),
    expiresAt: input.expiresAt && Number.isFinite(new Date(input.expiresAt).getTime())
      ? new Date(input.expiresAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString()
  };
}

function setup(db, options) {
  options = options || {};
  const enabled = options.enabled !== false;
  const requestDir = options.requestDir || '/data/monitor-requests';
  const intervalMs = Math.max(5000, Number(options.intervalMs) || 30000);
  const fetchImpl = options.fetch || fetch;
  const getUsage = options.getUsage || (async function () { return { providers: [] }; });
  const enqueueContinuation = options.enqueueContinuation || (async function () {});

  db.exec(`CREATE TABLE IF NOT EXISTS background_monitors (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
    continuation_prompt TEXT NOT NULL, agent TEXT NOT NULL,
    config_json TEXT NOT NULL, status TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL, min_weekly_remaining REAL NOT NULL,
    consecutive_matches INTEGER NOT NULL DEFAULT 0,
    result_json TEXT, last_error TEXT, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, next_check_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, triggered_at TEXT, continuation_message_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_background_monitors_due ON background_monitors(status,next_check_at);`);

  try { fs.mkdirSync(requestDir, { recursive: true, mode: 0o777 }); fs.chmodSync(requestDir, 0o777); } catch (error) { console.error('[background-monitor] request dir:', error.message); }

  function register(input) {
    const item = validateRequest(input);
    const stamp = now();
    db.prepare(`INSERT OR IGNORE INTO background_monitors
      (id,kind,title,continuation_prompt,agent,config_json,status,interval_seconds,
       min_weekly_remaining,created_at,updated_at,next_check_at,expires_at)
      VALUES(?,?,?,?,?,?,'watching',?,?,?,?,?,?)`)
      .run(item.id, item.kind, item.title, item.continuationPrompt, item.agent,
        JSON.stringify(item.config), item.intervalSeconds, item.minWeeklyRemaining,
        stamp, stamp, stamp, item.expiresAt);
    return db.prepare('SELECT * FROM background_monitors WHERE id=?').get(item.id);
  }

  function ingestRequests() {
    if (!enabled) return 0;
    let names;
    try { names = fs.readdirSync(requestDir).filter(function (name) { return name.endsWith('.json'); }); }
    catch (error) { return 0; }
    let ingested = 0;
    names.forEach(function (name) {
      const source = path.join(requestDir, name);
      try {
        register(json(fs.readFileSync(source, 'utf8'), {}));
        fs.renameSync(source, source + '.accepted');
        ingested++;
      } catch (error) {
        console.error('[background-monitor] rejected ' + name + ':', error.message);
        try { fs.renameSync(source, source + '.rejected'); } catch (e) { /* retain original if rename fails */ }
      }
    });
    return ingested;
  }

  async function probe(row) {
    const config = json(row.config_json, {});
    if (row.kind === 'github_release_asset') {
      const url = 'https://api.github.com/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo) +
        '/releases/tags/' + encodeURIComponent(config.tag);
      const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'reality-manual-monitor' } });
      if (!response.ok) throw new Error('github_release_' + response.status);
      const release = await response.json();
      const asset = (release.assets || []).find(function (candidate) { return candidate.name === config.asset && candidate.state === 'uploaded'; });
      return asset ? { ready: true, result: { name: asset.name, size: asset.size, url: asset.browser_download_url, assetId: asset.id } } : { ready: false };
    }
    if (row.kind === 'http') {
      const response = await fetchImpl(config.url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      const body = clean(await response.text(), 1000000);
      const wantedStatus = Number(config.status || 200);
      const ready = response.status === wantedStatus && (!config.bodyIncludes || body.indexOf(String(config.bodyIncludes)) !== -1);
      return { ready: ready, result: ready ? { url: config.url, status: response.status } : null };
    }
    if (row.kind === 'file') {
      try {
        const stat = fs.statSync(config.path);
        const previous = json(row.result_json, {});
        const stable = stat.isFile() && stat.size > Number(config.minimumBytes || 0) && previous.observedSize === stat.size;
        return { ready: stable, result: { path: config.path, size: stat.size, observedSize: stat.size } };
      } catch (error) { if (error.code === 'ENOENT') return { ready: false }; throw error; }
    }
    return { ready: Date.now() >= new Date(config.at).getTime(), result: { at: config.at } };
  }

  async function creditAllowed(row) {
    const usage = await getUsage({ force: true });
    const provider = (usage.providers || []).find(function (entry) { return entry.provider === row.agent; });
    if (!provider || !provider.available) return { allowed: true, reason: 'usage_unavailable' };
    const weekly = (provider.limits || []).filter(function (limit) { return limit.kind === 'weekly'; });
    const remaining = weekly.length ? Math.min.apply(null, weekly.map(function (limit) { return Number(limit.remainingPercentage); })) : null;
    if (remaining !== null && Number.isFinite(remaining) && remaining < Number(row.min_weekly_remaining)) {
      return { allowed: false, remaining: remaining };
    }
    return { allowed: true, remaining: remaining };
  }

  async function checkRow(row) {
    const stamp = now();
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare("UPDATE background_monitors SET status='expired',updated_at=? WHERE id=?").run(stamp, row.id);
      return { id: row.id, status: 'expired' };
    }
    try {
      const outcome = await probe(row);
      const next = new Date(Date.now() + Number(row.interval_seconds) * 1000).toISOString();
      if (!outcome.ready) {
        db.prepare("UPDATE background_monitors SET status='watching',result_json=?,last_error=NULL,updated_at=?,next_check_at=? WHERE id=?")
          .run(outcome.result ? JSON.stringify(outcome.result) : row.result_json, stamp, next, row.id);
        return { id: row.id, status: 'watching' };
      }
      const credit = await creditAllowed(row);
      if (!credit.allowed) {
        db.prepare("UPDATE background_monitors SET status='paused_credits',result_json=?,last_error=?,updated_at=?,next_check_at=? WHERE id=?")
          .run(JSON.stringify(outcome.result || {}), 'Weekly allowance remaining: ' + credit.remaining + '%', stamp, next, row.id);
        return { id: row.id, status: 'paused_credits', remaining: credit.remaining };
      }
      // Claim before enqueueing so overlapping timer/manual checks cannot
      // wake two agent turns for the same condition.
      const claimed = db.prepare("UPDATE background_monitors SET status='triggering',result_json=?,last_error=NULL,updated_at=? WHERE id=? AND status IN ('watching','paused_credits')")
        .run(JSON.stringify(outcome.result || {}), stamp, row.id);
      if (!claimed.changes) return { id: row.id, status: row.status };
      const messageId = await enqueueContinuation({
        monitorId: row.id, title: row.title, agent: row.agent,
        prompt: row.continuation_prompt,
        result: outcome.result || {}
      });
      db.prepare("UPDATE background_monitors SET status='triggered',triggered_at=?,continuation_message_id=?,updated_at=? WHERE id=?")
        .run(stamp, clean(messageId, 128) || null, stamp, row.id);
      return { id: row.id, status: 'triggered', messageId: messageId };
    } catch (error) {
      const next = new Date(Date.now() + Number(row.interval_seconds) * 1000).toISOString();
      db.prepare("UPDATE background_monitors SET last_error=?,updated_at=?,next_check_at=? WHERE id=?")
        .run(clean(error.message, 1000), stamp, next, row.id);
      return { id: row.id, status: row.status, error: error.message };
    }
  }

  let checking = false;
  async function checkDue() {
    if (!enabled || checking) return [];
    checking = true;
    try {
      ingestRequests();
      const rows = db.prepare("SELECT * FROM background_monitors WHERE status IN ('watching','paused_credits') AND next_check_at<=? ORDER BY next_check_at ASC LIMIT 20").all(now());
      const results = [];
      for (const row of rows) results.push(await checkRow(row));
      return results;
    } finally { checking = false; }
  }

  function list() { return db.prepare('SELECT * FROM background_monitors ORDER BY created_at DESC LIMIT 100').all(); }
  function cancel(id) {
    return db.prepare("UPDATE background_monitors SET status='cancelled',updated_at=? WHERE id=? AND status IN ('watching','paused_credits')").run(now(), id).changes > 0;
  }

  let timer = null;
  if (enabled && options.autoStart !== false) {
    setImmediate(function () { checkDue().catch(function (error) { console.error('[background-monitor] check:', error.message); }); });
    timer = setInterval(function () { checkDue().catch(function (error) { console.error('[background-monitor] check:', error.message); }); }, intervalMs);
    if (timer.unref) timer.unref();
  }
  return { enabled: enabled, register: register, ingestRequests: ingestRequests, checkDue: checkDue, checkRow: checkRow, list: list, cancel: cancel, close: function () { if (timer) clearInterval(timer); } };
}

module.exports = { setup: setup, validateRequest: validateRequest };
