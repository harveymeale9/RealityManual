'use strict';

const topicSchedule = require('./topicSchedule');

const SHORT_TYPES = ['ultra_short', 'short', 'long_short'];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE_WAIT_DAYS = 10;

function normalizeTarget(value, fallbackValue) {
  const parsed = value === null || value === undefined || value === '' ? NaN : Math.round(Number(value));
  const fallback = Number.isFinite(Number(fallbackValue)) ? Math.round(Number(fallbackValue)) : 10;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : Math.max(1, Math.min(30, fallback));
}

function queuedAt(piece) {
  const parsed = Date.parse(piece && (piece.publishingQueuedAt || piece.updatedAt || piece.createdAt) || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function publishedAt(piece) {
  return topicSchedule.publicationTime(piece);
}

function queueType(piece) {
  return piece && piece.contentType === 'longform' ? 'longform' : 'shortform';
}

function publicationHistory(allPieces) {
  return (allPieces || []).filter(function (piece) {
    return piece && (piece.stage === 'scheduled' || piece.stage === 'live') && publishedAt(piece) !== null;
  }).sort(function (a, b) { return publishedAt(b) - publishedAt(a); }).slice(0, 24);
}

function bestCandidate(candidates, queue, history, nowValue) {
  const now = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
  const recentShorts = history.filter(function (piece) {
    return SHORT_TYPES.indexOf(piece.contentType) !== -1;
  }).slice(0, 4);
  const oldestFirst = queue.slice().sort(function (a, b) { return queuedAt(a) - queuedAt(b); });
  const oldest = oldestFirst[0];
  const oldestWaitDays = oldest ? Math.max(0, (now - queuedAt(oldest)) / DAY_MS) : 0;
  const forcedOldest = oldest && oldestWaitDays >= MAX_QUEUE_WAIT_DAYS && candidates.indexOf(oldest) !== -1 ? oldest : null;
  const eligible = forcedOldest ? [forcedOldest] : candidates;

  return eligible.map(function (piece) {
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
      ageRank: ageRank,
      ageForced: piece === forcedOldest,
      queueWaitDays: Math.max(0, (now - queuedAt(piece)) / DAY_MS)
    };
  }).sort(function (a, b) {
    return a.score - b.score || queuedAt(a.piece) - queuedAt(b.piece);
  })[0];
}

// A queue plan is deliberately generated only when the reserve overflows.
// The first item is released now; the rest become the visible best-current
// sequence. The next overflow recalculates from fresh Scheduled/Live history,
// so this is guidance rather than a prematurely fixed publishing calendar.
function planQueue(queue, allPieces, targetValue, nowValue) {
  const target = normalizeTarget(targetValue);
  if (!Array.isArray(queue) || queue.length <= target) return null;

  const remaining = queue.slice();
  const history = publicationHistory(allPieces);
  const plan = [];

  while (remaining.length) {
    const selected = bestCandidate(remaining, remaining, history, nowValue);
    if (!selected || !selected.piece) break;
    plan.push(selected);
    remaining.splice(remaining.indexOf(selected.piece), 1);
    history.unshift(selected.piece);
  }

  return plan;
}

function chooseCandidate(queue, allPieces, targetValue, nowValue) {
  const plan = planQueue(queue, allPieces, targetValue, nowValue);
  return plan && plan.length ? plan[0] : null;
}

module.exports = {
  SHORT_TYPES: SHORT_TYPES,
  MAX_QUEUE_WAIT_DAYS: MAX_QUEUE_WAIT_DAYS,
  normalizeTarget: normalizeTarget,
  queueType: queueType,
  planQueue: planQueue,
  chooseCandidate: chooseCandidate
};
