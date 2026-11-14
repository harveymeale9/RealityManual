const bookvaultService = require('./bookvaultService');
const bookvaultCostService = require('./bookvaultCostService');
const config = require('../config');
const stripeService = require('./stripeService');
const orderService = require('./orderService');
const errorLogService = require('./errorLogService');
const { resendClient, quantityBand } = require('./resendService');
const {
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
} = require('./emailTemplates');

const RETRY_MINUTES = [1, 5, 20, 60, 60];
const FULFILLMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_POLL_MINUTES = 15;
let processing = false;
let lastStripeReconcileAt = 0;

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function fulfillmentDeadline(order) {
  const paidAt = Date.parse(order.payment_received_at || order.created_at || '');
  return Number.isFinite(paidAt) ? paidAt + FULFILLMENT_WINDOW_MS : null;
}

async function alertOwner(order, message) {
  if (order.fulfillment_alert_sent_at) return;
  try {
    const shortId = order.id.slice(0, 8);
    await resendClient.sendEmail({
      to: process.env.ORDER_ALERT_EMAIL || 'harveymeale9@gmail.com',
      subject: `Action needed: paid order ${shortId} awaiting BookVault`,
      html: `<p>A customer payment was accepted, but BookVault has not accepted order ${shortId}.</p><p>${String(message).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p><p>Check the BookVault title and GBP funding. The 24-hour refund deadline is ${new Date(fulfillmentDeadline(order) || Date.now()).toISOString()}.</p>`,
      text: `Paid order ${shortId} is awaiting BookVault. ${message}\n24-hour refund deadline: ${new Date(fulfillmentDeadline(order) || Date.now()).toISOString()}.`,
      idempotencyKey: `${order.id}-fulfillment-alert`,
    });
    orderService.markFulfillmentAlertSent(order.id);
  } catch (err) {
    errorLogService.logError({ orderId: order.id, service: 'resend', errorType: 'fulfillment_alert_failed', errorMessage: err.message });
  }
}

async function alertOwnerDeadline(order, message) {
  if (order.fulfillment_deadline_alert_sent_at) return;
  try {
    await resendClient.sendEmail({
      to: process.env.ORDER_ALERT_EMAIL || 'harveymeale9@gmail.com',
      subject: `URGENT: paid order ${order.id.slice(0, 8)} needs manual refund review`,
      html: `<p>The 24-hour BookVault deadline passed for paid order ${order.id.slice(0, 8)}, but a safe refund could not be verified.</p><p>${String(message).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`,
      text: `The 24-hour BookVault deadline passed for paid order ${order.id.slice(0, 8)}, but a safe refund could not be verified. ${message}`,
      idempotencyKey: `${order.id}-fulfillment-deadline-alert`,
    });
    orderService.markFulfillmentDeadlineAlertSent(order.id);
  } catch (err) {
    errorLogService.logError({ orderId: order.id, service: 'resend', errorType: 'fulfillment_deadline_alert_failed', errorMessage: err.message });
  }
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
    tags: [
      { name: 'email_type', value: `${kind}_email` },
      { name: 'customer_status', value: kind === 'refund' ? 'refunded' : 'purchaser' },
      { name: 'product', value: 'reality_manual_hardcover' },
      { name: 'quantity_band', value: quantityBand(order.quantity) },
    ],
  });
  orderService.markEmailSent(order.id, kind);
}

async function syncPurchaserContact(order) {
  if (order.resend_contact_synced_at) return true;
  try {
    const summary = orderService.getPurchaseSummaryForEmail(order.email);
    await resendClient.syncPurchaserContact(order, summary);
    orderService.markResendContactSynced(order.id);
    return true;
  } catch (err) {
    // Contact segmentation is useful marketing metadata, but it must never
    // block confirmation mail, BookVault submission, or shipment polling.
    errorLogService.logError({
      orderId: order.id,
      service: 'resend',
      errorType: 'purchaser_contact_sync_failed',
      errorMessage: err.message,
    });
    orderService.setNextAttempt(order.id, minutesFromNow(STATUS_POLL_MINUTES));
    return false;
  }
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

async function captureBookVaultCost(order, bookvaultOrder) {
  try {
    await bookvaultCostService.recordBookVaultCost(order, bookvaultOrder);
  } catch (err) {
    // Cost reporting must never delay fulfillment or customer email. The
    // existing 15-minute order poll will retry with BookVault's full order.
    errorLogService.logError({
      orderId: order.id,
      service: 'bookvault',
      errorType: 'order_cost_capture_failed',
      errorMessage: err.message,
    });
  }
}

async function submitToBookVault(order) {
  let accepted;
  try {
    const result = await bookvaultService.submitOrder(order);
    accepted = orderService.setBookVaultAccepted(order.id, result.PodRef);
  } catch (err) {
    if (err.podRef && !order.bookvault_order_id) {
      orderService.setBookVaultReference(order.id, err.podRef);
      order = orderService.getById(order.id);
    }
    const attempts = Number(order.fulfillment_attempts || 0) + 1;
    errorLogService.logError({
      orderId: order.id,
      service: 'bookvault',
      errorType: 'order_submission_failed',
      errorMessage: err.message,
      requestReference: order.id,
      attemptNumber: attempts,
    });

    await alertOwner(order, err.message);
    const deadline = fulfillmentDeadline(order);
    if (deadline && Date.now() >= deadline) {
      try {
        // A saved BookVault draft must be cancelled before refunding the
        // shopper, or later funding could fulfill an already-refunded order.
        await bookvaultService.cancelUnpaidDraft(order.id, order.bookvault_order_id);
        await refundUnfulfillableOrder(order, err.message);
        return;
      } catch (reviewError) {
        errorLogService.logError({ orderId: order.id, service: 'backend', errorType: 'fulfillment_refund_needs_review', errorMessage: reviewError.message });
        await alertOwnerDeadline(order, reviewError.message);
      }
    }
    orderService.setFulfillmentRetry(
      order.id,
      attempts,
      err.message,
      new Date(deadline && deadline <= Date.now()
        ? Date.now() + 15 * 60_000
        : Math.min(Date.now() + RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)] * 60_000, deadline || Infinity)).toISOString(),
    );
    return;
  }

  await syncPurchaserContact(accepted);
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

  // Keep the customer-facing acceptance/email path ahead of this optional
  // cost lookup; a slow BookVault read must not delay confirmation.
  try {
    const fullOrder = await bookvaultService.getOrder(accepted.bookvault_order_id);
    await captureBookVaultCost(accepted, fullOrder);
  } catch (err) {
    errorLogService.logError({
      orderId: accepted.id,
      service: 'bookvault',
      errorType: 'order_cost_lookup_failed',
      errorMessage: err.message,
    });
  }
}

async function checkBookVaultProgress(order) {
  try {
    const current = await bookvaultService.getOrder(order.bookvault_order_id);
    if (String(current?.Status).toLowerCase() !== 'active') {
      orderService.setFulfillmentRetry(order.id, order.fulfillment_attempts || 1,
        `BookVault reference is not active (${current?.Status || 'unknown'}).`, minutesFromNow(1));
      await alertOwner(order, `BookVault reference remains ${current?.Status || 'unknown'}.`);
      return;
    }
    await captureBookVaultCost(order, current);
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
  if (order.order_status === 'SHIPPED') {
    await syncPurchaserContact(order);
    return;
  }
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
    await syncPurchaserContact(order);
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
  // A successful Stripe payment is an accepted storefront order. Tell the
  // customer promptly; BookVault production is a separate, monitored step.
  if (!order.confirmation_email_sent_at) {
    try { await sendTemplate(order, 'confirmation', orderConfirmedEmail(order), 'confirmed'); }
    catch (err) { errorLogService.logError({ orderId: order.id, service: 'resend', errorType: 'confirmation_email_failed', errorMessage: err.message }); }
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

async function reconcilePendingPayments() {
  const candidates = orderService.listPaymentReconcileCandidates();
  for (const order of candidates) {
    try {
      const payment = await stripeService.stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (payment.status !== 'succeeded' || payment.amount_received !== order.total_price_cents ||
          String(payment.currency).toLowerCase() !== String(order.currency).toLowerCase() ||
          payment.metadata?.order_id !== order.id) continue;
      orderService.updateStatusByPaymentIntentId(payment.id, 'PAYMENT_RECEIVED', payment.status, payment.livemode);
    } catch (err) {
      errorLogService.logError({ orderId: order.id, service: 'stripe', errorType: 'payment_reconcile_failed', errorMessage: err.message });
    }
  }
}

function startFulfillmentWorker() {
  // The first pass catches work left durable in SQLite across restarts.
  setImmediate(async () => {
    try { await reconcilePendingPayments(); await processPendingOrders(); lastStripeReconcileAt = Date.now(); }
    catch (err) { console.error('[fulfillment] worker failed:', err.message); }
  });
  const timer = setInterval(
    async () => {
      try {
        if (Date.now() - lastStripeReconcileAt >= 5 * 60_000) {
          await reconcilePendingPayments();
          lastStripeReconcileAt = Date.now();
        }
        await processPendingOrders();
      } catch (err) { console.error('[fulfillment] worker failed:', err.message); }
    },
    60_000,
  );
  timer.unref();
  return timer;
}

module.exports = { processPendingOrders, processOrder, reconcilePendingPayments, startFulfillmentWorker };
