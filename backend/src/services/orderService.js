const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');
const { normalizeOrderAttribution } = require('../lib/orderAttribution');

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (
    id, customer_name, email, phone, country, street1, street2, city, state, postal_code, quantity,
    book_price_cents, shipping_price_cents, shipping_service_name, shipping_service_id, shipping_min_delivery_days,
    shipping_max_delivery_days, total_price_cents, currency, review_request_opt_in,
    review_request_opt_in_at, attribution_json, order_status
  ) VALUES (
    @id, @customer_name, @email, @phone, @country, @street1, @street2, @city, @state, @postal_code, @quantity,
    @book_price_cents, @shipping_price_cents, @shipping_service_name, @shipping_service_id, @shipping_min_delivery_days,
    @shipping_max_delivery_days, @total_price_cents, @currency, @review_request_opt_in,
    @review_request_opt_in_at, @attribution_json, 'PAYMENT_PENDING'
  )
`);

const setPaymentIntentStmt = db.prepare(`
  UPDATE orders SET stripe_payment_intent_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
`);

const getByIdStmt = db.prepare('SELECT * FROM orders WHERE id = ?');
const getByPaymentIntentStmt = db.prepare('SELECT * FROM orders WHERE stripe_payment_intent_id = ?');

const updateStatusByPaymentIntentStmt = db.prepare(`
  UPDATE orders
  SET order_status = ?, stripe_payment_status = ?, stripe_livemode = ?,
      payment_failure_type = CASE WHEN ? = 'FAILED' THEN payment_failure_type ELSE NULL END,
      payment_failure_code = CASE WHEN ? = 'FAILED' THEN payment_failure_code ELSE NULL END,
      payment_decline_code = CASE WHEN ? = 'FAILED' THEN payment_decline_code ELSE NULL END,
      payment_failure_message = CASE WHEN ? = 'FAILED' THEN payment_failure_message ELSE NULL END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE stripe_payment_intent_id = ?
`);
const setPaymentFailureStmt = db.prepare(`
  UPDATE orders SET payment_failure_type = ?, payment_failure_code = ?,
    payment_decline_code = ?, payment_failure_message = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE stripe_payment_intent_id = ? AND order_status = 'FAILED'
`);

const fulfillmentCandidatesStmt = db.prepare(`
  SELECT * FROM orders
  WHERE stripe_livemode = 1
    AND (
      order_status IN ('PAYMENT_RECEIVED', 'FULFILLMENT_RETRY', 'BOOKVAULT_ACCEPTED', 'REFUNDED')
      OR (order_status = 'SHIPPED' AND resend_contact_synced_at IS NULL)
    )
    AND (fulfillment_next_attempt_at IS NULL OR fulfillment_next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ORDER BY created_at ASC
  LIMIT ?
`);

const reviewRequestCandidatesStmt = db.prepare(`
  SELECT * FROM orders
  WHERE stripe_livemode = 1
    AND order_status = 'SHIPPED'
    AND bookvault_order_id IS NOT NULL
    AND shipping_email_sent_at IS NOT NULL
    AND refund_email_sent_at IS NULL
    AND review_request_opt_in = 1
    AND review_request_email_sent_at IS NULL
    AND review_request_skipped_at IS NULL
    AND review_request_opt_out_at IS NULL
  ORDER BY shipping_email_sent_at ASC
  LIMIT ?
`);

const setBookVaultAcceptedStmt = db.prepare(`
  UPDATE orders
  SET bookvault_order_id = ?, order_status = 'BOOKVAULT_ACCEPTED',
      fulfillment_last_error = NULL, fulfillment_next_attempt_at = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);

const setBookVaultCostStmt = db.prepare(`
  UPDATE orders SET bookvault_production_cost_gbp_cents = ?,
    bookvault_shipping_cost_gbp_cents = ?,
    bookvault_total_cost_gbp_cents = ?,
    bookvault_total_cost_usd_cents = ?,
    bookvault_gbp_usd_rate = ?,
    bookvault_cost_recorded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ? AND bookvault_order_id IS NOT NULL
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
  review: db.prepare("UPDATE orders SET review_request_email_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"),
};
const markReviewRequestSkippedStmt = db.prepare("UPDATE orders SET review_request_skipped_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
const suppressReviewRequestsStmt = db.prepare(`
  UPDATE orders SET review_request_opt_out_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE LOWER(email) = LOWER(?) AND review_request_email_sent_at IS NULL
`);
const markResendContactSyncedStmt = db.prepare(`
  UPDATE orders
  SET resend_contact_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);
const purchaseSummaryStmt = db.prepare(`
  SELECT COUNT(*) AS purchase_order_count,
         COALESCE(SUM(quantity), 0) AS lifetime_book_quantity,
         COALESCE(MAX(quantity), 0) AS largest_order_quantity,
         MIN(created_at) AS first_purchase_at,
         MAX(created_at) AS latest_purchase_at
  FROM orders
  WHERE LOWER(email) = LOWER(?)
    AND order_status IN ('BOOKVAULT_ACCEPTED', 'SHIPPED')
`);

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
    review_request_opt_in: input.review_request_opt_in === true ? 1 : 0,
    review_request_opt_in_at: input.review_request_opt_in === true ? new Date().toISOString() : null,
    attribution_json: normalizeOrderAttribution(input.attribution),
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

  updateStatusByPaymentIntentStmt.run(newStatus, stripePaymentStatus, liveMode ? 1 : 0,
    newStatus, newStatus, newStatus, newStatus, paymentIntentId);
  return getByPaymentIntentStmt.get(paymentIntentId);
}

function recordPaymentFailure(paymentIntentId, error) {
  const clean = (value, max) => value == null ? null : String(value).slice(0, max);
  setPaymentFailureStmt.run(
    clean(error?.type, 60), clean(error?.code, 100),
    clean(error?.decline_code, 100), clean(error?.message, 300), paymentIntentId,
  );
}

function listFulfillmentCandidates(limit = 20) {
  return fulfillmentCandidatesStmt.all(limit);
}

function listReviewRequestCandidates(limit = 50) {
  return reviewRequestCandidatesStmt.all(limit);
}

function setBookVaultAccepted(orderId, podRef) {
  setBookVaultAcceptedStmt.run(String(podRef), orderId);
  return getByIdStmt.get(orderId);
}

function setBookVaultCost(orderId, cost) {
  setBookVaultCostStmt.run(
    cost.productionGbpCents, cost.shippingGbpCents, cost.totalGbpCents,
    cost.totalUsdCents, cost.gbpUsdRate, orderId,
  );
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

function markReviewRequestSkipped(orderId) {
  markReviewRequestSkippedStmt.run(orderId);
}

function suppressReviewRequestsForOrder(orderId) {
  const order = getByIdStmt.get(orderId);
  if (!order) return false;
  suppressReviewRequestsStmt.run(order.email);
  return true;
}

function markResendContactSynced(orderId) {
  markResendContactSyncedStmt.run(orderId);
}

function getPurchaseSummaryForEmail(email) {
  return purchaseSummaryStmt.get(String(email || '').trim());
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
  recordPaymentFailure,
  listFulfillmentCandidates,
  listReviewRequestCandidates,
  setBookVaultAccepted,
  setBookVaultCost,
  setFulfillmentRetry,
  setOrderStatus,
  setNextAttempt,
  markEmailSent,
  markReviewRequestSkipped,
  suppressReviewRequestsForOrder,
  markResendContactSynced,
  getPurchaseSummaryForEmail,
  toPublicStatus,
};
