'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Final Check exposes one publishing-queue action and no visibility selector', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /fc-yt-privacy|YouTube visibility/);
  assert.match(source, /Send to Publishing Queue/);
  assert.doesNotMatch(source, /privacyStatus:\s*privacyStatus/);
});

test('Publishing Queue is natural inventory with no configurable reserve targets', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'store.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(source, /id="publishingQueueShortTarget"/);
  assert.doesNotMatch(source, /id="publishingQueueLongformTarget"/);
  assert.doesNotMatch(store, /publishingQueueShortTarget:/);
  assert.doesNotMatch(store, /publishingQueueLongformTarget:/);
  assert.match(store, /id:\s*'publishing_queue',\s*label:\s*'Publishing Queue'/);
  assert.match(server, /piece\.stage\s*=\s*'publishing_queue'/);
  assert.match(server, /piece\.queuedPublishDestinations\s*=\s*destinations/);
  assert.doesNotMatch(server, /function publishingQueueTargets\(\)/);
  assert.match(server, /publishingQueue\.readyQueues\(queued, pieces\)/);
  assert.match(server, /publishingQueue\.preparationDue\(candidateDueAt, now\)/);
  assert.match(server, /runPlatformPublishBatch\(candidate\.id, candidate\.queuedPublishDestinations, \{ dueAt: dueAt \}\)/);
  assert.match(server, /schedulePublishingQueueDrain\(\)/);
});

test('Kanban presents the durable uploaded stage to users as Filmed', function () {
  const store = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'store.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(store, /id:\s*'uploaded',\s*label:\s*'Filmed'/);
  assert.doesNotMatch(store, /id:\s*'uploaded',\s*label:\s*'Uploaded'/);
  assert.match(page, /store\.js\?v=20261013-natural-publishing-queue-v10/);
});
