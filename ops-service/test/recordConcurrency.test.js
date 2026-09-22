'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const concurrency = require('../src/recordConcurrency');

test('a stale device cannot overwrite a newer piece version', function () {
  const originalRow = {
    data: JSON.stringify({ id: 'piece-1', title: 'Original', notesHtml: '<p>Original notes</p>' }),
    updated_at: '2026-09-22T00:00:00.000Z'
  };
  const laptop = concurrency.decodeRow(originalRow);
  const desktop = concurrency.decodeRow(originalRow);

  laptop.title = 'Improved at the cafe';
  laptop.notesHtml = '<p>Important new work</p>';
  const laptopWrite = concurrency.preparePieceWrite(originalRow, laptop, laptop.id);
  assert.equal(laptopWrite.conflict, false);
  const newerRow = {
    data: JSON.stringify(laptopWrite.record),
    updated_at: '2026-09-22T01:00:00.000Z'
  };

  desktop.title = 'Stale home-PC title';
  const staleWrite = concurrency.preparePieceWrite(newerRow, desktop, desktop.id);
  assert.equal(staleWrite.conflict, true);
  assert.equal(staleWrite.latest.title, 'Improved at the cafe');
  assert.equal(staleWrite.latest.notesHtml, '<p>Important new work</p>');
  assert.notEqual(staleWrite.latest._recordVersion, desktop._recordVersion);
  assert.equal(concurrency.matchesPieceVersion(newerRow, desktop._recordVersion), false);
  assert.equal(concurrency.matchesPieceVersion(newerRow, laptopWrite.record._recordVersion), true);

  const legacyWrite = concurrency.preparePieceWrite(newerRow, { id: 'piece-1', title: 'Very old tab' }, 'piece-1');
  assert.equal(legacyWrite.conflict, true);

  const refreshed = concurrency.decodeRow(newerRow);
  refreshed.title = 'Intentional edit after reload';
  assert.equal(concurrency.preparePieceWrite(newerRow, refreshed, refreshed.id).conflict, false);
});

test('a server-side update invalidates every previously loaded client copy', function () {
  const piece = { id: 'piece-2', title: 'Before' };
  concurrency.stampServerWrite(piece);
  const before = piece._recordVersion;
  concurrency.stampServerWrite(piece);
  assert.notEqual(piece._recordVersion, before);
});
