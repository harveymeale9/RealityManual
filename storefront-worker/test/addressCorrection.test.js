import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isAddressRejection, processPendingOrders } from '../src/fulfillment.js';
import { orderAddressCorrectionEmail } from '../src/mail.js';

test('only BookVault address validation errors trigger a correction request', () => {
  assert.equal(isAddressRejection('76021 is not recognised from the specified state'), true);
  assert.equal(isAddressRejection('A valid postcode for the country has not been supplied'), true);
  assert.equal(isAddressRejection('BookVault payment failed: insufficient funds'), false);
  assert.equal(isAddressRejection('BookVault request timed out'), false);
  const email = orderAddressCorrectionEmail({ id: '12345678-abcd', customer_name: 'Jesse Example' });
  assert.match(email.text, /received your payment and accepted/);
  assert.match(email.text, /do not need to place another order or pay again/);
  assert.doesNotMatch(email.text, /76021/);
});

test('a paid address rejection sends one customer request and a truthful owner alert', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/src/db/schema.sql', import.meta.url), 'utf8'));
  sqlite.prepare(`INSERT INTO orders(id,stripe_livemode,stripe_payment_status,order_status,
    customer_name,email,phone,country,street1,city,state,postal_code,quantity,
    book_price_cents,shipping_price_cents,total_price_cents,currency,payment_received_at,created_at)
    VALUES(?,1,'succeeded','PAYMENT_RECEIVED',?,?,?,?,?,?,?,?,1,6500,1810,8310,'usd',?,?)`)
    .run('12345678-abcd', 'Jesse Example', 'customer@example.test', '+15555555555',
      'US', '1 Test Road', 'Kasson', 'Minnesota', '76021', new Date().toISOString(), new Date().toISOString());
  const db = { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    return {
      first: async () => stmt.get() || null,
      bind(...args) { return { first: async () => stmt.get(...args) || null,
        run: async () => ({ meta: { changes: stmt.run(...args).changes } }) }; },
    };
  } };
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('api.resend.com/emails')) {
      sent.push(JSON.parse(options.body));
      return Response.json({ id: `mail-${sent.length}` });
    }
    if (String(url).includes('/Order?DocRef=')) return Response.json({ Message: 'Not found' }, { status: 404 });
    if (String(url).includes('/Order?payMethod=Saved')) return Response.json({ Message: '76021 is not recognised from the specified state' }, { status: 400 });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const env = { DB: db, FULFILLMENT_ENABLED: 'true', BOOKVAULT_API_KEY: 'test-key',
      BOOKVAULT_TITLE_ISBN: '9658364000016', RESEND_API_KEY: 'test-key',
      RESEND_FROM_EMAIL: 'The Reality Manual <orders@example.test>',
      RESEND_REPLY_TO: 'info@example.test', ORDER_ALERT_EMAIL: 'owner@example.test' };
    assert.equal(await processPendingOrders(env, 1), 1);
    const row = sqlite.prepare('SELECT * FROM orders WHERE id=?').get('12345678-abcd');
    assert.equal(row.order_status, 'FULFILLMENT_RETRY');
    assert.ok(row.confirmation_email_sent_at);
    assert.ok(row.address_correction_email_sent_at);
    assert.ok(row.fulfillment_alert_sent_at);
    assert.equal(sent.length, 3);
    assert.equal(sent[1].to[0], 'customer@example.test');
    assert.match(sent[1].subject, /confirm your delivery address/i);
    assert.equal(sent[2].to[0], 'owner@example.test');
    assert.match(sent[2].subject, /Address correction requested/);
    assert.match(sent[2].text, /I emailed the customer/);
    sqlite.prepare("UPDATE orders SET fulfillment_next_attempt_at = '2000-01-01T00:00:00Z' WHERE id=?").run('12345678-abcd');
    assert.equal(await processPendingOrders(env, 1), 1);
    assert.equal(sent.length, 3);
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});
