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
const bookvaultCostService = require('../src/services/bookvaultCostService');
const exchangeRateService = require('../src/services/exchangeRateService');
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
  assert.deepEqual(payload.CustomsDeclaration, {
    UseOrderValue: true,
    HSCode: '49019900',
    UseIOSS: false,
    IncoTerms: 'DDU',
  });
});

test('BookVault payload omits customs declaration for domestic UK orders', () => {
  const order = paidOrder();
  order.country = 'GB';
  const payload = bookvaultService.orderPayload(order);
  assert.equal(payload.CustomsDeclaration, undefined);
});

test('an existing BookVault payment draft is not mistaken for an accepted print order', () => {
  assert.throws(() => bookvaultService.assertExistingOrderPaid({
    PodRef: 3074612, Status: 'BatchPayment', Progress: { Status: 'Created' },
  }), /not active/);
  assert.equal(bookvaultService.assertExistingOrderPaid({
    PodRef: 3072310, Status: 'Active', Progress: { Status: 'Acknowledged' },
  }).PodRef, 3072310);
});

test('paid order is submitted once, emailed, then dispatch is emailed with tracking', async () => {
  const order = paidOrder();
  const sent = [];
  const synced = [];
  let submissions = 0;
  bookvaultService.submitOrder = async () => {
    submissions += 1;
    return { PodRef: 7001 };
  };
  bookvaultService.getOrder = async () => ({
    Partner: { ID: 1, CurrencyID: 'GBP' },
    OrderCost: { ProductionCost: 19.77, DispatchCost: 17.41, GrandTotal: 39.18 },
  });
  exchangeRateService.latestGbpUsdRate = async () => 1.339;
  resendClient.sendEmail = async (message) => {
    sent.push(message);
    return { id: `email_${sent.length}` };
  };
  resendClient.syncPurchaserContact = async (contactOrder, summary) => {
    synced.push({ contactOrder, summary });
  };

  await fulfillmentService.processOrder(order);
  let stored = orderService.getById(order.id);
  assert.equal(stored.order_status, 'BOOKVAULT_ACCEPTED');
  assert.equal(stored.bookvault_order_id, '7001');
  assert.equal(stored.bookvault_production_cost_gbp_cents, 1977);
  assert.equal(stored.bookvault_shipping_cost_gbp_cents, 1741);
  assert.equal(stored.bookvault_total_cost_gbp_cents, 3918);
  assert.equal(stored.bookvault_total_cost_usd_cents, Math.ceil(3918 * 1.339));
  assert.ok(stored.confirmation_email_sent_at);
  assert.equal(submissions, 1);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].summary.purchase_order_count, 1);
  assert.equal(synced[0].summary.lifetime_book_quantity, 1);
  assert.ok(stored.resend_contact_synced_at);
  assert.equal(sent[0].subject, 'We’re Making Your Copy of The Reality Manual!');
  assert.deepEqual(sent[0].tags, [
    { name: 'email_type', value: 'confirmation_email' },
    { name: 'customer_status', value: 'purchaser' },
    { name: 'product', value: 'reality_manual_hardcover' },
    { name: 'quantity_band', value: '1_book' },
  ]);

  bookvaultService.getOrder = async () => ({
    Partner: { ID: 1, CurrencyID: 'GBP' },
    OrderCost: { ProductionCost: 19.77, DispatchCost: 17.41, GrandTotal: 39.18 },
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
  bookvaultService.getOrder = async () => ({
    Partner: { ID: 1, CurrencyID: 'GBP' },
    OrderCost: { ProductionCost: 19.77, DispatchCost: 17.41, GrandTotal: 37.18 },
  });
  resendClient.syncPurchaserContact = async () => {};
  resendClient.sendEmail = async () => { throw new Error('temporary mail outage'); };
  stripeService.refundPayment = async () => { refundCalls += 1; };

  await fulfillmentService.processOrder(order);
  const stored = orderService.getById(order.id);
  assert.equal(stored.order_status, 'BOOKVAULT_ACCEPTED');
  assert.equal(stored.bookvault_order_id, '7002');
  assert.equal(stored.confirmation_email_sent_at, null);
  assert.equal(refundCalls, 0);
});

test('a Resend contact-sync outage does not block confirmation or fulfillment', async () => {
  const order = paidOrder();
  const sent = [];
  bookvaultService.submitOrder = async () => ({ PodRef: 7003 });
  bookvaultService.getOrder = async () => ({
    Partner: { ID: 1, CurrencyID: 'GBP' },
    OrderCost: { ProductionCost: 19.77, DispatchCost: 17.41, GrandTotal: 37.18 },
  });
  resendClient.syncPurchaserContact = async () => { throw new Error('contacts temporarily unavailable'); };
  resendClient.sendEmail = async (message) => {
    sent.push(message);
    return { id: 'email_contact_outage' };
  };

  await fulfillmentService.processOrder(order);
  const stored = orderService.getById(order.id);
  assert.equal(stored.order_status, 'BOOKVAULT_ACCEPTED');
  assert.equal(stored.resend_contact_synced_at, null);
  assert.ok(stored.confirmation_email_sent_at);
  assert.equal(sent.length, 1);
});

test('BookVault cost uses grand total including tax and retains the order FX snapshot', async () => {
  const order = paidOrder();
  orderService.setBookVaultAccepted(order.id, '7004');
  const first = await bookvaultCostService.recordBookVaultCost(orderService.getById(order.id), {
    Partner: { ID: 1, CurrencyID: 'GBP' },
    OrderCost: { ProductionCost: 19.77, DispatchCost: 13.64, Tax: 2.33, GrandTotal: 35.74 },
  });
  assert.equal(first.bookvault_total_cost_gbp_cents, 3574);
  assert.equal(first.bookvault_total_cost_usd_cents, Math.ceil(3574 * 1.339));
  const revised = await bookvaultCostService.recordBookVaultCost(first, {
    Partner: { ID: 1, CurrencyID: 'GBP' },
    OrderCost: { ProductionCost: 19.77, DispatchCost: 13.64, Tax: 3.51, GrandTotal: 36.92 },
  }, 1.1);
  assert.equal(revised.bookvault_gbp_usd_rate, 1.339);
  assert.equal(revised.bookvault_total_cost_usd_cents, Math.ceil(3692 * 1.339));
  assert.throws(() => bookvaultCostService.extractBookVaultCost({
    Partner: { ID: 2, CurrencyID: 'USD' }, OrderCost: { GrandTotal: 12 },
  }), /UK GBP/);
  assert.throws(() => bookvaultCostService.extractBookVaultCost({
    Partner: { ID: 1, CurrencyID: 'GBP' }, OrderCost: { ProductionCost: 19.77, DispatchCost: 13.64 },
  }), /missing or invalid/);
});
