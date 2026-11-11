'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Project Manager speech endpoint refuses even stale browser requests', function () {
  const server = read('server.js');
  assert.match(server, /app\.post\('\/api\/voice\/tts', function \(req, res\) \{\s*res\.status\(410\)\.json\(\{ error: 'tts_disabled' \}\);\s*\}\);/);
  assert.doesNotMatch(server, /synthesizeSpeech|ttsRouter|openaiTts/);
  assert.equal(fs.existsSync(path.join(root, 'src', 'openaiTts.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'src', 'ttsRouter.js')), false);
  assert.doesNotMatch(read('src/elevenlabs.js'), /text-to-speech|synthesizeSpeech/);
});

test('Project Manager desktop and mobile never prepare or request speech', function () {
  for (const name of ['public/app.js', 'public/voice-mobile.html']) {
    const page = read(name);
    assert.doesNotMatch(page, /Voice\.(?:speak|prepareSpeech|isAutoSpeechEnabled|setAutoSpeechEnabled)/, name);
    assert.doesNotMatch(page, /(?:pm|v)AutoSpeechBtn|pm-play-btn|preparing voice playback/, name);
  }
  assert.match(read('public/app.js'), /Voice\.transcribe/);
  assert.match(read('public/voice-mobile.html'), /Voice\.transcribe/);
});
