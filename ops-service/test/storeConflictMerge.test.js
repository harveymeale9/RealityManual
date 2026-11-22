'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'store.js'), 'utf8');

function fixture() {
  let current = { id: 'piece-1', title: 'Original', notesHtml: '<p>Original</p>',
    stage: 'to_film', updatedAt: '2026-11-22T00:00:00Z', _recordVersion: 'v1' };
  let writes = 0;
  const events = [];
  const window = { dispatchEvent: event => events.push(event) };
  const fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      writes++;
      const body = JSON.parse(options.body);
      if (body._recordVersion !== current._recordVersion) {
        return new Response(JSON.stringify({ error: 'stale_write', latest: current,
          message: 'This card changed on another device.' }), { status: 409 });
      }
      current = { ...body, _recordVersion: 'v' + (Number(current._recordVersion.slice(1)) + 1) };
      return new Response(JSON.stringify(current), { status: 200 });
    }
    if (url === '/api/store/pieces') return new Response(JSON.stringify([current]));
    throw new Error('Unexpected request: ' + url);
  };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  vm.runInNewContext(source, { window, fetch, CustomEvent, Response, Blob, FormData, Promise, Date, JSON });
  return { store: window.RMStore, events, get current() { return current; },
    get writes() { return writes; }, serverUpdate(changes) {
      current = { ...current, ...changes, _recordVersion: 'v' + (Number(current._recordVersion.slice(1)) + 1) };
    } };
}

test('an unrelated server update merges with a user edit without a false conflict toast', async () => {
  const f = fixture();
  const piece = (await f.store.getAll('pieces'))[0];
  piece.notesHtml = '<p>New work</p>';
  f.serverUpdate({ stage: 'uploaded' });
  await f.store.put('pieces', piece);
  assert.equal(f.current.notesHtml, '<p>New work</p>');
  assert.equal(f.current.stage, 'uploaded');
  assert.equal(piece._recordVersion, f.current._recordVersion);
  assert.equal(f.writes, 2);
  assert.equal(f.events.length, 0);
});

test('closing an untouched stale card does not write or show a conflict', async () => {
  const f = fixture();
  const piece = (await f.store.getAll('pieces'))[0];
  f.serverUpdate({ stage: 'uploaded' });
  piece.updatedAt = '2026-11-22T01:00:00Z';
  await f.store.put('pieces', piece);
  assert.equal(f.writes, 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.current.stage, 'uploaded');
});

test('two different edits to the same field still conflict and protect the newer server copy', async () => {
  const f = fixture();
  const piece = (await f.store.getAll('pieces'))[0];
  piece.title = 'My title';
  f.serverUpdate({ title: 'Other device title' });
  await assert.rejects(f.store.put('pieces', piece), { code: 'stale_write' });
  assert.equal(f.current.title, 'Other device title');
  assert.equal(f.events.length, 1);
  assert.equal(f.writes, 1);
});
