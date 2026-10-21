'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const preview = require('../src/productionVideoPreview');

test('Production uses one seekable 360p audition copy but captures thumbnails from the source', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-production-video-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'source.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-threads', '2',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source]);
  const sourceSize = fs.statSync(source).size;
  const service = preview.setup({ rootDir: path.join(dir, 'cache'), getVideoPath: function () { return source; } });
  assert.equal(service.start('piece').status, 'preparing');
  assert.equal(service.start('piece').status, 'preparing');
  await Array.from(service.jobs.values())[0];
  const status = service.start('piece');
  assert.equal(status.status, 'ready');
  const copy = service.readyPath('piece');
  const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', copy])).streams;
  const video = streams.find(function (row) { return row.codec_type === 'video'; });
  assert.equal(video.width, 640);
  assert.equal(video.height, 360);
  assert.equal(Number(video.avg_frame_rate.split('/')[0]) / Number(video.avg_frame_rate.split('/')[1]), 15);
  assert.equal(streams.find(function (row) { return row.codec_type === 'audio'; }).codec_name, 'aac');
  execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', copy, '-f', 'null', '-']);
  assert.equal(fs.statSync(source).size, sourceSize);
  const jpeg = await preview.frameJpeg(source, 0.5);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  const frame = path.join(dir, 'source-frame.jpg');
  fs.writeFileSync(frame, jpeg);
  const frameSize = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', frame])).streams[0];
  assert.equal(frameSize.width, 1280);
  assert.equal(frameSize.height, 720);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(app, /production-preview-status/);
  assert.match(app, /production-thumbnail-frame/);
  assert.match(server, /app\.get\('\/api\/videos\/:id\/production-preview', requireAuthOrReviewer/);
  service.prune([]);
  assert.equal(fs.existsSync(copy), false);
});

test('Production preview failure is retryable without changing the source', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-production-video-fail-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'source.mp4');
  fs.writeFileSync(source, 'original');
  let attempts = 0;
  const service = preview.setup({ rootDir: path.join(dir, 'cache'), getVideoPath: function () { return source; },
    run: async function (_source, output) {
      attempts++;
      if (attempts === 1) throw new Error('encode failed');
      fs.writeFileSync(output, Buffer.alloc(2048));
    } });
  assert.equal(service.start('piece').status, 'preparing');
  await Array.from(service.jobs.values())[0];
  assert.equal(service.start('piece').status, 'error');
  assert.equal(service.retry('piece').status, 'preparing');
  await Array.from(service.jobs.values())[0];
  assert.equal(service.start('piece').status, 'ready');
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
});

test('portrait audition preview replaces a legacy black opening without changing source or audio timing', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-production-opening-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'source.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=lime:size=360x640:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2',
    '-filter_complex', '[0:v]fade=t=in:st=0:d=0.3:color=black[v];[1:a]adelay=300|300[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source]);
  const originalSize = fs.statSync(source).size;
  let openingHoldSeconds = 0;
  const service = preview.setup({ rootDir: path.join(dir, 'cache'), getVideoPath: function () { return source; },
    getOpeningHoldSeconds: function () { return openingHoldSeconds; } });
  service.start('portrait');
  await Array.from(service.jobs.values())[0];
  const fadedCopy = service.readyPath('portrait');
  const firstRgb = function (file) {
    return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1',
      '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', 'pipe:1']);
  };
  assert.ok(firstRgb(fadedCopy)[1] < 30, 'legacy first frame is black');
  openingHoldSeconds = 0.3;
  assert.equal(service.start('portrait').status, 'preparing');
  await Array.from(service.jobs.values())[0];
  const visibleCopy = service.readyPath('portrait');
  assert.notEqual(visibleCopy, fadedCopy);
  assert.ok(firstRgb(visibleCopy)[1] > 150, 'repaired first frame is green');
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', visibleCopy]));
  assert.ok(Math.abs(duration - 2) < 0.15, 'duration is preserved');
  assert.equal(fs.statSync(source).size, originalSize);
  assert.ok(fs.existsSync(source));
});
