import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineAt } from '../src/fulfillment.js';

test('BookVault resolution window runs for 60 hours from payment, not order creation', () => {
  const created = '2026-11-14T01:00:00.000Z';
  const paid = '2026-11-14T02:00:00.000Z';
  assert.equal(new Date(deadlineAt({ created_at: created, payment_received_at: paid })).toISOString(),
    '2026-11-16T14:00:00.000Z');
  assert.equal(new Date(deadlineAt({ created_at: created })).toISOString(),
    '2026-11-16T13:00:00.000Z');
});
