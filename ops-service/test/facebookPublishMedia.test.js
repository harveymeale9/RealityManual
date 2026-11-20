'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const media = require('../src/facebookPublishMedia');

test('only a failed, large Facebook retry switches to a compact rendition', function () {
  const large = 5.97 * 1000 * 1000 * 1000;
  assert.equal(media.needsCompactCopy(large, { facebookPublishError: 'Meta code 6000' }, false), false);
  assert.equal(media.needsCompactCopy(large, { facebookPublishError: 'Meta code 6000' }, true), true);
  assert.equal(media.needsCompactCopy(large, { facebookUploadBytesTransferred: 1675150063 }, true), true);
  assert.equal(media.needsCompactCopy(900000000, { facebookPublishError: 'Meta code 6000' }, true), false);
  assert.equal(media.needsCompactCopy(large, { facebookPublishError: 'Still processing' }, true), false);
  const args = media.transcodeArgs('/source.mp4', '/copy.mp4', {
    width: 3840, height: 2160, duration: 1338.602, audioCodec: 'aac'
  });
  assert.ok(args.includes('scale=1920:1080'));
  assert.ok(args.includes('6500k'));
  assert.ok(args.includes('copy'));
});

test('compact Facebook copy preserves duration and produces verified H.264 MP4', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facebook-compact-'));
  const source = path.join(dir, 'source.mp4');
  const output = path.join(dir, 'copy.mp4');
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi',
      '-i', 'testsrc2=size=640x360:rate=5', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '2', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-y', source], { timeout: 30000 });
    const result = await media.makeCompactCopy(source, output);
    assert.ok(result.sizeBytes > 0 && result.sizeBytes <= media.MAX_OUTPUT_BYTES);
    assert.ok(Math.abs(result.durationSeconds - 2) < .2);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_name', '-of', 'json', output]).toString());
    assert.equal(probe.streams[0].codec_name, 'h264');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
