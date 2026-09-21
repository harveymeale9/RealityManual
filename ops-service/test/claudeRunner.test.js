'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-claude-recovery-'));
process.env.CLAUDE_RUN_DIR = scratch;
process.env.CLAUDE_HOST_RUN_DIR = scratch;
const claudeRunner = require('../src/claudeRunner');

function writeRun(key, events, code) {
  fs.writeFileSync(path.join(scratch, key + '.jsonl'), events.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(scratch, key + '.stderr'), '');
  if (code !== undefined) fs.writeFileSync(path.join(scratch, key + '.exit'), String(code) + '\n');
}

test.after(function () {
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('recovers the final Claude reply and session from a completed durable journal', async function () {
  const key = 'completed-run-123';
  writeRun(key, [
    { type: 'system', subtype: 'init', session_id: 'session_recovered_123' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking the deployment path.' }] } },
    { type: 'result', is_error: false, session_id: 'session_recovered_123', result: 'The deployment recovery is complete.' }
  ], 0);

  const activity = [];
  const result = await claudeRunner.recoverClaudeRun({
    runKey: key,
    pollIntervalMs: 5,
    onActivity: function (line) { activity.push(line); }
  });

  assert.equal(result.ok, true);
  assert.equal(result.replyText, 'The deployment recovery is complete.');
  assert.equal(result.sessionId, 'session_recovered_123');
  assert.match(activity.join('\n'), /reconnected/i);
  assert.match(activity.join('\n'), /completed/i);
});

test('waits for an inherited host run to finish after the service restart', async function () {
  const key = 'running-run-456';
  writeRun(key, [
    { type: 'system', subtype: 'init', session_id: 'session_running_456' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Still working.' }] } }
  ]);

  setTimeout(function () {
    fs.appendFileSync(path.join(scratch, key + '.jsonl'), JSON.stringify({
      type: 'result', is_error: false, session_id: 'session_running_456', result: 'I came back with the proper update.'
    }) + '\n');
    fs.writeFileSync(path.join(scratch, key + '.exit'), '0\n');
  }, 20);

  const result = await claudeRunner.recoverClaudeRun({ runKey: key, pollIntervalMs: 5, timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(result.replyText, 'I came back with the proper update.');
});

test('surfaces a persisted host-run failure instead of inventing a completion', async function () {
  const key = 'failed-run-789';
  writeRun(key, [
    { type: 'system', subtype: 'init', session_id: 'session_failed_789' },
    { type: 'result', is_error: true, session_id: 'session_failed_789', errors: ['No conversation found with session ID: session_failed_789'] }
  ], 1);

  const result = await claudeRunner.recoverClaudeRun({ runKey: key, pollIntervalMs: 5 });
  assert.equal(result.ok, false);
  assert.match(result.error, /No conversation found/);
});

test('hasRecoverableRun is false once no journal or exit marker exists', function () {
  assert.equal(claudeRunner.hasRecoverableRun('never-existed-run'), false);
});
