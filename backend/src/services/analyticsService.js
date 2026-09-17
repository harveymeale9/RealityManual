const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO analytics_events (
    id, session_id, event_name, page, order_id, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, country
  ) VALUES (
    @id, @session_id, @event_name, @page, @order_id, @referrer,
    @utm_source, @utm_medium, @utm_campaign, @utm_term, @utm_content, @country
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

function recordEvent(input) {
  insertStmt.run({
    id: uuidv4(),
    session_id: clip(input.session_id),
    event_name: clip(input.event_name),
    page: clip(input.page),
    order_id: clip(input.order_id),
    referrer: clip(input.referrer),
    utm_source: clip(input.utm_source),
    utm_medium: clip(input.utm_medium),
    utm_campaign: clip(input.utm_campaign),
    utm_term: clip(input.utm_term),
    utm_content: clip(input.utm_content),
    country: clip(input.country),
  });
}

const countsSinceStmt = db.prepare(`
  SELECT event_name, COUNT(*) AS n, COUNT(DISTINCT session_id) AS unique_sessions
  FROM analytics_events
  WHERE created_at >= ?
  GROUP BY event_name
`);

const utmSourcesSinceStmt = db.prepare(`
  SELECT utm_source, COUNT(DISTINCT session_id) AS sessions
  FROM analytics_events
  WHERE created_at >= ? AND utm_source IS NOT NULL AND utm_source != ''
  GROUP BY utm_source
  ORDER BY sessions DESC
  LIMIT 10
`);

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isoTodayStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function rowsToEventMap(rows) {
  const map = {};
  rows.forEach((row) => {
    map[row.event_name] = { count: row.n, unique_sessions: row.unique_sessions };
  });
  return map;
}

// Deliberately generic (not a fixed list of columns) — reports whatever
// event names have actually been sent, so adding a new tracked event on
// the frontend doesn't require a backend change to show up here too.
function getSummary() {
  const todayEvents = rowsToEventMap(countsSinceStmt.all(isoTodayStart()));
  const last30Events = rowsToEventMap(countsSinceStmt.all(isoDaysAgo(30)));
  const topUtmSources = utmSourcesSinceStmt.all(isoDaysAgo(30));

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
    top_utm_sources: topUtmSources.map((r) => ({ source: r.utm_source, sessions: r.sessions })),
  };
}

module.exports = { recordEvent, getSummary };
