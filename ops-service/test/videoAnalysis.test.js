'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
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

  const linkedOutline = { title: 'The linked planning-card title', ytTitles: [], preserveWorkingTitle: true };
  videoAnalysis.applyGeneratedTitleSuggestions(linkedOutline, generated);
  assert.equal(linkedOutline.title, 'The linked planning-card title');
  assert.deepEqual(linkedOutline.ytTitles, ['Are You Ready?']);
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

  const withOutro = videoAnalysis.legacyFinalVideoArgs('/video', '/music', '/out', 13, 12, 2);
  assert.match(withOutro.join(' '), /volume=0\.13,afade=t=out:st=10\.000:d=2\.000\[bg\]/);
  const horizontalOutro = videoAnalysis.legacyFinalVideoArgs('/video', '/music', '/out', 13, 12, 0.3);
  assert.match(horizontalOutro.join(' '), /volume=0\.13,afade=t=out:st=11\.700:d=0\.300\[bg\]/);
  assert.equal(withOutro[withOutro.indexOf('-ar') + 1], '48000');
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
  const normalizedDucking = videoAnalysis.normalizeAudioMixSettings({ musicDuckingEnabled: true, dialogueLufsTarget: -15, audioTruePeakDbtp: -2 });
  assert.deepEqual(videoAnalysis.normalizeAudioMixSettings(normalizedDucking), normalizedDucking);

  const measured = videoAnalysis.parseLoudnessMeasurement('noise\n{\n"input_i" : "-22.00",\n"input_tp" : "-3.00",\n"input_lra" : "2.00",\n"input_thresh" : "-32.00",\n"target_offset" : "0.20"\n}\n');
  assert.equal(measured.inputI, -22);
  const args = videoAnalysis.measuredMixAudioArgs('/video', '/music', '/mix.flac', {
    dialogueLufsTarget: -16, musicBelowDialogueDb: 20, musicDuckingEnabled: false
  }, measured, { inputI: -18 });
  assert.equal(args.includes('[0:a]volume=6.00dB[dialogue];[1:a]volume=-18.00dB[bg];[dialogue][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]'), true);

  const builtTrack = videoAnalysis.measuredMixAudioArgs('/video', '/music', '/mix.flac', {
    dialogueLufsTarget: -16, musicBelowDialogueDb: 20
  }, { inputI: -16 }, { loudestShortTermLufs: -24, inputI: -40 }, 12, 2);
  assert.match(builtTrack.join(' '), /\[1:a\]volume=-12\.00dB,afade=t=out:st=10\.000:d=2\.000\[bg\]/);
});

test('music calibration uses the loudest valid three-second EBU R128 window', function () {
  const stderr = [
    '[Parsed_ebur128] t: 0.4 TARGET:-23 LUFS M: -38.0 S: -120.7 I: -70.0 LUFS',
    '[Parsed_ebur128] t: 3.2 TARGET:-23 LUFS M: -25.0 S: -31.5 I: -35.0 LUFS',
    '[Parsed_ebur128] t: 8.2 TARGET:-23 LUFS M: -15.0 S: -18.2 I: -25.0 LUFS',
    '[Parsed_ebur128] t: 9.2 TARGET:-23 LUFS M: -17.0 S: -20.0 I: -24.0 LUFS'
  ].join('\n');
  assert.deepEqual(videoAnalysis.parseMusicPeakMeasurement(stderr), {
    loudestShortTermLufs: -18.2,
    usedMomentaryFallback: false
  });
  const boundedArgs = videoAnalysis.musicPeakMeasureArgs('/music', 15.033);
  assert.match(boundedArgs.join(' '), /ebur128=peak=true:framelog=verbose/);
  assert.equal(boundedArgs[boundedArgs.indexOf('-t') + 1], '15.033');
  assert.equal(boundedArgs.includes('-stream_loop'), true);
  const unboundedArgs = videoAnalysis.musicPeakMeasureArgs('/music');
  assert.equal(unboundedArgs.includes('-t'), false);
  assert.equal(unboundedArgs.includes('-stream_loop'), false);
  assert.equal(videoAnalysis.musicPeakMeasurementDuration(765, 66.5), 69.5);
  assert.equal(videoAnalysis.musicPeakMeasurementDuration(30, 66.5), 30);
});

test('measured final pass uses two-pass loudnorm values and a true-peak safeguard', function () {
  const measurement = { inputI: -15.2, inputTp: -0.7, inputLra: 3.1, inputThresh: -25.4, targetOffset: -0.4 };
  const filter = videoAnalysis.finalLoudnormFilter({ dialogueLufsTarget: -16, audioTruePeakDbtp: -1.5 }, measurement);
  assert.match(filter, /loudnorm=I=-16:TP=-1.5/);
  assert.match(filter, /measured_I=-15.2/);
  assert.match(filter, /alimiter=limit=0.841395:level=false/);
  const ducked = videoAnalysis.measuredMixAudioArgs('/video', '/music', '/mix.flac', { musicDuckingEnabled: true }, { inputI: -16 }, { inputI: -16 });
  assert.match(ducked.join(' '), /sidechaincompress/);
  const duckedOutro = videoAnalysis.measuredMixAudioArgs('/video', '/music', '/mix.flac', { musicDuckingEnabled: true }, { inputI: -16 }, { inputI: -16 }, 8, 2);
  assert.match(duckedOutro.join(' '), /afade=t=out:st=6\.000:d=2\.000\[bg\].*sidechaincompress/);
  const compressed = videoAnalysis.measuredFinalAudioArgs('/mix.flac', '/preview.mp3', {}, measurement, { bitrate: '48k' });
  assert.equal(compressed[compressed.indexOf('-b:a') + 1], '48k');
  assert.equal(compressed[compressed.indexOf('-ar') + 1], '48000');
  const safeFallback = videoAnalysis.legacyAudioPreviewArgs('/voice', '/music', '/preview.mp3', 10, { bitrate: '12k' });
  assert.equal(safeFallback[safeFallback.indexOf('-b:a') + 1], '192k');
  const previewOutro = videoAnalysis.legacyAudioPreviewArgs('/voice', '/music', '/preview.mp3', 10, {}, 8, 2);
  assert.match(previewOutro.join(' '), /afade=t=out:st=6\.000:d=2\.000/);
  const audition = videoAnalysis.productionAuditionArgs('/voice', '/music', '/audition.mp3',
    { musicDuckingEnabled: true }, { inputI: -16 }, { loudestShortTermLufs: -20 }, 8, { bitrate: '96k' });
  assert.match(audition.join(' '), /sidechaincompress/);
  assert.match(audition.join(' '), /\[1:a\]volume=-12\.50dB/);
  const masterMix = videoAnalysis.measuredMixAudioArgs('/voice', '/music', '/mix.flac',
    { musicDuckingEnabled: true }, { inputI: -16 }, { loudestShortTermLufs: -20 }, 8, 2);
  assert.match(masterMix.join(' '), /\[1:a\]volume=-16\.00dB/);
  const legacyAudition = videoAnalysis.legacyAudioPreviewArgs('/voice', '/music', '/audition.mp3',
    10, { bitrate: '96k' }, 8, 2, 3.5);
  assert.match(legacyAudition.join(' '), /\[1:a\]volume=0\.1496/);
  const legacyNormal = videoAnalysis.legacyAudioPreviewArgs('/voice', '/music', '/preview.mp3',
    10, { bitrate: '96k' }, 8, 2);
  assert.match(legacyNormal.join(' '), /\[1:a\]volume=0\.10/);
  assert.match(audition.join(' '), /alimiter=limit=0\.841395:level=false\[audition\]/);
  assert.equal(audition[audition.indexOf('-b:a') + 1], '96k');
  assert.equal(audition.includes('flac'), false);
});

test('Production audition makes playable low-bitrate audio without a lossless intermediate', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-audition-mix-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const voice = path.join(dir, 'voice.mp4');
  const music = path.join(dir, 'music.mp3');
  const output = path.join(dir, 'audition.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=320x180:rate=15:color=black',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4',
    '-c:v', 'libx264', '-threads', '1', '-c:a', 'aac', voice]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
    '-t', '2', '-c:a', 'libmp3lame', music]);
  await videoAnalysis.buildProductionAudioPreview(voice, music, output, { musicDuckingEnabled: true }, { bitrate: '96k' });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate',
    '-of', 'json', output])).format;
  assert.ok(Number(probe.duration) >= 4);
  assert.ok(Number(probe.bit_rate) < 110000);
  assert.equal(fs.existsSync(output + '.loudness-mix.flac'), false);
});
