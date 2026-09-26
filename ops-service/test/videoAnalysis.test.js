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

test('final video mix uses the selected ambient percentage and clamps unsafe values', function () {
  assert.equal(videoAnalysis.normalizeAmbientVolumePercent(undefined), 10);
  assert.equal(videoAnalysis.normalizeAmbientVolumePercent(4), 5);
  assert.equal(videoAnalysis.normalizeAmbientVolumePercent(31), 30);
  assert.equal(videoAnalysis.normalizeAmbientVolumePercent('17'), 17);

  const selected = videoAnalysis.finalVideoArgs('/video', '/music', '/out', 13);
  assert.equal(selected.includes('[1:a]volume=0.13[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]'), true);
  const defaulted = videoAnalysis.finalVideoArgs('/video', '/music', '/out');
  assert.equal(defaulted.includes('[1:a]volume=0.10[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]'), true);
  const noMusic = videoAnalysis.finalVideoArgs('/video', null, '/out', 30);
  assert.deepEqual(noMusic, ['-y', '-i', '/video', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', '/out']);
});
