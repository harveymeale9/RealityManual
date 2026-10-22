'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const coverage = require('../public/lib/queueCoverage');
const cadence = require('../src/shortformSchedule');

const NOW = Date.parse('2026-10-15T15:36:00Z');
const DAILY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map(function (day) {
  return { day: day, paused: false, times: ['01:55'] };
});
function ready(id, type) {
  return { id: id, contentType: type, hasVideo: true, stage: 'publishing_queue', queuedPublishDestinations: [{ platform: 'youtube' }] };
}

test('runway follows the fixed 60-hour long-form sequence, not previous publication dates', function () {
  const pieces = [
    { id: 'published', contentType: 'longform', stage: 'live', postedAt: '2026-10-15T11:05:58Z' },
    ready('next', 'longform')
  ];
  const result = coverage.calculate({ pieces: pieces, now: NOW, longformAnchor: cadence.LONGFORM_ANCHOR,
    longformIntervalHours: 60, postingSchedule: DAILY });
  assert.equal(new Date(result.longform.coveredThrough).toISOString(), '2026-10-23T16:00:00.000Z');
  assert.equal(new Date(result.longform.nextNeededAt).toISOString(), '2026-10-26T03:40:00.000Z');
  assert.equal(result.longform.coveredSlots, 1);
  assert.equal(result.longform.readyCount, 1);
  assert.equal(result.longform.timeline.length, 15);
  assert.equal(result.longform.timeline[0].state, 'queued');
  assert.equal(result.longform.timeline[1].state, 'open');
  assert.equal(result.longform.timeline[0].at,
    Date.parse(cadence.nextAvailableLongformSlots(NOW, cadence.LONGFORM_ANCHOR, 60, [pieces[0].postedAt], 1)[0]));
  assert.equal(new Date(result.longform.timeline[14].at).toISOString(), '2026-11-27T16:00:00.000Z');
});

test('changing hours moves the long-form chart while the 15-day short map stays intact', function () {
  const at = Date.parse('2026-10-22T12:00:00Z');
  const result = coverage.calculate({ pieces: [], now: at, longformAnchor: cadence.LONGFORM_ANCHOR,
    longformIntervalHours: 48, postingSchedule: DAILY });
  assert.equal(new Date(result.longform.timeline[1].at).toISOString(), '2026-10-25T16:00:00.000Z');
  assert.equal(result.days.length, 15);
});

test('short-form runway counts the actual Buffer calendar and scheduled inventory', function () {
  const pieces = [
    { id: 'sent', contentType: 'short', stage: 'live', scheduledAt: '2026-10-14T18:55:00Z' },
    { id: 'scheduled', contentType: 'short', stage: 'scheduled', scheduledAt: '2026-10-15T18:55:00Z' },
    ready('one', 'short'), ready('two', 'ultra_short'), ready('three', 'long_short')
  ];
  const result = coverage.calculate({ pieces: pieces, now: NOW, postingSchedule: DAILY }).shortform;
  assert.equal(result.estimated, false);
  assert.equal(result.coveredSlots, 4);
  assert.equal(result.timeline[0].state, 'scheduled');
  assert.equal(result.timeline[1].state, 'queued');
  assert.equal(new Date(result.nextNeededAt).toISOString(), '2026-10-19T18:35:00.000Z');
});

test('when Buffer is unavailable, short dates are labelled estimates from the last real slot', function () {
  const pieces = [{ id: 'last', contentType: 'short', stage: 'live', scheduledAt: '2026-10-14T19:03:20Z' }, ready('one', 'short')];
  const result = coverage.calculate({ pieces: pieces, now: NOW }).shortform;
  assert.equal(result.estimated, true);
  assert.equal(new Date(result.coveredThrough).toISOString(), '2026-10-15T19:03:20.000Z');
  assert.equal(new Date(result.nextNeededAt).toISOString(), '2026-10-16T18:43:20.000Z');
  assert.equal(coverage.calculate({ pieces: [ready('one', 'short')], now: NOW }).shortform.nextNeededAt, null);
});

test('Final Check does not count as ready and paused Buffer days cannot be promised', function () {
  const fridayOnly = DAILY.map(function (day) { return Object.assign({}, day, { paused: day.day !== 'fri' }); });
  const pieces = [{ id: 'unapproved', contentType: 'short', hasVideo: true, stage: 'final_check' }];
  const result = coverage.calculate({ pieces: pieces, now: NOW, postingSchedule: fridayOnly }).shortform;
  assert.equal(result.readyCount, 0);
  assert.equal(result.coveredSlots, 0);
  assert.equal(new Date(result.timeline[0].at).toISOString(), '2026-10-15T18:55:00.000Z');
  assert.equal(new Date(result.timeline[1].at).toISOString(), '2026-10-22T18:55:00.000Z');
});

test('15-day map starts today in Bangkok and marks every slot separately', function () {
  const twiceDaily = DAILY.map(function (day) { return Object.assign({}, day, { times: ['12:00', '14:00'] }); });
  const now = Date.parse('2026-10-15T01:00:00Z'); // 08:00 on 15 October in Bangkok
  const pieces = [
    { id: 'scheduled', contentType: 'short', stage: 'scheduled', scheduledAt: '2026-10-15T05:00:00Z' },
    ready('next', 'short')
  ];
  const result = coverage.calculate({ pieces: pieces, now: now, postingSchedule: twiceDaily });
  assert.equal(result.days.length, 15);
  assert.equal(new Date(result.days[0].at).toISOString(), '2026-10-14T17:00:00.000Z');
  assert.equal(new Date(result.days[14].at).toISOString(), '2026-10-28T17:00:00.000Z');
  assert.deepEqual(result.days[0].shortform.map(function (slot) { return slot.state; }), ['scheduled', 'queued']);
  assert.deepEqual(result.days[1].shortform.map(function (slot) { return slot.state; }), ['open', 'open']);
  assert.equal(result.days[0].today, true);
  assert.equal(result.days[1].today, false);
});

test('today shows posts already published without using them to cover future slots', function () {
  const now = Date.parse('2026-10-15T23:00:00Z'); // 06:00 Friday in Bangkok
  const pieces = [
    { id: 'live-short', contentType: 'short', stage: 'live', postedAt: '2026-10-15T18:56:47Z', scheduledAt: '2026-10-15T18:55:00Z' },
    { id: 'yesterday', contentType: 'longform', stage: 'live', postedAt: '2026-10-15T10:00:00Z' },
    ready('next-short', 'short')
  ];
  const noonSchedule = DAILY.map(function (day) { return Object.assign({}, day, { times: ['12:00'] }); });
  const result = coverage.calculate({ pieces: pieces, now: now, postingSchedule: noonSchedule });
  assert.deepEqual(result.days[0].publishedShortform.map(function (slot) { return slot.state; }), ['published']);
  assert.equal(result.days[0].publishedShortform[0].at, Date.parse(pieces[0].postedAt));
  assert.deepEqual(result.days[0].publishedLongform, []);
  assert.equal(result.days[0].shortform[0].state, 'queued');
  assert.equal(result.shortform.readyCount, 1);
  assert.equal(result.shortform.coveredSlots, 1);
});
