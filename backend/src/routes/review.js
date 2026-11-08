const express = require('express');
const orderService = require('../services/orderService');

const router = express.Router();
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page({ complete = false, orderId = '' } = {}) {
  const content = complete
    ? '<h1>You\'re unsubscribed</h1><p>We won\'t send any more review requests for this purchase.</p>'
    : `<h1>Stop review emails?</h1><p>You can stop future requests for feedback and reviews without affecting your order updates.</p><form method="post" action="/api/review/unsubscribe?order=${encodeURIComponent(orderId)}"><button type="submit">Unsubscribe from review requests</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review email preference | The Reality Manual</title></head><body style="margin:0;min-height:100vh;background:#0e0b07;color:#f0e7d8;font-family:Georgia,serif;display:grid;place-items:center;"><main style="max-width:34rem;padding:2rem;text-align:center;"><p style="font:12px Arial,sans-serif;letter-spacing:3px;color:#c9a24d;">THE REALITY MANUAL</p>${content}<p><a href="https://realitymanual.com/" style="color:#c9a24d;">Return to the website</a></p></main></body></html>`;
}

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  next();
});

router.get('/unsubscribe', (req, res) => {
  const orderId = String(req.query.order || '');
  if (!ORDER_ID_PATTERN.test(orderId)) return res.status(404).send('Unsubscribe link not found.');
  res.type('html').send(page({ orderId }));
});

// Also accepts RFC 8058 one-click POSTs from mail clients. GET never changes
// state, so link scanners cannot unsubscribe someone merely by previewing it.
router.post('/unsubscribe', (req, res) => {
  const orderId = String(req.query.order || '');
  if (ORDER_ID_PATTERN.test(orderId)) orderService.suppressReviewRequestsForOrder(orderId);
  res.type('html').send(page({ complete: true }));
});

module.exports = router;
