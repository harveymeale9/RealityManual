// Uploader-tool pipeline: pull the audio out of a freshly-uploaded video,
// transcribe it, then ask Claude (a one-shot call — see claudeRunner.js's
// runOneShot) to find the best-matching "uploaded"-stage outline and pull
// out title candidates from it. Two separate steps kept separate so a
// transcription failure doesn't also block the (independent) matching step
// from at least trying with an empty transcript, and so each failure mode
// is distinguishable in the logs.
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const elevenlabs = require('./elevenlabs');
const claudeRunner = require('./claudeRunner');

// Browser-native <video>/canvas support is what the frame picker and
// Final Check preview both rely on — anything outside this list has been
// confirmed (against a real HEVC upload, 2026-09-20) to leave
// videoWidth/videoHeight stuck at 0 in Chrome/Chromium even once
// readyState reports HAVE_ENOUGH_DATA, which silently breaks canvas
// frame capture (drawImage no-ops rather than throwing) and can't be
// worked around client-side.
var BROWSER_SAFE_VIDEO_CODECS = ['h264', 'vp8', 'vp9', 'av1'];

function probeVideoCodec(videoPath) {
  return new Promise(function (resolve) {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', videoPath],
      { maxBuffer: 1024 * 1024 },
      function (err, stdout) {
        if (err) return resolve(null);
        resolve((stdout || '').trim().toLowerCase() || null);
      });
  });
}

// Re-encodes in place (same path) to H.264/AAC when the source codec
// isn't one browsers universally decode — a no-op (nothing re-encoded,
// `transcoded: false`) for anything already safe, so this is cheap to
// call unconditionally on every upload rather than needing the caller
// to know in advance whether a given file needs it.
async function ensureBrowserCompatibleVideo(videoPath) {
  const codec = await probeVideoCodec(videoPath);
  if (!codec || BROWSER_SAFE_VIDEO_CODECS.indexOf(codec) !== -1) return { transcoded: false, codec: codec };
  const tmpPath = videoPath + '.transcode-tmp.mp4';
  await new Promise(function (resolve, reject) {
    execFile('ffmpeg', ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', tmpPath],
      { maxBuffer: 20 * 1024 * 1024 },
      function (err) {
        if (err) return reject(new Error('ffmpeg codec-normalize failed: ' + err.message));
        resolve();
      });
  });
  fs.renameSync(tmpPath, videoPath);
  return { transcoded: true, codec: codec };
}

function extractAudioMp3(videoPath, outPath) {
  return new Promise(function (resolve, reject) {
    execFile('ffmpeg', ['-y', '-i', videoPath, '-vn', '-acodec', 'libmp3lame', '-b:a', '128k', outPath],
      { maxBuffer: 10 * 1024 * 1024 },
      function (err) {
        if (err) return reject(new Error('ffmpeg audio extraction failed: ' + err.message));
        resolve();
      });
  });
}

function normalizeAmbientVolumePercent(value) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(5, Math.min(30, parsed)) : 10;
}

function clampNumber(value, fallback, min, max, step) {
  let parsed = Number(value);
  if (!Number.isFinite(parsed)) parsed = fallback;
  parsed = Math.max(min, Math.min(max, parsed));
  return step ? Math.round(parsed / step) * step : parsed;
}

function normalizeAudioMixSettings(input) {
  if (typeof input === 'number' || typeof input === 'string') {
    return { mode: 'legacy_percent', legacyPercent: normalizeAmbientVolumePercent(input) };
  }
  input = input || {};
  return {
    mode: input.audioMixMode === 'legacy_percent' ? 'legacy_percent' : 'loudness',
    dialogueLufs: clampNumber(input.dialogueLufsTarget, -16, -18, -14, 1),
    musicBelowDialogueDb: clampNumber(input.musicBelowDialogueDb, 20, 15, 25, 1),
    truePeakDbtp: clampNumber(input.audioTruePeakDbtp, -1.5, -3, -1, 0.5),
    duckingEnabled: input.musicDuckingEnabled === true,
    legacyPercent: normalizeAmbientVolumePercent(input.ambientMusicVolumePercent)
  };
}

function legacyFinalVideoArgs(videoPath, audioPath, outPath, ambientVolumePercent) {
  if (!audioPath) return ['-y', '-i', videoPath, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', outPath];
  const volume = (normalizeAmbientVolumePercent(ambientVolumePercent) / 100).toFixed(2);
  return ['-y', '-i', videoPath, '-stream_loop', '-1', '-i', audioPath,
    '-filter_complex', '[1:a]volume=' + volume + '[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]',
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-f', 'mp4', outPath];
}

// Kept as the public compatibility helper used by earlier tests/callers. The
// measured pipeline is asynchronous because it needs three real analysis/
// render passes; a scalar fourth argument still means the old percentage mix.
function finalVideoArgs(videoPath, audioPath, outPath, ambientVolumePercent) {
  return legacyFinalVideoArgs(videoPath, audioPath, outPath, ambientVolumePercent);
}

function loudnessMeasureArgs(inputPath, settings) {
  settings = normalizeAudioMixSettings(settings);
  return ['-hide_banner', '-nostats', '-i', inputPath, '-vn', '-af',
    'loudnorm=I=' + settings.dialogueLufs + ':TP=' + settings.truePeakDbtp + ':LRA=11:print_format=json',
    '-f', 'null', '-'];
}

function parseLoudnessMeasurement(stderr) {
  const matches = String(stderr || '').match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches || !matches.length) throw new Error('ffmpeg returned no loudness measurement');
  const raw = JSON.parse(matches[matches.length - 1]);
  function number(key, fallback) {
    const value = Number(raw[key]);
    return Number.isFinite(value) ? value : fallback;
  }
  return {
    inputI: number('input_i', null), inputTp: number('input_tp', null), inputLra: number('input_lra', 0),
    inputThresh: number('input_thresh', -70), targetOffset: number('target_offset', 0)
  };
}

function dbGain(target, measured) {
  return measured && Number.isFinite(measured.inputI)
    ? clampNumber(target - measured.inputI, 0, -30, 30, 0.01) : 0;
}

function measuredMixAudioArgs(videoPath, audioPath, tempAudioPath, settings, dialogueMeasurement, musicMeasurement) {
  settings = normalizeAudioMixSettings(settings);
  const dialogueGain = dbGain(settings.dialogueLufs, dialogueMeasurement).toFixed(2);
  const args = ['-y', '-i', videoPath];
  if (!audioPath) {
    args.push('-filter_complex', '[0:a]volume=' + dialogueGain + 'dB[mix]', '-map', '[mix]', '-c:a', 'flac', tempAudioPath);
    return args;
  }
  args.push('-stream_loop', '-1', '-i', audioPath);
  const musicTarget = settings.dialogueLufs - settings.musicBelowDialogueDb;
  const musicGain = dbGain(musicTarget, musicMeasurement).toFixed(2);
  let filter;
  if (settings.duckingEnabled) {
    // A mild sidechain pass lowers music only while dialogue is active. The
    // final relative baseline remains controlled by musicBelowDialogueDb.
    filter = '[0:a]volume=' + dialogueGain + 'dB,asplit=2[dialogue][key];' +
      '[1:a]volume=' + musicGain + 'dB[bg];[bg][key]sidechaincompress=threshold=0.035:ratio=3:attack=20:release=300[ducked];' +
      '[dialogue][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]';
  } else {
    filter = '[0:a]volume=' + dialogueGain + 'dB[dialogue];[1:a]volume=' + musicGain + 'dB[bg];' +
      '[dialogue][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]';
  }
  args.push('-filter_complex', filter, '-map', '[mix]', '-c:a', 'flac', tempAudioPath);
  return args;
}

function finalLoudnormFilter(settings, measurement) {
  settings = normalizeAudioMixSettings(settings);
  const limit = Math.pow(10, settings.truePeakDbtp / 20).toFixed(6);
  if (!measurement || !Number.isFinite(measurement.inputI) || !Number.isFinite(measurement.inputTp)) {
    return 'alimiter=limit=' + limit + ':level=false';
  }
  return 'loudnorm=I=' + settings.dialogueLufs + ':TP=' + settings.truePeakDbtp + ':LRA=11' +
    ':measured_I=' + measurement.inputI + ':measured_LRA=' + measurement.inputLra +
    ':measured_TP=' + measurement.inputTp + ':measured_thresh=' + measurement.inputThresh +
    ':offset=' + measurement.targetOffset + ':linear=true:print_format=summary,' +
    'alimiter=limit=' + limit + ':level=false';
}

function measuredFinalVideoArgs(videoPath, tempAudioPath, outPath, settings, mixMeasurement) {
  return ['-y', '-i', videoPath, '-i', tempAudioPath,
    '-filter_complex', '[1:a]' + finalLoudnormFilter(settings, mixMeasurement) + '[aout]',
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart', '-f', 'mp4', outPath];
}

function runFfmpeg(args, label) {
  return new Promise(function (resolve, reject) {
    execFile('ffmpeg', args, { maxBuffer: 30 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (err) return reject(new Error('ffmpeg ' + label + ' failed: ' + err.message));
      resolve({ stdout: stdout, stderr: stderr });
    });
  });
}

async function measureLoudness(inputPath, settings) {
  const result = await runFfmpeg(loudnessMeasureArgs(inputPath, settings), 'loudness measurement');
  return parseLoudnessMeasurement(result.stderr);
}

// The actual "final" video Harvey reviews in Final Check and eventually
// publishes. Loudness mode performs independent dialogue/music measurements,
// renders a lossless intermediate at the configured relative level, measures
// that completed mix, then applies two-pass loudnorm plus the final limiter.
// `-stream_loop -1` keeps short music beds alive for the full dialogue track.
// With no selected music, dialogue is still normalized and peak-protected.
// Legacy mode deliberately retains the old percentage/remux behavior for A/B
// comparison until Harvey is happy with the measured workflow.
async function buildFinalVideo(videoPath, audioPath, outPath, mixInput) {
  const settings = normalizeAudioMixSettings(mixInput);
  if (settings.mode === 'legacy_percent') {
    await runFfmpeg(legacyFinalVideoArgs(videoPath, audioPath, outPath, settings.legacyPercent), 'legacy final-video build');
    return { mode: settings.mode };
  }
  const tempAudioPath = outPath + '.loudness-mix.flac';
  try {
    const dialogueMeasurement = await measureLoudness(videoPath, settings);
    const musicMeasurement = audioPath ? await measureLoudness(audioPath, settings) : null;
    await runFfmpeg(measuredMixAudioArgs(videoPath, audioPath, tempAudioPath, settings, dialogueMeasurement, musicMeasurement), 'measured audio mix');
    const mixMeasurement = await measureLoudness(tempAudioPath, settings);
    await runFfmpeg(measuredFinalVideoArgs(videoPath, tempAudioPath, outPath, settings, mixMeasurement), 'loudness-normalized final-video build');
    return { mode: settings.mode, dialogue: dialogueMeasurement, music: musicMeasurement, mix: mixMeasurement };
  } finally {
    fs.rmSync(tempAudioPath, { force: true });
  }
}

// videoPath: the uploaded video file on disk. tmpDir: scratch space to
// extract the audio into (caller's responsibility to have created it;
// this cleans up its own temp file either way).
async function transcribeVideo(videoPath, tmpDir) {
  const audioPath = path.join(tmpDir, path.basename(videoPath) + '.mp3');
  try {
    await extractAudioMp3(videoPath, audioPath);
    const buffer = fs.readFileSync(audioPath);
    return await elevenlabs.transcribeAudio(buffer, 'audio/mpeg');
  } finally {
    fs.rm(audioPath, { force: true }, function () {});
  }
}

// candidates: [{ id, seq, title, notesSnippet }] — pieces currently in the
// "uploaded" stage (Harvey's own plan archive — see CLAUDE.md §62 on why
// that stage means "planned and filmed," which is exactly what a freshly
// uploaded video corresponds to). notesSnippet is deliberately just the
// first ~400 chars of notesHtml stripped to plain text — that's where
// Harvey's own titles typically sit at the top of an outline, and keeping
// full outlines out of the prompt keeps this fast and cheap.
function buildMatchPrompt(transcript, candidates) {
  const candidateBlock = candidates.map(function (c) {
    return '- id: "' + c.id + '" | #' + String(c.seq).padStart(3, '0') + ' | title: ' + JSON.stringify(c.title) +
      ' | outline start: ' + JSON.stringify(c.notesSnippet);
  }).join('\n');
  return 'A video was just uploaded to the Reality Manual content pipeline. Here is its transcript ' +
    '(may be empty or partial if transcription failed):\n\n"""\n' + (transcript || '(no transcript available)').slice(0, 6000) + '\n"""\n\n' +
    'Here are the candidate outlines/ideas currently sitting in the "Uploaded" stage of the Content Ops ' +
    'board (Harvey\'s own planning stage — a piece here has already been outlined and filmed, waiting to ' +
    'be matched to its actual uploaded video file):\n\n' + (candidateBlock || '(no candidates)') + '\n\n' +
    'Your job: decide which single candidate (if any) this video most likely corresponds to, based on how ' +
    'well the transcript\'s actual content matches that candidate\'s title/outline. If nothing is a ' +
    'plausible match, matchedPieceId should be null. Then produce title options for this video: if the ' +
    'matched candidate\'s outline itself opens with a short list of alternate headline-style titles (Harvey ' +
    'often writes 1-3 of these right at the top of an outline, e.g. "The Most Powerful People Have Mastered ' +
    'This" / "The Most Powerful People Understand This" / "The Secret The Most Powerful People Have ' +
    'Mastered"), extract those verbatim, up to 3. If there\'s no matched candidate, or its outline has no ' +
    'obvious title list at the top, fall back to just the matched candidate\'s own title as the single entry ' +
    '(or, with no match at all, a short punchy title you generate yourself from the transcript). ' +
    'workingTitle is a short (under 60 char) working label for this video in an upload list — usually just ' +
    'the first of your titleOptions.\n\n' +
    'Respond with ONLY a single JSON object, no markdown fencing, no other text, in exactly this shape:\n' +
    '{"matchedPieceId": "<id or null>", "titleOptions": ["...", "..."], "workingTitle": "..."}';
}

function parseMatchResult(raw) {
  var text = (raw || '').trim();
  // Strip a markdown code fence if the model added one despite being told
  // not to — cheap defensive parsing, same spirit as this codebase's other
  // "never trust the model's formatting literally" spots.
  var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  var parsed = JSON.parse(text);
  return {
    matchedPieceId: parsed.matchedPieceId || null,
    titleOptions: Array.isArray(parsed.titleOptions) ? parsed.titleOptions.filter(Boolean).slice(0, 3) : [],
    workingTitle: (parsed.workingTitle || '').trim()
  };
}

async function matchAndGenerateTitles(transcript, candidates) {
  const prompt = buildMatchPrompt(transcript, candidates);
  const raw = await claudeRunner.runOneShot(prompt, 90000);
  return parseMatchResult(raw);
}

// Analysis-generated titles are suggestions, never an authority over a title
// Harvey has typed himself. Analysis and editing run concurrently, so checking
// this on the freshly re-read record is what closes the race where a late
// matching result replaced an explicit Content Production choice just before
// the piece entered Final Check.
function applyGeneratedTitleSuggestions(piece, result) {
  if (!piece || piece.ytTitlesManuallyEdited) return piece;
  if (result && Array.isArray(result.titleOptions) && result.titleOptions.length) piece.ytTitles = result.titleOptions;
  if (result && result.workingTitle) piece.title = result.workingTitle;
  return piece;
}

module.exports = {
  transcribeVideo,
  matchAndGenerateTitles,
  buildFinalVideo,
  ensureBrowserCompatibleVideo,
  applyGeneratedTitleSuggestions,
  normalizeAmbientVolumePercent,
  normalizeAudioMixSettings,
  finalVideoArgs,
  legacyFinalVideoArgs,
  loudnessMeasureArgs,
  parseLoudnessMeasurement,
  measuredMixAudioArgs,
  finalLoudnormFilter,
  measuredFinalVideoArgs
};
