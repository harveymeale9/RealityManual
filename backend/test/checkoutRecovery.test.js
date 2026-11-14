const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const config = require('../src/config');
const recovery = require('../src/services/checkoutRecoveryService');
const router = require('../src/routes/checkout');

test('checkout recovery requires a permitted origin and affirmative consent; unticking removes it', async () => {
  const oldOrigins = config.corsOrigins;
  const oldSave = recovery.save;
  const oldRemove = recovery.remove;
  const saved = [];
  const removed = [];
  config.corsOrigins = ['https://realitymanual.com'];
  recovery.save = (...args) => saved.push(args);
  recovery.remove = (...args) => removed.push(args);
  const app = express();
  app.use(express.json());
  app.use('/api/checkout', router);
  const server = app.listen(0, '127.0.0.1');
  const captureId = '00000000-0000-4000-8000-000000000001';
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/checkout/recovery-email`;
    const post = (origin, body) => fetch(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: origin,
    }, body: JSON.stringify(body) });
    assert.equal((await post('https://evil.example', { capture_id: captureId, email: 'a@example.com', consent: true })).status, 403);
    assert.equal((await post('https://realitymanual.com', { capture_id: captureId, email: 'a@example.com' })).status, 400);
    assert.equal((await post('https://realitymanual.com', { capture_id: captureId, email: 'bad', consent: true })).status, 400);
    assert.equal(saved.length, 0);
    assert.equal((await post('https://realitymanual.com', { capture_id: captureId, email: 'a@example.com', consent: true })).status, 204);
    assert.deepEqual(saved, [[captureId, 'a@example.com']]);
    assert.equal((await post('https://realitymanual.com', { capture_id: captureId, consent: false })).status, 204);
    assert.deepEqual(removed, [[captureId]]);
  } finally {
    config.corsOrigins = oldOrigins;
    recovery.save = oldSave;
    recovery.remove = oldRemove;
    await new Promise(resolve => server.close(resolve));
  }
});
