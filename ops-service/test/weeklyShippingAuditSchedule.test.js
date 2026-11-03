'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const scheduleService = require('../src/weeklyShippingAuditSchedule');

test('weekly shipping audit schedules one durable Monday window at a time', function () {
  const db = new Database(':memory:');
  const seen = new Map();
  const monitor = { register: function (item) { seen.set(item.id, item); } };
  let clock = Date.parse('2026-11-03T00:00:00.000Z');
  const schedule = scheduleService.setup(db, monitor, { now: function () { return clock; }, autoStart: false });
  assert.equal(seen.size, 1);
  const first = [...seen.values()][0];
  assert.equal(first.config.at, '2026-11-09T09:00:00.000Z');
  assert.match(first.continuationPrompt, /2026-11-02T09:00:00\.000Z \(inclusive\) to 2026-11-09T09:00:00\.000Z/);
  assert.match(first.continuationPrompt, /owner email/);
  assert.match(first.continuationPrompt, /Never silently change past customer charges/);
  assert.equal(schedule.schedule(), 0);
  clock = Date.parse('2026-11-10T00:00:00.000Z');
  assert.equal(schedule.schedule(), 1);
  assert.equal(seen.size, 2);
  assert.ok([...seen.values()].some(function (item) { return item.config.at === '2026-11-16T09:00:00.000Z'; }));
  schedule.close();
  scheduleService.setup(db, monitor, { now: function () { return clock; }, autoStart: false }).close();
  assert.equal(seen.size, 2);
  db.close();
});
