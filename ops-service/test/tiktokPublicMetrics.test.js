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

test('fresh public counters supersede stale Buffer zeroes without allowing counts to move backwards', function () {
  assert.equal(metrics.freshestCount(0, 351), 351);
  assert.equal(metrics.freshestCount(400, 351), 400);
  assert.equal(metrics.freshestCount(null, 18), 18);
  assert.equal(metrics.freshestCount(null, null), null);
});
