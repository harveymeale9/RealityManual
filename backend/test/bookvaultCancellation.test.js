const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const bookvault = require('../src/services/bookvaultService');

test('a BookVault Deleted draft is safely terminal even when GET still returns it', async () => {
  const originalFetch = global.fetch;
  const originalKey = config.bookvault.apiKey;
  config.bookvault.apiKey = 'test-key';
  let deletes = 0;
  let deleted = false;
  global.fetch = async (_url, options) => {
    if (options.method === 'DELETE') { deletes += 1; deleted = true; return new Response('{}'); }
    return Response.json({ PodRef: '7124', DocRef: 'order-123', Status: deleted ? 'Deleted' : 'BatchPayment', Progress: { Status: 'Created' } });
  };
  try {
    assert.equal(await bookvault.cancelUnpaidDraft('order-123', '7124'), true);
    assert.equal(await bookvault.cancelUnpaidDraft('order-123', '7124'), true);
    assert.equal(deletes, 1);
  } finally {
    global.fetch = originalFetch;
    config.bookvault.apiKey = originalKey;
  }
});
