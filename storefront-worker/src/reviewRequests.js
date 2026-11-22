import { getOrderById } from './orderStore.js';
import { getContactByEmail } from './resendContacts.js';
import { reviewRequestEmail, sendEmail, quantityBand } from './mail.js';
import { reviewRequestDueAt } from './reviewSchedule.js';

function hasReviewEmailBasis(order, now) {
  if (order.country === 'US' || order.review_request_opt_in) return true;
  if (order.country !== 'CA') return false;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  return Date.parse(order.created_at) >= cutoff.getTime();
}

export async function processDueReviewRequests(env, now = new Date()) {
  if (env.FULFILLMENT_ENABLED !== 'true') return 0;
  // This is a marketing/review invitation: do not send without the sender's
  // real postal address in both HTML and plain text. No fabricated fallback.
  if (!String(env.MARKETING_POSTAL_ADDRESS || '').trim()) return 0;
  const rows = await env.DB.prepare(`SELECT * FROM orders WHERE stripe_livemode = 1
    AND order_status = 'SHIPPED' AND bookvault_order_id IS NOT NULL
    AND COALESCE(bookvault_dispatched_at, shipping_email_sent_at) IS NOT NULL AND refund_email_sent_at IS NULL
    AND (orders.country = 'US' OR (orders.country = 'CA'
      AND julianday(orders.created_at) >= julianday('now', '-2 years'))
      OR review_request_opt_in = 1) AND review_request_email_sent_at IS NULL
    AND review_request_skipped_at IS NULL AND review_request_opt_out_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM orders prior WHERE LOWER(prior.email) = LOWER(orders.email)
      AND prior.review_request_opt_out_at IS NOT NULL)
    ORDER BY COALESCE(bookvault_dispatched_at, shipping_email_sent_at) LIMIT 50`).all();
  let sent = 0;
  for (const order of rows.results || []) {
    if (!reviewRequestDueAt(order) || Date.parse(reviewRequestDueAt(order)) > now.getTime()) continue;
    try {
      const contact = await getContactByEmail(env, order.email);
      if (!contact) throw new Error('Purchaser contact not found in Resend; review request deferred.');
      if (contact.unsubscribed) {
        await env.DB.prepare(`UPDATE orders SET review_request_skipped_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ? AND review_request_email_sent_at IS NULL`).bind(order.id).run();
        continue;
      }
      const latest = await getOrderById(env.DB, order.id);
      if (!latest || latest.stripe_livemode !== 1 || latest.order_status !== 'SHIPPED' ||
          !latest.bookvault_order_id || !(latest.bookvault_dispatched_at || latest.shipping_email_sent_at) || latest.refund_email_sent_at ||
          !hasReviewEmailBasis(latest, now) || latest.review_request_opt_out_at ||
          latest.review_request_email_sent_at || latest.review_request_skipped_at) continue;
      const optedOut = await env.DB.prepare(`SELECT id FROM orders WHERE LOWER(email) = LOWER(?)
        AND review_request_opt_out_at IS NOT NULL LIMIT 1`).bind(latest.email).first();
      if (optedOut) continue;
      const email = reviewRequestEmail(latest, { postalAddress: env.MARKETING_POSTAL_ADDRESS });
      await sendEmail(env, {
        to: latest.email, ...email, idempotencyKey: `${latest.id}-review-request`,
        tags: [
          { name: 'email_type', value: 'review_request_email' },
          { name: 'customer_status', value: 'purchaser' },
          { name: 'product', value: 'reality_manual_hardcover' },
          { name: 'quantity_band', value: quantityBand(latest.quantity) },
        ],
      });
      await env.DB.prepare(`UPDATE orders SET review_request_email_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND review_request_email_sent_at IS NULL`).bind(latest.id).run();
      sent++;
    } catch (error) {
      try {
        await env.DB.prepare('INSERT INTO error_logs(id,order_id,service,error_type,error_message) VALUES(?,?,?,?,?)')
          .bind(crypto.randomUUID(), order.id, 'resend', 'review_request_email_failed', String(error.message).slice(0, 1000)).run();
      } catch { /* Retry on next sweep. */ }
    }
  }
  return sent;
}
