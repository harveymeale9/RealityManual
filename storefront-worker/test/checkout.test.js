import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { checkoutRoute } from '../src/checkout.js';
import { stripeWebhook } from '../src/webhook.js';
import { processPendingOrders } from '../src/fulfillment.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../backend/src/db/schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        first: async () => statement.get(),
        bind(...args) {
          return {
            first: async () => statement.get(...args) || null,
            run: async () => ({ meta: { changes: statement.run(...args).changes } }),
          };
        },
      };
    },
  };
  const env = {
    DB: db, CHECKOUT_ENABLED: 'true', CORS_ORIGIN: 'https://realitymanual.com',
    STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_PUBLISHABLE_KEY: 'pk_test_mock',
  };
  return { sqlite, db, env };
}

const body = {
  customer_name: 'Test Customer', email: 'test@example.test', phone: '+1 555 555 5555',
  country_code: 'US', street1: '1 Test Road', city: 'New York', state: 'NY',
  postal_code: '10001', quantity: 1, quoted_total_price_cents: 8310,
  review_request_opt_in: false,
  attribution: { first: { utm_source: 'youtube', utm_medium: 'long-form', utm_content: 'video185', referrer: 'https://youtube.com/watch?v=secret' } },
};
const totals = {
  bookPriceCents: 6500, bookSubtotalCents: 6500, shippingPriceCents: 1810,
  totalPriceCents: 8310, currency: 'usd', quantity: 1, serviceName: 'USPS Consolidator',
  serviceId: 99, minDeliveryDays: 7, maxDeliveryDays: 14, shippingUpgraded: false,
};
const makeRequest = (path, data) => new Request(`https://example.test${path}`, {
  method: 'POST', headers: { origin: 'https://realitymanual.com', 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

test('checkout saves one D1 order and returns the existing browser contract', async () => {
  const { sqlite, env } = fixture();
  const calls = [];
  const response = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent', body), env,
    '/api/checkout/create-payment-intent', {
      quote: async () => totals,
      payments: () => ({ paymentIntents: { create: async (...args) => {
        calls.push(args);
        return { id: 'pi_test_one', client_secret: 'pi_test_one_secret' };
      } } }),
    });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.client_secret, 'pi_test_one_secret');
  assert.equal(result.total_price_cents, 8310);
  const order = sqlite.prepare('SELECT * FROM orders').get();
  assert.equal(order.id, result.order_id);
  assert.equal(order.stripe_payment_intent_id, 'pi_test_one');
  assert.equal(order.order_status, 'PAYMENT_PENDING');
  assert.equal(JSON.parse(order.attribution_json).first.referrer_host, 'youtube.com');
  assert.equal(calls[0][1].idempotencyKey, `rm-order-${order.id}`);
  sqlite.close();
});

test('changed quote and invalid input do not create a D1 order or Stripe PaymentIntent', async () => {
  const { sqlite, env } = fixture();
  const deps = { quote: async () => ({ ...totals, totalPriceCents: 8400 }), payments: () => { throw new Error('Stripe must not be called.'); } };
  const changed = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent', body), env,
    '/api/checkout/create-payment-intent', deps);
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'shipping_quote_changed');
  const invalid = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent', { ...body, email: 'bad' }), env,
    '/api/checkout/create-payment-intent', deps);
  assert.equal(invalid.status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  sqlite.close();
});

test('Canadian postcodes are canonical before quote, payment, and saved BookVault address', async () => {
  const { sqlite, env } = fixture();
  const canadian = { ...body, country_code: 'CA', postal_code: 'k1a0b1' };
  const quoted = [];
  const deps = {
    quote: async (_env, country, postal) => { quoted.push([country, postal]); return totals; },
    payments: () => ({ paymentIntents: { create: async () => ({ id: 'pi_ca', client_secret: 'secret' }) } }),
  };
  const shipping = await checkoutRoute(makeRequest('/api/shipping/calculate', canadian), env,
    '/api/shipping/calculate', deps);
  assert.equal(shipping.status, 200);
  const payment = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent', canadian), env,
    '/api/checkout/create-payment-intent', deps);
  assert.equal(payment.status, 200);
  assert.deepEqual(quoted, [['CA', 'K1A 0B1'], ['CA', 'K1A 0B1']]);
  assert.equal(sqlite.prepare('SELECT postal_code FROM orders').get().postal_code, 'K1A 0B1');
  const invalid = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent',
    { ...canadian, postal_code: 'not-a-postcode' }), env, '/api/checkout/create-payment-intent', deps);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).fields.postal_code, 'Enter a Canadian postal code in the format A1A 1A1.');
  const malformedCountry = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent',
    { ...canadian, country_code: 123 }), env, '/api/checkout/create-payment-intent', deps);
  assert.equal(malformedCountry.status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
  sqlite.close();
});

test('a signed-style paid webhook changes only the matching fully paid order', async () => {
  const { sqlite, env } = fixture();
  const create = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent', body), env,
    '/api/checkout/create-payment-intent', {
      quote: async () => totals,
      payments: () => ({ paymentIntents: { create: async () => ({ id: 'pi_test_paid', client_secret: 'secret' }) } }),
    });
  const { order_id: orderId } = await create.json();
  const event = { type: 'payment_intent.succeeded', livemode: true, data: { object: {
    id: 'pi_test_paid', status: 'succeeded', amount: 8310, amount_received: 8310, currency: 'usd', metadata: { order_id: orderId },
  } } };
  const deps = { client: () => ({}), verify: async () => event };
  const first = await stripeWebhook(makeRequest('/api/webhooks/stripe', {}), env, deps);
  assert.equal(first.status, 200);
  assert.equal(sqlite.prepare('SELECT order_status FROM orders').get().order_status, 'PAYMENT_RECEIVED');
  const duplicate = await stripeWebhook(makeRequest('/api/webhooks/stripe', {}), env, deps);
  assert.equal(duplicate.status, 200);
  assert.equal(sqlite.prepare('SELECT order_status FROM orders').get().order_status, 'PAYMENT_RECEIVED');
  const forgedAmount = structuredClone(event);
  forgedAmount.data.object.amount_received = 1;
  const rejected = await stripeWebhook(makeRequest('/api/webhooks/stripe', {}), env,
    { client: () => ({}), verify: async () => forgedAmount });
  assert.equal(rejected.status, 500);
  assert.equal(sqlite.prepare('SELECT order_status FROM orders').get().order_status, 'PAYMENT_RECEIVED');
  sqlite.close();
});

test('a paid order receives one receipt and one BookVault DocRef submission', async () => {
  const { sqlite, env } = fixture();
  const create = await checkoutRoute(makeRequest('/api/checkout/create-payment-intent', body), env,
    '/api/checkout/create-payment-intent', {
      quote: async () => totals,
      payments: () => ({ paymentIntents: { create: async () => ({ id: 'pi_fulfill', client_secret: 'secret' }) } }),
    });
  const { order_id: orderId } = await create.json();
  sqlite.prepare(`UPDATE orders SET order_status='PAYMENT_RECEIVED', stripe_livemode=1,
    payment_received_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(orderId);
  env.FULFILLMENT_ENABLED = 'true';
  env.BOOKVAULT_API_KEY = 'test-bookvault';
  env.BOOKVAULT_TITLE_ISBN = '9658364000016';
  env.RESEND_API_KEY = 'test-resend';
  env.RESEND_FROM_EMAIL = 'orders@example.test';
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options.method]);
    if (String(url).includes('/emails')) return new Response(JSON.stringify({ id: 'email-one' }));
    if (String(url).includes('DocRef=')) return new Response(JSON.stringify({ Message: 'Not found' }), { status: 404 });
    if (options.method === 'POST') return new Response(JSON.stringify({ PodRef: 12345, Status: 'Active' }));
    return new Response(JSON.stringify({ PodRef: 12345, DocRef: orderId, Status: 'Active', Progress: { Status: 'Created' } }));
  };
  try {
    assert.equal(await processPendingOrders(env), 1);
    const order = sqlite.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    assert.equal(order.order_status, 'BOOKVAULT_ACCEPTED');
    assert.equal(order.bookvault_order_id, '12345');
    assert.ok(order.confirmation_email_sent_at);
    assert.equal(calls.filter(([, method]) => method === 'POST').length, 2);
    assert.equal(await processPendingOrders(env), 0);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
