'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { addVideoTitlesToOrders } = require('../src/salesVideoTitles');

test('sales attribution uses the selected YouTube title without rewriting historic order data', function () {
  const orders = [
    { attribution: { first: { source: 'youtube', campaign: 'longform', content: '185' },
      last_tagged: { source: 'youtube', campaign: 'longform', content: '230' } } },
    { attribution: { first: { source: 'facebook', content: '185' },
      last_tagged: { source: 'youtube', content: '999' } } },
    { attribution: null }
  ];
  addVideoTitlesToOrders(orders, [
    { seq: 185, title: 'Working title', ytTitles: ["Why you're playing the wrong game..."] },
    { seq: 230, title: 'Fallback title', ytTitles: [] }
  ]);
  assert.equal(orders[0].attribution.first.video_title, "Why you're playing the wrong game...");
  assert.equal(orders[0].attribution.last_tagged.video_title, 'Fallback title');
  assert.equal(orders[1].attribution.first.video_title, undefined);
  assert.equal(orders[1].attribution.last_tagged.video_title, undefined);
  assert.equal(orders[2].attribution, null);
});

test('recent-order labels show the video title and retain a fallback for unknown sequences', function () {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = app.indexOf('  function salesTouchLabel(');
  const end = app.indexOf('  function salesOrderSource(', start);
  assert.ok(start > 0 && end > start);
  const label = vm.runInNewContext(app.slice(start, end) + '\nsalesTouchLabel', {});
  assert.equal(label({ source: 'youtube', campaign: 'longform', content: '185',
    video_title: "Why you're playing the wrong game..." }),
    "YouTube · long-form · Why you're playing the wrong game...");
  assert.equal(label({ source: 'youtube', campaign: 'longform', content: '999' }),
    'YouTube · long-form · video 999');
  assert.match(server, /salesVideoTitles\.addVideoTitlesToOrders\(dashboard\.recent_orders, storedPieces\(\)\)/);
});
