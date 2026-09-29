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

test('automatic cuts preserve natural handles around long pauses', function () {
  const cuts = editor.calculateAutoCuts(words, 9);
  assert.deepEqual(cuts.map(function (cut) { return cut.reason; }), ['leading_silence', 'long_pause', 'long_pause', 'trailing_silence']);
  assert.equal(cuts[1].start, 1.99);
  assert.equal(cuts[1].end, 3.81);
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
});

test('ASS export uses bold yellow captions below centre', function () {
  const ass = editor.buildAss({ width: 1080, height: 1920 }, [{ start: 1, end: 2, text: 'A {real} caption' }]);
  assert.match(ass, /PrimaryColour.*\nStyle: Default,Arial,56,&H0000FFFF/);
  assert.match(ass, /,2,40,40,518,1/);
  assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:02\.00.*A \\{real\\} caption/);
});

test('upload, timed transcription and FFmpeg captioned render work end to end', { timeout: 30000 }, async function (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-editor-'));
  const input = path.join(dir, 'sample.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=360x640:d=5:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
  const db = new Database(path.join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE records (store_name TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (store_name, id))');
  const service = editor.setup({
    db: db,
    dataDir: dir,
    transcribeDetailed: async function () {
      return { text: 'One two. Three four.', words: [
        { type: 'word', text: 'One', start: 0.5, end: 0.9 }, { type: 'word', text: 'two.', start: 0.95, end: 1.3 },
        { type: 'word', text: 'Three', start: 3.2, end: 3.7 }, { type: 'word', text: 'four.', start: 3.75, end: 4.2 }
      ] };
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
  for (let attempt = 0; attempt < 100 && project.transcriptionStatus !== 'ready'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 30); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.transcriptionStatus, 'ready');
  assert.ok(project.cuts.some(function (cut) { return cut.reason === 'long_pause'; }));
  response = await fetch(base + '/api/editor/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removedWordIndices: [2, 3] }) });
  project = await response.json();
  assert.deepEqual(project.captionGroups.map(function (group) { return group.text; }), ['One two.']);
  response = await fetch(base + '/api/editor/' + project.id + '/render', { method: 'POST' });
  assert.equal(response.status, 202);
  for (let attempt = 0; attempt < 200 && project.renderStatus !== 'ready' && project.renderStatus !== 'error'; attempt++) {
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    project = await (await fetch(base + '/api/editor/' + project.id)).json();
  }
  assert.equal(project.renderStatus, 'ready', project.renderError);
  response = await fetch(base + '/api/editor/' + project.id + '/render');
  assert.equal(response.status, 200);
  const rendered = Buffer.from(await response.arrayBuffer());
  assert.ok(rendered.length > 1000);
  assert.ok(project.editedDuration < project.duration);
});
