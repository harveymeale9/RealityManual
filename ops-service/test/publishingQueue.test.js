'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../src/publishingQueue');
const NOW = Date.UTC(2026, 9, 2, 12);

function piece(id, type, queuedIndex, transcript) {
  return {
    id: id,
    contentType: type,
    transcript: transcript || id,
    publishingQueuedAt: new Date(Date.UTC(2026, 9, 1, queuedIndex)).toISOString(),
    stage: 'publishing_queue'
  };
}

test('cards are assigned to independent long-form and short-form cadences', function () {
  assert.equal(queue.queueType(piece('long', 'longform', 1)), 'longform');
  assert.equal(queue.queueType(piece('short', 'short', 2)), 'shortform');
  assert.equal(queue.queueType(piece('ultra', 'ultra_short', 3)), 'shortform');
  assert.equal(queue.queueType(piece('long-short', 'long_short', 4)), 'shortform');
});

test('short selection alternates length and avoids the strongest recent topic match', function () {
  const history = [{
    id: 'recent', stage: 'live', contentType: 'short', postedAt: '2026-10-12T12:00:00.000Z',
    transcript: 'beliefs are emotional records formed from repeated experiences'
  }];
  const items = [
    piece('related-short', 'short', 1, 'beliefs are emotional records formed from repeated experiences'),
    piece('fresh-long-short', 'long_short', 2, 'why mutual cooperation improves a community'),
    piece('reserve-a', 'ultra_short', 3), piece('reserve-b', 'short', 4)
  ];
  const selected = queue.chooseCandidate(items, history, NOW);
  assert.equal(selected.piece.id, 'fresh-long-short');
});

test('equally suitable candidates release the oldest approval first', function () {
  const items = [piece('old', 'ultra_short', 1, 'unique alpha'), piece('new', 'ultra_short', 2, 'unique beta')];
  const selected = queue.chooseCandidate(items, [], NOW);
  assert.equal(selected.piece.id, 'old');
});

test('a natural queue plans all waiting cards only when a slot needs a candidate', function () {
  const items = [];
  for (let index = 0; index < 11; index++) items.push(piece('s' + index, index % 2 ? 'short' : 'long_short', index + 1, 'topic ' + index));

  const plan = queue.planQueue(items, [], NOW);
  const selected = queue.chooseCandidate(items, [], NOW);
  assert.equal(plan.length, 11);
  assert.equal(new Set(plan.map(function (entry) { return entry.piece.id; })).size, 11);
  assert.equal(selected.piece.id, plan[0].piece.id);
});

test('each cadence selects one next video only when that format has no scheduled item', function () {
  const waiting = [piece('long-waiting', 'longform', 1), piece('short-waiting', 'short', 2)];
  assert.deepEqual(queue.readyQueues(waiting, waiting).map(function (group) { return group.type; }), ['longform', 'shortform']);

  const longScheduled = { id: 'long-scheduled', stage: 'scheduled', contentType: 'longform', scheduledAt: '2026-10-15T00:00:00.000Z' };
  assert.deepEqual(queue.readyQueues(waiting, waiting.concat(longScheduled)).map(function (group) { return group.type; }), ['shortform']);

  const shortScheduled = { id: 'short-scheduled', stage: 'scheduled', contentType: 'ultra_short', scheduledAt: '2026-10-14T00:00:00.000Z' };
  assert.deepEqual(queue.readyQueues(waiting, waiting.concat(longScheduled, shortScheduled)), []);
});

test('an overdue partial failure does not block the next cadence slot', function () {
  const waiting = [piece('next-short', 'short', 1)];
  const partial = { id: 'partial', stage: 'scheduled', contentType: 'short',
    scheduledAt: '2026-01-01T00:00:00.000Z', publishRetryDestinations: [{ platform: 'instagram' }] };
  assert.deepEqual(queue.readyQueues(waiting, waiting.concat(partial)).map(function (group) { return group.type; }), ['shortform']);
});

test('a queue slot becomes actionable only during its twenty-minute preparation window', function () {
  const now = Date.parse('2026-10-13T06:35:00.000Z');
  assert.equal(queue.preparationDue('2026-10-13T06:55:00.000Z', now), true);
  assert.equal(queue.preparationDue('2026-10-13T06:55:01.000Z', now), false);
  assert.equal(queue.preparationDue('2026-10-13T06:34:59.000Z', now), false);
});

test('an approval waiting ten days becomes the mandatory next release', function () {
  const old = piece('old-topic', 'short', 1, 'beliefs are emotional records formed from repeated experiences');
  old.publishingQueuedAt = '2026-09-20T00:00:00.000Z';
  const fresh = piece('fresh-topic', 'long_short', 2, 'why mutual cooperation improves a community');
  fresh.publishingQueuedAt = '2026-10-11T00:00:00.000Z';
  const history = [{
    id: 'recent-match', stage: 'live', contentType: 'short', postedAt: '2026-10-11T12:00:00.000Z',
    transcript: old.transcript
  }];
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const selected = queue.chooseCandidate([old, fresh], history, now);
  assert.equal(selected.piece.id, old.id);
  assert.equal(selected.ageForced, true);
  assert.ok(selected.queueWaitDays >= queue.MAX_QUEUE_WAIT_DAYS);
});
