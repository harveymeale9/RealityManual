import { getOrderById } from './orderStore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
};

function page({ complete = false, orderId = '' } = {}) {
  const content = complete
    ? '<h1>You\'re unsubscribed</h1><p>We won\'t send any more review requests for this purchase.</p>'
    : `<h1>Stop review emails?</h1><p>You can stop future requests for feedback and reviews without affecting your order updates.</p><form method="post" action="/api/review/unsubscribe?order=${encodeURIComponent(orderId)}"><button type="submit">Unsubscribe from review requests</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review email preference | The Reality Manual</title></head><body style="margin:0;min-height:100vh;background:#0e0b07;color:#f0e7d8;font-family:Georgia,serif;display:grid;place-items:center;"><main style="max-width:34rem;padding:2rem;text-align:center;"><p style="font:12px Arial,sans-serif;letter-spacing:3px;color:#c9a24d;">THE REALITY MANUAL</p>${content}<p><a href="https://realitymanual.com/" style="color:#c9a24d;">Return to the website</a></p></main></body></html>`;
}

export async function reviewRoute(request, env) {
  const orderId = new URL(request.url).searchParams.get('order') || '';
  if (!UUID.test(orderId)) return new Response('Unsubscribe link not found.', { status: 404, headers });
  if (request.method === 'GET') return new Response(page({ orderId }), { headers });
  if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405, headers });
  const order = await getOrderById(env.DB, orderId);
  if (order) {
    await env.DB.prepare(`UPDATE orders SET review_request_opt_out_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE LOWER(email) = LOWER(?) AND review_request_email_sent_at IS NULL`)
      .bind(order.email).run();
  }
  return new Response(page({ complete: true }), { headers });
}
