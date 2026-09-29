'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const elevenlabs = require('../src/elevenlabs');

test('ElevenLabs timeout settings reject unsafe values and cap extremes', function () {
  assert.equal(elevenlabs.timeoutSetting('', 90000), 90000);
  assert.equal(elevenlabs.timeoutSetting('500', 90000), 90000);
  assert.equal(elevenlabs.timeoutSetting('2500', 90000), 2500);
  assert.equal(elevenlabs.timeoutSetting(String(2 * 60 * 60 * 1000), 90000), 60 * 60 * 1000);
});

test('ElevenLabs requests turn a stalled provider into a named timeout', async function () {
  const stalledFetch = function (url, options) {
    return new Promise(function (resolve, reject) {
      options.signal.addEventListener('abort', function () { reject(options.signal.reason); }, { once: true });
    });
  };
  // AbortSignal.timeout intentionally does not keep a process alive. Keep the
  // isolated test runner open long enough to observe the deadline.
  const keepAlive = setTimeout(function () {}, 50);
  try {
    await assert.rejects(
      elevenlabs.fetchWithDeadline(stalledFetch, 'https://example.invalid', {}, 5, 'stt'),
      /stt_timeout/
    );
  } finally { clearTimeout(keepAlive); }
});

test('ElevenLabs deadline passes a signal without changing successful responses', async function () {
  const response = { ok: true };
  const actual = await elevenlabs.fetchWithDeadline(async function (url, options) {
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.equal(options.method, 'POST');
    return response;
  }, 'https://example.invalid', { method: 'POST' }, 1000, 'tts');
  assert.equal(actual, response);
});
