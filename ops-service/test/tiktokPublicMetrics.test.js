'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../src/tiktokPublicMetrics');

test('TikTok public metrics parse the matching video hydration payload', function () {
  const payload = { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
    id: '7696601252985113862', stats: { playCount: 351, diggCount: 18, commentCount: 2, shareCount: 3, collectCount: '4' }
  } } } } };
  const html = '<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + JSON.stringify(payload) + '</script></html>';
  assert.deepEqual(metrics.parsePublicMetrics(html, '7696601252985113862'), {
    views: 351, likes: 18, comments: 2, shares: 3, saves: 4
  });
  assert.equal(metrics.parsePublicMetrics(html, 'different-video'), null);
});

test('TikTok public metric fetch accepts only canonical public video URLs', async function () {
  assert.equal(metrics.videoIdFromUrl('https://www.tiktok.com/@the.reality.manual/video/7696601252985113862'), '7696601252985113862');
  assert.equal(metrics.videoIdFromUrl('https://example.com/@account/video/7696601252985113862'), '');
  let calls = 0;
  const result = await metrics.fetchPublicMetrics('https://example.com/not-tiktok', async function () { calls++; });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('TikTok public audience reads only the requested profile and preserves zero', async function () {
  const url = 'https://tiktok.com/@the.reality.manual/video/7696601252985113862';
  const profile = metrics.profileFromVideoUrl(url);
  assert.deepEqual(profile, { handle: 'the.reality.manual', url: 'https://www.tiktok.com/@the.reality.manual' });
  assert.equal(metrics.profileFromVideoUrl('https://evil.example/@the.reality.manual/video/123'), null);
  const payload = { __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: {
    user: { uniqueId: 'the.reality.manual' }, stats: { followerCount: 0 }
  } } } };
  const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' + JSON.stringify(payload) + '</script>';
  assert.deepEqual(metrics.parsePublicAudience(html, profile.handle), { followers: 0 });
  assert.equal(metrics.parsePublicAudience(html, 'another.creator'), null);
  assert.equal(metrics.parsePublicAudience('<html>blocked</html>', profile.handle), null);
  let called = '';
  const result = await metrics.fetchPublicAudience(url, async function (requestUrl) {
    called = requestUrl;
    return { ok: true, text: async function () { return html; } };
  });
  assert.equal(called, profile.url);
  assert.deepEqual(result, { followers: 0 });
});

test('fresh public counters supersede stale Buffer zeroes without allowing counts to move backwards', function () {
  assert.equal(metrics.freshestCount(0, 351), 351);
  assert.equal(metrics.freshestCount(400, 351), 400);
  assert.equal(metrics.freshestCount(null, 18), 18);
  assert.equal(metrics.freshestCount(null, null), null);
});

test('live counters merge with cached Buffer details when Buffer is temporarily unavailable', function () {
  assert.deepEqual(metrics.mergeMetrics({
    views: { value: 0 },
    reactions: { value: 0 },
    totalTimeWatched: { value: 2.5 },
    averageTimeWatched: { value: 7 }
  }, {
    views: 351, likes: 18, comments: 2, shares: 3, saves: 4
  }), {
    views: 351,
    likes: 18,
    comments: 2,
    shares: 3,
    saves: 4,
    reach: null,
    watchTimeSeconds: 150,
    averageWatchSeconds: 7
  });
});
