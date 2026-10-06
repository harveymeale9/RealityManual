'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const STOP_WORDS = new Set('a an and are as at be because been being but by can could did do does doing for from had has have he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves video videos reality manual people person thing things really basically kind gonna going get gets got make makes made say says said'.split(/\s+/));

function clean(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function stem(word) {
  if (word.length > 6 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function tokens(value, limit) {
  return clean(value).split(/\s+/).filter(function (word) {
    return word.length > 2 && !STOP_WORDS.has(word);
  }).slice(0, limit || 1600).map(stem);
}

function frequency(words) {
  const counts = new Map();
  words.forEach(function (word) { counts.set(word, Math.min(12, (counts.get(word) || 0) + 1)); });
  return counts;
}

function cosine(a, b) {
  if (!a.size || !b.size) return 0;
  let dot = 0, aNorm = 0, bNorm = 0;
  a.forEach(function (count, word) { aNorm += count * count; dot += count * (b.get(word) || 0); });
  b.forEach(function (count) { bNorm += count * count; });
  return dot / Math.sqrt(aNorm * bNorm);
}

function jaccard(a, b) {
  const left = new Set(a), right = new Set(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach(function (word) { if (right.has(word)) overlap++; });
  return overlap / (left.size + right.size - overlap);
}

function relatedPlanningSource(a, b) {
  const aRefs = [a && a.sourcePlanningPieceId, a && a.analysisMatchedPieceId].filter(Boolean);
  const bRefs = [b && b.sourcePlanningPieceId, b && b.analysisMatchedPieceId].filter(Boolean);
  return aRefs.some(function (id) { return bRefs.indexOf(id) !== -1 || id === (b && b.id); })
    || bRefs.some(function (id) { return id === (a && a.id); });
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (relatedPlanningSource(a, b)) return 1;
  if (clean(a.title) && clean(a.title) === clean(b.title)) return 0.95;
  const aTitle = tokens([a.title].concat(a.ytTitles || []).join(' '), 100);
  const bTitle = tokens([b.title].concat(b.ytTitles || []).join(' '), 100);
  const titleScore = jaccard(aTitle, bTitle);
  const tagScore = jaccard(tokens((a.tags || []).join(' '), 100), tokens((b.tags || []).join(' '), 100));
  const aBody = frequency(aTitle.concat(tokens(a.transcript, 1600)));
  const bBody = frequency(bTitle.concat(tokens(b.transcript, 1600)));
  const bodyScore = cosine(aBody, bBody);
  return Math.max(0, Math.min(1, titleScore * 0.48 + bodyScore * 0.44 + tagScore * 0.08));
}

function publicationTime(piece) {
  const value = piece && (piece.scheduledAt || piece.postedAt);
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function chooseSlot(piece, candidates, comparisonPieces, nowMs) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const slots = (candidates || []).map(function (value) { return typeof value === 'number' ? value : Date.parse(value); })
    .filter(function (value) { return Number.isFinite(value) && value > now; });
  if (!slots.length) throw new Error('No future publishing slot is available.');
  const comparisons = (comparisonPieces || []).map(function (other) {
    const time = publicationTime(other);
    if (!other || other.id === piece.id || time === null || time < now - 45 * DAY_MS) return null;
    const score = similarity(piece, other);
    // Philosophical videos inevitably share broad vocabulary such as action,
    // belief and emotion. Only a substantive match should delay a release;
    // weaker background overlap must not manufacture empty queue slots.
    return score >= 0.25 ? { piece: other, time: time, similarity: score } : null;
  }).filter(Boolean);

  const ranked = slots.map(function (slot, index) {
    let proximityPenalty = 0;
    comparisons.forEach(function (other) {
      const distanceDays = Math.abs(slot - other.time) / DAY_MS;
      const desiredDays = 2 + other.similarity * 8;
      const shortfall = Math.max(0, (desiredDays - distanceDays) / desiredDays);
      proximityPenalty += other.similarity * shortfall * shortfall * 4;
      if (other.similarity >= 0.35 && distanceDays < 1) proximityPenalty += other.similarity * 3;
    });
    return { slot: slot, index: index, score: proximityPenalty + index * 0.035 };
  }).sort(function (a, b) { return a.score - b.score || a.slot - b.slot; });

  const selected = ranked[0];
  const nearest = comparisons.map(function (other) {
    return Object.assign({}, other, { distanceDays: Math.abs(selected.slot - other.time) / DAY_MS });
  }).sort(function (a, b) {
    return b.similarity - a.similarity || a.distanceDays - b.distanceDays;
  })[0] || null;
  return {
    dueAt: new Date(selected.slot).toISOString(),
    slotIndex: selected.index,
    optimizationScore: Math.round(selected.score * 1000) / 1000,
    closestPieceId: nearest && nearest.piece.id || '',
    closestTitle: nearest && nearest.piece.title || '',
    similarity: nearest ? Math.round(nearest.similarity * 1000) / 1000 : 0,
    separationDays: nearest ? Math.round(nearest.distanceDays * 10) / 10 : null
  };
}

module.exports = { clean: clean, tokens: tokens, similarity: similarity, chooseSlot: chooseSlot, publicationTime: publicationTime };
