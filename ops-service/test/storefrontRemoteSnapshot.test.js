'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDatabase, setup } = require('../src/storefrontRemoteSnapshot');
const reporting = require('../src/storefrontReporting');

function snapshot() {
  return {
    generated_at: new Date().toISOString(),
    tables: {
      orders: [{
        id: 'order-1', country: 'US', quantity: 1, book_price_cents: 6500,
        shipping_price_cents: 1810, total_price_cents: 8310, currency: 'usd',
        stripe_payment_status: 'succeeded', stripe_livemode: 1,
        order_status: 'PAYMENT_RECEIVED',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
      analytics_events: [], analytics_daily_events: [], analytics_daily_utm_sources: [],
      analytics_daily_utm_landings: [], error_logs: [],
    },
  };
}

test('PII-free in-memory Worker snapshot supports existing sales and website reports', () => {
  const db = buildDatabase(snapshot());
  try {
    assert.equal(reporting.getSalesDashboard(db).periods.today.paid_orders, 1);
    assert.equal(reporting.getOrdersHealth(db).summary.awaiting_bookvault, 1);
    assert.equal(reporting.getWebsiteTraffic(db).last_7_days, 0);
    assert.equal(reporting.getWebsiteAnalyticsSummary(db).today.page_views, 0);
    assert.equal(reporting.getPeriodReport(db, '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z').sales.paid_orders, 1);
    assert.equal(db.prepare('PRAGMA database_list').all()[0].file, '');
  } finally { db.close(); }
});

test('website analytics exposes only safe mobile quote-state categories', () => {
  const data = snapshot();
  data.tables.analytics_events.push({ id: 'quote-1', session_id: 'synthetic-browser',
    event_name: 'checkout_quote_state', page: '/checkout.html', country: 'AU',
    verified_human: 1, classification_reason: 'stale_retry', created_at: new Date().toISOString() });
  const db = buildDatabase(data);
  try {
    const states = reporting.getWebsiteAnalyticsSummary(db).checkout_quote_states_24h;
    assert.equal(states.length, 1);
    assert.deepEqual(states[0], { state: 'stale_retry', country: 'AU', count: 1, shoppers: 1 });
  } finally { db.close(); }
});

test('remote report source fails closed when its snapshot is unavailable or stale', async () => {
  const source = setup({ url: 'https://example.test/report', accessToken: 'test-token', fetchImpl: async () => Response.json(snapshot()) });
  assert.throws(() => source.getDb(), /unavailable or stale/);
  await source.refresh();
  assert.equal(source.getDb().prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
});
