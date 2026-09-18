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

// Turns one stream-json event into short, human-readable activity line(s)
// for the Project Manager tab's live "what CC is doing" pane — a glance at
// tool calls and intermediate text, never the full tool input/output.
function describeEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
    // Deliberately skips plain `text` blocks: that's the model's actual
    // reply content, which the Project Manager tab already shows as the
    // clean result on the left — this feed is only the "how" (thinking +
    // tool calls), never a duplicate of the "what".
    const lines = [];
    evt.message.content.forEach(function (block) {
      if (block.type === 'thinking' && block.thinking && block.thinking.trim()) {
        lines.push('\u{1F4AD} ' + block.thinking.trim().slice(0, 400));
      } else if (block.type === 'tool_use') {
        lines.push(describeToolUse(block));
      }
    });
    return lines.length ? lines : null;
  }
  if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
    const lines = [];
    evt.message.content.forEach(function (block) {
      if (block.type === 'tool_result') {
        const text = extractToolResultText(block);
        if (text) lines.push('→ ' + text);
      }
    });
    return lines.length ? lines : null;
  }
  return null;
}

function describeToolUse(block) {
  const name = block.name || 'tool';
  const input = block.input || {};
  let detail = '';
  if (typeof input.command === 'string') detail = input.command;
  else if (typeof input.file_path === 'string') detail = input.file_path;
  else if (typeof input.pattern === 'string') detail = input.pattern;
  else if (typeof input.path === 'string') detail = input.path;
  else if (typeof input.url === 'string') detail = input.url;
  else if (typeof input.query === 'string') detail = input.query;
  else if (typeof input.prompt === 'string') detail = input.prompt;
  detail = detail ? (': ' + detail.replace(/\s+/g, ' ').slice(0, 160)) : '';
  return '⚙ ' + name + detail;
}

function extractToolResultText(block) {
  const c = block.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    text = c.filter(function (p) { return p && p.type === 'text'; }).map(function (p) { return p.text; }).join(' ');
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function runClaude(opts) {
  const prompt = opts.prompt;
  const sessionId = opts.sessionId;
  const appendSystemPrompt = opts.appendSystemPrompt;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function () {};
  const newSessionId = crypto.randomUUID();

  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
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

    let buffer = '';
    let stderr = '';
    let settled = false;
    let finalResult = null;

    const killTimer = setTimeout(function () {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'timed_out after ' + Math.round(timeoutMs / 1000) + 's' });
    }, timeoutMs);

    function handleLine(line) {
      line = line.trim();
      if (!line) return;
      let evt;
      try { evt = JSON.parse(line); } catch (e) { return; }
      if (evt.type === 'result') {
        finalResult = evt;
        return;
      }
      try {
        const lines = describeEvent(evt);
        if (lines) lines.forEach(onActivity);
      } catch (e) { /* a malformed/unexpected event should never break the run */ }
    }

    child.stdout.on('data', function (d) {
      buffer += d;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
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
      if (buffer.trim()) handleLine(buffer);
      if (code !== 0) {
        return resolve({ ok: false, error: 'exit_code_' + code + ': ' + stderr.slice(-2000), sessionId: finalResult && finalResult.session_id });
      }
      if (!finalResult) {
        return resolve({ ok: false, error: 'no_result_event: ' + stderr.slice(-2000) });
      }
      if (finalResult.is_error) {
        const detail = finalResult.result ||
          (Array.isArray(finalResult.errors) && finalResult.errors.join('; ')) ||
          stderr.slice(-2000);
        return resolve({ ok: false, error: (finalResult.subtype || 'error') + ': ' + detail, sessionId: finalResult.session_id });
      }
      resolve({ ok: true, replyText: finalResult.result || '', sessionId: finalResult.session_id || sessionId || newSessionId });
    });
  });
}

module.exports = { runClaude };
