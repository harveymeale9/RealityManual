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
    // allow_redirects: 'never' keeps this to card/wallet methods that
    // complete inline (Payment Element), not redirect-based methods like
    // Klarna/Affirm/Cashapp/Amazon Pay — unnecessary complexity for a
    // single $39 product and would otherwise require return_url handling.
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
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
