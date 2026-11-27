'use strict';

const { isShortform } = require('./shortformSchedule');

function paused(piece, enabled) {
  return !enabled && isShortform(piece);
}

function allowed(piece, destination, enabled) {
  return !(paused(piece, enabled) && destination && destination.platform === 'facebook');
}

// Keep confirmed Facebook history and all Meta credentials intact. Only
// remove work that has not been published through this app yet.
function removeUnpublished(piece, enabled) {
  if (!paused(piece, enabled) || piece.facebookPublishStatus === 'done') return false;
  let changed = false;
  if (Array.isArray(piece.platforms) && piece.platforms.includes('facebook')) {
    piece.platforms = piece.platforms.filter((platform) => platform !== 'facebook');
    piece.facebookShortPausedWasSelected = true;
    changed = true;
  }
  for (const field of ['queuedPublishDestinations', 'publishBatchDestinations', 'scheduledPublishDestinations', 'publishRetryDestinations']) {
    if (!Array.isArray(piece[field]) || !piece[field].some((destination) => destination.platform === 'facebook')) continue;
    piece[field] = piece[field].filter((destination) => destination.platform !== 'facebook');
    changed = true;
  }
  if (Array.isArray(piece.publishBatchPlatforms) && piece.publishBatchPlatforms.includes('facebook')) {
    piece.publishBatchPlatforms = piece.publishBatchPlatforms.filter((platform) => platform !== 'facebook');
    changed = true;
  }
  if (!changed) return false;
  piece.facebookPublishStatus = 'not_required';
  piece.facebookPublishError = '';
  if (Array.isArray(piece.publishRetryDestinations) && !piece.publishRetryDestinations.length) {
    piece.publishRetryNextAt = '';
    piece.publishRetryAttempts = 0;
  }
  if (piece.directShortPublishStatus === 'scheduled' &&
      Array.isArray(piece.scheduledPublishDestinations) && !piece.scheduledPublishDestinations.length) {
    piece.directShortPublishStatus = 'not_required';
  }
  if (piece.stage === 'publishing_queue' && Array.isArray(piece.queuedPublishDestinations) &&
      !piece.queuedPublishDestinations.length) piece.stage = 'final_check';
  return true;
}

function restoreUnpublished(piece, enabled, destination) {
  if (!enabled || !isShortform(piece) || !piece.facebookShortPausedWasSelected ||
      piece.facebookPublishStatus === 'done' || piece.stage === 'live' ||
      !Array.isArray(piece.platforms) || piece.platforms.includes('facebook')) return false;
  piece.platforms.push('facebook');
  if (piece.stage === 'publishing_queue' && Array.isArray(piece.queuedPublishDestinations) &&
      piece.queuedPublishDestinations.length && destination) {
    for (const field of ['queuedPublishDestinations', 'publishBatchDestinations']) {
      if (Array.isArray(piece[field]) && !piece[field].some((item) => item.platform === 'facebook')) {
        piece[field].push({ ...destination });
      }
    }
    if (Array.isArray(piece.publishBatchPlatforms) && !piece.publishBatchPlatforms.includes('facebook')) {
      piece.publishBatchPlatforms.push('facebook');
    }
    piece.facebookPublishStatus = 'queued';
    piece.facebookPublishError = '';
  }
  piece.facebookShortPausedWasSelected = false;
  return true;
}

module.exports = { paused, allowed, removeUnpublished, restoreUnpublished };
