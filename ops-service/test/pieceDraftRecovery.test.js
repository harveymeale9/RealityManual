'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function draftHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('  var pieces = {};');
  const end = source.indexOf("  window.addEventListener('rm-store-conflict'", start);
  assert.ok(start >= 0 && end > start);
  const values = new Map();
  const context = vm.createContext({
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    document: {},
    Promise, Date, Math, JSON, Object, Number, setTimeout, clearTimeout
  });
  vm.runInContext(source.slice(start, end), context);
  const messages = [];
  context.showPieceConflict = (message) => messages.push(message);
  return { context, values, messages };
}

test('a newer server timestamp never deletes different local notes', async () => {
  const { context, values, messages } = draftHarness();
  const id = 'test-piece';
  values.set('rm-content-piece-drafts-v1', JSON.stringify({
    [id]: { revision: 'old-laptop-draft', piece: {
      id, title: 'My post', notesHtml: '<p>Four hours of new work</p>',
      updatedAt: '2026-11-28T05:00:00Z', _recordVersion: 'old'
    } }
  }));
  context.pieces[id] = {
    id, title: 'My post', notesHtml: '<p>Old text</p>',
    updatedAt: '2026-11-28T06:31:00Z', _recordVersion: 'new'
  };
  await context.recoverPieceDrafts([]);
  assert.match(values.get('rm-content-piece-drafts-v1'), /Four hours of new work/);
  assert.match(values.get('rm-content-piece-recovery-v1'), /Four hours of new work/);
  assert.equal(context.pieces[id].notesHtml, '<p>Old text</p>');
  assert.match(messages[0], /unsynced local draft/);
});

test('an acknowledged identical draft can be cleared despite a changed timestamp', async () => {
  const { context, values, messages } = draftHarness();
  const id = 'test-piece';
  values.set('rm-content-piece-drafts-v1', JSON.stringify({
    [id]: { revision: 'saved', piece: { id, title: 'My post', notesHtml: '<p>Saved</p>', updatedAt: '2026-11-28T05:00:00Z' } }
  }));
  context.pieces[id] = { id, title: 'My post', notesHtml: '<p>Saved</p>', updatedAt: '2026-11-28T06:31:00Z' };
  await context.recoverPieceDrafts([]);
  assert.equal(values.get('rm-content-piece-drafts-v1'), '{}');
  assert.equal(values.has('rm-content-piece-recovery-v1'), false);
  assert.equal(messages.length, 0);
});
