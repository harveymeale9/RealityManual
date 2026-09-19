// Invokes the real Claude Code agent for the voice app — not a separate chat
// API, an actual Claude Code session with full tool access to
// realitymanual-repo. Previously this spawned a brand-new `claude -p --resume
// <id>` process on every single voice message: every message paid a full CLI
// cold-start (reloading CLAUDE.md, skills, hooks, MCP servers) before any
// model work even began, which is most of what made the Project Manager tab
// feel slow. This version keeps ONE Claude Agent SDK session alive across
// many messages (the SDK's documented "streaming input mode" — an
// AsyncIterable prompt fed by a push queue keeps a single underlying process
// running indefinitely) and just pushes each new voice message into it, so
// only the very first message after a (re)start pays the cold-start cost.
//
// Auth is unchanged: this still runs as the non-root `node` user with
// CLAUDE_CODE_OAUTH_TOKEN in the environment (see CLAUDE.md section 74), and
// the SDK is pointed at the same pinned `claude` CLI binary the Dockerfile
// already installs (via pathToClaudeCodeExecutable) rather than whatever
// binary the SDK package would otherwise bundle, so this is the exact same
// auth path that was already proven working, just invoked differently.
'use strict';
const { query } = require('@anthropic-ai/claude-agent-sdk');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CLAUDE_REPO_DIR = process.env.CLAUDE_REPO_DIR || '/root/realitymanual-repo';
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

const CLAUDE_BIN_PATH = (function resolveClaudeBin() {
  try {
    return execFileSync('which', [process.env.CLAUDE_BIN || 'claude']).toString().trim() || undefined;
  } catch (e) {
    // Fall back to the SDK's own bundled binary rather than fail startup.
    return undefined;
  }
})();

// Turns one SDK message into short, human-readable activity line(s) for the
// Project Manager tab's live "what CC is doing" pane — a glance at tool
// calls and intermediate thinking, never the final reply text (that's the
// clean left-column result, owned exclusively by the `result` message).
function describeEvent(evt) {
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

function describeErr(err) {
  return (err && err.message) || String(err);
}

// A push queue exposed as an async generator: query()'s streaming-input mode
// reads this continuously, and it simply waits (without ending the session)
// whenever nothing new has been pushed yet — this is what lets one session
// span many HTTP requests instead of one process per request.
function createMessageQueue() {
  const buffer = [];
  let waiter = null;
  function push(msg) {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(msg);
    } else {
      buffer.push(msg);
    }
  }
  async function* generator() {
    for (;;) {
      if (buffer.length) {
        yield buffer.shift();
        continue;
      }
      yield await new Promise(function (resolve) { waiter = resolve; });
    }
  }
  return { push: push, generator: generator() };
}

let currentSession = null;

// Resolves any turns still waiting on this session once it dies (crash,
// unexpected end, or a failed resume at startup) so a caller never hangs
// past its own per-turn timeout.
function failAllPending(sess, err) {
  const message = 'session_broken: ' + describeErr(err);
  sess.pending.forEach(function (turn) { turn.resolve({ ok: false, error: message }); });
  sess.pending.clear();
}

function handleEvent(sess, evt) {
  if (evt.type === 'system' && evt.subtype === 'init') {
    sess.sessionId = evt.session_id;
    return;
  }
  if (evt.type === 'result') {
    // Only one turn is ever in flight at a time (server.js's voiceQueue
    // serializes messages), so the sole pending entry is always this
    // result's turn — user_message_uuid is read first where present as the
    // documented join key, with that single-entry fallback covering older
    // producers that omit it.
    const turn = (evt.user_message_uuid && sess.pending.get(evt.user_message_uuid)) ||
      sess.pending.values().next().value;
    if (!turn) return;
    sess.pending.delete(turn.uuid);
    if (evt.is_error) {
      const detail = evt.result ||
        (Array.isArray(evt.errors) && evt.errors.join('; ')) ||
        (evt.subtype || 'error');
      turn.resolve({ ok: false, error: String(detail), sessionId: evt.session_id });
    } else {
      turn.resolve({ ok: true, replyText: evt.result || '', sessionId: evt.session_id });
    }
    return;
  }
  // Early ack: the first non-empty plain-text block a turn emits, before
  // the final `result` — Claude Code's own convention is to say in one
  // sentence what it's about to do before acting (see the top-level
  // system instructions), which doubles as a genuine, contextual
  // "I understood you and here's my plan" the voice app can speak
  // immediately, instead of a hardcoded filler phrase (Harvey flagged
  // that filler as unacceptable — see VOICE_SYSTEM_PROMPT). Fired once
  // per turn only; later text blocks are left for the final reply.
  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content) && sess.pending.size) {
    const turn = sess.pending.values().next().value;
    if (turn && !turn.earlyAckSent) {
      const textBlock = evt.message.content.filter(function (b) { return b.type === 'text' && b.text && b.text.trim(); })[0];
      if (textBlock) {
        turn.earlyAckSent = true;
        turn.onEarlyAck(textBlock.text.trim());
      }
    }
  }
  const lines = describeEvent(evt);
  if (lines && sess.pending.size) {
    const turn = sess.pending.values().next().value;
    lines.forEach(turn.onActivity);
  }
}

function createSession(resumeId, appendSystemPrompt) {
  const queue = createMessageQueue();
  const iterator = query({
    prompt: queue.generator,
    options: {
      cwd: CLAUDE_REPO_DIR,
      resume: resumeId || undefined,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: CLAUDE_BIN_PATH,
      systemPrompt: appendSystemPrompt
        ? { type: 'preset', preset: 'claude_code', append: appendSystemPrompt, snapshot: true }
        : undefined
    }
  });

  const sess = {
    push: queue.push,
    iterator: iterator,
    pending: new Map(),
    broken: false,
    sessionId: resumeId || null
  };

  let readySettled = false;
  let readyResolve, readyReject;
  sess.ready = new Promise(function (resolve, reject) { readyResolve = resolve; readyReject = reject; });

  (async function pump() {
    try {
      for await (const evt of iterator) {
        if (!readySettled && evt.type === 'system' && evt.subtype === 'init') {
          readySettled = true;
          readyResolve();
        }
        handleEvent(sess, evt);
      }
      throw new Error('session_ended_unexpectedly');
    } catch (err) {
      sess.broken = true;
      if (!readySettled) { readySettled = true; readyReject(err); }
      failAllPending(sess, err);
    } finally {
      if (currentSession === sess) currentSession = null;
    }
  })();

  return sess;
}

// Returns the live session, starting one (resuming `resumeId` if given) if
// none is currently alive.
//
// Deliberately does NOT await `sess.ready` here — that used to be a
// deadlock: the underlying CLI process (in streaming-input mode) doesn't
// emit its own system/init event until it has received the *first* pushed
// message, but that first message is only ever pushed from inside
// `runTurn()`, which callers only reach after `ensureSession()` returns.
// Awaiting readiness before returning meant nothing could ever become
// ready — every single turn hung forever, resumed session or brand new one
// (confirmed directly against the real deployed service, not just reasoned
// about). A dead/unresolvable `resumeId` (e.g. the CLI's local session
// store got wiped) still self-heals: `createSession`'s pump() rejects the
// pending turn via `failAllPending` once the underlying process actually
// errors out, and its `finally` clears `currentSession`, so the turn after
// a bad resume gets a fresh session automatically — just one turn later
// than the old (broken) fail-fast attempt aimed for, not silently within
// the same turn.
async function ensureSession(resumeId, appendSystemPrompt) {
  if (currentSession && !currentSession.broken) return currentSession;
  const sess = createSession(resumeId, appendSystemPrompt);
  currentSession = sess;
  return sess;
}

// A plain string when there's no attachment (unchanged from before), or an
// Anthropic Messages API content-block array — [text, image] — when the
// voice app forwarded a pasted/dropped/attached image alongside the text.
function buildMessageContent(prompt, imageBlock) {
  if (!imageBlock) return prompt;
  return [
    { type: 'text', text: prompt },
    { type: 'image', source: { type: 'base64', media_type: imageBlock.mediaType, data: imageBlock.base64 } }
  ];
}

function runTurn(sess, prompt, timeoutMs, onActivity, imageBlock, onEarlyAck) {
  const uuid = crypto.randomUUID();
  return new Promise(function (resolvePromise) {
    let settled = false;
    const timeoutHandle = setTimeout(function () {
      if (settled) return;
      settled = true;
      sess.pending.delete(uuid);
      if (typeof sess.iterator.interrupt === 'function') {
        sess.iterator.interrupt().catch(function () {});
      }
      resolvePromise({ ok: false, error: 'timed_out after ' + Math.round(timeoutMs / 1000) + 's' });
    }, timeoutMs);

    sess.pending.set(uuid, {
      uuid: uuid,
      onActivity: onActivity,
      onEarlyAck: onEarlyAck || function () {},
      earlyAckSent: false,
      resolve: function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolvePromise(result);
      }
    });

    sess.push({
      type: 'user',
      message: { role: 'user', content: buildMessageContent(prompt, imageBlock) },
      parent_tool_use_id: null,
      uuid: uuid
    });
  });
}

async function runClaude(opts) {
  const prompt = opts.prompt;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : function () {};
  const onEarlyAck = typeof opts.onEarlyAck === 'function' ? opts.onEarlyAck : function () {};
  const appendSystemPrompt = opts.appendSystemPrompt;

  // ensureSession() itself no longer rejects in the normal case (see its
  // comment) — this only guards a synchronous throw from query() setup
  // (e.g. a bad executable path), which a bad resumeId is not.
  let sess;
  try {
    sess = await ensureSession(opts.sessionId, appendSystemPrompt);
  } catch (err) {
    try {
      sess = await ensureSession(null, appendSystemPrompt);
    } catch (err2) {
      return { ok: false, error: 'session_start_failed: ' + describeErr(err2) };
    }
  }

  return runTurn(sess, prompt, timeoutMs, onActivity, opts.imageBlock, onEarlyAck);
}

// Tears down the live in-process session (if any) so the next runClaude()
// call starts genuinely fresh. This matters because currentSession is a
// module-level singleton that outlives any single HTTP request — clearing
// the DB's stored claude_session_id (server.js's /api/voice/session/reset)
// on its own does nothing to a session that's already alive in this
// process's memory; ensureSession() checks the live singleton before it
// ever looks at a passed-in resumeId. Found via a real test: resetting the
// session and immediately resending the same prompt still produced the
// old (pre-fix) reply, because the live session never actually changed.
function resetSession() {
  if (currentSession) {
    try {
      if (typeof currentSession.iterator.interrupt === 'function') {
        currentSession.iterator.interrupt().catch(function () {});
      }
    } catch (e) { /* best-effort teardown only */ }
    currentSession = null;
  }
}

// A completely separate, single-turn Claude Code invocation — no resume,
// no queue, never touches `currentSession` above. Used by the video
// uploader's title/outline-matching step (see server.js's analyzeVideo):
// a one-shot structured task ("here's a transcript and some candidate
// outlines, pick the best match and extract titles"), not a conversation,
// so it's deliberately kept off the voice app's shared persistent session
// — mixing that in would pollute Harvey's actual Project Manager chat
// history with unrelated video-analysis turns. Safe to run concurrently
// with the voice app or with other one-shot calls: each is its own
// independent `query()` call/process, nothing shared between them.
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
    setTimeout(function () { reject(new Error('one-shot Claude call timed out')); }, timeoutMs || 120000);
  });
  return Promise.race([consume, timeout]);
}

module.exports = { runClaude, resetSession, runOneShot };
