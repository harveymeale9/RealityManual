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

test('Content Settings exposes the rolling reserve length control', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'store.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /id="publishingQueueTarget"/);
  assert.match(store, /publishingQueueTarget:\s*10/);
  assert.match(store, /id:\s*'publishing_queue',\s*label:\s*'Publishing Queue'/);
  assert.match(server, /piece\.stage\s*=\s*'publishing_queue'/);
  assert.match(server, /piece\.queuedPublishDestinations\s*=\s*destinations/);
  assert.match(server, /schedulePublishingQueueDrain\(\)/);
});
