'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const preview = require('../src/finalReviewPreview');

test('720p review rendition keeps the publish master and copies its audio packets', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-final-review-'));
  try {
    const source = path.join(dir, 'publish.mp4');
    const output = path.join(dir, 'review.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source]);
    const sourceBytes = fs.statSync(source).size;
    const service = preview.setup();
    assert.equal(service.start('piece', source, output).status, 'preparing');
    assert.equal(service.start('piece', source, output).status, 'preparing');
    await service.jobs.get('piece');
    assert.equal(service.start('piece', source, output).status, 'ready');
    assert.equal(fs.statSync(source).size, sourceBytes);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]));
    assert.equal(probe.streams.find(s => s.codec_type === 'video').width, 1280);
    assert.equal(probe.streams.find(s => s.codec_type === 'video').height, 720);
    assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
    const audioHashes = file => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_packets',
      '-show_entries', 'packet=data_hash', '-show_data_hash', 'sha256', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    assert.equal(audioHashes(output), audioHashes(source));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review encode failures do not damage the publish master and are retryable', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-final-review-fail-'));
  try {
    const source = path.join(dir, 'publish.mp4');
    const output = path.join(dir, 'review.mp4');
    fs.writeFileSync(source, 'original publish bytes');
    let attempts = 0;
    const service = preview.setup({ run: async function (_source, temp) {
      attempts++;
      if (attempts === 1) throw new Error('test encode failure');
      fs.writeFileSync(temp, Buffer.alloc(2048));
    } });
    service.start('piece', source, output);
    await service.jobs.get('piece');
    assert.equal(service.start('piece', source, output).status, 'error');
    assert.equal(fs.readFileSync(source, 'utf8'), 'original publish bytes');
    assert.equal(service.retry('piece', source, output).status, 'preparing');
    await service.jobs.get('piece');
    assert.equal(service.start('piece', source, output).status, 'ready');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('matching Editor picture is used with the exact final-master audio', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-final-review-editor-'));
  try {
    const source = path.join(dir, 'publish.mp4');
    const picture = path.join(dir, 'editor.mp4');
    const output = path.join(dir, 'review.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1.32', '-c:v', 'libx264', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source]);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', source, '-t', '1', '-vf', 'scale=720:404',
      '-an', '-c:v', 'libx264', '-threads', '2', '-y', picture]);
    assert.equal(preview.matchingPicture(source, picture), picture);
    const service = preview.setup();
    service.start('piece', source, output, picture);
    await service.jobs.get('piece');
    assert.equal(service.start('piece', source, output, picture).status, 'ready');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]));
    assert.equal(probe.streams.find(s => s.codec_type === 'video').width, 720);
    const audioHashes = file => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_packets',
      '-show_entries', 'packet=data_hash', '-show_data_hash', 'sha256', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    assert.equal(audioHashes(output), audioHashes(source));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
