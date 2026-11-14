// Staging starts deliberately inert: no checkout, fulfillment, email, or
// customer-data endpoints are reachable until the full port is verified.
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
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === VSL_PATH && ['GET', 'HEAD'].includes(request.method)) {
      return serveVideo(request, env);
    }
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (request.method !== 'GET' || path !== '/health') {
      return new Response(JSON.stringify({ error: 'staging_not_enabled' }), { status: 404, headers });
    }
    try {
      const result = await env.DB.prepare('SELECT 1 AS ok').first();
      return new Response(JSON.stringify({ ok: result?.ok === 1, stage: 'staging', checkout: 'disabled' }), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ ok: false, stage: 'staging', checkout: 'disabled' }), { status: 503, headers });
    }
  },
};
