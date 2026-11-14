// Staging starts deliberately inert: checkout and webhooks stay closed until
// fulfillment, email, and final data reconciliation have passed release gates.
import { checkoutRoute } from './checkout.js';
import { stripeWebhook } from './webhook.js';
import { processPendingOrders, reconcilePendingPayments } from './fulfillment.js';
const VSL_PATH = '/media/reality-manual-vsl-1080p.mp4';
const VSL_KEY = 'storefront/reality-manual-vsl-c1a7775e.mp4';

async function serveVideo(request, env) {
  const rangeRequested = request.headers.has('range');
  const object = request.method === 'HEAD'
    ? await env.MEDIA.head(VSL_KEY)
    : await env.MEDIA.get(VSL_KEY, {
      onlyIf: request.headers,
      range: request.headers,
    });
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=604800, immutable');

  if (rangeRequested && object.range) {
    const start = object.range.offset;
    const end = start + object.range.length - 1;
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(object.range.length));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
  }
  headers.set('content-length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : ('body' in object ? object.body : null), {
    status: 'body' in object || request.method === 'HEAD' ? 200 : 412,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === VSL_PATH && ['GET', 'HEAD'].includes(request.method)) {
      return serveVideo(request, env);
    }
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY',
      'BOOKVAULT_API_KEY', 'BOOKVAULT_TITLE_ISBN', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'];
    const configured = required.every((key) => Boolean(env[key]));
    const checkoutReady = configured && env.CHECKOUT_ENABLED === 'true' && env.FULFILLMENT_ENABLED === 'true';
    if (checkoutReady && path === '/api/webhooks/stripe' && request.method === 'POST') {
      const response = await stripeWebhook(request, env);
      if (response.ok && ctx?.waitUntil) ctx.waitUntil(processPendingOrders(env));
      return response;
    }
    if (checkoutReady && (path.startsWith('/api/checkout/') || path.startsWith('/api/shipping/') ||
        path === '/api/config/stripe' || path.startsWith('/api/orders/'))) {
      const origin = request.headers.get('origin');
      const allowed = String(env.CORS_ORIGIN || '').split(',').map((item) => item.trim());
      if (origin && !allowed.includes(origin)) return new Response(null, { status: 403 });
      if (request.method === 'OPTIONS') {
        if (!origin) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
        } });
      }
      const response = await checkoutRoute(request, env, path);
      if (origin) response.headers.set('access-control-allow-origin', origin);
      return response;
    }
    if (request.method !== 'GET' || path !== '/health') {
      return new Response(JSON.stringify({ error: 'staging_not_enabled' }), { status: 404, headers });
    }
    try {
      const result = await env.DB.prepare('SELECT 1 AS ok').first();
      return new Response(JSON.stringify({ ok: result?.ok === 1, stage: 'staging', checkout: checkoutReady ? 'enabled' : 'disabled' }), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ ok: false, stage: 'staging', checkout: 'disabled' }), { status: 503, headers });
    }
  },
  async scheduled(_event, env, ctx) {
    if (env.FULFILLMENT_ENABLED !== 'true') return;
    ctx.waitUntil((async () => {
      await reconcilePendingPayments(env);
      await processPendingOrders(env);
    })());
  },
};
