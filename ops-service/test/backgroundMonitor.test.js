'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/backgroundMonitorService');

function request() {
  return {
    kind: 'github_release_asset', title: 'Wait for manuscript PDF', agent: 'codex',
    continuationPrompt: 'Download the PDF and continue the reader conversion.',
    config: { owner: 'harveymeale9', repo: 'RealityManual', tag: 'source', asset: 'interior.pdf' },
    intervalSeconds: 15, minWeeklyRemaining: 15
  };
}

test('monitor wakes the agent exactly once when an asset becomes ready', async function () {
  const db = new Database(':memory:');
  let ready = false;
  const queued = [];
  const monitor = service.setup(db, {
    autoStart: false,
    fetch: async function () { return { ok: true, json: async function () { return { assets: ready ? [{ id: 7, name: 'interior.pdf', state: 'uploaded', size: 99, browser_download_url: 'https://example.test/file' }] : [] }; } }; },
    getUsage: async function () { return { providers: [{ provider: 'codex', available: true, limits: [{ kind: 'weekly', remainingPercentage: 62 }] }] }; },
    enqueueContinuation: async function (item) { queued.push(item); return 'message-1'; }
  });
  const row = monitor.register(request());
  assert.equal((await monitor.checkRow(row)).status, 'watching');
  ready = true;
  assert.equal((await monitor.checkRow(db.prepare('SELECT * FROM background_monitors WHERE id=?').get(row.id))).status, 'triggered');
  assert.equal(queued.length, 1);
  assert.match(queued[0].prompt, /reader conversion/);
  assert.equal(db.prepare('SELECT status FROM background_monitors WHERE id=?').get(row.id).status, 'triggered');
  monitor.close(); db.close();
});

test('ready monitor pauses below its weekly credit floor and resumes later', async function () {
  const db = new Database(':memory:');
  let remaining = 8;
  const queued = [];
  const monitor = service.setup(db, {
    autoStart: false,
    fetch: async function () { return { ok: true, json: async function () { return { assets: [{ id: 8, name: 'interior.pdf', state: 'uploaded', size: 99, browser_download_url: 'https://example.test/file' }] }; } }; },
    getUsage: async function () { return { providers: [{ provider: 'codex', available: true, limits: [{ kind: 'weekly', remainingPercentage: remaining }] }] }; },
    enqueueContinuation: async function (item) { queued.push(item); return 'message-2'; }
  });
  const row = monitor.register(request());
  assert.equal((await monitor.checkRow(row)).status, 'paused_credits');
  assert.equal(queued.length, 0);
  remaining = 35;
  assert.equal((await monitor.checkRow(db.prepare('SELECT * FROM background_monitors WHERE id=?').get(row.id))).status, 'triggered');
  assert.equal(queued.length, 1);
  monitor.close(); db.close();
});
