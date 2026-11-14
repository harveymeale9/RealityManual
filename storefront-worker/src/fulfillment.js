import { applyPaymentEvent, getOrderById } from './orderStore.js';
import { cancelUnpaidDraft, getOrder, submitOrder } from './bookvault.js';
import { orderConfirmedEmail, orderRefundedEmail, orderShippedEmail, quantityBand, sendEmail } from './mail.js';
import { refundPayment, stripeClient } from './stripeClient.js';
import { captureBookVaultCost } from './bookvaultCost.js';
import { syncPurchaserContact } from './resendContacts.js';

const RETRY_MINUTES = [1, 5, 20, 60, 60];
const STATUS_POLL_MINUTES = 15;
const ONE_DAY_MS = 86400000;
const nowIso = () => new Date().toISOString();
const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
const deadlineAt = (order) => Date.parse(order.payment_received_at || order.created_at) + ONE_DAY_MS;

async function log(db, orderId, service, type, error, attempt = 1) {
  try {
    await db.prepare(`INSERT INTO error_logs(id,order_id,service,error_type,error_message,attempt_number)
      VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(), orderId, service, type, String(error).slice(0, 2000), attempt).run();
  } catch { /* Keep retrying the original operation. */ }
}

async function update(db, orderId, sql, ...values) {
  await db.prepare(`${sql}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(...values, orderId).run();
}

async function next(db, order, minutes = STATUS_POLL_MINUTES) {
  await update(db, order.id, 'UPDATE orders SET fulfillment_next_attempt_at = ?', later(minutes));
}

async function syncPurchaser(env, order) {
  if (order.resend_contact_synced_at) return true;
  try {
    const summary = await env.DB.prepare(`SELECT COUNT(*) AS purchase_order_count,
      COALESCE(SUM(quantity),0) AS lifetime_book_quantity,
      COALESCE(MAX(quantity),0) AS largest_order_quantity,
      MIN(created_at) AS first_purchase_at, MAX(created_at) AS latest_purchase_at
      FROM orders WHERE LOWER(email) = LOWER(?)
      AND order_status IN ('BOOKVAULT_ACCEPTED','SHIPPED')`).bind(order.email).first();
    await syncPurchaserContact(env, order, summary);
    await update(env.DB, order.id, 'UPDATE orders SET resend_contact_synced_at = ?', nowIso());
    return true;
  } catch (error) {
    await log(env.DB, order.id, 'resend', 'purchaser_contact_sync_failed', error.message);
    await next(env.DB, order);
    return false;
  }
}

async function sendTemplate(env, order, kind, template, suffix) {
  if (order[`${kind}_email_sent_at`]) return;
  await sendEmail(env, {
    to: order.email, ...template, idempotencyKey: `${order.id}-${suffix}`,
    tags: [
      { name: 'email_type', value: `${kind}_email` },
      { name: 'customer_status', value: kind === 'refund' ? 'refunded' : 'purchaser' },
      { name: 'product', value: 'reality_manual_hardcover' },
      { name: 'quantity_band', value: quantityBand(order.quantity) },
    ],
  });
  await update(env.DB, order.id, `UPDATE orders SET ${kind}_email_sent_at = ?`, nowIso());
}

async function ownerAlert(env, order, message, deadline = false) {
  const column = deadline ? 'fulfillment_deadline_alert_sent_at' : 'fulfillment_alert_sent_at';
  if (order[column]) return;
  const shortId = order.id.slice(0, 8);
  const subject = deadline
    ? `URGENT: paid order ${shortId} needs manual refund review`
    : `Action needed: paid order ${shortId} awaiting BookVault`;
  const safeMessage = String(message).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  await sendEmail(env, {
    to: env.ORDER_ALERT_EMAIL || 'harveymeale9@gmail.com', subject,
    html: `<p>Paid order ${shortId} needs BookVault attention.</p><p>${safeMessage}</p><p>24-hour deadline: ${new Date(deadlineAt(order)).toISOString()}</p>`,
    text: `Paid order ${shortId} needs BookVault attention. ${message}\n24-hour deadline: ${new Date(deadlineAt(order)).toISOString()}`,
    idempotencyKey: `${order.id}-${deadline ? 'fulfillment-deadline-alert' : 'fulfillment-alert'}`,
  });
  await update(env.DB, order.id, `UPDATE orders SET ${column} = ?`, nowIso());
}

async function retry(env, order, error) {
  if (error.podRef && !order.bookvault_order_id) {
    await update(env.DB, order.id, 'UPDATE orders SET bookvault_order_id = ?', String(error.podRef));
    order = await getOrderById(env.DB, order.id);
  }
  const pending = error.pendingPayment === true;
  const attempts = Number(order.fulfillment_attempts || 0) + (pending ? 0 : 1);
  if (!pending) {
    await log(env.DB, order.id, 'bookvault', 'order_submission_failed', error.message, attempts);
    try { await ownerAlert(env, order, error.message); }
    catch (alertError) { await log(env.DB, order.id, 'resend', 'fulfillment_alert_failed', alertError.message); }
  }
  const deadline = deadlineAt(order);
  if (Number.isFinite(deadline) && Date.now() >= deadline) {
    try {
      // Refuse to refund an active print order or one whose cancellation
      // cannot be verified. The owner's manual-review alert is the fallback.
      await cancelUnpaidDraft(env, order.id, order.bookvault_order_id);
      await refundPayment(stripeClient(env.STRIPE_SECRET_KEY), order.stripe_payment_intent_id, order.id);
      await update(env.DB, order.id, "UPDATE orders SET order_status = 'REFUNDED', fulfillment_last_error = ?, fulfillment_next_attempt_at = ?", error.message, later(1));
      return;
    } catch (refundError) {
      await log(env.DB, order.id, 'worker', 'fulfillment_refund_needs_review', refundError.message);
      try { await ownerAlert(env, order, refundError.message, true); }
      catch (alertError) { await log(env.DB, order.id, 'resend', 'fulfillment_deadline_alert_failed', alertError.message); }
    }
  }
  const minutes = pending ? STATUS_POLL_MINUTES : RETRY_MINUTES[Math.min(Math.max(0, attempts - 1), RETRY_MINUTES.length - 1)];
  const dueAt = Number.isFinite(deadline) && deadline > Date.now() ? Math.min(Date.now() + minutes * 60000, deadline) : Date.now() + STATUS_POLL_MINUTES * 60000;
  await update(env.DB, order.id,
    "UPDATE orders SET order_status = 'FULFILLMENT_RETRY', fulfillment_attempts = ?, fulfillment_last_error = ?, fulfillment_next_attempt_at = ?",
    attempts, pending ? 'BatchPayment: awaiting BookVault scheduled payment.' : String(error.message).slice(0, 2000), new Date(dueAt).toISOString());
}

async function checkProgress(env, order) {
  try {
    const current = await getOrder(env, order.bookvault_order_id);
    if (String(current?.Status).toLowerCase() !== 'active') {
      const error = new Error(`BookVault reference is not active (${current?.Status || 'unknown'}).`);
      error.podRef = current?.PodRef;
      error.pendingPayment = String(current?.Status).toLowerCase() === 'batchpayment' && String(current?.Progress?.Status).toLowerCase() === 'created';
      await retry(env, order, error);
      return;
    }
    try { await captureBookVaultCost(env.DB, order, current); }
    catch (error) { await log(env.DB, order.id, 'bookvault', 'order_cost_capture_failed', error.message); }
    if (current?.Progress?.Status === 'Dispatched') {
      const shipment = {
        carrierName: current?.Tracking?.ServName || order.shipping_service_name,
        trackingNumber: current?.Tracking?.TrackingNumber,
        trackingUrl: current?.Tracking?.CombinedURL,
      };
      await sendTemplate(env, order, 'shipping', orderShippedEmail(order, shipment), 'shipped');
      await update(env.DB, order.id, "UPDATE orders SET order_status = 'SHIPPED', fulfillment_next_attempt_at = NULL");
      return;
    }
    await next(env.DB, order);
  } catch (error) {
    await log(env.DB, order.id, 'bookvault', 'order_status_poll_failed', error.message);
    await next(env.DB, order);
  }
}

async function processOrder(env, order) {
  if (order.order_status === 'SHIPPED') {
    await syncPurchaser(env, order);
    return;
  }
  if (order.order_status === 'REFUNDED') {
    if (!order.refund_email_sent_at) await sendTemplate(env, order, 'refund', orderRefundedEmail(order), 'refund');
    await update(env.DB, order.id, 'UPDATE orders SET fulfillment_next_attempt_at = NULL');
    return;
  }
  if (!order.confirmation_email_sent_at) {
    try { await sendTemplate(env, order, 'confirmation', orderConfirmedEmail(order), 'confirmed'); }
    catch (error) { await log(env.DB, order.id, 'resend', 'confirmation_email_failed', error.message); }
  }
  if (order.order_status === 'BOOKVAULT_ACCEPTED') {
    await syncPurchaser(env, order);
    await checkProgress(env, order);
    return;
  }
  try {
    const accepted = await submitOrder(env, order);
    await update(env.DB, order.id,
      "UPDATE orders SET bookvault_order_id = ?, order_status = 'BOOKVAULT_ACCEPTED', fulfillment_last_error = NULL, fulfillment_next_attempt_at = ?",
      String(accepted.PodRef), later(STATUS_POLL_MINUTES));
    const current = await getOrderById(env.DB, order.id);
    try { await captureBookVaultCost(env.DB, current, accepted); }
    catch (error) { await log(env.DB, order.id, 'bookvault', 'order_cost_capture_failed', error.message); }
  } catch (error) { await retry(env, order, error); }
}

async function claimNext(db) {
  return db.prepare(`UPDATE orders SET fulfillment_next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes')
    WHERE id = (
      SELECT id FROM orders WHERE stripe_livemode = 1
        AND (order_status IN ('PAYMENT_RECEIVED','FULFILLMENT_RETRY','BOOKVAULT_ACCEPTED')
          OR (order_status = 'REFUNDED' AND refund_email_sent_at IS NULL)
          OR (order_status = 'SHIPPED' AND resend_contact_synced_at IS NULL))
        AND (fulfillment_next_attempt_at IS NULL OR fulfillment_next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ORDER BY created_at LIMIT 1
    ) RETURNING *`).first();
}

export async function processPendingOrders(env, limit = 10) {
  if (env.FULFILLMENT_ENABLED !== 'true') return 0;
  let count = 0;
  while (count < limit) {
    const order = await claimNext(env.DB);
    if (!order) break;
    count++;
    try { await processOrder(env, order); }
    catch (error) {
      await log(env.DB, order.id, 'worker', 'fulfillment_order_processing_failed', error.message);
      await next(env.DB, order, 1);
    }
  }
  return count;
}

export async function reconcilePendingPayments(env, limit = 40) {
  if (env.FULFILLMENT_ENABLED !== 'true') return 0;
  const result = await env.DB.prepare(`SELECT * FROM orders WHERE stripe_payment_intent_id IS NOT NULL
    AND order_status IN ('PAYMENT_PENDING','PAYMENT_PROCESSING')
    AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')
    ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);
  let reconciled = 0;
  for (const order of result.results || []) {
    try {
      const payment = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (payment.status !== 'succeeded' || payment.amount_received !== order.total_price_cents ||
          String(payment.currency).toLowerCase() !== String(order.currency).toLowerCase() ||
          payment.metadata?.order_id !== order.id) continue;
      const applied = await applyPaymentEvent(env.DB, payment.id, 'PAYMENT_RECEIVED', payment.status, payment.livemode);
      if (applied.changed) reconciled++;
    } catch (error) { await log(env.DB, order.id, 'stripe', 'payment_reconcile_failed', error.message); }
  }
  return reconciled;
}
