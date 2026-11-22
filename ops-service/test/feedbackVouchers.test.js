'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { setup, voucherEmail } = require('../src/feedbackVouchers');

test('constructive feedback receives one no-expiry voucher; review and generic praise do not', async function () {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE customer_submissions (id TEXT PRIMARY KEY,data TEXT,status TEXT,submitted_at TEXT)`);
  const add = db.prepare('INSERT INTO customer_submissions VALUES(?,?,?,?)');
  const records = [
    { id: '11111111-1111-4111-8111-111111111111', kind: 'feedback', name: 'Reader', email: 'reader@example.test', message: 'The second chapter helped, but the chart on page 22 needs a clearer legend.', status: 'complete', submittedAt: '2026-11-21T10:00:00.000Z' },
    { id: '22222222-2222-4222-8222-222222222222', kind: 'feedback', name: 'Fan', email: 'fan@example.test', message: 'Great book!', status: 'complete', submittedAt: '2026-11-21T10:01:00.000Z' },
    { id: '33333333-3333-4333-8333-333333333333', kind: 'review', name: 'Reviewer', email: 'reviewer@example.test', message: 'A detailed review', status: 'complete', submittedAt: '2026-11-21T10:02:00.000Z' }
  ];
  records.forEach(data => add.run(data.id, JSON.stringify(data), 'complete', data.submittedAt));
  const issued = [], sent = [];
  const manager = setup(db, { start: false,
    classify: async message => ({ constructive: message.includes('page 22'), reason: 'Specific book observation' }),
    issue: async (data, code) => issued.push([data.id, code]),
    send: async email => sent.push(email) });
  await manager.processPending();
  await manager.processPending();
  assert.equal(issued.length, 1);
  assert.equal(sent.length, 1);
  assert.match(issued[0][1], /^RM50-[0-9A-V]{11}$/);
  assert.match(sent[0].htmlBody, /50% OFF ONE BOOK · NO EXPIRY/);
  assert.match(sent[0].textBody, /shipping is unchanged/i);
  assert.match(sent[0].textBody, /Enter the code in the Voucher code field/);
  assert.doesNotMatch(sent[0].htmlBody, /checkout\.html\?voucher=/);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM customer_submissions WHERE id=?').get(records[0].id).data).voucherReview.status, 'sent');
  assert.equal(JSON.parse(db.prepare('SELECT data FROM customer_submissions WHERE id=?').get(records[1].id).data).voucherReview.status, 'not_constructive');
  assert.equal(JSON.parse(db.prepare('SELECT data FROM customer_submissions WHERE id=?').get(records[2].id).data).voucherReview, undefined);
  manager.close(); db.close();
});

test('preview email uses a non-redeemable sample code and is clearly labelled', function () {
  const message = voucherEmail('Harvey', 'RM50-DEMO0000000', true);
  assert.match(message.subject, /PREVIEW/);
  assert.match(message.textBody, /not redeemable/);
  assert.match(message.htmlBody, /share such thoughtful feedback/);
  assert.doesNotMatch(message.htmlBody, /It helps me make The Reality Manual better/);
  assert.match(message.htmlBody, /img\/email\/voucher-shop-button\.png/);
  assert.match(message.htmlBody, /alt="SHOP THE BOOK"/);
});
