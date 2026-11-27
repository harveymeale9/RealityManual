import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReviewOpenMetrics } from '../src/emailOpenTracking.js';

test('daily sweep records only provider-confirmed unique opens by email ID', async () => {
  const originalFetch = globalThis.fetch;
  const updates = [];
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return Response.json({ data: [
      { email_id: 'review-a', unique_opened: 2 },
      { email_id: 'review-b', unique_opened: 0 },
      { email_id: 'other-a', unique_opened: 1 },
    ] });
  };
  try {
    const env = { RESEND_API_KEY: 'test', DB: { prepare: (sql) => {
      assert.match(sql, /WHERE email_id = \?/);
      return { bind: (id) => ({ run: async () => { updates.push(id); } }) };
    } } };
    assert.equal(await captureReviewOpenMetrics(env, new Date('2026-11-27T02:00:00Z')), 2);
    assert.equal(requested.searchParams.get('dimensions'), 'email');
    assert.deepEqual(updates, ['review-a', 'other-a']);
  } finally { globalThis.fetch = originalFetch; }
});

test('failed provider lookup never invents an open', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('bad', { status: 503 });
  try {
    await assert.rejects(captureReviewOpenMetrics({ RESEND_API_KEY: 'test' }), /503/);
  } finally { globalThis.fetch = originalFetch; }
});
