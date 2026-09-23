'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const youtubeAuth = require('../src/youtubeAuth');

test('YouTube statistics lookup returns numeric performance totals without exposing OAuth data', async function (t) {
  const originalFetch = global.fetch;
  t.after(function () { global.fetch = originalFetch; });
  global.fetch = async function (url, options) {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin + parsed.pathname, 'https://www.googleapis.com/youtube/v3/videos');
    assert.equal(parsed.searchParams.get('part'), 'snippet,statistics');
    assert.equal(parsed.searchParams.get('id'), 'video-1,video-2');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return {
      ok: true,
      json: async function () {
        return { items: [
          { id: 'video-1', snippet: { title: 'First', publishedAt: '2026-09-20T10:00:00Z' }, statistics: { viewCount: '123', likeCount: '9', commentCount: '2' } },
          { id: 'video-2', snippet: { title: 'Second' }, statistics: { viewCount: '7' } }
        ] };
      }
    };
  };
  const result = await youtubeAuth.fetchVideoStatistics('synthetic-token', ['video-1', 'video-2', 'video-1']);
  assert.deepEqual(result, [
    { id: 'video-1', title: 'First', publishedAt: '2026-09-20T10:00:00Z', views: 123, likes: 9, comments: 2 },
    { id: 'video-2', title: 'Second', publishedAt: null, views: 7, likes: 0, comments: 0 }
  ]);
});

test('YouTube status lookup exposes public visibility and omits no ids itself', async function (t) {
  const originalFetch = global.fetch;
  t.after(function () { global.fetch = originalFetch; });
  global.fetch = async function (url, options) {
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get('part'), 'status');
    assert.equal(parsed.searchParams.get('id'), 'public-id,private-id,deleted-id');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return {
      ok: true,
      json: async function () {
        return { items: [
          { id: 'public-id', status: { privacyStatus: 'public', uploadStatus: 'processed' } },
          { id: 'private-id', status: { privacyStatus: 'private', uploadStatus: 'processed' } }
        ] };
      }
    };
  };
  assert.deepEqual(await youtubeAuth.fetchVideoStatuses('synthetic-token', ['public-id', 'private-id', 'deleted-id']), [
    { id: 'public-id', privacyStatus: 'public', uploadStatus: 'processed' },
    { id: 'private-id', privacyStatus: 'private', uploadStatus: 'processed' }
  ]);
});
