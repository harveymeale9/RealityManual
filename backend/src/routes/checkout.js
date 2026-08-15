const express = require('express');
const { validateCheckoutInput } = require('../lib/validation');
const shippingService = require('../services/shippingService');
const orderService = require('../services/orderService');
const stripeService = require('../services/stripeService');
const errorLogService = require('../services/errorLogService');

const router = express.Router();

router.post('/create-payment-intent', async (req, res) => {
  const body = req.body || {};
  const errors = validateCheckoutInput(body);

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: 'validation_failed', fields: errors });
  }

  const countryCode = body.country_code.trim().toUpperCase();

  let totals;
  try {
    totals = shippingService.calculateTotal(countryCode);
  } catch (err) {
    errorLogService.logError({
      service: 'backend',
      errorType: 'shipping_calculation_failed',
      errorMessage: err.message,
    });
    return res.status(500).json({ error: 'shipping_unavailable', message: 'Unable to calculate shipping right now.' });
  }

  // Order row is created before the Stripe call so we always have an
  // internal order ID to associate with the PaymentIntent's metadata.
  const order = orderService.createOrder({
    ...body,
    country_code: countryCode,
    bookPriceCents: totals.bookPriceCents,
    shippingPriceCents: totals.shippingPriceCents,
    totalPriceCents: totals.totalPriceCents,
    currency: totals.currency,
  });

  try {
    const paymentIntent = await stripeService.createPaymentIntent({
      amountCents: totals.totalPriceCents,
      currency: totals.currency,
      orderId: order.id,
      country: countryCode,
    });

    orderService.attachPaymentIntent(order.id, paymentIntent.id);

    res.json({
      order_id: order.id,
      client_secret: paymentIntent.client_secret,
      book_price_cents: totals.bookPriceCents,
      shipping_price_cents: totals.shippingPriceCents,
      total_price_cents: totals.totalPriceCents,
      currency: totals.currency,
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
