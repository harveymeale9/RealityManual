const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewRequestDueAt } = require('../src/services/reviewSchedule');

test('review request waits at least 14 transit days plus seven reading days', () => {
  assert.equal(reviewRequestDueAt({
    shipping_email_sent_at: '2026-11-02T10:00:00.000Z',
    shipping_max_delivery_days: 4,
  }), '2026-11-23T10:00:00.000Z');
  assert.equal(reviewRequestDueAt({ shipping_email_sent_at: '2026-11-02T10:00:00.000Z' }),
    '2026-11-23T10:00:00.000Z');
});

test('longer destination quote extends the review request date past the baseline', () => {
  assert.equal(reviewRequestDueAt({
    shipping_email_sent_at: '2026-11-02T10:00:00.000Z',
    shipping_max_delivery_days: 11,
  }), '2026-11-24T10:00:00.000Z');
});

test('no shipping email means no review request date', () => {
  assert.equal(reviewRequestDueAt({ shipping_max_delivery_days: 8 }), null);
  assert.equal(reviewRequestDueAt({ shipping_email_sent_at: 'not-a-date' }), null);
});
