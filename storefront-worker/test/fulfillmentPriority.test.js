import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { claimNext, processPendingOrders } from '../src/fulfillment.js';

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

test('accepted orders are checked by overdue time, not repeatedly by creation date', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`CREATE TABLE orders (
      id TEXT PRIMARY KEY, stripe_livemode INTEGER, order_status TEXT,
      refund_email_sent_at TEXT, resend_contact_synced_at TEXT,
      fulfillment_next_attempt_at TEXT, created_at TEXT, updated_at TEXT
    );
    INSERT INTO orders(id,stripe_livemode,order_status,fulfillment_next_attempt_at,created_at)
      VALUES ('older-book',1,'BOOKVAULT_ACCEPTED','2026-11-28T10:00:00.000Z','2026-11-01T00:00:00.000Z');
    INSERT INTO orders(id,stripe_livemode,order_status,fulfillment_next_attempt_at,created_at)
      VALUES ('newer-book-overdue',1,'BOOKVAULT_ACCEPTED','2026-11-27T10:00:00.000Z','2026-11-15T00:00:00.000Z');`);
    const db = { prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { first: async () => statement.get() || null };
    } };
    assert.equal((await claimNext(db)).id, 'newer-book-overdue');
    assert.equal((await claimNext(db)).id, 'older-book');
  } finally { sqlite.close(); }
});

test('one scheduled sweep can poll forty accepted orders without duplicating a claim', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/src/db/schema.sql', import.meta.url), 'utf8'));
  const insert = sqlite.prepare(`INSERT INTO orders (
    id, stripe_livemode, order_status, bookvault_order_id, customer_name, email, phone,
    country, street1, city, postal_code, book_price_cents, shipping_price_cents,
    total_price_cents, confirmation_email_sent_at, resend_contact_synced_at,
    fulfillment_next_attempt_at, created_at
  ) VALUES (?,1,'BOOKVAULT_ACCEPTED',?,'Test','test@example.test','555','US',
    'Test Street','Test City','10001',6500,1000,7500,?,?,?,?)`);
  for (let n = 0; n < 45; n++) {
    const due = new Date(Date.now() - (45 - n) * 60000).toISOString();
    insert.run(`order-${n}`, `pod-${n}`, due, due, due, due);
  }
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {
      first: async () => statement.get() || null,
      bind(...args) { return {
        first: async () => statement.get(...args) || null,
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      }; },
    };
  } };
  const env = { DB: db, FULFILLMENT_ENABLED: 'true', BOOKVAULT_API_KEY: 'test' };
  const originalFetch = globalThis.fetch;
  const polled = [];
  globalThis.fetch = async (url) => {
    const podRef = new URL(String(url)).searchParams.get('PodRef');
    polled.push(podRef);
    return Response.json({ PodRef: podRef, Status: 'Active', Progress: { Status: 'Created', IsDispatched: false } });
  };
  try {
    assert.equal(await processPendingOrders(env), 40);
    assert.deepEqual(polled, Array.from({ length: 40 }, (_, n) => `pod-${n}`));
    assert.equal(new Set(polled).size, 40);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM orders WHERE
      fulfillment_next_attempt_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')`).get().n, 5);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
