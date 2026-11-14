import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const base = 'https://rm-storefront-api-staging.example.test';
const data = new Uint8Array(1024);
const env = {
  DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) },
  MEDIA: {
    head: async () => ({ size: 1024, httpEtag: '"test"', writeHttpMetadata: (headers) => headers.set('content-type', 'video/mp4') }),
    get: async (_key, options) => {
      const requestedRange = options.range.get('range');
      const range = requestedRange === 'bytes=0-9' ? { offset: 0, length: 10 } : undefined;
      const bytes = range ? data.slice(0, 10) : data;
      return { size: 1024, range, body: new Blob([bytes]).stream(), httpEtag: '"test"', writeHttpMetadata: (headers) => headers.set('content-type', 'video/mp4') };
    },
  },
};

test('health checks D1 but keeps checkout disabled', async () => {
  const response = await worker.fetch(new Request(`${base}/health`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, stage: 'staging', checkout: 'disabled' });
  const checkout = await worker.fetch(new Request(`${base}/api/checkout/create-payment-intent`, { method: 'POST' }), env);
  assert.equal(checkout.status, 404);
});

test('R2 video provides HEAD metadata and byte ranges', async () => {
  const path = '/media/reality-manual-vsl-1080p.mp4';
  const head = await worker.fetch(new Request(`${base}${path}`, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '1024');
  const part = await worker.fetch(new Request(`${base}${path}`, { headers: { range: 'bytes=0-9' } }), env);
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 0-9/1024');
  assert.equal((await part.arrayBuffer()).byteLength, 10);
});
