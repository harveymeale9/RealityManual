const orderService = require('./orderService');
const errorLogService = require('./errorLogService');
const { resendClient, quantityBand } = require('./resendService');
const { reviewRequestEmail } = require('./emailTemplates');
const { reviewRequestDueAt } = require('./reviewSchedule');

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let processing = false;

async function processReviewRequest(order, now = new Date()) {
  const dueAt = reviewRequestDueAt(order);
  if (!dueAt || new Date(dueAt) > now) return false;

  const contact = await resendClient.getContactByEmail(order.email);
  if (!contact) throw new Error('Purchaser contact not found in Resend; review request deferred.');
  if (contact.unsubscribed) {
    orderService.markReviewRequestSkipped(order.id);
    return false;
  }

  // Re-read after the network call so a just-arrived unsubscribe or refund
  // cannot be ignored by an earlier candidate snapshot.
  const latest = orderService.getById(order.id);
  if (!latest || latest.stripe_livemode !== 1 || latest.order_status !== 'SHIPPED' ||
      !latest.bookvault_order_id || !latest.shipping_email_sent_at || latest.refund_email_sent_at ||
      !latest.review_request_opt_in || latest.review_request_opt_out_at ||
      latest.review_request_email_sent_at || latest.review_request_skipped_at) return false;

  const email = reviewRequestEmail(latest);
  await resendClient.sendEmail({
    to: latest.email,
    ...email,
    idempotencyKey: `${latest.id}-review-request`,
    tags: [
      { name: 'email_type', value: 'review_request_email' },
      { name: 'customer_status', value: 'purchaser' },
      { name: 'product', value: 'reality_manual_hardcover' },
      { name: 'quantity_band', value: quantityBand(latest.quantity) },
    ],
  });
  orderService.markEmailSent(latest.id, 'review');
  return true;
}

async function processDueReviewRequests(now = new Date()) {
  if (processing) return;
  processing = true;
  try {
    for (const order of orderService.listReviewRequestCandidates()) {
      try {
        await processReviewRequest(order, now);
      } catch (error) {
        errorLogService.logError({
          orderId: order.id,
          service: 'resend',
          errorType: 'review_request_email_failed',
          errorMessage: error.message,
        });
      }
    }
  } finally {
    processing = false;
  }
}

function startReviewRequestWorker() {
  setImmediate(() => processDueReviewRequests().catch(error => console.error('[review] worker failed:', error.message)));
  const timer = setInterval(
    () => processDueReviewRequests().catch(error => console.error('[review] worker failed:', error.message)),
    SWEEP_INTERVAL_MS,
  );
  timer.unref();
  return timer;
}

module.exports = { processReviewRequest, processDueReviewRequests, startReviewRequestWorker };
