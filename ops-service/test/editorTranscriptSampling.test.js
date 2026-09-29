'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sampling = require('../src/editorTranscriptSampling');

test('short planning transcripts remain byte-for-byte intact', function () {
  assert.equal(sampling.representativeTranscript('  a complete short transcript  ', 9000), 'a complete short transcript');
});

test('long planning transcripts include opening, middle and ending within the fixed budget', function () {
  const text = 'OPENING-' + 'a'.repeat(9000) + '-MIDDLE-' + 'b'.repeat(9000) + '-ENDING';
  const sampled = sampling.representativeTranscript(text, 9000);
  assert.equal(sampled.length <= 9000, true);
  assert.equal(sampled.startsWith('OPENING-'), true);
  assert.match(sampled, /MIDDLE/);
  assert.equal(sampled.endsWith('-ENDING'), true);
  assert.match(sampled, /middle sample/);
  assert.match(sampled, /ending sample/);
});
