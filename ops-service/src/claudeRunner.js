// Invokes the real `claude` CLI headlessly (non-interactive print mode) so
// the voice app talks to an actual Claude Code agent with full tool access
// to the realitymanual-repo project — not a separate chat API. Requires the
// same ~/.claude OAuth credentials and the repo itself to be available in
// this process's filesystem (see Dockerfile / VPS run command: both are
// bind-mounted from the host).
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_REPO_DIR = process.env.CLAUDE_REPO_DIR || '/root/realitymanual-repo';
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

function runClaude(opts) {
  const prompt = opts.prompt;
  const sessionId = opts.sessionId;
  const appendSystemPrompt = opts.appendSystemPrompt;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const newSessionId = crypto.randomUUID();

  const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
  if (sessionId) args.push('--resume', sessionId);
  else args.push('--session-id', newSessionId);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);

  return new Promise(function (resolve) {
    let child;
    try {
      child = spawn(CLAUDE_BIN, args, { cwd: CLAUDE_REPO_DIR, env: process.env });
    } catch (err) {
      return resolve({ ok: false, error: 'spawn_failed: ' + err.message });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTimer = setTimeout(function () {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'timed_out after ' + Math.round(timeoutMs / 1000) + 's' });
    }, timeoutMs);

    child.stdout.on('data', function (d) { stdout += d; });
    child.stderr.on('data', function (d) { stderr += d; });

    child.on('error', function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve({ ok: false, error: 'process_error: ' + err.message });
    });

    child.on('close', function (code) {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code !== 0) {
        return resolve({ ok: false, error: 'exit_code_' + code + ': ' + stderr.slice(-2000) });
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        return resolve({ ok: false, error: 'bad_json_output: ' + stdout.slice(-2000) });
      }
      if (parsed.is_error) {
        return resolve({ ok: false, error: (parsed.subtype || 'error') + ': ' + (parsed.result || stderr.slice(-2000)), sessionId: parsed.session_id });
      }
      resolve({ ok: true, replyText: parsed.result || '', sessionId: parsed.session_id || sessionId || newSessionId });
    });
  });
}

module.exports = { runClaude };
