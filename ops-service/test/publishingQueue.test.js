'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../src/publishingQueue');

function piece(id, type, queuedIndex, transcript) {
  return {
    id: id,
    contentType: type,
    transcript: transcript || id,
    publishingQueuedAt: new Date(Date.UTC(2026, 9, 1, queuedIndex)).toISOString(),
    stage: 'publishing_queue'
  };
}

test('queue target defaults to ten and accepts Harvey\'s planned range', function () {
  assert.equal(queue.normalizeTarget(undefined), 10);
  assert.equal(queue.normalizeTarget(undefined, 4), 4);
  assert.equal(queue.normalizeTarget(null, 4), 4);
  assert.equal(queue.normalizeTarget(8), 8);
  assert.equal(queue.normalizeTarget(15), 15);
  assert.equal(queue.normalizeTarget(999), 30);
});

test('cards are assigned to independent long-form and short-form reserves', function () {
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
  const selected = queue.chooseCandidate(items, history, 3);
  assert.equal(selected.piece.id, 'fresh-long-short');
});

test('equally suitable candidates release the oldest approval first', function () {
  const items = [piece('old', 'ultra_short', 1, 'unique alpha'), piece('new', 'ultra_short', 2, 'unique beta')];
  const selected = queue.chooseCandidate(items, [], 1);
  assert.equal(selected.piece.id, 'old');
});

test('queue planning does nothing until the reserve is exceeded', function () {
  const items = [];
  for (let index = 0; index < 10; index++) items.push(piece('s' + index, 'short', index));
  assert.equal(queue.planQueue(items.slice(0, 9), [], 10), null);
  assert.equal(queue.planQueue(items, [], 10), null);
});

test('a short-form overflow plans every card and releases the first planned item', function () {
  const items = [];
  for (let index = 0; index < 11; index++) items.push(piece('s' + index, index % 2 ? 'short' : 'long_short', index + 1, 'topic ' + index));

  const plan = queue.planQueue(items, [], 10);
  const selected = queue.chooseCandidate(items, [], 10);
  assert.equal(plan.length, 11);
  assert.equal(new Set(plan.map(function (entry) { return entry.piece.id; })).size, 11);
  assert.equal(selected.piece.id, plan[0].piece.id);
});

test('a long-form reserve can use its own four-video threshold', function () {
  const items = Array.from({ length: 5 }, function (_, index) { return piece('l' + index, 'longform', index + 1, 'long topic ' + index); });
  assert.equal(queue.planQueue(items.slice(0, 4), [], 4), null);
  assert.equal(queue.planQueue(items, [], 4).length, 5);
});
