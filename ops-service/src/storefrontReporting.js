'use strict';

const FUNNEL_STEPS = [
  'page_view', 'landing_page_view', 'purchase_cta_clicked',
  'checkout_cta_header_clicked', 'checkout_cta_primary_clicked', 'checkout_cta_final_clicked',
  'checkout_arrival_header', 'checkout_arrival_primary', 'checkout_arrival_final', 'checkout_view',
  'checkout_started', 'payment_submitted', 'order_complete', 'order_failed'
];

// Harvey's own pre-launch browsing through 13 October is excluded from the
// Content Studio Website Analytics dashboard, without deleting store records.
const WEBSITE_ANALYTICS_START_DAY = '2026-10-14';

function eventMap(rows) {
  const result = {};
  rows.forEach(function (row) {
    result[row.event_name] = { count: Number(row.count) || 0, unique_sessions: Number(row.unique_sessions) || 0 };
  });
  return result;
}

function percentage(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

const PAID_ORDER_SQL = `order_status != 'REFUNDED'
  AND (stripe_payment_status IN ('succeeded','paid')
    OR order_status IN ('PAYMENT_RECEIVED','BOOKVAULT_PENDING','BOOKVAULT_ACCEPTED','FULFILLMENT_RETRY','SHIPPED','COMPLETE'))`;

// records.getAll returns data/updated_at, not id. Decode the persisted ID
// rather than reading row.id (which silently leaves every exclusion inactive).
function idsFromExclusionRows(rows) {
  return (rows || []).map(function (row) {
    try { return JSON.parse(row.data).orderId; }
    catch (error) { return ''; }
  }).filter(function (id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id); });
}

function excludedOrderFilter(excludedIds) {
  const ids = Array.from(new Set(Array.from(excludedIds || []).filter(function (id) { return typeof id === 'string' && id; })));
  return { sql: ids.length ? ' AND id NOT IN (' + ids.map(function () { return '?'; }).join(',') + ')' : '', ids: ids };
}

// Use the same paid/non-refunded and owner-test exclusions for the new-sales
// badge as Sales Analytics uses for revenue and order totals.
function paidOrderIds(db, excludedIds) {
  const excluded = excludedOrderFilter(excludedIds);
  return db.prepare(`SELECT id FROM orders WHERE ${PAID_ORDER_SQL}${excluded.sql}
    ORDER BY created_at DESC, id DESC`).all(...excluded.ids).map(function (row) { return row.id; });
}

function salesTotals(db, start, end, excludedIds) {
  const excluded = excludedOrderFilter(excludedIds);
  const paid = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(quantity),0) AS units,
      COALESCE(SUM(total_price_cents),0) AS revenue_cents,
      COALESCE(AVG(total_price_cents),0) AS average_order_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND ${PAID_ORDER_SQL}${excluded.sql}
  `).get(start, end, ...excluded.ids);
  const refunds = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total_price_cents),0) AS value_cents
    FROM orders WHERE updated_at >= ? AND updated_at < ? AND order_status='REFUNDED'${excluded.sql}
  `).get(start, end, ...excluded.ids);
  return {
    paid_orders: Number(paid.orders) || 0,
    units: Number(paid.units) || 0,
    revenue_cents: Number(paid.revenue_cents) || 0,
    average_order_cents: Math.round(Number(paid.average_order_cents) || 0),
    refunded_orders: Number(refunds.orders) || 0,
    refunded_value_cents: Number(refunds.value_cents) || 0
  };
}

// Reads the storefront database through a read-only Docker bind mount. This
// keeps order/customer data inside the VPS and exposes only aggregate numbers
// to the weekly reporter—no public revenue endpoint and no copied credential.
function getPeriodReport(db, start, end, excludedIds) {
  const excluded = excludedOrderFilter(excludedIds);
  const events = eventMap(db.prepare(`
    SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT session_id) AS unique_sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? GROUP BY event_name
  `).all(start, end));
  const pageViews = events.page_view || { count: 0, unique_sessions: 0 };
  const landing = events.landing_page_view || { count: 0, unique_sessions: 0 };
  const checkout = events.checkout_view || { count: 0, unique_sessions: 0 };
  const completed = events.order_complete || { count: 0, unique_sessions: 0 };
  const sales = salesTotals(db, start, end, excluded.ids);
  const topSources = db.prepare(`SELECT utm_source AS label, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? AND utm_source IS NOT NULL AND utm_source != ''
    GROUP BY utm_source ORDER BY sessions DESC LIMIT 8`).all(start, end);
  const topCampaigns = db.prepare(`SELECT utm_campaign AS label, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? AND utm_campaign IS NOT NULL AND utm_campaign != ''
    GROUP BY utm_campaign ORDER BY sessions DESC LIMIT 8`).all(start, end);
  const countries = db.prepare(`SELECT country AS label, COUNT(*) AS orders, COALESCE(SUM(total_price_cents),0) AS revenue_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND ${PAID_ORDER_SQL}${excluded.sql}
    GROUP BY country ORDER BY orders DESC,revenue_cents DESC LIMIT 8`).all(start, end, ...excluded.ids);
  return {
    period: { start: start, end: end },
    website: {
      page_views: pageViews.count, unique_visitors: pageViews.unique_sessions,
      landing_visitors: landing.unique_sessions, checkout_visitors: checkout.unique_sessions,
      completed_order_sessions: completed.unique_sessions,
      landing_to_checkout_percent: percentage(checkout.unique_sessions, landing.unique_sessions),
      checkout_to_order_percent: percentage(completed.unique_sessions, checkout.unique_sessions),
      funnel: FUNNEL_STEPS.map(function (step) {
        return { step: step, count: events[step] ? events[step].count : 0, unique_sessions: events[step] ? events[step].unique_sessions : 0 };
      }),
      top_sources: topSources.map(function (row) { return { source: row.label, sessions: Number(row.sessions) || 0 }; }),
      top_campaigns: topCampaigns.map(function (row) { return { campaign: row.label, sessions: Number(row.sessions) || 0 }; })
    },
    sales: {
      paid_orders: sales.paid_orders, units: sales.units,
      revenue_cents: sales.revenue_cents,
      average_order_cents: sales.average_order_cents,
      refunded_orders: sales.refunded_orders, refunded_value_cents: sales.refunded_value_cents,
      countries: countries.map(function (row) {
        return { country: row.label, orders: Number(row.orders) || 0, revenue_cents: Number(row.revenue_cents) || 0 };
      })
    }
  };
}

function startOfUtcDay(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function getWebsiteAnalyticsSummary(db, nowValue) {
  const today = startOfUtcDay(nowValue || Date.now());
  const thirtyStart = new Date(today);
  thirtyStart.setUTCDate(thirtyStart.getUTCDate() - 29);
  const startDay = [thirtyStart.toISOString().slice(0, 10), WEBSITE_ANALYTICS_START_DAY].sort().at(-1);
  const startTime = startDay + 'T00:00:00.000Z';
  const todayTime = today.toISOString();
  const todayEvents = eventMap(db.prepare(`
    SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT session_id) AS unique_sessions
    FROM analytics_events WHERE verified_human = 1 AND created_at >= ?
    GROUP BY event_name
  `).all([todayTime, startTime].sort().at(-1)));
  const dailyEvents = eventMap(db.prepare(`
    SELECT event_name, SUM(event_count) AS count, SUM(verified_visits) AS unique_sessions
    FROM analytics_daily_events WHERE day >= ?
    GROUP BY event_name
  `).all(startDay));
  const rawEvents = eventMap(db.prepare(`
    SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT session_id) AS unique_sessions
    FROM analytics_events WHERE verified_human = 1 AND created_at >= ?
    GROUP BY event_name
  `).all(startTime));
  const events = {};
  for (const name of new Set([...Object.keys(dailyEvents), ...Object.keys(rawEvents)])) {
    events[name] = {
      count: (dailyEvents[name]?.count || 0) + (rawEvents[name]?.count || 0),
      unique_sessions: (dailyEvents[name]?.unique_sessions || 0) + (rawEvents[name]?.unique_sessions || 0)
    };
  }
  const sources = new Map();
  db.prepare(`SELECT utm_source, SUM(verified_visits) AS sessions
    FROM analytics_daily_utm_sources WHERE day >= ? GROUP BY utm_source`).all(startDay)
    .concat(db.prepare(`SELECT utm_source, COUNT(DISTINCT session_id) AS sessions
      FROM analytics_events WHERE verified_human = 1 AND created_at >= ?
        AND utm_source IS NOT NULL AND utm_source != '' GROUP BY utm_source`).all(startTime))
    .forEach(function (row) {
      sources.set(row.utm_source, (sources.get(row.utm_source) || 0) + Number(row.sessions || 0));
    });
  const excluded = db.prepare(`SELECT COUNT(*) AS count FROM analytics_events
    WHERE verified_human = 0 AND created_at >= ?`).get(thirtyStart.toISOString());
  return {
    excluded_before: WEBSITE_ANALYTICS_START_DAY,
    today: {
      page_views: todayEvents.page_view?.count || 0,
      unique_visitors: todayEvents.page_view?.unique_sessions || 0
    },
    last_30_days: {
      page_views: events.page_view?.count || 0,
      unique_visitors: events.page_view?.unique_sessions || 0
    },
    funnel: FUNNEL_STEPS.map(function (step) {
      return { step: step, count: events[step]?.count || 0, unique_sessions: events[step]?.unique_sessions || 0 };
    }),
    top_utm_sources: [...sources.entries()].map(function ([source, sessions]) {
      return { source: source, sessions: sessions };
    }).sort(function (a, b) { return b.sessions - a.sessions; }).slice(0, 10),
    excluded_unverified_events: Number(excluded.count) || 0,
    visitor_definition: 'A verified browser visit after real interaction or seven visible seconds. Individual event rows are reduced to anonymous daily totals; different browsers or days may represent the same person.'
  };
}

// The storefront compacts completed UTC days into analytics_daily_events,
// while the current day remains in analytics_events. Keep the two sources
// separate and show completed days only so a partial today cannot look like
// a traffic collapse beside yesterday's full count.
function getWebsiteTraffic(db, nowValue) {
  const today = startOfUtcDay(nowValue || Date.now());
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 30);
  const startDay = start.toISOString().slice(0, 10);
  const todayDay = today.toISOString().slice(0, 10);
  const dailyRows = db.prepare(`
    SELECT day, SUM(event_count) AS page_views
    FROM analytics_daily_events
    WHERE event_name = 'page_view' AND day >= ? AND day < ?
    GROUP BY day
  `).all([startDay, WEBSITE_ANALYTICS_START_DAY].sort().at(-1), todayDay);
  const rawRows = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS page_views
    FROM analytics_events
    WHERE event_name = 'page_view' AND verified_human = 1
      AND created_at >= ? AND created_at < ?
    GROUP BY substr(created_at, 1, 10)
  `).all([start.toISOString(), WEBSITE_ANALYTICS_START_DAY + 'T00:00:00.000Z'].sort().at(-1), today.toISOString());
  const counts = new Map();
  dailyRows.concat(rawRows).forEach(function (row) {
    counts.set(row.day, (counts.get(row.day) || 0) + Number(row.page_views || 0));
  });
  const lineDaily = Array.from({ length: 30 }, function (_, index) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { day: day, page_views: counts.get(day) || 0 };
  });
  return {
    timezone: 'UTC',
    excluded_before: WEBSITE_ANALYTICS_START_DAY,
    line_daily: lineDaily,
    daily: lineDaily.slice(-14),
    previous_7_days: lineDaily.slice(-14, -7).reduce(function (sum, row) { return sum + row.page_views; }, 0),
    last_7_days: lineDaily.slice(-7).reduce(function (sum, row) { return sum + row.page_views; }, 0)
  };
}

function fulfillmentIssueSummary(message) {
  const detail = String(message || '').toLowerCase();
  if (!detail.trim()) return '';
  const issues = [];
  if (/title.*inactive|inactive.*title/.test(detail)) issues.push('title inactive');
  if (/not have enough funds|insufficient funds/.test(detail)) issues.push('insufficient BookVault funds');
  if (/customs declaration/.test(detail)) issues.push('customs declaration missing');
  return issues.length ? 'BookVault: ' + issues.join(', ') : 'BookVault fulfillment failed';
}

// Private, admin-only dashboard data. Deliberately omits customer contact and
// address fields; the panel needs operational sales state, not a second copy
// of the customer database in the browser.
function getSalesDashboard(db, nowValue, excludedIds, unseenOrderIds) {
  const excluded = excludedOrderFilter(excludedIds);
  const now = new Date(nowValue || Date.now());
  const end = now.toISOString();
  const todayStart = startOfUtcDay(now);
  const sevenStart = new Date(todayStart); sevenStart.setUTCDate(sevenStart.getUTCDate() - 6);
  const thirtyStart = new Date(todayStart); thirtyStart.setUTCDate(thirtyStart.getUTCDate() - 29);
  const allStart = '1970-01-01T00:00:00.000Z';

  const dailyRows = db.prepare(`
    SELECT substr(created_at,1,10) AS day, COUNT(*) AS orders,
      COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(total_price_cents),0) AS revenue_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND ${PAID_ORDER_SQL}${excluded.sql}
    GROUP BY substr(created_at,1,10) ORDER BY day ASC
  `).all(thirtyStart.toISOString(), end, ...excluded.ids);
  const dailyMap = {};
  dailyRows.forEach(function (row) { dailyMap[row.day] = row; });
  const daily = [];
  for (let i = 0; i < 30; i += 1) {
    const day = new Date(thirtyStart); day.setUTCDate(day.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    const row = dailyMap[key] || {};
    daily.push({ day: key, orders: Number(row.orders) || 0, units: Number(row.units) || 0, revenue_cents: Number(row.revenue_cents) || 0 });
  }

  const countries = db.prepare(`
    SELECT country, COUNT(*) AS orders, COALESCE(SUM(quantity),0) AS units,
      COALESCE(SUM(total_price_cents),0) AS revenue_cents
    FROM orders WHERE ${PAID_ORDER_SQL}${excluded.sql}
    GROUP BY country ORDER BY revenue_cents DESC,orders DESC LIMIT 12
  `).all(...excluded.ids).map(function (row) {
    return { country: row.country || '—', orders: Number(row.orders) || 0, units: Number(row.units) || 0, revenue_cents: Number(row.revenue_cents) || 0 };
  });

  const recentOrderFields = `id, quantity, total_price_cents, currency, country, order_status,
      stripe_payment_status, shipping_service_name, bookvault_order_id,
      confirmation_email_sent_at, shipping_email_sent_at,
      resend_contact_synced_at, created_at, updated_at`;
  const newestRows = db.prepare(`
    SELECT ${recentOrderFields}
    FROM orders WHERE 1=1${excluded.sql} ORDER BY created_at DESC LIMIT 25
  `).all(...excluded.ids);
  const newestIds = new Set(newestRows.map(function (row) { return row.id; }));
  const olderUnseenIds = Array.from(new Set(unseenOrderIds || [])).filter(function (id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !newestIds.has(id);
  });
  const olderUnseenRows = olderUnseenIds.length ? db.prepare(`
    SELECT ${recentOrderFields} FROM orders
    WHERE id IN (${olderUnseenIds.map(function () { return '?'; }).join(',')})
      AND ${PAID_ORDER_SQL}${excluded.sql}
  `).all(...olderUnseenIds, ...excluded.ids) : [];
  const recentOrders = newestRows.concat(olderUnseenRows)
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })
    .map(function (row) {
    return {
      id: row.id,
      quantity: Number(row.quantity) || 0,
      total_price_cents: Number(row.total_price_cents) || 0,
      currency: row.currency || 'usd',
      country: row.country || '—',
      order_status: row.order_status,
      stripe_payment_status: row.stripe_payment_status,
      shipping_service_name: row.shipping_service_name,
      bookvault_order_id: row.bookvault_order_id,
      confirmation_email_sent: !!row.confirmation_email_sent_at,
      shipping_email_sent: !!row.shipping_email_sent_at,
      resend_contact_synced: !!row.resend_contact_synced_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    });

  const recentRefunds = db.prepare(`
    SELECT id, created_at, updated_at, country, total_price_cents, currency,
      fulfillment_last_error,
      (SELECT error_type FROM error_logs WHERE order_id = orders.id AND service = 'refund'
        ORDER BY created_at DESC LIMIT 1) AS refund_error_type
    FROM orders WHERE order_status = 'REFUNDED'${excluded.sql}
    ORDER BY updated_at DESC LIMIT 100
  `).all(...excluded.ids).map(function (row) {
    return {
      id: row.id,
      created_at: row.created_at,
      refunded_at: row.updated_at,
      country: row.country || '—',
      total_price_cents: Number(row.total_price_cents) || 0,
      currency: row.currency || 'usd',
      reason: row.refund_error_type === 'fulfillment_exhausted_refunded'
        ? 'Automatically refunded after BookVault could not fulfill the order.' : '',
      system_reason: row.refund_error_type === 'fulfillment_exhausted_refunded'
        ? 'Automatically refunded after BookVault could not fulfill the order.' : '',
      reason_source: row.refund_error_type === 'fulfillment_exhausted_refunded' ? 'automatic' : 'unrecorded',
      fulfillment_context: fulfillmentIssueSummary(row.fulfillment_last_error)
    };
  });

  const excludedOrders = excluded.ids.length ? db.prepare(`
    SELECT id, order_status, total_price_cents, currency, created_at
    FROM orders WHERE id IN (${excluded.ids.map(function () { return '?'; }).join(',')})
    ORDER BY created_at DESC
  `).all(...excluded.ids).map(function (row) {
    return {
      id: row.id, order_status: row.order_status,
      total_price_cents: Number(row.total_price_cents) || 0,
      currency: row.currency || 'usd', created_at: row.created_at
    };
  }) : [];

  return {
    generated_at: end,
    timezone: 'UTC',
    periods: {
      today: salesTotals(db, todayStart.toISOString(), end, excluded.ids),
      last_7_days: salesTotals(db, sevenStart.toISOString(), end, excluded.ids),
      last_30_days: salesTotals(db, thirtyStart.toISOString(), end, excluded.ids),
      all_time: salesTotals(db, allStart, end, excluded.ids)
    },
    daily: daily,
    countries: countries,
    recent_orders: recentOrders,
    recent_refunds: recentRefunds,
    excluded_orders: excludedOrders
  };
}

module.exports = {
  FUNNEL_STEPS: FUNNEL_STEPS,
  WEBSITE_ANALYTICS_START_DAY: WEBSITE_ANALYTICS_START_DAY,
  idsFromExclusionRows: idsFromExclusionRows,
  paidOrderIds: paidOrderIds,
  getPeriodReport: getPeriodReport,
  getWebsiteTraffic: getWebsiteTraffic,
  getWebsiteAnalyticsSummary: getWebsiteAnalyticsSummary,
  getSalesDashboard: getSalesDashboard
};
