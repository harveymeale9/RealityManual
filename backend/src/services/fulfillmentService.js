const bookvaultService = require('./bookvaultService');
const config = require('../config');
const stripeService = require('./stripeService');
const orderService = require('./orderService');
const errorLogService = require('./errorLogService');
const { resendClient } = require('./resendService');
const {
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
} = require('./emailTemplates');

const RETRY_MINUTES = [1, 5, 20, 60, 240];
const STATUS_POLL_MINUTES = 15;
let processing = false;

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function sendTemplate(order, kind, template, suffix) {
  const column = `${kind}_email_sent_at`;
  if (order[column]) return;
  await resendClient.sendEmail({
    to: order.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    idempotencyKey: `${order.id}-${suffix}`,
  });
  orderService.markEmailSent(order.id, kind);
}

async function refundUnfulfillableOrder(order, failureMessage) {
  await stripeService.refundPayment(order.stripe_payment_intent_id, order.id);
  const refunded = orderService.setOrderStatus(order.id, 'REFUNDED');
  await sendTemplate(refunded, 'refund', orderRefundedEmail(refunded), 'refund');
  errorLogService.logError({
    orderId: order.id,
    service: 'refund',
    errorType: 'fulfillment_exhausted_refunded',
    errorMessage: failureMessage,
    attemptNumber: Number(order.fulfillment_attempts || 0) + 1,
  });
}

async function submitToBookVault(order) {
  let accepted;
  try {
    const result = await bookvaultService.submitOrder(order);
    accepted = orderService.setBookVaultAccepted(order.id, result.PodRef);
  } catch (err) {
    const attempts = Number(order.fulfillment_attempts || 0) + 1;
    errorLogService.logError({
      orderId: order.id,
      service: 'bookvault',
      errorType: 'order_submission_failed',
      errorMessage: err.message,
      requestReference: order.id,
      attemptNumber: attempts,
    });

    if (attempts >= RETRY_MINUTES.length) {
      await refundUnfulfillableOrder({ ...order, fulfillment_attempts: attempts - 1 }, err.message);
      return;
    }
    orderService.setFulfillmentRetry(
      order.id,
      attempts,
      err.message,
      minutesFromNow(RETRY_MINUTES[attempts - 1]),
    );
    return;
  }

  try {
    await sendTemplate(accepted, 'confirmation', orderConfirmedEmail(accepted), 'confirmed');
  } catch (err) {
    // Email delivery must never turn an accepted print order into a refund or
    // cause a duplicate submission. The accepted order remains pollable and
    // the worker will retry this same idempotent email independently.
    errorLogService.logError({
      orderId: order.id,
      service: 'resend',
      errorType: 'confirmation_email_failed',
      errorMessage: err.message,
    });
  }
  orderService.setNextAttempt(order.id, minutesFromNow(STATUS_POLL_MINUTES));
}

async function checkBookVaultProgress(order) {
  try {
    const current = await bookvaultService.getOrder(order.bookvault_order_id);
    const status = current?.Progress?.Status;
    if (status === 'Dispatched') {
      const shipment = {
        carrierName: current?.Tracking?.ServName || order.shipping_service_name,
        trackingNumber: current?.Tracking?.TrackingNumber,
        trackingUrl: current?.Tracking?.CombinedURL,
      };
      await sendTemplate(order, 'shipping', orderShippedEmail(order, shipment), 'shipped');
      orderService.setOrderStatus(order.id, 'SHIPPED');
      return;
    }

    // Order-status polling is intentionally durable. It survives restarts and
    // means shipment emails do not depend on a separate BookVault webhook.
    orderService.setNextAttempt(order.id, minutesFromNow(STATUS_POLL_MINUTES));
  } catch (err) {
    errorLogService.logError({
      orderId: order.id,
      service: 'bookvault',
      errorType: 'order_status_poll_failed',
      errorMessage: err.message,
      requestReference: order.bookvault_order_id,
    });
    orderService.setNextAttempt(order.id, minutesFromNow(STATUS_POLL_MINUTES));
  }
}

async function processOrder(order) {
  if (order.order_status === 'REFUNDED') {
    if (!order.refund_email_sent_at) {
      try {
        await sendTemplate(order, 'refund', orderRefundedEmail(order), 'refund');
      } catch (err) {
        errorLogService.logError({
          orderId: order.id,
          service: 'resend',
          errorType: 'refund_email_failed',
          errorMessage: err.message,
        });
        orderService.setNextAttempt(order.id, minutesFromNow(STATUS_POLL_MINUTES));
      }
    }
    return;
  }
  if (order.order_status === 'BOOKVAULT_ACCEPTED') {
    if (!order.confirmation_email_sent_at) {
      try {
        await sendTemplate(order, 'confirmation', orderConfirmedEmail(order), 'confirmed');
      } catch (err) {
        errorLogService.logError({
          orderId: order.id,
          service: 'resend',
          errorType: 'confirmation_email_failed',
          errorMessage: err.message,
        });
      }
    }
    await checkBookVaultProgress(orderService.getById(order.id));
    return;
  }
  await submitToBookVault(order);
}

async function processPendingOrders() {
  if (!config.fulfillment.enabled) return;
  if (processing) return;
  processing = true;
  try {
    const orders = orderService.listFulfillmentCandidates();
    for (const order of orders) {
      try {
        await processOrder(order);
      } catch (err) {
        errorLogService.logError({
          orderId: order.id,
          service: 'backend',
          errorType: 'fulfillment_order_processing_failed',
          errorMessage: err.message,
        });
      }
    }
  } finally {
    processing = false;
  }
}

function startFulfillmentWorker() {
  // The first pass catches work left durable in SQLite across restarts.
  setImmediate(() => processPendingOrders().catch((err) => console.error('[fulfillment] worker failed:', err.message)));
  const timer = setInterval(
    () => processPendingOrders().catch((err) => console.error('[fulfillment] worker failed:', err.message)),
    60_000,
  );
  timer.unref();
  return timer;
}

module.exports = { processPendingOrders, processOrder, startFulfillmentWorker };
