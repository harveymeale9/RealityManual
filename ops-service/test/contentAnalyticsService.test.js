'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
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

  clock = new Date('2026-10-02T11:15:00Z');
  youtubeViews = 25;
  dashboard = await service.collect();
  assert.equal(dashboard.pieces[0].platforms.youtube.viewsChange24h, 15);
  assert.equal(dashboard.pieces[0].platforms.youtube.history.length, 2);
  assert.equal(dashboard.viewHistory.at(-2).total, 60);
  assert.equal(dashboard.viewHistory.at(-1).total, 75);
  assert.equal(dashboard.viewHistory.at(-1).youtube, 25);
  clock = new Date('2026-10-03T11:15:00Z');
  assert.equal(service.dashboard().viewHistory.at(-1).total, 75); // carry last measured counts between polls
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
  assert.match(page, /app\.js\?v=20261025-youtube-clickthrough-v1/);
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
});
