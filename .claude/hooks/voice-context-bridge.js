#!/usr/bin/env node
// UserPromptSubmit hook: whenever Harvey talks to Claude Code through the
// separate voice/chat app (ops.realitymanual.com/voice.html or
// voice-mobile.html) — a different, headless Claude Code session entirely —
// this surfaces a summary of anything new since the last time an
// interactive session on this VPS checked, so "yo I'm back" here already
// has context from the phone conversation. Reads the ops-service SQLite DB
// directly (read-only); never blocks or errors the user's actual prompt.
//
// Only works from a session that can reach /root/ops-service-data (root
// today; see CLAUDE.md section 74/75 for the pending non-root VPS user
// switch — once that lands, this path needs the same scoped access grant).
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/root/ops-service-data/db.sqlite';
const CURSOR_PATH = path.join(require('os').homedir(), '.claude', 'voice-bridge-cursor.json');

function readCursor() {
  try {
    return JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8')).lastSeen || '1970-01-01T00:00:00.000Z';
  } catch (e) {
    return '1970-01-01T00:00:00.000Z';
  }
}

function main() {
  if (!fs.existsSync(DB_PATH)) return;
  const lastSeen = readCursor();
  let rows;
  try {
    const query =
      'SELECT mode, transcript, status, reply_text, error_message, created_at ' +
      'FROM voice_messages WHERE created_at > ? AND status IN (\'done\',\'error\') ' +
      'ORDER BY created_at ASC LIMIT 20;';
    const out = execFileSync('sqlite3', ['-json', DB_PATH, query.replace('?', "'" + lastSeen.replace(/'/g, "''") + "'")], { encoding: 'utf8' });
    rows = out.trim() ? JSON.parse(out) : [];
  } catch (e) {
    return; // never block the user's prompt over this
  }
  if (!rows.length) return;

  fs.mkdirSync(path.dirname(CURSOR_PATH), { recursive: true });
  fs.writeFileSync(CURSOR_PATH, JSON.stringify({ lastSeen: rows[rows.length - 1].created_at }));

  const lines = rows.map(function (r) {
    let line = '- (' + r.mode + ', ' + r.status + ') Harvey via voice/chat app: "' + r.transcript + '"';
    if (r.reply_text) line += ' — you replied: "' + r.reply_text + '"';
    if (r.error_message) line += ' — it errored: ' + r.error_message;
    return line;
  });

  const context =
    'Since your last exchange in this session, Harvey talked to you through the separate ' +
    'voice/chat app (phone or desktop) — a different headless Claude Code session handled ' +
    'those, not this one, but you should be aware of them and can refer back naturally:\n' +
    lines.join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context }
  }));
}

main();
