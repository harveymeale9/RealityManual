const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const config = require('../src/config');
const router = require('../src/routes/checkout');

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
