'use strict';

const topicSchedule = require('./topicSchedule');

const SHORT_TYPES = ['ultra_short', 'short', 'long_short'];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE_WAIT_DAYS = 10;

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

// Plan from the videos that are actually waiting at the moment a cadence slot
// becomes available. Nothing is pre-planned merely because another approval
// entered the queue; fresh Scheduled/Live history informs every choice.
function planQueue(queue, allPieces, nowValue) {
  if (!Array.isArray(queue) || !queue.length) return [];
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

function chooseCandidate(queue, allPieces, nowValue) {
  const plan = planQueue(queue, allPieces, nowValue);
  return plan.length ? plan[0] : null;
}

// Long-form and short-form have independent cadences. A format needs its next
// item selected only when it has waiting videos and no item already committed
// to Scheduled. The queue's size is therefore natural inventory, not a target.
function readyQueues(queue, allPieces) {
  const queued = Array.isArray(queue) ? queue : [];
  const occupied = new Set((Array.isArray(allPieces) ? allPieces : []).filter(function (piece) {
    return piece && piece.stage === 'scheduled';
  }).map(queueType));
  return ['longform', 'shortform'].map(function (type) {
    return { type: type, pieces: queued.filter(function (piece) { return queueType(piece) === type; }) };
  }).filter(function (group) {
    return group.pieces.length && !occupied.has(group.type);
  });
}

module.exports = {
  SHORT_TYPES: SHORT_TYPES,
  MAX_QUEUE_WAIT_DAYS: MAX_QUEUE_WAIT_DAYS,
  queueType: queueType,
  planQueue: planQueue,
  chooseCandidate: chooseCandidate,
  readyQueues: readyQueues
};
