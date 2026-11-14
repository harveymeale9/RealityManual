import test from 'node:test';
import assert from 'node:assert/strict';
import { assertActive, cancelUnpaidDraft, orderPayload, submitOrder } from '../src/bookvault.js';

const env = { BOOKVAULT_API_KEY: 'test-key', BOOKVAULT_TITLE_ISBN: '9658364000016' };
const order = {
  id: 'order-1', customer_name: 'Test Customer', street1: '1 Test Road', city: 'London',
  postal_code: 'SW1A 1AA', country: 'GB', phone: '123456789', email: 'test@example.test', quantity: 1,
};
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('a saved BookVault batch is pending, not production acceptance', async () => {
  const batch = { PodRef: 123, DocRef: order.id, Status: 'BatchPayment', Progress: { Status: 'Created' } };
  assert.equal(orderPayload(order, env.BOOKVAULT_TITLE_ISBN).DocRef, order.id);
  assert.throws(() => assertActive(batch), (error) => error.pendingPayment === true && error.podRef === 123);
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options.method]);
    if (calls.length === 1) return response(null, 404);
    return response(batch);
  };
  await assert.rejects(submitOrder(env, order, fetcher), (error) => error.pendingPayment === true && error.podRef === 123);
  assert.deepEqual(calls.map(([, method]) => method), ['GET', 'POST', 'GET']);
});

test('existing DocRef prevents a duplicate BookVault POST', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options.method]);
    return response({ PodRef: 123, DocRef: order.id, Status: 'Active' });
  };
  const found = await submitOrder(env, order, fetcher);
  assert.equal(found.PodRef, 123);
  assert.deepEqual(calls.map(([, method]) => method), ['GET']);
});

test('refund cancellation refuses an active BookVault order', async () => {
  const fetcher = async () => response({ PodRef: 123, DocRef: order.id, Status: 'Active' });
  await assert.rejects(cancelUnpaidDraft(env, order.id, 123, fetcher), /not a verified unpaid draft/);
});
