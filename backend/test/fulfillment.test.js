const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-fulfillment-'));
process.env.DATABASE_PATH = path.join(scratch, 'test.db');
process.env.BOOKVAULT_API_KEY = 'bv_test_never_sent';
process.env.BOOKVAULT_TITLE_ISBN = '9781234567890';
process.env.RESEND_API_KEY = 're_test_never_sent';
process.env.RESEND_FROM_EMAIL = 'The Reality Manual <orders@example.com>';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.FULFILLMENT_ENABLED = 'true';

const orderService = require('../src/services/orderService');
const bookvaultService = require('../src/services/bookvaultService');
const stripeService = require('../src/services/stripeService');
const { resendClient } = require('../src/services/resendService');
const fulfillmentService = require('../src/services/fulfillmentService');

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function paidOrder() {
  const order = orderService.createOrder({
    customer_name: 'Ava Reader',
    email: 'ava@example.com',
    phone: '+12025550123',
    country_code: 'US',
    street1: '1 Example Road',
    street2: '',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    quantity: 1,
    bookPriceCents: 6500,
    shippingPriceCents: 999,
    shippingServiceName: 'USPS Consolidator',
    shippingServiceId: 321,
    shippingMinDeliveryDays: 2,
    shippingMaxDeliveryDays: 5,
    totalPriceCents: 7499,
    currency: 'usd',
  });
  orderService.attachPaymentIntent(order.id, `pi_${order.id}`);
  return orderService.updateStatusByPaymentIntentId(`pi_${order.id}`, 'PAYMENT_RECEIVED', 'succeeded', true);
}

test('BookVault payload uses the checkout service and complete customer address', () => {
  const payload = bookvaultService.orderPayload(paidOrder());
  assert.equal(payload.DocRef, payload.CustRef);
  assert.equal(payload.DispatchRequest.RequestedService, 'Specified');
  assert.deepEqual(payload.DispatchRequest.RequestedServID, [321]);
  assert.equal(payload.OrderLines[0].ISBN, '9781234567890');
  assert.equal(payload.Address.Country.ISO_Code, 'US');
  assert.equal(payload.Notifications.NotifyCustomer, false);
});

test('paid order is submitted once, emailed, then dispatch is emailed with tracking', async () => {
  const order = paidOrder();
  const sent = [];
  let submissions = 0;
  bookvaultService.submitOrder = async () => {
    submissions += 1;
    return { PodRef: 7001 };
  };
  resendClient.sendEmail = async (message) => {
    sent.push(message);
    return { id: `email_${sent.length}` };
  };

  await fulfillmentService.processOrder(order);
  let stored = orderService.getById(order.id);
  assert.equal(stored.order_status, 'BOOKVAULT_ACCEPTED');
  assert.equal(stored.bookvault_order_id, '7001');
  assert.ok(stored.confirmation_email_sent_at);
  assert.equal(submissions, 1);
  assert.equal(sent[0].subject, 'We’re Making Your Copy of The Reality Manual');

  bookvaultService.getOrder = async () => ({
    Progress: { Status: 'Dispatched' },
    Tracking: {
      ServName: 'USPS',
      TrackingNumber: 'TRACK123',
      CombinedURL: 'https://tracking.example/TRACK123',
    },
  });
  await fulfillmentService.processOrder(orderService.getById(order.id));
  stored = orderService.getById(order.id);
  assert.equal(stored.order_status, 'SHIPPED');
  assert.ok(stored.shipping_email_sent_at);
  assert.equal(sent[1].subject, 'Your Copy of The Reality Manual Is on Its Way');
  assert.match(sent[1].html, /TRACK123/);
  assert.equal(submissions, 1);
});

test('an accepted order is never refunded merely because confirmation email is temporarily unavailable', async () => {
  const order = paidOrder();
  let refundCalls = 0;
  bookvaultService.submitOrder = async () => ({ PodRef: 7002 });
  resendClient.sendEmail = async () => { throw new Error('temporary mail outage'); };
  stripeService.refundPayment = async () => { refundCalls += 1; };

  await fulfillmentService.processOrder(order);
  const stored = orderService.getById(order.id);
  assert.equal(stored.order_status, 'BOOKVAULT_ACCEPTED');
  assert.equal(stored.bookvault_order_id, '7002');
  assert.equal(stored.confirmation_email_sent_at, null);
  assert.equal(refundCalls, 0);
});
