'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Publishing Queue cards reuse the 720p player without opening the edit modal', function () {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(app, /piece\.stage === 'publishing_queue' && piece\.hasVideo/);
  assert.match(app, /queue-video-wrap/);
  assert.match(app, /queue-player-controls/);
  assert.match(app, /e\.target\.closest\('\.card-move, \.card-external-link, \.queue-video-wrap, \.queue-player-controls'\)/);
  assert.match(app, /final-review-status/);
});

test('queue deletion is confirmed and a claimed video cannot be removed mid-schedule', function () {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(app, /Delete this video from the queue\? It will not be scheduled\./);
  assert.match(server, /publishingQueueClaims\.has\(id\)/);
  assert.match(server, /durableQueueClaim/);
  assert.match(server, /publishingQueueClaims\.add\(candidate\.id\)/);
  assert.match(server, /publishingQueueClaims\.delete\(candidate\.id\)/);
  assert.match(server, /queue_publish_in_progress/);
  assert.match(server, /queuedPieceToDelete/);
});
