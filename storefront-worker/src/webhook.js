import { applyPaymentEvent, attachPaymentIntent, getOrderById, getOrderByPaymentIntent } from './orderStore.js';
import { stripeClient, verifyWebhook } from './stripeClient.js';

async function recordError(db, type, message) {
  await db.prepare('INSERT INTO error_logs(id,service,error_type,error_message) VALUES(?,?,?,?)')
    .bind(crypto.randomUUID(), 'stripe', type, String(message).slice(0, 1000)).run();
}

export async function stripeWebhook(request, env, { client = stripeClient, verify = verifyWebhook } = {}) {
  const signature = request.headers.get('stripe-signature');
  let event;
  try {
    event = await verify(client(env.STRIPE_SECRET_KEY), await request.text(), signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    try { await recordError(env.DB, 'webhook_signature_verification_failed', error.message); } catch { /* Keep response bounded. */ }
    return new Response('Webhook signature verification failed.', { status: 400 });
  }
  const transition = {
    'payment_intent.succeeded': 'PAYMENT_RECEIVED',
    'payment_intent.payment_failed': 'FAILED',
    'payment_intent.processing': 'PAYMENT_PROCESSING',
  }[event.type];
  if (!transition) return Response.json({ received: true });

  const intent = event.data?.object;
  try {
    if (!intent?.id || !intent.metadata?.order_id) throw new Error('Payment event has no order reference.');
    let order = await getOrderByPaymentIntent(env.DB, intent.id);
    if (!order) {
      // Stripe may complete before the attachment write is acknowledged.
      // Recover only against the original UUID and exact saved amount.
      order = await getOrderById(env.DB, intent.metadata.order_id);
      if (!order || order.stripe_payment_intent_id) throw new Error('PaymentIntent has no matching pending order.');
      if (Number(intent.amount) !== Number(order.total_price_cents) ||
          String(intent.currency).toLowerCase() !== String(order.currency).toLowerCase()) {
        throw new Error('Payment amount or currency did not match the original order.');
      }
      await attachPaymentIntent(env.DB, order.id, intent.id);
    }
    if (intent.metadata.order_id !== order.id ||
        Number(intent.amount) !== Number(order.total_price_cents) ||
        String(intent.currency).toLowerCase() !== String(order.currency).toLowerCase()) {
      throw new Error('Payment event does not match the stored order.');
    }
    if (transition === 'PAYMENT_RECEIVED' &&
        (intent.status !== 'succeeded' || Number(intent.amount_received) !== Number(order.total_price_cents))) {
      throw new Error('Successful payment event lacks the full captured order amount.');
    }
    await applyPaymentEvent(env.DB, intent.id, transition, intent.status, event.livemode,
      transition === 'FAILED' ? intent.last_payment_error : null);
    return Response.json({ received: true });
  } catch (error) {
    try { await recordError(env.DB, 'webhook_processing_failed', error.message); } catch { /* Stripe will retry. */ }
    return Response.json({ error: 'webhook_processing_failed' }, { status: 500 });
  }
}
