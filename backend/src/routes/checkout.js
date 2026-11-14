const express = require('express');
const { validateCheckoutInput, normalizeQuantity } = require('../lib/validation');
const shippingService = require('../services/shippingService');
const orderService = require('../services/orderService');
const stripeService = require('../services/stripeService');
const errorLogService = require('../services/errorLogService');
const config = require('../config');
const recovery = require('../services/checkoutRecoveryService');

const router = express.Router();

// A shopper must actively opt in. This is deliberately separate from order
// creation, so an incomplete form can still be recovered without collecting
// any address or payment details.
router.post('/recovery-email', (req, res) => {
  const origin = req.get('Origin');
  if (!origin || !config.corsOrigins.includes(origin)) return res.sendStatus(403);
  const { capture_id: captureId, email, consent } = req.body || {};
  if (typeof captureId !== 'string' || !/^[a-f0-9-]{36}$/i.test(captureId)) return res.sendStatus(400);
  if (consent === false) {
    recovery.remove(captureId);
    return res.sendStatus(204);
  }
  if (consent !== true || typeof email !== 'string' || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.sendStatus(400);
  recovery.save(captureId, email);
  res.sendStatus(204);
});

router.get('/availability', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ available: !config.checkoutPaused });
});

router.post('/create-payment-intent', async (req, res) => {
  if (config.checkoutPaused) {
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({
      error: 'checkout_temporarily_unavailable',
      message: 'Orders are temporarily unavailable while we resolve a printer issue. No payment has been taken. Please check back later.',
    });
  }
  const body = req.body || {};
  const errors = validateCheckoutInput(body);

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'validation_failed', fields: errors });
  }

  if (orderService.hasRecentPaidOrder(body.email)) {
    return res.status(409).json({
      error: 'recent_payment_exists',
      message: 'A payment for this email was received recently. Please do not pay again. Check your order email or contact us if you need help.',
    });
  }

  const countryCode = body.country_code.trim().toUpperCase();
  const postalCode = body.postal_code.trim();
  const quantity = normalizeQuantity(body.quantity); // already validated non-null above

  let totals;
  try {
    totals = await shippingService.calculateTotal(countryCode, postalCode, quantity);
  } catch (err) {
    errorLogService.logError({
      service: 'backend',
      errorType: 'shipping_calculation_failed',
      errorMessage: err.message,
    });
    return res.status(500).json({ error: 'shipping_unavailable', message: 'Unable to calculate shipping right now.' });
  }

  // The checkout form quotes before submission, but BookVault or the FX rate
  // can change between that display and this authoritative re-quote. Do not
  // create a PaymentIntent for an amount the shopper has not just seen.
  const displayedTotal = Number(body.quoted_total_price_cents);
  if (!Number.isSafeInteger(displayedTotal) || displayedTotal !== totals.totalPriceCents) {
    return res.status(409).json({
      error: 'shipping_quote_changed',
      message: 'Shipping has been updated. Please review the new total and click Pay again.',
      book_subtotal_cents: totals.bookSubtotalCents,
      shipping_price_cents: totals.shippingPriceCents,
      total_price_cents: totals.totalPriceCents,
      currency: totals.currency,
      quantity: totals.quantity,
      shipping_upgraded: totals.shippingUpgraded,
    });
  }

  // Order row is created before the Stripe call so we always have an
  // internal order ID to associate with the PaymentIntent's metadata.
  const order = orderService.createOrder({
    ...body,
    country_code: countryCode,
    quantity,
    bookPriceCents: totals.bookPriceCents,
    shippingPriceCents: totals.shippingPriceCents,
    shippingServiceName: totals.serviceName,
    shippingServiceId: totals.serviceId,
    shippingMinDeliveryDays: totals.minDeliveryDays,
    shippingMaxDeliveryDays: totals.maxDeliveryDays,
    totalPriceCents: totals.totalPriceCents,
    currency: totals.currency,
  });

  try {
    const paymentIntent = await stripeService.createPaymentIntent({
      amountCents: totals.totalPriceCents,
      currency: totals.currency,
      orderId: order.id,
      country: countryCode,
      quantity,
    });

    orderService.attachPaymentIntent(order.id, paymentIntent.id);

    res.json({
      order_id: order.id,
      client_secret: paymentIntent.client_secret,
      book_price_cents: totals.bookPriceCents,
      book_subtotal_cents: totals.bookSubtotalCents,
      shipping_price_cents: totals.shippingPriceCents,
      total_price_cents: totals.totalPriceCents,
      currency: totals.currency,
      quantity,
    });
  } catch (err) {
    errorLogService.logError({
      orderId: order.id,
      service: 'stripe',
      errorType: 'payment_intent_creation_failed',
      errorMessage: err.message,
    });
    res.status(502).json({
      error: 'payment_setup_failed',
      message: 'We could not set up payment for this order. Please try again.',
    });
  }
});

module.exports = router;
