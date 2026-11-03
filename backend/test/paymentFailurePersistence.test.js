const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-payment-failure-'));
process.env.DATABASE_PATH = path.join(scratch, 'orders.sqlite');
const db = require('../src/db');
const orders = require('../src/services/orderService');

test('Stripe decline reason is saved and cleared after a successful retry', function () {
  db.prepare(`INSERT INTO orders (id, stripe_payment_intent_id, customer_name, email, phone,
    country, street1, city, postal_code, book_price_cents, shipping_price_cents,
    total_price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'test-order', 'pi_test_failure', 'Test', 'test@example.invalid', '000', 'US',
    'Test street', 'Chicago', '60601', 6500, 1200, 7700,
  );
  orders.updateStatusByPaymentIntentId('pi_test_failure', 'FAILED', 'requires_payment_method', true);
  orders.recordPaymentFailure('pi_test_failure', {
    type: 'card_error', code: 'card_declined', decline_code: 'try_again_later',
    message: 'Your card was declined.',
  });
  const declined = orders.getByPaymentIntentId('pi_test_failure');
  assert.equal(declined.payment_failure_type, 'card_error');
  assert.equal(declined.payment_decline_code, 'try_again_later');
  assert.equal(declined.payment_failure_message, 'Your card was declined.');

  orders.updateStatusByPaymentIntentId('pi_test_failure', 'PAYMENT_RECEIVED', 'succeeded', true);
  const paid = orders.getByPaymentIntentId('pi_test_failure');
  assert.equal(paid.payment_decline_code, null);
  assert.equal(paid.payment_failure_message, null);
});

test.after(() => {
  db.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});
