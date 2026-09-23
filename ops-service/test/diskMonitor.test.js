'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const diskMonitorService = require('../src/diskMonitorService');

test('disk monitor emails once per crossed threshold and rearms after recovery', async function () {
  const db = new Database(':memory:');
  const sent = [];
  let percent = 51;
  const monitor = diskMonitorService.setup(db, {
    autoStart: false,
    warningPercent: 80,
    criticalPercent: 90,
    recipient: 'harvey@example.com',
    measure: function () {
      return { path: '/', totalBytes: 1000, usedBytes: percent * 10, availableBytes: (100 - percent) * 10, percentUsed: percent };
    },
    sendMail: async function (message) { sent.push(message); return { id: 'sent-' + sent.length }; }
  });

  assert.equal((await monitor.check()).level, 'normal');
  assert.equal(sent.length, 0);
  percent = 82;
  assert.equal((await monitor.check()).alerted, true);
  assert.match(sent[0].subject, /82%/);
  percent = 87;
  assert.equal((await monitor.check()).alerted, false);
  assert.equal(sent.length, 1);
  percent = 92;
  assert.equal((await monitor.check()).alerted, true);
  assert.match(sent[1].subject, /^URGENT:/);
  percent = 91;
  assert.equal((await monitor.check()).alerted, false);
  percent = 72;
  assert.equal((await monitor.check()).level, 'normal');
  percent = 81;
  assert.equal((await monitor.check()).alerted, true);
  assert.equal(sent.length, 3);
  assert.equal(monitor.status().state.level, 'warning');
  monitor.close();
  db.close();
});

test('filesystem measurement returns coherent capacity values', function () {
  const metrics = diskMonitorService.measureFilesystem('/');
  assert.ok(metrics.totalBytes > 0);
  assert.ok(metrics.usedBytes > 0);
  assert.ok(metrics.availableBytes > 0);
  assert.ok(metrics.percentUsed > 0 && metrics.percentUsed < 100);
});
