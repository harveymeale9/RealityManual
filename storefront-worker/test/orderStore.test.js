import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyPaymentEvent, hasRecentPaidOrder, toPublicStatus } from '../src/orderStore.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, stripe_payment_intent_id TEXT UNIQUE, email TEXT,
      order_status TEXT, stripe_payment_status TEXT, stripe_livemode INTEGER DEFAULT 0,
      payment_received_at TEXT, payment_failure_type TEXT, payment_failure_code TEXT,
      payment_decline_code TEXT, payment_failure_message TEXT, updated_at TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      quantity INTEGER, total_price_cents INTEGER, currency TEXT
    );
    CREATE TABLE checkout_recovery_contacts (capture_id TEXT PRIMARY KEY, email TEXT);
    INSERT INTO orders (id, stripe_payment_intent_id, email, order_status, quantity, total_price_cents, currency)
      VALUES ('order-1', 'pi-1', 'customer@example.com', 'PAYMENT_PENDING', 1, 8329, 'usd');
    INSERT INTO checkout_recovery_contacts VALUES ('capture-1', 'customer@example.com');
  `);
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => statement.get(...args) || null,
            run: async () => ({ meta: { changes: statement.run(...args).changes } }),
          };
        },
      };
    },
  };
  return { sqlite, db };
}

test('payment success is idempotent and removes opted-in recovery address', async () => {
  const { sqlite, db } = fixture();
  const first = await applyPaymentEvent(db, 'pi-1', 'PAYMENT_RECEIVED', 'succeeded', true);
  assert.equal(first.changed, true);
  assert.equal(first.paid, true);
  assert.ok(first.order.payment_received_at);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM checkout_recovery_contacts').get().n, 0);
  const duplicate = await applyPaymentEvent(db, 'pi-1', 'PAYMENT_RECEIVED', 'succeeded', true);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.order.payment_received_at, first.order.payment_received_at);
  assert.equal(await hasRecentPaidOrder(db, 'CUSTOMER@example.com'), true);
  sqlite.close();
});

test('late failed or processing events cannot downgrade a paid order', async () => {
  const { sqlite, db } = fixture();
  await applyPaymentEvent(db, 'pi-1', 'PAYMENT_RECEIVED', 'succeeded', true);
  for (const status of ['FAILED', 'PAYMENT_PROCESSING']) {
    const result = await applyPaymentEvent(db, 'pi-1', status, status.toLowerCase(), true, { message: 'late failure' });
    assert.equal(result.changed, false);
    assert.equal(result.order.order_status, 'PAYMENT_RECEIVED');
  }
  sqlite.prepare("UPDATE orders SET order_status = 'REFUNDED' WHERE id = 'order-1'").run();
  const refund = await applyPaymentEvent(db, 'pi-1', 'PAYMENT_RECEIVED', 'succeeded', true);
  assert.equal(refund.changed, false);
  assert.equal(refund.order.order_status, 'REFUNDED');
  sqlite.close();
});

test('definite payment failure can be followed by later success', async () => {
  const { sqlite, db } = fixture();
  const failed = await applyPaymentEvent(db, 'pi-1', 'FAILED', 'requires_payment_method', true, {
    type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Card declined',
  });
  assert.equal(failed.order.payment_decline_code, 'insufficient_funds');
  const paid = await applyPaymentEvent(db, 'pi-1', 'PAYMENT_RECEIVED', 'succeeded', true);
  assert.equal(paid.order.order_status, 'PAYMENT_RECEIVED');
  assert.equal(paid.order.payment_decline_code, null);
  const publicStatus = toPublicStatus(paid.order, 'The Reality Manual', 'Hardcover');
  assert.deepEqual(Object.keys(publicStatus).sort(), [
    'currency', 'order_id', 'order_status', 'product_description', 'product_name', 'quantity', 'total_price_cents',
  ]);
  sqlite.close();
});
