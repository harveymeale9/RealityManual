'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { splitForSpeech } = require('../src/speechText');

test('long speech is split on sentence boundaries without losing text', function () {
  const sentences = Array.from({ length: 18 }, function (_, index) {
    return 'Sentence ' + (index + 1) + ' explains one useful part of the editor workflow clearly.';
  });
  const source = sentences.join(' ');
  const parts = splitForSpeech(source, 240);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(function (part) { return part.length <= 240; }));
  assert.equal(parts.join(' '), source);
});

test('speech splitting falls back to words and preserves a final short part', function () {
  const source = Array.from({ length: 90 }, function (_, index) { return 'word' + index; }).join(' ');
  const parts = splitForSpeech(source, 200);
  assert.ok(parts.length > 2);
  assert.ok(parts.every(function (part) { return part.length <= 200; }));
  assert.equal(parts.join(' '), source);
});
