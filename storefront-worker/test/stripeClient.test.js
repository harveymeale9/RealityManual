import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeClient, createPaymentIntent, verifyWebhook, refundPayment } from '../src/stripeClient.js';

test('Stripe operations use the original order ID as their idempotency key', async () => {
  const calls = [];
  const client = {
    paymentIntents: { create: async (...args) => { calls.push(['create', ...args]); return { id: 'pi_test' }; } },
    refunds: { create: async (...args) => { calls.push(['refund', ...args]); return { id: 're_test' }; } },
  };
  await createPaymentIntent(client, { amountCents: 8329, currency: 'usd', orderId: 'order-1', country: 'US', quantity: 1 });
  assert.equal(calls[0][1].amount, 8329);
  assert.deepEqual(calls[0][1].payment_method_types, ['card', 'link']);
  assert.equal(calls[0][2].idempotencyKey, 'rm-order-order-1');
  await refundPayment(client, 'pi_test', 'order-1');
  assert.equal(calls[1][2].idempotencyKey, 'bookvault-failure-order-1');
});

test('Workers-compatible async webhook verification accepts only valid raw signed bodies', async () => {
  const client = stripeClient('sk_test_not_real');
  const raw = JSON.stringify({ id: 'evt_test', object: 'event', type: 'payment_intent.succeeded' });
  const secret = 'whsec_fixture';
  const signature = client.webhooks.generateTestHeaderString({ payload: raw, secret });
  const event = await verifyWebhook(client, raw, signature, secret);
  assert.equal(event.id, 'evt_test');
  await assert.rejects(verifyWebhook(client, `${raw} `, signature, secret), /signature/i);
});
