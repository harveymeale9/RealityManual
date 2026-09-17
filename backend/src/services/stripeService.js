const Stripe = require('stripe');
const config = require('../config');

// A placeholder key lets the process boot cleanly before real test keys are
// supplied; any actual Stripe call will fail loudly with a clear Stripe
// auth error rather than crashing the server at startup.
const stripe = new Stripe(config.stripe.secretKey || 'sk_test_not_configured', {
  apiVersion: '2026-04-22.dahlia',
});

async function createPaymentIntent({ amountCents, currency, orderId, country }) {
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    // Explicit ['card'] rather than automatic_payment_methods — the latter
    // was surfacing every non-redirect method enabled in the Dashboard
    // (Link, Cash App Pay, etc.) as separate tabs on the Payment Element,
    // which read as cluttered for a single $65 product. Card still covers
    // Apple Pay / Google Pay (they ride on the card payment method when
    // enabled in the Dashboard and supported by the browser/device) —
    // just not Link or anything redirect-based.
    payment_method_types: ['card'],
    metadata: {
      order_id: orderId,
      product: 'reality-manual-first-edition-hardcover',
      country,
    },
  });
}

// Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET.
// Throws if the signature is invalid — callers must respond 400 in that case.
function constructWebhookEvent(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, config.stripe.webhookSecret);
}

module.exports = { stripe, createPaymentIntent, constructWebhookEvent };
