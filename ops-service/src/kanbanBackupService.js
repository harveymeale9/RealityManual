'use strict';

const crypto = require('crypto');

const PREFIX = 'backups/kanban/daily/';

function datePart(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function backupKey(now) {
  return PREFIX + datePart(now) + '.json';
}

function cardCopy(card) {
  const copy = JSON.parse(JSON.stringify(card || {}));
  // The Kanban's base64 thumbnail is derived display data and can dwarf all
  // of the actual ideas/outlines. Video media is stored separately already.
  delete copy.thumbnailDataUrl;
  return copy;
}

function digest(cards) {
  return crypto.createHash('sha256').update(JSON.stringify(cards)).digest('hex');
}

function validBackup(payload) {
  return !!payload && payload.format === 'reality-manual-kanban' && payload.version === 1
    && Array.isArray(payload.cards) && payload.cardCount === payload.cards.length
    && payload.sha256 === digest(payload.cards);
}

function setup(options) {
  options = options || {};
  const storage = options.storage;
  const getCards = options.getCards;
  const now = options.now || Date.now;
  const retentionDays = Math.max(30, Math.min(3650, Number(options.retentionDays) || 365));
  let running = null;
  const state = {
    configured: !!(storage && storage.configured),
    retentionDays: retentionDays,
    running: false,
    lastAttemptAt: '',
    lastSuccessAt: '',
    lastKey: '',
    cardCount: 0,
    sizeBytes: 0,
    lastError: ''
  };

  async function prune() {
    const objects = await storage.listKeys(PREFIX);
    objects.sort(function (a, b) {
      return String(b.lastModified || b.key).localeCompare(String(a.lastModified || a.key));
    });
    const stale = objects.slice(retentionDays);
    await Promise.all(stale.map(function (item) { return storage.deleteKey(item.key); }));
    return stale.length;
  }

  async function perform(force) {
    if (!state.configured) return { ok: false, skipped: true, reason: 'r2_not_configured' };
    const timestamp = new Date(now()).toISOString();
    const key = backupKey(timestamp);
    state.lastAttemptAt = timestamp;
    state.lastError = '';
    state.running = true;
    try {
      if (!force) {
        try {
          const existing = await storage.readJson(key);
          if (validBackup(existing)) {
            state.lastSuccessAt = existing.createdAt || timestamp;
            state.lastKey = key;
            state.cardCount = existing.cardCount;
            return { ok: true, skipped: true, key: key, cardCount: existing.cardCount };
          }
        } catch (error) {
          // Missing or corrupt today's object is repaired by a fresh upload.
        }
      }
      const cards = (await Promise.resolve(getCards())).map(cardCopy);
      const payload = {
        format: 'reality-manual-kanban',
        version: 1,
        createdAt: timestamp,
        cardCount: cards.length,
        sha256: digest(cards),
        cards: cards
      };
      const remote = await storage.uploadJson(key, payload);
      const recovered = await storage.readJson(key);
      if (!validBackup(recovered) || recovered.sha256 !== payload.sha256) {
        throw new Error('Kanban backup recovery verification failed.');
      }
      state.lastSuccessAt = timestamp;
      state.lastKey = key;
      state.cardCount = cards.length;
      state.sizeBytes = remote.sizeBytes;
      const pruned = await prune();
      return { ok: true, skipped: false, key: key, cardCount: cards.length, sizeBytes: remote.sizeBytes, pruned: pruned };
    } catch (error) {
      state.lastError = String(error && error.message || error).slice(0, 500);
      throw error;
    } finally {
      state.running = false;
    }
  }

  function run(options) {
    if (running) return running;
    running = perform(!!(options && options.force)).finally(function () { running = null; });
    return running;
  }

  function status() { return Object.assign({}, state); }

  return { run: run, status: status, backupKey: backupKey, validBackup: validBackup };
}

module.exports = { setup: setup, backupKey: backupKey, validBackup: validBackup };
