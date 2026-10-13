'use strict';

const topicSchedule = require('./topicSchedule');

const SHORT_TYPES = ['ultra_short', 'short', 'long_short'];

function normalizeTarget(value) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : 10;
}

function queuedAt(piece) {
  const parsed = Date.parse(piece && (piece.publishingQueuedAt || piece.updatedAt || piece.createdAt) || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function publishedAt(piece) {
  return topicSchedule.publicationTime(piece);
}

function candidatePool(queue, target) {
  const longs = queue.filter(function (piece) { return piece.contentType === 'longform'; });
  const shorts = queue.filter(function (piece) { return SHORT_TYPES.indexOf(piece.contentType) !== -1; });
  const longReserve = Math.min(target, Math.max(2, Math.round(target * 0.3)));
  const shortReserve = Math.max(0, target - longReserve);
  const longSurplus = longs.length - longReserve;
  const shortSurplus = shorts.length - shortReserve;

  if (longSurplus > 0 || shortSurplus > 0) {
    if (longSurplus > shortSurplus) return longs;
    if (shortSurplus > longSurplus) return shorts;
    return longs.concat(shorts);
  }
  return queue.slice();
}

function publicationHistory(allPieces) {
  return (allPieces || []).filter(function (piece) {
    return piece && (piece.stage === 'scheduled' || piece.stage === 'live') && publishedAt(piece) !== null;
  }).sort(function (a, b) { return publishedAt(b) - publishedAt(a); }).slice(0, 24);
}

function bestCandidate(candidates, queue, history) {
  const recentShorts = history.filter(function (piece) {
    return SHORT_TYPES.indexOf(piece.contentType) !== -1;
  }).slice(0, 4);
  const oldestFirst = queue.slice().sort(function (a, b) { return queuedAt(a) - queuedAt(b); });

  return candidates.map(function (piece) {
    const strongestTopicMatch = history.reduce(function (strongest, previous) {
      return Math.max(strongest, topicSchedule.similarity(piece, previous));
    }, 0);
    let typePenalty = 0;
    if (SHORT_TYPES.indexOf(piece.contentType) !== -1) {
      recentShorts.forEach(function (previous, index) {
        if (previous.contentType === piece.contentType) typePenalty += index === 0 ? 2.5 : 0.55;
      });
    }
    const ageRank = oldestFirst.indexOf(piece);
    return {
      piece: piece,
      score: strongestTopicMatch * 7 + typePenalty + Math.max(0, ageRank) * 0.08,
      strongestTopicMatch: strongestTopicMatch,
      typePenalty: typePenalty,
      ageRank: ageRank
    };
  }).sort(function (a, b) {
    return a.score - b.score || queuedAt(a.piece) - queuedAt(b.piece);
  })[0];
}

// A queue plan is deliberately generated only when the reserve overflows.
// The first item is released now; the rest become the visible best-current
// sequence. The next overflow recalculates from fresh Scheduled/Live history,
// so this is guidance rather than a prematurely fixed publishing calendar.
function planQueue(queue, allPieces, targetValue) {
  const target = normalizeTarget(targetValue);
  if (!Array.isArray(queue) || queue.length <= target) return null;

  const remaining = queue.slice();
  const history = publicationHistory(allPieces);
  const plan = [];

  while (remaining.length) {
    const candidates = plan.length ? remaining : candidatePool(remaining, target);
    const selected = bestCandidate(candidates, remaining, history);
    if (!selected || !selected.piece) break;
    plan.push(selected);
    remaining.splice(remaining.indexOf(selected.piece), 1);
    history.unshift(selected.piece);
  }

  return plan;
}

function chooseCandidate(queue, allPieces, targetValue) {
  const plan = planQueue(queue, allPieces, targetValue);
  return plan && plan.length ? plan[0] : null;
}

module.exports = {
  SHORT_TYPES: SHORT_TYPES,
  normalizeTarget: normalizeTarget,
  planQueue: planQueue,
  chooseCandidate: chooseCandidate
};
