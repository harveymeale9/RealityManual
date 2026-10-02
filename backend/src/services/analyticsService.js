const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO analytics_events (
    id, session_id, event_name, page, order_id, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, country,
    verified_human, verification_method, classification_reason
  ) VALUES (
    @id, @session_id, @event_name, @page, @order_id, @referrer,
    @utm_source, @utm_medium, @utm_campaign, @utm_term, @utm_content, @country,
    @verified_human, @verification_method, @classification_reason
  )
`);

// event_name/session_id are required; everything else is optional context
// the frontend may or may not have. Truncated defensively since this
// endpoint has no auth — see CLAUDE.md §46 ("relaxed security, do the
// basics") — a huge string here shouldn't be able to bloat the database.
const MAX_LEN = 500;
function clip(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

function recordEvent(input, classification = {}) {
  aggregateCompletedDays();
  insertStmt.run({
    id: uuidv4(),
    session_id: clip(input.session_id),
    event_name: clip(input.event_name),
    page: clip(input.page),
    // First-party statistics are never connected to an order/customer. The
    // separately consented advertising adapter handles purchase attribution.
    order_id: null,
    referrer: clip(input.referrer),
    utm_source: clip(input.utm_source),
    utm_medium: clip(input.utm_medium),
    utm_campaign: clip(input.utm_campaign),
    utm_term: clip(input.utm_term),
    utm_content: clip(input.utm_content),
    country: clip(input.country),
    verified_human: classification.verifiedHuman ? 1 : 0,
    verification_method: clip(classification.method),
    classification_reason: clip(classification.reason || 'unclassified'),
  });
}

const countsSinceStmt = db.prepare(`
  SELECT event_name, COUNT(*) AS n, COUNT(DISTINCT session_id) AS unique_sessions
  FROM analytics_events
  WHERE created_at >= ? AND verified_human = 1
  GROUP BY event_name
`);

const dailyCountsSinceStmt = db.prepare(`
  SELECT event_name, SUM(event_count) AS n, SUM(verified_visits) AS unique_sessions
  FROM analytics_daily_events
  WHERE day >= ?
  GROUP BY event_name
`);

const utmSourcesSinceStmt = db.prepare(`
  SELECT utm_source, COUNT(DISTINCT session_id) AS sessions
  FROM analytics_events
  WHERE created_at >= ? AND verified_human = 1
    AND utm_source IS NOT NULL AND utm_source != ''
  GROUP BY utm_source
  ORDER BY sessions DESC
  LIMIT 10
`);

const dailyUtmSourcesSinceStmt = db.prepare(`
  SELECT utm_source, SUM(verified_visits) AS sessions
  FROM analytics_daily_utm_sources
  WHERE day >= ?
  GROUP BY utm_source
`);

const excludedSinceStmt = db.prepare(`
  SELECT COUNT(*) AS n
  FROM analytics_events
  WHERE created_at >= ? AND verified_human = 0
`);

const completedEventDaysStmt = db.prepare(`
  SELECT substr(created_at, 1, 10) AS day, event_name,
         COUNT(*) AS event_count,
         COUNT(DISTINCT session_id) AS verified_visits
  FROM analytics_events
  WHERE verified_human = 1 AND created_at < ?
  GROUP BY day, event_name
`);

const completedUtmDaysStmt = db.prepare(`
  SELECT substr(created_at, 1, 10) AS day, utm_source,
         COUNT(DISTINCT session_id) AS verified_visits
  FROM analytics_events
  WHERE verified_human = 1 AND created_at < ?
    AND utm_source IS NOT NULL AND utm_source != ''
  GROUP BY day, utm_source
`);

const upsertDailyEventStmt = db.prepare(`
  INSERT INTO analytics_daily_events (day, event_name, event_count, verified_visits)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(day, event_name) DO UPDATE SET
    event_count = excluded.event_count,
    verified_visits = excluded.verified_visits
`);

const upsertDailyUtmStmt = db.prepare(`
  INSERT INTO analytics_daily_utm_sources (day, utm_source, verified_visits)
  VALUES (?, ?, ?)
  ON CONFLICT(day, utm_source) DO UPDATE SET
    verified_visits = excluded.verified_visits
`);

const deleteAggregatedEventsStmt = db.prepare(`
  DELETE FROM analytics_events WHERE verified_human = 1 AND created_at < ?
`);

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isoTodayStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function utcDayDaysAgo(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

let lastAggregatedCutoff = '';
function aggregateCompletedDays(force = false) {
  const cutoff = isoTodayStart();
  if (!force && lastAggregatedCutoff === cutoff) return;
  const eventRows = completedEventDaysStmt.all(cutoff);
  const utmRows = completedUtmDaysStmt.all(cutoff);

  db.exec('BEGIN IMMEDIATE');
  try {
    eventRows.forEach((row) => {
      upsertDailyEventStmt.run(row.day, row.event_name, row.event_count, row.verified_visits);
    });
    utmRows.forEach((row) => {
      upsertDailyUtmStmt.run(row.day, row.utm_source, row.verified_visits);
    });
    deleteAggregatedEventsStmt.run(cutoff);
    db.exec('COMMIT');
    lastAggregatedCutoff = cutoff;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function rowsToEventMap(rows) {
  const map = {};
  rows.forEach((row) => {
    map[row.event_name] = { count: row.n, unique_sessions: row.unique_sessions };
  });
  return map;
}

function mergeEventMaps(...maps) {
  const merged = {};
  maps.forEach((map) => {
    Object.entries(map).forEach(([eventName, value]) => {
      if (!merged[eventName]) merged[eventName] = { count: 0, unique_sessions: 0 };
      merged[eventName].count += Number(value.count) || 0;
      merged[eventName].unique_sessions += Number(value.unique_sessions) || 0;
    });
  });
  return merged;
}

// Deliberately generic (not a fixed list of columns) — reports whatever
// event names have actually been sent, so adding a new tracked event on
// the frontend doesn't require a backend change to show up here too.
function getSummary() {
  aggregateCompletedDays(true);
  const todayEvents = rowsToEventMap(countsSinceStmt.all(isoTodayStart()));
  const periodStartDay = utcDayDaysAgo(29);
  const last30Events = mergeEventMaps(
    rowsToEventMap(dailyCountsSinceStmt.all(periodStartDay)),
    rowsToEventMap(countsSinceStmt.all(periodStartDay + 'T00:00:00.000Z'))
  );
  const utmTotals = new Map();
  dailyUtmSourcesSinceStmt.all(periodStartDay)
    .concat(utmSourcesSinceStmt.all(periodStartDay + 'T00:00:00.000Z'))
    .forEach((row) => utmTotals.set(row.utm_source, (utmTotals.get(row.utm_source) || 0) + Number(row.sessions)));
  const topUtmSources = [...utmTotals.entries()]
    .map(([source, sessions]) => ({ source, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);
  const excluded = excludedSinceStmt.get(isoDaysAgo(30)).n;

  const funnelOrder = [
    'page_view',
    'landing_page_view',
    'purchase_cta_clicked',
    'checkout_view',
    'checkout_started',
    'payment_submitted',
    'order_complete',
    'order_failed',
  ];

  return {
    today: {
      page_views: todayEvents.page_view ? todayEvents.page_view.count : 0,
      unique_visitors: todayEvents.page_view ? todayEvents.page_view.unique_sessions : 0,
    },
    last_30_days: {
      page_views: last30Events.page_view ? last30Events.page_view.count : 0,
      unique_visitors: last30Events.page_view ? last30Events.page_view.unique_sessions : 0,
    },
    funnel: funnelOrder.map((step) => ({
      step,
      count: last30Events[step] ? last30Events[step].count : 0,
      unique_sessions: last30Events[step] ? last30Events[step].unique_sessions : 0,
    })),
    top_utm_sources: topUtmSources,
    excluded_unverified_events: excluded,
    visitor_definition: 'A verified browser visit after real interaction or seven visible seconds. Individual event rows are reduced to anonymous daily totals; different browsers or days may represent the same person.',
  };
}

aggregateCompletedDays();
const aggregationTimer = setInterval(aggregateCompletedDays, 60 * 60 * 1000);
aggregationTimer.unref();

module.exports = { recordEvent, getSummary, aggregateCompletedDays };
