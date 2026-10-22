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
  if (targets.some(function (platform) { return piece[statusField(platform)] === 'error'; })) {
    // A partial release is not a failed Final Check. At least one destination
    // is already public; keep the card in Live while that failed destination
    // is retried independently. Before anything is public, keep it Scheduled.
    const publiclyPosted = targets.some(function (platform) {
      return platform === 'tiktok' ? piece.tiktokBufferStatus === 'sent' : piece[statusField(platform)] === 'done';
    });
    return publiclyPosted ? 'live' : 'scheduled';
  }
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
  latest.stage = completedStage(latest, latest.publishBatchPlatforms) || 'scheduled';
  return true;
}

module.exports = { completedStage, applyBufferSnapshot, statusField };
