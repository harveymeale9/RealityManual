const API = 'https://api.resend.com';
const SEGMENT_NAME = 'Customers | The Reality Manual';
const PROPERTIES = [
  ['customer_status', 'string'], ['products_purchased', 'string'],
  ['last_order_quantity', 'number'], ['largest_order_quantity', 'number'],
  ['lifetime_book_quantity', 'number'], ['purchase_order_count', 'number'],
  ['quantity_band', 'string'], ['first_purchase_at', 'string'], ['latest_purchase_at', 'string'],
  ['reader_feedback_left', 'string'], ['reader_review_left', 'string'],
  ['reader_video_review_left', 'string'], ['reader_opinion', 'string'],
  ['reader_affinity', 'string'], ['reader_opinion_at', 'string'],
];

async function request(env, path, method = 'GET', body) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try { data = await response.json(); } catch { /* Use HTTP status below. */ }
  if (!response.ok) {
    const error = new Error(`Resend API ${response.status}: ${data?.message || data?.error || 'unknown error'}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getContactByEmail(env, email) {
  try { return await request(env, `/contacts/${encodeURIComponent(String(email).trim().toLowerCase())}`); }
  catch (error) { if (error.status === 404) return null; throw error; }
}

async function ensurePurchaserSchema(env) {
  const [propertyList, segmentList] = await Promise.all([
    request(env, '/contact-properties?limit=100'), request(env, '/segments?limit=100'),
  ]);
  const existing = new Map((propertyList.data || []).map((item) => [item.key, item]));
  for (const [key, type] of PROPERTIES) {
    const item = existing.get(key);
    if (item && item.type !== type) throw new Error(`Resend property ${key} has an incompatible type.`);
    if (!item) await request(env, '/contact-properties', 'POST', { key, type });
  }
  let segment = (segmentList.data || []).find((item) => item.name === SEGMENT_NAME);
  if (!segment) segment = await request(env, '/segments', 'POST', { name: SEGMENT_NAME });
  return segment.id;
}

export async function syncPurchaserContact(env, order, summary) {
  const segmentId = await ensurePurchaserSchema(env);
  const parts = String(order.customer_name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || '';
  const largest = Math.max(1, Number(summary.largest_order_quantity) || 1);
  const properties = {
    customer_status: 'purchaser', products_purchased: 'reality_manual_hardcover',
    last_order_quantity: Number(order.quantity), largest_order_quantity: largest,
    lifetime_book_quantity: Number(summary.lifetime_book_quantity),
    purchase_order_count: Number(summary.purchase_order_count),
    quantity_band: largest >= 5 ? '5_plus_books' : `${largest}_book${largest === 1 ? '' : 's'}`,
    first_purchase_at: summary.first_purchase_at, latest_purchase_at: summary.latest_purchase_at,
  };
  const contactPath = `/contacts/${encodeURIComponent(order.email.trim().toLowerCase())}`;
  const body = { first_name: firstName, last_name: parts.join(' '), properties };
  const contact = await getContactByEmail(env, order.email);
  if (contact) {
    // Never reset an existing provider unsubscribe on a later purchase.
    await request(env, contactPath, 'PATCH', body);
    await request(env, `${contactPath}/segments/${segmentId}`, 'POST');
    return;
  }
  await request(env, '/contacts', 'POST', {
    email: order.email.trim().toLowerCase(), ...body,
    unsubscribed: false, segments: [{ id: segmentId }],
  });
}

// Only the authenticated internal reader-submission route calls this after
// checking a paid order. Preserve existing flags and never touch unsubscribe.
export async function tagPurchaserFromReaderSubmission(env, input) {
  await ensurePurchaserSchema(env);
  const contact = await getContactByEmail(env, input.email);
  if (!contact) return false; // Purchaser contact sync may still be pending.
  const prior = contact.properties || {};
  const properties = {};
  if (input.kind === 'feedback') properties.reader_feedback_left = 'yes';
  else {
    properties.reader_review_left = 'yes';
    if (input.hasVideo) properties.reader_video_review_left = 'yes';
  }
  if (input.opinion !== 'unclear' && (!prior.reader_opinion_at || input.submittedAt >= prior.reader_opinion_at)) {
    properties.reader_opinion = input.opinion;
    properties.reader_affinity = ({ positive: 'fan', very_positive: 'super_fan', exceptional: 'devoted_fan' })[input.opinion] || 'none';
    properties.reader_opinion_at = input.submittedAt;
  }
  await request(env, `/contacts/${encodeURIComponent(input.email)}`, 'PATCH', { properties });
  return true;
}
