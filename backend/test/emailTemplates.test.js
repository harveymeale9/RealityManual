const test = require('node:test');
const assert = require('node:assert/strict');
const {
  orderConfirmedEmail,
  orderShippedEmail,
  orderRefundedEmail,
} = require('../src/services/emailTemplates');
const { createResendClient } = require('../src/services/resendService');

const order = {
  id: 'RM-1001',
  customer_name: 'Ava <script>alert(1)</script>',
  street1: '1 Example Road',
  city: 'London',
  postal_code: 'SW1A 1AA',
  country: 'GB',
  quantity: 2,
  total_price_cents: 13998,
  currency: 'usd',
};

test('confirmation email is branded, responsive, plain-text backed, and escapes customer data', () => {
  const email = orderConfirmedEmail(order, { preview: true });
  assert.equal(email.subject, '[PREVIEW] We’re Making Your Copy of The Reality Manual');
  assert.match(email.html, /We’re Making Your Copy of The Reality Manual/);
  assert.match(email.html, /15 working days/);
  assert.match(email.html, /individually produced with the care and attention/);
  assert.match(email.html, /make, inspect and finish your book properly/);
  assert.doesNotMatch(email.html, /<script>alert/);
  assert.match(email.html, /Ava &lt;script&gt;/);
  assert.match(email.text, /Hardcover — Deluxe First Edition/);
  assert.match(email.text, /\$139\.98 USD/);
});

test('dispatch email includes tracking only when BookVault supplies it', () => {
  const tracked = orderShippedEmail(order, {
    carrierName: 'Royal Mail',
    trackingNumber: 'TRACK-123',
    trackingUrl: 'https://tracking.example/TRACK-123',
  });
  assert.match(tracked.html, /Track your shipment/);
  assert.match(tracked.html, /https:\/\/tracking\.example\/TRACK-123/);
  assert.match(tracked.text, /TRACK-123/);

  const untracked = orderShippedEmail(order, { carrierName: 'Local post' });
  assert.doesNotMatch(untracked.html, /Track your shipment/);
  assert.doesNotMatch(untracked.text, /Track your shipment:/);
});

test('refund email says the refund was issued without promising bank timing', () => {
  const email = orderRefundedEmail(order);
  assert.equal(email.subject, 'We couldn’t complete your order.');
  assert.match(email.html, /issued a full refund/);
  assert.match(email.html, /Try Your Order Again/);
  assert.match(email.html, /https:\/\/realitymanual\.com\/checkout\.html/);
  assert.match(email.text, /Please try placing your order once more/);
  assert.match(email.text, /we’ll be in touch to help resolve it/);
  assert.match(email.text, /bank may take several working days/);
  assert.match(email.text, /\$139\.98 USD/);
});

test('Resend client sends HTML and text with domain identity and idempotency', async () => {
  let request;
  const client = createResendClient({
    apiKey: 're_test_key',
    fromEmail: 'The Reality Manual <orders@realitymanual.com>',
    replyTo: 'info@realitymanual.com',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: 'email_123' }) };
    },
  });

  const result = await client.sendEmail({
    to: 'reader@example.com',
    subject: 'Subject',
    html: '<p>Hello</p>',
    text: 'Hello',
    idempotencyKey: 'order-123-confirmed',
  });

  assert.equal(result.id, 'email_123');
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_key');
  assert.equal(request.options.headers['Idempotency-Key'], 'order-123-confirmed');
  assert.deepEqual(JSON.parse(request.options.body), {
    from: 'The Reality Manual <orders@realitymanual.com>',
    to: ['reader@example.com'],
    subject: 'Subject',
    html: '<p>Hello</p>',
    text: 'Hello',
    reply_to: 'info@realitymanual.com',
  });
});
