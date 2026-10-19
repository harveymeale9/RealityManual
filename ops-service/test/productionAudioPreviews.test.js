'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const previews = require('../src/productionAudioPreviews');

test('Production makes soundtrack preparation visible and orders Editor before Content Production', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(app, /Mixing backing-audio previews/);
  assert.match(app, /selected preview will unlock automatically when ready/);
  assert.match(app, /upload-row-audio-preview-spinner/);
  assert.match(app, /audioSection\.setAttribute\('aria-busy'/);
  assert.match(app, /playSelectedPreviewFromStart\(\)/);
  assert.match(app, /Drag the timeline to audition another point/);
  assert.match(app, /videoEl\.addEventListener\('timeupdate'/);
  assert.match(styles, /\.upload-row-audio-preview-progress\.is-preparing/);
  assert.match(styles, /\.upload-row-audio-preview-spinner/);
  assert.match(styles, /\.upload-row-preview-timeline/);
  assert.ok(app.indexOf("{ id: 'editor', label: 'Editor' }") < app.indexOf("{ id: 'upload-files', label: 'Content Production' }"));
  assert.ok(page.indexOf('data-tab="editor" title="Editor"') < page.indexOf('data-tab="upload-files" title="Content Production"'));
  assert.match(page, /app\.js\?v=20261019-youtube-description-v2/);
});

test('Production preview cache deduplicates work, persists results, and invalidates changed settings', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-production-audio-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  const video = path.join(dir, 'video'); const track = path.join(dir, 'track');
  fs.writeFileSync(video, 'video'); fs.writeFileSync(track, 'track');
  let settings = { musicBelowDialogueDb: 20 }; let builds = 0; let preparations = 0;
  const service = previews.setup({
    rootDir: path.join(dir, 'cache'), concurrency: 2,
    getVideoPath: function () { return video; }, getAudioTrackPath: function () { return track; },
    getAudioTracks: function () { return [{ id: 'track-1' }]; }, getMixSettings: function () { return settings; },
    prepareAudioPreview: async function () { preparations++; return { shared: true }; },
    buildAudioPreview: async function (_video, _track, output, _settings, outputOptions, prepared) { assert.deepEqual(prepared, { shared: true }); assert.equal(outputOptions.bitrate, '96k'); builds++; await new Promise(function (resolve) { setTimeout(resolve, 20); }); fs.writeFileSync(output, Buffer.alloc(2048)); }
  });
  const first = await Promise.all([service.ensure('piece-1', 'track-1'), service.ensure('piece-1', 'track-1')]);
  assert.equal(first[0], first[1]); assert.equal(builds, 1); assert.equal(preparations, 1); assert.ok(fs.statSync(first[0]).size > 1024);
  assert.deepEqual(service.status('piece-1'), { total: 1, ready: [{ id: 'track-1', version: service.previewIdentity('piece-1', 'track-1').hash }] });
  assert.equal(await service.ensure('piece-1', 'track-1'), first[0]); assert.equal(builds, 1);
  settings = { musicBelowDialogueDb: 18 };
  const changed = await service.ensure('piece-1', 'track-1');
  assert.notEqual(changed, first[0]); assert.equal(builds, 2); assert.equal(preparations, 2); assert.equal(fs.existsSync(first[0]), false);
  service.prune([]); assert.equal(fs.existsSync(path.dirname(changed)), false);
});

test('Production preview queue bounds simultaneous mixes', async function () {
  const enqueue = previews.createQueue(2);
  let active = 0; let peak = 0;
  await Promise.all([1, 2, 3, 4].map(function () {
    return enqueue(async function () { active++; peak = Math.max(peak, active); await new Promise(function (resolve) { setTimeout(resolve, 10); }); active--; });
  }));
  assert.equal(peak, 2);
});

test('selected soundtrack jumps ahead of other waiting preview mixes', async function () {
  const enqueue = previews.createQueue(1);
  const order = [];
  let releaseFirst;
  const gate = new Promise(function (resolve) { releaseFirst = resolve; });
  const first = enqueue(async function () { await gate; order.push('first'); }, 'first');
  const second = enqueue(async function () { order.push('second'); }, 'second');
  const selected = enqueue(async function () { order.push('selected'); }, 'selected');
  enqueue.promote('selected');
  releaseFirst();
  await Promise.all([first, second, selected]);
  assert.deepEqual(order, ['first', 'selected', 'second']);
});
