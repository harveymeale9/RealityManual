// Two independent things live in this file:
//
// 1. The Project Manager's voice-turn runner (runClaude / recoverClaudeRun /
//    hasRecoverableRun / cleanupRun / resetSession). This used to keep one
//    long-lived Agent SDK session alive *inside this container* across many
//    voice messages, specifically to avoid paying a full CLI cold start on
//    every message. That process died the instant the container did, so a
//    backend deploy mid-turn always bounced to the conservative "completion
//    status unknown" error — the same gap Codex had until CLAUDE.md's
//    §174/§175. Harvey asked for Claude to get the same real recovery Codex
//    got, and explicitly chose the simple option even knowing it reintroduces
//    the per-message cold start: this now mirrors codexRunner.js exactly —
//    the real `claude` CLI runs on the VPS host over SSH (one process per
//    turn, not persistent), tee'd into a durable JSONL journal on the
//    bind-mounted host data directory, so a replacement container can
//    reconnect after a redeploy and report the real final reply instead of
//    guessing. `--dangerously-skip-permissions`-family flags are refused
//    outright under EUID 0 (see the Dockerfile's own comment on this), so —
//    unlike Codex, which escalates to root via sudo on the host — this runs
//    as the host's non-root `ubuntu` user directly, no sudo.
//
// 2. runOneShot(): a completely separate, in-process Agent SDK call used by
//    the video uploader's title/outline-matching step (see server.js's
//    analyzeVideo) — untouched by the above, still runs inside this
//    container on a one-shot basis, doesn't need host-survival semantics.
'use strict';
const { query } = require('@anthropic-ai/claude-agent-sdk');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLAUDE_REPO_DIR = process.env.CLAUDE_REPO_DIR || '/root/realitymanual-repo';
const ONE_SHOT_TIMEOUT_MS = 20 * 60 * 1000;

const CLAUDE_BIN_PATH = (function resolveClaudeBin() {
  try {
    return execFileSync('which', [process.env.CLAUDE_BIN || 'claude']).toString().trim() || undefined;
  } catch (e) {
    // Fall back to the SDK's own bundled binary rather than fail startup.
    return undefined;
  }
})();

// ---------------------------------------------------------------------------
// Host-side voice-turn runner (mirrors codexRunner.js)
// ---------------------------------------------------------------------------

const HOST = process.env.CLAUDE_HOST || 'ubuntu@host.docker.internal';
const HOST_BIN = process.env.CLAUDE_HOST_BIN || '/usr/bin/claude';
// Matches CODEX_HOST_REPO's real path (/srv/realitymanual-repo) via a `/repo`
// symlink on the host — not just cosmetic: Claude Code's session store keys
// conversations by cwd, and the in-container runs this replaces always used
// cwd `/repo` (see CLAUDE_REPO_DIR below, and CLAUDE.md section 74), so a
// `claude_session_id` already saved in the `voice_session` DB table only
// keeps resuming correctly if the host-side process's cwd string matches
// exactly.
const HOST_REPO = process.env.CLAUDE_HOST_REPO || '/repo';
// A dedicated $HOME for this one command — deliberately NOT the host
// `ubuntu` user's own real ~/.claude. That's Harvey's personal interactive
// Claude Code identity/session history on this VPS; mixing Project Manager
// voice turns into it (or vice versa) would corrupt both. `.claude` and
// `.claude.json` under this directory are symlinks onto the exact same
// files already bind-mounted into the container at /home/node/.claude and
// /home/node/.claude.json (see deploy.sh's RUN_ARGS) — so this is the same
// identity/session store the old in-process runs already used, and a
// `claude_session_id` saved from either path resumes correctly from the
// other.
const HOST_HOME = process.env.CLAUDE_HOST_HOME || '/root/ops-service-claude-home/host-identity';
const RUN_DIR = process.env.CLAUDE_RUN_DIR || '/data/claude-runs';
const HOST_RUN_DIR = process.env.CLAUDE_HOST_RUN_DIR || '/root/ops-service-data/claude-runs';
// Inactivity watchdog, not a wall-clock turn limit — see codexRunner.js's
// identical comment; broad tool-using turns can legitimately run long.
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

// `--output-format stream-json` emits exactly the same event shapes the
// Agent SDK's own streaming-input mode used to hand `handleEvent` in the
// old in-process implementation, so this parsing logic carries over
// unchanged — only where the events come from (a JSONL line, live or
// replayed from the durable journal) is different now.
function activityLinesForEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
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

function firstTextBlock(evt) {
  if (!evt || evt.type !== 'assistant' || !evt.message || !Array.isArray(evt.message.content)) return null;
  const block = evt.message.content.filter(function (b) { return b.type === 'text' && b.text && b.text.trim(); })[0];
  return block ? block.text.trim() : null;
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
  // RUN_DIR is a bind mount shared with the host, where the ssh'd `claude`
  // process (running as `ubuntu`) also writes. Whichever side creates it
  // first can leave it too restrictive for the other (EACCES) — see
  // codexRunner.js's identical fix, CLAUDE.md §175. Best-effort only: the
  // live run is parsed from the ssh child's own stdout below, never from
  // these files, so a permission failure here must never abort the turn.
  try {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    try { fs.chmodSync(RUN_DIR, 0o777); } catch (e) { /* may not own it; host-side chmod covers this */ }
    fs.writeFileSync(paths.journal, '');
    fs.writeFileSync(paths.stderr, '');
    fs.chmodSync(paths.journal, 0o666);
    fs.chmodSync(paths.stderr, 0o666);
  } catch (e) { /* best effort — see comment above */ }
  try { fs.rmSync(paths.exit, { force: true }); } catch (e) { /* best effort */ }
}

function cleanupRun(runKey) {
  const paths = runPaths(runKey);
  if (!paths) return;
  [paths.journal, paths.stderr, paths.exit].forEach(function (file) {
    try { fs.rmSync(file, { force: true }); } catch (e) { /* best effort */ }
  });
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

function buildRemoteCommand(sessionId, appendSystemPrompt, pidFile, paths) {
  const args = [HOST_BIN, '-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'bypassPermissions', '--allow-dangerously-skip-permissions'];
  if (sessionId) args.push('--resume', sessionId);
  if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt);
  let command = 'HOME=' + shellQuote(HOST_HOME) + ' ' + args.map(shellQuote).join(' ');
  if (paths) {
    // See codexRunner.js's identical comment: keeps draining into the
    // durable files even when the old container's SSH pipe disappears.
    const hostRunDir = path.posix.dirname(paths.hostJournal);
    command = 'mkdir -p ' + shellQuote(hostRunDir) + '; chmod 0777 ' + shellQuote(hostRunDir) + ' 2>/dev/null; ' + command;
    command += ' 2> >(tee --output-error=warn-nopipe -a ' + shellQuote(paths.hostStderr) + ' >&2) | ' +
      'tee --output-error=warn-nopipe -a ' + shellQuote(paths.hostJournal) + '; ' +
      'run_code=${PIPESTATUS[0]}; exit_tmp=' + shellQuote(paths.hostExit + '.tmp.$$') + '; ' +
      'printf "%s\\n" "$run_code" > "$exit_tmp"; mv "$exit_tmp" ' + shellQuote(paths.hostExit) + '; exit "$run_code"';
  }
  const runScript = 'echo $$ > ' + shellQuote(pidFile) + '; ' +
    'trap ' + shellQuote('rm -f ' + shellQuote(pidFile)) + ' EXIT; ' + command;
  const supervised = stopScript(pidFile) + '; exec setsid --wait bash -c ' + shellQuote(runScript);
  // No sudo/root here (unlike codexRunner's buildRemoteCommand) — the ssh
  // connection already lands as the non-root `ubuntu` user, which is
  // required for --allow-dangerously-skip-permissions to work at all.
  return 'cd ' + shellQuote(HOST_REPO) + ' && sh -c ' + shellQuote(supervised);
}

function stopRemoteRun(pidFile) {
  return new Promise(function (resolve) {
    const command = 'sh -c ' + shellQuote(stopScript(pidFile));
    const cleanup = spawn('ssh', ['-o', 'LogLevel=ERROR', HOST, command], { stdio: 'ignore' });
    const fallback = setTimeout(function () { try { cleanup.kill('SIGKILL'); } catch (e) { /* best effort */ } }, 15000);
    cleanup.on('error', function () { clearTimeout(fallback); resolve(); });
    cleanup.on('close', function () { clearTimeout(fallback); resolve(); });
  });
}

function runClaude(opts) {
  opts = opts || {};
  const prompt = String(opts.prompt || '');
  const sessionId = opts.sessionId && SESSION_ID_RE.test(opts.sessionId) ? opts.sessionId : null;
  const appendSystemPrompt = opts.appendSystemPrompt ? String(opts.appendSystemPrompt) : null;
  const imagePath = opts.imagePath ? String(opts.imagePath) : null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const runId = crypto.randomBytes(12).toString('hex');
  const ownerKey = opts.ownerKey && OWNER_KEY_RE.test(opts.ownerKey) ? opts.ownerKey : runId;
  const pidFile = '/tmp/rm-claude-' + ownerKey + '.pid';
  const runKey = opts.runKey && RUN_KEY_RE.test(opts.runKey) ? opts.runKey : null;
  const paths = runPaths(runKey);
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function () {};
  const onEarlyAck = typeof opts.onEarlyAck === 'function' ? opts.onEarlyAck : function () {};
  // The host CLI has no one-shot image-attachment flag (unlike Codex's
  // `-i <path>`) — the simplest robust option is pointing the agent's own
  // Read tool (which already supports images) at a host-reachable path
  // instead of inlining base64 into the prompt.
  const fullPrompt = imagePath
    ? prompt + '\n\n[An image was attached to this message. Use your Read tool on this exact path to view it: ' + imagePath + ']'
    : prompt;

  return new Promise(function (resolve) {
    initializeRunFiles(paths);
    onActivity('● Starting Claude on the VPS');
    const child = spawn('ssh', ['-o', 'LogLevel=ERROR', HOST, buildRemoteCommand(sessionId, appendSystemPrompt, pidFile, paths)], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdoutBuffer = '';
    let stderr = '';
    let sessionOut = sessionId;
    let finalText = '';
    let earlyAckSent = false;
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
        onActivity('✕ Claude produced no activity for ' + Math.round(timeoutMs / 60000) + ' minutes; stopping its host process cleanly');
        stopRemoteRun(pidFile).then(function () {
          try { child.kill('SIGTERM'); } catch (e) { /* best effort */ }
          finish({ ok: false, error: 'Claude stopped after ' + Math.round(timeoutMs / 60000) + ' minutes without activity', sessionId: sessionOut });
        });
      }, timeoutMs);
    }

    function handleEvent(evt) {
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
        sessionOut = evt.session_id;
        onActivity('● Claude session ready');
      }
      if (evt.type === 'result') {
        if (evt.session_id) sessionOut = evt.session_id;
        if (evt.is_error) {
          streamError = String(evt.result || (Array.isArray(evt.errors) && evt.errors.join('; ')) || evt.subtype || 'error');
        } else {
          finalText = String(evt.result || '').trim();
        }
        return;
      }
      if (!earlyAckSent) {
        const text = firstTextBlock(evt);
        if (text) {
          earlyAckSent = true;
          onEarlyAck(text);
        }
      }
      const lines = activityLinesForEvent(evt);
      if (lines) lines.forEach(onActivity);
    }

    function consumeLines(final) {
      const lines = stdoutBuffer.split('\n');
      const tail = lines.pop();
      stdoutBuffer = final ? '' : tail;
      lines.forEach(function (line) {
        if (!line.trim()) return;
        try { handleEvent(JSON.parse(line)); } catch (e) { onActivity('→ ' + shortText(line, 300)); }
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
      finish({ ok: false, error: 'claude_start_failed: ' + err.message, sessionId: sessionOut });
    });
    child.on('close', function (code) {
      if (timeoutTriggered) return;
      consumeLines(true);
      if (code === 0 && finalText) {
        finish({ ok: true, replyText: finalText, sessionId: sessionOut });
        return;
      }
      const detail = streamError || shortText(stderr, 2000) || ('Claude exited with code ' + code);
      finish({ ok: false, error: detail, sessionId: sessionOut });
    });

    armWatchdog();
    child.stdin.end(fullPrompt);
  });
}

function parseRunJournal(paths) {
  let sessionOut = null;
  let finalText = '';
  let streamError = '';
  let earlyAck = '';
  try {
    fs.readFileSync(paths.journal, 'utf8').split('\n').forEach(function (line) {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch (e) { return; }
      if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) sessionOut = evt.session_id;
      if (evt.type === 'result') {
        if (evt.session_id) sessionOut = evt.session_id;
        if (evt.is_error) {
          streamError = String(evt.result || (Array.isArray(evt.errors) && evt.errors.join('; ')) || evt.subtype || 'error');
        } else {
          finalText = String(evt.result || '').trim();
        }
        return;
      }
      if (!earlyAck) {
        const text = firstTextBlock(evt);
        if (text) earlyAck = text;
      }
    });
  } catch (e) { /* caller handles a missing/incomplete journal */ }
  return { sessionId: sessionOut, finalText: finalText, streamError: streamError, earlyAck: earlyAck };
}

function hasRecoverableRun(runKey) {
  const paths = runPaths(runKey);
  return Boolean(paths && (fs.existsSync(paths.journal) || fs.existsSync(paths.exit)));
}

// A Claude process runs on the VPS, outside this container. When a backend
// deploy replaces the container, this watcher takes over the durable JSONL
// journal created above and resolves to the same result shape as runClaude.
function recoverClaudeRun(opts) {
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
    onActivity('↻ Service restarted; reconnected to the Claude task running on the VPS');

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
          onActivity('✓ Recovered Claude turn completed');
          resolve({ ok: true, replyText: parsed.finalText, sessionId: parsed.sessionId });
          return;
        }
        let stderrText = '';
        try { stderrText = shortText(fs.readFileSync(paths.stderr, 'utf8'), 2000); } catch (e) { /* optional */ }
        resolve({
          ok: false,
          error: parsed.streamError || stderrText || ('Recovered Claude process exited with code ' + code),
          sessionId: parsed.sessionId
        });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve({ ok: false, error: 'Could not recover a completion from Claude before the recovery timeout', sessionId: parsed.sessionId });
        return;
      }
      setTimeout(inspect, pollIntervalMs);
    }
    inspect();
  });
}

// There is no more in-process singleton session to tear down — every
// runClaude() call is already its own fresh host process. Kept as a no-op
// export so callers that drop a stale `claude_session_id` (a dead/wiped
// session on the host) don't need their own special-casing; the DB-level
// reset (clearing voice_session.claude_session_id) is what actually matters.
function resetSession() {}

// ---------------------------------------------------------------------------
// One-shot in-process helper (unrelated to the voice-turn runner above)
// ---------------------------------------------------------------------------

// A completely separate, single-turn Claude Code invocation — no resume,
// no queue, never touches the voice app's turns above. Used by the video
// uploader's title/outline-matching step (see server.js's analyzeVideo):
// a one-shot structured task ("here's a transcript and some candidate
// outlines, pick the best match and extract titles"), not a conversation,
// so it's deliberately kept off the voice app's shared thread — mixing
// that in would pollute Harvey's actual Project Manager chat history with
// unrelated video-analysis turns. Safe to run concurrently with voice
// turns or other one-shot calls: each is its own independent `query()`
// call/process, nothing shared between them.
async function runOneShot(prompt, timeoutMs) {
  const iterator = query({
    prompt: prompt,
    options: {
      cwd: CLAUDE_REPO_DIR,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: CLAUDE_BIN_PATH
    }
  });
  const consume = (async function () {
    for await (const evt of iterator) {
      if (evt.type === 'result') return evt.result;
    }
    throw new Error('claude ended without a result');
  })();
  const timeout = new Promise(function (resolve, reject) {
    setTimeout(function () { reject(new Error('one-shot Claude call timed out')); }, timeoutMs || ONE_SHOT_TIMEOUT_MS);
  });
  return Promise.race([consume, timeout]);
}

module.exports = {
  runClaude: runClaude,
  recoverClaudeRun: recoverClaudeRun,
  hasRecoverableRun: hasRecoverableRun,
  cleanupRun: cleanupRun,
  resetSession: resetSession,
  runOneShot: runOneShot
};
