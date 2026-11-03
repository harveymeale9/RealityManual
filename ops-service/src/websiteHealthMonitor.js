'use strict';

const DEFAULT_TARGETS = [
  { id: 'homepage', label: 'Homepage', url: 'https://realitymanual.com/', method: 'GET', expected: 200 },
  { id: 'checkout', label: 'Checkout', url: 'https://realitymanual.com/checkout.html', method: 'GET', expected: 200 },
  { id: 'api', label: 'Store API', url: 'https://api.realitymanual.com/health', method: 'GET', expected: 200 },
  { id: 'image', label: 'Hero image', url: 'https://realitymanual.com/img/photo/reality-manual-open-book-spread.jpg', method: 'HEAD', expected: 200 },
  { id: 'video', label: 'Video range', url: 'https://api.realitymanual.com/media/reality-manual-vsl-1080p.mp4', method: 'GET', expected: 206, range: true },
];

function setup(db, options = {}) {
  const targets = options.targets || DEFAULT_TARGETS;
  const request = options.fetch || fetch;
  const now = options.now || (() => new Date());
  const timeoutMs = options.timeoutMs || 8000;
  db.exec(`CREATE TABLE IF NOT EXISTS website_health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checked_at TEXT NOT NULL,
    target TEXT NOT NULL,
    result TEXT NOT NULL,
    http_status INTEGER,
    duration_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_website_health_checked_at ON website_health_checks(checked_at);`);
  const insert = db.prepare(`INSERT INTO website_health_checks
    (checked_at,target,result,http_status,duration_ms) VALUES (?,?,?,?,?)`);
  const prune = db.prepare('DELETE FROM website_health_checks WHERE checked_at < ?');
  let running = null;

  async function check(target) {
    const start = Date.now();
    let result = 'ok', status = null;
    try {
      const response = await request(target.url, {
        method: target.method,
        headers: target.range ? { Range: 'bytes=0-0' } : undefined,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      if (status !== target.expected) result = 'http_error';
      if (response.body) {
        if (result === 'ok' && target.method === 'GET') await response.arrayBuffer();
        else await response.body.cancel();
      }
    } catch (error) {
      result = error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network_error';
    }
    const row = {
      checked_at: now().toISOString(), target: target.id, result,
      http_status: status, duration_ms: Math.max(0, Date.now() - start),
    };
    insert.run(row.checked_at, row.target, row.result, row.http_status, row.duration_ms);
    return row;
  }

  function run() {
    if (running) return running;
    running = Promise.all(targets.map(check)).then((rows) => {
      prune.run(new Date(now().getTime() - 30 * 86400000).toISOString());
      return rows;
    }).finally(() => { running = null; });
    return running;
  }

  function status() {
    const since = new Date(now().getTime() - 86400000).toISOString();
    const rows = db.prepare('SELECT checked_at,target,result,http_status,duration_ms FROM website_health_checks WHERE checked_at >= ? ORDER BY checked_at DESC,id DESC').all(since);
    const latest = [];
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.target)) continue;
      seen.add(row.target);
      const target = targets.find((item) => item.id === row.target);
      latest.push({ ...row, label: target ? target.label : row.target });
    }
    const incidents = { http_403: 0, http_404: 0, http_5xx: 0, other_http: 0, timeout: 0, network_error: 0 };
    for (const row of rows) {
      if (row.result === 'timeout') incidents.timeout++;
      else if (row.result === 'network_error') incidents.network_error++;
      else if (row.result === 'http_error') {
        if (row.http_status === 403) incidents.http_403++;
        else if (row.http_status === 404) incidents.http_404++;
        else if (row.http_status >= 500) incidents.http_5xx++;
        else incidents.other_http++;
      }
    }
    const ok = rows.filter((row) => row.result === 'ok').length;
    const availability = rows.length ? Math.round(ok / rows.length * 1000) / 10 : null;
    const stale = latest.length < targets.length || latest.some((row) => now().getTime() - Date.parse(row.checked_at) > 15 * 60000);
    const criticalDown = latest.some((row) => ['homepage', 'checkout', 'api'].includes(row.target) && row.result !== 'ok');
    return {
      level: !rows.length || stale ? 'unknown' : criticalDown ? 'down' : availability < 99 || latest.some((row) => row.result !== 'ok') ? 'degraded' : 'healthy',
      availability_24h_pct: availability,
      successful_checks: ok, total_checks: rows.length, incidents,
      latest, checked_at: latest[0] ? latest[0].checked_at : null,
      definition: 'Synthetic checks every five minutes from the ops server. Counts are failed checks, not all visitor HTTP requests.',
    };
  }

  function start() {
    setImmediate(() => { run().catch((error) => console.error('Website health check failed:', error.message)); });
    const timer = setInterval(() => { run().catch((error) => console.error('Website health check failed:', error.message)); }, 300000);
    timer.unref?.();
    return timer;
  }
  return { run, status, start };
}

module.exports = { setup, DEFAULT_TARGETS };
