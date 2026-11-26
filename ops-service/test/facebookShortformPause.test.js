'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/facebookShortformPause');

test('paused shorts lose only unpublished Facebook work', () => {
  const piece = {
    contentType: 'short', stage: 'scheduled', platforms: ['ytshort', 'instagram', 'facebook'],
    publishBatchPlatforms: ['ytshort', 'instagram', 'facebook'],
    scheduledPublishDestinations: [{ platform: 'instagram' }, { platform: 'facebook' }],
    publishRetryDestinations: [{ platform: 'facebook' }],
    facebookPublishStatus: 'error', facebookPublishError: 'old failure',
    facebookUploadVideoId: 'preserve-for-reconciliation'
  };
  assert.equal(policy.removeUnpublished(piece, false), true);
  assert.deepEqual(piece.platforms, ['ytshort', 'instagram']);
  assert.deepEqual(piece.publishBatchPlatforms, ['ytshort', 'instagram']);
  assert.deepEqual(piece.scheduledPublishDestinations, [{ platform: 'instagram' }]);
  assert.deepEqual(piece.publishRetryDestinations, []);
  assert.equal(piece.facebookPublishStatus, 'not_required');
  assert.equal(piece.facebookUploadVideoId, 'preserve-for-reconciliation');
  assert.equal(piece.facebookShortPausedWasSelected, true);
  assert.equal(policy.allowed(piece, { platform: 'facebook' }, false), false);
  assert.equal(policy.allowed(piece, { platform: 'instagram' }, false), true);
});

test('long-form Facebook, confirmed short history, and re-enabled shorts remain intact', () => {
  for (const piece of [
    { contentType: 'longform', platforms: ['ytlong', 'facebook'], facebookPublishStatus: 'queued' },
    { contentType: 'short', platforms: ['ytshort', 'facebook'], facebookPublishStatus: 'done' }
  ]) {
    const before = structuredClone(piece);
    assert.equal(policy.removeUnpublished(piece, false), false);
    assert.deepEqual(piece, before);
  }
  const short = { contentType: 'short', platforms: ['ytshort', 'facebook'] };
  assert.equal(policy.removeUnpublished(short, true), false);
  assert.equal(policy.allowed(short, { platform: 'facebook' }, true), true);
});

test('an old Facebook-only short returns to Final Check instead of sticking in queue', () => {
  const piece = { contentType: 'long_short', stage: 'publishing_queue',
    platforms: ['facebook'], queuedPublishDestinations: [{ platform: 'facebook' }],
    publishBatchPlatforms: ['facebook'] };
  assert.equal(policy.removeUnpublished(piece, false), true);
  assert.equal(piece.stage, 'final_check');
  assert.deepEqual(piece.queuedPublishDestinations, []);
  assert.deepEqual(piece.publishBatchPlatforms, []);
});
