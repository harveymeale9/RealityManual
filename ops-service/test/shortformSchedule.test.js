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

test('Monday and Thursday Buffer slots are the only shared short-form release times', function () {
  const custom = daily(['01:54']);
  custom.forEach(function (day) { day.paused = !['mon', 'thu'].includes(day.day); });
  custom.find(function (day) { return day.day === 'thu'; }).times = ['01:51'];
  assert.deepEqual(schedule.nextAvailableBangkokSlots(Date.parse('2026-11-03T04:00:00Z'), custom, [], 3), [
    '2026-11-04T18:51:00.000Z',
    '2026-11-08T18:54:00.000Z',
    '2026-11-11T18:51:00.000Z'
  ]);
  custom.forEach(function (day) { day.paused = true; });
  assert.throws(function () { schedule.nextBangkokSlot(Date.parse('2026-11-03T04:00:00Z'), custom); }, /No active short-form posting slot/);
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

test('longform uses Tuesday and Saturday at 10 p.m. Bangkok regardless of old anchor', function () {
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-14T17:47:00Z'), schedule.LONGFORM_ANCHOR, 168), '2026-11-17T15:00:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-17T14:59:59Z')), '2026-11-17T15:00:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-17T15:00:00Z')), '2026-11-21T15:00:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-21T15:00:00Z')), '2026-11-24T15:00:00.000Z');
});

test('occupied long-form slots never shift the fixed calendar', function () {
  assert.equal(schedule.normalizeLongformIntervalHours(48), 48);
  assert.equal(schedule.normalizeLongformIntervalHours(0), 168);
  assert.equal(schedule.normalizeLongformIntervalHours(2.5), 168);
  assert.deepEqual(schedule.nextAvailableLongformSlots(Date.parse('2026-11-14T17:47:00Z'), schedule.LONGFORM_ANCHOR, 60,
    ['2026-11-17T15:00:00.000Z'], 3), [
    '2026-11-21T15:00:00.000Z', '2026-11-24T15:00:00.000Z', '2026-11-28T15:00:00.000Z'
  ]);
});

test('the former immediate-release flag cannot bypass the next Tuesday slot', function () {
  const approval = Date.parse('2026-11-10T08:12:00.000Z');
  const first = schedule.nextLongformReleaseSlot(approval, schedule.LONGFORM_ANCHOR, 168, true);
  assert.equal(first, '2026-11-10T15:00:00.000Z');
  assert.equal(schedule.nextLongformReleaseSlot(Date.parse(first), first, 168, false), '2026-11-14T15:00:00.000Z');
});
