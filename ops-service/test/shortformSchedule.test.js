'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('Friday and Sunday 5:45 a.m. Bangkok are the shared short-form release times', function () {
  const custom = schedule.SHORTFORM_POSTING_SCHEDULE;
  assert.deepEqual(schedule.nextAvailableBangkokSlots(Date.parse('2026-11-03T04:00:00Z'), custom, [], 3), [
    '2026-11-05T22:45:00.000Z',
    '2026-11-07T22:45:00.000Z',
    '2026-11-12T22:45:00.000Z'
  ]);
  assert.throws(function () { schedule.nextBangkokSlot(Date.parse('2026-11-03T04:00:00Z'), custom.map(function (day) {
    return Object.assign({}, day, { paused: true });
  })); }, /No active short-form posting slot/);
});

test('linked shorts wait seven full days after the long-form actually goes live', function () {
  const short = { id: 'short', contentType: 'long_short', relatedLongformPieceId: 'long' };
  const planned = { id: 'long', contentType: 'longform', stage: 'scheduled', scheduledAt: '2026-11-20T22:45:00Z' };
  assert.equal(schedule.shortformEligibleAt(short, [short, planned], '2026-11-29T22:45:00Z'), false);
  const live = Object.assign({}, planned, { stage: 'live', postedAt: '2026-11-21T00:00:00Z' });
  assert.equal(schedule.shortformEligibleAt(short, [short, live], '2026-11-27T23:59:59Z'), false);
  assert.equal(schedule.shortformEligibleAt(short, [short, live], '2026-11-28T00:00:00Z'), true);
  assert.equal(schedule.shortformEligibleAt({ contentType: 'short' }, [live], '2026-11-22T22:45:00Z'), true);
});

test('a short linked to an unfilmed outline waits for that exact long-form video', function () {
  const short = { id: 'short-video', contentType: 'long_short', relatedLongformPieceId: 'long-outline' };
  const outline = { id: 'long-outline', contentType: 'longform', hasVideo: false, stage: 'uploaded', editorProjectId: 'long-video' };
  const unrelated = { id: 'other-video', contentType: 'longform', hasVideo: true, stage: 'live', postedAt: '2026-11-01T00:00:00Z' };
  const video = { id: 'long-video', contentType: 'longform', hasVideo: true, sourcePlanningPieceId: 'long-outline', stage: 'scheduled', scheduledAt: '2026-11-21T00:00:00Z' };
  const due = '2026-11-28T00:00:00Z';
  assert.equal(schedule.shortformEligibleAt(short, [short, outline, unrelated], due), false);
  assert.equal(schedule.shortformEligibleAt(short, [short, outline, unrelated, video], due), false);
  video.stage = 'live';
  video.postedAt = '2026-11-21T00:00:00Z';
  assert.equal(schedule.shortformEligibleAt(short, [short, outline, unrelated, video], '2026-11-27T23:59:59Z'), false);
  assert.equal(schedule.shortformEligibleAt(short, [short, outline, unrelated, video], due), true);
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

test('longform uses Tuesday and Saturday at 5:45 a.m. Bangkok regardless of old anchor', function () {
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-14T17:47:00Z'), schedule.LONGFORM_ANCHOR, 168), '2026-11-16T22:45:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-16T22:44:59Z')), '2026-11-16T22:45:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-16T22:45:00Z')), '2026-11-23T22:45:00.000Z');
  assert.equal(schedule.nextLongformSlot(Date.parse('2026-11-21T15:00:00Z')), '2026-11-23T22:45:00.000Z');
});

test('occupied long-form slots never shift the fixed calendar', function () {
  assert.equal(schedule.normalizeLongformIntervalHours(48), 48);
  assert.equal(schedule.normalizeLongformIntervalHours(0), 168);
  assert.equal(schedule.normalizeLongformIntervalHours(2.5), 168);
  assert.deepEqual(schedule.nextAvailableLongformSlots(Date.parse('2026-11-14T17:47:00Z'), schedule.LONGFORM_ANCHOR, 60,
    ['2026-11-16T22:45:00.000Z'], 3), [
    '2026-11-23T22:45:00.000Z', '2026-11-27T22:45:00.000Z', '2026-11-30T22:45:00.000Z'
  ]);
});

test('the former immediate-release flag cannot bypass the next Tuesday slot', function () {
  const approval = Date.parse('2026-11-10T08:12:00.000Z');
  const first = schedule.nextLongformReleaseSlot(approval, schedule.LONGFORM_ANCHOR, 168, true);
  assert.equal(first, '2026-11-13T22:45:00.000Z');
  assert.equal(schedule.nextLongformReleaseSlot(Date.parse(first), first, 168, false), '2026-11-16T22:45:00.000Z');
});

test('the two approved legacy long-forms reserve Tuesday then Saturday without moving existing specials', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('const ONE_OFF_MONEY_ID =');
  const end = source.indexOf('async function advanceQueuedLongformYouTube()', start);
  assert.ok(start > 0 && end > start);
  const choose = vm.runInNewContext(source.slice(start, end) + '\nadvancedLongformSlot', {
    Date, shortformSchedule: schedule
  });
  const queued = function (id) { return {
    id, contentType: 'longform', stage: 'publishing_queue', publishingQueuedAt: '2026-11-15T09:00:00.000Z',
    queuedPublishDestinations: [{ platform: 'ytlong' }]
  }; };
  const watch = queued('652f9e11-5658-4fe7-b9e8-04a46421b429');
  const reinvent = queued('0ca49b70-7d12-49b5-a6a6-3cfc82bf1889');
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  assert.equal(choose(watch, [watch, reinvent], now), '2026-11-23T22:45:00.000Z');
  assert.equal(choose(reinvent, [watch, reinvent], now), '2026-11-27T22:45:00.000Z');
  assert.equal(choose(queued('other-old-card'), [watch, reinvent], now), '');
  assert.equal(choose(watch, [watch, reinvent, { id: 'collision', stage: 'scheduled',
    scheduledAt: '2026-11-23T22:45:00.000Z' }], now), '');
});
