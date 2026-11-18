'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const replay = require('../src/facebookReplay');

test('backfill runs only Wednesday Friday Sunday at 22:00 Bangkok', function () {
  assert.equal(replay.bangkokSlot(new Date('2026-11-18T15:00:00Z')), '2026-11-18');
  assert.equal(replay.bangkokSlot(new Date('2026-11-20T15:59:00Z')), '2026-11-20');
  assert.equal(replay.bangkokSlot(new Date('2026-11-22T15:00:00Z')), '2026-11-22');
  assert.equal(replay.bangkokSlot(new Date('2026-11-18T14:59:00Z')), '');
  assert.equal(replay.bangkokSlot(new Date('2026-11-18T16:00:00Z')), '');
  assert.equal(replay.bangkokSlot(new Date('2026-11-17T15:00:00Z')), '');
});

test('public old Facebook videos are not selected for duplicate replay', function () {
  const jobs = [
    { old_video_id: 'old1', status: 'pending' },
    { old_video_id: 'old2', status: 'pending' },
    { old_video_id: 'old3', status: 'done' }
  ];
  assert.equal(replay.eligibleJob(jobs, new Set(['old1'])), jobs[1]);
  assert.equal(replay.eligibleJob(jobs, new Set(['old1', 'old2'])), null);
});
