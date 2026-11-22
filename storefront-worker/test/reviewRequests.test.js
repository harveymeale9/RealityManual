import test from 'node:test';
import assert from 'node:assert/strict';
import { processDueReviewRequests } from '../src/reviewRequests.js';

test('review sweep considers every shipped purchaser, but retains explicit suppression', async () => {
  let candidateQuery = '';
  const env = {
    FULFILLMENT_ENABLED: 'true',
    MARKETING_POSTAL_ADDRESS: '1 Example Road',
    DB: {
      prepare(sql) {
        candidateQuery = sql;
        return { all: async () => ({ results: [] }) };
      },
    },
  };
  assert.equal(await processDueReviewRequests(env), 0);
  assert.doesNotMatch(candidateQuery, /orders\.country|review_request_opt_in/);
  assert.match(candidateQuery, /review_request_opt_out_at IS NULL/);
  assert.match(candidateQuery, /review_request_email_sent_at IS NULL/);
  assert.match(candidateQuery, /refund_email_sent_at IS NULL/);
});
