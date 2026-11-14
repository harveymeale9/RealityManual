import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { reportSnapshot } from '../src/reportSnapshot.js';

test('report snapshot denies other IPs and excludes customer identity/address', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/src/db/schema.sql', import.meta.url), 'utf8'));
  sqlite.prepare(`INSERT INTO orders(id,customer_name,email,phone,country,street1,city,postal_code,
    quantity,book_price_cents,shipping_price_cents,total_price_cents,currency,order_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('order-1', 'Secret Customer', 'secret@example.test', '5551234567',
    'US', 'Secret Street', 'New York', '10001', 1, 6500, 1810, 8310, 'usd', 'PAYMENT_PENDING');
  const env = {
    REPORTS_ENABLED: 'true', REPORT_ALLOWED_IPS: '192.0.2.1', REPORT_ACCESS_TOKEN: 'test-token',
    DB: { prepare: (sql) => ({ all: async () => ({ results: sqlite.prepare(sql).all() }) }) },
  };
  const request = (ip, token = 'test-token') => new Request('https://example.test/api/internal/report-snapshot', {
    headers: { 'cf-connecting-ip': ip, authorization: `Bearer ${token}` },
  });
  assert.equal((await reportSnapshot(request('198.51.100.2'), env)).status, 403);
  assert.equal((await reportSnapshot(request('192.0.2.1', 'wrong-token'), env)).status, 403);
  const response = await reportSnapshot(request('192.0.2.1'), env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes('secret@example.test'), false);
  assert.equal(body.includes('Secret Customer'), false);
  assert.equal(body.includes('Secret Street'), false);
  assert.equal(body.includes('10001'), false);
  assert.equal(JSON.parse(body).tables.orders[0].total_price_cents, 8310);
  sqlite.close();
});
