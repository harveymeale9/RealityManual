'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const auditService = require('../src/youtubePublicationAudit');

test('daily YouTube audit keeps public videos live and moves private or missing videos to terminal stage', async function () {
  const db = new Database(':memory:');
  const pieces = [
    { id: 'p1', stage: 'live', youtubeVideoId: 'public-id', title: 'Public' },
    { id: 'p2', stage: 'live', youtubeVideoId: 'private-id', title: 'Private' },
    { id: 'p3', stage: 'live', youtubeVideoId: 'deleted-id', title: 'Deleted' },
    { id: 'p4', stage: 'final_check', youtubeVideoId: 'not-live-id', title: 'Not live' },
    { id: 'p5', stage: 'live', youtubeVideoId: 'review-id', createdBy: 'youtube-reviewer' }
  ];
  const saved = [];
  const audit = auditService.setup(db, {
    autoStart: false,
    listPieces: async function () { return pieces; },
    fetchStatuses: async function (ids) {
      assert.deepEqual(ids, ['public-id', 'private-id', 'deleted-id']);
      return [
        { id: 'public-id', privacyStatus: 'public', uploadStatus: 'processed' },
        { id: 'private-id', privacyStatus: 'private', uploadStatus: 'processed' }
      ];
    },
    savePiece: async function (piece) { saved.push(Object.assign({}, piece)); }
  });

  const result = await audit.run(true);
  assert.equal(result.checked, 3);
  assert.equal(result.public, 1);
  assert.deepEqual(result.moved.map(function (item) { return item.reason; }), ['private', 'missing']);
  assert.equal(saved[0].stage, 'live');
  assert.equal(saved[0].youtubeAvailabilityStatus, 'public');
  assert.equal(saved[1].stage, 'removed');
  assert.equal(saved[2].stage, 'removed');
  assert.equal(saved[2].youtubeAvailabilityStatus, 'missing');
  assert.equal(audit.status().state.status, 'ok');
  assert.equal((await audit.run(false)).skipped, 'not_due');
  audit.close();
  db.close();
});

test('YouTube API failure never moves or saves a Kanban card', async function () {
  const db = new Database(':memory:');
  let saved = 0;
  const audit = auditService.setup(db, {
    autoStart: false,
    listPieces: async function () { return [{ id: 'p1', stage: 'live', youtubeVideoId: 'video-id' }]; },
    fetchStatuses: async function () { throw new Error('temporary quota failure'); },
    savePiece: async function () { saved += 1; }
  });
  await assert.rejects(audit.run(true), /temporary quota failure/);
  assert.equal(saved, 0);
  assert.equal(audit.status().state.status, 'error');
  assert.match(audit.status().state.last_error, /temporary quota failure/);
  audit.close();
  db.close();
});
