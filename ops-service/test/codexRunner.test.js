'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-codex-recovery-'));
process.env.CODEX_RUN_DIR = scratch;
process.env.CODEX_HOST_RUN_DIR = scratch;
const codexRunner = require('../src/codexRunner');

function writeRun(key, events, code) {
  fs.writeFileSync(path.join(scratch, key + '.jsonl'), events.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(scratch, key + '.stderr'), '');
  if (code !== undefined) fs.writeFileSync(path.join(scratch, key + '.exit'), String(code) + '\n');
}

test.after(function () {
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('recovers the final Codex reply and thread from a completed durable journal', async function () {
  const key = 'completed-run-123';
  writeRun(key, [
    { type: 'thread.started', thread_id: 'thread_recovered_123' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'I am checking the deployment path.' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'The deployment recovery is complete.' } },
    { type: 'turn.completed' }
  ], 0);

  const activity = [];
  const result = await codexRunner.recoverCodexRun({
    runKey: key,
    pollIntervalMs: 5,
    onActivity: function (line) { activity.push(line); }
  });

  assert.equal(result.ok, true);
  assert.equal(result.replyText, 'The deployment recovery is complete.');
  assert.equal(result.sessionId, 'thread_recovered_123');
  assert.match(activity.join('\n'), /reconnected/i);
  assert.match(activity.join('\n'), /completed/i);
});

test('recovers generated image metadata with the assistant reply', async function () {
  const key = 'completed-images-234';
  writeRun(key, [
    { type: 'thread.started', thread_id: 'thread_images_234' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Here are the mockups.' } }
  ], 0);
  fs.writeFileSync(path.join(scratch, key + '.images.tsv'), [
    'reply-0.png\timage/png\tCinematic mockup.png',
    'reply-1.webp\timage/webp\tEditorial mockup.webp',
    '../escape.png\timage/png\tUnsafe.png'
  ].join('\n') + '\n');

  const result = await codexRunner.recoverCodexRun({ runKey: key, pollIntervalMs: 5 });
  assert.deepEqual(result.replyAttachments, [
    { file: 'reply-0.png', mime: 'image/png', name: 'Cinematic mockup.png' },
    { file: 'reply-1.webp', mime: 'image/webp', name: 'Editorial mockup.webp' }
  ]);
});

test('generated-image capture keeps the remote runner shell valid', function () {
  const key = 'shell-images-345';
  const paths = {
    hostJournal: path.join(scratch, key + '.jsonl'),
    hostStderr: path.join(scratch, key + '.stderr'),
    hostExit: path.join(scratch, key + '.exit'),
    hostImageMarker: path.join(scratch, key + '.image-marker'),
    hostImageManifest: path.join(scratch, key + '.images.tsv')
  };
  const command = codexRunner.buildRemoteCommand('thread_shell_345', [], '/tmp/rm-codex-shell.pid', paths, key);
  const syntax = childProcess.spawnSync('bash', ['-n', '-c', command], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(command, /reply-\$\{image_index\}/);
  assert.match(command, /generated_images/);
});

test('waits for an inherited host run to finish after the service restart', async function () {
  const key = 'running-run-456';
  writeRun(key, [
    { type: 'thread.started', thread_id: 'thread_running_456' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'I am still working.' } }
  ]);

  setTimeout(function () {
    fs.appendFileSync(path.join(scratch, key + '.jsonl'), JSON.stringify({
      type: 'item.completed', item: { type: 'agent_message', text: 'I came back with the proper update.' }
    }) + '\n');
    fs.writeFileSync(path.join(scratch, key + '.exit'), '0\n');
  }, 20);

  const result = await codexRunner.recoverCodexRun({ runKey: key, pollIntervalMs: 5, timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(result.replyText, 'I came back with the proper update.');
});

test('surfaces a persisted host-run failure instead of inventing a completion', async function () {
  const key = 'failed-run-789';
  writeRun(key, [
    { type: 'thread.started', thread_id: 'thread_failed_789' },
    { type: 'turn.failed', error: { message: 'provider stopped the turn' } }
  ], 7);

  const result = await codexRunner.recoverCodexRun({ runKey: key, pollIntervalMs: 5 });
  assert.equal(result.ok, false);
  assert.match(result.error, /provider stopped the turn/);
});

test('passes every attached image to the Codex CLI', async function () {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-codex-fake-ssh-'));
  const fakeSsh = path.join(fakeBin, 'ssh');
  fs.writeFileSync(fakeSsh, [
    '#!/bin/sh',
    'case "$*" in',
    '  *"-i"*"/tmp/first image.png"*"-i"*"/tmp/second.jpg"*) ;;',
    '  *) echo "all images were not forwarded" >&2; exit 44 ;;',
    'esac',
    'cat >/dev/null',
    "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"thread_images_test\"}'",
    "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"saw both\"}}'",
    "printf '%s\\n' '{\"type\":\"turn.completed\"}'"
  ].join('\n') + '\n', { mode: 0o755 });

  const originalPath = process.env.PATH;
  process.env.PATH = fakeBin + path.delimiter + originalPath;
  try {
    const result = await codexRunner.runCodex({
      prompt: 'inspect these',
      imagePaths: ['/tmp/first image.png', '/tmp/second.jpg'],
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.replyText, 'saw both');
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});

test('cancels an active Codex run and settles it as cancelled', async function () {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-codex-cancel-'));
  const fakeSsh = path.join(fakeBin, 'ssh');
  fs.writeFileSync(fakeSsh, [
    '#!/bin/sh',
    'case "$*" in',
    '  *"codex"*"exec"*) cat >/dev/null; exec sleep 30 ;;',
    '  *) exit 0 ;;',
    'esac'
  ].join('\n') + '\n', { mode: 0o755 });

  const originalPath = process.env.PATH;
  process.env.PATH = fakeBin + path.delimiter + originalPath;
  const key = 'cancel-active-run-123';
  try {
    const running = codexRunner.runCodex({
      prompt: 'keep working',
      ownerKey: 'project-manager',
      runKey: key,
      timeoutMs: 1000
    });
    await new Promise(function (resolve) { setTimeout(resolve, 25); });
    assert.equal(await codexRunner.cancelCodexRun({ runKey: key, ownerKey: 'project-manager' }), true);
    const result = await running;
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.match(result.error, /Stopped by Harvey/);
  } finally {
    codexRunner.cleanupRun(key);
    process.env.PATH = originalPath;
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});
