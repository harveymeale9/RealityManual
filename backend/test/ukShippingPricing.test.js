const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-uk-shipping-'));
process.env.DATABASE_PATH = path.join(scratch, 'test.db');
process.env.BOOKVAULT_API_KEY = 'test_key_not_sent';
process.env.BOOKVAULT_TITLE_ISBN = '9781234567890';

const bookvault = require('../src/services/bookvaultService');
const exchange = require('../src/services/exchangeRateService');
const shipping = require('../src/services/shippingService');
const checkoutRoute = require('../src/routes/checkout');
const orderService = require('../src/services/orderService');
const stripeService = require('../src/services/stripeService');

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('UK quote and order target the same print partner, and GBP is converted to USD', async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    if (String(url).includes('/Dispatch')) {
      const body = JSON.parse(options.body);
      seen.push(body);
      return { ok: true, json: async () => ({
        PartnerID: 1,
        Services: [{ ServID: 125, ServName: 'World Post', DelTotal: 17.41,
          MinDeliveryDays: 6, MaxDeliveryDays: 12 }],
      }), text: async () => JSON.stringify({ PartnerID: 1, Services: [
        { ServID: 125, ServName: 'World Post', DelTotal: 17.41,
          MinDeliveryDays: 6, MaxDeliveryDays: 12 },
      ] }) };
    }
    if (String(url).includes('frankfurter.dev')) {
      return { ok: true, json: async () => ({ date: new Date().toISOString().slice(0, 10),
        base: 'GBP', quote: 'USD', rate: 1.339 }) };
    }
    throw new Error('Unexpected request');
  };
  try {
    const total = await shipping.calculateTotal('CA', 'M5V 2T6', 1);
    assert.equal(total.shippingPriceCents, 2332);
    assert.equal(total.totalPriceCents, 8832);
    assert.equal(total.serviceId, 125);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].PartnerID, 1);
    assert.equal(seen[0].Currency, 'GBP');
    assert.equal(seen[0].CountryCode, 'CA');
    const order = bookvault.orderPayload({ id: 'test-order', shipping_service_id: 125,
      country: 'CA', quantity: 1, customer_name: 'Test', street1: 'Test', city: 'Test',
      state: 'Test', postal_code: 'M5V 2T6', phone: '1234567890', email: 'test@example.com' });
    assert.equal(order.PartnerID, seen[0].PartnerID);
    assert.deepEqual(order.DispatchRequest.RequestedServID, [125]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('a quote for a different partner fails instead of charging a fallback', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({
    PartnerID: 2, Services: [{ ServID: 125, ServName: 'World Post', DelTotal: 13.08 }],
  }) });
  try {
    await assert.rejects(shipping.calculateTotal('CA', 'M5V 2T6', 1), /UK print partner/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('a changed displayed total cannot create an order or PaymentIntent', async () => {
  const originalCalculate = shipping.calculateTotal;
  const originalCreateOrder = orderService.createOrder;
  const originalCreateIntent = stripeService.createPaymentIntent;
  shipping.calculateTotal = async () => ({ bookPriceCents: 6500, bookSubtotalCents: 6500,
    shippingPriceCents: 2332, totalPriceCents: 8832, currency: 'usd', quantity: 1,
    shippingUpgraded: false });
  orderService.createOrder = () => { throw new Error('Order should not be created'); };
  stripeService.createPaymentIntent = () => { throw new Error('PaymentIntent should not be created'); };
  const app = express();
  app.use(express.json());
  app.use('/api/checkout', checkoutRoute);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout/create-payment-intent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: 'Test Customer', email: 'test@example.com',
        phone: '+1234567890', country_code: 'CA', street1: '1 Test St', city: 'Toronto',
        postal_code: 'M5V 2T6', quantity: 1, quoted_total_price_cents: 7808 }),
    });
    const data = await response.json();
    assert.equal(response.status, 409);
    assert.equal(data.error, 'shipping_quote_changed');
    assert.equal(data.shipping_price_cents, 2332);
    assert.equal(data.total_price_cents, 8832);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    shipping.calculateTotal = originalCalculate;
    orderService.createOrder = originalCreateOrder;
    stripeService.createPaymentIntent = originalCreateIntent;
  }
});
