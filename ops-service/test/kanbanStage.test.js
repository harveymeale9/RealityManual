'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('To Film is a manual Kanban stage between completed outline and filmed', function () {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/lib/store.js'), 'utf8'), context);
  const stages = context.window.RMStore.STAGES;
  const ids = stages.map(function (stage) { return stage.id; });
  assert.equal(stages.find(function (stage) { return stage.id === 'to_film'; }).label, 'To Film');
  assert.equal(ids.indexOf('to_film'), ids.indexOf('outline_completed') + 1);
  assert.equal(ids.indexOf('uploaded'), ids.indexOf('to_film') + 1);
  assert.ok(ids.indexOf('to_film') <= ids.indexOf('uploaded'));
});
