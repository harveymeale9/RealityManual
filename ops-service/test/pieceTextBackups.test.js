'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/pieceTextBackups');

test('text snapshots preserve earlier versions independently of card writes', function () {
  const db = new Database(':memory:');
  let time = Date.parse('2026-11-28T10:00:00Z');
  const backups = service.setup(db, { now: function () { return time; } });
  const first = backups.save('piece-1', 'Title', 'An early thought');
  time += 1000;
  const second = backups.save('piece-1', 'Title', 'A better thought');
  assert.notEqual(first.id, second.id);
  assert.equal(backups.save('piece-1', 'Title', 'A better thought').unchanged, true);
  assert.deepEqual(backups.history('piece-1').map(function (row) { return row.notes_text; }),
    ['A better thought', 'An early thought']);
  assert.equal(backups.recent()[0].notes_text, 'A better thought');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM piece_text_backups').get().n, 2);
  db.close();
});

test('a backup is still saved when no versioned card record exists', function () {
  const db = new Database(':memory:');
  const backups = service.setup(db);
  backups.save('unsaved-piece', 'New title', 'Text before the first card PUT');
  assert.equal(backups.history('unsaved-piece')[0].notes_text, 'Text before the first card PUT');
  db.close();
});
