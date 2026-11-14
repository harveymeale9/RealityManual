import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { claimNext } from '../src/fulfillment.js';

test('a new paid order is claimed ahead of older BookVault status polls', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`CREATE TABLE orders (
      id TEXT PRIMARY KEY, stripe_livemode INTEGER, order_status TEXT,
      refund_email_sent_at TEXT, resend_contact_synced_at TEXT,
      fulfillment_next_attempt_at TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO orders(id,stripe_livemode,order_status,created_at)
      VALUES ('old-accepted',1,'BOOKVAULT_ACCEPTED','2026-11-01T00:00:00.000Z');
    INSERT INTO orders(id,stripe_livemode,order_status,created_at)
      VALUES ('new-payment',1,'PAYMENT_RECEIVED','2026-11-14T00:00:00.000Z');`);
    const db = { prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { first: async () => statement.get() || null };
    } };
    assert.equal((await claimNext(db)).id, 'new-payment');
    assert.equal((await claimNext(db)).id, 'old-accepted');
    assert.equal(await claimNext(db), null);
  } finally { sqlite.close(); }
});
