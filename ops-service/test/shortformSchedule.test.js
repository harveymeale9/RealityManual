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

test('longform starts 23 October at 11 p.m. Bangkok and moves every 60 elapsed hours', function () {
  const anchor = schedule.LONGFORM_ANCHOR;
  assert.equal(anchor, '2026-10-23T16:00:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-10-22T15:00:00Z'), anchor, 60), anchor);
  assert.equal(schedule.nextLongformSlot(Date.parse(anchor), anchor, 60), '2026-10-26T04:00:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-10-26T04:00:00Z'), anchor, 60), '2026-10-28T16:00:00.000Z');
});

test('longform hour control validates whole hours and occupied slots never shift the cadence', function () {
  assert.equal(schedule.normalizeLongformIntervalHours(48), 48);
  assert.equal(schedule.normalizeLongformIntervalHours(0), 60);
  assert.equal(schedule.normalizeLongformIntervalHours(2.5), 60);
  assert.deepEqual(schedule.nextAvailableLongformSlots(Date.parse('2026-10-22T15:00:00Z'), schedule.LONGFORM_ANCHOR, 60,
    ['2026-10-26T04:00:00.000Z'], 3), [
    '2026-10-23T16:00:00.000Z', '2026-10-28T16:00:00.000Z', '2026-10-31T04:00:00.000Z'
  ]);
});
