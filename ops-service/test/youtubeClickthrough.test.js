'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const clickthrough = require('../src/youtubeClickthrough');

function fixture() {
  const ops = new Database(':memory:');
  const store = new Database(':memory:');
  ops.exec(`CREATE TABLE content_metric_snapshots (piece_id TEXT, platform TEXT, captured_at TEXT, views INTEGER)`);
  store.exec(`CREATE TABLE analytics_daily_utm_landings (day TEXT, utm_source TEXT, utm_medium TEXT,
    utm_campaign TEXT, utm_content TEXT, verified_visits INTEGER);
    CREATE TABLE analytics_events (created_at TEXT, session_id TEXT, verified_human INTEGER,
    event_name TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT)`);
  const metric = ops.prepare('INSERT INTO content_metric_snapshots VALUES (?,?,?,?)');
  const landing = store.prepare('INSERT INTO analytics_daily_utm_landings VALUES (?,?,?,?,?,?)');
  const event = store.prepare('INSERT INTO analytics_events VALUES (?,?,?,?,?,?,?,?)');
  const pieces = [
    { id: 'old', seq: 11, contentType: 'longform', youtubeVideoId: 'old-yt', stage: 'live', postedAt: '2026-10-20T12:00:00Z' },
    { id: 'new', seq: 12, contentType: 'longform', youtubeVideoId: 'new-yt', stage: 'live', postedAt: '2026-10-26T12:00:00Z' },
    { id: 'short', seq: 13, contentType: 'short', youtubeVideoId: 'short-yt', stage: 'live', postedAt: '2026-10-26T12:00:00Z' }
  ];
  return { ops, store, metric, landing, event, pieces };
}

test('matches only long-form video landings to post-tracking view growth, with a seven-day rate', function () {
  const f = fixture();
  f.metric.run('old', 'youtube', '2026-10-24T12:00:00Z', 100);
  f.metric.run('old', 'youtube', '2026-10-25T12:00:00Z', 110);
  f.metric.run('old', 'youtube', '2026-10-26T12:00:00Z', 130);
  f.metric.run('new', 'youtube', '2026-10-26T14:00:00Z', 20);
  f.metric.run('short', 'youtube', '2026-10-26T14:00:00Z', 1000);
  f.landing.run('2026-10-25', 'youtube', 'video', 'longform', '11', 2);
  f.landing.run('2026-10-25', 'youtube', 'profile', 'longform', '11', 30);
  f.landing.run('2026-10-26', 'youtube', 'video', 'longform', '13', 50);
  f.landing.run('2026-10-26', 'youtube', 'video', 'longform', '12', 1);
  f.event.run('2026-10-26T16:00:00Z', 'browser-a', 1, 'utm_landing', 'YouTube', 'video', 'longform', '11');
  f.event.run('2026-10-26T17:00:00Z', 'browser-a', 1, 'utm_landing', 'YouTube', 'video', 'longform', '11');
  f.event.run('2026-10-26T18:00:00Z', 'browser-b', 0, 'utm_landing', 'youtube', 'video', 'longform', '11');
  const result = clickthrough.report(f.store, f.ops, f.pieces, '2026-10-26T21:00:00Z');
  assert.equal(result.views, 50); // old +10,+20; new +20 from zero
  assert.equal(result.visits, 4);
  assert.equal(result.rate_percent, 8);
  assert.equal(result.views_per_visit, 12.5);
  assert.deepEqual(result.daily.map((row) => [row.views, row.visits, row.rolling_rate_percent]), [[10, 2, 20], [40, 2, 8]]);
});

test('first in-window snapshot of an older video is a baseline; unmeasured arrivals stay out', function () {
  const f = fixture();
  f.metric.run('old', 'youtube', '2026-10-25T12:00:00Z', 500);
  f.metric.run('old', 'youtube', '2026-10-26T12:00:00Z', 510);
  f.landing.run('2026-10-26', 'youtube', 'video', 'longform', '11', 1);
  f.landing.run('2026-10-26', 'youtube', 'video', 'longform', '12', 4);
  const result = clickthrough.report(f.store, f.ops, f.pieces, '2026-10-26T21:00:00Z');
  assert.equal(result.views, 10);
  assert.equal(result.visits, 1);
  assert.equal(result.unmeasured_visits, 4);
  assert.equal(result.rate_percent, 10);
  assert.equal(result.measured_videos, 1);
});

test('compacted landing counts replace raw rows for the same UTC day', function () {
  const f = fixture();
  f.metric.run('old', 'youtube', '2026-10-24T12:00:00Z', 0);
  f.metric.run('old', 'youtube', '2026-10-25T12:00:00Z', 10);
  f.landing.run('2026-10-25', 'youtube', 'video', 'longform', '11', 3);
  f.event.run('2026-10-25T13:00:00Z', 'browser-a', 1, 'utm_landing', 'youtube', 'video', 'longform', '11');
  const result = clickthrough.report(f.store, f.ops, f.pieces, '2026-10-25T21:00:00Z');
  assert.equal(result.visits, 3);
  assert.equal(result.views, 10);
});
