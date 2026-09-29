'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const retakes = require('../src/editorRetakeAnalysis');

test('long transcripts are fully covered by overlapping retake windows', function () {
  const words = Array.from({ length: 10400 }, function (_, index) { return { index: index }; });
  const windows = retakes.retakeWindows(words, 5000, 200);
  assert.deepEqual(windows.map(function (window) { return [window[0].index, window[window.length - 1].index]; }), [
    [0, 4999], [4800, 9799], [9600, 10399]
  ]);
  const covered = new Set(windows.flat().map(function (word) { return word.index; }));
  assert.equal(covered.size, words.length);
});

test('windowed retake analysis keeps later decisions and deduplicates overlap', async function () {
  const words = Array.from({ length: 11 }, function (_, index) { return { index: index }; });
  const visited = [];
  const result = await retakes.analyzeRetakesInWindows(words, async function (window, index) {
    visited.push(window.map(function (word) { return word.index; }));
    const duplicate = { removeStartIndex: 4, removeEndIndex: 4, replacementStartIndex: 5, replacementEndIndex: 5 };
    return { decisions: index === 0 ? [duplicate] : [duplicate, { removeStartIndex: 9, removeEndIndex: 9, replacementStartIndex: 10, replacementEndIndex: 10 }] };
  }, { maxWords: 6, overlapWords: 2 });
  assert.deepEqual(visited, [[0, 1, 2, 3, 4, 5], [4, 5, 6, 7, 8, 9], [8, 9, 10]]);
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions[1].removeStartIndex, 9);
});
