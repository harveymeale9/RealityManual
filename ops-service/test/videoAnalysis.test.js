'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const videoAnalysis = require('../src/videoAnalysis');

test('late analysis suggestions never replace a manually chosen title', function () {
  const generated = {
    titleOptions: ['Are You Ready?'],
    workingTitle: 'Are You Ready?'
  };
  const automatic = { title: 'upload.mov', ytTitles: [] };
  videoAnalysis.applyGeneratedTitleSuggestions(automatic, generated);
  assert.equal(automatic.title, 'Are You Ready?');
  assert.deepEqual(automatic.ytTitles, ['Are You Ready?']);

  const manual = {
    title: 'demo vid',
    ytTitles: ['demo vid'],
    ytTitlesManuallyEdited: true
  };
  videoAnalysis.applyGeneratedTitleSuggestions(manual, generated);
  assert.equal(manual.title, 'demo vid');
  assert.deepEqual(manual.ytTitles, ['demo vid']);
});
