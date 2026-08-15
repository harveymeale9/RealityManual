const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (
    id, customer_name, email, phone, country, street1, street2, city, state, postal_code,
    book_price_cents, shipping_price_cents, total_price_cents, currency, order_status
  ) VALUES (
    @id, @customer_name, @email, @phone, @country, @street1, @street2, @city, @state, @postal_code,
    @book_price_cents, @shipping_price_cents, @total_price_cents, @currency, 'PAYMENT_PENDING'
  )
`);

const setPaymentIntentStmt = db.prepare(`
  UPDATE orders SET stripe_payment_intent_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
`);

const getByIdStmt = db.prepare('SELECT * FROM orders WHERE id = ?');
const getByPaymentIntentStmt = db.prepare('SELECT * FROM orders WHERE stripe_payment_intent_id = ?');

const updateStatusByPaymentIntentStmt = db.prepare(`
  UPDATE orders
  SET order_status = ?, stripe_payment_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE stripe_payment_intent_id = ?
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
    book_price_cents: input.bookPriceCents,
    shipping_price_cents: input.shippingPriceCents,
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
function updateStatusByPaymentIntentId(paymentIntentId, newStatus, stripePaymentStatus) {
  const order = getByPaymentIntentStmt.get(paymentIntentId);
  if (!order) return null;
  if (order.order_status === newStatus) return order; // already applied — no-op

  updateStatusByPaymentIntentStmt.run(newStatus, stripePaymentStatus, paymentIntentId);
  return getByPaymentIntentStmt.get(paymentIntentId);
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
  toPublicStatus,
};
