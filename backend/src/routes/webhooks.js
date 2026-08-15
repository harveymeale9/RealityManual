const express = require('express');
const stripeService = require('../services/stripeService');
const orderService = require('../services/orderService');
const errorLogService = require('../services/errorLogService');

const router = express.Router();

// Stripe requires the raw, unparsed request body to verify the signature —
// this must not run behind the global express.json() middleware.
router.post('/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    errorLogService.logError({
      service: 'stripe',
      errorType: 'webhook_signature_verification_failed',
      errorMessage: err.message,
    });
    return res.status(400).send('Webhook signature verification failed.');
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const order = orderService.updateStatusByPaymentIntentId(pi.id, 'PAYMENT_RECEIVED', pi.status);
        if (!order) {
          errorLogService.logError({
            service: 'stripe',
            errorType: 'webhook_order_not_found',
            errorMessage: `No order found for payment_intent ${pi.id}`,
            requestReference: pi.id,
          });
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        orderService.updateStatusByPaymentIntentId(pi.id, 'FAILED', pi.status);
        break;
      }
      default:
        // Other event types aren't relevant to this phase — ignore.
        break;
    }

    // Always acknowledge receipt so Stripe doesn't retry an event we've
    // already (idempotently) handled.
    res.json({ received: true });
  } catch (err) {
    errorLogService.logError({
      service: 'stripe',
      errorType: 'webhook_processing_failed',
      errorMessage: err.message,
      requestReference: event?.id,
    });
    res.status(500).json({ error: 'webhook_processing_failed' });
  }
});

module.exports = router;
