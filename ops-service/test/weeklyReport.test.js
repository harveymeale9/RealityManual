'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const weeklyReportService = require('../src/weeklyReportService');

function storefront(start, end, previous) {
  return {
    period: { start: start, end: end },
    website: {
      page_views: previous ? 50 : 80,
      unique_visitors: previous ? 20 : 32,
      landing_visitors: previous ? 18 : 30,
      checkout_visitors: previous ? 2 : 5,
      completed_order_sessions: previous ? 0 : 1,
      landing_to_checkout_percent: previous ? 11.1 : 16.7,
      checkout_to_order_percent: previous ? 0 : 20,
      funnel: [],
      top_sources: [{ source: 'tiktok', sessions: previous ? 5 : 12 }],
      top_campaigns: []
    },
    sales: {
      paid_orders: previous ? 0 : 1, units: previous ? 0 : 2,
      revenue_cents: previous ? 0 : 14200, average_order_cents: previous ? 0 : 14200,
      refunded_orders: 0, refunded_value_cents: 0, countries: [{ country: 'GB', orders: 1, revenue_cents: 14200 }]
    }
  };
}

test('weekly report sends one complete Monday-to-Monday email and never duplicates it', async function () {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE records(store_name TEXT,id TEXT,data TEXT,updated_at TEXT,PRIMARY KEY(store_name,id))');
  const put = db.prepare('INSERT INTO records VALUES (?,?,?,?)');
  put.run('pieces', 'outline-1', JSON.stringify({
    id: 'outline-1', title: 'Completed outline', stage: 'outline_completed', contentType: 'short',
    createdAt: '2026-09-16T10:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z'
  }), '2026-09-18T12:00:00.000Z');
  put.run('pieces', 'video-1', JSON.stringify({
    id: 'video-1', title: 'Published video', stage: 'live', contentType: 'short', platforms: ['tiktok', 'ytlong'],
    createdAt: '2026-09-18T10:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', postedAt: '2026-09-20T12:00:00.000Z',
    tiktokPublishId: 'tt-1', youtubeVideoId: 'yt-1'
  }), '2026-09-20T12:00:00.000Z');

  const sent = [];
  const fetched = [];
  const service = weeklyReportService.setup(db, {
    autoStart: false,
    recipient: 'harveymeale9@gmail.com',
    timeZone: 'Europe/London',
    sendHour: 9,
    sendMail: async function (message) { sent.push(message); return { internetMessageId: '<weekly@example.com>' }; },
    fetchStorefrontReport: async function (start, end) {
      fetched.push({ start: start, end: end });
      return storefront(start, end, fetched.length === 2);
    },
    fetchYoutubeStatistics: async function () {
      return [{ id: 'yt-1', title: 'Published video', publishedAt: '2026-09-20T12:00:00.000Z', views: 500, likes: 40, comments: 6 }];
    }
  });

  const period = weeklyReportService.duePeriod('2026-09-23T12:00:00.000Z', 'Europe/London', 9);
  assert.equal(period.start, '2026-09-13T23:00:00.000Z');
  assert.equal(period.end, '2026-09-20T23:00:00.000Z');
  assert.equal(period.dueAt, '2026-09-21T08:00:00.000Z');

  const first = await service.runDue('2026-09-23T12:00:00.000Z');
  assert.equal(first.sent, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['harveymeale9@gmail.com']);
  assert.match(sent[0].subject, /Reality Manual Weekly Report/);
  assert.match(sent[0].htmlBody, /Website and funnel/);
  assert.match(sent[0].htmlBody, /\$142\.00/);
  assert.match(sent[0].htmlBody, /Completed outline/);
  assert.match(sent[0].htmlBody, /500/);
  assert.equal(db.prepare("SELECT status FROM weekly_report_runs").get().status, 'sent');

  const second = await service.runDue('2026-09-23T13:00:00.000Z');
  assert.equal(second.skipped, 'already_sent');
  assert.equal(sent.length, 1);

  service.recordStageChange({ id: 'outline-1', title: 'Completed outline', stage: 'filmed', contentType: 'short' }, 'outline_completed', 'kanban', '2026-09-24T10:00:00.000Z');
  const event = db.prepare("SELECT from_stage,to_stage,source FROM piece_stage_events WHERE source='kanban'").get();
  assert.deepEqual(event, { from_stage: 'outline_completed', to_stage: 'filmed', source: 'kanban' });
  service.close();
  db.close();
});
