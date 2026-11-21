'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const replay = require('../src/facebookReplay');

test('backfill runs only Wednesday Friday Sunday at or after 5:45 a.m. Bangkok', function () {
  assert.equal(replay.bangkokSlot(new Date('2026-11-17T22:45:00Z')), '2026-11-18');
  assert.equal(replay.bangkokSlot(new Date('2026-11-19T22:46:00Z')), '');
  assert.equal(replay.bangkokSlot(new Date('2026-11-21T22:45:00Z')), '');
  assert.equal(replay.bangkokSlot(new Date('2026-11-24T22:45:00Z')), '2026-11-25');
  assert.equal(replay.bangkokSlot(new Date('2026-11-17T22:44:00Z')), '');
  assert.equal(replay.bangkokSlot(new Date('2026-11-17T22:59:00Z')), '2026-11-18');
  assert.equal(replay.bangkokSlot(new Date('2026-11-16T22:45:00Z')), '');
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
