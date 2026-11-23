import test from 'node:test';
import assert from 'node:assert/strict';
import { tagReaderSubmission } from '../src/readerTags.js';
import { tagPurchaserFromReaderSubmission } from '../src/resendContacts.js';

const submission = { submission_id: '11111111-1111-4111-8111-111111111111', email: ' Reader@Example.test ',
  kind: 'review', has_video: true, opinion: 'very_positive', submitted_at: '2026-11-23T00:00:00.000Z' };
function request(body = submission) {
  return new Request('https://example.test/api/internal/reader-tags', { method: 'POST', body: JSON.stringify(body) });
}

test('reader tags require a paid matching customer; unmatched and invalid forms never tag', async () => {
  let matched = false, tagged = 0;
  const env = { DB: { prepare(sql) {
    assert.match(sql, /lower\(trim\(email\)\)=\?/);
    assert.match(sql, /stripe_livemode=1/);
    assert.match(sql, /order_status != 'REFUNDED'/);
    return { bind(email) { assert.equal(email, 'reader@example.test'); return { first: async () => matched ? { id: 'paid-order' } : null }; } };
  } } };
  const tag = async (_env, input) => { tagged++; assert.equal(input.email, 'reader@example.test'); return true; };
  assert.deepEqual(await (await tagReaderSubmission(request(), env, tag)).json(), { matched: false, tagged: false });
  assert.equal(tagged, 0);
  matched = true;
  assert.deepEqual(await (await tagReaderSubmission(request(), env, tag)).json(), { matched: true, tagged: true });
  assert.equal(tagged, 1);
  assert.equal((await tagReaderSubmission(request({ ...submission, opinion: 'injected' }), env, tag)).status, 400);
  assert.equal(tagged, 1);
});

test('Resend reader tag sets category and affinity without changing unsubscribe or older opinion', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (path === '/contact-properties') return Response.json({ data: [
      'reader_feedback_left','reader_review_left','reader_video_review_left','reader_opinion','reader_affinity','reader_opinion_at'
    ].map(key => ({ key, type: 'string' })).concat([
      'customer_status','products_purchased','quantity_band','first_purchase_at','latest_purchase_at'
    ].map(key => ({ key, type: 'string' })).concat([
      'last_order_quantity','largest_order_quantity','lifetime_book_quantity','purchase_order_count'
    ].map(key => ({ key, type: 'number' })))) });
    if (path === '/segments') return Response.json({ data: [{ id: 'segment', name: 'Customers | The Reality Manual' }] });
    if (path === '/contacts/reader%40example.test' && options.method === 'GET') return Response.json({
      email: 'reader@example.test', unsubscribed: true,
      properties: { reader_opinion_at: '2026-11-24T00:00:00.000Z', reader_opinion: 'critical' }
    });
    return Response.json({ ok: true });
  };
  try {
    assert.equal(await tagPurchaserFromReaderSubmission({ RESEND_API_KEY: 'test' }, {
      email: 'reader@example.test', kind: 'review', hasVideo: true, opinion: 'exceptional',
      submittedAt: '2026-11-23T00:00:00.000Z'
    }), true);
    const patch = calls.find(call => call.method === 'PATCH');
    assert.deepEqual(patch.body, { properties: { reader_review_left: 'yes', reader_video_review_left: 'yes' } });
    assert.equal(calls.some(call => call.path.includes('unsubscribe')), false);
  } finally { global.fetch = originalFetch; }
});
