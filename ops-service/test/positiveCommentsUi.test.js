'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(name) { return fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'); }

test('appreciation slider is shared by desktop tabs and the phone Project Manager', function () {
  const desktop = read('index.html');
  const phone = read('voice-mobile.html');
  const app = read('app.js');
  const client = read('lib/positiveComments.js');
  assert.match(desktop, /id="positiveComments"/);
  assert.ok(desktop.indexOf('id="positiveComments"') < desktop.indexOf('id="panelMain"'));
  assert.match(phone, /id="vPositiveComments"/);
  assert.match(app, /RMPositiveComments\.mount\(document\.getElementById\('positiveComments'\)\)/);
  assert.match(phone, /RMPositiveComments\.mount\(document\.getElementById\('vPositiveComments'\)\)/);
  assert.match(desktop, /data-positive-track/);
  assert.match(phone, /data-positive-track/);
  assert.doesNotMatch(desktop, /data-positive-prev|data-positive-next/);
  assert.match(client, /quote\.textContent =/);
  assert.match(client, /author\.textContent =/);
  assert.match(client, /videoTitle\.textContent = row\.videoTitle/);
  assert.match(client, /relativeAge\(row\.publishedAt\)/);
  assert.doesNotMatch(client, /toLocaleDateString/);
  assert.match(client, /url\.hostname === 'www\.youtube\.com'/);
  assert.match(client, /setInterval/);
  assert.match(client, /pointermove/);
});
