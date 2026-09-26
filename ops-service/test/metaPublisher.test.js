'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('Meta media URLs are short-lived and tamper evident', function () {
  const service = metaPublisher.setup({ mediaBaseUrl: 'https://ops.example' });
  const url = new URL(service.mediaUrl('piece-1', 'secret', 60000));
  assert.equal(service.verifyMediaSignature('piece-1', url.searchParams.get('expires'), url.searchParams.get('sig'), 'secret'), true);
  assert.equal(service.verifyMediaSignature('piece-2', url.searchParams.get('expires'), url.searchParams.get('sig'), 'secret'), false);
});
