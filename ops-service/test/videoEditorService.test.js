'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const express = require('express');
const Database = require('better-sqlite3');
const editor = require('../src/videoEditorService');
const { maskCaption } = require('../public/lib/captionMask');

test('viewer captions mask whole swear words without changing transcript text or harmless words', function () {
  const spoken = 'Fucking shit, BULLSHIT! This class assistant is not a bitch.';
  assert.equal(maskCaption(spoken), 'F*cking sh*t, BULLSH*T! This class assistant is not a b*tch.');
  assert.equal(spoken, 'Fucking shit, BULLSHIT! This class assistant is not a bitch.');
  assert.equal(maskCaption('f*cking sh*t'), 'f*cking sh*t');
});

test('both landscape and portrait ASS renders mask spoken words and fallback captions', function () {
  const group = { start: 0, end: 1, text: 'Fucking shit!', words: [
    { text: 'Fucking', start: 0, end: 0.5 }, { text: 'shit!', start: 0.5, end: 1 }
  ] };
  for (const shape of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const ass = editor.buildAss(shape, [group, { start: 1, end: 2, text: 'What the fuck?' }]);
    assert.match(ass, /F\*cking/);
    assert.match(ass, /sh\*t!/);
    assert.match(ass, /What the f\*ck\?/);
    assert.doesNotMatch(ass, /Fucking|shit!|the fuck\?/);
  }
  assert.equal(group.words[0].text, 'Fucking');
});

test('INSERT CLIP directives parse YouTube ranges and preserve the caption cue', function () {
  const directives = editor.parseInsertClipDirectives('<p>INSERT CLIP: https://youtu.be/abc123 0:24-0:28, “The problem we face is that we do not understand God.”</p>');
  assert.equal(directives.length, 1);
  assert.equal(directives[0].sourceStart, 24);
  assert.equal(directives[0].sourceEnd, 28);
  assert.match(directives[0].quote, /problem we face/);
});

test('inserted clips are gain-matched to the main voice loudness', function () {
  const measured = editor.parseIntegratedLoudness('noise\n{\n  "input_i" : "-24.37",\n  "input_tp" : "-8.00"\n}\n');
  assert.equal(measured, -24.37);
  assert.equal(editor.insertedClipGainDb(-16.2, -25.75), 9.55);
  assert.equal(editor.insertedClipGainDb(-30, -80), 30);
  assert.throws(function () { editor.parseIntegratedLoudness('{ "input_i" : "-inf" }'); }, /too quiet/);
});

test('manual voice-level adjustments are bounded and become timed FFmpeg gain filters', function () {
  assert.deepEqual(editor.normalizeVoiceGainAdjustments([
    { start: 15.4904, gainDb: -2.934 }, { start: 999, gainDb: -80 }, { start: 'bad', gainDb: 2 }
  ], 45.94), [
    { start: 15.49, gainDb: -2.93 }, { start: 45.94, gainDb: -24 }
  ]);
  assert.equal(editor.voiceGainFilter([{ start: 15.49, gainDb: -2.93 }], 45.94),
    "volume=-2.93dB:enable='gte(t\\,15.490)'");
});

test('inserted clips split the source timeline and supply their own timed captions', function () {
  const project = {
    duration: 4, removedWordIndices: [],
    words: [{ index: 0, text: 'before', start: 0.2, end: 0.8 }, { index: 1, text: 'after', start: 1.2, end: 1.8 }],
    insertedClips: [{ id: 'clip-1', status: 'ready', duration: 2, afterSourceTime: 0.8, words: [{ text: 'external', start: 0.1, end: 0.8 }] }]
  };
  const segments = editor.editorTimelineSegments(project, []);
  assert.deepEqual(segments.map(function (segment) { return segment.type; }), ['source', 'insert', 'source']);
  assert.equal(segments[2].cameraResetAfterInsert, true);
  assert.deepEqual(editor.cameraMotionForSegment(segments[2], [], 'horizontal'), {
    editedTime: 0.8, resetAt: 0.8, elapsed: 0, duration: 3
  });
  const groups = editor.renderCaptionGroups(project, [], segments);
  assert.deepEqual(groups.map(function (group) { return group.text; }), ['before', 'external', 'after']);
  assert.ok(groups[2].start >= 3.19);
});

const words = [
  { index: 0, text: 'This', start: 1.0, end: 1.3 },
  { index: 1, text: 'works.', start: 1.35, end: 1.8 },
  { index: 2, text: 'Delete', start: 4.0, end: 4.4 },
  { index: 3, text: 'this.', start: 4.45, end: 4.9 },
  { index: 4, text: 'Keep', start: 6.6, end: 7.0 },
  { index: 5, text: 'going.', start: 7.05, end: 7.6 }
];

test('display dimensions honor phone rotation metadata', function () {
  assert.deepEqual(editor.displayDimensions(1920, 1080, -90), { width: 1080, height: 1920 });
  assert.deepEqual(editor.displayDimensions(1920, 1080, 0), { width: 1920, height: 1080 });
  assert.deepEqual(editor.displayDimensions(1080, 1920, 180), { width: 1080, height: 1920 });
});

test('normalizes only timed spoken words and assigns stable indices', function () {
  assert.deepEqual(editor.normalizeWords([
    { type: 'word', text: ' Hello ', start: 0.2, end: 0.5 },
    { type: 'spacing', text: ' ', start: 0.5, end: 0.6 },
    { type: 'word', text: 'world', start: 0.6, end: 1 }
  ]), [
    { index: 0, text: 'Hello', start: 0.2, end: 0.5 },
    { index: 1, text: 'world', start: 0.6, end: 1 }
  ]);
});

test('recording identity uses bytes rather than camera name and size', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-hash-'));
  const first = path.join(dir, 'first.bin'); const second = path.join(dir, 'second.bin');
  fs.writeFileSync(first, 'same-size-A'); fs.writeFileSync(second, 'same-size-B');
  assert.equal(fs.statSync(first).size, fs.statSync(second).size);
  assert.notEqual(await editor.hashFile(first), await editor.hashFile(second));
  assert.equal(await editor.hashFile(first), await editor.hashFile(first));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
});

test('stale temporary media is removed without touching active uploads', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-temp-'));
  const stale = path.join(dir, 'stale-upload');
  const active = path.join(dir, 'active-upload');
  fs.writeFileSync(stale, 'old'); fs.writeFileSync(active, 'new');
  const now = Date.now();
  fs.utimesSync(stale, new Date(now - 25 * 60 * 60 * 1000), new Date(now - 25 * 60 * 60 * 1000));
  fs.utimesSync(active, new Date(now - 10 * 60 * 1000), new Date(now - 10 * 60 * 1000));
  assert.equal(await editor.cleanStaleTempFiles(dir, 24 * 60 * 60 * 1000, now), 1);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(active), true);
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
});

test('restart cleanup removes only Editor-owned temporary files regardless of age', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-orphans-'));
  fs.writeFileSync(path.join(dir, 'editor-upload-partial'), 'partial camera upload');
  fs.writeFileSync(path.join(dir, 'editor-project-random.mp3'), 'partial transcription audio');
  fs.writeFileSync(path.join(dir, 'audio-preview-shared.mp3'), 'another feature');
  fs.writeFileSync(path.join(dir, 'chat-attachment.png'), 'another feature');
  assert.equal(await editor.cleanOrphanedEditorTempFiles(dir), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['audio-preview-shared.mp3', 'chat-attachment.png']);
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
});

test('upload capacity reserves the source, one full-size render and operating space', function () {
  const gib = 1024 * 1024 * 1024;
  assert.equal(editor.maxUploadBytes, 16 * gib);
  assert.equal(editor.oversizedSourceBytes, 6 * gib);
  assert.equal(editor.requiredEditorCapacity(2 * gib, false), 6 * gib);
  assert.equal(editor.requiredEditorCapacity(2 * gib, true), 4 * gib);
});

test('batch capacity reserves one render for unfinished earlier recordings', function () {
  assert.equal(editor.outstandingEditorCapacity([
    { sizeBytes: 100, browserPreviewRequired: true, browserPreviewStatus: 'pending', renderStatus: '' },
    { sizeBytes: 200, browserPreviewRequired: false, renderStatus: 'ready' },
    { sizeBytes: 1000, productionPieceId: 'already-sent', renderStatus: 'ready' }
  ]), 100 + 200 * 2);
  assert.equal(editor.outstandingEditorCapacity([
    { sizeBytes: 100, renderSizeBytes: 25, browserPreviewRequired: true, browserPreviewStatus: 'ready', renderStatus: 'ready' }
  ]), 50);
  assert.equal(editor.outstandingEditorCapacity([
    { sizeBytes: 100, browserPreviewRequired: true, browserPreviewStatus: 'ready', renderStatus: 'ready' }
  ]), 200);
});

test('concurrent upload reservations are counted and released exactly once', function () {
  const ledger = editor.createByteReservationLedger();
  const first = ledger.reserve(500);
  const second = ledger.reserve(750);
  assert.equal(ledger.total(), 1250);
  assert.equal(ledger.release(first), true);
  assert.equal(ledger.release(first), false);
  assert.equal(ledger.total(), 750);
  assert.equal(ledger.release(second), true);
  assert.equal(ledger.total(), 0);
});

test('concurrent byte-identical uploads share one creation claim', async function () {
  const claims = editor.createKeyedClaimRegistry();
  const first = claims.claim('same-sha');
  const second = claims.claim('same-sha');
  assert.equal(first.owner, true);
  assert.equal(second.owner, false);
  assert.equal(claims.size(), 1);
  first.settle('project-1');
  assert.equal(await second.result, 'project-1');
  assert.equal(first.settle('project-2'), false);
  assert.equal(claims.size(), 0);

  const failed = claims.claim('retry-sha');
  failed.settle('');
  assert.equal(await failed.result, '');
  const retry = claims.claim('retry-sha');
  assert.equal(retry.owner, true);
  retry.settle('project-3');
});

test('final renders take the next encoder slot ahead of waiting proxies', async function () {
  const queue = editor.createPriorityTaskQueue(1);
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(function (resolve) { releaseFirst = resolve; });
  const first = queue.enqueue(async function () { order.push('proxy-running'); await firstGate; }, 'normal');
  const second = queue.enqueue(async function () { order.push('proxy-waiting'); }, 'normal');
  await new Promise(function (resolve) { setImmediate(resolve); });
  const final = queue.enqueue(async function () { order.push('final'); }, 'urgent');
  releaseFirst();
  await Promise.all([first, second, final]);
  assert.deepEqual(order, ['proxy-running', 'final', 'proxy-waiting']);
});

test('encoder queue runs a bounded pair concurrently and still prioritizes final renders', async function () {
  const queue = editor.createPriorityTaskQueue(2);
  const order = [];
  let active = 0;
  let maximumActive = 0;
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise(function (resolve) { releaseFirst = resolve; });
  const secondGate = new Promise(function (resolve) { releaseSecond = resolve; });
  function tracked(label, gate) {
    return async function () {
      order.push(label);
      active++;
      maximumActive = Math.max(maximumActive, active);
      if (gate) await gate;
      active--;
    };
  }
  const first = queue.enqueue(tracked('proxy-one', firstGate), 'normal');
  const second = queue.enqueue(tracked('proxy-two', secondGate), 'normal');
  await new Promise(function (resolve) { setImmediate(resolve); });
  const waitingProxy = queue.enqueue(tracked('proxy-waiting'), 'normal');
  const final = queue.enqueue(tracked('final'), 'urgent');
  releaseFirst();
  await final;
  releaseSecond();
  await Promise.all([first, second, waitingProxy]);
  assert.equal(maximumActive, 2);
  assert.ok(order.indexOf('final') < order.indexOf('proxy-waiting'));
});

test('encoder concurrency defaults to one full-CPU encode and honors explicit larger hosts', function () {
  assert.equal(editor.encoderConcurrencyForCpuCount(1), 1);
  assert.equal(editor.encoderConcurrencyForCpuCount(2), 1);
  assert.equal(editor.encoderConcurrencyForCpuCount(8), 1);
  assert.equal(editor.encoderConcurrencyForCpuCount(8, 1), 1);
  assert.equal(editor.encoderConcurrencyForCpuCount(2, 8), 2);
  assert.equal(editor.encoderConcurrencyForCpuCount(8, 3), 3);
});

test('decision previews stay tiny while production masters preserve native resolution up to 4K', function () {
  assert.deepEqual(editor.renderShapeForProject({ width: 3840, height: 2160 }, 'horizontal', false), { width: 720, height: 404 });
  assert.deepEqual(editor.renderShapeForProject({ width: 3840, height: 2160 }, 'horizontal', true), { width: 3840, height: 2160 });
  assert.deepEqual(editor.renderShapeForProject({ width: 2160, height: 3840 }, 'vertical', true), { width: 2160, height: 3840 });
  assert.deepEqual(editor.renderShapeForProject({ width: 1920, height: 1080 }, 'horizontal', true), { width: 1920, height: 1080 });
  assert.deepEqual(editor.renderShapeForProject({ width: 1920, height: 1080 }, 'vertical', true), { width: 606, height: 1080 });
});

test('horizontal outros fade within 1.7 seconds and reserve only a music-backed black tail', function () {
  assert.deepEqual(editor.renderOutroTiming('horizontal', false), {
    visualFadeSeconds: 1.7, totalSeconds: 1.7, musicTailSeconds: 0
  });
  assert.deepEqual(editor.renderOutroTiming('horizontal', true), {
    visualFadeSeconds: 1.7, totalSeconds: 2, musicTailSeconds: 0.3
  });
  assert.deepEqual(editor.renderOutroTiming('vertical', true), {
    visualFadeSeconds: 2, totalSeconds: 2, musicTailSeconds: 0
  });
});

test('encoder queue never overlaps two jobs for the same recording', async function () {
  const queue = editor.createPriorityTaskQueue(2);
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(function (resolve) { releaseFirst = resolve; });
  const first = queue.enqueue(async function () { order.push('same-first'); await firstGate; }, 'normal', 'recording-a');
  await new Promise(function (resolve) { setImmediate(resolve); });
  const same = queue.enqueue(async function () { order.push('same-second'); }, 'urgent', 'recording-a');
  const other = queue.enqueue(async function () { order.push('other'); }, 'normal', 'recording-b');
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(order, ['same-first', 'other']);
  releaseFirst();
  await Promise.all([first, same, other]);
  assert.deepEqual(order, ['same-first', 'other', 'same-second']);
});

test('every camera recording receives a scrub-optimized review proxy', function () {
  assert.equal(editor.browserPreviewNeeded('camera.mp4', { videoCodec: 'hevc', audioCodec: 'aac' }), true);
  assert.equal(editor.browserPreviewNeeded('camera.mkv', { videoCodec: 'h264', audioCodec: 'aac' }), true);
  assert.equal(editor.browserPreviewNeeded('camera.MOV', { videoCodec: 'h264', audioCodec: 'aac' }), true);
  assert.equal(editor.browserPreviewNeeded('camera.MOV', { videoCodec: 'h264', audioCodec: 'aac', rotation: -90 }), true);
  assert.equal(editor.browserPreviewNeeded('camera.mp4', { videoCodec: 'h264', audioCodec: 'pcm_s16le' }), true);
});

test('camera zoom supports a gentler vertical opening while preserving the 125 percent default', function () {
  assert.equal(editor.openingPushInScale(0), 1);
  assert.equal(editor.openingPushInScale(1.5), 1.125);
  assert.equal(editor.openingPushInScale(3), 1.25);
  assert.equal(editor.openingPushInScale(20), 1.25);
  assert.equal(editor.openingPushInScale(2.5, 5), 1.125);
  assert.equal(editor.openingPushInScale(5, 5), 1.25);
  assert.equal(editor.openingPushInScale(1.5, 3, 1.125), 1.0625);
  assert.equal(editor.openingPushInScale(3, 3, 1.125), 1.125);
  const filter = editor.openingPushInFilter({ width: 1080, height: 1920 }, 1.25);
  assert.match(filter, /zoompan=/);
  assert.match(filter, /on\+37\.462537/);
  assert.match(filter, /s=1080x1920/);
  assert.doesNotMatch(filter, /scale=w='trunc/);
});

test('vertical camera moves stay gentle after page turns while horizontal reveals retain the stronger target', function () {
  assert.equal(editor.cameraMotionTargetScale('vertical', { resetAt: 0 }), 1.125);
  assert.equal(editor.cameraMotionTargetScale('vertical', { resetAt: 4 }), 1.125);
  assert.equal(editor.cameraMotionTargetScale('vertical', { resetAt: 0 }, true), 1.125);
  assert.equal(editor.cameraMotionTargetScale('horizontal', { resetAt: 0 }), 1.125);
  assert.equal(editor.cameraMotionTargetScale('horizontal', { resetAt: 4 }), 1.25);
  const filter = editor.cameraMotionFilter({
    renderShape: { width: 1080, height: 1920 },
    layout: 'vertical',
    elapsedStart: 0,
    durationSeconds: 3,
    targetScale: 1.125,
    openingEnabled: true
  });
  assert.match(filter, /0\.125/);
  assert.doesNotMatch(filter, /0\.250/);
});

test('page-change zoom uses one centred fractional resampling stage', function () {
  const filter = editor.cameraMotionFilter({
    renderShape: { width: 1080, height: 1920 },
    elapsedStart: 0.5,
    durationSeconds: 3,
    openingEnabled: true
  });
  assert.equal((filter.match(/zoompan=/g) || []).length, 1);
  assert.match(filter, /0\.250/);
  assert.match(filter, /\*0\.5/);
  assert.equal(editor.cameraMotionPreparationFilter({ width: 720, height: 404 }, true), ',setsar=1');
  assert.equal(editor.cameraMotionPreparationFilter({ width: 720, height: 404 }, false), ',scale=720:404,setsar=1');
});

test('clean Editor projects reopen rendered while dirty projects reopen in the live working preview', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  assert.match(source, /var mode = item\.renderStatus === 'ready' && !item\.renderDirty \? 'final' : 'source';/);
  assert.doesNotMatch(source, /saved\.mode === 'source' \|\| item\.renderStatus !== 'ready'/);
});

test('a new Editor cut stays in the captioned working preview with synchronized playheads', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(source, /previewingWorkingEdit = previewMode === 'source' && !explicitSourcePreviews\[project\.id\]/);
  assert.match(source, /previewingOriginalMaster = !previewingFinal && !!explicitSourcePreviews\[project\.id\]/);
  assert.match(source, /previewModes\[id\] = 'source';\s+delete explicitSourcePreviews\[id\];/);
  assert.match(source, /id="editorPreviewWorking"/);
  assert.match(source, /previewSeekTimes\[cutProjectId\] = selection\.start;/);
  assert.match(source, /Cut applied · ' \+ removedSeconds\.toFixed\(2\) \+ 's removed/);
  assert.match(source, /updateReviewPlayheads\(sourceTime\);\s+syncPlayerControls\(\);/);
  assert.doesNotMatch(source, /previewModes\[id\] = 'source';\s+explicitSourcePreviews\[id\] = true;/);
  assert.match(styles, /\.editor-playhead\{transition:none\}/);
});

test('Editor remembers one source position across refresh, project switches and preview rebuilds', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  assert.match(source, /localStorage\.setItem\(reviewProgressKey\(id\), JSON\.stringify\(value\)\)/);
  assert.match(source, /sourceTime: Math\.max\(0, Number\(sourceTime\) \|\| 0\)/);
  assert.match(source, /saved && typeof saved === 'object' \? Number\(saved\.sourceTime\) : NaN/);
  assert.match(source, /!video\.getAttribute\('src'\)/);
  assert.match(source, /persistCurrentReviewProgress\(\);\s+clearTimeout\(pollTimer\)/);
  assert.match(source, /persistCurrentReviewProgress\(\);\s+stopManualRevisionDictation\(\)/);
  assert.match(source, /video\.addEventListener\('pause', persistCurrentReviewProgress\)/);
  assert.match(source, /video\.addEventListener\('seeked', persistCurrentReviewProgress\)/);
  assert.match(source, /var renderProjectId = project\.id;\s+var wasRebuild = !!project\.renderDirty;\s+persistCurrentReviewProgress\(\);/);
  assert.match(source, /if \(saved\.timelineOpen\) manualTimelineOpen\[item\.id\] = true;/);
  assert.match(source, /manualTimelineViewStates\[item\.id\] = \{/);
  assert.match(source, /if \(project\) \{ restoreReviewProgress\(project\); renderWorkspace\(\); \}/);
});

test('horizontal camera motion zooms into the exact frame centre', function () {
  const filter = editor.cameraMotionFilter({
    renderShape: { width: 1920, height: 1080 },
    layout: 'horizontal',
    elapsedStart: 5,
    durationSeconds: 5,
    openingEnabled: true
  });
  assert.equal((filter.match(/\*0\.5/g) || []).length, 2);
  assert.doesNotMatch(filter, /\*0\.25|\*0\.34/);
  assert.match(filter, /0\.250/);
  const previewSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  assert.match(previewSource, /offsetX = width \* \(1 - openingScale\) \* 0\.5;/);
  assert.match(previewSource, /offsetY = height \* \(1 - openingScale\) \* 0\.5;/);
  assert.match(previewSource, /HORIZONTAL_OPENING_CAMERA_SCALE = 1\.125;/);
});

test('camera motion restarts after automatic long-pause cuts but not manual cuts', function () {
  const cuts = [
    { id: 'page-one', start: 4, end: 7, reason: 'long_pause' },
    { id: 'manual', start: 10, end: 11, reason: 'transcript_cut' },
    { id: 'brief', start: 12, end: 12.8, reason: 'long_pause' },
    { id: 'page-two', start: 14, end: 17, reason: 'combined' },
    { id: 'hesitation', start: 18, end: 19.9, reason: 'long_pause' }
  ];
  assert.deepEqual(editor.cameraResetStarts(cuts), [0, 4, 9.2]);
  assert.deepEqual(editor.cameraResetStarts(cuts, ['page-two']), [0, 9.2]);
  assert.equal(editor.visualPageChangeFromSsim(0.49), true);
  assert.equal(editor.visualPageChangeFromSsim(0.5), false);
  assert.equal(editor.visualPageChangeFromSsim(0.72), false);
  assert.deepEqual(editor.cameraMotionState(0, cuts, 'vertical'), { editedTime: 0, resetAt: 0, elapsed: 0, duration: 3 });
  assert.deepEqual(editor.cameraMotionState(7, cuts, 'vertical'), { editedTime: 4, resetAt: 4, elapsed: 0, duration: 3 });
  assert.deepEqual(editor.cameraMotionState(11, cuts, 'vertical'), { editedTime: 7, resetAt: 4, elapsed: 3, duration: 3 });
  assert.deepEqual(editor.cameraMotionState(17, cuts, 'horizontal'), { editedTime: 9.2, resetAt: 9.2, elapsed: 0, duration: 3 });
  assert.equal(editor.cameraMotionState(2.5, cuts, 'horizontal').duration, 5);
});

test('approval only accepts the exact verified render bytes', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-verified-'));
  const file = path.join(dir, 'render.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048));
  const project = { renderStatus: 'ready', renderQuality: { status: 'passed' }, renderSizeBytes: 2048,
    renderSha256: crypto.createHash('sha256').update(Buffer.alloc(2048)).digest('hex') };
  assert.equal(await editor.verifiedRenderMatches(project, file), true);
  fs.writeFileSync(file, Buffer.alloc(2048, 1));
  assert.equal(await editor.verifiedRenderMatches(project, file), false);
  assert.equal(await editor.verifiedRenderMatches(Object.assign({}, project, { renderQuality: null }), file), false);
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
});

test('render loudness parsing distinguishes audible output from digital silence', function () {
  assert.equal(editor.parseMaxVolume('[Parsed_volumedetect] max_volume: -12.4 dB'), -12.4);
  assert.equal(editor.parseMaxVolume('max_volume: -inf dB'), -Infinity);
  assert.equal(editor.parseMaxVolume('unrelated ffmpeg output'), -Infinity);
});

test('render duration tolerance stays strict for long-form output', function () {
  assert.equal(editor.renderDurationTolerance(16), 0.35);
  assert.equal(editor.renderDurationTolerance(60), 0.6);
  assert.equal(editor.renderDurationTolerance(300), 1.5);
  assert.equal(editor.renderDurationTolerance(3600), 1.5);
});

test('automatic cuts preserve natural handles around long pauses', function () {
  const cuts = editor.calculateAutoCuts(words, 9);
  assert.deepEqual(cuts.map(function (cut) { return cut.reason; }), ['leading_silence', 'long_pause', 'long_pause', 'trailing_silence']);
  assert.equal(cuts[0].end, 0.92);
  assert.equal(cuts[1].start, 1.92);
  assert.equal(cuts[1].end, 3.88);
});

test('a new recording starts just before its first timed word, even with a brief setup', function () {
  for (const firstWordStart of [0.2, 3.7, 13.56]) {
    const project = {
      duration: firstWordStart + 2,
      autoSilenceEnabled: true,
      words: [{ index: 0, text: 'Hello', start: firstWordStart, end: firstWordStart + 0.4 }],
      removedWordIndices: [], restoredAutoCutIds: [], manualTrimCuts: []
    };
    const firstFrame = editor.keepSegments(project.duration, editor.cutsForProject(project))[0].start;
    assert.ok(Math.abs(firstFrame - (firstWordStart - 0.08)) < 0.001, String(firstWordStart));
  }
});

test('sub-perceptual islands between adjacent cuts are removed continuously', function () {
  assert.deepEqual(editor.mergeCuts([
    { id: 'first', start: 1, end: 2, reason: 'long_pause' },
    { id: 'second', start: 2.08, end: 3, reason: 'transcript_cut' }
  ], 10), [{ id: '', start: 1, end: 3, reason: 'combined' }]);
  assert.deepEqual(editor.mergeCuts([
    { id: 'first', start: 1, end: 2, reason: 'long_pause' },
    { id: 'second', start: 2.13, end: 3, reason: 'transcript_cut' }
  ], 10).map(function (cut) { return [cut.start, cut.end]; }), [[1, 2], [2.13, 3]]);
});

test('individual automatic pauses can be restored without disabling the rest', function () {
  const project = { words: words, duration: 9, autoSilenceEnabled: true, restoredAutoCutIds: ['gap-1'] };
  const cuts = editor.cutsForProject(project);
  assert.equal(cuts.some(function (cut) { return cut.start < 4 && cut.end > 2; }), false);
  assert.equal(cuts.some(function (cut) { return cut.id === 'gap-3'; }), true);
  const decisions = editor.gapDecisions(project);
  assert.equal(decisions.find(function (cut) { return cut.id === 'gap-1'; }).restored, true);
});

test('format classification trusts recording orientation and explicit overrides', function () {
  const project = { width: 3840, height: 2160, duration: 80, words: words, visualClassification: { layout: 'vertical', confidence: 'low' } };
  assert.equal(editor.effectiveLayout(project), 'horizontal');
  assert.equal(editor.contentTypeForProject(project, []), 'longform');
  assert.equal(editor.layoutReviewRequired(project), false);
  project.layoutOverride = 'vertical';
  assert.equal(editor.effectiveLayout(project), 'vertical');
  assert.equal(editor.contentTypeForProject(project, []), 'long_short');
  project.layoutOverride = 'horizontal';
  assert.equal(editor.effectiveLayout(project), 'horizontal');
  assert.equal(editor.contentTypeForProject(project, []), 'longform');
  assert.equal(editor.layoutReviewRequired(project), false);
  project.contentTypeOverride = 'short';
  assert.equal(editor.contentTypeForProject(project, []), 'short');
  assert.equal(editor.effectiveLayout({ width: 1080, height: 1920, visualClassification: { layout: 'horizontal' } }), 'vertical');
  assert.equal(editor.layoutReviewRequired({ width: 1080, height: 1920, visualClassification: { layout: 'horizontal', confidence: 'low' } }), false);
  assert.equal(editor.blockingReviewFailure({ width: 1920, height: 1080, layoutOverride: 'auto', classificationStatus: 'error' }), '');
  assert.equal(editor.blockingReviewFailure({ width: 1920, height: 1080, retakeAnalysisStatus: 'error' }), '');
});

test('planning linkage failures do not block an otherwise safe automatic edit', function () {
  const safe = {
    transcriptionStatus: 'ready', classificationStatus: 'ready', retakeAnalysisStatus: 'ready',
    planningMatchStatus: 'error', words: [], removedWordIndices: [], retakeDecisions: [],
    layoutOverride: 'vertical', width: 1920, height: 1080
  };
  assert.equal(editor.automaticReviewReady(safe), true);
  assert.equal(editor.automaticReviewReady(Object.assign({}, safe, { planningMatchStatus: 'running' })), false);
  assert.equal(editor.automaticReviewReady(Object.assign({}, safe, { retakeAnalysisStatus: 'error' })), true);
  assert.equal(editor.automaticReviewReady(Object.assign({}, safe, { classificationStatus: 'error' })), true);
});

test('invalidating an edit clears every stale output claim', function () {
  const project = { renderStatus: 'ready', renderError: 'old', renderProgress: 100, automaticRenderStartedAt: 'then',
    renderQuality: { status: 'passed' }, renderSizeBytes: 1234, editedDuration: 42 };
  editor.invalidateRender(project);
  assert.deepEqual(project, { renderStatus: '', renderError: '', renderProgress: 0, automaticRenderStartedAt: '', renderQuality: null, renderSizeBytes: 0, renderSha256: '', editedDuration: 0, pageChangeCutIds: [] });
});

test('metadata-only editor changes preserve a verified render', function () {
  assert.equal(editor.patchAffectsRender({ planningPieceId: 'plan-2' }), false);
  assert.equal(editor.patchAffectsRender({ contentTypeOverride: 'short' }), false);
  assert.equal(editor.patchAffectsRender({ dismissedRetakeIds: ['retake-1'] }), false);
  assert.equal(editor.patchAffectsRender({ captionsEnabled: false }), true);
  assert.equal(editor.patchAffectsRender({ removedWordIndices: [1, 2] }), true);
  assert.equal(editor.patchAffectsRender({ manualTrimCuts: [{ start: 1, end: 2 }] }), true);
  assert.equal(editor.patchAffectsRender({ layoutOverride: 'vertical' }), true);
  assert.equal(editor.patchAffectsRender({ openingPushInEnabled: false }), true);
  assert.equal(editor.patchAffectsRender({ voiceGainAdjustments: [{ start: 15.49, gainDb: -2.93 }] }), true);
  assert.equal(editor.patchAffectsRender({ punchIns: [{ start: 1, end: 2 }] }), false);
  assert.equal(editor.patchNeedsAutoRender({ renderStatus: 'ready' }, false), false);
  assert.equal(editor.patchNeedsAutoRender({ renderStatus: '' }, false), false);
  assert.equal(editor.patchNeedsAutoRender({ renderStatus: 'ready' }, true), false);
});

test('Editor UI batches transcript cuts behind one explicit preview rebuild', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(source, /project\.renderDirty \? 'Rebuild preview' : 'Build editing preview'/);
  assert.match(source, /Transcript edits saved/);
  assert.match(source, /Keep cutting mistakes, then press Rebuild preview once/);
  assert.doesNotMatch(source, /scheduleAutoRender\(project\.id, EDIT_RENDER_DEBOUNCE_MS\)/);
  assert.match(source, /suspected-mistake/);
  assert.match(source, /Remove highlighted sections/);
  assert.match(source, /transcriptParagraphStartIndices/);
  assert.doesNotMatch(source, /Removed automatically/);
  assert.doesNotMatch(source, /Every automatic silence cut/);
  assert.match(source, /No changes have been made\. The first editable preview is being prepared/);
  assert.match(source, /initial processing—not a change you made/);
  assert.match(source, /var mediaUnavailable = previewLocked \|\| sourcePreviewPreparing/);
  assert.match(source, /Preparing browser-safe preview…/);
  assert.match(source, /Playback will unlock automatically/);
  assert.match(source, /\(mediaUnavailable \? '' : ' src="' \+ previewUrl/);
  assert.match(source, /editor-manual-cut-handle/);
  assert.match(source, /Adjusted automatic timeline cut/);
  assert.match(source, /Cut edge moved/);
  assert.match(page, /lib\/captionMask\.js\?v=20261015-mask-swears/);
  assert.match(page, /editor\.js\?v=20261016-vertical-preview-v153/);
  assert.match(page, /style\.css\?v=20261016-vertical-preview-v159/);
  assert.match(source, /class="editor-sticky-cut"><button type="button" class="btn-primary btn-tiny" id="editorCut" disabled>Cut selected/);
  assert.match(source, /root\.querySelector\('#editorCut'\)\.onclick = function \(\) \{ alterSelected\(true\); \}/);
  assert.match(styles, /\.editor-sticky-cut\{position:sticky;top:0/);
  assert.match(styles, /\.editor-manual-cut-handle/);
  assert.match(styles, /\.editor-caption\.longform\{font-size:2\.05cqw;text-shadow:-1px -1px 0 #111,1px -1px 0 #111/);
  assert.match(source, /Raw original · no edits\/captions/);
  assert.match(source, /cuts, captions and animations are not shown/);
  assert.match(source, /if \(completedReplacement\)/);
});

test('startup probing preserves an active browser preview encode', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'videoEditorService.js'), 'utf8');
  assert.match(source, /const previewJobActive = previewJobs\.has\(current\.id\)/);
  assert.match(source, /needsPreview && !previewValid && !previewJobActive/);
  assert.match(source, /previewJobActive \? current\.browserPreviewStatus : 'pending'/);
});

test('Editor summary shows live laptop upload progress independently of project processing', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(source, /api\/desktop-uploader\/devices/);
  assert.match(source, /device\.status === 'uploading'/);
  assert.match(source, /Uploading · ' \+ percent \+ '%/);
  assert.match(source, /pollDesktopUploaderStatus\(expectedMountToken\)/);
  assert.match(styles, /editor-session-summary \.uploading/);
});

test('Editor explains and polls oversized source preparation', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  assert.match(source, /Archiving original to R2/);
  assert.match(source, /Building a faster editing master/);
  assert.match(source, /source-preparation\/retry/);
  assert.match(source, /sourcePreparationStatus/);
});

test('precise manual trims bridge residual fragments between automatic and transcript cuts', function () {
  const project = {
    duration: 70,
    autoSilenceEnabled: true,
    silenceThresholdSeconds: 1,
    retainedPauseSeconds: 0.38,
    words: [
      { index: 0, text: 'before', start: 32.2, end: 32.52 },
      { index: 1, text: 'rejected', start: 51.36, end: 60.6 },
      { index: 2, text: 'Money', start: 64.9, end: 65.1 }
    ],
    removedWordIndices: [1],
    manualTrimCuts: [{ id: 'manual-mumble-26s', start: 32.71, end: 64.71, note: 'Remove residual mumble' }]
  };
  assert.deepEqual(editor.normalizeManualTrimCuts(project.manualTrimCuts, project.duration), [{
    id: 'manual-mumble-26s', start: 32.71, end: 64.71, note: 'Remove residual mumble', reason: 'manual_trim'
  }]);
  assert.deepEqual(editor.cutsForProject(project), [{
    id: 'lead', start: 0, end: 32.12, reason: 'leading_silence'
  }, {
    id: '', start: 32.64, end: 64.78, reason: 'combined'
  }, {
    id: 'tail', start: 65.35, end: 70, reason: 'trailing_silence'
  }]);
});

test('manual timeline trims remove the selected source interval and ripple later footage left', function () {
  const project = {
    duration: 10,
    autoSilenceEnabled: false,
    words: [],
    removedWordIndices: [],
    manualTrimCuts: [{ id: 'timeline-test', start: 2, end: 4, note: 'Deleted from manual timeline' }]
  };
  const cuts = editor.cutsForProject(project);
  assert.deepEqual(cuts, [{ id: 'timeline-test', start: 2, end: 4, reason: 'manual_trim' }]);
  assert.deepEqual(editor.keepSegments(project.duration, cuts), [{ start: 0, end: 2 }, { start: 4, end: 10 }]);
});

test('manual timeline exposes separate draggable automatic and precise cut boundaries', function () {
  const project = {
    duration: 12,
    autoSilenceEnabled: true,
    silenceThresholdSeconds: 1,
    retainedPauseSeconds: 0.24,
    words: [{ index: 0, text: 'Hello', start: 2, end: 2.4 }, { index: 1, text: 'again', start: 6, end: 6.4 }],
    restoredAutoCutIds: ['lead'],
    manualTrimCuts: [{ id: 'manual-one', start: 7, end: 7.5, note: 'Manual cut' }]
  };
  const editable = editor.editableTimelineCuts(project);
  assert.equal(editable.some(function (cut) { return cut.id === 'lead'; }), false);
  assert.equal(editable.find(function (cut) { return cut.id === 'gap-0'; }).editableOrigin, 'automatic');
  assert.equal(editable.find(function (cut) { return cut.id === 'manual-one'; }).editableOrigin, 'manual');
});

test('likely restarted lines are surfaced without being automatically removed', function () {
  const attempts = [
    { index: 0, text: 'The', start: 0, end: 0.2 }, { index: 1, text: 'problem', start: 0.25, end: 0.6 },
    { index: 2, text: 'The', start: 1.7, end: 1.9 }, { index: 3, text: 'problem', start: 1.95, end: 2.2 },
    { index: 4, text: 'is', start: 2.25, end: 2.4 }, { index: 5, text: 'obvious.', start: 2.45, end: 2.9 }
  ];
  const candidates = editor.retakeCandidates(attempts);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].confidence, 'high');
  assert.deepEqual(candidates[0].removeWordIndices, [0, 1]);
});

test('transcript paragraphs follow spoken pauses and stay readable during uninterrupted speech', function () {
  const words = Array.from({ length: 100 }, function (_, index) {
    const start = index * .25 + (index >= 20 ? 1.6 : 0);
    return { index: index, text: index === 79 ? 'point.' : 'word' + index, start: start, end: start + .18 };
  });
  const starts = editor.transcriptParagraphStartIndices(words, '');
  assert.deepEqual(starts, [0, 20, 80]);
});

test('matched planning-card paragraph openings reinforce transcript paragraph breaks', function () {
  const text = ['Opening', 'thought', 'sets', 'this', 'up.', 'Now', 'the', 'causal', 'framework', 'becomes', 'clear.', 'Finally', 'the', 'practical', 'conclusion', 'lands.'];
  const words = text.map(function (word, index) {
    return { index: index, text: word, start: index * .25, end: index * .25 + .18 };
  });
  const notes = '<p>Opening thought sets this up.</p><p>Now the causal framework becomes clear.</p><p>Finally the practical conclusion lands.</p>';
  assert.deepEqual(editor.transcriptParagraphStartIndices(words, notes), [0, 5, 11]);
});

test('Antoine Matthias is highlighted without automatically removing the marked take', function () {
  const timed = [
    { index: 0, text: 'Earlier', start: 0, end: .3 }, { index: 1, text: 'point.', start: .35, end: .7 },
    { index: 2, text: 'The', start: 1.8, end: 2 }, { index: 3, text: 'reason', start: 2.05, end: 2.35 },
    { index: 4, text: 'for', start: 2.4, end: 2.55 }, { index: 5, text: 'this', start: 2.6, end: 2.85 },
    { index: 6, text: 'Antoine', start: 4, end: 4.35 }, { index: 7, text: 'Matthias.', start: 4.4, end: 4.85 },
    { index: 8, text: 'The', start: 5.8, end: 6 }, { index: 9, text: 'reason', start: 6.05, end: 6.35 },
    { index: 10, text: 'for', start: 6.4, end: 6.55 }, { index: 11, text: 'existence.', start: 6.6, end: 7 }
  ];
  const decisions = editor.retakeMarkerDecisions(timed);
  assert.equal(decisions.length, 1);
  assert.deepEqual(decisions[0].removeWordIndices, [2, 3, 4, 5, 6, 7]);
  assert.equal(decisions[0].replacementText, 'The reason for existence.');
  assert.equal(decisions[0].source, 'marker');
  const project = { words: timed, removedWordIndices: [], autoRetakeRemovedWordIndices: [], dismissedRetakeIds: [], retakeDecisions: decisions, retakeWorkflowVersion: 3 };
  assert.deepEqual(editor.retakeHighlightsForProject(project).map(function (candidate) { return candidate.removeWordIndices; }), [[2, 3, 4, 5, 6, 7]]);
  assert.deepEqual(project.removedWordIndices, []);
  assert.equal(editor.appliedRetakeCount(project), 0);
  assert.deepEqual(editor.calculateManualCuts(timed, decisions[0].removeWordIndices, 8), [
    { start: .82, end: 5.68, reason: 'transcript_cut' }
  ]);
});

test('retake marker tolerates likely transcript spellings but requires both words', function () {
  const timed = ['Mistake', 'Antwan', 'Mathias', 'Clean', 'take.'].map(function (text, index) {
    return { index: index, text: text, start: index * .4, end: index * .4 + .3 };
  });
  assert.deepEqual(editor.retakeMarkerDecisions(timed)[0].removeWordIndices, [0, 1, 2]);
  assert.deepEqual(editor.retakeMarkerDecisions(timed.slice(0, 2)), []);
});

test('semantic retake ranges become bounded exact word decisions', function () {
  const decisions = editor.normalizeRetakeDecisions([{ removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 2, replacementEndIndex: 5, confidence: 'high', reason: 'The first attempt stops early.' }], [
    { index: 0, text: 'The', start: 0, end: .2 }, { index: 1, text: 'problem', start: .25, end: .6 },
    { index: 2, text: 'The', start: 1, end: 1.2 }, { index: 3, text: 'problem', start: 1.25, end: 1.6 },
    { index: 4, text: 'is', start: 1.65, end: 1.8 }, { index: 5, text: 'obvious.', start: 1.85, end: 2.2 }
  ]);
  assert.equal(decisions.length, 1);
  assert.deepEqual(decisions[0].removeWordIndices, [0, 1]);
  assert.equal(decisions[0].replacementText, 'The problem is obvious.');
  assert.equal(decisions[0].source, 'semantic');
  assert.equal(editor.normalizeRetakeDecisions([{ removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 1, replacementEndIndex: 5, confidence: 'high' }], words).length, 0);
  assert.equal(editor.normalizeRetakeDecisions([{ removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 999, replacementEndIndex: 1000, confidence: 'high' }], words).length, 0);
});

test('unrelated semantic ranges can never become automatic retake cuts', function () {
  const timed = [
    { index: 0, text: 'Our', start: 0, end: .2 }, { index: 1, text: 'strategy', start: .25, end: .6 },
    { index: 2, text: 'The', start: 1, end: 1.2 }, { index: 3, text: 'book', start: 1.25, end: 1.5 },
    { index: 4, text: 'opens', start: 1.55, end: 1.8 }, { index: 5, text: 'here.', start: 1.85, end: 2.1 }
  ];
  const decisions = editor.normalizeRetakeDecisions([{
    removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 2, replacementEndIndex: 5,
    confidence: 'high', reason: 'Synthetic mistaken replacement.'
  }], timed);
  assert.deepEqual(decisions, []);
  const project = { removedWordIndices: [], autoRetakeRemovedWordIndices: [], dismissedRetakeIds: [] };
  editor.reconcileAutomaticRetakeCuts(project, decisions);
  assert.deepEqual(project.removedWordIndices, []);
  assert.deepEqual(project.autoRetakeRemovedWordIndices, []);
});

test('highlight-only analysis may surface a suspicious restart without cutting it', function () {
  const timed = [
    { index: 0, text: 'I', start: 0, end: .1 }, { index: 1, text: 'mean', start: .15, end: .4 },
    { index: 2, text: 'no.', start: .45, end: .7 }, { index: 3, text: 'Here', start: 1.2, end: 1.45 },
    { index: 4, text: 'is', start: 1.5, end: 1.65 }, { index: 5, text: 'the', start: 1.7, end: 1.85 },
    { index: 6, text: 'point.', start: 1.9, end: 2.2 }
  ];
  const raw = [{ removeStartIndex: 0, removeEndIndex: 2, replacementStartIndex: 3, replacementEndIndex: 6, confidence: 'review', reason: 'The opening looks abandoned.' }];
  assert.deepEqual(editor.normalizeRetakeDecisions(raw, timed), []);
  const highlights = editor.normalizeRetakeDecisions(raw, timed, { highlightOnly: true });
  assert.deepEqual(highlights.map(function (candidate) { return candidate.removeWordIndices; }), [[0, 1, 2]]);
  assert.equal(highlights[0].confidence, 'review');
  assert.deepEqual(editor.retakeHighlightsForProject({ retakeWorkflowVersion: 3, retakeDecisions: highlights }), highlights);
});

test('conceptual repetition and continuations never become retake review cards', function () {
  assert.equal(editor.repeatedLineEvidence(
    'One may conclude that unconditional love requires unlimited tolerance of behaviour that causes genuine harm, or that remaining in a destructive relationship is somehow evidence of greater devotion.',
    "This too misunderstands oneness. Love does not require the annihilation of one's own well-being for the sake of another, because the self is also the part of the whole being loved."
  ), false);
  assert.equal(editor.repeatedLineEvidence(
    "Love does not require the annihilation of one's own well-being for the sake of another,",
    'because the self is also the part of the whole being loved.'
  ), false);
  const legacyProject = { retakeDecisions: [{
    id: 'smart-retake-legacy', firstText: 'Love does not require the annihilation of itself.',
    replacementText: 'because the self is part of the whole being loved.', removeWordIndices: [0, 1], confidence: 'review'
  }] };
  assert.deepEqual(editor.retakeCandidatesForProject(legacyProject), []);
  assert.equal(editor.unresolvedRetakeCount(legacyProject), 0);
});

test('actual repeated lines and truncated restarted words retain retake evidence', function () {
  assert.equal(editor.repeatedLineEvidence(
    'Take those things away from some...',
    'Take those two things away from someone and watch what happens.'
  ), true);
  assert.equal(editor.repeatedLineEvidence(
    'Most manifesta-',
    'Most manifestation gurus and life coaches have no idea how the subconscious mind works.'
  ), true);
});

test('comparative parallelism cannot become blocking retake review', function () {
  const texts = ['In', 'life,', 'the', 'greater', 'the', 'number', 'of', 'participants', 'who', 'succeed,', 'and', 'the', 'greater', 'the', 'degree', 'to', 'which', 'they', 'succeed,', 'the', 'greater', 'the', 'potential', 'magnitude', 'of', 'success', 'available', 'to', 'everyone', 'else.'];
  const timed = texts.map(function (text, index) {
    return { index: index, text: text, start: index * 0.2, end: index * 0.2 + 0.15 };
  });
  const decisions = editor.normalizeRetakeDecisions([
    { removeStartIndex: 4, removeEndIndex: 4, replacementStartIndex: 11, replacementEndIndex: 14, confidence: 'review', reason: 'Mistook parallel wording for a restart.' },
    { removeStartIndex: 20, removeEndIndex: 21, replacementStartIndex: 22, replacementEndIndex: 25, confidence: 'review', reason: 'Mistook a comparative clause for a restart.' }
  ], timed);
  assert.deepEqual(decisions, []);
});

test('overlapping semantic retake removals cannot create conflicting review cards', function () {
  const texts = ['start', 'this', 'same', 'line', 'again', 'start', 'this', 'same', 'line', 'cleanly', 'start', 'this'];
  const timed = texts.map(function (text, index) { return { index: index, text: text, start: index, end: index + 0.4 }; });
  const decisions = editor.normalizeRetakeDecisions([
    { removeStartIndex: 0, removeEndIndex: 3, replacementStartIndex: 5, replacementEndIndex: 9, confidence: 'review', reason: 'Uncertain overlap listed first' },
    { removeStartIndex: 2, removeEndIndex: 4, replacementStartIndex: 7, replacementEndIndex: 9, confidence: 'high', reason: 'Clear failed take' },
    { removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 10, replacementEndIndex: 11, confidence: 'review', reason: 'Disjoint' }
  ], timed);
  assert.deepEqual(decisions.map(function (decision) { return decision.removeWordIndices; }), [[2, 3, 4], [0, 1]]);
});

test('unresolved retakes block approval until cut or explicitly dismissed', function () {
  const project = { words: words, removedWordIndices: [], dismissedRetakeIds: [], retakeDecisions: [{
    id: 'smart-retake-0', removeWordIndices: [2, 3], confidence: 'review',
    firstText: 'This same line starts here', replacementText: 'This same line starts here and finishes cleanly'
  }] };
  assert.equal(editor.unresolvedRetakeCount(project), 1);
  assert.equal(editor.appliedRetakeCount(project), 0);
  project.removedWordIndices = [2, 3];
  assert.equal(editor.unresolvedRetakeCount(project), 0);
  assert.equal(editor.appliedRetakeCount(project), 1);
  project.removedWordIndices = [];
  project.dismissedRetakeIds = ['smart-retake-0'];
  assert.equal(editor.unresolvedRetakeCount(project), 0);
  assert.equal(editor.appliedRetakeCount(project), 0);
});

test('retake retries respect restored takes and replace only automation-owned cuts', function () {
  const oldDecision = { id: 'smart-retake-0-0-1', confidence: 'high', removeWordIndices: [0, 1] };
  const nextDecision = { id: 'smart-retake-1-2-3', confidence: 'high', removeWordIndices: [2, 3] };
  const project = {
    removedWordIndices: [0, 1, 5],
    autoRetakeRemovedWordIndices: [0, 1],
    dismissedRetakeIds: [oldDecision.id]
  };
  editor.reconcileAutomaticRetakeCuts(project, [oldDecision, nextDecision]);
  assert.deepEqual(project.removedWordIndices, [2, 3, 5]);
  assert.deepEqual(project.autoRetakeRemovedWordIndices, [2, 3]);
  project.dismissedRetakeIds.push(nextDecision.id);
  editor.reconcileAutomaticRetakeCuts(project, [nextDecision]);
  assert.deepEqual(project.removedWordIndices, [5]);
  assert.deepEqual(project.autoRetakeRemovedWordIndices, []);
});

test('automatic retakes never claim a pre-existing manual cut', function () {
  const decision = { id: 'smart-retake-0-1-2', confidence: 'high', removeWordIndices: [1, 2] };
  const project = { removedWordIndices: [1], autoRetakeRemovedWordIndices: [], dismissedRetakeIds: [] };
  editor.reconcileAutomaticRetakeCuts(project, [decision]);
  assert.deepEqual(project.removedWordIndices, [1, 2]);
  assert.deepEqual(project.autoRetakeRemovedWordIndices, [2]);
  project.dismissedRetakeIds = [decision.id];
  editor.reconcileAutomaticRetakeCuts(project, [decision]);
  assert.deepEqual(project.removedWordIndices, [1]);
});

test('editor queue summaries omit transcript-scale payload while retaining action state', function () {
  const project = {
    id: 'summary-1', name: 'Take 1', width: 1920, height: 1080,
    words: [{ index: 0, text: 'Hello', start: 0, end: 0.4 }],
    transcriptText: 'Hello', removedWordIndices: [], autoRetakeRemovedWordIndices: [],
    dismissedRetakeIds: [], restoredAutoCutIds: [], retakeDecisions: [{
      id: 'smart-retake-0-0-0', confidence: 'review', removeWordIndices: [0],
      firstText: 'Hello again now', replacementText: 'Hello again now with the full line'
    }],
    cutDecisionHistory: [{ removedWordIndices: [] }], renderQuality: { status: 'passed' },
    visualClassification: { layout: 'horizontal', confidence: 'high' },
    planningMatch: { confidence: 'high' }, transcriptionStatus: 'ready', renderStatus: 'ready'
  };
  const summary = editor.projectListSummary(project);
  assert.equal(summary.id, project.id);
  assert.equal(summary.renderStatus, 'ready');
  assert.equal(summary.unresolvedRetakeCount, 1);
  assert.equal(summary.canUndoCut, true);
  assert.equal(summary.editStarted, true);
  ['words', 'transcriptText', 'removedWordIndices', 'retakeDecisions', 'cutDecisionHistory',
    'renderQuality', 'visualClassification', 'planningMatch'].forEach(function (key) {
    assert.equal(Object.prototype.hasOwnProperty.call(summary, key), false, key + ' should not be in a queue summary');
  });
  assert.equal(project.words.length, 1, 'summarizing must not mutate the durable project');
});

test('Editor work state ignores automation and recognizes review or manual decisions', function () {
  assert.equal(editor.editorWorkStarted({ editRevision: 2, removedWordIndices: [1], renderStatus: 'ready' }), false);
  assert.equal(editor.editorWorkStarted({ editRevision: 2, reviewStartedAt: '2026-10-12T12:00:00.000Z' }), true);
  assert.equal(editor.editorWorkStarted({ editRevision: 2, cutDecisionHistory: [{ removedWordIndices: [] }] }), true);
  assert.equal(editor.editorWorkStarted({ editRevision: 2, manualRevisions: [{ status: 'done' }] }), true);
  assert.equal(editor.editorWorkStarted({ editRevision: 3 }), true);
});

test('adjacent removed transcript words become one cut with 120ms speech handles', function () {
  const cuts = editor.calculateManualCuts(words, [2, 3], 9);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].reason, 'transcript_cut');
  assert.ok(Math.abs(cuts[0].start - 1.92) < 0.000001);
  assert.ok(Math.abs(cuts[0].end - 6.48) < 0.000001);
});

test('transcript handles never leave fragments of a selected word', function () {
  const closeWords = [
    { index: 0, text: 'keep', start: 0.5, end: 1.0 },
    { index: 1, text: 'remove', start: 1.02, end: 1.2 },
    { index: 2, text: 'keep', start: 1.22, end: 1.7 }
  ];
  assert.deepEqual(editor.calculateManualCuts(closeWords, [1], 2), [
    { start: 1.02, end: 1.2, reason: 'transcript_cut' }
  ]);
});

test('overlapping cuts merge and retained segments fill the rest', function () {
  const cuts = editor.mergeCuts([{ start: 1, end: 3 }, { start: 2.9, end: 4 }, { start: 7, end: 8 }], 10);
  assert.deepEqual(cuts.map(function (cut) { return [cut.start, cut.end]; }), [[1, 4], [7, 8]]);
  assert.deepEqual(editor.keepSegments(10, cuts), [{ start: 0, end: 1 }, { start: 4, end: 7 }, { start: 8, end: 10 }]);
  assert.equal(editor.mapSourceTimeToEdited(9, cuts), 5);
});

test('only genuine source jumps receive tiny audio boundary fades', function () {
  const segments = [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 6, end: 8 }, { start: 8, end: 10 }];
  assert.deepEqual(editor.segmentAudioFades(segments, 0, 10), { fadeIn: false, fadeOut: false });
  assert.deepEqual(editor.segmentAudioFades(segments, 1, 10), { fadeIn: false, fadeOut: true });
  assert.deepEqual(editor.segmentAudioFades(segments, 2, 10), { fadeIn: true, fadeOut: false });
  assert.deepEqual(editor.segmentAudioFades(segments, 3, 10), { fadeIn: false, fadeOut: false });
});

test('only visually confirmed page changes fade out and back from black', function () {
  assert.equal(editor.pageChangeFadeSeconds, 0.28);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8'), /PAGE_CHANGE_FADE_SECONDS = 0\.28;/);
  const cuts = [
    { id: 'page', start: 2, end: 6, reason: 'long_pause' },
    { id: 'hesitation', start: 8, end: 10, reason: 'long_pause' }
  ];
  assert.deepEqual(editor.pageChangeFadesForSegment({ type: 'source', start: 0, end: 2 }, cuts, ['page']), { fadeIn: false, fadeOut: true });
  assert.deepEqual(editor.pageChangeFadesForSegment({ type: 'source', start: 6, end: 8 }, cuts, ['page']), { fadeIn: true, fadeOut: false });
  assert.deepEqual(editor.pageChangeFadesForSegment({ type: 'source', start: 10, end: 12 }, cuts, ['page']), { fadeIn: false, fadeOut: false });
  assert.deepEqual(editor.pageChangeFadesForSegment({ type: 'insert', start: 0, end: 2 }, cuts, ['page']), { fadeIn: false, fadeOut: false });
});

test('merged cuts have separate page-turn identities and can suppress one without restoring footage', function () {
  const cuts = [
    { id: '', start: 8.94, end: 30.502, reason: 'combined' },
    { id: '', start: 110.4, end: 146.6, reason: 'combined' }
  ];
  const first = editor.pageChangeCutKey(cuts[0]);
  const second = editor.pageChangeCutKey(cuts[1]);
  assert.notEqual(first, second);
  assert.deepEqual(editor.confirmedPageChangeCutKeys({ pageChangeCutIds: [first] }, cuts), [first]);
  assert.ok(Math.abs(editor.cameraResetStarts(cuts, [first])[1] - 8.94) < 0.001);
  assert.deepEqual(editor.pageChangeFadesForSegment({ type: 'source', start: 30.502, end: 40 }, cuts, [first]), { fadeIn: true, fadeOut: false });
  assert.deepEqual(editor.pageChangeFadesForSegment({ type: 'source', start: 146.6, end: 150 }, cuts, [first]), { fadeIn: false, fadeOut: false });
  assert.deepEqual(editor.confirmedPageChangeCutKeys({ pageChangeCutIds: [first, second], suppressedPageChangeCutKeys: [first] }, cuts), [second]);
  assert.deepEqual(editor.confirmedPageChangeCutKeys({ pageChangeCutIds: [''], suppressedPageChangeCutKeys: [first] }, cuts), [second]);
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  assert.match(client, /editorPageChangeMenu/);
  assert.match(client, /suppressedPageChangeCutKeys/);
});

test('caption groups omit deleted words and carry raw and edited timing', function () {
  const project = { words: words, removedWordIndices: [2, 3] };
  const cuts = [{ start: 1.8, end: 4.95 }];
  const groups = editor.captionGroups(project, cuts);
  assert.deepEqual(groups.map(function (group) { return group.text; }), ['This works.', 'Keep going.']);
  assert.equal(groups[1].sourceStart, 6.6);
  assert.ok(Math.abs(groups[1].start - 3.45) < 0.0001);
  assert.deepEqual(groups[1].words.map(function (word) { return word.text; }), ['Keep', 'going.']);
});

test('ASS export uses bold yellow captions below centre', function () {
  const ass = editor.buildAss({ width: 1080, height: 1920 }, [{ start: 1, end: 2, text: 'A {real} caption' }]);
  assert.match(ass, /PrimaryColour.*\nStyle: Default,Arial,86,&H0063DFF4,&H0063DFF4,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2/);
  assert.match(ass, /,2,40,40,422,1/);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:02\.00.*A \\{real\\} caption/);
});

test('landscape captions stay compact, spaced and advance spoken-word emphasis', function () {
  const groups = [{ start: 1, end: 2, text: 'A wise move', words: [
    { text: 'A', start: 1, end: 1.2 }, { text: 'wise', start: 1.2, end: 1.6 }, { text: 'move', start: 1.6, end: 2 }
  ] }];
  const ass = editor.buildAss({ width: 1920, height: 1080 }, groups);
  assert.match(ass, /Style: Default,Arial,39,&H0063DFF4,&H0063DFF4,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2/);
  assert.match(ass, /,2,40,40,130,1/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 3);
  assert.match(ass, /\\fs42\\bord3}A\{\\r}\\h\\hwise\\h\\hmove/);
  assert.match(ass, /A\\h\\h\{\\fs42\\bord3}wise\{\\r}\\h\\hmove/);
  const longWords = Array.from({ length: 5 }, function (_, index) {
    return { text: 'extraordinarylong' + index, start: index * .2, end: index * .2 + .18 };
  });
  const fitted = editor.buildAss({ width: 1920, height: 1080 }, [{
    start: 0, end: 1, text: longWords.map(function (word) { return word.text; }).join(' '), words: longWords
  }]);
  assert.match(fitted, /\\fs25\\bord2/);
  assert.match(fitted, /\\fs27\\bord3/);
  assert.match(editor.buildAss({ width: 720, height: 404 }, groups), /Style: Default,Arial,18,/);
});

test('vertical captions show three-word windows with spoken-word emphasis', function () {
  const groups = [{ start: 1, end: 3, text: 'One word now then next phrase', words: [
    { text: 'One', start: 1, end: 1.2 }, { text: 'word', start: 1.25, end: 1.55 }, { text: 'now', start: 1.6, end: 1.9 },
    { text: 'then', start: 2, end: 2.2 }, { text: 'next', start: 2.25, end: 2.5 }, { text: 'phrase', start: 2.55, end: 3 }
  ] }];
  const ass = editor.buildAss({ width: 1080, height: 1920 }, groups);
  assert.match(ass, /Style: Default,Arial,86,.*&H0063DFF4/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 6);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:01\.25.*\{\\fs96\\bord4\}One\{\\r\} word now$/m);
  assert.match(ass, /Dialogue: 0,0:00:01\.25,0:00:01\.60.*One \{\\fs96\\bord4\}word\{\\r\} now$/m);
  assert.match(ass, /Dialogue: 0,0:00:01\.60,0:00:02\.00.*One word \{\\fs96\\bord4\}now\{\\r\}$/m);
  assert.match(ass, /Dialogue: 0,0:00:02\.00,0:00:02\.25.*\{\\fs96\\bord4\}then\{\\r\} next phrase$/m);
  assert.doesNotMatch(ass, /One word now then/);

  const fitted = editor.buildAss({ width: 1080, height: 1920 }, [{ start: 0, end: 1, text: 'extraordinary captions remain', words: [
    { text: 'extraordinary', start: 0, end: .3 }, { text: 'captions', start: .3, end: .6 }, { text: 'remain', start: .6, end: 1 }
  ] }]);
  assert.match(fitted, /\{\\fs59\\bord4\}extraordinary/);
  assert.match(fitted, /\{\\fs53\\bord3\}captions/);
});

test('Editor source preview keeps vertical three-word windows rather than one spoken word', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'editor.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(source, /Math\.floor\(spokenIndex \/ 3\) \* 3/);
  assert.match(source, /group\.words\.slice\(windowStart, windowStart \+ 3\)/);
  assert.match(source, /windowStart \+ index === spokenIndex \? 'active' : ''/);
  assert.match(source, /RealityCaptionMask\.maskCaption\(word\.text\)/);
  assert.match(styles, /\.editor-caption\.shortform\{white-space:normal\}/);
});

test('batch preprocessing serializes expensive transcription', { timeout: 15000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-queue-'));
  const input = path.join(dir, 'sample.mp4');
  const secondInput = path.join(dir, 'sample-two.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=550:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', secondInput]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  let activeTranscriptions = 0; let maxTranscriptions = 0; let transcriptionCalls = 0;
  const service = editor.setup({
    db: db, dataDir: dir,
    transcribeDetailed: async function () {
      transcriptionCalls++; activeTranscriptions++; maxTranscriptions = Math.max(maxTranscriptions, activeTranscriptions);
      await new Promise(function (resolve) { setTimeout(resolve, 600); });
      activeTranscriptions--;
      if (transcriptionCalls === 1) throw new Error('Synthetic transient transcription failure');
      return { text: '', words: [] };
    }
  });
  const app = express(); app.use('/api/editor', service.router);
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function upload(name) {
    const source = name === 'Second' ? secondInput : input;
    const form = new FormData(); form.append('name', name); form.append('video', new Blob([fs.readFileSync(source)], { type: 'video/mp4' }), name + '.mp4');
    const response = await fetch(base + '/api/editor', { method: 'POST', body: form }); assert.equal(response.status, 202); return response.json();
  }
  const first = await upload('First'); const second = await upload('Second');
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  const secondQueued = await (await fetch(base + '/api/editor/' + second.id)).json();
  assert.ok(secondQueued.transcriptionQueuePosition >= 2);
  assert.equal(secondQueued.classificationStatus, 'ready');
  for (let attempt = 0; attempt < 160 && (transcriptionCalls < 3 || activeTranscriptions); attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(transcriptionCalls, 3);
  assert.equal(maxTranscriptions, 1);
  assert.equal((await (await fetch(base + '/api/editor/' + first.id)).json()).transcriptionStatus, 'error');
  assert.equal((await (await fetch(base + '/api/editor/' + second.id)).json()).transcriptionStatus, 'error');
});

test('service restart automatically resumes an interrupted transcription', { timeout: 10000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-resume-'));
  const editorDir = path.join(dir, 'editor', 'recover-1'); fs.mkdirSync(editorDir, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', path.join(editorDir, 'source')]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('editorProjects', 'recover-1', JSON.stringify({
    id: 'recover-1', name: 'Interrupted take', fileName: 'recover.mp4', mimeType: 'video/mp4', sizeBytes: 1000,
    duration: 1, width: 320, height: 180, words: [], removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [],
    autoSilenceEnabled: true, silenceThresholdSeconds: 1, retainedPauseSeconds: .38, captionsEnabled: true,
    layoutOverride: 'auto', contentTypeOverride: 'auto', cropCenterX: .5, classificationStatus: 'unavailable',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', transcriptionStatus: 'running', renderStatus: '', createdAt: now, updatedAt: now
  }), now);
  let calls = 0;
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { calls++; return { text: '', words: [] }; } });
  for (let attempt = 0; attempt < 200; attempt++) {
    const stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'recover-1').data);
    if (stored.transcriptionStatus === 'error' && typeof stored.sourceSha256 === 'string' && stored.sourceSha256.length === 64) break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  const recovered = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'recover-1').data);
  assert.equal(calls, 1);
  assert.equal(recovered.sourceSha256.length, 64);
  assert.equal(recovered.transcriptionStatus, 'error');
  assert.equal(recovered.transcriptionError, 'No timed speech was detected in this recording.');
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('restart resumes a safe render whose kickoff died before FFmpeg queued', { timeout: 60000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-render-kickoff-'));
  const projectDir = path.join(dir, 'editor', 'kickoff-1'); fs.mkdirSync(projectDir, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', path.join(projectDir, 'source')]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', 'kickoff-1', JSON.stringify({
    id: 'kickoff-1', name: 'Interrupted kickoff', fileName: 'take.mp4', duration: 1, width: 320, height: 180,
    words: [{ index: 0, text: 'Hello.', start: 0.2, end: 0.8 }], removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [],
    autoSilenceEnabled: true, silenceThresholdSeconds: 1, retainedPauseSeconds: 0.38, captionsEnabled: false,
    layoutOverride: 'horizontal', cropCenterX: 0.5, transcriptionStatus: 'ready', classificationStatus: 'unavailable',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', renderStatus: 'queued',
    automaticRenderStartedAt: '', createdAt: now, updatedAt: now
  }), now);
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  let stored;
  for (let attempt = 0; attempt < 1600; attempt++) {
    stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'kickoff-1').data);
    if (stored.renderStatus === 'ready' || stored.renderStatus === 'error') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(stored.renderStatus, 'ready', stored.renderError);
  assert.equal(stored.renderQuality.status, 'passed');
  assert.equal(stored.renderVersion, 27);
  assert.equal(fs.existsSync(path.join(projectDir, 'render.mp4')), true);
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('restart cancels only a legacy automatic first render', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-cancel-auto-render-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', 'legacy-auto-1', JSON.stringify({
    id: 'legacy-auto-1', name: 'Fresh automatic render', fileName: 'take.mp4', duration: 10, width: 1920, height: 1080,
    words: [{ index: 0, text: 'Hello.', start: 0.2, end: 0.8 }], removedWordIndices: [], dismissedRetakeIds: [],
    restoredAutoCutIds: [], autoSilenceEnabled: true, transcriptionStatus: 'ready', classificationStatus: 'ready',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', renderStatus: 'running', renderProgress: 42,
    automaticRenderStartedAt: now, renderSha256: '', lastRenderAt: '', renderDirty: false, createdAt: now, updatedAt: now
  }), now);
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  const project = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'legacy-auto-1').data);
  assert.equal(project.renderStatus, '');
  assert.equal(project.renderProgress, 0);
  assert.equal(project.automaticRenderStartedAt, '');
  assert.equal(project.renderDirty, false);
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('final render splices an inserted clip and its caption timeline between source words', { timeout: 45000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-insert-render-'));
  const projectDir = path.join(dir, 'editor', 'insert-render-1'); fs.mkdirSync(projectDir, { recursive: true });
  const mediaArgs = function (color, frequency, volume, output) { return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=320x180:d=1:r=30000/1001', '-f', 'lavfi', '-i', 'sine=frequency=' + frequency + ':duration=1', '-filter:a', 'volume=' + volume, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', output]; };
  execFileSync('ffmpeg', mediaArgs('red', 440, 0.5, path.join(projectDir, 'source')));
  execFileSync('ffmpeg', mediaArgs('blue', 660, 0.05, path.join(projectDir, 'inserted-clip-clip-1.mp4')));
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', 'insert-render-1', JSON.stringify({
    id: 'insert-render-1', name: 'Insert render', fileName: 'take.mp4', duration: 1, width: 320, height: 180,
    words: [{ index: 0, text: 'Before', start: 0.1, end: 0.5 }, { index: 1, text: 'after.', start: 0.55, end: 0.9 }],
    insertedClips: [{ id: 'clip-1', directiveId: 'directive-1', status: 'ready', duration: 1, afterWordIndex: 0, afterSourceTime: 0.5, words: [{ index: 0, text: 'External.', start: 0.1, end: 0.8 }] }],
    clipInsertStatus: 'ready', removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [], autoSilenceEnabled: false,
    silenceThresholdSeconds: 1, retainedPauseSeconds: 0.38, captionsEnabled: true, openingPushInEnabled: true,
    layoutOverride: 'horizontal', cropCenterX: 0.5, transcriptionStatus: 'ready', classificationStatus: 'unavailable',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', renderStatus: 'queued', automaticRenderStartedAt: '', createdAt: now, updatedAt: now
  }), now);
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  let stored;
  for (let attempt = 0; attempt < 1200; attempt++) {
    stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'insert-render-1').data);
    if (stored.renderStatus === 'ready' || stored.renderStatus === 'error') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(stored.renderStatus, 'ready', stored.renderError);
  assert.ok(stored.editedDuration > 3.6 && stored.editedDuration < 3.8);
  assert.equal(stored.renderVersion, 27);
  assert.equal(stored.renderQuality.contentDuration, 2);
  assert.equal(stored.renderQuality.outroSeconds, 1.7);
  assert.equal(stored.renderQuality.visualFadeSeconds, 1.7);
  assert.equal(stored.renderQuality.musicTailSeconds, 0);
  assert.ok(stored.renderQuality.insertedClipLoudness.clips[0].gainDb > 18);
  assert.ok(stored.renderQuality.insertedClipLoudness.clips[0].gainDb < 22);
  const rendered = path.join(projectDir, 'render.mp4');
  const renderedStreams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration',
    '-of', 'json', rendered], { encoding: 'utf8' })).streams;
  const renderedVideo = renderedStreams.find(function (stream) { return stream.codec_type === 'video'; });
  assert.ok(Number(renderedVideo.duration) > 3.6, 'the visual stream itself includes the complete outro: ' + renderedVideo.duration);
  function rangeLufs(start, duration) {
    const measured = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(start), '-t', String(duration), '-i', rendered,
      '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(measured.status, 0, measured.stderr);
    return editor.parseIntegratedLoudness(measured.stderr);
  }
  assert.ok(Math.abs(rangeLufs(0.05, 0.4) - rangeLufs(0.55, 0.9)) < 1);
  function frameRgb(at) {
    const frame = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', rendered,
      '-frames:v', '1', '-vf', "select='gte(t," + at + ")',scale=1:1", '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    return Array.from(frame.subarray(0, 3));
  }
  const beforeOutro = frameRgb(1.75);
  const nearEnd = frameRgb(3.65);
  assert.ok(beforeOutro.reduce(function (sum, channel) { return sum + channel; }, 0) >
    nearEnd.reduce(function (sum, channel) { return sum + channel; }, 0) + 80,
  'the last content frame remains visibly brighter before the outro: ' + JSON.stringify({ beforeOutro: beforeOutro, nearEnd: nearEnd }));
  assert.ok(nearEnd.every(function (channel) { return channel < 30; }),
    'the held final frame fades fully to black: ' + JSON.stringify(nearEnd));
  assert.match(fs.readFileSync(path.join(projectDir, 'captions.ass'), 'utf8'), /External/);
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('final render blinks through black across a visually confirmed page change', { timeout: 45000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-page-blink-'));
  const projectDir = path.join(dir, 'editor', 'page-blink-1'); fs.mkdirSync(projectDir, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=1.1:r=30000/1001',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=3.8:r=30000/1001',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1.1:r=30000/1001',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', path.join(projectDir, 'source')]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', 'page-blink-1', JSON.stringify({
    id: 'page-blink-1', name: 'Page blink', fileName: 'take.mp4', duration: 6, width: 320, height: 180,
    words: [{ index: 0, text: 'First.', start: 0.2, end: 0.8 }, { index: 1, text: 'Second.', start: 5.2, end: 5.8 }],
    removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [], autoSilenceEnabled: true,
    silenceThresholdSeconds: 1, retainedPauseSeconds: 0.38, captionsEnabled: false, openingPushInEnabled: false,
    layoutOverride: 'horizontal', transcriptionStatus: 'ready', classificationStatus: 'unavailable',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', renderStatus: 'queued',
    automaticRenderStartedAt: '', createdAt: now, updatedAt: now
  }), now);
  const service = editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  let stored;
  for (let attempt = 0; attempt < 1200; attempt++) {
    stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'page-blink-1').data);
    if (stored.renderStatus === 'ready' || stored.renderStatus === 'error') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(stored.renderStatus, 'ready', stored.renderError);
  assert.deepEqual(stored.pageChangeCutIds, ['gap-0']);
  const rendered = path.join(projectDir, 'render.mp4');
  function frameBrightness(at) {
    const frame = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', rendered,
      '-frames:v', '1', '-vf', "select='gte(t," + at + ")',scale=1:1", '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    return Array.from(frame.subarray(0, 3)).reduce(function (sum, channel) { return sum + channel; }, 0);
  }
  const whitePage = frameBrightness(0.65);
  const fadeOut = frameBrightness(0.84);
  const fadeIn = frameBrightness(0.90);
  const bluePage = frameBrightness(1.15);
  assert.ok(fadeOut < whitePage * 0.35, JSON.stringify({ whitePage: whitePage, fadeOut: fadeOut }));
  assert.ok(fadeIn < bluePage * 0.45, JSON.stringify({ bluePage: bluePage, fadeIn: fadeIn }));
  const app = express(); app.use(express.json()); app.use('/api/editor', service.router);
  const server = app.listen(0); t.after(function () { server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/api/editor/page-blink-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suppressedPageChangeCutKeys: ['gap-0'], expectedEditRevision: stored.editRevision || 0 }) });
  assert.equal(response.status, 200);
  const suppressed = await response.json();
  assert.deepEqual(suppressed.pageChangeCutIds, []);
  assert.deepEqual(suppressed.suppressedPageChangeCutKeys, ['gap-0']);
  assert.deepEqual(suppressed.cuts, editor.cutsForProject(stored), 'suppressing the effect must retain the same cut');
  assert.equal(suppressed.renderDirty, true);
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('approved editor projects stay immutable during restart maintenance', { timeout: 10000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-approved-'));
  const editorDir = path.join(dir, 'editor', 'approved-1'); fs.mkdirSync(editorDir, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', path.join(editorDir, 'source')]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  const approved = {
    id: 'approved-1', name: 'Approved take', productionPieceId: 'production-1', duration: 1, width: 180, height: 320,
    words: [{ index: 0, text: 'Approved.', start: .2, end: .8 }], removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [],
    transcriptionStatus: 'ready', classificationStatus: 'pending', retakeAnalysisStatus: 'running', planningMatchStatus: 'pending',
    renderStatus: 'ready', createdAt: now, updatedAt: now
  };
  db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('editorProjects', approved.id, JSON.stringify(approved), now);
  editor.setup({
    db: db, dataDir: dir,
    transcribeDetailed: async function () { throw new Error('approved transcript must not restart'); },
    analyzeRetakes: async function () { throw new Error('approved retake analysis must not restart'); },
    matchPlanningPiece: async function () { throw new Error('approved matching must not restart'); }
  });
  await new Promise(function (resolve) { setTimeout(resolve, 250); });
  const stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', approved.id).data);
  assert.equal(stored.width, 180);
  assert.equal(stored.height, 320);
  assert.equal(stored.classificationStatus, 'pending');
  assert.equal(stored.retakeAnalysisStatus, 'running');
  assert.equal(stored.planningMatchStatus, 'pending');
  assert.equal(stored.renderStatus, 'ready');
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('startup invalidates a corrupt active final before it can be reviewed', { timeout: 10000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-corrupt-final-'));
  const projectDir = path.join(dir, 'editor', 'corrupt-final-1'); fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'render.mp4'), 'truncated final');
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', 'corrupt-final-1', JSON.stringify({
    id: 'corrupt-final-1', name: 'Corrupt final', duration: 10, width: 1920, height: 1080,
    words: [{ index: 0, text: 'Hello.', start: 1, end: 2 }], removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [],
    transcriptionStatus: 'ready', classificationStatus: 'ready', retakeAnalysisStatus: 'error', planningMatchStatus: 'ready',
    renderStatus: 'ready', renderDirty: true, renderSizeBytes: 9999, renderSha256: 'a'.repeat(64), renderQuality: { status: 'passed' },
    renderVersion: 9, openingPushInEnabled: true, automaticRenderStartedAt: 'old-render', createdAt: now, updatedAt: now
  }), now);
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  let stored;
  for (let attempt = 0; attempt < 100; attempt++) {
    stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'corrupt-final-1').data);
    if (stored.renderStatus !== 'ready') break;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  assert.equal(stored.renderStatus, '');
  assert.equal(stored.renderSha256, '');
  assert.equal(stored.renderSizeBytes, 0);
  assert.equal(fs.existsSync(path.join(projectDir, 'render.mp4')), false);
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('one recovery endpoint retries failed preprocessing without starting a final render', { timeout: 30000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-retry-'));
  const projectDir = path.join(dir, 'editor', 'retry-1'); fs.mkdirSync(projectDir, { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', path.join(projectDir, 'source')]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('editorProjects', 'retry-1', JSON.stringify({
    id: 'retry-1', name: 'Failed take', fileName: 'failed.mp4', mimeType: 'video/mp4', sizeBytes: 1000,
    duration: 1, width: 320, height: 180, words: [], removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [],
    autoSilenceEnabled: true, silenceThresholdSeconds: 1, retainedPauseSeconds: .38, captionsEnabled: true,
    layoutOverride: 'auto', contentTypeOverride: 'auto', cropCenterX: .5, classificationStatus: 'unavailable',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', transcriptionStatus: 'error', transcriptionError: 'Synthetic failure', renderStatus: '', createdAt: now, updatedAt: now
  }), now);
  const service = editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: 'Recovered.', words: [{ type: 'word', text: 'Recovered.', start: .2, end: .8 }] }; } });
  const app = express(); app.use(express.json()); app.use('/api/editor', service.router);
  const server = http.createServer(app); await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let response = await fetch(base + '/api/editor/retry-1/retry-failed', { method: 'POST' });
  assert.equal(response.status, 202); assert.deepEqual((await response.json()).retried, ['transcription']);
  let project;
  for (let attempt = 0; attempt < 650; attempt++) {
    project = await (await fetch(base + '/api/editor/retry-1')).json();
    if (project.transcriptionStatus === 'ready') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(project.transcriptionStatus, 'ready'); assert.equal(project.transcriptText, 'Recovered.');
  assert.equal(project.renderStatus, '', 'a recovered upload waits for one explicit preview rebuild');
  response = await fetch(base + '/api/editor/retry-1/retry-failed', { method: 'POST' });
  assert.equal(response.status, 409);
});

test('legacy ready recordings acquire missing analysis phases on startup', { timeout: 10000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-legacy-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('editorProjects', 'legacy-1', JSON.stringify({
    id: 'legacy-1', name: 'Legacy take', duration: 5, width: 1920, height: 1080,
    transcriptText: 'An existing transcript.', words: [{ index: 0, text: 'Existing.', start: .2, end: .8 }],
    removedWordIndices: [], dismissedRetakeIds: [], restoredAutoCutIds: [], autoSilenceEnabled: true,
    transcriptionStatus: 'ready', classificationStatus: 'ready', retakeAnalysisStatus: 'error',
    automaticRenderStartedAt: 'test-hold', createdAt: now, updatedAt: now
  }), now);
  let planningCalls = 0;
  editor.setup({
    db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; },
    getPlanningCandidates: function () { return []; },
    matchPlanningPiece: async function () { planningCalls++; return { pieceId: '', confidence: 'none', reason: 'No match.', workingTitle: 'Existing Transcript Explained' }; }
  });
  let project;
  for (let attempt = 0; attempt < 100; attempt++) {
    project = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'legacy-1').data);
    if (project.planningMatchStatus === 'ready') break;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  assert.equal(project.planningMatchStatus, 'ready');
  assert.equal(planningCalls, 1, 'a transcript still needs a meaningful title when no planning cards exist');
  assert.equal(project.name, 'Existing Transcript Explained');
  assert.equal(project.workingTitle, 'Existing Transcript Explained');
  assert.equal(project.nameSource, 'transcript');
  assert.equal(project.renderProgress, 0);
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('startup stops old retake renders and preserves only manual transcript cuts', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-manual-cut-migration-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', 'old-retake-render', JSON.stringify({
    id: 'old-retake-render', name: 'Old automatic retake render', fileName: 'source.mp4', duration: 20,
    width: 1920, height: 1080, words: [
      { index: 0, text: 'old', start: 0, end: 0.3 }, { index: 1, text: 'take', start: 0.3, end: 0.6 },
      { index: 2, text: 'clean', start: 1, end: 1.3 }, { index: 3, text: 'take', start: 1.3, end: 1.6 },
      { index: 4, text: 'manual', start: 2, end: 2.4 }
    ],
    removedWordIndices: [0, 1, 4], autoRetakeRemovedWordIndices: [0, 1], dismissedRetakeIds: [],
    restoredAutoCutIds: [], autoSilenceEnabled: true, transcriptionStatus: 'ready', classificationStatus: 'ready',
    visualClassification: { layout: 'horizontal' }, retakeAnalysisStatus: 'ready', planningMatchStatus: 'unavailable',
    automaticRenderStartedAt: now, renderStatus: 'running', renderProgress: 47, createdAt: now, updatedAt: now
  }), now);
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  const project = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'old-retake-render').data);
  assert.deepEqual(project.removedWordIndices, [4]);
  assert.deepEqual(project.autoRetakeRemovedWordIndices, []);
  assert.equal(project.retakeAnalysisStatus, 'unavailable');
  assert.equal(project.retakeWorkflowVersion, 3);
  assert.equal(project.renderStatus, '');
  assert.equal(project.renderDirty, true);
  assert.equal(project.renderProgress, 47);
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('an HEVC camera master receives a real browser-safe review proxy', { timeout: 30000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-hevc-'));
  const id = 'hevc-1';
  const projectDir = path.join(dir, 'editor', id);
  fs.mkdirSync(projectDir, { recursive: true });
  const source = path.join(projectDir, 'source');
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', source]);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    t.skip('This FFmpeg build has no HEVC encoder.');
    return;
  }
  fs.writeFileSync(path.join(projectDir, 'preview.mp4'), 'corrupt derived file');
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records VALUES (?, ?, ?, ?)').run('editorProjects', id, JSON.stringify({
    id: id, name: 'HEVC take', fileName: 'camera.MOV', mimeType: 'video/quicktime', duration: 1,
    width: 320, height: 180, videoCodec: 'hevc', audioCodec: 'aac', browserPreviewRequired: true,
    browserPreviewStatus: 'ready', browserPreviewError: '', transcriptionStatus: 'ready',
    classificationStatus: 'unavailable', retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable',
    automaticRenderStartedAt: 'held-for-test', renderStatus: '', renderProgress: 0, words: [],
    removedWordIndices: [], createdAt: now, updatedAt: now
  }), now);
  editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  let stored;
  for (let attempt = 0; attempt < 300; attempt++) {
    stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', id).data);
    let repairedSize = 0;
    try { repairedSize = fs.statSync(path.join(projectDir, 'preview.mp4')).size; } catch (error) {}
    if ((stored.browserPreviewStatus === 'ready' && repairedSize > 1024) || stored.browserPreviewStatus === 'error') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(stored.browserPreviewStatus, 'ready', stored.browserPreviewError);
  assert.equal(stored.browserPreviewVersion, 3);
  const proxy = path.join(projectDir, 'preview.mp4');
  assert.ok(fs.statSync(proxy).size > 1024);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate', '-of', 'json', proxy], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].codec_name, 'h264');
  assert.ok(Math.max(probe.streams[0].width, probe.streams[0].height) <= 720);
  assert.equal(probe.streams[0].r_frame_rate, '24/1');
  const keyframes = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-skip_frame', 'nokey', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'json', proxy], { encoding: 'utf8' })).frames;
  assert.ok(keyframes.length >= 2);
  assert.ok(Number(keyframes[1].pts_time) - Number(keyframes[0].pts_time) <= 0.51);
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('an aborted multipart upload removes its partial file immediately', { timeout: 10000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-abort-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const service = editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  const app = express(); app.use('/api/editor', service.router);
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const boundary = '----rm-editor-abort';
  const header = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="video"; filename="abort.mp4"\r\nContent-Type: video/mp4\r\n\r\n');
  const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/editor', method: 'POST', headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': header.length + 2 * 1024 * 1024
  }});
  request.on('error', function () {});
  request.write(header);
  request.write(Buffer.alloc(512 * 1024));
  const tempDir = path.join(dir, 'tmp');
  for (let attempt = 0; attempt < 100 && fs.readdirSync(tempDir).length === 0; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  assert.equal(fs.readdirSync(tempDir).length, 1);
  request.destroy();
  for (let attempt = 0; attempt < 100 && fs.readdirSync(tempDir).length > 0; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
  }
  assert.deepEqual(fs.readdirSync(tempDir), []);
});

test('manual Editor revisions remain locked until their linked Project Manager task completes', async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-manual-revision-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO records (store_name,id,data,updated_at) VALUES (?,?,?,?)').run('editorProjects', 'manual-1', JSON.stringify({
    id: 'manual-1', name: 'Manual test', fileName: 'test.mp4', duration: 20, width: 1920, height: 1080,
    transcriptionStatus: 'ready', transcriptText: 'This is the exact test recording.', words: [],
    classificationStatus: 'ready', visualClassification: { layout: 'horizontal' }, layoutOverride: 'horizontal',
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', renderStatus: '', insertedClips: [],
    manualRevisions: [], createdAt: now, updatedAt: now
  }), now);
  let queuedInput = null;
  const service = editor.setup({
    db: db, dataDir: dir,
    transcribeDetailed: async function () { return { text: '', words: [] }; },
    queueManualRevision: function (input) { queuedInput = input; return 'voice-manual-1'; }
  });
  const app = express(); app.use(express.json()); app.use('/api/editor', service.router);
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let response = await fetch(base + '/api/editor/manual-1/manual-revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: 'Keep the close zoom at 14 seconds.' })
  });
  assert.equal(response.status, 202);
  let project = await response.json();
  assert.equal(project.manualRevisions[0].status, 'queued');
  assert.equal(project.manualRevisions[0].voiceMessageId, 'voice-manual-1');
  assert.equal(queuedInput.project.id, 'manual-1');
  assert.equal(queuedInput.revision.request, 'Keep the close zoom at 14 seconds.');
  response = await fetch(base + '/api/editor/manual-1/manual-revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'A second request.' })
  });
  assert.equal(response.status, 409);
  service.markManualRevisionRunningByVoiceMessage('voice-manual-1');
  project = await (await fetch(base + '/api/editor/manual-1')).json();
  assert.equal(project.manualRevisions[0].status, 'running');
  service.finishManualRevisionByVoiceMessage('voice-manual-1', { status: 'done', summary: 'Kept the close framing and verified the preview.' });
  project = await (await fetch(base + '/api/editor/manual-1')).json();
  assert.equal(project.manualRevisions[0].status, 'done');
  assert.equal(project.manualRevisions[0].summary, 'Kept the close framing and verified the preview.');
  response = await fetch(base + '/api/editor/manual-1/manual-revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'A follow-up request.' })
  });
  assert.equal(response.status, 202);
});

test('chunked Editor upload crosses proxy-sized files with accurate idempotent assembly', { timeout: 20000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-chunks-'));
  const source = path.join(dir, 'large-camera.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1:r=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  fs.appendFileSync(source, Buffer.alloc(17 * 1024 * 1024));
  const bytes = fs.readFileSync(source);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const service = editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; } });
  const app = express(); app.use(express.json()); app.use('/api/editor', service.router);
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let response = await fetch(base + '/api/editor/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    fileName: 'CAMERA_LARGE.MP4', mimeType: 'video/mp4', sizeBytes: bytes.length, name: 'Large camera take'
  }) });
  assert.equal(response.status, 201);
  const session = await response.json();
  assert.equal(session.chunkSize, 16 * 1024 * 1024);
  const first = bytes.subarray(0, session.chunkSize);
  const second = bytes.subarray(session.chunkSize);
  response = await fetch(base + '/api/editor/uploads/' + session.id + '/chunks/0', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': '0' }, body: first });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).receivedBytes, first.length);
  response = await fetch(base + '/api/editor/uploads/' + session.id + '/chunks/0', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': '0' }, body: first });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
  response = await fetch(base + '/api/editor/uploads/' + session.id + '/chunks/1', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(first.length) }, body: second });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).receivedBytes, bytes.length);
  response = await fetch(base + '/api/editor/uploads/' + session.id + '/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 202);
  const project = await response.json();
  assert.equal(project.sizeBytes, bytes.length);
  assert.equal(project.name, 'Large camera take');
  assert.equal(fs.statSync(path.join(dir, 'editor', project.id, 'source')).size, bytes.length);
  assert.equal(project.sourceSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  let settled = project;
  for (let attempt = 0; attempt < 200; attempt++) {
    settled = await (await fetch(base + '/api/editor/' + project.id)).json();
    if (settled.transcriptionStatus === 'error' && ['ready', 'error'].includes(settled.browserPreviewStatus)) break;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  assert.equal(settled.transcriptionStatus, 'error');
  assert.equal(['ready', 'error'].includes(settled.browserPreviewStatus), true);
});

test('upload, timed transcription and FFmpeg captioned render work end to end', { timeout: 60000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-'));
  const encodedInput = path.join(dir, 'sample-landscape.mp4');
  const input = path.join(dir, 'sample.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=5:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', encodedInput]);
  // Camera-style portrait: landscape-coded pixels plus a 90-degree display
  // matrix. Upload, browser proxy, and final render must all normalize it.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', encodedInput, '-map', '0', '-c', 'copy', input]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  let handoffCalls = 0;
  let retakeCalls = 0;
  let planningMatchCalls = 0;
  let renderReadyCalls = 0;
  let renderInvalidatedCalls = 0;
  let audioPreviewCalls = 0;
  let downstreamProductionExists = false;
  let expectedPlanningPieceId = 'plan-1';
  const planningChanges = [];
  const deletedProjects = [];
  const createdProjects = [];
  const metadataProjects = [];
  const service = editor.setup({
    db: db,
    dataDir: dir,
    transcribeDetailed: async function () {
      return { text: 'One two. One two.', words: [
        { type: 'word', text: 'One', start: 0.5, end: 0.9 }, { type: 'word', text: 'two.', start: 0.95, end: 1.3 },
        { type: 'word', text: 'One', start: 3.2, end: 3.7 }, { type: 'word', text: 'two.', start: 3.75, end: 4.2 }
      ] };
    },
    analyzeRetakes: async function () {
      retakeCalls++;
      if (retakeCalls === 1) throw new Error('synthetic transient classifier failure');
      return { decisions: [{ removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 2, replacementEndIndex: 3, confidence: 'high', reason: 'Synthetic replaced take.' }] };
    },
    getPlanningCandidates: function () { return [{ id: 'plan-1', seq: 79, title: 'Synthetic outline', stage: 'uploaded', notesSnippet: 'One two.' }, { id: 'plan-2', seq: 80, title: 'Corrected outline', stage: 'uploaded', notesSnippet: 'One two.' }]; },
    matchPlanningPiece: async function () { planningMatchCalls++; return { pieceId: 'plan-1', confidence: 'high', reason: 'The transcript matches the uploaded outline.', workingTitle: 'Synthetic Outline' }; },
    onProjectCreated: function (input) { createdProjects.push(input.project); },
    onProjectMetadataChanged: function (input) { metadataProjects.push(input.project); },
    onRenderReady: function (input) {
      renderReadyCalls++;
      assert.equal(input.project.planningPieceId, expectedPlanningPieceId);
      if (renderReadyCalls === 1) throw new Error('Synthetic first workflow failure.');
    },
    onRenderInvalidated: function () { renderInvalidatedCalls++; },
    onPlanningPieceChanged: function (input) {
      planningChanges.push({ previous: input.previousPlanningPieceId, next: input.project.planningPieceId, renderWillChange: input.renderWillChange });
    },
    onProjectDeleted: function (input) { deletedProjects.push(input.project); },
    getAudioTracks: function () { return [{ id: 'track-1', name: 'Test ambience', note: 'Quiet test bed' }]; },
    getAudioTrackPath: function (id) { return id === 'track-1' ? input : ''; },
    getAudioMixSettings: function () { return { audioMixMode: 'loudness', musicBelowDialogueDb: 20 }; },
    buildAudioPreview: async function (videoPath, audioPath, outPath, settings, outputOptions) {
      audioPreviewCalls++;
      assert.equal(fs.existsSync(videoPath), true);
      assert.equal(audioPath, input);
      assert.equal(settings.musicBelowDialogueDb, 20);
      assert.equal(outputOptions.bitrate, '192k');
      await new Promise(function (resolve) { setTimeout(resolve, 40); });
      fs.writeFileSync(outPath, Buffer.alloc(2048, 7));
    },
    handoffToProduction: async function (input) {
      handoffCalls++;
      const alreadySent = downstreamProductionExists;
      downstreamProductionExists = true;
      assert.equal(input.project.id.length > 0, true);
      assert.equal(input.project.words[0].text, 'Once');
      assert.equal(input.project.words[0].originalText, 'One');
      assert.equal(input.project.audioTrackId, 'track-1');
      assert.equal(input.project.audioMixSettings.musicBelowDialogueDb, 20);
      assert.equal(fs.existsSync(input.renderPath), true);
      await new Promise(function (resolve) { setTimeout(resolve, 80); });
      return {
        pieceId: input.project.id,
        piece: { id: input.project.id, stage: 'in_production', hasVideo: true },
        planningPiece: { id: 'plan-2', stage: 'uploaded' },
        alreadySent: alreadySent,
        workflowWarning: 'Synthetic planning-stage warning.'
      };
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/editor', service.router);
  const server = http.createServer(app);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const form = new FormData();
  form.append('name', 'Synthetic take');
  form.append('video', new Blob([fs.readFileSync(input)], { type: 'application/octet-stream' }), 'CAMERA_9259.MOV');
  let response = await fetch(base + '/api/editor', { method: 'POST', body: form });
  assert.equal(response.status, 202);
  let project = await response.json();
  assert.equal(createdProjects.length, 1);
  assert.equal(createdProjects[0].id, project.id);
  assert.equal(project.audioTrackId, '__none__');
  assert.equal(project.mimeType, 'video/quicktime');
  assert.equal(project.videoCodec, 'h264');
  assert.equal(project.browserPreviewRequired, true);
  assert.equal(project.sourceRotation, 90);
  response = await fetch(base + '/api/editor/' + project.id + '/source');
  assert.equal(response.status, 425);
  const duplicateForm = new FormData();
  duplicateForm.append('name', 'Synthetic take');
  duplicateForm.append('video', new Blob([fs.readFileSync(input)], { type: 'application/octet-stream' }), 'CAMERA_9259.MOV');
  response = await fetch(base + '/api/editor', { method: 'POST', body: duplicateForm });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).existingProjectId, project.id);
  for (let attempt = 0; attempt < 200 && project.browserPreviewStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.browserPreviewStatus, 'ready', project.browserPreviewError);
  response = await fetch(base + '/api/editor/' + project.id + '/source');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  response = await fetch(base + '/api/editor/' + project.id + '/source', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(response.status, 206);
  assert.match(response.headers.get('content-range') || '', /^bytes 0-1023\//);
  for (let attempt = 0; attempt < 100 && project.transcriptionStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.transcriptionStatus, 'ready');
  for (let attempt = 0; attempt < 100 && project.classificationStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.classificationStatus, 'ready', project.classificationError);
  assert.equal(project.effectiveLayout, 'vertical');
  assert.equal(project.cropCenterX, 0.5);
  for (let attempt = 0; attempt < 100 && project.retakeAnalysisStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.retakeAnalysisStatus, 'ready', project.retakeAnalysisError);
  assert.equal(retakeCalls, 2, 'the non-destructive highlight scan retries once after a transient failure');
  assert.deepEqual(project.removedWordIndices, []);
  assert.deepEqual(project.retakeHighlights.map(function (candidate) { return candidate.removeWordIndices; }), [[0, 1]]);
  for (let attempt = 0; attempt < 100 && project.planningMatchStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.planningMatchStatus, 'ready', project.planningMatchError);
  assert.equal(project.planningPieceId, 'plan-1');
  assert.equal(project.planningPieceTitle, 'Synthetic outline');
  assert.equal(project.planningPieceSeq, 79);
  assert.equal(project.name, 'Synthetic Outline');
  assert.equal(project.workingTitle, 'Synthetic Outline');
  assert.equal(project.nameSource, 'planning_transcript');
  assert.equal(planningMatchCalls, 1);
  assert.ok(metadataProjects.some(function (item) { return item.id === project.id && item.workingTitle === 'Synthetic Outline'; }));
  assert.ok(project.cuts.some(function (cut) { return cut.reason === 'long_pause' || cut.reason === 'combined'; }));
  assert.deepEqual(project.captionGroups.map(function (group) { return group.text; }), ['One two.', 'One two.']);
  assert.equal(project.renderStatus, '', 'fresh uploads remain editable before the explicit decision-preview build');
  response = await fetch(base + '/api/editor/' + project.id + '/render', { method: 'POST' });
  assert.equal(response.status, 202);
  for (let attempt = 0; attempt < 600 && (project.renderStatus !== 'error' && (project.renderStatus !== 'ready' || renderReadyCalls < 1 || !project.workflowWarning)); attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.renderStatus, 'ready', project.renderError);
  assert.equal(project.renderProgress, 100);
  assert.equal(project.renderPreviewStatus, 'not_required', project.renderPreviewError);
  assert.equal(project.renderPreviewVersion, 0);
  assert.equal(fs.existsSync(path.join(dir, 'editor', project.id, 'render-preview.mp4')), false);
  assert.equal(renderReadyCalls, 1);
  assert.equal(project.workflowWarning, 'Synthetic first workflow failure.');
  assert.equal(project.renderQuality.status, 'passed');
  assert.deepEqual(project.renderQuality.checks, { playableFile: true, correctFrame: true, standardPixelFormat: true, audioPresent: true, audibleAudio: true, durationMatches: true, visualDurationMatches: true });
  assert.ok(Math.abs(project.renderQuality.videoDuration - project.editedDuration) < 0.15,
    '24 fps source keeps visual frames through the full edited duration');
  assert.ok(project.renderQuality.audioPeakDb > -55);
  assert.deepEqual([project.renderQuality.width, project.renderQuality.height], [404, 720]);
  assert.equal(project.renderQuality.pixelFormat, 'yuv420p');
  const idempotentMutation = {
    contentTypeOverride: 'short', expectedEditRevision: project.editRevision, mutationId: 'mutation-idempotency-0001'
  };
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(idempotentMutation) });
  assert.equal(response.status, 200);
  const firstMutation = await response.json();
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(idempotentMutation) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.editRevision, firstMutation.editRevision);
  assert.equal(project.contentTypeOverride, 'short');
  assert.equal(Object.prototype.hasOwnProperty.call(project, 'recentMutationIds'), false);
  const staleRevision = project.editRevision;
  const competingEdits = await Promise.all([
    fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentTypeOverride: 'short', expectedEditRevision: staleRevision }) }),
    fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentTypeOverride: 'long_short', expectedEditRevision: staleRevision }) })
  ]);
  assert.deepEqual(competingEdits.map(function (item) { return item.status; }).sort(), [200, 409]);
  const rejectedEdit = competingEdits.find(function (item) { return item.status === 409; });
  assert.equal((await rejectedEdit.json()).error, 'edit_conflict');
  project = await (await fetch(base + '/api/editor/' + project.id)).json();
  assert.equal(project.editRevision, staleRevision + 1);
  expectedPlanningPieceId = 'plan-2';
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planningPieceId: 'plan-2' }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.planningPieceId, 'plan-2');
  assert.equal(project.planningPieceTitle, 'Corrected outline');
  assert.equal(project.renderStatus, 'ready');
  assert.deepEqual(planningChanges, [
    { previous: '', next: 'plan-1', renderWillChange: false },
    { previous: 'plan-1', next: 'plan-2', renderWillChange: false }
  ]);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removedWordIndices: [0, 1] }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.deepEqual(project.removedWordIndices, [0, 1]);
  assert.equal(project.renderDirty, true, 'transcript cuts wait for the explicit rebuild action');
  assert.equal(project.renderStatus, 'ready', 'the reviewed preview remains available while cuts are batched');
  assert.equal(project.renderRebuildPending, false);
  assert.equal(project.canUndoCut, true);
  assert.equal(renderInvalidatedCalls, 1);
  assert.equal(fs.existsSync(path.join(dir, 'editor', project.id, 'render.mp4')), true);
  await new Promise(function (resolve) { setTimeout(resolve, 2800); });
  project = await (await fetch(base + '/api/editor/' + project.id)).json();
  assert.equal(renderReadyCalls, 1, 'saving a transcript cut must not start FFmpeg');
  const undoMutation = { expectedEditRevision: project.editRevision, mutationId: 'undo-idempotency-0001' };
  response = await fetch(base + '/api/editor/' + project.id + '/undo-cut', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undoMutation) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.deepEqual(project.removedWordIndices, []);
  assert.equal(project.canUndoCut, false);
  const undoneRevision = project.editRevision;
  response = await fetch(base + '/api/editor/' + project.id + '/undo-cut', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undoMutation) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.editRevision, undoneRevision);
  assert.deepEqual(project.removedWordIndices, []);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removedWordIndices: [0, 1, 2, 3] }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.deepEqual(project.removedWordIndices, [0, 1, 2, 3]);
  assert.equal(project.canUndoCut, true);
  response = await fetch(base + '/api/editor/' + project.id + '/undo-cut', { method: 'POST' });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.deepEqual(project.removedWordIndices, []);
  assert.equal(project.canUndoCut, false);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    restoredAutoCutIds: ['gap-1'], autoSilenceEnabled: false, silenceThresholdSeconds: 1.5, retainedPauseSeconds: 0.55
  }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.deepEqual(project.restoredAutoCutIds, ['gap-1']);
  assert.equal(project.autoSilenceEnabled, false);
  assert.equal(project.silenceThresholdSeconds, 1.5);
  assert.equal(project.retainedPauseSeconds, 0.55);
  assert.equal(project.canUndoCut, true);
  response = await fetch(base + '/api/editor/' + project.id + '/undo-cut', { method: 'POST' });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.deepEqual(project.restoredAutoCutIds, []);
  assert.equal(project.autoSilenceEnabled, true);
  assert.equal(project.silenceThresholdSeconds, 1);
  assert.equal(project.retainedPauseSeconds, 0.24);
  assert.equal(project.canUndoCut, false);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ captionsEnabled: false, wordCorrection: { index: 0, text: 'Once' } }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.renderStatus, 'ready');
  assert.equal(project.renderDirty, true);
  assert.equal(project.words[0].text, 'Once');
  assert.equal(project.words[0].originalText, 'One');
  assert.equal(project.transcriptText, 'Once two. One two.');
  assert.deepEqual(project.captionGroups.map(function (group) { return group.text; }), ['Once two.', 'One two.']);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wordCorrection: { index: 0, text: 'two words' } }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_word_correction');
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wordCorrection: { index: 0, text: 'x'.repeat(41) } }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_word_correction');
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    retainedPauseSeconds: 0.55
  }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.renderStatus, 'ready');
  assert.equal(project.renderDirty, true);
  assert.equal(renderReadyCalls, 1, 'all manual changes remain batched before rebuild');
  response = await fetch(base + '/api/editor/' + project.id + '/render', { method: 'POST' });
  assert.equal(response.status, 202);
  for (let attempt = 0; attempt < 600 && (project.renderStatus !== 'ready' || project.renderDirty || renderReadyCalls < 2 || project.workflowWarning); attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.renderStatus, 'ready', project.renderError);
  assert.equal(project.renderDirty, false);
  assert.equal(project.renderRebuildPending, false, 'the preview unlocks only after the replacement decision preview is ready');
  assert.equal(project.renderPreviewStatus, 'not_required', project.renderPreviewError);
  assert.equal(project.renderPreviewVersion, 0);
  assert.equal(renderReadyCalls, 2);
  assert.equal(project.workflowWarning, undefined);
  assert.equal(project.captionsEnabled, false);
  assert.equal(project.retainedPauseSeconds, 0.55);
  assert.deepEqual(project.punchIns, undefined);
  response = await fetch(base + '/api/editor/' + project.id + '/render');
  assert.equal(response.status, 200);
  const rendered = Buffer.from(await response.arrayBuffer());
  assert.ok(rendered.length > 1000);
  response = await fetch(base + '/api/editor/' + project.id + '/render?inline=1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.ok(Buffer.from(await response.arrayBuffer()).length > 1000);
  response = await fetch(base + '/api/editor/' + project.id + '/render?inline=1', { headers: { Range: 'bytes=0-1023' } });
  assert.equal(response.status, 206);
  assert.match(response.headers.get('content-range') || '', /^bytes 0-1023\//);
  assert.ok(project.editedDuration < project.duration);
  const verifiedRenderPath = path.join(dir, 'editor', project.id, 'render.mp4');
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioTrackId: '' }) });
  assert.equal(response.status, 200);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioTrackId: 'missing-track' }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_audio_track');
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioTrackId: 'track-1' }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.audioTrackId, 'track-1');
  assert.equal(project.audioMixSettings.musicBelowDialogueDb, 20);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioTrackId: '' }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.audioTrackId, '');
  assert.equal(project.audioMixSettings, undefined);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioTrackId: 'track-1' }) });
  assert.equal(response.status, 200);
  project = await response.json();
  fs.appendFileSync(verifiedRenderPath, 'tampered-after-verification');
  response = await fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'render_verification_stale');
  assert.equal(fs.existsSync(verifiedRenderPath), false);
  for (let attempt = 0; attempt < 600 && (project.renderStatus !== 'ready' || renderReadyCalls < 3); attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.renderStatus, 'ready', project.renderError);
  assert.equal(renderReadyCalls, 3);
  assert.equal(await editor.verifiedRenderMatches(project, verifiedRenderPath), true);
  response = await fetch(base + '/api/editor/audio-tracks');
  assert.equal(response.status, 200);
  const audioLibrary = await response.json();
  assert.deepEqual(audioLibrary.tracks, [{ id: 'track-1', name: 'Test ambience', note: 'Quiet test bed' }]);
  assert.equal(audioLibrary.mixVersion.length, 16);
  const audioPreviewUrl = base + '/api/editor/' + project.id + '/audio-preview/track-1?v=' +
    encodeURIComponent(project.renderSha256 + ':' + audioLibrary.mixVersion + ':track-1');
  const audioPreviews = await Promise.all([
    fetch(audioPreviewUrl),
    fetch(audioPreviewUrl)
  ]);
  assert.deepEqual(audioPreviews.map(function (item) { return item.status; }), [200, 200]);
  assert.equal(audioPreviews[0].headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.ok(Buffer.from(await audioPreviews[0].arrayBuffer()).length > 1000);
  assert.ok(Buffer.from(await audioPreviews[1].arrayBuffer()).length > 1000);
  assert.equal(audioPreviewCalls, 1, 'simultaneous requests must share one cached mix');
  const simultaneousHandoffs = await Promise.all([
    fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' }),
    fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' })
  ]);
  assert.deepEqual(simultaneousHandoffs.map(function (item) { return item.status; }).sort(), [200, 201]);
  const handoffResult = await simultaneousHandoffs[0].json();
  const joinedHandoffResult = await simultaneousHandoffs[1].json();
  assert.equal(handoffResult.pieceId, project.id);
  assert.equal(joinedHandoffResult.pieceId, project.id);
  assert.equal(handoffResult.piece.stage, 'in_production');
  assert.equal(handoffResult.planningPiece.stage, 'uploaded');
  assert.equal(handoffResult.alreadySent || joinedHandoffResult.alreadySent, true);
  assert.equal(handoffResult.workflowWarning, 'Synthetic planning-stage warning.');
  project = await (await fetch(base + '/api/editor/' + project.id)).json();
  assert.equal(project.workflowWarning, 'Synthetic planning-stage warning.');
  response = await fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).alreadySent, true);
  assert.equal(handoffCalls, 2);
  downstreamProductionExists = false;
  response = await fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).alreadySent, false);
  assert.equal(handoffCalls, 3, 'an orphaned Sent marker must recreate the downstream handoff');
  const productionMasterPath = path.join(dir, 'production-master.mp4');
  const masterProgress = [];
  const masterResult = await service.renderProductionMaster(project.id, productionMasterPath, function (percent) { masterProgress.push(percent); });
  assert.ok(fs.statSync(productionMasterPath).size > 1024);
  assert.deepEqual([masterResult.width, masterResult.height], [360, 640]);
  assert.equal(masterProgress.at(-1), 100);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ captionsEnabled: true }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'approved_read_only');
  response = await fetch(base + '/api/editor/' + project.id + '/render', { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'approved_read_only');
  response = await fetch(base + '/api/editor/' + project.id, { method: 'DELETE' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'production_source_required');
  assert.equal(deletedProjects.length, 0);
  response = await fetch(base + '/api/editor/' + project.id);
  assert.equal(response.status, 200);
});
