import { calculateTotal } from './shipping.js';
import { createPaymentIntent, stripeClient } from './stripeClient.js';
import { attachPaymentIntent, createOrder, getOrderById, hasRecentPaidOrder, toPublicStatus } from './orderStore.js';
import { normalizeOrderAttribution, normalizeQuantity, validateCheckoutInput } from './validation.js';

const PRODUCT_NAME = 'The Reality Manual';
const PRODUCT_DESCRIPTION = 'Hardcover — Deluxe First Edition';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > 16384) return null;
  try {
    const raw = await request.text();
    if (raw.length > 16384) return null;
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

async function logError(db, { orderId = null, service, type, message }) {
  try {
    await db.prepare(`INSERT INTO error_logs(id,order_id,service,error_type,error_message)
      VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(), orderId, service, type, String(message).slice(0, 1000)).run();
  } catch { /* Logging must not replace the customer-facing error. */ }
}

// All calls stay behind CHECKOUT_ENABLED until the webhook, email, and
// BookVault worker have passed their own release checks.
export async function checkoutRoute(request, env, path, { quote = calculateTotal, payments = stripeClient } = {}) {
  if (path === '/api/checkout/availability' && request.method === 'GET') {
    return json({ available: env.CHECKOUT_ENABLED === 'true' });
  }
  if (env.CHECKOUT_ENABLED !== 'true') {
    return json({ error: 'checkout_temporarily_unavailable', message: 'Orders are temporarily unavailable. No payment has been taken.' }, 503);
  }
  if (path === '/api/config/stripe' && request.method === 'GET') {
    if (!env.STRIPE_PUBLISHABLE_KEY) return json({ error: 'payment_configuration_unavailable' }, 503);
    return json({ publishable_key: env.STRIPE_PUBLISHABLE_KEY });
  }
  if (path === '/api/orders' || path.startsWith('/api/orders/')) {
    const match = /^\/api\/orders\/([^/]+)\/status$/.exec(path);
    if (!match || request.method !== 'GET' || !UUID.test(match[1])) return json({ error: 'order_not_found' }, 404);
    const order = await getOrderById(env.DB, match[1]);
    return order ? json(toPublicStatus(order, PRODUCT_NAME, PRODUCT_DESCRIPTION)) : json({ error: 'order_not_found' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid_json' }, 400);

  if (path === '/api/checkout/recovery-email') {
    const origin = request.headers.get('origin');
    const allowed = String(env.CORS_ORIGIN || '').split(',').map((item) => item.trim());
    if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403 });
    const { capture_id: captureId, email, consent } = body;
    if (typeof captureId !== 'string' || !UUID.test(captureId)) return new Response(null, { status: 400 });
    if (consent === false) {
      await env.DB.prepare('DELETE FROM checkout_recovery_contacts WHERE capture_id = ?').bind(captureId).run();
      return new Response(null, { status: 204 });
    }
    if (consent !== true || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return new Response(null, { status: 400 });
    await env.DB.prepare(`INSERT INTO checkout_recovery_contacts(capture_id,email) VALUES(?,?)
      ON CONFLICT(capture_id) DO UPDATE SET email = excluded.email, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(captureId, email.trim()).run();
    return new Response(null, { status: 204 });
  }

  if (path === '/api/shipping/calculate') {
    const country = String(body.country_code || '').trim().toUpperCase();
    const postcode = String(body.postal_code || '').trim();
    const quantity = normalizeQuantity(body.quantity);
    if (!/^[A-Z]{2}$/.test(country)) return json({ error: 'invalid_country_code', message: 'Please select a valid country.' }, 400);
    if (!postcode) return json({ error: 'invalid_postal_code', message: 'Please enter a postal/ZIP code.' }, 400);
    if (quantity === null) return json({ error: 'invalid_quantity', message: 'Quantity must be a whole number between 1 and 20.' }, 400);
    try {
      const totals = await quote(env, country, postcode, quantity);
      return json({
        book_price_cents: totals.bookPriceCents, book_subtotal_cents: totals.bookSubtotalCents,
        shipping_price_cents: totals.shippingPriceCents, total_price_cents: totals.totalPriceCents,
        currency: totals.currency, quantity: totals.quantity, shipping_upgraded: totals.shippingUpgraded,
      });
    } catch (error) {
      await logError(env.DB, { service: 'worker', type: 'shipping_calculation_failed', message: error.message });
      return json({ error: 'shipping_unavailable', message: 'Unable to calculate shipping right now.' }, 500);
    }
  }

  if (path !== '/api/checkout/create-payment-intent') return json({ error: 'not_found' }, 404);
  const errors = validateCheckoutInput(body);
  if (Object.keys(errors).length) return json({ error: 'validation_failed', fields: errors }, 400);
  if (await hasRecentPaidOrder(env.DB, body.email)) return json({
    error: 'recent_payment_exists',
    message: 'A payment for this email was received recently. Please do not pay again. Check your order email or contact us if you need help.',
  }, 409);

  const country = body.country_code.trim().toUpperCase();
  const postcode = body.postal_code.trim();
  const quantity = normalizeQuantity(body.quantity);
  let totals;
  try {
    totals = await quote(env, country, postcode, quantity);
  } catch (error) {
    await logError(env.DB, { service: 'worker', type: 'shipping_calculation_failed', message: error.message });
    return json({ error: 'shipping_unavailable', message: 'Unable to calculate shipping right now.' }, 500);
  }
  if (!Number.isSafeInteger(body.quoted_total_price_cents) || body.quoted_total_price_cents !== totals.totalPriceCents) {
    return json({
      error: 'shipping_quote_changed', message: 'Shipping has been updated. Please review the new total and click Pay again.',
      book_subtotal_cents: totals.bookSubtotalCents, shipping_price_cents: totals.shippingPriceCents,
      total_price_cents: totals.totalPriceCents, currency: totals.currency, quantity: totals.quantity,
      shipping_upgraded: totals.shippingUpgraded,
    }, 409);
  }

  const order = await createOrder(env.DB, body, totals, normalizeOrderAttribution(body.attribution));
  try {
    const intent = await createPaymentIntent(payments(env.STRIPE_SECRET_KEY), {
      amountCents: totals.totalPriceCents, currency: totals.currency, orderId: order.id, country, quantity,
    });
    await attachPaymentIntent(env.DB, order.id, intent.id);
    return json({
      order_id: order.id, client_secret: intent.client_secret,
      book_price_cents: totals.bookPriceCents, book_subtotal_cents: totals.bookSubtotalCents,
      shipping_price_cents: totals.shippingPriceCents, total_price_cents: totals.totalPriceCents,
      currency: totals.currency, quantity,
    });
  } catch (error) {
    await logError(env.DB, { orderId: order.id, service: 'stripe', type: 'payment_intent_creation_failed', message: error.message });
    return json({ error: 'payment_setup_failed', message: 'We could not set up payment for this order. Please try again.' }, 502);
  }
}
