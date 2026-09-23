'use strict';

const FUNNEL_STEPS = [
  'page_view', 'landing_page_view', 'purchase_cta_clicked', 'checkout_view',
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
  const sales = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(quantity),0) AS units,
      COALESCE(SUM(total_price_cents),0) AS revenue_cents,
      COALESCE(AVG(total_price_cents),0) AS average_order_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND order_status != 'REFUNDED'
      AND (stripe_payment_status IN ('succeeded','paid')
        OR order_status IN ('PAYMENT_RECEIVED','BOOKVAULT_PENDING','COMPLETE'))
  `).get(start, end);
  const refunds = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_price_cents),0) AS value_cents
    FROM orders WHERE updated_at >= ? AND updated_at < ? AND order_status='REFUNDED'`).get(start, end);
  const topSources = db.prepare(`SELECT utm_source AS label, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? AND utm_source IS NOT NULL AND utm_source != ''
    GROUP BY utm_source ORDER BY sessions DESC LIMIT 8`).all(start, end);
  const topCampaigns = db.prepare(`SELECT utm_campaign AS label, COUNT(DISTINCT session_id) AS sessions
    FROM analytics_events WHERE created_at >= ? AND created_at < ? AND utm_campaign IS NOT NULL AND utm_campaign != ''
    GROUP BY utm_campaign ORDER BY sessions DESC LIMIT 8`).all(start, end);
  const countries = db.prepare(`SELECT country AS label, COUNT(*) AS orders, COALESCE(SUM(total_price_cents),0) AS revenue_cents
    FROM orders WHERE created_at >= ? AND created_at < ? AND order_status != 'REFUNDED'
      AND (stripe_payment_status IN ('succeeded','paid')
        OR order_status IN ('PAYMENT_RECEIVED','BOOKVAULT_PENDING','COMPLETE'))
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
      paid_orders: Number(sales.orders) || 0, units: Number(sales.units) || 0,
      revenue_cents: Number(sales.revenue_cents) || 0,
      average_order_cents: Math.round(Number(sales.average_order_cents) || 0),
      refunded_orders: Number(refunds.orders) || 0, refunded_value_cents: Number(refunds.value_cents) || 0,
      countries: countries.map(function (row) {
        return { country: row.label, orders: Number(row.orders) || 0, revenue_cents: Number(row.revenue_cents) || 0 };
      })
    }
  };
}

module.exports = { FUNNEL_STEPS: FUNNEL_STEPS, getPeriodReport: getPeriodReport };
