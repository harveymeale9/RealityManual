#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function value(name) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : null;
}
if (process.argv.indexOf('--help') !== -1) {
  process.stdout.write('Usage: register-monitor.js --kind KIND --title TITLE --agent codex|claude --continuation PROMPT --config JSON [--interval 60] [--min-weekly 15] [--expires ISO]\n');
  process.exit(0);
}
const request = {
  id: crypto.randomUUID(), kind: value('kind'), title: value('title'),
  agent: value('agent') || 'codex', continuationPrompt: value('continuation'),
  config: JSON.parse(value('config') || '{}'),
  intervalSeconds: Number(value('interval') || 60),
  minWeeklyRemaining: Number(value('min-weekly') || 15),
  expiresAt: value('expires') || new Date(Date.now() + 7 * 86400000).toISOString()
};
const directory = process.env.RM_MONITOR_REQUEST_DIR || '/root/ops-service-data/monitor-requests';
fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, request.id + '.json');
const temporary = destination + '.tmp';
fs.writeFileSync(temporary, JSON.stringify(request, null, 2));
fs.renameSync(temporary, destination);
process.stdout.write(JSON.stringify({ ok: true, id: request.id, request: destination }) + '\n');
