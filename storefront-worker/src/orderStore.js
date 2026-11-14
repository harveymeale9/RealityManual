// D1 payment-state transitions must be single conditional SQL updates. A
// delayed/duplicate Stripe event can never reopen a paid, printed or refunded
// order, even if two Worker invocations race.
const PAID_STATES = new Set(['PAYMENT_RECEIVED', 'FULFILLMENT_RETRY', 'BOOKVAULT_ACCEPTED', 'SHIPPED']);

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
