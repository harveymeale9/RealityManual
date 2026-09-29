'use strict';

function retakeWindows(words, maxWords, overlapWords) {
  const input = Array.isArray(words) ? words : [];
  const requestedSize = Number(maxWords);
  const requestedOverlap = Number(overlapWords);
  const size = Math.max(2, Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : 5000);
  const overlap = Math.max(0, Math.min(size - 1, Number.isFinite(requestedOverlap) && requestedOverlap >= 0 ? requestedOverlap : 200));
  if (!input.length) return [];
  const windows = [];
  const step = size - overlap;
  for (let start = 0; start < input.length; start += step) {
    windows.push(input.slice(start, Math.min(input.length, start + size)));
    if (start + size >= input.length) break;
  }
  return windows;
}

async function analyzeRetakesInWindows(words, analyzeWindow, options) {
  options = options || {};
  const windows = retakeWindows(words, options.maxWords, options.overlapWords);
  const decisions = [];
  const seen = new Set();
  for (let index = 0; index < windows.length; index++) {
    const result = await analyzeWindow(windows[index], index, windows.length);
    (Array.isArray(result && result.decisions) ? result.decisions : []).forEach(function (decision) {
      const key = [decision.removeStartIndex, decision.removeEndIndex,
        decision.replacementStartIndex, decision.replacementEndIndex].join(':');
      if (seen.has(key)) return;
      seen.add(key);
      decisions.push(decision);
    });
  }
  return { decisions: decisions };
}

module.exports = { retakeWindows, analyzeRetakesInWindows };
