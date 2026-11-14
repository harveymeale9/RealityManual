const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const config = require('../src/config');
const router = require('../src/routes/checkout');
const orderService = require('../src/services/orderService');

test('paused checkout blocks payment-intent creation before validation or Stripe', async () => {
  const old = config.checkoutPaused;
  config.checkoutPaused = true;
  const app = express();
  app.use(express.json());
  app.use('/api/checkout', router);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const availability = await fetch(`${base}/api/checkout/availability`);
    assert.deepEqual(await availability.json(), { available: false });
    assert.match(availability.headers.get('cache-control'), /no-store/);
    const response = await fetch(`${base}/api/checkout/create-payment-intent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'checkout_temporarily_unavailable');
    assert.match(body.message, /No payment has been taken/);
  } finally {
    config.checkoutPaused = old;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a recent paid order blocks a second PaymentIntent before contacting BookVault', async () => {
  const oldPause = config.checkoutPaused;
  const oldRecent = orderService.hasRecentPaidOrder;
  config.checkoutPaused = false;
  orderService.hasRecentPaidOrder = () => true;
  const app = express();
  app.use(express.json());
  app.use('/api/checkout', router);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/checkout/create-payment-intent`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_name: 'Test Customer', email: 'test@example.com', phone: '+1234567890',
        country_code: 'CA', street1: '1 Test St', city: 'Toronto', postal_code: 'M5V 2T6', quantity: 1 }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'recent_payment_exists');
  } finally {
    config.checkoutPaused = oldPause;
    orderService.hasRecentPaidOrder = oldRecent;
    await new Promise((resolve) => server.close(resolve));
  }
});
