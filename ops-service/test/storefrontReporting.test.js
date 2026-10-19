'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const reporting = require('../src/storefrontReporting');

test('saved sales exclusions decode IDs from records.getAll data rows', function () {
  const rows = [
    { data: JSON.stringify({ orderId: 'owner-order-1' }), updated_at: '2026-10-19T00:00:00.000Z' },
    { data: '{broken' },
    { data: JSON.stringify({ orderId: 'bad id' }) }
  ];
  assert.deepEqual(reporting.idsFromExclusionRows(rows), ['owner-order-1']);
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /idsFromExclusionRows\(stmts\.getAll\.all\('salesExclusions'\)\)/);
});

test('website analytics shows refunds and one count per funnel row', function () {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(appSource, /order_refunded: 'Order refunded'/);
  assert.match(appSource, /last_30_days\.refunded_orders/);
  assert.match(appSource, /Refunds &amp; reasons/);
  assert.match(appSource, /View refunded orders and reasons in Sales Analytics/);
  assert.match(serverSource, /app\.put\('\/api\/reports\/refunds\/:id\/note', requireAuth/);
  assert.match(serverSource, /app\.put\('\/api\/reports\/sales-exclusions\/:id', requireAuth/);
  assert.match(serverSource, /app\.delete\('\/api\/reports\/sales-exclusions\/:id', requireAuth/);
  assert.match(appSource, /Exclude test order/);
  assert.match(appSource, /Restore to reporting/);
  assert.doesNotMatch(appSource, /f\.unique_sessions \+ ' visits'/);
});

test('website traffic chart combines compacted and live verified pageviews across two completed weeks', function () {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE analytics_daily_events(day TEXT,event_name TEXT,event_count INTEGER);
    CREATE TABLE analytics_events(created_at TEXT,event_name TEXT,verified_human INTEGER);
  `);
  const daily = db.prepare('INSERT INTO analytics_daily_events VALUES (?,?,?)');
  daily.run('2026-09-17', 'page_view', 500); // outside the 30-day line
  daily.run('2026-10-03', 'page_view', 99); // in the line, outside the 14-day bars
  daily.run('2026-10-05', 'page_view', 3);
  daily.run('2026-10-11', 'page_view', 4);
  daily.run('2026-10-12', 'page_view', 5);
  daily.run('2026-10-16', 'checkout_view', 100); // wrong event
  const event = db.prepare('INSERT INTO analytics_events VALUES (?,?,?)');
  event.run('2026-10-17T09:00:00.000Z', 'page_view', 1);
  event.run('2026-10-17T10:00:00.000Z', 'page_view', 0); // excluded bot
  event.run('2026-10-18T09:00:00.000Z', 'page_view', 1); // partial today
  const result = reporting.getWebsiteTraffic(db, '2026-10-18T12:00:00.000Z');
  assert.equal(result.daily.length, 14);
  assert.equal(result.line_daily.length, 30);
  assert.equal(result.line_daily[0].day, '2026-09-18');
  assert.equal(result.line_daily.find((row) => row.day === '2026-10-03').page_views, 99);
  assert.equal(result.line_daily.find((row) => row.day === '2026-09-17'), undefined);
  assert.equal(result.daily[0].day, '2026-10-04');
  assert.equal(result.daily[13].day, '2026-10-17');
  assert.equal(result.daily.find((row) => row.day === '2026-10-04').page_views, 0);
  assert.equal(result.daily.find((row) => row.day === '2026-10-17').page_views, 1);
  assert.equal(result.previous_7_days, 3);
  assert.equal(result.last_7_days, 10);
  assert.equal(JSON.stringify(result).includes('2026-10-18'), false);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(appSource, /website-traffic/);
  assert.match(appSource, /websiteTrafficHtml\(traffic\)/);
  assert.match(appSource, /class="website-line-path"/);
  assert.match(serverSource, /app\.get\('\/api\/reports\/website-traffic', requireAuth/);
  db.close();
});

test('storefront report aggregates traffic, funnel, paid sales and refunds without returning PII', function () {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE analytics_events(session_id TEXT,event_name TEXT,utm_source TEXT,utm_campaign TEXT,created_at TEXT);
    CREATE TABLE orders(order_status TEXT,stripe_payment_status TEXT,quantity INTEGER,total_price_cents INTEGER,country TEXT,created_at TEXT,updated_at TEXT);
  `);
  const event = db.prepare('INSERT INTO analytics_events VALUES (?,?,?,?,?)');
  event.run('a','page_view','tiktok','launch','2026-09-15T10:00:00.000Z');
  event.run('a','landing_page_view','tiktok','launch','2026-09-15T10:00:01.000Z');
  event.run('a','checkout_arrival_primary','tiktok','launch','2026-09-15T10:00:30.000Z');
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
  assert.equal(report.website.funnel.find(function (row) { return row.step === 'checkout_arrival_primary'; }).count, 1);
  assert.deepEqual(report.website.top_sources, [{ source: 'tiktok', sessions: 1 }]);
  assert.equal(report.sales.paid_orders, 1);
  assert.equal(report.sales.units, 2);
  assert.equal(report.sales.revenue_cents, 14200);
  assert.equal(report.sales.refunded_orders, 1);
  assert.deepEqual(report.sales.countries, [{ country: 'GB', orders: 1, revenue_cents: 14200 }]);
  assert.equal(JSON.stringify(report).includes('customer@example.com'), false);
  db.close();
});

test('sales dashboard returns live periods, a filled daily series and privacy-safe order state', function () {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orders(
      id TEXT, order_status TEXT, stripe_payment_status TEXT, quantity INTEGER,
      total_price_cents INTEGER, currency TEXT, country TEXT, shipping_service_name TEXT,
      bookvault_order_id TEXT, confirmation_email_sent_at TEXT, shipping_email_sent_at TEXT,
      resend_contact_synced_at TEXT, created_at TEXT, updated_at TEXT,
      customer_name TEXT, email TEXT, street1 TEXT, fulfillment_last_error TEXT
    );
    CREATE TABLE error_logs(order_id TEXT, service TEXT, error_type TEXT, created_at TEXT);
  `);
  const order = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  order.run('paid-1','BOOKVAULT_ACCEPTED','succeeded',2,14200,'usd','GB','Tracked','BV-1','2026-10-09T10:03:00.000Z',null,'2026-10-09T10:04:00.000Z','2026-10-09T10:00:00.000Z','2026-10-09T10:04:00.000Z','Private Person','private@example.com','Secret street',null);
  order.run('paid-2','SHIPPED','succeeded',1,7100,'usd','US','Standard','BV-2','2026-10-10T08:03:00.000Z','2026-10-10T09:00:00.000Z','2026-10-10T08:04:00.000Z','2026-10-10T08:00:00.000Z','2026-10-10T09:00:00.000Z','Private Person','private@example.com','Secret street',null);
  order.run('refund','REFUNDED','succeeded',1,7100,'usd','US','Standard',null,null,null,null,'2026-10-08T08:00:00.000Z','2026-10-10T09:30:00.000Z','Private Person','private@example.com','Secret street','Title inactive; insufficient funds; customs declaration required; private@example.com');
  order.run('pending','PAYMENT_PENDING','requires_payment_method',1,7100,'usd','US','Standard',null,null,null,null,'2026-10-10T09:00:00.000Z','2026-10-10T09:00:00.000Z','Private Person','private@example.com','Secret street',null);

  const dashboard = reporting.getSalesDashboard(db, '2026-10-10T12:00:00.000Z');
  assert.equal(dashboard.periods.today.paid_orders, 1);
  assert.equal(dashboard.periods.last_7_days.paid_orders, 2);
  assert.equal(dashboard.periods.last_7_days.revenue_cents, 21300);
  assert.equal(dashboard.periods.today.refunded_orders, 1);
  assert.equal(dashboard.daily.length, 30);
  assert.deepEqual(dashboard.countries[0], { country: 'GB', orders: 1, units: 2, revenue_cents: 14200 });
  assert.equal(dashboard.recent_orders.length, 4);
  assert.equal(dashboard.recent_orders[0].id, 'pending');
  assert.equal(dashboard.recent_orders[1].shipping_email_sent, true);
  assert.equal(dashboard.recent_refunds.length, 1);
  assert.equal(dashboard.recent_refunds[0].reason_source, 'unrecorded');
  assert.equal(dashboard.recent_refunds[0].fulfillment_context, 'BookVault: title inactive, insufficient BookVault funds, customs declaration missing');
  db.prepare('INSERT INTO error_logs VALUES (?,?,?,?)').run('refund','refund','fulfillment_exhausted_refunded','2026-10-10T09:30:00.000Z');
  assert.equal(reporting.getSalesDashboard(db, '2026-10-10T12:00:00.000Z').recent_refunds[0].reason_source, 'automatic');
  assert.equal(JSON.stringify(dashboard).includes('private@example.com'), false);
  assert.equal(JSON.stringify(dashboard).includes('Secret street'), false);
  db.close();
});

test('owner test-order exclusions remove paid and refunded orders from sales reporting but keep a reversible reference', function () {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE analytics_events(session_id TEXT,event_name TEXT,utm_source TEXT,utm_campaign TEXT,created_at TEXT);
    CREATE TABLE orders(
      id TEXT, order_status TEXT, stripe_payment_status TEXT, quantity INTEGER,
      total_price_cents INTEGER, currency TEXT, country TEXT, shipping_service_name TEXT,
      bookvault_order_id TEXT, confirmation_email_sent_at TEXT, shipping_email_sent_at TEXT,
      resend_contact_synced_at TEXT, created_at TEXT, updated_at TEXT,
      fulfillment_last_error TEXT
    );
    CREATE TABLE error_logs(order_id TEXT, service TEXT, error_type TEXT, created_at TEXT);
  `);
  const order = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  order.run('real-paid', 'BOOKVAULT_ACCEPTED', 'succeeded', 2, 15000, 'usd', 'US', null, null, null, null, null, '2026-10-13T08:00:00.000Z', '2026-10-13T08:00:00.000Z', null);
  order.run('owner-paid', 'BOOKVAULT_ACCEPTED', 'succeeded', 1, 8229, 'usd', 'TH', null, null, null, null, null, '2026-10-13T09:00:00.000Z', '2026-10-13T09:00:00.000Z', null);
  order.run('owner-refund', 'REFUNDED', 'succeeded', 1, 8229, 'usd', 'TH', null, null, null, null, null, '2026-10-13T07:00:00.000Z', '2026-10-13T10:00:00.000Z', null);
  const excluded = ['owner-paid', 'owner-refund'];
  const dashboard = reporting.getSalesDashboard(db, '2026-10-19T12:00:00.000Z', excluded);
  assert.equal(dashboard.periods.all_time.paid_orders, 1);
  assert.equal(dashboard.periods.all_time.revenue_cents, 15000);
  assert.equal(dashboard.periods.all_time.refunded_orders, 0);
  assert.equal(dashboard.periods.last_30_days.average_order_cents, 15000);
  assert.equal(dashboard.daily.find((row) => row.day === '2026-10-13').revenue_cents, 15000);
  assert.deepEqual(dashboard.countries.map((row) => row.country), ['US']);
  assert.deepEqual(dashboard.recent_orders.map((row) => row.id), ['real-paid']);
  assert.equal(dashboard.recent_refunds.length, 0);
  assert.deepEqual(dashboard.excluded_orders.map((row) => row.id), ['owner-paid', 'owner-refund']);
  const weekly = reporting.getPeriodReport(db, '2026-10-13T00:00:00.000Z', '2026-10-14T00:00:00.000Z', excluded);
  assert.equal(weekly.sales.paid_orders, 1);
  assert.equal(weekly.sales.refunded_orders, 0);
  assert.deepEqual(weekly.sales.countries.map((row) => row.country), ['US']);
  const restored = reporting.getSalesDashboard(db, '2026-10-19T12:00:00.000Z', ['owner-refund']);
  assert.equal(restored.periods.all_time.paid_orders, 2);
  assert.equal(restored.periods.all_time.revenue_cents, 23229);
  db.close();
});
