'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backupModule = require('../src/kanbanBackupService');

test('daily Kanban backup preserves card data, omits derived thumbnails and verifies recovery', async function () {
  const objects = new Map();
  const deleted = [];
  const storage = {
    configured: true,
    uploadJson: async function (key, value) {
      objects.set(key, JSON.parse(JSON.stringify(value)));
      return { key: key, sizeBytes: Buffer.byteLength(JSON.stringify(value)) };
    },
    readJson: async function (key) {
      if (!objects.has(key)) throw new Error('not found');
      return JSON.parse(JSON.stringify(objects.get(key)));
    },
    listKeys: async function () {
      const current = Array.from(objects.keys()).map(function (key) { return { key: key, lastModified: key }; });
      for (let index = 0; index < 366; index++) current.push({
        key: 'backups/kanban/daily/2025-' + String(Math.floor(index / 31) + 1).padStart(2, '0') + '-' + String(index % 31 + 1).padStart(2, '0') + '.json',
        lastModified: new Date(2025, 0, 1 + index).toISOString()
      });
      return current;
    },
    deleteKey: async function (key) { deleted.push(key); }
  };
  const service = backupModule.setup({
    storage: storage,
    now: function () { return Date.parse('2026-10-06T04:00:00Z'); },
    getCards: function () { return [{ id: 'piece-1', title: 'An idea', notesHtml: '<p>Outline</p>', thumbnailDataUrl: 'data:image/png;base64,HUGE' }]; }
  });
  const result = await service.run();
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.key, 'backups/kanban/daily/2026-10-06.json');
  const saved = objects.get(result.key);
  assert.equal(saved.cardCount, 1);
  assert.equal(saved.cards[0].notesHtml, '<p>Outline</p>');
  assert.equal(saved.cards[0].thumbnailDataUrl, undefined);
  assert.equal(backupModule.validBackup(saved), true);
  assert.equal(deleted.length, 2);
  assert.equal(service.status().lastError, '');

  const second = await service.run();
  assert.equal(second.skipped, true);
});

test('a corrupt recovered backup fails verification and is reported', async function () {
  const storage = {
    configured: true,
    uploadJson: async function (key) { return { key: key, sizeBytes: 10 }; },
    readJson: async function () { return { format: 'broken' }; },
    listKeys: async function () { return []; }, deleteKey: async function () {}
  };
  const service = backupModule.setup({ storage: storage, getCards: function () { return [{ id: 'one' }]; } });
  await assert.rejects(service.run({ force: true }), /recovery verification failed/);
  assert.match(service.status().lastError, /recovery verification failed/);
});
