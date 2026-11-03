const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailHealthService, sendingDomain } = require('../src/services/emailHealthService');

test('uses only the storefront sending domain and caches both metric windows', async () => {
  let calls = 0;
  const service = createEmailHealthService({
    apiKey: 'test-key', fromEmail: 'Reality Manual <orders@realitymanual.com>',
    now: () => Date.parse('2026-11-03T12:00:00Z'),
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(options.headers.Authorization, /^Bearer test-key$/);
      assert.equal(new URL(url).searchParams.get('dimensions'), 'domain');
      return { ok: true, json: async () => ({ data: [
        { domain_name: 'other.example', sent: 100, bounced: 20 },
        { domain_name: 'realitymanual.com', sent: 9, delivered: 8, bounced: 1,
          failed: 0, complained: 0, delivery_rate: 88.9, bounce_rate: 11.1 },
      ] }) };
    },
  });
  const first = await service.get();
  assert.equal(first.domain, 'realitymanual.com');
  assert.equal(first.last_7_days.sent, 9);
  assert.equal(first.last_7_days.bounced, 1);
  assert.equal(first.last_30_days.delivery_rate, 88.9);
  assert.deepEqual(await service.get(), first);
  assert.equal(calls, 2);
});

test('an API failure is not reported as zero bounces and can be retried', async () => {
  let healthy = false;
  const service = createEmailHealthService({
    apiKey: 'test-key', fromEmail: 'orders@realitymanual.com',
    fetchImpl: async () => healthy
      ? { ok: true, json: async () => ({ data: [] }) }
      : { ok: false, status: 503 },
  });
  await assert.rejects(service.get(), /503/);
  healthy = true;
  const result = await service.get();
  assert.equal(result.last_7_days.sent, 0);
  assert.equal(result.last_7_days.bounced, 0);
});

test('parses the configured sender domain without exposing an email address', () => {
  assert.equal(sendingDomain('Reality Manual <hello@RealityManual.com>'), 'realitymanual.com');
  assert.equal(sendingDomain('hello@realitymanual.com'), 'realitymanual.com');
  assert.equal(sendingDomain('invalid'), '');
});
