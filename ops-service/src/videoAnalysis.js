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

module.exports = { transcribeVideo, matchAndGenerateTitles };
