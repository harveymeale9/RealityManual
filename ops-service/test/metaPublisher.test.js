'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const metaPublisher = require('../src/metaPublisher');

function response(payload) { return { ok: true, status: 200, json: async function () { return payload; } }; }

test('Meta publisher uploads a Facebook video with its platform caption', async function () {
  let call;
  const service = metaPublisher.setup({
    openAsBlob: async function () { return new Blob(['video'], { type: 'video/mp4' }); },
    fetchImpl: async function (url, options) { call = { url: url, options: options }; return response({ id: 'fb-video-1' }); }
  });
  const result = await service.publishFacebookVideo({
    pageId: 'page-1', pageToken: 'page-token', videoPath: '/tmp/finished', mimeType: 'video/mp4',
    title: 'Chosen title', description: 'Facebook caption with https://realitymanual.com'
  });
  assert.equal(call.url, metaPublisher.GRAPH_VIDEO_URL + '/page-1/videos');
  assert.equal(call.options.body.get('description'), 'Facebook caption with https://realitymanual.com');
  assert.equal(call.options.body.get('access_token'), 'page-token');
  assert.equal(result.id, 'fb-video-1');
});

test('Meta publisher lets Facebook fetch an archived video without a large multipart upload', async function () {
  let call;
  const service = metaPublisher.setup({
    openAsBlob: async function () { throw new Error('local file should not be opened'); },
    fetchImpl: async function (url, options) { call = { url: url, options: options }; return response({ id: 'fb-video-2' }); }
  });
  const result = await service.publishFacebookVideo({
    pageId: 'page-1', pageToken: 'page-token', videoUrl: 'https://r2.example/final.mp4?signature=valid',
    title: 'Chosen title', description: 'Facebook caption'
  });
  assert.equal(call.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.options.body.get('file_url'), 'https://r2.example/final.mp4?signature=valid');
  assert.equal(call.options.body.get('description'), 'Facebook caption');
  assert.equal(result.id, 'fb-video-2');
});

test('Meta publisher sends a large Facebook video in the ranges Meta requests', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-chunks-'));
  const file = path.join(dir, 'final.mp4');
  fs.writeFileSync(file, 'abcdefgh');
  const phases = [];
  const service = metaPublisher.setup({ fetchImpl: async function (url, options) {
    assert.equal(url, metaPublisher.GRAPH_VIDEO_URL + '/page-1/videos');
    const body = options.body;
    const phase = body.get('upload_phase');
    phases.push(phase);
    assert.equal(body.get('access_token'), 'page-token');
    if (phase === 'start') {
      assert.equal(body.get('file_size'), '8');
      return response({ upload_session_id: 'session-1', video_id: 'video-1', start_offset: '0', end_offset: '4' });
    }
    if (phase === 'transfer') {
      const offset = Number(body.get('start_offset'));
      assert.equal(await body.get('video_file_chunk').text(), offset ? 'efgh' : 'abcd');
      return response({ start_offset: String(offset + 4), end_offset: String(Math.min(8, offset + 8)) });
    }
    assert.equal(body.get('title'), 'Chosen title');
    assert.equal(body.get('description'), 'Facebook caption');
    return response({ success: true });
  } });
  try {
    const result = await service.publishFacebookVideoResumable({
      pageId: 'page-1', pageToken: 'page-token', videoPath: file,
      title: 'Chosen title', description: 'Facebook caption'
    });
    assert.deepEqual(phases, ['start', 'transfer', 'transfer', 'finish']);
    assert.equal(result.url, 'https://www.facebook.com/watch/?v=video-1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Meta publisher creates, waits for, and publishes an Instagram Reel', async function () {
  const calls = [];
  const service = metaPublisher.setup({
    sleep: async function () {},
    fetchImpl: async function (url, options) {
      calls.push({ url: url, options: options });
      if (url.includes('/ig-1/media_publish')) return response({ id: 'ig-media-1' });
      if (url.includes('/ig-1/media')) return response({ id: 'container-1' });
      if (url.includes('/container-1')) return response({ status_code: 'FINISHED' });
      return response({ id: 'ig-media-1', permalink: 'https://www.instagram.com/reel/example/' });
    }
  });
  const result = await service.publishInstagramReel({
    instagramAccountId: 'ig-1', pageToken: 'page-token', videoUrl: 'https://ops.example/signed-video', caption: 'Instagram caption'
  });
  assert.equal(result.id, 'ig-media-1');
  assert.equal(result.url, 'https://www.instagram.com/reel/example/');
  assert.equal(calls[0].options.body.get('video_url'), 'https://ops.example/signed-video');
  assert.equal(calls[0].options.body.get('caption'), 'Instagram caption');
});

test('Instagram retry reuses its saved container instead of creating another Reel', async function () {
  const calls = [];
  const service = metaPublisher.setup({
    fetchImpl: async function (url) {
      calls.push(url);
      if (url.includes('/container-saved')) return response({ status_code: 'FINISHED' });
      if (url.includes('/ig-1/media_publish')) return response({ id: 'ig-media-saved' });
      if (url.includes('/ig-media-saved')) return response({ id: 'ig-media-saved', permalink: 'https://www.instagram.com/reel/saved/' });
      throw new Error('A second container must not be created');
    }
  });
  const result = await service.publishInstagramReel({
    instagramAccountId: 'ig-1', pageToken: 'token', caption: 'Caption',
    containerId: 'container-saved', containerCreatedAt: '2026-10-22T00:00:00Z'
  });
  assert.equal(result.id, 'ig-media-saved');
  assert.equal(calls.filter(function (url) { return /\/ig-1\/media$/.test(url); }).length, 0);
});

test('Instagram publish error recovers a Reel that Meta actually committed', async function () {
  let checks = 0;
  let publishedId = '';
  const service = metaPublisher.setup({
    fetchImpl: async function (url) {
      if (url.includes('/container-saved')) return response({ status_code: ++checks < 3 ? 'FINISHED' : 'PUBLISHED' });
      if (url.includes('/ig-1/media_publish')) return { ok: false, status: 500,
        json: async function () { return { error: { message: 'An unknown error occurred' } }; } };
      if (url.includes('/ig-1/media?')) return response({ data: [{ id: 'ig-media-1',
        caption: 'Caption', timestamp: '2026-10-22T00:01:00Z', permalink: 'https://www.instagram.com/reel/recovered/' }] });
      throw new Error('Unexpected Graph request: ' + url);
    }
  });
  const result = await service.publishInstagramReel({
    instagramAccountId: 'ig-1', pageToken: 'token', caption: 'Caption',
    containerId: 'container-saved', containerCreatedAt: '2026-10-22T00:00:00Z',
    onPublished: function (id) { publishedId = id; }
  });
  assert.equal(result.id, 'ig-media-1');
  assert.equal(publishedId, 'ig-media-1');
});

test('Meta media URLs are short-lived and tamper evident', function () {
  const service = metaPublisher.setup({ mediaBaseUrl: 'https://ops.example' });
  const url = new URL(service.mediaUrl('piece-1', 'secret', 60000));
  assert.equal(service.verifyMediaSignature('piece-1', url.searchParams.get('expires'), url.searchParams.get('sig'), 'secret'), true);
  assert.equal(service.verifyMediaSignature('piece-2', url.searchParams.get('expires'), url.searchParams.get('sig'), 'secret'), false);
});

test('Meta analytics normalize Facebook Reel plays, engagement and watch time', async function () {
  let calls = 0;
  const service = metaPublisher.setup({ fetchImpl: async function () {
    calls++;
    if (calls === 1) return response({ data: [
      { name: 'fb_reels_total_plays', values: [{ value: 42 }] },
      { name: 'post_video_view_time', values: [{ value: 12500 }] },
      { name: 'post_video_avg_time_watched', values: [{ value: 6250 }] },
      { name: 'post_video_social_actions', values: [{ value: { shares: 3 } }] }
    ] });
    return response({ likes: { summary: { total_count: 5 } }, comments: { summary: { total_count: 2 } } });
  } });
  assert.deepEqual(await service.fetchFacebookVideoMetrics({ videoId: 'fb-1', pageToken: 'token' }), {
    views: 42, likes: 5, comments: 2, shares: 3, watchTimeSeconds: 12.5, averageWatchSeconds: 6.25
  });
});

test('Instagram analytics preserve public engagement when insights permission is unavailable', async function () {
  let calls = 0;
  const service = metaPublisher.setup({ fetchImpl: async function () {
    calls++;
    if (calls === 1) return response({ id: 'ig-1', like_count: 4, comments_count: 1 });
    return { ok: false, status: 400, json: async function () { return { error: { message: 'permission missing' } }; } };
  } });
  const metrics = await service.fetchInstagramMediaMetrics({ mediaId: 'ig-1', pageToken: 'token' });
  assert.equal(metrics.likes, 4);
  assert.equal(metrics.comments, 1);
  assert.equal(metrics.views, null);
  assert.equal(metrics.insightsAvailable, false);
});
