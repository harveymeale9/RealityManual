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

test('competitor lookup resolves a handle without search, ranks its latest ten, and builds a fifty-video baseline', async function (t) {
  const originalFetch = global.fetch;
  t.after(function () { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async function (url, options) {
    const parsed = new URL(String(url));
    calls.push({ path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), auth: options.headers.Authorization });
    if (parsed.pathname.endsWith('/channels')) return { ok: true, json: async function () { return { items: [{
      id: 'UCabcdefghijklmnopqrstuv',
      snippet: { title: 'Example Creator', description: 'Public description', thumbnails: { high: { url: 'https://img/channel.jpg' } } },
      contentDetails: { relatedPlaylists: { uploads: 'UUabcdefghijklmnopqrstuv' } },
      statistics: { subscriberCount: '25000', videoCount: '44', hiddenSubscriberCount: false }
    }] }; } };
    if (parsed.pathname.endsWith('/playlistItems')) return { ok: true, json: async function () { return { items: [
      { contentDetails: { videoId: 'newer' } }, { contentDetails: { videoId: 'older' } }
    ] }; } };
    return { ok: true, json: async function () { return { items: [
      { id: 'older', snippet: { title: 'Winner', publishedAt: '2026-09-01T00:00:00Z', thumbnails: { high: { url: 'https://img/winner.jpg' } } }, contentDetails: { duration: 'PT1M5S' }, statistics: { viewCount: '900', likeCount: '40', commentCount: '3' } },
      { id: 'newer', snippet: { title: 'Newest', publishedAt: '2026-09-02T00:00:00Z', thumbnails: { medium: { url: 'https://img/new.jpg' } } }, contentDetails: { duration: 'PT45S' }, statistics: { viewCount: '100', likeCount: '5' } }
    ] }; } };
  };

  const result = await youtubeAuth.fetchCompetitorChannel('existing-token', 'https://youtube.com/@Example.Creator');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].query.forHandle, 'Example.Creator');
  assert.equal(calls[1].query.playlistId, 'UUabcdefghijklmnopqrstuv');
  assert.equal(calls[1].query.maxResults, '50');
  assert.equal(calls[2].query.part, 'snippet,statistics,contentDetails');
  assert.ok(calls.every(function (call) { return call.auth === 'Bearer existing-token'; }));
  assert.equal(result.title, 'Example Creator');
  assert.equal(result.averageViews, 500);
  assert.equal(result.medianViews, 500);
  assert.equal(result.baselineVideoCount, 2);
  assert.equal(result.recentVideoCount, 2);
  assert.equal(result.sampleVersion, 3);
  assert.equal(result.videos[0].id, 'newer');
  assert.equal(result.videos[0].recentViewRank, 2);
  assert.equal(result.videos[0].baselineViewRank, 2);
  assert.equal(result.videos[0].comments, null);
  assert.equal(result.videos[1].recentViewRank, 1);
  assert.equal(result.videos[1].baselineViewRank, 1);
  assert.equal(result.videos[1].description, '');
  assert.equal(result.videos[1].durationSeconds, 65);
});

test('competitor baseline includes older videos without letting them enter the latest-ten ranking', async function (t) {
  const originalFetch = global.fetch;
  t.after(function () { global.fetch = originalFetch; });
  const ids = Array.from({ length: 11 }, function (_, index) { return 'video-' + index; });
  global.fetch = async function (url) {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/channels')) return { ok: true, json: async function () { return { items: [{
      id: 'UCabcdefghijklmnopqrstuv',
      snippet: { title: 'Larger Sample' },
      contentDetails: { relatedPlaylists: { uploads: 'UUabcdefghijklmnopqrstuv' } },
      statistics: { subscriberCount: '100', videoCount: '11' }
    }] }; } };
    if (parsed.pathname.endsWith('/playlistItems')) return { ok: true, json: async function () {
      return { items: ids.map(function (id) { return { contentDetails: { videoId: id } }; }) };
    } };
    return { ok: true, json: async function () {
      return { items: ids.map(function (id, index) {
        return {
          id: id,
          snippet: { title: id, description: 'Description ' + index, publishedAt: '2026-09-' + String(20 - index).padStart(2, '0') + 'T00:00:00Z' },
          contentDetails: { duration: 'PT1M' },
          statistics: { viewCount: String(index === 10 ? 1000 : index + 1) }
        };
      }) };
    } };
  };

  const result = await youtubeAuth.fetchCompetitorChannel('existing-token', '@sample');
  assert.equal(result.baselineVideoCount, 11);
  assert.equal(result.recentVideoCount, 10);
  assert.equal(result.averageViews, 96);
  assert.equal(result.medianViews, 6);
  assert.equal(result.videos[9].recentViewRank, 1);
  assert.equal(result.videos[10].recentViewRank, null);
  assert.equal(result.videos[10].baselineViewRank, 1);
  assert.equal(result.videos[10].description, 'Description 10');
  assert.equal(result.videos[0].description, undefined);
});

test('competitor channel input accepts handles and stable channel ids but rejects arbitrary URLs', function () {
  assert.deepEqual(youtubeAuth.competitorChannelFilter('@RealityManual'), { key: 'forHandle', value: 'RealityManual' });
  assert.deepEqual(youtubeAuth.competitorChannelFilter('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), { key: 'id', value: 'UCabcdefghijklmnopqrstuv' });
  assert.throws(function () { youtubeAuth.competitorChannelFilter('https://example.com/@channel'); }, /youtube\.com/);
  assert.throws(function () { youtubeAuth.competitorChannelFilter('https://youtube.com/watch?v=123'); }, /@handle URL/);
});
