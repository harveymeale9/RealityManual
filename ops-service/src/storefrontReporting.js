'use strict';

const FUNNEL_STEPS = [
  'page_view', 'landing_page_view', 'purchase_cta_clicked',
  'checkout_cta_header_clicked', 'checkout_cta_primary_clicked', 'checkout_cta_final_clicked',
  'checkout_arrival_header', 'checkout_arrival_primary', 'checkout_arrival_final', 'checkout_view',
  'checkout_started', 'payment_submitted', 'order_complete', 'order_failed'
];

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

function salesTotals(db, start, end) {
  const paid = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(quantity),0) AS units,
      COALESCE(SUM(total_price_cents),0) AS revenue_cents,
      COALESCE(AVG(total_price_cents),0) AS average_order_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND ${PAID_ORDER_SQL}
  `).get(start, end);
  const refunds = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total_price_cents),0) AS value_cents
    FROM orders WHERE updated_at >= ? AND updated_at < ? AND order_status='REFUNDED'
  `).get(start, end);
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
function getPeriodReport(db, start, end) {
  const events = eventMap(db.prepare(`
    SELECT event_name, COUNT(*) AS count, COUNT(DISTINCT session_id) AS unique_sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? GROUP BY event_name
  `).all(start, end));
  const pageViews = events.page_view || { count: 0, unique_sessions: 0 };
  const landing = events.landing_page_view || { count: 0, unique_sessions: 0 };
  const checkout = events.checkout_view || { count: 0, unique_sessions: 0 };
  const completed = events.order_complete || { count: 0, unique_sessions: 0 };
  const sales = salesTotals(db, start, end);
  const topSources = db.prepare(`SELECT utm_source AS label, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? AND utm_source IS NOT NULL AND utm_source != ''
    GROUP BY utm_source ORDER BY sessions DESC LIMIT 8`).all(start, end);
  const topCampaigns = db.prepare(`SELECT utm_campaign AS label, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? AND utm_campaign IS NOT NULL AND utm_campaign != ''
    GROUP BY utm_campaign ORDER BY sessions DESC LIMIT 8`).all(start, end);
  const countries = db.prepare(`SELECT country AS label, COUNT(*) AS orders, COALESCE(SUM(total_price_cents),0) AS revenue_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND ${PAID_ORDER_SQL}
    GROUP BY country ORDER BY orders DESC,revenue_cents DESC LIMIT 8`).all(start, end);
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

// The storefront compacts completed UTC days into analytics_daily_events,
// while the current day remains in analytics_events. Keep the two sources
// separate and show completed days only so a partial today cannot look like
// a traffic collapse beside yesterday's full count.
function getWebsiteTraffic(db, nowValue) {
  const today = startOfUtcDay(nowValue || Date.now());
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 14);
  const startDay = start.toISOString().slice(0, 10);
  const todayDay = today.toISOString().slice(0, 10);
  const dailyRows = db.prepare(`
    SELECT day, SUM(event_count) AS page_views
    FROM analytics_daily_events
    WHERE event_name = 'page_view' AND day >= ? AND day < ?
    GROUP BY day
  `).all(startDay, todayDay);
  const rawRows = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS page_views
    FROM analytics_events
    WHERE event_name = 'page_view' AND verified_human = 1
      AND created_at >= ? AND created_at < ?
    GROUP BY substr(created_at, 1, 10)
  `).all(start.toISOString(), today.toISOString());
  const counts = new Map();
  dailyRows.concat(rawRows).forEach(function (row) {
    counts.set(row.day, (counts.get(row.day) || 0) + Number(row.page_views || 0));
  });
  const daily = Array.from({ length: 14 }, function (_, index) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    return { day: day, page_views: counts.get(day) || 0 };
  });
  return {
    timezone: 'UTC',
    daily: daily,
    previous_7_days: daily.slice(0, 7).reduce(function (sum, row) { return sum + row.page_views; }, 0),
    last_7_days: daily.slice(7).reduce(function (sum, row) { return sum + row.page_views; }, 0)
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
function getSalesDashboard(db, nowValue) {
  const now = new Date(nowValue || Date.now());
  const end = now.toISOString();
  const todayStart = startOfUtcDay(now);
  const sevenStart = new Date(todayStart); sevenStart.setUTCDate(sevenStart.getUTCDate() - 6);
  const thirtyStart = new Date(todayStart); thirtyStart.setUTCDate(thirtyStart.getUTCDate() - 29);
  const allStart = '1970-01-01T00:00:00.000Z';

  const dailyRows = db.prepare(`
    SELECT substr(created_at,1,10) AS day, COUNT(*) AS orders,
      COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(total_price_cents),0) AS revenue_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND ${PAID_ORDER_SQL}
    GROUP BY substr(created_at,1,10) ORDER BY day ASC
  `).all(thirtyStart.toISOString(), end);
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
    FROM orders WHERE ${PAID_ORDER_SQL}
    GROUP BY country ORDER BY revenue_cents DESC,orders DESC LIMIT 12
  `).all().map(function (row) {
    return { country: row.country || '—', orders: Number(row.orders) || 0, units: Number(row.units) || 0, revenue_cents: Number(row.revenue_cents) || 0 };
  });

  const recentOrders = db.prepare(`
    SELECT id, quantity, total_price_cents, currency, country, order_status,
      stripe_payment_status, shipping_service_name, bookvault_order_id,
      confirmation_email_sent_at, shipping_email_sent_at,
      resend_contact_synced_at, created_at, updated_at
    FROM orders ORDER BY created_at DESC LIMIT 25
  `).all().map(function (row) {
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
    FROM orders WHERE order_status = 'REFUNDED'
    ORDER BY updated_at DESC LIMIT 100
  `).all().map(function (row) {
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

  return {
    generated_at: end,
    timezone: 'UTC',
    periods: {
      today: salesTotals(db, todayStart.toISOString(), end),
      last_7_days: salesTotals(db, sevenStart.toISOString(), end),
      last_30_days: salesTotals(db, thirtyStart.toISOString(), end),
      all_time: salesTotals(db, allStart, end)
    },
    daily: daily,
    countries: countries,
    recent_orders: recentOrders,
    recent_refunds: recentRefunds
  };
}

module.exports = {
  FUNNEL_STEPS: FUNNEL_STEPS,
  getPeriodReport: getPeriodReport,
  getWebsiteTraffic: getWebsiteTraffic,
  getSalesDashboard: getSalesDashboard
};
