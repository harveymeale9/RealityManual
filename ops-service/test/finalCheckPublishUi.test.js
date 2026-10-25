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

test('Final Check waits for the 720p copy rather than preloading the 4K publish master', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const card = source.slice(source.indexOf('function finalCheckCardHtml('), source.indexOf('// Platforms that have a real backend publish integration.'));
  assert.doesNotMatch(card, /src="\/api\/files\/videos\/.*-final/);
  assert.match(source, /final-review-status/);
  assert.match(source, /-final-review/);
});

test('Production, Final Check and the edit form ask for one publishing title', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const card = source.slice(source.indexOf('function finalCheckCardHtml('), source.indexOf('// Platforms that have a real backend publish integration.'));
  assert.match(card, /data-index="0"/);
  assert.doesNotMatch(card, /titleSlotCount|Title option/);
  assert.match(source, /var titleInputs = \[0\]\.map/);
  assert.doesNotMatch(source, /fieldYtTitle2|fieldYtTitle3|titleSlotCount/);
  assert.match(page, /<label>Publishing title<\/label>/);
  assert.doesNotMatch(page, /fieldYtTitle2|fieldYtTitle3|YouTube can rotate/);
});

test('Kanban refresh retains an in-progress Final Check video and its bound controls', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(source, /activeFinalCheckPlayers\.push\(\{ id: card\.dataset\.id, wrap: wrap, controls: controls \}\)/);
  assert.match(source, /newWrap\.replaceWith\(saved\.wrap\)/);
  assert.match(source, /newControls\.replaceWith\(saved\.controls\)/);
  assert.match(source, /if \(wrap\.dataset\.playerBound === 'true'\) return/);
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

test('partial releases remain visible with a destination-specific retry notice', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /Other platforms are not reposted/);
  assert.match(source, /publishRetryDestinations/);
  assert.match(server, /retryFailedPlatforms\(\)/);
  assert.match(server, /runPlatformPublishBatch\(piece\.id, failed, \{ retryFailed: true \}\)/);
  assert.match(server, /notification_kind IN \('mail_alert','publish_alert'\)/);
});

test('publishing recovery clears the error badge without a success alert', function () {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const retrySection = server.slice(server.indexOf('function notifyPublishRetry('), server.indexOf('const youtubeDescriptionsInFlight'));
  assert.match(retrySection, /Publishing needs attention/);
  assert.doesNotMatch(retrySection, /Publishing recovered|accepted by every selected platform|notifyPublishRetry\(piece, true\)/);
  assert.match(retrySection, /UPDATE voice_messages SET notification_unread=0 WHERE notification_kind='publish_alert' AND source_ref=\?/);
});

test('Kanban presents the durable uploaded stage to users as Filmed', function () {
  const store = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'store.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(store, /id:\s*'uploaded',\s*label:\s*'Filmed'/);
  assert.doesNotMatch(store, /id:\s*'uploaded',\s*label:\s*'Uploaded'/);
  assert.match(page, /store\.js\?v=20261022-longform-60h-v1/);
  assert.match(page, /app\.js\?v=20261025-youtube-clickthrough-v1/);
});
