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

test('measured audio profile normalizes safe settings and builds independent dialogue/music gains', function () {
  assert.deepEqual(videoAnalysis.normalizeAudioMixSettings({}), {
    mode: 'loudness', dialogueLufs: -16, musicBelowDialogueDb: 20,
    truePeakDbtp: -1.5, duckingEnabled: false, legacyPercent: 10
  });
  assert.equal(videoAnalysis.normalizeAudioMixSettings({ dialogueLufsTarget: -30 }).dialogueLufs, -18);
  assert.equal(videoAnalysis.normalizeAudioMixSettings({ musicBelowDialogueDb: 99 }).musicBelowDialogueDb, 25);
  assert.equal(videoAnalysis.normalizeAudioMixSettings({ audioTruePeakDbtp: -2.3 }).truePeakDbtp, -2.5);
  assert.equal(videoAnalysis.normalizeAudioMixSettings({ audioMixMode: 'legacy_percent', ambientMusicVolumePercent: 13 }).legacyPercent, 13);

  const measured = videoAnalysis.parseLoudnessMeasurement('noise\n{\n"input_i" : "-22.00",\n"input_tp" : "-3.00",\n"input_lra" : "2.00",\n"input_thresh" : "-32.00",\n"target_offset" : "0.20"\n}\n');
  assert.equal(measured.inputI, -22);
  const args = videoAnalysis.measuredMixAudioArgs('/video', '/music', '/mix.flac', {
    dialogueLufsTarget: -16, musicBelowDialogueDb: 20, musicDuckingEnabled: false
  }, measured, { inputI: -18 });
  assert.equal(args.includes('[0:a]volume=6.00dB[dialogue];[1:a]volume=-18.00dB[bg];[dialogue][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]'), true);
});

test('measured final pass uses two-pass loudnorm values and a true-peak safeguard', function () {
  const measurement = { inputI: -15.2, inputTp: -0.7, inputLra: 3.1, inputThresh: -25.4, targetOffset: -0.4 };
  const filter = videoAnalysis.finalLoudnormFilter({ dialogueLufsTarget: -16, audioTruePeakDbtp: -1.5 }, measurement);
  assert.match(filter, /loudnorm=I=-16:TP=-1.5/);
  assert.match(filter, /measured_I=-15.2/);
  assert.match(filter, /alimiter=limit=0.841395:level=false/);
  const ducked = videoAnalysis.measuredMixAudioArgs('/video', '/music', '/mix.flac', { musicDuckingEnabled: true }, { inputI: -16 }, { inputI: -16 });
  assert.match(ducked.join(' '), /sidechaincompress/);
});
