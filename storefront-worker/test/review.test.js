import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRequestDueAt } from '../src/reviewSchedule.js';
import { reviewRoute } from '../src/review.js';
import { reviewRequestEmail } from '../src/mail.js';
import { dispatchedAt } from '../src/fulfillment.js';
import { processDueReviewRequests } from '../src/reviewRequests.js';

test('active Worker review mail uses the face-reveal invitation', () => {
  const email = reviewRequestEmail({ id: 'sample-order' });
  assert.equal(email.subject, 'Face Reveal!');
  assert.match(email.html, /face-reveal-harvey-smudged\.png/);
  assert.match(email.html, /realitymanual\.com\/iloveyou/);
  assert.match(email.html, /Unsubscribe from review emails/);
  assert.match(email.headers['List-Unsubscribe'], /order=sample-order/);
});

test('review request waits at least 14 transit days and seven reading days', () => {
  assert.equal(reviewRequestDueAt({ shipping_email_sent_at: '2026-11-02T09:00:00.000Z' }), '2026-11-23T09:00:00.000Z');
  assert.equal(reviewRequestDueAt({ shipping_email_sent_at: null }), null);
  assert.equal(reviewRequestDueAt({ bookvault_dispatched_at: '2026-11-02T09:00:00.000Z', shipping_email_sent_at: '2026-11-06T09:00:00.000Z' }), '2026-11-23T09:00:00.000Z');
});

test('BookVault dispatch flag wins even when Progress.Status is Invoiced', () => {
  assert.equal(dispatchedAt({ Status: 'Invoiced', IsDispatched: true, Dispatched: '2026-11-02T09:00:00' }), '2026-11-02T09:00:00.000Z');
  assert.equal(dispatchedAt({ Status: 'Invoiced', IsDispatched: false, Dispatched: null }), null);
});

test('review scheduler does not query or send without a real postal address', async () => {
  const env = { FULFILLMENT_ENABLED: 'true', DB: { prepare: () => { throw new Error('should not query'); } } };
  assert.equal(await processDueReviewRequests(env), 0);
});

test('review unsubscribe GET has no mutation and POST suppresses future mail', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const env = { DB: { prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => ({ email: 'test@example.test' }),
      run: async () => calls.push([sql, args]),
    }),
  }) } };
  const url = `https://example.test/api/review/unsubscribe?order=${id}`;
  const preview = await reviewRoute(new Request(url), env);
  assert.equal(preview.status, 200);
  assert.equal(calls.length, 0);
  const action = await reviewRoute(new Request(url, { method: 'POST' }), env);
  assert.equal(action.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][0], 'test@example.test');
});
