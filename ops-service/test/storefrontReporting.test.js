'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const reporting = require('../src/storefrontReporting');

test('storefront report aggregates traffic, funnel, paid sales and refunds without returning PII', function () {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE analytics_events(session_id TEXT,event_name TEXT,utm_source TEXT,utm_campaign TEXT,created_at TEXT);
    CREATE TABLE orders(order_status TEXT,stripe_payment_status TEXT,quantity INTEGER,total_price_cents INTEGER,country TEXT,created_at TEXT,updated_at TEXT);
  `);
  const event = db.prepare('INSERT INTO analytics_events VALUES (?,?,?,?,?)');
  event.run('a','page_view','tiktok','launch','2026-09-15T10:00:00.000Z');
  event.run('a','landing_page_view','tiktok','launch','2026-09-15T10:00:01.000Z');
  event.run('a','checkout_view','tiktok','launch','2026-09-15T10:01:00.000Z');
  event.run('a','order_complete','tiktok','launch','2026-09-15T10:02:00.000Z');
  event.run('b','page_view','','','2026-09-16T10:00:00.000Z');
  event.run('outside','page_view','other','','2026-09-22T00:00:00.000Z');
  const order = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?)');
  order.run('COMPLETE','succeeded',2,14200,'GB','2026-09-15T10:02:00.000Z','2026-09-15T10:02:00.000Z');
  order.run('REFUNDED','succeeded',1,7100,'US','2026-09-15T11:00:00.000Z','2026-09-16T11:00:00.000Z');
  order.run('PAYMENT_PENDING','requires_payment_method',1,7100,'US','2026-09-16T11:00:00.000Z','2026-09-16T11:00:00.000Z');
  const report = reporting.getPeriodReport(db, '2026-09-15T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
  assert.equal(report.website.page_views, 2);
  assert.equal(report.website.unique_visitors, 2);
  assert.equal(report.website.landing_to_checkout_percent, 100);
  assert.equal(report.website.checkout_to_order_percent, 100);
  assert.deepEqual(report.website.top_sources, [{ source: 'tiktok', sessions: 1 }]);
  assert.equal(report.sales.paid_orders, 1);
  assert.equal(report.sales.units, 2);
  assert.equal(report.sales.revenue_cents, 14200);
  assert.equal(report.sales.refunded_orders, 1);
  assert.deepEqual(report.sales.countries, [{ country: 'GB', orders: 1, revenue_cents: 14200 }]);
  assert.equal(JSON.stringify(report).includes('customer@example.com'), false);
  db.close();
});
