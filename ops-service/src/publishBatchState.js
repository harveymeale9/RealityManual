'use strict';

function statusField(platform) {
  if (platform === 'ytlong' || platform === 'ytshort') return 'youtubePublishStatus';
  if (platform === 'tiktok') return 'tiktokPublishStatus';
  if (platform === 'instagram') return 'instagramPublishStatus';
  return 'facebookPublishStatus';
}

// A Buffer post can turn "sent" while the direct YouTube/Meta uploads are
// still finishing. Conversely, those uploads can finish after Buffer already
// reported "sent". Both paths must make the same final stage decision.
function completedStage(piece, platforms) {
  const targets = Array.isArray(platforms) && platforms.length ? platforms : ['tiktok'];
  if (targets.some(function (platform) { return piece[statusField(platform)] === 'error'; })) return 'final_check';
  if (!targets.every(function (platform) { return piece[statusField(platform)] === 'done'; })) return null;
  if (targets.includes('tiktok') && piece.tiktokBufferStatus !== 'sent') return 'scheduled';
  return 'live';
}

function applyBufferSnapshot(latest, snapshot) {
  if (latest.tiktokBufferStatus === 'sent' && snapshot.tiktokBufferStatus !== 'sent') return false;
  ['scheduledAt', 'postedAt', 'tiktokPublishStatus', 'tiktokPublishError',
    'tiktokBufferStatus', 'tiktokBufferCheckedAt', 'tiktokExternalLink',
    'tiktokBufferSupportUrl', 'tiktokMetrics', 'tiktokMetricsUpdatedAt'].forEach(function (field) {
    latest[field] = snapshot[field];
  });
  latest.stage = snapshot.tiktokPublishStatus === 'error' ? 'final_check' :
    (completedStage(latest, latest.publishBatchPlatforms) || 'scheduled');
  return true;
}

module.exports = { completedStage, applyBufferSnapshot, statusField };
