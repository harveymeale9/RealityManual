'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const analytics = require('../src/contentAnalyticsService');

test('content analytics stores honest cross-platform snapshots and calculates growth', async function () {
  const db = new Database(':memory:');
  let clock = new Date('2026-10-01T10:15:00Z');
  let youtubeViews = 10;
  const pieces = [{
    id: 'piece-1', title: 'A real piece', stage: 'live', postedAt: '2026-10-01T09:00:00Z',
    youtubeVideoId: 'yt-1', tiktokPublishId: 'tt-1', instagramMediaId: 'ig-1', facebookVideoId: 'fb-1',
    youtubeUrl: 'https://youtube.test/yt-1', tiktokExternalLink: 'https://tiktok.test/tt-1',
    instagramUrl: 'https://instagram.test/ig-1', facebookUrl: 'https://facebook.test/fb-1'
  }];
  const service = analytics.setup(db, {
    now: function () { return new Date(clock); }, listPieces: function () { return pieces; },
    collectors: {
      youtube: async function () { return { pieces: [{ pieceId: 'piece-1', platform: 'youtube', metrics: { views: youtubeViews, likes: 2, comments: 1 } }], channels: [{ platform: 'youtube', followers: 5, totalViews: 100, mediaCount: 2 }] }; },
      tiktok: async function () { return { pieces: [{ pieceId: 'piece-1', platform: 'tiktok', metrics: { views: 20, likes: 3, comments: 1, shares: 2 } }], channels: [], status: { audienceAvailable: false } }; },
      instagram: async function () { return { pieces: [{ pieceId: 'piece-1', platform: 'instagram', metrics: { views: null, likes: 4, comments: 0 } }], channels: [{ platform: 'instagram', followers: 7, mediaCount: 1 }], status: { partial: true, note: 'permission required' } }; },
      facebook: async function () { return { pieces: [{ pieceId: 'piece-1', platform: 'facebook', metrics: { views: 30, likes: 1, comments: 2, averageWatchSeconds: 6.5 } }], channels: [{ platform: 'facebook', followers: 9 }] }; }
    }
  });

  let dashboard = await service.collect();
  assert.equal(dashboard.summary.pieces, 1);
  assert.equal(dashboard.summary.totalViews, 60);
  assert.equal(dashboard.summary.totalEngagements, 16);
  assert.equal(dashboard.summary.engagementRate, 20);
  assert.equal(dashboard.summary.followers, 21);
  assert.equal(dashboard.pieces[0].platforms.instagram.views, null);
  assert.equal(dashboard.pieces[0].platforms.instagram.likes, 4);
  assert.equal(dashboard.providerStatus.instagram.partial, true);
  assert.equal(dashboard.pieces[0].platforms.facebook.averageWatchSeconds, 6.5);
  assert.equal(dashboard.viewHistory.length, 90);
  assert.equal(dashboard.viewHistory.at(-2).total, null);
  assert.equal(dashboard.viewHistory.at(-1).total, 60);
  assert.equal(dashboard.viewHistory.at(-1).instagram, null);
  assert.equal(dashboard.viewDailyHistory.at(-1).total, null, 'first counters are baselines, not new views');

  clock = new Date('2026-10-02T11:15:00Z');
  youtubeViews = 25;
  dashboard = await service.collect();
  assert.equal(dashboard.pieces[0].platforms.youtube.viewsChange24h, 15);
  assert.equal(dashboard.pieces[0].platforms.youtube.history.length, 2);
  assert.equal(dashboard.viewHistory.at(-2).total, 60);
  assert.equal(dashboard.viewHistory.at(-1).total, 75);
  assert.equal(dashboard.viewHistory.at(-1).youtube, 25);
  assert.equal(dashboard.viewDailyHistory.at(-1).total, 15);
  assert.equal(dashboard.viewDailyHistory.at(-1).youtube, 15);
  assert.equal(dashboard.viewDailyHistory.at(-1).instagram, null);
  clock = new Date('2026-10-03T11:15:00Z');
  assert.equal(service.dashboard().viewHistory.at(-1).total, 75); // carry last measured counts between polls
  assert.equal(service.dashboard().viewDailyHistory.at(-1).total, null, 'no snapshots are not zero-view days');
  assert.equal(db.prepare('SELECT count(*) AS count FROM content_metric_snapshots').get().count, 8);
});

test('content analytics isolates one unavailable provider without hiding real metrics', async function () {
  const db = new Database(':memory:');
  const service = analytics.setup(db, {
    listPieces: function () { return [{ id: 'p', stage: 'live', youtubeVideoId: 'y' }]; },
    collectors: {
      youtube: async function () { return { pieces: [{ pieceId: 'p', platform: 'youtube', metrics: { views: 3 } }] }; },
      tiktok: async function () { throw new Error('Buffer unavailable'); }
    }
  });
  const dashboard = await service.collect();
  assert.equal(dashboard.summary.totalViews, 3);
  assert.equal(dashboard.providerStatus.youtube.available, true);
  assert.equal(dashboard.providerStatus.tiktok.available, false);
  assert.match(dashboard.providerStatus.tiktok.error, /Buffer unavailable/);
});

test('overall view growth sums connected pieces without inventing pre-snapshot history', function () {
  const db = new Database(':memory:');
  const service = analytics.setup(db, {
    now: function () { return new Date('2026-10-18T12:00:00Z'); },
    listPieces: function () { return [
      { id: 'one', stage: 'live', youtubeVideoId: 'yt', tiktokPublishId: 'tt' },
      { id: 'two', stage: 'live', facebookVideoId: 'fb', instagramMediaId: 'ig' }
    ]; }
  });
  const insert = db.prepare(`INSERT INTO content_metric_snapshots (piece_id,platform,captured_at,views) VALUES (?,?,?,?)`);
  insert.run('one', 'youtube', '2026-10-15T10:00:00Z', 10);
  insert.run('one', 'tiktok', '2026-10-15T10:00:00Z', 7);
  insert.run('one', 'youtube', '2026-10-16T10:00:00Z', 20);
  insert.run('two', 'facebook', '2026-10-16T10:00:00Z', 5);
  insert.run('two', 'instagram', '2026-10-16T10:00:00Z', null);
  insert.run('one', 'youtube', '2026-10-18T10:00:00Z', 28);
  const history = service.dashboard().viewHistory;
  assert.equal(history.length, 90);
  assert.equal(history.find((day) => day.day === '2026-10-14').total, null);
  assert.equal(history.find((day) => day.day === '2026-10-15').total, 17);
  assert.equal(history.find((day) => day.day === '2026-10-16').total, 32);
  assert.equal(history.find((day) => day.day === '2026-10-17').total, 32);
  assert.equal(history.find((day) => day.day === '2026-10-18').total, 40);
  assert.equal(history.at(-1).instagram, null);
  db.close();
});

test('daily view growth excludes initial counters and long gaps but measures same-day increases', function () {
  const db = new Database(':memory:');
  const service = analytics.setup(db, {
    now: function () { return new Date('2026-10-04T12:00:00Z'); },
    listPieces: function () { return [
      { id: 'one', stage: 'live', contentType: 'longform', youtubeVideoId: 'yt1' },
      { id: 'two', stage: 'live', contentType: 'short', youtubeVideoId: 'yt2' }
    ]; }
  });
  const insert = db.prepare('INSERT INTO content_metric_snapshots (piece_id,platform,captured_at,views) VALUES (?,?,?,?)');
  insert.run('one', 'youtube', '2026-10-01T10:00:00Z', 100);
  insert.run('one', 'youtube', '2026-10-01T11:00:00Z', 110);
  insert.run('one', 'youtube', '2026-10-02T10:00:00Z', 120);
  insert.run('two', 'youtube', '2026-10-02T10:00:00Z', 10000);
  insert.run('two', 'youtube', '2026-10-02T11:00:00Z', 10005);
  insert.run('one', 'youtube', '2026-10-04T10:00:00Z', 140);
  insert.run('one', 'youtube', '2026-10-04T11:00:00Z', 150);
  const history = service.dashboard().viewDailyHistory;
  assert.equal(history.find((day) => day.day === '2026-09-30').total, null);
  assert.equal(history.find((day) => day.day === '2026-10-01').total, 10);
  assert.equal(history.find((day) => day.day === '2026-10-02').total, 15);
  assert.equal(history.find((day) => day.day === '2026-10-02').youtubeLongform, 10);
  assert.equal(history.find((day) => day.day === '2026-10-02').youtubeShortform, 5);
  assert.equal(history.find((day) => day.day === '2026-10-02').youtubeOther, 0);
  assert.equal(history.find((day) => day.day === '2026-10-02').youtube, 15);
  assert.equal(history.find((day) => day.day === '2026-10-03').total, null);
  assert.equal(history.find((day) => day.day === '2026-10-03').youtubeShortform, null);
  assert.equal(history.find((day) => day.day === '2026-10-04').total, 10);
  db.close();
});

test('daily views ignore transient lifetime-counter drops and only count growth above the prior high', function () {
  const db = new Database(':memory:');
  const service = analytics.setup(db, {
    now: function () { return new Date('2026-10-04T12:00:00Z'); },
    listPieces: function () { return [{ id: 'tt', stage: 'live', tiktokPublishId: 'post' }]; }
  });
  const insert = db.prepare('INSERT INTO content_metric_snapshots (piece_id,platform,captured_at,views) VALUES (?,?,?,?)');
  [
    ['2026-10-01T10:00:00Z', 300],
    ['2026-10-02T08:00:00Z', 0],
    ['2026-10-02T09:00:00Z', 300],
    ['2026-10-02T10:00:00Z', 310],
    ['2026-10-02T11:00:00Z', 0],
    ['2026-10-02T12:00:00Z', 310],
    ['2026-10-02T13:00:00Z', 312],
    ['2026-10-04T10:00:00Z', 320],
    ['2026-10-04T11:00:00Z', 321]
  ].forEach(function (row) { insert.run('tt', 'tiktok', row[0], row[1]); });
  const history = service.dashboard().viewDailyHistory;
  assert.equal(history.find((day) => day.day === '2026-10-02').tiktok, 12);
  assert.equal(history.find((day) => day.day === '2026-10-02').total, 12);
  assert.equal(history.find((day) => day.day === '2026-10-03').total, null);
  assert.equal(history.find((day) => day.day === '2026-10-04').tiktok, 1);
  db.close();
});

test('overall chart renders daily growth rather than cumulative totals', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const start = app.indexOf('  function contentOverallChart(');
  const end = app.indexOf('  function contentDetailMarkup(', start);
  assert.ok(start > 0 && end > start);
  const render = vm.runInNewContext(app.slice(start, end) + '\ncontentOverallChart', {
    CONTENT_PLATFORM_META: { youtube: { label: 'YouTube', color: '#f00' } },
    contentNumber: function (value) { return value == null ? '—' : Number(value).toLocaleString('en-US'); },
    escapeHtml: function (value) { return String(value); }
  });
  const daily = [
    { day: '2026-11-10', total: 120, youtube: 120 },
    { day: '2026-11-11', total: 230, youtube: 230 },
    { day: '2026-11-12', total: 20, youtube: 20 }
  ];
  const html = render({ viewDailyHistory: daily, viewHistory: daily.map((day) => ({ ...day, total: 400000 })) }, 7);
  assert.match(html, /<h3>New views per day<\/h3>/);
  assert.match(html, /Yesterday · 2026-11-11 <strong>230 new views<\/strong>/);
  assert.match(html, /Today so far · UTC/);
  assert.match(html, /2026-11-12: 20 new views/);
  assert.doesNotMatch(html, /400,000/);
});

test('Content Analytics owns its analytics route while competitor research keeps a distinct route', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const style = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(app, /id: 'content-analytics', label: 'Content Analytics'/);
  assert.match(app, /id: 'outlier-analysis', label: 'Outlier Analysis'/);
  assert.match(app, /button\.addEventListener\('mouseenter', select\)/);
  assert.match(app, /contentOverallChart\(data, contentOverallRangeDays\)/);
  assert.match(app, /data-content-range/);
  assert.match(style, /\.content-piece-list\{container-type:inline-size\}/);
  assert.match(style, /@container \(max-width:600px\)/);
  assert.match(style, /\.content-piece-row>span:nth-child\(6\)\{display:block\}/);
  assert.match(page, /data-tabs="content-analytics,sales-analytics,website-analytics"/);
  assert.match(page, /app\.js\?v=20261112-clear-comments/);
  assert.match(page, /id="commentAlertClearAll" disabled/);
  assert.match(app, /comment-alerts\/reviewed-all/);
  assert.match(app, /class="content-overall-yesterday" data-content-day=/);
  assert.match(app, /class="content-overall-day-target" data-content-day=/);
  assert.match(app, /class="content-overall-popup" hidden/);
  assert.match(app, /selected\.dataset\.contentDay/);
  assert.match(app, /↳ Long-form/);
  assert.match(app, /↳ Shorts/);
  assert.match(style, /\.content-overall-popup\[hidden\]\{display:none\}/);
});

test('comment watch flags existing and newly increased counts until reviewed without duplicate rebound alerts', async function () {
  const db = new Database(':memory:');
  const piece = { id: 'piece-1', title: 'Example', stage: 'live', youtubeVideoId: 'yt-1',
    tiktokPublishId: 'tt-1', instagramMediaId: 'ig-1', facebookVideoId: 'fb-1',
    youtubeUrl: 'https://www.youtube.com/watch?v=yt-1' };
  const counts = { youtube: 2, tiktok: 0, instagram: 1, facebook: null };
  const collectors = Object.fromEntries(analytics.PLATFORMS.map(function (platform) {
    return [platform, async function () { return { pieces: [{ pieceId: piece.id, platform: platform,
      metrics: { comments: counts[platform], views: 1 } }] }; }];
  }));
  const service = analytics.setup(db, { listPieces: function () { return [piece]; }, collectors: collectors });
  await service.collect();
  assert.deepEqual(service.commentAlerts().map(function (row) { return [row.platform, row.count]; }),
    [['instagram', 1], ['youtube', 2]]);
  assert.equal(service.markCommentsReviewed('piece-1', 'youtube'), true);
  assert.equal(service.markCommentsReviewed('piece-1', 'unknown'), false);
  assert.deepEqual(service.commentAlerts().map(function (row) { return row.platform; }), ['instagram']);
  counts.youtube = 3; counts.tiktok = 2;
  await service.collect();
  assert.deepEqual(service.commentAlerts().map(function (row) { return [row.platform, row.count]; }),
    [['instagram', 1], ['tiktok', 2], ['youtube', 1]]);
  counts.youtube = 1; await service.collect();
  counts.youtube = 3; await service.collect();
  assert.equal(service.commentAlerts().find(function (row) { return row.platform === 'youtube'; }).count, 1);
  const restarted = analytics.setup(db, { listPieces: function () { return [piece]; } });
  assert.equal(restarted.commentAlerts().length, 3);
  assert.equal(restarted.markAllCommentsReviewed(), 3);
  assert.equal(restarted.commentAlerts().length, 0);
  assert.equal(restarted.markAllCommentsReviewed(), 0, 'clearing an empty queue is harmless');
  counts.tiktok = 3;
  await service.collect();
  assert.deepEqual(service.commentAlerts().map(function (row) { return [row.platform, row.count]; }), [['tiktok', 1]],
    'a later new comment still raises an alert');
});
