'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const estimate = require('../src/longformProfitEstimate');

function fixture() {
  const ops = new Database(':memory:');
  const store = new Database(':memory:');
  ops.exec('CREATE TABLE content_metric_snapshots (piece_id TEXT, platform TEXT, captured_at TEXT, views INTEGER)');
  store.exec(`CREATE TABLE orders (id TEXT, order_status TEXT, stripe_payment_status TEXT,
    total_price_cents INTEGER, bookvault_total_cost_usd_cents INTEGER, attribution_json TEXT);
    CREATE TABLE analytics_daily_utm_landings (day TEXT, utm_source TEXT, utm_medium TEXT,
    utm_campaign TEXT, utm_content TEXT, verified_visits INTEGER);
    CREATE TABLE analytics_events (created_at TEXT, session_id TEXT, verified_human INTEGER,
    event_name TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT)`);
  const pieces = [
    { id: 'a', seq: 1, title: 'First', contentType: 'longform', stage: 'live', youtubeVideoId: 'yt-a', postedAt: '2026-10-20T00:00:00Z' },
    { id: 'b', seq: 2, title: 'Second', contentType: 'longform', stage: 'live', youtubeVideoId: 'yt-b', postedAt: '2026-10-26T00:00:00Z' },
    { id: 'future', seq: 3, title: 'Scheduled', contentType: 'longform', stage: 'scheduled', youtubeVideoId: 'yt-c', postedAt: '' }
  ];
  return { ops, store, pieces,
    metric: ops.prepare('INSERT INTO content_metric_snapshots VALUES (?,?,?,?)'),
    order: store.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)'),
    daily: store.prepare('INSERT INTO analytics_daily_utm_landings VALUES (?,?,?,?,?,?)'),
    event: store.prepare('INSERT INTO analytics_events VALUES (?,?,?,?,?,?,?,?)') };
}

test('allocates known non-social book profit by tracked long-form visits and estimates ads at $3 RPM', function () {
  const f = fixture();
  f.metric.run('a', 'youtube', '2026-11-01T00:00:00Z', 900);
  f.metric.run('a', 'youtube', '2026-11-19T00:00:00Z', 1000);
  f.metric.run('b', 'youtube', '2026-11-19T00:00:00Z', 27000);
  f.daily.run('2026-11-18', 'youtube', 'video', 'longform', '1', 2);
  f.daily.run('2026-11-18', 'youtube', 'video', 'longform', '2', 6);
  f.event.run('2026-11-18T12:00:00Z', 'duplicate', 1, 'utm_landing', 'youtube', 'video', 'longform', '1');
  f.event.run('2026-11-19T12:00:00Z', 'new', 1, 'utm_landing', 'youtube', 'video', 'longform', '1');
  f.order.run('paid-a', 'COMPLETE', 'succeeded', 6000, 2500, null);
  f.order.run('paid-b', 'COMPLETE', 'succeeded', 6000, 2500, JSON.stringify({ first: { source: 'google' } }));
  f.order.run('ig', 'COMPLETE', 'succeeded', 6000, 2500, JSON.stringify({ first: { source: 'instagram' } }));
  f.order.run('fb', 'COMPLETE', 'succeeded', 6000, 2500, JSON.stringify({ last_tagged: { source: 'facebook' } }));
  f.order.run('pending', 'COMPLETE', 'succeeded', 6000, null, null);
  f.order.run('refund', 'REFUNDED', 'succeeded', 6000, 2500, null);
  f.order.run('test', 'COMPLETE', 'succeeded', 6000, 2500, null);
  const result = estimate.report(f.store, f.ops, f.pieces, ['test'], '2026-11-20T12:00:00Z');
  assert.equal(result.book_profit_pool_cents, 7000);
  assert.equal(result.excluded_social_orders, 2);
  assert.equal(result.pending_cost_orders, 1);
  assert.equal(result.tracked_clicks, 9);
  assert.deepEqual(result.videos.map(row => [row.title, row.views, row.tracked_clicks, row.est_adsense_profit_cents]),
    [['Second', 27000, 6, 8100], ['First', 1000, 3, 300]]);
  assert.equal(result.videos.reduce((sum, row) => sum + row.est_book_profit_cents, 0), 7000);
  assert.equal(result.videos.find(row => row.title === 'First').click_rate_percent, 0.3);
  assert.equal(result.videos.find(row => row.title === 'Second').est_total_profit_cents, 8100 + 4667);
});

test('does not assign book profit without any verified video link arrivals', function () {
  const f = fixture();
  f.metric.run('a', 'youtube', '2026-11-19T00:00:00Z', 1000);
  f.order.run('paid', 'COMPLETE', 'succeeded', 6000, 2500, null);
  const result = estimate.report(f.store, f.ops, f.pieces, [], '2026-11-20T12:00:00Z');
  assert.equal(result.book_profit_pool_cents, 3500);
  assert.equal(result.allocated_book_profit_cents, 0);
  assert.equal(result.videos.find(row => row.title === 'First').est_book_profit_cents, undefined);
});

test('profit table has six sortable columns and explains proxy attribution', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const start = source.indexOf('  function longformProfitHtml(');
  const end = source.indexOf('  function renderSalesAnalytics()', start);
  assert.ok(start > 0 && end > start);
  const html = vm.runInNewContext(source.slice(start, end) + '\nlongformProfitHtml', {
    Number, String, escapeHtml: String, salesMoney: cents => '$' + (cents / 100).toFixed(2), contentNumber: Number,
    contentPercent: value => value + '%'
  })({ tracking_since: '2026-10-25', rpm_usd: 3, tracked_clicks: 2,
    book_profit_pool_cents: 3500, pending_cost_orders: 0,
    videos: [{ title: 'First', views: 1000, tracked_clicks: 2, click_rate_percent: .2,
      est_book_profit_cents: 3500, est_adsense_profit_cents: 300, est_total_profit_cents: 3800 }] },
  'est_total_profit_cents', -1);
  assert.equal((html.match(/data-profit-sort=/g) || []).length, 6);
  assert.match(html, /arrivals are a proxy for clicks/);
  assert.match(html, /\$38\.00/);
  assert.match(source, /bindLongformProfit\(results\[4\]\)/);
});
