'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const schedule = require('../src/shortformSchedule');

function daily(times) {
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(function (day) {
    return { day: day, paused: false, times: times };
  });
}

test('short-form slots are midnight and noon in Bangkok, not server-local time', function () {
  assert.equal(schedule.nextBangkokSlot(Date.parse('2026-09-28T04:59:59Z'), daily(['00:00', '12:00'])), '2026-09-28T05:00:00.000Z');
  assert.equal(schedule.nextBangkokSlot(Date.parse('2026-09-28T05:00:00Z'), daily(['00:00', '12:00'])), '2026-09-28T17:00:00.000Z');
  assert.equal(schedule.nextBangkokSlot(Date.parse('2026-09-28T17:00:00Z'), daily(['00:00', '12:00'])), '2026-09-29T05:00:00.000Z');
});

test('Buffer day pauses and changed slots remain authoritative', function () {
  const custom = daily(['01:30', '13:30']);
  custom.find(function (day) { return day.day === 'mon'; }).paused = true;
  assert.equal(schedule.nextBangkokSlot(Date.parse('2026-09-27T18:00:00Z'), custom), '2026-09-28T18:30:00.000Z');
});

test('missing Buffer schedule safely falls back to two daily GMT+7 slots', function () {
  assert.equal(schedule.nextBangkokSlot(Date.parse('2026-09-28T06:00:00Z'), []), '2026-09-28T17:00:00.000Z');
  assert.equal(schedule.isShortform({ contentType: 'short' }), true);
  assert.equal(schedule.isShortform({ contentType: 'longform' }), false);
});

test('topic scheduler can fill open short-form slots instead of appending after a distant reservation', function () {
  const start = Date.parse('2026-09-28T04:00:00Z');
  assert.deepEqual(schedule.nextAvailableBangkokSlots(start, daily(['00:00', '12:00']), [
    '2026-09-28T05:00:00.000Z', '2026-09-29T17:00:00.000Z'
  ], 3), [
    '2026-09-28T17:00:00.000Z', '2026-09-29T05:00:00.000Z', '2026-09-30T05:00:00.000Z'
  ]);
});

test('longform uses the chosen Bangkok time on a three-day calendar rhythm', function () {
  assert.equal(
    schedule.nextBangkokLongformSlot(Date.parse('2026-09-28T00:00:00Z'), '07:55', null),
    '2026-09-28T00:55:00.000Z'
  );
  assert.equal(
    schedule.nextBangkokLongformSlot(Date.parse('2026-09-28T02:00:00Z'), '07:55', null),
    '2026-09-29T00:55:00.000Z'
  );
  assert.equal(
    schedule.nextBangkokLongformSlot(Date.parse('2026-09-29T00:00:00Z'), '07:55', '2026-09-28T00:55:00.000Z'),
    '2026-10-01T00:55:00.000Z'
  );
});

test('longform time input is normalized and safely defaults to the shorts midpoint', function () {
  assert.equal(schedule.normalizeLongformTime('19:05'), '19:05');
  assert.equal(schedule.normalizeLongformTime('bad'), '07:55');
});

test('topic scheduler retains the three-day longform rhythm while filling intentional gaps', function () {
  assert.deepEqual(schedule.nextAvailableBangkokLongformSlots(
    Date.parse('2026-09-29T02:00:00Z'), '07:55',
    ['2026-09-28T00:55:00.000Z', '2026-10-04T00:55:00.000Z'], 3
  ), [
    '2026-10-01T00:55:00.000Z', '2026-10-07T00:55:00.000Z', '2026-10-10T00:55:00.000Z'
  ]);
});
