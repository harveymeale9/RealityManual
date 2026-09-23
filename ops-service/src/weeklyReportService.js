'use strict';

const crypto = require('crypto');

const DAY_MS = 86400000;
const STAGE_LABELS = {
  archived: 'Archived', ideation: 'Rough Ideas', big_ideas: 'Big Ideas',
  outline_started: 'Outlines started', outline_completed: 'Outlines completed',
  filmed: 'Filmed', edited: 'Edited', uploaded: 'Uploaded', processed: 'Processing',
  final_check: 'Final Check', scheduled: 'Scheduled', live: 'Published'
};
const MILESTONE_STAGES = ['big_ideas', 'outline_started', 'outline_completed', 'filmed', 'edited', 'final_check', 'scheduled', 'live'];

function clean(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 100000); }
function json(value, fallback) { try { return JSON.parse(value); } catch (error) { return fallback; } }
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}
function money(cents) { return '$' + (Number(cents || 0) / 100).toFixed(2); }
function number(value) { return Number(value || 0).toLocaleString('en-US'); }
function percent(value) { return value == null ? '—' : Number(value).toFixed(1).replace(/\.0$/, '') + '%'; }

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).reduce(function (result, part) {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), weekday: parts.weekday
  };
}

function addCalendarDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function zonedTimeToUtc(parts, timeZone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const actual = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess -= represented - target;
  }
  return new Date(guess);
}

function duePeriod(nowValue, timeZone, sendHour) {
  const now = new Date(nowValue || Date.now());
  const local = zonedParts(now, timeZone);
  const weekdayIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[local.weekday];
  let monday = addCalendarDays(local, -weekdayIndex);
  let dueAt = zonedTimeToUtc(Object.assign({}, monday, { hour: sendHour }), timeZone);
  if (now < dueAt) {
    monday = addCalendarDays(monday, -7);
    dueAt = zonedTimeToUtc(Object.assign({}, monday, { hour: sendHour }), timeZone);
  }
  const end = zonedTimeToUtc(Object.assign({}, monday, { hour: 0 }), timeZone);
  const startMonday = addCalendarDays(monday, -7);
  const start = zonedTimeToUtc(Object.assign({}, startMonday, { hour: 0 }), timeZone);
  return { start: start.toISOString(), end: end.toISOString(), dueAt: dueAt.toISOString() };
}

function reportTitleDate(iso, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

function parsePieces(db) {
  return db.prepare("SELECT data,updated_at FROM records WHERE store_name='pieces'").all().map(function (row) {
    const piece = json(row.data, null);
    if (!piece || piece.createdBy === 'youtube-reviewer') return null;
    piece._dbUpdatedAt = row.updated_at;
    return piece;
  }).filter(Boolean);
}

function setup(db, options) {
  options = options || {};
  const recipient = clean(options.recipient || 'harveymeale9@gmail.com', 500);
  const timeZone = options.timeZone || 'Europe/London';
  const sendHour = Number.isInteger(options.sendHour) ? options.sendHour : 9;
  const intervalMs = Number(options.intervalMs) || 15 * 60 * 1000;
  const sendMail = options.sendMail;
  const fetchStorefrontReport = options.fetchStorefrontReport;
  const fetchYoutubeStatistics = options.fetchYoutubeStatistics || (async function () { return []; });
  const enabled = options.enabled !== false && !!recipient && typeof sendMail === 'function' && typeof fetchStorefrontReport === 'function';

  db.exec(`
    CREATE TABLE IF NOT EXISTS piece_stage_events (
      id TEXT PRIMARY KEY, piece_id TEXT NOT NULL, title TEXT NOT NULL,
      content_type TEXT, from_stage TEXT, to_stage TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'live', event_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_piece_stage_events_date ON piece_stage_events(event_at);
    CREATE INDEX IF NOT EXISTS idx_piece_stage_events_piece ON piece_stage_events(piece_id,event_at);
    CREATE TABLE IF NOT EXISTS weekly_report_runs (
      id TEXT PRIMARY KEY, recipient TEXT NOT NULL, period_start TEXT NOT NULL,
      period_end TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, metrics_json TEXT NOT NULL DEFAULT '{}',
      message_id TEXT, last_error TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, sent_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_report_period_recipient
      ON weekly_report_runs(recipient,period_start,period_end);
  `);

  const eventCount = db.prepare('SELECT count(*) AS n FROM piece_stage_events').get().n;
  if (!eventCount) {
    const insertBootstrap = db.prepare(`INSERT INTO piece_stage_events
      (id,piece_id,title,content_type,from_stage,to_stage,source,event_at) VALUES (?,?,?,?,?,?,?,?)`);
    db.transaction(function () {
      parsePieces(db).forEach(function (piece) {
        if (!piece.stage) return;
        const stamp = piece.stage === 'live' && piece.postedAt
          ? piece.postedAt : (piece.updatedAt || piece.createdAt || piece._dbUpdatedAt);
        if (!stamp || !Number.isFinite(new Date(stamp).getTime())) return;
        insertBootstrap.run(crypto.randomUUID(), piece.id, clean(piece.title, 500) || 'Untitled', clean(piece.contentType, 80) || null,
          null, piece.stage, 'bootstrap', new Date(stamp).toISOString());
      });
    })();
  }

  function recordStageChange(piece, fromStage, source, stamp) {
    if (!piece || !piece.id || !piece.stage || piece.stage === fromStage || piece.createdBy === 'youtube-reviewer') return false;
    db.prepare(`INSERT INTO piece_stage_events
      (id,piece_id,title,content_type,from_stage,to_stage,source,event_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), piece.id, clean(piece.title, 500) || 'Untitled', clean(piece.contentType, 80) || null,
        clean(fromStage, 80) || null, clean(piece.stage, 80), clean(source, 80) || 'live', stamp || new Date().toISOString());
    return true;
  }

  function contentMetrics(start, end) {
    const pieces = parsePieces(db);
    const events = db.prepare(`SELECT * FROM piece_stage_events
      WHERE event_at >= ? AND event_at < ? ORDER BY event_at ASC`).all(start, end);
    const milestones = {};
    MILESTONE_STAGES.forEach(function (stage) { milestones[stage] = 0; });
    events.forEach(function (event) {
      if (Object.prototype.hasOwnProperty.call(milestones, event.to_stage)) milestones[event.to_stage]++;
    });
    const pipeline = {};
    pieces.forEach(function (piece) { pipeline[piece.stage || 'unassigned'] = (pipeline[piece.stage || 'unassigned'] || 0) + 1; });
    const created = pieces.filter(function (piece) {
      const stamp = new Date(piece.createdAt || 0).getTime();
      return stamp >= new Date(start).getTime() && stamp < new Date(end).getTime();
    });
    const updated = pieces.filter(function (piece) {
      const stamp = new Date(piece.updatedAt || piece._dbUpdatedAt || 0).getTime();
      return stamp >= new Date(start).getTime() && stamp < new Date(end).getTime();
    });
    const published = pieces.filter(function (piece) {
      const stamp = new Date(piece.postedAt || 0).getTime();
      return stamp >= new Date(start).getTime() && stamp < new Date(end).getTime();
    });
    return {
      pieces: pieces,
      created: created.length,
      actively_updated: updated.length,
      milestones: milestones,
      milestone_details: events.filter(function (event) { return MILESTONE_STAGES.indexOf(event.to_stage) !== -1; }).map(function (event) {
        return { title: event.title, stage: event.to_stage, contentType: event.content_type || '', at: event.event_at };
      }),
      pipeline: pipeline,
      published: published.map(function (piece) {
        return { id: piece.id, title: piece.title || 'Untitled', contentType: piece.contentType || '', platforms: piece.platforms || [], postedAt: piece.postedAt };
      })
    };
  }

  function previousVideoSnapshot(periodStart) {
    const row = db.prepare(`SELECT metrics_json FROM weekly_report_runs
      WHERE recipient=? AND status='sent' AND period_end<=?
      ORDER BY period_end DESC LIMIT 1`).get(recipient, periodStart);
    const metrics = row ? json(row.metrics_json, {}) : {};
    return metrics.video && metrics.video.youtube ? metrics.video.youtube.by_id || {} : {};
  }

  async function collect(period) {
    const previousStart = new Date(new Date(period.start).getTime() - 7 * DAY_MS).toISOString();
    const currentStorefront = await fetchStorefrontReport(period.start, period.end);
    const previousStorefront = await fetchStorefrontReport(previousStart, period.start);
    const content = contentMetrics(period.start, period.end);
    let youtube = { available: true, totals: { views: 0, likes: 0, comments: 0, view_gain: 0 }, videos: [], by_id: {} };
    try {
      const stats = await fetchYoutubeStatistics(content.pieces);
      const prior = previousVideoSnapshot(period.start);
      stats.forEach(function (video) {
        const before = prior[video.id];
        const publishedThisPeriod = video.publishedAt && new Date(video.publishedAt) >= new Date(period.start) && new Date(video.publishedAt) < new Date(period.end);
        video.viewGain = before
          ? Math.max(0, Number(video.views || 0) - Number(before.views || 0))
          : (publishedThisPeriod ? Number(video.views || 0) : 0);
        youtube.totals.views += Number(video.views || 0);
        youtube.totals.likes += Number(video.likes || 0);
        youtube.totals.comments += Number(video.comments || 0);
        youtube.totals.view_gain += video.viewGain;
        youtube.by_id[video.id] = { views: Number(video.views || 0), likes: Number(video.likes || 0), comments: Number(video.comments || 0), title: video.title };
      });
      youtube.videos = stats.sort(function (a, b) { return b.viewGain - a.viewGain || b.views - a.views; });
    } catch (error) {
      youtube = { available: false, error: clean(error.message, 300), totals: { views: 0, likes: 0, comments: 0, view_gain: 0 }, videos: [], by_id: {} };
    }
    return {
      period: { start: period.start, end: period.end },
      storefront: currentStorefront,
      previous_storefront: previousStorefront,
      content: content,
      video: {
        youtube: youtube,
        tiktok: {
          published_this_week: content.published.filter(function (piece) { return piece.platforms.indexOf('tiktok') !== -1; }).length,
          total_published: content.pieces.filter(function (piece) { return !!piece.tiktokPublishId; }).length,
          engagement_available: false
        }
      }
    };
  }

  function delta(current, previous) {
    current = Number(current || 0); previous = Number(previous || 0);
    if (!previous) return current ? 'new' : 'flat';
    const value = Math.round(((current - previous) / previous) * 100);
    return (value > 0 ? '+' : '') + value + '%';
  }

  function buildEmail(metrics) {
    const current = metrics.storefront;
    const previous = metrics.previous_storefront;
    const website = current.website;
    const sales = current.sales;
    const content = metrics.content;
    const youtube = metrics.video.youtube;
    const startLabel = reportTitleDate(metrics.period.start, timeZone);
    const endLabel = reportTitleDate(new Date(new Date(metrics.period.end).getTime() - 1).toISOString(), timeZone);
    const subject = 'Reality Manual Weekly Report · ' + startLabel + '–' + endLabel;
    const milestoneRows = MILESTONE_STAGES.map(function (stage) {
      return '<tr><td>' + escapeHtml(STAGE_LABELS[stage]) + '</td><td>' + number(content.milestones[stage]) + '</td></tr>';
    }).join('');
    const pipelineRows = Object.keys(content.pipeline).sort().map(function (stage) {
      return '<tr><td>' + escapeHtml(STAGE_LABELS[stage] || stage) + '</td><td>' + number(content.pipeline[stage]) + '</td></tr>';
    }).join('');
    const sourceRows = website.top_sources.length ? website.top_sources.map(function (item) {
      return '<tr><td>' + escapeHtml(item.source) + '</td><td>' + number(item.sessions) + ' sessions</td></tr>';
    }).join('') : '<tr><td colspan="2">No UTM-tagged traffic this week.</td></tr>';
    const publishedRows = content.published.length ? content.published.map(function (piece) {
      return '<li><strong>' + escapeHtml(piece.title) + '</strong>' + (piece.platforms.length ? ' · ' + escapeHtml(piece.platforms.join(', ')) : '') + '</li>';
    }).join('') : '<li>No pieces published this week.</li>';
    const milestoneDetails = content.milestone_details.length ? content.milestone_details.slice(0, 20).map(function (item) {
      return '<li><strong>' + escapeHtml(item.title) + '</strong> → ' + escapeHtml(STAGE_LABELS[item.stage] || item.stage) + '</li>';
    }).join('') : '<li>No recorded milestone changes this week.</li>';
    const youtubeRows = youtube.videos.length ? youtube.videos.slice(0, 8).map(function (video) {
      return '<tr><td>' + escapeHtml(video.title) + '</td><td>' + number(video.viewGain) + '</td><td>' + number(video.views) + '</td><td>' + number(video.likes) + '</td><td>' + number(video.comments) + '</td></tr>';
    }).join('') : '<tr><td colspan="5">No connected YouTube videos to measure yet.</td></tr>';
    const html = '<!doctype html><html><body style="margin:0;background:#f3f0e8;color:#172019;font-family:Arial,sans-serif">' +
      '<div style="max-width:760px;margin:0 auto;padding:32px 18px"><div style="background:#07110b;color:#eef8ef;padding:28px;border-radius:12px 12px 0 0">' +
      '<div style="font:12px monospace;letter-spacing:2px;color:#56f39a">REALITY MANUAL</div><h1 style="margin:10px 0 5px;font:28px Georgia,serif">Weekly Performance Report</h1><div style="color:#a9beb0">' + startLabel + ' – ' + endLabel + '</div></div>' +
      '<div style="background:#fff;padding:28px;border:1px solid #d9ded8;border-top:0">' +
      '<h2 style="font:22px Georgia,serif">At a glance</h2><table style="width:100%;border-collapse:collapse"><tr>' +
      '<td style="padding:14px;border:1px solid #dfe5df"><strong style="font-size:24px">' + number(website.unique_visitors) + '</strong><br>unique visitors<br><small>' + delta(website.unique_visitors, previous.website.unique_visitors) + ' vs prior week</small></td>' +
      '<td style="padding:14px;border:1px solid #dfe5df"><strong style="font-size:24px">' + money(sales.revenue_cents) + '</strong><br>revenue<br><small>' + number(sales.paid_orders) + ' paid orders</small></td>' +
      '<td style="padding:14px;border:1px solid #dfe5df"><strong style="font-size:24px">' + number(content.milestones.outline_completed) + '</strong><br>outlines completed</td>' +
      '<td style="padding:14px;border:1px solid #dfe5df"><strong style="font-size:24px">' + number(content.milestones.live) + '</strong><br>pieces published</td></tr></table>' +
      '<h2 style="font:22px Georgia,serif;margin-top:30px">Website and funnel</h2><p>' + number(website.page_views) + ' page views from ' + number(website.unique_visitors) + ' visitors. Landing → checkout: <strong>' + percent(website.landing_to_checkout_percent) + '</strong>. Checkout → completed order: <strong>' + percent(website.checkout_to_order_percent) + '</strong>.</p>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Top source</th><th style="text-align:right">Traffic</th></tr></thead><tbody>' + sourceRows + '</tbody></table>' +
      '<h2 style="font:22px Georgia,serif;margin-top:30px">Sales</h2><p><strong>' + number(sales.paid_orders) + '</strong> paid orders · <strong>' + number(sales.units) + '</strong> books · <strong>' + money(sales.revenue_cents) + '</strong> gross revenue · <strong>' + money(sales.average_order_cents) + '</strong> average order value · <strong>' + number(sales.refunded_orders) + '</strong> refunds.</p>' +
      '<h2 style="font:22px Georgia,serif;margin-top:30px">Content completed</h2><p>' + number(content.created) + ' new cards created and ' + number(content.actively_updated) + ' pieces actively worked on.</p><table style="width:100%;border-collapse:collapse"><tbody>' + milestoneRows + '</tbody></table>' +
      '<h3 style="font:18px Georgia,serif">Milestone movement</h3><ul>' + milestoneDetails + '</ul>' +
      '<h3 style="font:18px Georgia,serif">Published this week</h3><ul>' + publishedRows + '</ul>' +
      '<h2 style="font:22px Georgia,serif;margin-top:30px">Video performance</h2><p>YouTube: <strong>' + number(youtube.totals.view_gain) + '</strong> measured views gained this week; ' + number(youtube.totals.views) + ' lifetime views, ' + number(youtube.totals.likes) + ' likes and ' + number(youtube.totals.comments) + ' comments across connected videos.</p>' +
      '<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Video</th><th>New views</th><th>Total</th><th>Likes</th><th>Comments</th></tr></thead><tbody>' + youtubeRows + '</tbody></table>' +
      '<p style="color:#67736a;font-size:13px">TikTok: ' + number(metrics.video.tiktok.published_this_week) + ' published this week, ' + number(metrics.video.tiktok.total_published) + ' connected publication(s) total. TikTok engagement metrics are not exposed by the account’s current publish-only API scope.</p>' +
      '<h2 style="font:22px Georgia,serif;margin-top:30px">Pipeline now</h2><table style="width:100%;border-collapse:collapse"><tbody>' + pipelineRows + '</tbody></table>' +
      '<p style="margin-top:30px;color:#67736a;font-size:12px">Automatically generated from Content Studio, first-party website analytics, order records, and connected platform data.</p>' +
      '</div></div></body></html>';
    const text = [
      'REALITY MANUAL — WEEKLY PERFORMANCE REPORT', startLabel + ' – ' + endLabel, '',
      'AT A GLANCE', number(website.unique_visitors) + ' unique visitors (' + delta(website.unique_visitors, previous.website.unique_visitors) + ' vs prior week)',
      money(sales.revenue_cents) + ' revenue from ' + number(sales.paid_orders) + ' paid orders',
      number(content.milestones.outline_completed) + ' outlines completed', number(content.milestones.live) + ' pieces published', '',
      'WEBSITE', number(website.page_views) + ' page views', 'Landing → checkout: ' + percent(website.landing_to_checkout_percent), 'Checkout → order: ' + percent(website.checkout_to_order_percent), '',
      'SALES', number(sales.units) + ' books', money(sales.average_order_cents) + ' average order value', number(sales.refunded_orders) + ' refunds', '',
      'CONTENT', number(content.created) + ' new cards', number(content.actively_updated) + ' pieces worked on',
      MILESTONE_STAGES.map(function (stage) { return STAGE_LABELS[stage] + ': ' + number(content.milestones[stage]); }).join('\n'), '',
      'VIDEO', 'YouTube views gained: ' + number(youtube.totals.view_gain), 'YouTube lifetime views: ' + number(youtube.totals.views),
      'TikTok publications this week: ' + number(metrics.video.tiktok.published_this_week), '',
      'Generated automatically by Reality Manual Content Studio.'
    ].join('\n');
    return { subject: subject, htmlBody: html, textBody: text };
  }

  async function runDue(nowValue) {
    if (!enabled) return { enabled: false, skipped: 'not_configured' };
    const period = duePeriod(nowValue || Date.now(), timeZone, sendHour);
    const existing = db.prepare('SELECT * FROM weekly_report_runs WHERE recipient=? AND period_start=? AND period_end=?').get(recipient, period.start, period.end);
    if (existing && existing.status === 'sent') return { enabled: true, skipped: 'already_sent', period: period, sentAt: existing.sent_at };
    if (existing && existing.status === 'running' && Date.now() - new Date(existing.updated_at).getTime() < 30 * 60 * 1000) {
      return { enabled: true, skipped: 'already_running', period: period };
    }
    const stamp = new Date().toISOString();
    const id = existing ? existing.id : crypto.randomUUID();
    db.prepare(`INSERT INTO weekly_report_runs
      (id,recipient,period_start,period_end,due_at,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,'running',1,?,?)
      ON CONFLICT(recipient,period_start,period_end) DO UPDATE SET
        status='running',attempts=weekly_report_runs.attempts+1,last_error=NULL,updated_at=excluded.updated_at`)
      .run(id, recipient, period.start, period.end, period.dueAt, stamp, stamp);
    try {
      const metrics = await collect(period);
      const email = buildEmail(metrics);
      const message = await sendMail({
        to: [recipient], cc: [], subject: email.subject,
        textBody: email.textBody, htmlBody: email.htmlBody
      });
      const sentAt = new Date().toISOString();
      db.prepare(`UPDATE weekly_report_runs SET status='sent',metrics_json=?,message_id=?,sent_at=?,updated_at=? WHERE id=?`)
        .run(JSON.stringify(metrics), clean(message && (message.internetMessageId || message.id), 500) || null, sentAt, sentAt, id);
      return { enabled: true, sent: true, period: period, recipient: recipient, sentAt: sentAt };
    } catch (error) {
      const failedAt = new Date().toISOString();
      db.prepare("UPDATE weekly_report_runs SET status='error',last_error=?,updated_at=? WHERE id=?")
        .run(clean(error.message, 1000), failedAt, id);
      throw error;
    }
  }

  function status(nowValue) {
    const period = duePeriod(nowValue || Date.now(), timeZone, sendHour);
    const latest = db.prepare('SELECT recipient,period_start,period_end,due_at,status,attempts,sent_at,last_error FROM weekly_report_runs ORDER BY period_end DESC LIMIT 1').get();
    return { enabled: enabled, recipient: recipient, timeZone: timeZone, sendHour: sendHour, currentDuePeriod: period, latest: latest || null };
  }

  let timer = null;
  if (enabled && options.autoStart !== false) {
    setImmediate(function () { runDue().catch(function (error) { console.error('[weekly-report] send failed:', error.message); }); });
    timer = setInterval(function () { runDue().catch(function (error) { console.error('[weekly-report] send failed:', error.message); }); }, intervalMs);
    if (timer.unref) timer.unref();
  }

  return {
    enabled: enabled, recipient: recipient, timeZone: timeZone, sendHour: sendHour,
    recordStageChange: recordStageChange, collect: collect, buildEmail: buildEmail,
    runDue: runDue, status: status, duePeriod: duePeriod,
    close: function () { if (timer) clearInterval(timer); }
  };
}

module.exports = { setup: setup, duePeriod: duePeriod, zonedTimeToUtc: zonedTimeToUtc, STAGE_LABELS: STAGE_LABELS, MILESTONE_STAGES: MILESTONE_STAGES };
