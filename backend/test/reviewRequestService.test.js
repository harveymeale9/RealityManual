const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-review-'));
process.env.DATABASE_PATH = path.join(scratch, 'test.db');
process.env.RESEND_API_KEY = 're_test_never_sent';
process.env.RESEND_FROM_EMAIL = 'The Reality Manual <orders@example.com>';

const orderService = require('../src/services/orderService');
const { resendClient } = require('../src/services/resendService');
const reviewService = require('../src/services/reviewRequestService');
const { validateCheckoutInput } = require('../src/lib/validation');
const reviewRoutes = require('../src/routes/review');

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function shippedOrder(email, optIn) {
  const order = orderService.createOrder({
    customer_name: 'Ava Reader', email, phone: '+12025550123',
    country_code: 'US', street1: '1 Example Road', street2: '', city: 'Austin',
    state: 'TX', postal_code: '78701', quantity: 1, bookPriceCents: 6500,
    shippingPriceCents: 999, shippingServiceName: 'USPS Consolidator',
    shippingServiceId: 321, shippingMinDeliveryDays: 2, shippingMaxDeliveryDays: 8,
    totalPriceCents: 7499, currency: 'usd', review_request_opt_in: optIn,
  });
  orderService.attachPaymentIntent(order.id, `pi_${order.id}`);
  orderService.updateStatusByPaymentIntentId(`pi_${order.id}`, 'PAYMENT_RECEIVED', 'succeeded', true);
  orderService.setBookVaultAccepted(order.id, `bv_${order.id}`);
  orderService.markEmailSent(order.id, 'shipping');
  return orderService.setOrderStatus(order.id, 'SHIPPED');
}

test('checkout review preference defaults off and only accepts a boolean', () => {
  const body = {
    customer_name: 'Ava Reader', email: 'ava@example.com', phone: '+12025550123',
    country_code: 'US', street1: '1 Example Road', city: 'Austin',
    state: 'TX', postal_code: '78701', quantity: 1,
  };
  assert.deepEqual(validateCheckoutInput(body), {});
  assert.deepEqual(validateCheckoutInput({ ...body, review_request_opt_in: true }), {});
  assert.equal(validateCheckoutInput({ ...body, review_request_opt_in: 'true' }).review_request_opt_in,
    'Review email preference must be true or false.');
});

test('only opted-in shipped paid orders receive one review email after their due date', async () => {
  const eligible = shippedOrder('eligible@example.com', true);
  const noConsent = shippedOrder('no-consent@example.com', false);
  const sent = [];
  resendClient.getContactByEmail = async () => ({ unsubscribed: false });
  resendClient.sendEmail = async message => { sent.push(message); return { id: `email_${sent.length}` }; };

  await reviewService.processDueReviewRequests(new Date());
  assert.equal(sent.length, 0);
  await reviewService.processDueReviewRequests(new Date(Date.now() + 22 * 86400000));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, eligible.email);
  assert.equal(sent[0].idempotencyKey, `${eligible.id}-review-request`);
  assert.equal(sent[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(orderService.getById(eligible.id).review_request_email_sent_at);
  assert.equal(orderService.getById(noConsent.id).review_request_email_sent_at, null);
  await reviewService.processDueReviewRequests(new Date(Date.now() + 23 * 86400000));
  assert.equal(sent.length, 1);
});

test('unsubscribed Resend contacts and refunded orders never receive review mail', async () => {
  const unsubscribed = shippedOrder('unsubscribed@example.com', true);
  const refunded = shippedOrder('refunded@example.com', true);
  orderService.setOrderStatus(refunded.id, 'REFUNDED');
  let sends = 0;
  resendClient.getContactByEmail = async () => ({ unsubscribed: true });
  resendClient.sendEmail = async () => { sends += 1; };
  await reviewService.processDueReviewRequests(new Date(Date.now() + 22 * 86400000));
  assert.equal(sends, 0);
  assert.ok(orderService.getById(unsubscribed.id).review_request_skipped_at);
  assert.equal(orderService.getById(refunded.id).review_request_email_sent_at, null);
});

test('viewing unsubscribe page is safe; POST suppresses pending requests for the address', async () => {
  const order = shippedOrder('unsub-me@example.com', true);
  const sibling = shippedOrder('unsub-me@example.com', true);
  const app = express();
  app.use('/api/review', reviewRoutes);
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/review/unsubscribe?order=${order.id}`;
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Unsubscribe from review requests/);
    assert.equal(orderService.getById(order.id).review_request_opt_out_at, null);

    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.ok(orderService.getById(order.id).review_request_opt_out_at);
    assert.ok(orderService.getById(sibling.id).review_request_opt_out_at);
    assert.equal(orderService.listReviewRequestCandidates().some(candidate => candidate.id === sibling.id), false);
  } finally {
    server.close();
  }
});
