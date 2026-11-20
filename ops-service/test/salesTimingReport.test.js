'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const reporting = require('../src/storefrontReporting');

test('hourly comparison uses paid time, excludes refunds/tests, and marks observed long-form growth', function () {
  const store = new Database(':memory:');
  const ops = new Database(':memory:');
  store.exec(`CREATE TABLE orders (id TEXT,created_at TEXT,payment_received_at TEXT,country TEXT,
    order_status TEXT,stripe_payment_status TEXT)`);
  ops.exec(`CREATE TABLE content_metric_snapshots (piece_id TEXT,platform TEXT,captured_at TEXT,views INTEGER)`);
  const order = store.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)');
  order.run('paid-us', '2026-11-19T18:05:00.000Z', '2026-11-19T19:04:00.000Z', 'US', 'BOOKVAULT_PENDING', 'succeeded');
  order.run('paid-gb', '2026-11-19T19:20:00.000Z', null, 'GB', 'BOOKVAULT_ACCEPTED', 'succeeded');
  order.run('refunded', '2026-11-19T19:30:00.000Z', null, 'US', 'REFUNDED', 'succeeded');
  order.run('owner-test', '2026-11-19T19:35:00.000Z', null, 'US', 'BOOKVAULT_ACCEPTED', 'succeeded');
  order.run('unpaid', '2026-11-19T19:40:00.000Z', null, 'US', 'FAILED', 'requires_payment_method');
  const metric = ops.prepare('INSERT INTO content_metric_snapshots VALUES (?,?,?,?)');
  metric.run('long', 'youtube', '2026-11-19T15:00:00.000Z', 10); // baseline, not ten new views
  metric.run('long', 'youtube', '2026-11-19T16:00:00.000Z', 20);
  metric.run('long', 'youtube', '2026-11-19T17:00:00.000Z', 18); // counter correction
  metric.run('long', 'youtube', '2026-11-19T18:00:00.000Z', 25); // only five new views
  metric.run('short', 'youtube', '2026-11-19T16:00:00.000Z', 9999);
  const pieces = [
    { id: 'long', title: 'The long film', contentType: 'longform', youtubeVideoId: 'abc123',
      scheduledAt: '2026-11-19T15:30:00.000Z' },
    { id: 'short', title: 'The Short', contentType: 'long_short', youtubeVideoId: 'xyz123',
      scheduledAt: '2026-11-19T15:00:00.000Z' }
  ];
  const report = reporting.getHourlySalesTiming(store, ops, pieces, '2026-11-20T06:30:00.000Z', ['owner-test'], 3);
  assert.equal(report.start_at, '2026-11-17T17:00:00.000Z');
  assert.equal(report.hourly.length, 62);
  assert.deepEqual(report.totals, { orders: 2, us_orders: 1, measured_views: 15 });
  assert.equal(report.hourly.find((bin) => bin.at === '2026-11-19T19:00:00.000Z').orders, 2);
  assert.equal(report.hourly.find((bin) => bin.at === '2026-11-19T19:00:00.000Z').us_orders, 1);
  assert.equal(report.hourly.find((bin) => bin.at === '2026-11-19T15:00:00.000Z').views, null);
  assert.equal(report.hourly.find((bin) => bin.at === '2026-11-19T16:00:00.000Z').views, 10);
  assert.equal(report.hourly.find((bin) => bin.at === '2026-11-19T18:00:00.000Z').views, 5);
  assert.equal(report.hourly.find((bin) => bin.at === '2026-11-19T15:00:00.000Z').uploads[0].title, 'The long film');
  assert.throws(() => reporting.getHourlySalesTiming(store, ops, pieces, '2026-11-20T06:30:00.000Z', [], 5), /invalid_sales_timing_period/);
  store.close(); ops.close();
});
