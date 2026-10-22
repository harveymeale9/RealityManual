'use strict';

// Queue media may be large, but the viewing copy is intentionally small.
// Keep the original on disk until both the review copy and the R2 publish
// object are independently verified. Callers serialize invocations.
async function archiveReadyQueue(options) {
  const queued = options.list().filter(function (piece) {
    return piece.stage === 'publishing_queue' && !piece.localMediaReleasedAt &&
      Array.isArray(piece.queuedPublishDestinations) && piece.queuedPublishDestinations.length;
  });
  for (const candidate of queued) {
    const id = candidate.id;
    if (options.claimed(id)) continue;
    const current = options.get(id);
    if (!current || current.stage !== 'publishing_queue' || current.localMediaReleasedAt || !options.sourceExists(id)) continue;
    const review = options.reviewStatus(id, current);
    if (review.status !== 'ready') {
      if (review.status === 'error') options.warn(id, review.message || 'review copy unavailable');
      continue;
    }
    try {
      await options.ensureArchived(id);
      await options.ensureEditorSource(id);
      const latest = options.get(id);
      if (latest && latest.stage === 'publishing_queue' && !options.claimed(id)) {
        await options.releaseLocal(id, { keepReview: true });
      }
    } catch (error) {
      options.warn(id, String(error.message || error).slice(0, 300));
    }
  }
}

module.exports = { archiveReadyQueue };
