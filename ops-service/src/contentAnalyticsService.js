'use strict';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook'];

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}
function hourBucket(value) {
  const date = new Date(value || Date.now());
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}
function json(value, fallback) { try { return JSON.parse(value); } catch (error) { return fallback; } }
function relevantPiece(piece) {
  return piece && piece.createdBy !== 'youtube-reviewer' && (piece.stage === 'live' || piece.postedAt) &&
    (piece.youtubeVideoId || piece.tiktokPublishId || piece.instagramMediaId || piece.facebookVideoId);
}
function platformUrl(piece, platform) {
  if (platform === 'youtube') return clean(piece.youtubeUrl || (piece.youtubeVideoId ? 'https://www.youtube.com/watch?v=' + piece.youtubeVideoId : ''), 2000);
  if (platform === 'tiktok') return clean(piece.tiktokExternalLink, 2000);
  if (platform === 'instagram') return clean(piece.instagramUrl, 2000);
  if (platform === 'facebook') return clean(piece.facebookUrl, 2000);
  return '';
}

// A view count is a cumulative platform counter, not a day's new views. Use
// the last non-null observation for each connected piece as of each day;
// dates before the first observation stay unknown rather than becoming zero.
function overallViewHistory(metricRows, pieceRows, nowValue) {
  const eligible = new Set();
  pieceRows.forEach(function (piece) {
    Object.keys(piece.platforms).forEach(function (platform) { eligible.add(piece.id + ':' + platform); });
  });
  const today = new Date(nowValue);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - 89 * DAY_MS);
  const latest = new Map();
  let cursor = 0;
  return Array.from({ length: 90 }, function (_, index) {
    const day = new Date(start.getTime() + index * DAY_MS);
    const end = new Date(day.getTime() + DAY_MS).toISOString();
    while (cursor < metricRows.length && metricRows[cursor].captured_at < end) {
      const row = metricRows[cursor++];
      const key = row.piece_id + ':' + row.platform;
      if (eligible.has(key) && row.views != null) latest.set(key, Math.max(0, Number(row.views) || 0));
    }
    const totals = Object.fromEntries(PLATFORMS.map(function (platform) { return [platform, null]; }));
    let total = 0;
    let measured = false;
    latest.forEach(function (views, key) {
      const platform = key.slice(key.lastIndexOf(':') + 1);
      totals[platform] = (totals[platform] || 0) + views;
      total += views;
      measured = true;
    });
    return Object.assign({ day: day.toISOString().slice(0, 10), total: measured ? total : null }, totals);
  });
}

function setup(db, options) {
  options = options || {};
  const intervalMs = Math.max(5 * 60 * 1000, Number(options.intervalMs) || HOUR_MS);
  const listPieces = options.listPieces || function () { return []; };
  const collectors = options.collectors || {};
  const now = options.now || function () { return new Date(); };
  let running = null;
  let timer = null;

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_metric_snapshots (
      piece_id TEXT NOT NULL, platform TEXT NOT NULL, captured_at TEXT NOT NULL,
      views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
      reach INTEGER, watch_time_seconds REAL, average_watch_seconds REAL,
      PRIMARY KEY (piece_id, platform, captured_at)
    );
    CREATE INDEX IF NOT EXISTS idx_content_metrics_piece_time
      ON content_metric_snapshots(piece_id, captured_at);
    CREATE TABLE IF NOT EXISTS content_channel_snapshots (
      platform TEXT NOT NULL, captured_at TEXT NOT NULL, followers INTEGER,
      total_views INTEGER, media_count INTEGER,
      PRIMARY KEY (platform, captured_at)
    );
    CREATE TABLE IF NOT EXISTS content_comment_watch (
      piece_id TEXT NOT NULL, platform TEXT NOT NULL,
      high_water_count INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      first_unreviewed_at TEXT, last_unreviewed_at TEXT, observed_at TEXT NOT NULL,
      PRIMARY KEY (piece_id, platform)
    );
    CREATE TABLE IF NOT EXISTS content_analytics_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), last_attempt_at TEXT,
      last_collected_at TEXT, last_error TEXT, provider_status_json TEXT NOT NULL DEFAULT '{}'
    );
    INSERT OR IGNORE INTO content_analytics_state (id) VALUES (1);
  `);

  const upsertMetric = db.prepare(`INSERT INTO content_metric_snapshots
    (piece_id,platform,captured_at,views,likes,comments,shares,saves,reach,watch_time_seconds,average_watch_seconds)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(piece_id,platform,captured_at) DO UPDATE SET
      views=excluded.views,likes=excluded.likes,comments=excluded.comments,shares=excluded.shares,
      saves=excluded.saves,reach=excluded.reach,watch_time_seconds=excluded.watch_time_seconds,
      average_watch_seconds=excluded.average_watch_seconds`);
  const upsertChannel = db.prepare(`INSERT INTO content_channel_snapshots
    (platform,captured_at,followers,total_views,media_count) VALUES (?,?,?,?,?)
    ON CONFLICT(platform,captured_at) DO UPDATE SET followers=excluded.followers,
      total_views=excluded.total_views,media_count=excluded.media_count`);
  const getCommentWatch = db.prepare('SELECT * FROM content_comment_watch WHERE piece_id=? AND platform=?');
  const insertCommentWatch = db.prepare(`INSERT INTO content_comment_watch
    (piece_id,platform,high_water_count,pending_count,first_unreviewed_at,last_unreviewed_at,observed_at)
    VALUES (?,?,?,?,?,?,?)`);
  const advanceCommentWatch = db.prepare(`UPDATE content_comment_watch SET high_water_count=?,pending_count=?,
    first_unreviewed_at=?,last_unreviewed_at=?,observed_at=? WHERE piece_id=? AND platform=?`);
  const touchCommentWatch = db.prepare('UPDATE content_comment_watch SET observed_at=? WHERE piece_id=? AND platform=?');

  function observeComments(pieceId, platform, count, stamp) {
    if (count == null) return;
    const watch = getCommentWatch.get(pieceId, platform);
    if (!watch) {
      // First scan deliberately flags existing comments for one review;
      // otherwise an old unanswered comment could be silently missed.
      insertCommentWatch.run(pieceId, platform, count, count, count ? stamp : null, count ? stamp : null, stamp);
    } else if (count > watch.high_water_count) {
      advanceCommentWatch.run(count, watch.pending_count + count - watch.high_water_count,
        watch.pending_count ? watch.first_unreviewed_at : stamp, stamp, stamp, pieceId, platform);
    } else {
      // Keep the high-water mark when comments are deleted or hidden, so a
      // later rebound does not generate a duplicate alert.
      touchCommentWatch.run(stamp, pieceId, platform);
    }
  }

  function saveResults(results, stamp) {
    const bucket = hourBucket(stamp);
    db.transaction(function () {
      (results.pieces || []).forEach(function (row) {
        if (!row || !row.pieceId || PLATFORMS.indexOf(row.platform) === -1) return;
        const metric = row.metrics || {};
        upsertMetric.run(row.pieceId, row.platform, bucket,
          numberOrNull(metric.views), numberOrNull(metric.likes), numberOrNull(metric.comments),
          numberOrNull(metric.shares), numberOrNull(metric.saves), numberOrNull(metric.reach),
          numberOrNull(metric.watchTimeSeconds), numberOrNull(metric.averageWatchSeconds));
        observeComments(row.pieceId, row.platform, numberOrNull(metric.comments), bucket);
      });
      (results.channels || []).forEach(function (row) {
        if (!row || PLATFORMS.indexOf(row.platform) === -1) return;
        upsertChannel.run(row.platform, bucket, numberOrNull(row.followers),
          numberOrNull(row.totalViews), numberOrNull(row.mediaCount));
      });
      db.prepare('DELETE FROM content_metric_snapshots WHERE captured_at < ?').run(new Date(new Date(stamp).getTime() - 365 * DAY_MS).toISOString());
      db.prepare('DELETE FROM content_channel_snapshots WHERE captured_at < ?').run(new Date(new Date(stamp).getTime() - 365 * DAY_MS).toISOString());
    })();
  }

  async function collect() {
    if (running) return running;
    running = (async function () {
      const stamp = now().toISOString();
      const pieces = (await Promise.resolve(listPieces())).filter(relevantPiece);
      const providerStatus = {};
      const combined = { pieces: [], channels: [] };
      for (const platform of PLATFORMS) {
        if (typeof collectors[platform] !== 'function') {
          providerStatus[platform] = { available: false, error: 'not_configured' };
          continue;
        }
        try {
          const result = await collectors[platform](pieces);
          combined.pieces.push.apply(combined.pieces, result && result.pieces || []);
          combined.channels.push.apply(combined.channels, result && result.channels || []);
          providerStatus[platform] = Object.assign({ available: true }, result && result.status || {});
        } catch (error) {
          providerStatus[platform] = { available: false, error: clean(error.message || error, 300) };
        }
      }
      saveResults(combined, stamp);
      const successes = Object.keys(providerStatus).filter(function (platform) { return providerStatus[platform].available; }).length;
      const error = successes ? null : 'Every platform metric request failed.';
      db.prepare(`UPDATE content_analytics_state SET last_attempt_at=?,last_collected_at=?,last_error=?,provider_status_json=? WHERE id=1`)
        .run(stamp, successes ? stamp : null, error, JSON.stringify(providerStatus));
      return dashboard();
    })().finally(function () { running = null; });
    return running;
  }

  function metricDelta(latest, history, field, ageMs) {
    const target = now().getTime() - ageMs;
    const before = history.filter(function (row) { return new Date(row.captured_at).getTime() <= target && row[field] != null; }).pop();
    return before && latest[field] != null ? Math.max(0, Number(latest[field]) - Number(before[field])) : null;
  }

  function dashboard() {
    const pieces = listPieces().filter(relevantPiece).sort(function (a, b) {
      return new Date(b.postedAt || b.updatedAt || 0) - new Date(a.postedAt || a.updatedAt || 0);
    });
    const metricRows = db.prepare('SELECT * FROM content_metric_snapshots ORDER BY captured_at').all();
    const channelRows = db.prepare('SELECT * FROM content_channel_snapshots ORDER BY captured_at').all();
    const byPiece = new Map();
    metricRows.forEach(function (row) {
      const key = row.piece_id + ':' + row.platform;
      if (!byPiece.has(key)) byPiece.set(key, []);
      byPiece.get(key).push(row);
    });
    let totalViews = 0;
    let totalEngagements = 0;
    let rateEligibleEngagements = 0;
    const pieceRows = pieces.map(function (piece) {
      let pieceViews = 0;
      let pieceEngagement = 0;
      let pieceRateEngagement = 0;
      let knownViews = false;
      const platforms = {};
      PLATFORMS.forEach(function (platform) {
        const history = byPiece.get(piece.id + ':' + platform) || [];
        const latest = history.length ? history[history.length - 1] : null;
        const expected = platform === 'youtube' ? !!piece.youtubeVideoId
          : platform === 'tiktok' ? !!piece.tiktokPublishId
          : platform === 'instagram' ? !!piece.instagramMediaId : !!piece.facebookVideoId;
        if (!expected) return;
        const engagement = latest ? Number(latest.likes || 0) + Number(latest.comments || 0) + Number(latest.shares || 0) + Number(latest.saves || 0) : 0;
        if (latest && latest.views != null) { pieceViews += latest.views; pieceRateEngagement += engagement; knownViews = true; }
        pieceEngagement += engagement;
        platforms[platform] = {
          available: !!latest, url: platformUrl(piece, platform), capturedAt: latest && latest.captured_at,
          views: latest && latest.views, likes: latest && latest.likes, comments: latest && latest.comments,
          shares: latest && latest.shares, saves: latest && latest.saves, reach: latest && latest.reach,
          watchTimeSeconds: latest && latest.watch_time_seconds, averageWatchSeconds: latest && latest.average_watch_seconds,
          viewsChange24h: latest ? metricDelta(latest, history, 'views', DAY_MS) : null,
          history: history.map(function (row) { return { at: row.captured_at, views: row.views }; })
        };
      });
      if (knownViews) totalViews += pieceViews;
      totalEngagements += pieceEngagement;
      rateEligibleEngagements += pieceRateEngagement;
      return {
        id: piece.id, title: clean(piece.title, 500) || 'Untitled', contentType: clean(piece.contentType, 80),
        postedAt: piece.postedAt || null, views: knownViews ? pieceViews : null, engagements: pieceEngagement,
        engagementRate: knownViews && pieceViews ? pieceRateEngagement / pieceViews * 100 : null, platforms: platforms
      };
    });

    const audience = PLATFORMS.map(function (platform) {
      const history = channelRows.filter(function (row) { return row.platform === platform; });
      const latest = history.length ? history[history.length - 1] : null;
      return {
        platform: platform, available: !!latest, followers: latest && latest.followers,
        followerChange7d: latest ? metricDelta(latest, history, 'followers', 7 * DAY_MS) : null,
        totalViews: latest && latest.total_views, mediaCount: latest && latest.media_count,
        capturedAt: latest && latest.captured_at,
        history: history.map(function (row) { return { at: row.captured_at, followers: row.followers }; })
      };
    });
    const knownFollowers = audience.filter(function (row) { return row.followers != null; });
    const state = db.prepare('SELECT * FROM content_analytics_state WHERE id=1').get();
    return {
      generatedAt: now().toISOString(), lastCollectedAt: state.last_collected_at,
      lastError: state.last_error, providerStatus: json(state.provider_status_json, {}),
      summary: {
        pieces: pieceRows.length, totalViews: totalViews, totalEngagements: totalEngagements,
        engagementRate: totalViews ? rateEligibleEngagements / totalViews * 100 : null,
        followers: knownFollowers.length ? knownFollowers.reduce(function (sum, row) { return sum + Number(row.followers || 0); }, 0) : null
      },
      viewHistory: overallViewHistory(metricRows, pieceRows, now()),
      audience: audience, pieces: pieceRows
    };
  }

  function runDue() {
    const state = db.prepare('SELECT last_attempt_at FROM content_analytics_state WHERE id=1').get();
    if (state.last_attempt_at && Date.now() - new Date(state.last_attempt_at).getTime() < intervalMs) return Promise.resolve(dashboard());
    return collect();
  }

  function commentAlerts() {
    const byId = new Map(listPieces().filter(relevantPiece).map(function (piece) { return [piece.id, piece]; }));
    return db.prepare('SELECT * FROM content_comment_watch WHERE pending_count > 0 ORDER BY first_unreviewed_at, platform').all()
      .map(function (watch) {
        const piece = byId.get(watch.piece_id);
        if (!piece) return null;
        return {
          pieceId: watch.piece_id, platform: watch.platform, title: clean(piece.title, 300) || 'Untitled',
          count: watch.pending_count, firstDetectedAt: watch.first_unreviewed_at,
          lastDetectedAt: watch.last_unreviewed_at, postUrl: platformUrl(piece, watch.platform)
        };
      }).filter(Boolean);
  }

  function markCommentsReviewed(pieceId, platform) {
    if (PLATFORMS.indexOf(platform) === -1) return false;
    return db.prepare(`UPDATE content_comment_watch SET pending_count=0,first_unreviewed_at=NULL,
      last_unreviewed_at=NULL WHERE piece_id=? AND platform=? AND pending_count>0`).run(pieceId, platform).changes > 0;
  }
  function start() {
    if (timer) return;
    timer = setInterval(function () { runDue().catch(function () {}); }, Math.min(intervalMs, 15 * 60 * 1000));
    if (timer.unref) timer.unref();
    setTimeout(function () { runDue().catch(function () {}); }, 10000).unref?.();
  }

  return { collect: collect, runDue: runDue, dashboard: dashboard, start: start,
    commentAlerts: commentAlerts, markCommentsReviewed: markCommentsReviewed };
}

module.exports = { setup: setup, PLATFORMS: PLATFORMS, hourBucket: hourBucket, relevantPiece: relevantPiece };
