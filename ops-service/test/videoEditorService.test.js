'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');
const Database = require('better-sqlite3');
const editor = require('../src/videoEditorService');

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

test('automatic cuts preserve natural handles around long pauses', function () {
  const cuts = editor.calculateAutoCuts(words, 9);
  assert.deepEqual(cuts.map(function (cut) { return cut.reason; }), ['leading_silence', 'long_pause', 'long_pause', 'trailing_silence']);
  assert.equal(cuts[1].start, 1.99);
  assert.equal(cuts[1].end, 3.81);
});

test('individual automatic pauses can be restored without disabling the rest', function () {
  const project = { words: words, duration: 9, autoSilenceEnabled: true, restoredAutoCutIds: ['gap-1'] };
  const cuts = editor.cutsForProject(project);
  assert.equal(cuts.some(function (cut) { return cut.start < 4 && cut.end > 2; }), false);
  assert.equal(cuts.some(function (cut) { return cut.start > 5 && cut.start < 7; }), true);
  const decisions = editor.gapDecisions(project);
  assert.equal(decisions.find(function (cut) { return cut.id === 'gap-1'; }).restored, true);
});

test('format classification respects composition and explicit overrides', function () {
  const project = { width: 3840, height: 2160, duration: 80, words: words, visualClassification: { layout: 'vertical' } };
  assert.equal(editor.effectiveLayout(project), 'vertical');
  assert.equal(editor.contentTypeForProject(project, []), 'long_short');
  project.layoutOverride = 'horizontal';
  assert.equal(editor.effectiveLayout(project), 'horizontal');
  assert.equal(editor.contentTypeForProject(project, []), 'longform');
  project.contentTypeOverride = 'short';
  assert.equal(editor.contentTypeForProject(project, []), 'short');
  assert.equal(editor.effectiveLayout({ width: 1080, height: 1920, visualClassification: { layout: 'horizontal' } }), 'vertical');
});

test('invalidating an edit clears every stale output claim', function () {
  const project = { renderStatus: 'ready', renderError: 'old', renderProgress: 100, automaticRenderStartedAt: 'then',
    renderQuality: { status: 'passed' }, renderSizeBytes: 1234, editedDuration: 42 };
  editor.invalidateRender(project);
  assert.deepEqual(project, { renderStatus: '', renderError: '', renderProgress: 0, automaticRenderStartedAt: '', renderQuality: null, renderSizeBytes: 0, editedDuration: 0 });
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

test('semantic retake ranges become bounded exact word decisions', function () {
  const decisions = editor.normalizeRetakeDecisions([{ removeStartIndex: 0, removeEndIndex: 1, replacementStartIndex: 2, replacementEndIndex: 5, confidence: 'high', reason: 'The first attempt stops early.' }], [
    { index: 0, text: 'The' }, { index: 1, text: 'problem' }, { index: 2, text: 'The' }, { index: 3, text: 'problem' }, { index: 4, text: 'is' }, { index: 5, text: 'obvious.' }
  ]);
  assert.equal(decisions.length, 1);
  assert.deepEqual(decisions[0].removeWordIndices, [0, 1]);
  assert.equal(decisions[0].replacementText, 'The problem is obvious.');
  assert.equal(decisions[0].source, 'semantic');
});

test('unresolved retakes block approval until cut or explicitly dismissed', function () {
  const project = { words: words, removedWordIndices: [], dismissedRetakeIds: [], retakeDecisions: [{ id: 'smart-retake-0', removeWordIndices: [2, 3], confidence: 'review' }] };
  assert.equal(editor.unresolvedRetakeCount(project), 1);
  project.removedWordIndices = [2, 3];
  assert.equal(editor.unresolvedRetakeCount(project), 0);
  project.removedWordIndices = [];
  project.dismissedRetakeIds = ['smart-retake-0'];
  assert.equal(editor.unresolvedRetakeCount(project), 0);
});

test('adjacent removed transcript words become one manual cut', function () {
  const cuts = editor.calculateManualCuts(words, [2, 3], 9);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].reason, 'transcript_cut');
  assert.ok(cuts[0].start > words[1].end);
  assert.ok(cuts[0].end < words[4].start);
});

test('overlapping cuts merge and retained segments fill the rest', function () {
  const cuts = editor.mergeCuts([{ start: 1, end: 3 }, { start: 2.9, end: 4 }, { start: 7, end: 8 }], 10);
  assert.deepEqual(cuts.map(function (cut) { return [cut.start, cut.end]; }), [[1, 4], [7, 8]]);
  assert.deepEqual(editor.keepSegments(10, cuts), [{ start: 0, end: 1 }, { start: 4, end: 7 }, { start: 8, end: 10 }]);
  assert.equal(editor.mapSourceTimeToEdited(9, cuts), 5);
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
  assert.match(ass, /PrimaryColour.*\nStyle: Default,Arial,120,&H0000FFFF/);
  assert.match(ass, /,2,40,40,701,1/);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:02\.00.*A \\{real\\} caption/);
});

test('landscape captions are larger and advance spoken-word emphasis', function () {
  const groups = [{ start: 1, end: 2, text: 'A wise move', words: [
    { text: 'A', start: 1, end: 1.2 }, { text: 'wise', start: 1.2, end: 1.6 }, { text: 'move', start: 1.6, end: 2 }
  ] }];
  const ass = editor.buildAss({ width: 1920, height: 1080 }, groups);
  assert.match(ass, /Style: Default,Arial,65,/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 3);
  assert.match(ass, /\\fs77\\bord4}A\{\\r} wise move/);
  assert.match(ass, /A \{\\fs77\\bord4}wise\{\\r} move/);
});

test('vertical captions show one large yellow word at a time', function () {
  const groups = [{ start: 1, end: 2, text: 'One word now', words: [
    { text: 'One', start: 1, end: 1.2 }, { text: 'word', start: 1.25, end: 1.55 }, { text: 'now', start: 1.6, end: 2 }
  ] }];
  const ass = editor.buildAss({ width: 1080, height: 1920 }, groups);
  assert.match(ass, /Style: Default,Arial,120,.*&H0000FFFF/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 3);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:01\.25.*One$/m);
  assert.match(ass, /Dialogue: 0,0:00:01\.25,0:00:01\.60.*word$/m);
  assert.match(ass, /Dialogue: 0,0:00:01\.60,0:00:02\.00.*now$/m);
  const fitted = editor.buildAss({ width: 1080, height: 1920 }, [{ start: 0, end: 1, text: 'xxxxxxxxxxxxxxxxxxxxxxxx', words: [{ text: 'xxxxxxxxxxxxxxxxxxxxxxxx', start: 0, end: 1 }] }]);
  assert.match(fitted, /\{\\fs90\}xxxxxxxxxxxxxxxxxxxxxxxx\{\\r\}/);
});

test('batch preprocessing serializes expensive transcription and frame analysis', { timeout: 15000 }, async function (t) {
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
  let activeClassifications = 0; let maxClassifications = 0; let classificationCalls = 0;
  const service = editor.setup({
    db: db, dataDir: dir,
    transcribeDetailed: async function () {
      transcriptionCalls++; activeTranscriptions++; maxTranscriptions = Math.max(maxTranscriptions, activeTranscriptions);
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      activeTranscriptions--; return { text: '', words: [] };
    },
    classifyVisualLayout: async function () {
      classificationCalls++; activeClassifications++; maxClassifications = Math.max(maxClassifications, activeClassifications);
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
      activeClassifications--; return { layout: 'horizontal', confidence: 'high', cropCenterX: 0.5, explanation: 'Synthetic spread.' };
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
  assert.ok(secondQueued.classificationQueuePosition >= 2);
  for (let attempt = 0; attempt < 100 && (transcriptionCalls < 2 || classificationCalls < 2 || activeTranscriptions || activeClassifications); attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(transcriptionCalls, 2); assert.equal(classificationCalls, 2);
  assert.equal(maxTranscriptions, 1); assert.equal(maxClassifications, 1);
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
  for (let attempt = 0; attempt < 100; attempt++) {
    const stored = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'recover-1').data);
    if (stored.transcriptionStatus === 'error') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  const recovered = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'recover-1').data);
  assert.equal(calls, 1);
  assert.equal(recovered.transcriptionStatus, 'error');
  assert.equal(recovered.transcriptionError, 'No timed speech was detected in this recording.');
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('one recovery endpoint retries failed automatic work without replacing the source', { timeout: 10000 }, async function (t) {
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
    retakeAnalysisStatus: 'unavailable', planningMatchStatus: 'unavailable', transcriptionStatus: 'error', transcriptionError: 'Synthetic failure', renderStatus: '', productionPieceId: 'test-output-hold', createdAt: now, updatedAt: now
  }), now);
  const service = editor.setup({ db: db, dataDir: dir, transcribeDetailed: async function () { return { text: 'Recovered.', words: [{ type: 'word', text: 'Recovered.', start: .2, end: .8 }] }; } });
  const app = express(); app.use(express.json()); app.use('/api/editor', service.router);
  const server = http.createServer(app); await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(function () { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let response = await fetch(base + '/api/editor/retry-1/retry-failed', { method: 'POST' });
  assert.equal(response.status, 202); assert.deepEqual((await response.json()).retried, ['transcription']);
  let project;
  for (let attempt = 0; attempt < 100; attempt++) {
    project = await (await fetch(base + '/api/editor/retry-1')).json();
    if (project.transcriptionStatus === 'ready') break;
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
  }
  assert.equal(project.transcriptionStatus, 'ready'); assert.equal(project.transcriptText, 'Recovered.');
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
    transcriptionStatus: 'ready', classificationStatus: 'ready', retakeAnalysisStatus: 'ready',
    automaticRenderStartedAt: 'test-hold', createdAt: now, updatedAt: now
  }), now);
  let planningCalls = 0;
  editor.setup({
    db: db, dataDir: dir, transcribeDetailed: async function () { return { text: '', words: [] }; },
    getPlanningCandidates: function () { return []; },
    matchPlanningPiece: async function () { planningCalls++; return { pieceId: '', confidence: 'none', reason: 'No match.' }; }
  });
  let project;
  for (let attempt = 0; attempt < 100; attempt++) {
    project = JSON.parse(db.prepare('SELECT data FROM records WHERE store_name=? AND id=?').get('editorProjects', 'legacy-1').data);
    if (project.planningMatchStatus === 'ready') break;
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  assert.equal(project.planningMatchStatus, 'ready');
  // No candidates means the service resolves locally without spending an AI call.
  assert.equal(planningCalls, 0);
  assert.equal(project.renderProgress, 0);
  await new Promise(function (resolve) { setTimeout(resolve, 50); });
  t.after(function () { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
});

test('upload, timed transcription and FFmpeg captioned render work end to end', { timeout: 60000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-'));
  const input = path.join(dir, 'sample.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=5:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  let handoffCalls = 0;
  let classificationCalls = 0;
  let retakeCalls = 0;
  let planningMatchCalls = 0;
  let renderReadyCalls = 0;
  const service = editor.setup({
    db: db,
    dataDir: dir,
    transcribeDetailed: async function () {
      return { text: 'One two. Three four.', words: [
        { type: 'word', text: 'One', start: 0.5, end: 0.9 }, { type: 'word', text: 'two.', start: 0.95, end: 1.3 },
        { type: 'word', text: 'Three', start: 3.2, end: 3.7 }, { type: 'word', text: 'four.', start: 3.75, end: 4.2 }
      ] };
    },
    classifyVisualLayout: async function (input) {
      classificationCalls++;
      assert.equal(fs.existsSync(input.imagePath), true);
      return { layout: 'vertical', confidence: 'high', cropCenterX: 0.55, explanation: 'One page fills all sampled frames.' };
    },
    analyzeRetakes: async function () {
      retakeCalls++;
      if (retakeCalls === 1) throw new Error('synthetic transient classifier failure');
      return { decisions: [{ removeStartIndex: 2, removeEndIndex: 3, replacementStartIndex: 0, replacementEndIndex: 1, confidence: 'high', reason: 'Synthetic replaced take.' }] };
    },
    getPlanningCandidates: function () { return [{ id: 'plan-1', seq: 79, title: 'Synthetic outline', stage: 'filmed', notesSnippet: 'One two.' }]; },
    matchPlanningPiece: async function () { planningMatchCalls++; return { pieceId: 'plan-1', confidence: 'high', reason: 'The transcript matches the filmed outline.' }; },
    onRenderReady: function (input) { renderReadyCalls++; assert.equal(input.project.planningPieceId, 'plan-1'); },
    handoffToProduction: async function (input) {
      handoffCalls++;
      assert.equal(input.project.id.length > 0, true);
      assert.equal(fs.existsSync(input.renderPath), true);
      return { pieceId: input.project.id, alreadySent: false, workflowWarning: 'Synthetic planning-stage warning.' };
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
  form.append('video', new Blob([fs.readFileSync(input)], { type: 'video/mp4' }), 'sample.mp4');
  let response = await fetch(base + '/api/editor', { method: 'POST', body: form });
  assert.equal(response.status, 202);
  let project = await response.json();
  const duplicateForm = new FormData();
  duplicateForm.append('name', 'Synthetic take');
  duplicateForm.append('video', new Blob([fs.readFileSync(input)], { type: 'video/mp4' }), 'sample.mp4');
  response = await fetch(base + '/api/editor', { method: 'POST', body: duplicateForm });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).existingProjectId, project.id);
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
  assert.equal(project.cropCenterX, 0.55);
  assert.equal(classificationCalls, 1);
  for (let attempt = 0; attempt < 100 && project.retakeAnalysisStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.retakeAnalysisStatus, 'ready', project.retakeAnalysisError);
  assert.equal(retakeCalls, 2);
  assert.deepEqual(project.removedWordIndices, [2, 3]);
  for (let attempt = 0; attempt < 100 && project.planningMatchStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.planningMatchStatus, 'ready', project.planningMatchError);
  assert.equal(project.planningPieceId, 'plan-1');
  assert.equal(project.planningPieceTitle, 'Synthetic outline');
  assert.equal(project.planningPieceSeq, 79);
  assert.equal(planningMatchCalls, 1);
  assert.ok(project.cuts.some(function (cut) { return cut.reason === 'long_pause'; }));
  assert.deepEqual(project.captionGroups.map(function (group) { return group.text; }), ['One two.']);
  for (let attempt = 0; attempt < 600 && project.renderStatus !== 'ready' && project.renderStatus !== 'error'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.renderStatus, 'ready', project.renderError);
  assert.equal(project.renderProgress, 100);
  assert.equal(renderReadyCalls, 1);
  assert.equal(project.renderQuality.status, 'passed');
  assert.deepEqual(project.renderQuality.checks, { playableFile: true, correctFrame: true, audioPresent: true, durationMatches: true });
  assert.deepEqual([project.renderQuality.width, project.renderQuality.height], [1080, 1920]);
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ captionsEnabled: false }) });
  assert.equal(response.status, 200);
  project = await response.json();
  assert.equal(project.renderStatus, '');
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retainedPauseSeconds: 0.55 }) });
  assert.equal(response.status, 200);
  for (let attempt = 0; attempt < 600 && (project.renderStatus !== 'ready' || renderReadyCalls < 2); attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.renderStatus, 'ready', project.renderError);
  assert.equal(renderReadyCalls, 2);
  assert.equal(project.captionsEnabled, false);
  assert.equal(project.retainedPauseSeconds, 0.55);
  response = await fetch(base + '/api/editor/' + project.id + '/render');
  assert.equal(response.status, 200);
  const rendered = Buffer.from(await response.arrayBuffer());
  assert.ok(rendered.length > 1000);
  response = await fetch(base + '/api/editor/' + project.id + '/render?inline=1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.ok(Buffer.from(await response.arrayBuffer()).length > 1000);
  assert.ok(project.editedDuration < project.duration);
  response = await fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' });
  assert.equal(response.status, 201);
  const handoffResult = await response.json();
  assert.equal(handoffResult.pieceId, project.id);
  assert.equal(handoffResult.workflowWarning, 'Synthetic planning-stage warning.');
  project = await (await fetch(base + '/api/editor/' + project.id)).json();
  assert.equal(project.workflowWarning, 'Synthetic planning-stage warning.');
  response = await fetch(base + '/api/editor/' + project.id + '/production', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).alreadySent, true);
  assert.equal(handoffCalls, 1);
});
