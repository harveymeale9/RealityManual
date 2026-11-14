// D1 payment-state transitions must be single conditional SQL updates. A
// delayed/duplicate Stripe event can never reopen a paid, printed or refunded
// order, even if two Worker invocations race.
const PAID_STATES = new Set(['PAYMENT_RECEIVED', 'FULFILLMENT_RETRY', 'BOOKVAULT_ACCEPTED', 'SHIPPED']);

export async function createOrder(db, body, totals, attributionJson) {
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO orders (
      id, customer_name, email, phone, country, street1, street2, city, state, postal_code,
      quantity, book_price_cents, shipping_price_cents, shipping_service_name, shipping_service_id,
      shipping_min_delivery_days, shipping_max_delivery_days, total_price_cents, currency,
      review_request_opt_in, review_request_opt_in_at, attribution_json, order_status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PAYMENT_PENDING')
  `).bind(
    id, body.customer_name.trim(), body.email.trim(), body.phone.trim(), body.country_code.trim().toUpperCase(),
    body.street1.trim(), body.street2?.trim() || null, body.city.trim(), body.state?.trim() || null,
    body.postal_code.trim(), totals.quantity, totals.bookPriceCents, totals.shippingPriceCents,
    totals.serviceName || null, totals.serviceId || null, totals.minDeliveryDays || null,
    totals.maxDeliveryDays || null, totals.totalPriceCents, totals.currency,
    body.review_request_opt_in === true ? 1 : 0,
    body.review_request_opt_in === true ? new Date().toISOString() : null,
    attributionJson,
  ).run();
  return getOrderById(db, id);
}

export async function attachPaymentIntent(db, orderId, paymentIntentId) {
  const result = await db.prepare(`UPDATE orders SET stripe_payment_intent_id = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ? AND stripe_payment_intent_id IS NULL AND order_status = 'PAYMENT_PENDING'`)
    .bind(paymentIntentId, orderId).run();
  if (result.meta?.changes !== 1) throw new Error('Could not attach Stripe payment to the pending order.');
}

export async function getOrderById(db, orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
}

export async function getOrderByPaymentIntent(db, paymentIntentId) {
  return db.prepare('SELECT * FROM orders WHERE stripe_payment_intent_id = ?').bind(paymentIntentId).first();
}

export async function hasRecentPaidOrder(db, email) {
  const row = await db.prepare(`
    SELECT id FROM orders WHERE LOWER(email) = LOWER(?) AND stripe_livemode = 1
      AND order_status IN ('PAYMENT_RECEIVED','FULFILLMENT_RETRY','BOOKVAULT_ACCEPTED','SHIPPED')
      AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')
    ORDER BY created_at DESC LIMIT 1
  `).bind(String(email || '').trim()).first();
  return Boolean(row);
}

const ELIGIBLE_SOURCE_STATES = {
  PAYMENT_RECEIVED: ['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'FAILED'],
  PAYMENT_PROCESSING: ['PAYMENT_PENDING', 'FAILED'],
  FAILED: ['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'FAILED'],
};

export async function applyPaymentEvent(db, paymentIntentId, newStatus, stripeStatus, liveMode, failure = null) {
  const eligible = ELIGIBLE_SOURCE_STATES[newStatus];
  if (!eligible) throw new Error(`Unsupported Stripe order transition: ${newStatus}`);
  const placeholders = eligible.map(() => '?').join(',');
  const failed = newStatus === 'FAILED';
  const clean = (value, max) => value == null ? null : String(value).slice(0, max);
  const result = await db.prepare(`
    UPDATE orders SET order_status = ?, stripe_payment_status = ?, stripe_livemode = ?,
      payment_received_at = CASE WHEN ? = 'PAYMENT_RECEIVED'
        THEN COALESCE(payment_received_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ELSE payment_received_at END,
      payment_failure_type = ?, payment_failure_code = ?, payment_decline_code = ?, payment_failure_message = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE stripe_payment_intent_id = ? AND order_status IN (${placeholders})
  `).bind(
    newStatus, stripeStatus, liveMode ? 1 : 0, newStatus,
    failed ? clean(failure?.type, 60) : null,
    failed ? clean(failure?.code, 100) : null,
    failed ? clean(failure?.decline_code, 100) : null,
    failed ? clean(failure?.message, 300) : null,
    paymentIntentId, ...eligible,
  ).run();
  const order = await getOrderByPaymentIntent(db, paymentIntentId);
  if (result.meta?.changes && order && newStatus === 'PAYMENT_RECEIVED' && liveMode) {
    await db.prepare('DELETE FROM checkout_recovery_contacts WHERE LOWER(email) = LOWER(?)').bind(order.email).run();
  }
  return { order, changed: Boolean(result.meta?.changes), paid: Boolean(order && PAID_STATES.has(order.order_status)) };
}

export function toPublicStatus(order, productName, productDescription) {
  if (!order) return null;
  return {
    order_id: order.id,
    order_status: order.order_status,
    product_name: productName,
    product_description: productDescription,
    quantity: order.quantity,
    total_price_cents: order.total_price_cents,
    currency: order.currency,
  };
}
