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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = process.env.CODEX_HOST || 'ubuntu@host.docker.internal';
const HOST_BIN = process.env.CODEX_HOST_BIN || '/root/.local/bin/codex';
const HOST_REPO = process.env.CODEX_HOST_REPO || '/srv/realitymanual-repo';
const RUN_DIR = process.env.CODEX_RUN_DIR || '/data/codex-runs';
const HOST_RUN_DIR = process.env.CODEX_HOST_RUN_DIR || '/root/ops-service-data/codex-runs';
// This is an inactivity watchdog, not a wall-clock turn limit. Long-running
// implementation turns can legitimately exceed twenty minutes while still
// emitting Codex events, so every stdout/stderr event rearms it.
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const OWNER_KEY_RE = /^[A-Za-z0-9_-]{3,80}$/;
const RUN_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

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

function stopScript(pidFile) {
  return 'if [ -s ' + shellQuote(pidFile) + ' ]; then ' +
    'old_pid=$(cat ' + shellQuote(pidFile) + ' 2>/dev/null || true); ' +
    'case "$old_pid" in (*[!0-9]*|"") old_pid="";; esac; ' +
    'if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null && ' +
    'tr "\\000" " " < "/proc/$old_pid/cmdline" 2>/dev/null | grep -F -q ' + shellQuote(HOST_BIN) + '; then ' +
    '/bin/kill -TERM -- "-$old_pid" 2>/dev/null || true; ' +
    'i=0; while [ "$i" -lt 20 ] && kill -0 "$old_pid" 2>/dev/null; do sleep 0.25; i=$((i+1)); done; ' +
    'if kill -0 "$old_pid" 2>/dev/null; then /bin/kill -KILL -- "-$old_pid" 2>/dev/null || true; fi; ' +
    'fi; rm -f ' + shellQuote(pidFile) + '; fi';
}

function runPaths(runKey) {
  if (!runKey || !RUN_KEY_RE.test(runKey)) return null;
  return {
    journal: path.join(RUN_DIR, runKey + '.jsonl'),
    stderr: path.join(RUN_DIR, runKey + '.stderr'),
    exit: path.join(RUN_DIR, runKey + '.exit'),
    hostJournal: path.posix.join(HOST_RUN_DIR, runKey + '.jsonl'),
    hostStderr: path.posix.join(HOST_RUN_DIR, runKey + '.stderr'),
    hostExit: path.posix.join(HOST_RUN_DIR, runKey + '.exit')
  };
}

function initializeRunFiles(paths) {
  if (!paths) return;
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(paths.journal, '');
  fs.writeFileSync(paths.stderr, '');
  try { fs.rmSync(paths.exit, { force: true }); } catch (e) { /* best effort */ }
}

function cleanupRun(runKey) {
  const paths = runPaths(runKey);
  if (!paths) return;
  [paths.journal, paths.stderr, paths.exit].forEach(function (file) {
    try { fs.rmSync(file, { force: true }); } catch (e) { /* best effort */ }
  });
}

function buildRemoteCommand(sessionId, imagePath, pidFile, paths) {
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
  let command = args.map(shellQuote).join(' ');
  if (paths) {
    // The JSONL journal lives in the bind-mounted host data directory, not
    // inside the disposable service container. tee keeps the existing live
    // SSH stream while also leaving enough evidence for a replacement
    // container to recover the real final reply after a deploy.
    // Keep draining into the durable files even when the old container's
    // SSH pipe disappears. Plain tee exits on EPIPE and would otherwise
    // take Codex down with the connection we are specifically surviving.
    command += ' 2> >(tee --output-error=warn-nopipe -a ' + shellQuote(paths.hostStderr) + ' >&2) | ' +
      'tee --output-error=warn-nopipe -a ' + shellQuote(paths.hostJournal) + '; ' +
      'run_code=${PIPESTATUS[0]}; exit_tmp=' + shellQuote(paths.hostExit + '.tmp.$$') + '; ' +
      'printf "%s\\n" "$run_code" > "$exit_tmp"; mv "$exit_tmp" ' + shellQuote(paths.hostExit) + '; exit "$run_code"';
  }
  const runScript = 'echo $$ > ' + shellQuote(pidFile) + '; ' +
    'trap ' + shellQuote('rm -f ' + shellQuote(pidFile)) + ' EXIT; ' + command;
  const supervised = stopScript(pidFile) + '; exec setsid --wait bash -c ' + shellQuote(runScript);
  return 'cd ' + shellQuote(HOST_REPO) + ' && sudo -H sh -c ' + shellQuote(supervised);
}

function stopRemoteRun(pidFile) {
  return new Promise(function (resolve) {
    const command = 'sudo -H sh -c ' + shellQuote(stopScript(pidFile));
    const cleanup = spawn('ssh', ['-o', 'LogLevel=ERROR', HOST, command], { stdio: 'ignore' });
    const fallback = setTimeout(function () { try { cleanup.kill('SIGKILL'); } catch (e) { /* best effort */ } }, 15000);
    cleanup.on('error', function () { clearTimeout(fallback); resolve(); });
    cleanup.on('close', function () { clearTimeout(fallback); resolve(); });
  });
}

function runCodex(opts) {
  opts = opts || {};
  const prompt = String(opts.prompt || '');
  const sessionId = opts.sessionId && SESSION_ID_RE.test(opts.sessionId) ? opts.sessionId : null;
  const imagePath = opts.imagePath ? String(opts.imagePath) : null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const runId = crypto.randomBytes(12).toString('hex');
  const ownerKey = opts.ownerKey && OWNER_KEY_RE.test(opts.ownerKey) ? opts.ownerKey : runId;
  const pidFile = '/tmp/rm-codex-' + ownerKey + '.pid';
  const runKey = opts.runKey && RUN_KEY_RE.test(opts.runKey) ? opts.runKey : null;
  const paths = runPaths(runKey);
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function () {};
  const onEarlyAck = typeof opts.onEarlyAck === 'function' ? opts.onEarlyAck : function () {};

  return new Promise(function (resolve) {
    initializeRunFiles(paths);
    onActivity('\u25cf Starting Codex on the VPS');
    const child = spawn('ssh', ['-o', 'LogLevel=ERROR', HOST, buildRemoteCommand(sessionId, imagePath, pidFile, paths)], {
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
    let timeoutTriggered = false;
    let timeout = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    function armWatchdog() {
      if (settled) return;
      clearTimeout(timeout);
      timeout = setTimeout(function () {
        timeoutTriggered = true;
        onActivity('\u2715 Codex produced no activity for ' + Math.round(timeoutMs / 60000) + ' minutes; stopping its host process cleanly');
        stopRemoteRun(pidFile).then(function () {
          try { child.kill('SIGTERM'); } catch (e) { /* best effort */ }
          finish({ ok: false, error: 'Codex stopped after ' + Math.round(timeoutMs / 60000) + ' minutes without activity', sessionId: threadId });
        });
      }, timeoutMs);
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
      armWatchdog();
      stdoutBuffer += chunk;
      consumeLines(false);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function (chunk) { armWatchdog(); stderr += chunk; });
    child.on('error', function (err) {
      finish({ ok: false, error: 'codex_start_failed: ' + err.message, sessionId: threadId });
    });
    child.on('close', function (code) {
      if (timeoutTriggered) return;
      consumeLines(true);
      if (code === 0 && finalText) {
        finish({ ok: true, replyText: finalText, sessionId: threadId });
        return;
      }
      const detail = streamError || shortText(stderr, 2000) || ('Codex exited with code ' + code);
      finish({ ok: false, error: detail, sessionId: threadId });
    });

    armWatchdog();
    child.stdin.end(prompt);
  });
}

function parseRunJournal(paths) {
  let threadId = null;
  let finalText = '';
  let streamError = '';
  let earlyAck = '';
  try {
    fs.readFileSync(paths.journal, 'utf8').split('\n').forEach(function (line) {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch (e) { return; }
      if (evt.type === 'thread.started' && evt.thread_id) threadId = evt.thread_id;
      if (evt.type === 'error' || evt.type === 'turn.failed') streamError = errorText(evt) || streamError || evt.type;
      if ((evt.type === 'item.started' || evt.type === 'item.completed') && evt.item &&
          evt.item.type === 'agent_message' && evt.type === 'item.completed') {
        const message = String(evt.item.text || '').trim();
        if (message) {
          if (!earlyAck) earlyAck = message;
          finalText = message;
        }
      }
    });
  } catch (e) { /* caller handles a missing/incomplete journal */ }
  return { threadId: threadId, finalText: finalText, streamError: streamError, earlyAck: earlyAck };
}

function hasRecoverableRun(runKey) {
  const paths = runPaths(runKey);
  return Boolean(paths && (fs.existsSync(paths.journal) || fs.existsSync(paths.exit)));
}

// A Codex process runs on the VPS, outside this container. When a backend
// deploy replaces the container, this watcher takes over the durable JSONL
// journal created above and resolves to the same result shape as runCodex.
function recoverCodexRun(opts) {
  opts = opts || {};
  const runKey = opts.runKey && RUN_KEY_RE.test(opts.runKey) ? opts.runKey : null;
  const paths = runPaths(runKey);
  const pollIntervalMs = opts.pollIntervalMs || 1000;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function () {};
  const onEarlyAck = typeof opts.onEarlyAck === 'function' ? opts.onEarlyAck : function () {};
  if (!paths || !hasRecoverableRun(runKey)) return Promise.resolve(null);

  return new Promise(function (resolve) {
    const startedAt = Date.now();
    let announcedAck = false;
    onActivity('\u21bb Service restarted; reconnected to the Codex task running on the VPS');

    function inspect() {
      const parsed = parseRunJournal(paths);
      if (!announcedAck && parsed.earlyAck) {
        announcedAck = true;
        onEarlyAck(parsed.earlyAck);
      }
      if (fs.existsSync(paths.exit)) {
        let code = 1;
        try { code = parseInt(fs.readFileSync(paths.exit, 'utf8').trim(), 10); } catch (e) { /* failure result below */ }
        if (code === 0 && parsed.finalText) {
          onActivity('\u2713 Recovered Codex turn completed');
          resolve({ ok: true, replyText: parsed.finalText, sessionId: parsed.threadId });
          return;
        }
        let stderr = '';
        try { stderr = shortText(fs.readFileSync(paths.stderr, 'utf8'), 2000); } catch (e) { /* optional */ }
        resolve({
          ok: false,
          error: parsed.streamError || stderr || ('Recovered Codex process exited with code ' + code),
          sessionId: parsed.threadId
        });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve({ ok: false, error: 'Could not recover a completion from Codex before the recovery timeout', sessionId: parsed.threadId });
        return;
      }
      setTimeout(inspect, pollIntervalMs);
    }
    inspect();
  });
}

module.exports = {
  runCodex: runCodex,
  recoverCodexRun: recoverCodexRun,
  hasRecoverableRun: hasRecoverableRun,
  cleanupRun: cleanupRun
};
