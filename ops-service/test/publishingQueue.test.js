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
  assert.equal(queue.normalizeTarget(8), 8);
  assert.equal(queue.normalizeTarget(15), 15);
  assert.equal(queue.normalizeTarget(999), 30);
});

test('rolling reserve preserves roughly three longforms in a ten-video queue', function () {
  const items = [
    piece('l1', 'longform', 1), piece('l2', 'longform', 2),
    piece('l3', 'longform', 3), piece('l4', 'longform', 4)
  ];
  for (let index = 0; index < 7; index++) items.push(piece('s' + index, 'short', index + 5));
  const selected = queue.chooseCandidate(items, [], 10);
  assert.equal(selected.piece.contentType, 'longform');
});

test('rolling reserve releases shortform when its side exceeds capacity', function () {
  const items = [piece('l1', 'longform', 1), piece('l2', 'longform', 2), piece('l3', 'longform', 3)];
  for (let index = 0; index < 8; index++) items.push(piece('s' + index, index === 0 ? 'ultra_short' : 'short', index + 4));
  const selected = queue.chooseCandidate(items, [], 10);
  assert.notEqual(selected.piece.contentType, 'longform');
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

test('an overflow plans every card and releases the first planned item', function () {
  const items = [
    piece('l1', 'longform', 1), piece('l2', 'longform', 2), piece('l3', 'longform', 3)
  ];
  for (let index = 0; index < 8; index++) {
    items.push(piece('s' + index, index % 2 ? 'short' : 'long_short', index + 4, 'topic ' + index));
  }

  const plan = queue.planQueue(items, [], 10);
  const selected = queue.chooseCandidate(items, [], 10);
  assert.equal(plan.length, 11);
  assert.equal(new Set(plan.map(function (entry) { return entry.piece.id; })).size, 11);
  assert.equal(selected.piece.id, plan[0].piece.id);
  assert.notEqual(plan[0].piece.contentType, 'longform');
});
