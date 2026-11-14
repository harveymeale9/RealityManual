// The Worker reuses the existing customer-facing copy during migration. This
// is code-only sharing; no VPS database or service is contacted for email.
import templates from '../../backend/src/services/emailTemplates.js';

export const { orderConfirmedEmail, orderShippedEmail, orderRefundedEmail, reviewRequestEmail } = templates;

export async function sendEmail(env, { to, subject, html, text, idempotencyKey, tags }) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !to || !subject || !html || !text) {
    throw new Error('Resend email configuration or content is incomplete.');
  }
  const payload = { from: env.RESEND_FROM_EMAIL, to: Array.isArray(to) ? to : [to], subject, html, text };
  if (env.RESEND_REPLY_TO) payload.reply_to = env.RESEND_REPLY_TO;
  if (tags?.length) payload.tags = tags;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  let result = null;
  try { result = await response.json(); } catch { /* Report the status below. */ }
  if (!response.ok) throw new Error(`Resend rejected email (${response.status}): ${result?.message || result?.error || 'unknown error'}`);
  return result;
}

export function quantityBand(quantity) {
  const count = Math.max(1, Number(quantity) || 1);
  return count >= 5 ? '5_plus_books' : `${count}_book${count === 1 ? '' : 's'}`;
}
