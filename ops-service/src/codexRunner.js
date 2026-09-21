'use strict';

// Runs Codex on the VPS host through the same audited SSH boundary the
// container's Claude agent already uses for host work. Codex itself runs on
// the host (as root via passwordless sudo), so its tools naturally see the
// repository, Docker, nginx, systemd, logs, and the rest of the VPS without
// mounting host credentials or a Docker socket into this container.
//
// `codex exec --json` emits JSONL as work happens. We translate that stream
// into the same three callbacks the Project Manager already persists for
// Claude: an early acknowledgment, activity lines, and one final reply.
const { spawn } = require('child_process');

const HOST = process.env.CODEX_HOST || 'ubuntu@host.docker.internal';
const HOST_BIN = process.env.CODEX_HOST_BIN || '/root/.local/bin/codex';
const HOST_REPO = process.env.CODEX_HOST_REPO || '/srv/realitymanual-repo';
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function shortText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max || 300);
}

function describeItem(evt) {
  const item = evt && evt.item;
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'command_execution') {
    if (evt.type === 'item.started') return '\u2699 shell: ' + shortText(item.command, 180);
    const output = shortText(item.aggregated_output, 300);
    return '\u2192 exit ' + (typeof item.exit_code === 'number' ? item.exit_code : '?') + (output ? ': ' + output : '');
  }
  if (item.type === 'reasoning') {
    const text = shortText(item.text || item.summary, 400);
    return text ? '\u{1F4AD} ' + text : null;
  }
  if (item.type === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const paths = changes.map(function (change) { return change.path; }).filter(Boolean).join(', ');
    return '\u2699 file change' + (paths ? ': ' + shortText(paths, 220) : '');
  }
  if (item.type === 'mcp_tool_call') {
    return '\u2699 ' + shortText(item.server || 'MCP', 60) + ': ' + shortText(item.tool || item.name || 'tool call', 120);
  }
  if (item.type === 'web_search') return '\u2699 web search: ' + shortText(item.query, 220);
  if (item.type === 'plan') return '\u2699 plan updated';
  return null;
}

function errorText(evt) {
  if (!evt) return '';
  if (typeof evt.message === 'string') return evt.message;
  if (evt.error && typeof evt.error.message === 'string') return evt.error.message;
  if (typeof evt.error === 'string') return evt.error;
  return '';
}

function buildRemoteCommand(sessionId, imagePath) {
  const args = [HOST_BIN, 'exec'];
  if (sessionId) {
    args.push('resume', '--all', '--json', '--dangerously-bypass-approvals-and-sandbox');
    if (imagePath) args.push('-i', imagePath);
    args.push(sessionId, '-');
  } else {
    args.push('--json', '--dangerously-bypass-approvals-and-sandbox', '-C', HOST_REPO);
    if (imagePath) args.push('-i', imagePath);
    args.push('-');
  }
  return 'cd ' + shellQuote(HOST_REPO) + ' && sudo -H ' + args.map(shellQuote).join(' ');
}

function runCodex(opts) {
  opts = opts || {};
  const prompt = String(opts.prompt || '');
  const sessionId = opts.sessionId && SESSION_ID_RE.test(opts.sessionId) ? opts.sessionId : null;
  const imagePath = opts.imagePath ? String(opts.imagePath) : null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function () {};
  const onEarlyAck = typeof opts.onEarlyAck === 'function' ? opts.onEarlyAck : function () {};

  return new Promise(function (resolve) {
    onActivity('\u25cf Starting Codex on the VPS');
    const child = spawn('ssh', [HOST, buildRemoteCommand(sessionId, imagePath)], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdoutBuffer = '';
    let stderr = '';
    let threadId = sessionId;
    let finalText = '';
    let earlyAckSent = false;
    let agentMessageCount = 0;
    let streamError = '';
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    function handleEvent(evt) {
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'thread.started' && evt.thread_id) {
        threadId = evt.thread_id;
        onActivity('\u25cf Codex session ready');
      }
      if (evt.type === 'turn.started') onActivity('\u25cf Codex is working');
      if (evt.type === 'turn.completed') onActivity('\u2713 Codex turn completed');
      if (evt.type === 'error' || evt.type === 'turn.failed') {
        streamError = errorText(evt) || streamError || evt.type;
        onActivity('\u2715 ' + shortText(streamError, 300));
      }
      if ((evt.type === 'item.started' || evt.type === 'item.completed') && evt.item) {
        if (evt.item.type === 'agent_message' && evt.type === 'item.completed') {
          const text = String(evt.item.text || '').trim();
          if (!text) return;
          // Codex emits progress updates as agent_message items too. Keep
          // the newest message buffered as the possible final reply; when
          // another arrives, the prior one is known to be an intermediate
          // update and belongs in Activity. The first message is already
          // visible as the early acknowledgment/Task List title.
          if (agentMessageCount > 1 && finalText) {
            onActivity('\u25cf ' + shortText(finalText, 500));
          }
          agentMessageCount++;
          finalText = text;
          if (!earlyAckSent) {
            earlyAckSent = true;
            onEarlyAck(text);
          }
          return;
        }
        const activity = describeItem(evt);
        if (activity) onActivity(activity);
      }
    }

    function consumeLines(final) {
      const lines = stdoutBuffer.split('\n');
      const tail = lines.pop();
      stdoutBuffer = final ? '' : tail;
      lines.forEach(function (line) {
        if (!line.trim()) return;
        try { handleEvent(JSON.parse(line)); } catch (e) { onActivity('\u2192 ' + shortText(line, 300)); }
      });
      if (final && tail.trim()) {
        try { handleEvent(JSON.parse(tail)); } catch (e) { /* surfaced through exit status/stderr */ }
      }
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function (chunk) {
      stdoutBuffer += chunk;
      consumeLines(false);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function (chunk) { stderr += chunk; });
    child.on('error', function (err) {
      finish({ ok: false, error: 'codex_start_failed: ' + err.message, sessionId: threadId });
    });
    child.on('close', function (code) {
      consumeLines(true);
      if (code === 0 && finalText) {
        finish({ ok: true, replyText: finalText, sessionId: threadId });
        return;
      }
      const detail = streamError || shortText(stderr, 2000) || ('Codex exited with code ' + code);
      finish({ ok: false, error: detail, sessionId: threadId });
    });

    const timeout = setTimeout(function () {
      try { child.kill('SIGTERM'); } catch (e) { /* best effort */ }
      finish({ ok: false, error: 'timed_out after ' + Math.round(timeoutMs / 1000) + 's', sessionId: threadId });
    }, timeoutMs);

    child.stdin.end(prompt);
  });
}

module.exports = { runCodex: runCodex };
