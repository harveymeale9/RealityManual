'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
