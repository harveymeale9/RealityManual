const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (
    id, customer_name, email, phone, country, street1, street2, city, state, postal_code, quantity,
    book_price_cents, shipping_price_cents, shipping_service_name, shipping_service_id, shipping_min_delivery_days,
    shipping_max_delivery_days, total_price_cents, currency, order_status
  ) VALUES (
    @id, @customer_name, @email, @phone, @country, @street1, @street2, @city, @state, @postal_code, @quantity,
    @book_price_cents, @shipping_price_cents, @shipping_service_name, @shipping_service_id, @shipping_min_delivery_days,
    @shipping_max_delivery_days, @total_price_cents, @currency, 'PAYMENT_PENDING'
  )
`);

const setPaymentIntentStmt = db.prepare(`
  UPDATE orders SET stripe_payment_intent_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
`);

const getByIdStmt = db.prepare('SELECT * FROM orders WHERE id = ?');
const getByPaymentIntentStmt = db.prepare('SELECT * FROM orders WHERE stripe_payment_intent_id = ?');

const updateStatusByPaymentIntentStmt = db.prepare(`
  UPDATE orders
  SET order_status = ?, stripe_payment_status = ?, stripe_livemode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE stripe_payment_intent_id = ?
`);

const fulfillmentCandidatesStmt = db.prepare(`
  SELECT * FROM orders
  WHERE order_status IN ('PAYMENT_RECEIVED', 'FULFILLMENT_RETRY', 'BOOKVAULT_ACCEPTED', 'REFUNDED')
    AND stripe_livemode = 1
    AND (fulfillment_next_attempt_at IS NULL OR fulfillment_next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ORDER BY created_at ASC
  LIMIT ?
`);

const setBookVaultAcceptedStmt = db.prepare(`
  UPDATE orders
  SET bookvault_order_id = ?, order_status = 'BOOKVAULT_ACCEPTED',
      fulfillment_last_error = NULL, fulfillment_next_attempt_at = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);

const setFulfillmentRetryStmt = db.prepare(`
  UPDATE orders
  SET order_status = 'FULFILLMENT_RETRY', fulfillment_attempts = ?,
      fulfillment_last_error = ?, fulfillment_next_attempt_at = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);

const setOrderStatusStmt = db.prepare(`
  UPDATE orders SET order_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
`);
const setNextAttemptStmt = db.prepare(`
  UPDATE orders SET fulfillment_next_attempt_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
`);

const markEmailSentStmt = {
  confirmation: db.prepare("UPDATE orders SET confirmation_email_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"),
  shipping: db.prepare("UPDATE orders SET shipping_email_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"),
  refund: db.prepare("UPDATE orders SET refund_email_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"),
};

function createOrder(input) {
  const id = uuidv4();
  insertOrderStmt.run({
    id,
    customer_name: input.customer_name.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    country: input.country_code.trim().toUpperCase(),
    street1: input.street1.trim(),
    street2: input.street2 ? input.street2.trim() : null,
    city: input.city.trim(),
    state: input.state ? input.state.trim() : null,
    postal_code: input.postal_code.trim(),
    quantity: input.quantity,
    book_price_cents: input.bookPriceCents,
    shipping_price_cents: input.shippingPriceCents,
    shipping_service_name: input.shippingServiceName || null,
    shipping_service_id: input.shippingServiceId || null,
    shipping_min_delivery_days: input.shippingMinDeliveryDays || null,
    shipping_max_delivery_days: input.shippingMaxDeliveryDays || null,
    total_price_cents: input.totalPriceCents,
    currency: input.currency,
  });
  return getByIdStmt.get(id);
}

function attachPaymentIntent(orderId, paymentIntentId) {
  setPaymentIntentStmt.run(paymentIntentId, orderId);
}

function getById(orderId) {
  return getByIdStmt.get(orderId);
}

function getByPaymentIntentId(paymentIntentId) {
  return getByPaymentIntentStmt.get(paymentIntentId);
}

// Idempotent: only actually changes anything if the order isn't already in
// the target status. Stripe may deliver the same webhook event more than once.
function updateStatusByPaymentIntentId(paymentIntentId, newStatus, stripePaymentStatus, liveMode = false) {
  const order = getByPaymentIntentStmt.get(paymentIntentId);
  if (!order) return null;
  if (order.order_status === newStatus) return order; // already applied — no-op

  updateStatusByPaymentIntentStmt.run(newStatus, stripePaymentStatus, liveMode ? 1 : 0, paymentIntentId);
  return getByPaymentIntentStmt.get(paymentIntentId);
}

function listFulfillmentCandidates(limit = 20) {
  return fulfillmentCandidatesStmt.all(limit);
}

function setBookVaultAccepted(orderId, podRef) {
  setBookVaultAcceptedStmt.run(String(podRef), orderId);
  return getByIdStmt.get(orderId);
}

function setFulfillmentRetry(orderId, attempts, errorMessage, nextAttemptAt) {
  setFulfillmentRetryStmt.run(attempts, String(errorMessage).slice(0, 2000), nextAttemptAt, orderId);
}

function setOrderStatus(orderId, status) {
  setOrderStatusStmt.run(status, orderId);
  return getByIdStmt.get(orderId);
}

function setNextAttempt(orderId, nextAttemptAt) {
  setNextAttemptStmt.run(nextAttemptAt, orderId);
}

function markEmailSent(orderId, kind) {
  const statement = markEmailSentStmt[kind];
  if (!statement) throw new Error(`Unknown email kind: ${kind}`);
  statement.run(orderId);
}

// Only the subset of fields safe to expose to an unauthenticated customer
// polling the confirmation page.
function toPublicStatus(order) {
  if (!order) return null;
  return {
    order_id: order.id,
    order_status: order.order_status,
    product_name: config.site.productName,
    product_description: config.site.productDescription,
    quantity: order.quantity,
    total_price_cents: order.total_price_cents,
    currency: order.currency,
  };
}

module.exports = {
  createOrder,
  attachPaymentIntent,
  getById,
  getByPaymentIntentId,
  updateStatusByPaymentIntentId,
  listFulfillmentCandidates,
  setBookVaultAccepted,
  setFulfillmentRetry,
  setOrderStatus,
  setNextAttempt,
  markEmailSent,
  toPublicStatus,
};
