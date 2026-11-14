import Stripe from 'stripe';

const PAYMENT_METHOD_TYPES = Object.freeze(['card', 'link']);

export function stripeClient(secretKey) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured.');
  return new Stripe(secretKey, {
    apiVersion: '2026-04-22.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 1,
  });
}

export async function createPaymentIntent(client, { amountCents, currency, orderId, country, quantity }) {
  return client.paymentIntents.create({
    amount: amountCents,
    currency,
    payment_method_types: PAYMENT_METHOD_TYPES,
    metadata: {
      order_id: orderId,
      product: 'reality-manual-first-edition-hardcover',
      country,
      quantity: String(quantity),
    },
  }, { idempotencyKey: `rm-order-${orderId}` });
}

export async function verifyWebhook(client, rawBody, signature, signingSecret) {
  if (!signingSecret || !signature) throw new Error('Stripe webhook signing configuration is incomplete.');
  return client.webhooks.constructEventAsync(
    rawBody, signature, signingSecret, undefined, Stripe.createSubtleCryptoProvider(),
  );
}

export async function refundPayment(client, paymentIntentId, orderId) {
  return client.refunds.create({
    payment_intent: paymentIntentId,
    metadata: { order_id: orderId, reason: 'bookvault_fulfillment_failed' },
  }, { idempotencyKey: `bookvault-failure-${orderId}` });
}
