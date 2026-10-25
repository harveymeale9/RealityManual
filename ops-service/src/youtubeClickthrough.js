'use strict';

// Per-link landing attribution began on this date. Older first-touch/source-only
// aggregates cannot be assigned to a long-form video and must never become
// the numerator of a video-to-site rate.
const TRACKING_START_DAY = '2026-10-25';
const DAY_MS = 86400000;

function dayOf(value) { return String(value || '').slice(0, 10); }
function ratio(visits, views) { return views > 0 ? Math.round(visits / views * 10000) / 100 : null; }
function viewsPerVisit(visits, views) { return visits > 0 ? Math.round(views / visits * 10) / 10 : null; }

function report(storeDb, opsDb, pieces, nowValue) {
  const today = dayOf(new Date(nowValue || Date.now()).toISOString());
  const thirtyStart = dayOf(new Date(Date.parse(today + 'T00:00:00Z') - 29 * DAY_MS).toISOString());
  const start = thirtyStart > TRACKING_START_DAY ? thirtyStart : TRACKING_START_DAY;
  const eligible = new Map((pieces || []).filter(function (piece) {
    return piece && piece.contentType === 'longform' && piece.youtubeVideoId &&
      (piece.stage === 'live' || piece.postedAt) && Number.isInteger(Number(piece.seq)) && Number(piece.seq) > 0;
  }).map(function (piece) { return [String(Number(piece.seq)), piece]; }));
  const days = [];
  for (let stamp = Date.parse(start + 'T00:00:00Z'), end = Date.parse(today + 'T00:00:00Z'); stamp <= end; stamp += DAY_MS) {
    days.push({ day: dayOf(new Date(stamp).toISOString()), views: 0, visits: 0 });
  }
  const byDay = new Map(days.map(function (row) { return [row.day, row]; }));
  const snapshots = opsDb.prepare(`SELECT piece_id, captured_at, views FROM content_metric_snapshots
    WHERE platform='youtube' AND views IS NOT NULL AND captured_at < ? ORDER BY piece_id, captured_at`)
    .all(new Date(Date.parse(today + 'T00:00:00Z') + DAY_MS).toISOString());
  const byPiece = new Map();
  snapshots.forEach(function (row) {
    if (!byPiece.has(row.piece_id)) byPiece.set(row.piece_id, []);
    byPiece.get(row.piece_id).push(row);
  });
  const measured = new Set();
  eligible.forEach(function (piece, seq) {
    const history = byPiece.get(piece.id) || [];
    if (!history.length) return;
    measured.add(seq);
    const publishedDuringWindow = dayOf(piece.postedAt) >= start;
    const earlier = history.filter(function (row) { return dayOf(row.captured_at) < start; });
    let previous = publishedDuringWindow ? 0 : earlier.length ? Math.max(0, Number(earlier.at(-1).views)) : null;
    const lastByDay = new Map();
    history.forEach(function (row) {
      const day = dayOf(row.captured_at);
      if (day >= start && day <= today) lastByDay.set(day, Math.max(0, Number(row.views)));
    });
    days.forEach(function (row) {
      if (!lastByDay.has(row.day)) return;
      const current = lastByDay.get(row.day);
      // An older video's first post-start snapshot is a baseline, not a
      // fabricated day's worth of new views. New videos begin at zero.
      if (previous != null) row.views += Math.max(0, current - previous);
      previous = current;
    });
  });
  const hasLandingTable = !!storeDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='analytics_daily_utm_landings'").get();
  const completed = hasLandingTable ? storeDb.prepare(`SELECT day, utm_source, utm_medium, utm_campaign, utm_content,
    verified_visits AS visits FROM analytics_daily_utm_landings WHERE day >= ? AND day <= ?`).all(start, today) : [];
  const linkKey = function (row) { return JSON.stringify([row.day, row.utm_source, row.utm_medium, row.utm_campaign, row.utm_content]); };
  const compactedLinks = new Set(completed.map(linkKey));
  const current = storeDb.prepare(`SELECT substr(created_at,1,10) AS day, utm_source, utm_medium, utm_campaign,
    utm_content, COUNT(DISTINCT session_id) AS visits FROM analytics_events
    WHERE verified_human=1 AND event_name='utm_landing' AND created_at >= ? AND created_at < ?
    GROUP BY day, utm_source, utm_medium, utm_campaign, utm_content`)
    .all(start + 'T00:00:00.000Z', new Date(Date.parse(today + 'T00:00:00Z') + DAY_MS).toISOString());
  let unmeasuredVisits = 0;
  completed.concat(current.filter(function (row) { return !compactedLinks.has(linkKey(row)); })).forEach(function (row) {
    if (String(row.utm_source || '').toLowerCase() !== 'youtube' ||
        String(row.utm_medium || '').toLowerCase() !== 'video' ||
        String(row.utm_campaign || '').toLowerCase() !== 'longform') return;
    const content = String(row.utm_content || '');
    if (!/^\d{1,6}$/.test(content)) return;
    const seq = String(Number(content));
    if (!eligible.has(seq)) return;
    const count = Math.max(0, Number(row.visits) || 0);
    if (!measured.has(seq)) { unmeasuredVisits += count; return; }
    const day = byDay.get(row.day);
    if (day) day.visits += count;
  });
  let views = 0;
  let visits = 0;
  const daily = days.map(function (row, index) {
    views += row.views;
    visits += row.visits;
    const trailing = days.slice(Math.max(0, index - 6), index + 1);
    const rollingViews = trailing.reduce(function (sum, item) { return sum + item.views; }, 0);
    const rollingVisits = trailing.reduce(function (sum, item) { return sum + item.visits; }, 0);
    return Object.assign({}, row, { rolling_rate_percent: ratio(rollingVisits, rollingViews) });
  });
  return {
    period: { start, end: today }, views, visits,
    rate_percent: ratio(visits, views), views_per_visit: viewsPerVisit(visits, views),
    measured_videos: measured.size, unmeasured_visits: unmeasuredVisits, daily,
    definition: 'Verified, UTM-tagged website arrivals from individual YouTube long-form video links divided by measured new views on those same videos. One browser/link/UTC day counts once; these are visits, not raw YouTube click events. Earlier source-only traffic and profile/Shorts links are excluded. Older videos use their first tracking-window snapshot as a baseline.'
  };
}

module.exports = { report, TRACKING_START_DAY };
