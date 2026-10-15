'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { completedStage, applyBufferSnapshot } = require('../src/publishBatchState');

const platforms = ['ytshort', 'tiktok', 'instagram', 'facebook'];

test('a sent TikTok post remains Scheduled until the other platform uploads finish', function () {
  const piece = {
    youtubePublishStatus: 'running', tiktokPublishStatus: 'done',
    instagramPublishStatus: 'done', facebookPublishStatus: 'done', tiktokBufferStatus: 'sent'
  };
  assert.equal(completedStage(piece, platforms), null);
  piece.youtubePublishStatus = 'done';
  assert.equal(completedStage(piece, platforms), 'live');
});

test('a finished direct batch stays Scheduled only while Buffer has not sent TikTok', function () {
  const piece = {
    youtubePublishStatus: 'done', tiktokPublishStatus: 'done',
    instagramPublishStatus: 'done', facebookPublishStatus: 'done', tiktokBufferStatus: 'scheduled'
  };
  assert.equal(completedStage(piece, platforms), 'scheduled');
  piece.tiktokBufferStatus = 'sent';
  assert.equal(completedStage(piece, platforms), 'live');
  piece.facebookPublishStatus = 'error';
  assert.equal(completedStage(piece, platforms), 'final_check');
});

test('a late Buffer response merges with the newest direct-upload statuses', function () {
  const latest = {
    stage: 'scheduled', publishBatchPlatforms: platforms, youtubePublishStatus: 'done',
    tiktokPublishStatus: 'done', instagramPublishStatus: 'done', facebookPublishStatus: 'done',
    tiktokBufferStatus: 'scheduled'
  };
  const snapshot = { stage: 'scheduled', tiktokPublishStatus: 'done', tiktokBufferStatus: 'sent',
    postedAt: '2026-10-15T18:56:47Z' };
  assert.equal(applyBufferSnapshot(latest, snapshot), true);
  assert.equal(latest.stage, 'live');
  assert.equal(latest.postedAt, snapshot.postedAt);
  assert.equal(applyBufferSnapshot(latest, { tiktokPublishStatus: 'done', tiktokBufferStatus: 'scheduled' }), false);
  assert.equal(latest.stage, 'live');
});
