const Stripe = require('stripe');
const config = require('../config');

// A placeholder key lets the process boot cleanly before real test keys are
// supplied; any actual Stripe call will fail loudly with a clear Stripe
// auth error rather than crashing the server at startup.
const stripe = new Stripe(config.stripe.secretKey || 'sk_test_not_configured', {
  apiVersion: '2026-04-22.dahlia',
});

// `card` covers ordinary cards plus eligible Apple Pay and Google Pay
// wallets. `link` adds Link explicitly; eligible US Link customers can use
// Stripe's Instant Bank Payments funding source without exposing a delayed
// ACH Debit method. Keep this list controlled rather than enabling every
// Dashboard method (Klarna, Afterpay, Cash App, etc.).
const PAYMENT_METHOD_TYPES = Object.freeze(['card', 'link']);

async function createPaymentIntent({ amountCents, currency, orderId, country, quantity }) {
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency,
    payment_method_types: PAYMENT_METHOD_TYPES,
    metadata: {
      order_id: orderId,
      product: 'reality-manual-first-edition-hardcover',
      country,
      quantity: String(quantity),
    },
  });
}

// Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET.
// Throws if the signature is invalid — callers must respond 400 in that case.
function constructWebhookEvent(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, config.stripe.webhookSecret);
}

async function refundPayment(paymentIntentId, orderId) {
  return stripe.refunds.create(
    { payment_intent: paymentIntentId, metadata: { order_id: orderId, reason: 'bookvault_fulfillment_failed' } },
    { idempotencyKey: `bookvault-failure-${orderId}` },
  );
}

module.exports = {
  stripe,
  PAYMENT_METHOD_TYPES,
  createPaymentIntent,
  constructWebhookEvent,
  refundPayment,
};
