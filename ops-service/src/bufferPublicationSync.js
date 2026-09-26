'use strict';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }

function metricsObject(metrics) {
  const result = {};
  (metrics || []).forEach(function (metric) {
    const type = clean(metric && metric.type, 80);
    if (!type) return;
    result[type] = {
      name: clean(metric.name || type, 120),
      value: Number(metric.value) || 0,
      unit: clean(metric.unit || 'count', 30)
    };
  });
  return result;
}

function comparable(piece) {
  return JSON.stringify({
    stage: piece.stage, scheduledAt: piece.scheduledAt, postedAt: piece.postedAt,
    publishStatus: piece.tiktokPublishStatus, publishError: piece.tiktokPublishError,
    bufferStatus: piece.tiktokBufferStatus, externalLink: piece.tiktokExternalLink,
    supportUrl: piece.tiktokBufferSupportUrl, metrics: piece.tiktokMetrics,
    metricsUpdatedAt: piece.tiktokMetricsUpdatedAt
  });
}

function setup(db, options) {
  options = options || {};
  const intervalMs = Number(options.intervalMs) || FIFTEEN_MINUTES;
  const enabled = options.enabled !== false && typeof options.listPieces === 'function' &&
    typeof options.fetchPost === 'function' && typeof options.savePiece === 'function';

  db.exec(`CREATE TABLE IF NOT EXISTS buffer_publication_sync_state (
    id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL DEFAULT 'never_run',
    last_started_at TEXT, last_completed_at TEXT, last_error TEXT,
    checked_count INTEGER NOT NULL DEFAULT 0, scheduled_count INTEGER NOT NULL DEFAULT 0,
    live_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
    metrics_count INTEGER NOT NULL DEFAULT 0
  )`);
  db.prepare("INSERT OR IGNORE INTO buffer_publication_sync_state(id,status) VALUES(1,'never_run')").run();

  function currentState() {
    return db.prepare('SELECT * FROM buffer_publication_sync_state WHERE id=1').get();
  }

  async function run() {
    if (!enabled) return { enabled: false, skipped: 'disabled' };
    const startedAt = new Date().toISOString();
    db.prepare("UPDATE buffer_publication_sync_state SET status='running',last_started_at=?,last_error=NULL WHERE id=1").run(startedAt);
    const pieces = (await options.listPieces()).filter(function (piece) {
      return piece && piece.tiktokPublishProvider === 'buffer' && piece.tiktokPublishId &&
        ['scheduled', 'live'].indexOf(piece.stage) !== -1;
    });
    let scheduled = 0;
    let live = 0;
    let failed = 0;
    let metricsCount = 0;
    const errors = [];

    for (const piece of pieces) {
      try {
        const before = comparable(piece);
        const post = await options.fetchPost(piece.tiktokPublishId);
        const status = clean(post.status, 40).toLowerCase();
        const checkedAt = new Date().toISOString();
        piece.tiktokBufferStatus = status;
        if (post.dueAt) piece.scheduledAt = post.dueAt;
        if (post.externalLink) piece.tiktokExternalLink = post.externalLink;

        if (status === 'sent') {
          piece.stage = 'live';
          piece.tiktokPublishStatus = 'done';
          piece.tiktokPublishError = '';
          piece.postedAt = post.sentAt || piece.postedAt || post.dueAt || checkedAt;
          piece.tiktokMetrics = metricsObject(post.metrics);
          piece.tiktokMetricsUpdatedAt = post.metricsUpdatedAt || null;
          metricsCount += Object.keys(piece.tiktokMetrics).length ? 1 : 0;
          live += 1;
        } else if (status === 'error') {
          piece.stage = 'final_check';
          piece.scheduledAt = '';
          piece.tiktokPublishStatus = 'error';
          piece.tiktokPublishError = clean(post.error && post.error.message || 'Buffer could not publish this TikTok post.', 500);
          piece.tiktokBufferSupportUrl = clean(post.error && post.error.supportUrl, 500) || null;
          failed += 1;
        } else {
          // Buffer's remaining pre-publication states are scheduled/sending.
          piece.stage = 'scheduled';
          piece.tiktokPublishStatus = status === 'sending' ? 'running' : 'done';
          scheduled += 1;
        }
        if (comparable(piece) !== before) {
          piece.tiktokBufferCheckedAt = checkedAt;
          piece.updatedAt = checkedAt;
          await options.savePiece(piece);
        }
      } catch (error) {
        // Never move a card based on an unavailable API. A single bad post
        // also must not prevent all the other queued posts from reconciling.
        errors.push({ pieceId: piece.id, message: clean(error.message, 500) });
      }
    }

    const completedAt = new Date().toISOString();
    const stateStatus = errors.length ? 'partial_error' : 'ok';
    const lastError = errors.length ? errors.map(function (item) { return item.pieceId + ': ' + item.message; }).join('; ').slice(0, 1000) : null;
    db.prepare(`UPDATE buffer_publication_sync_state SET status=?,last_completed_at=?,last_error=?,
      checked_count=?,scheduled_count=?,live_count=?,failed_count=?,metrics_count=? WHERE id=1`)
      .run(stateStatus, completedAt, lastError, pieces.length, scheduled, live, failed, metricsCount);
    return { enabled: true, checkedAt: completedAt, checked: pieces.length, scheduled: scheduled,
      live: live, failed: failed, metrics: metricsCount, errors: errors };
  }

  function status() {
    return { enabled: enabled, intervalMs: intervalMs, state: currentState() };
  }

  let timer = null;
  if (enabled && options.autoStart !== false) {
    setImmediate(function () { run().catch(function (error) { console.error('[buffer-publication-sync] failed:', error.message); }); });
    timer = setInterval(function () { run().catch(function (error) { console.error('[buffer-publication-sync] failed:', error.message); }); }, intervalMs);
    if (timer.unref) timer.unref();
  }

  return { enabled: enabled, run: run, status: status, metricsObject: metricsObject,
    close: function () { if (timer) clearInterval(timer); } };
}

module.exports = { setup: setup, metricsObject: metricsObject, FIFTEEN_MINUTES: FIFTEEN_MINUTES };
