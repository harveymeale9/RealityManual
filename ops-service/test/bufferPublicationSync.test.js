'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const syncService = require('../src/bufferPublicationSync');

test('Buffer sync advances sent posts, returns failures to Final Check, and stores metrics', async function () {
  const db = new Database(':memory:');
  const pieces = [
    { id: 'queued', stage: 'scheduled', tiktokPublishProvider: 'buffer', tiktokPublishId: 'b1' },
    { id: 'sent', title: 'Live post', stage: 'scheduled', tiktokPublishProvider: 'buffer', tiktokPublishId: 'b2' },
    { id: 'failed', stage: 'scheduled', tiktokPublishProvider: 'buffer', tiktokPublishId: 'b3' },
    { id: 'other', stage: 'live', youtubeVideoId: 'yt1' }
  ];
  const saved = [];
  const posts = {
    b1: { id: 'b1', status: 'scheduled', dueAt: '2026-09-27T08:00:00Z' },
    b2: { id: 'b2', status: 'sent', dueAt: '2026-09-27T08:00:00Z', sentAt: '2026-09-27T08:00:05Z',
      externalLink: 'https://tiktok.example/video/2', metricsUpdatedAt: '2026-09-28T08:00:00Z',
      metrics: [{ type: 'views', name: 'Views', value: 2500, unit: 'count' }, { type: 'likes', name: 'Likes', value: 200, unit: 'count' }] },
    b3: { id: 'b3', status: 'error', error: { message: 'TikTok rejected the upload', supportUrl: 'https://buffer.example/help' } }
  };
  const sync = syncService.setup(db, {
    autoStart: false,
    listPieces: async function () { return pieces; },
    fetchPost: async function (id) { return posts[id]; },
    savePiece: async function (piece) { saved.push(Object.assign({}, piece)); }
  });
  const result = await sync.run();
  assert.equal(result.checked, 3);
  assert.equal(result.scheduled, 1);
  assert.equal(result.live, 1);
  assert.equal(result.failed, 1);
  assert.equal(pieces[0].scheduledAt, '2026-09-27T08:00:00Z');
  assert.equal(pieces[1].stage, 'live');
  assert.equal(pieces[1].postedAt, '2026-09-27T08:00:05Z');
  assert.equal(pieces[1].tiktokMetrics.views.value, 2500);
  assert.equal(pieces[1].tiktokExternalLink, 'https://tiktok.example/video/2');
  assert.equal(pieces[2].stage, 'final_check');
  assert.match(pieces[2].tiktokPublishError, /rejected/);
  assert.equal(saved.length, 3);
  assert.equal(sync.status().state.status, 'ok');
  sync.close();
  db.close();
});

test('a Buffer lookup failure never moves that card and does not block other posts', async function () {
  const db = new Database(':memory:');
  const pieces = [
    { id: 'unavailable', stage: 'scheduled', tiktokPublishProvider: 'buffer', tiktokPublishId: 'bad' },
    { id: 'good', stage: 'scheduled', tiktokPublishProvider: 'buffer', tiktokPublishId: 'good' }
  ];
  const saved = [];
  const sync = syncService.setup(db, {
    autoStart: false,
    listPieces: async function () { return pieces; },
    fetchPost: async function (id) { if (id === 'bad') throw new Error('temporary Buffer outage'); return { id: id, status: 'sent' }; },
    savePiece: async function (piece) { saved.push(piece.id); }
  });
  const result = await sync.run();
  assert.equal(result.errors.length, 1);
  assert.equal(pieces[0].stage, 'scheduled');
  assert.equal(pieces[1].stage, 'live');
  assert.deepEqual(saved, ['good']);
  assert.equal(sync.status().state.status, 'partial_error');
  sync.close();
  db.close();
});
