import { tagPurchaserFromReaderSubmission } from './resendContacts.js';

const PAID = `stripe_livemode=1 AND order_status != 'REFUNDED' AND
  (stripe_payment_status IN ('succeeded','paid') OR order_status IN
  ('PAYMENT_RECEIVED','BOOKVAULT_PENDING','BOOKVAULT_ACCEPTED','FULFILLMENT_RETRY','SHIPPED','COMPLETE'))`;
const OPINIONS = new Set(['unclear', 'critical', 'mixed', 'positive', 'very_positive', 'exceptional']);

export async function tagReaderSubmission(request, env, tagContact = tagPurchaserFromReaderSubmission) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
  const email = String(body?.email || '').trim().toLowerCase();
  const submittedAt = String(body?.submitted_at || '');
  const input = { email, kind: body?.kind, hasVideo: body?.has_video === true,
    opinion: body?.opinion, submittedAt };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['feedback','review'].includes(input.kind) ||
    !OPINIONS.has(input.opinion) || !Number.isFinite(Date.parse(submittedAt)) ||
    typeof body?.has_video !== 'boolean' || !/^[0-9a-f-]{36}$/i.test(String(body?.submission_id || ''))) {
    return Response.json({ error: 'invalid_reader_submission' }, { status: 400 });
  }
  const order = await env.DB.prepare(`SELECT id FROM orders WHERE lower(trim(email))=? AND ${PAID} LIMIT 1`).bind(email).first();
  if (!order) return Response.json({ matched: false, tagged: false });
  try {
    const tagged = await tagContact(env, input);
    return Response.json({ matched: true, tagged });
  } catch (error) {
    console.error('Reader contact tagging failed:', error.message);
    return Response.json({ error: 'contact_tag_failed' }, { status: 503 });
  }
}
