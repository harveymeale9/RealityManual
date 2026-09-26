'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bufferService = require('../src/bufferService');

function response(payload) {
  return { ok: true, status: 200, json: async function () { return payload; } };
}

test('Buffer discovers the sole TikTok channel and queues a signed video post', async function () {
  const calls = [];
  const service = bufferService.setup({ apiKey: 'test-key', mediaBaseUrl: 'https://ops.example', fetchImpl: async function (url, options) {
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    if (body.query.indexOf('account') !== -1) return response({ data: { account: { organizations: [{ id: 'org-1', name: 'Reality Manual' }] } } });
    if (body.query.indexOf('query Channels') !== -1) return response({ data: { channels: [
      { id: 'tt-1', displayName: 'Reality Manual', descriptor: 'TikTok Profile', service: 'tiktok', isDisconnected: false, isLocked: false, isQueuePaused: false }
    ] } });
    assert.equal(body.variables.input.channelId, 'tt-1');
    assert.equal(body.variables.input.mode, 'addToQueue');
    assert.equal(body.variables.input.text, 'Exact Content Studio TikTok caption');
    assert.equal(body.variables.input.assets[0].video.metadata.thumbnailOffset, 2750);
    assert.match(body.variables.input.assets[0].video.url, /^https:\/\/ops\.example\/api\/buffer\/media\/piece-1\?/);
    return response({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'post-1', status: 'scheduled', dueAt: '2026-09-27T08:00:00Z' } } } });
  } });
  const url = service.mediaUrl('piece-1');
  const parsed = new URL(url);
  assert.equal(service.verifyMediaSignature('piece-1', parsed.searchParams.get('expires'), parsed.searchParams.get('sig')), true);
  assert.equal(service.verifyMediaSignature('other', parsed.searchParams.get('expires'), parsed.searchParams.get('sig')), false);
  const result = await service.createTiktokVideoPost({ text: 'Exact Content Studio TikTok caption', videoUrl: url, thumbnailOffset: 2750 });
  assert.equal(result.post.id, 'post-1');
  assert.equal(calls.length, 3);
});

test('Buffer refuses ambiguous TikTok channels and reports missing configuration safely', async function () {
  const empty = bufferService.setup({});
  assert.deepEqual(await empty.status(), { configured: false, connected: false, reason: 'missing_api_key' });
  const ambiguous = bufferService.setup({ apiKey: 'test-key', fetchImpl: async function (url, options) {
    const body = JSON.parse(options.body);
    if (body.query.indexOf('account') !== -1) return response({ data: { account: { organizations: [{ id: 'org-1', name: 'Org' }] } } });
    return response({ data: { channels: [
      { id: 'one', service: 'tiktok' }, { id: 'two', service: 'tiktok' }
    ] } });
  } });
  await assert.rejects(ambiguous.resolveTiktokChannel(), /Multiple TikTok channels/);
});

test('Buffer returns authoritative lifecycle, destination link, and normalized post metrics', async function () {
  const service = bufferService.setup({ apiKey: 'test-key', fetchImpl: async function (url, options) {
    const body = JSON.parse(options.body);
    assert.equal(body.variables.input.id, 'post-1');
    assert.match(body.query, /metricsUpdatedAt/);
    return response({ data: { post: {
      id: 'post-1', channelId: 'tt-1', status: 'sent', dueAt: '2026-09-27T08:00:00Z',
      sentAt: '2026-09-27T08:00:04Z', externalLink: 'https://www.tiktok.com/@rm/video/1',
      metrics: [{ type: 'views', name: 'Views', value: 1200, unit: 'count' }],
      metricsUpdatedAt: '2026-09-28T08:00:00Z'
    } } });
  } });
  const post = await service.getPost('post-1');
  assert.equal(post.status, 'sent');
  assert.equal(post.metrics[0].value, 1200);
});
