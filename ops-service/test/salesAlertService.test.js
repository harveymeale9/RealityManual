'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const reporting = require('../src/storefrontReporting');
const salesAlerts = require('../src/salesAlertService');

test('new paid orders alert once, survive restart, and clear only when their IDs were viewed', function () {
  const ops = new Database(':memory:');
  const store = new Database(':memory:');
  store.exec(`CREATE TABLE orders (
    id TEXT PRIMARY KEY, order_status TEXT, stripe_payment_status TEXT, created_at TEXT
  )`);
  const insert = store.prepare('INSERT INTO orders VALUES (?,?,?,?)');
  insert.run('existing', 'BOOKVAULT_ACCEPTED', 'succeeded', '2026-10-13T09:00:00.000Z');
  insert.run('owner-test', 'BOOKVAULT_ACCEPTED', 'succeeded', '2026-10-13T10:00:00.000Z');
  let excluded = ['owner-test'];
  function setup() {
    return salesAlerts.setup({
      db: ops,
      paidOrderIds: function () { return reporting.paidOrderIds(store, excluded); },
      baselineOrderIds: function () { return reporting.paidOrderIds(store); }
    });
  }
  let alerts = setup();
  alerts.initialize();
  assert.deepEqual(alerts.status(), { count: 0, unseenOrderIds: [] });
  excluded = [];
  assert.equal(alerts.status().count, 0, 'restoring an old test order is not a new sale');
  excluded = ['owner-test'];
  insert.run('pending', 'PAYMENT_PENDING', 'requires_payment_method', '2026-10-14T00:00:00.000Z');
  for (let i = 1; i <= 7; i++) {
    insert.run('sale-' + i, 'BOOKVAULT_ACCEPTED', 'succeeded', '2026-10-21T0' + i + ':00:00.000Z');
  }
  assert.equal(alerts.status().count, 7);
  const renderedIds = alerts.status().unseenOrderIds;
  insert.run('later-sale', 'BOOKVAULT_ACCEPTED', 'succeeded', '2026-10-21T08:00:00.000Z');
  assert.equal(alerts.markViewed(renderedIds).count, 1, 'a sale after the dashboard snapshot remains unread');
  alerts = setup();
  assert.deepEqual(alerts.status().unseenOrderIds, ['later-sale']);
  assert.equal(alerts.markViewed(['later-sale', 'pending', 'owner-test', 'not-an-order']).count, 0);
  store.prepare("UPDATE orders SET order_status='PAYMENT_RECEIVED', stripe_payment_status='succeeded' WHERE id='pending'").run();
  assert.deepEqual(alerts.status().unseenOrderIds, ['pending'], 'late payment is detected despite its older created_at');
  store.prepare("UPDATE orders SET order_status='REFUNDED' WHERE id='pending'").run();
  assert.equal(alerts.status().count, 0, 'refunded orders do not inflate new paid sales');
  store.close();
  ops.close();
});
